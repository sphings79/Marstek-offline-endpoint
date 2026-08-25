# Marstek Offline Endpoint

A tiny container for your **home server** that answers the telemetry upload a
Marstek Venus expects — so the firmware stops resetting its own network chip,
and your telemetry stays in your LAN.

## Why

On Control firmware **v150** the device buffers telemetry records and uploads
them to Marstek's cloud. If the upload does not drain that buffer, the firmware
**hardware-resets its own network chip** on a fixed timer:

| | Ethernet (CH395) | WiFi (FC41D) |
|---|---|---|
| timer | 1800 s (30 min) | 900 s (15 min) |
| backlog needed | more than 1 record | any record |

While the chip is in reset it is simply gone — Modbus TCP sessions die, ping
stops answering, and a few seconds later everything is back. Forever, on the
dot. If you keep your battery away from the internet, that is what you get.

Full analysis with firmware addresses:
<https://github.com/sphings79/marstek_venus_modbus_dev/issues/2>

## What the device actually requires

Two things, both read out of the decompiled firmware:

- **TLS on port 443, certificate not verified.** `HTTPS_TLS_Session_Init` calls
  `mbedTLS_SSL_Conf_Authmode(conf, 0)` — no CA chain, no client certificate. A
  self-signed certificate is enough.
- **A response body containing `"code":0`.** `FUN_0801774c` does
  `strstr(body, "\"code\":")` and `atoi()` on what follows. Nothing else about
  the response is inspected.

That is the whole contract. This container satisfies it and logs everything.

## Run it

A prebuilt image is published for **amd64, arm64 and armv7**, so it runs on a
normal server and on a Raspberry Pi alike (a 3B is plenty — this thing answers a
handful of requests per hour).

```
docker run -d --name marstek-offline-endpoint --restart unless-stopped \
  -p 443:443 -p 80:80 \
  -v "$PWD/data:/data" -v "$PWD/certs:/certs" \
  ghcr.io/sphings79/marstek-offline-endpoint:latest
```

Or with compose — copy `docker-compose.yml` from this repo and:

```
docker compose up -d
```

To build it yourself instead, uncomment `build: .` in the compose file, or:

```
docker build -t marstek-offline-endpoint .
```

Ports 443 and 80 must be free on the host. A self-signed certificate is
generated into `./certs` on first start; delete it to get a new one.

Then point the device's cloud hostname at the container.

### The hostname

The upload URL in firmware is `https://api-%s.marstekcloud.com/data-upload/v1/venus/%s`,
where `%s` is a region tag. The region table lives in RAM and could not be read
out of the firmware image, but every other Marstek endpoint uses the same tag —
and for those, European devices demonstrably use `eu` (`eu.hamedata.com`,
`static-eu.marstekenergy.com`). So `api-eu.marstekcloud.com` is the expected
hostname here.

**You do not have to rely on that.** Override the whole domain and the region
stops mattering:

```
# dnsmasq / Pi-hole / AdGuard Home
address=/marstekcloud.com/192.168.x.y
address=/hamedata.com/192.168.x.y
```

If your battery ignores your DNS server (some devices hardcode one), use a
firewall rule instead: DNAT anything from the battery's IP on ports 443 and 80
to the container.

Either way the battery must be able to *reach* the container — if it sits in an
isolated VLAN, allow that one route.

## Check that it worked

```
docker compose logs -f
```

Within a few minutes you should see:

```
2026-08-25T… ACCEPT https POST api-eu.marstekcloud.com/data-upload/v1/venus/HMG-… from 192.168.x.z
```

Then watch the dropouts stop. Everything the device sent is in
`./data/requests-YYYY-MM-DD.jsonl`, one JSON object per request — which also
means you now have your own telemetry, locally.

## The clock, and reading what your battery sent

The device polls a time endpoint every ~20 seconds. This container answers it,
so the battery sets its real-time clock from your machine instead of from a
cloud it cannot reach.

The reply is byte-for-byte what the real endpoint returns:

```
_2026_08_25_07_24_29_04_0_0_0
```

`HTTP_ParseServerDateTime_UpdateRTC` finds the underscore and reads fixed
offsets from it — year, month, day, hour, minute, second — ignoring the
separators. The four trailing fields stay constant while the time advances, so
they are parameters rather than time values; they are mirrored verbatim rather
than invented, because the firmware reads something from that region
(`HexChar_To_TimeOffsetIndex`) and guessing there would be reckless. Override
with `TIME_SUFFIX` if you ever learn what they mean.

**The real server answers in UTC**, and so does this one. Set `TIME_LOCAL=1` if
you would rather have the battery's clock — and any schedules it runs — on your
wall-clock time. `TZ` then selects which one that is.

Turn the whole thing off with `ANSWER_TIME=0` if you would rather not have the
container setting your device's clock.

Console lines carry local wall-clock time (whatever `TZ` says), so they line up
with your other logs. The JSONL keeps ISO-8601 UTC, which stays unambiguous for
machines — do not compare the two by eye without accounting for the offset.

Everything the device uploads lands in `data/requests-YYYY-MM-DD.jsonl`. To read
it:

```
./decode.py            # newest upload, decoded
./decode.py --raw      # including the keys nobody has identified yet
./decode.py --all      # every upload in the file
```

Only fields confirmed against a second source (the same device read over Modbus
at the same moment) are given a meaning; the rest is printed raw rather than
guessed at. Device ID, serial and IP are redacted unless you pass `--no-redact`.
Field reference and method:
<https://github.com/sphings79/marstek_venus_modbus_dev/issues/2>

## The MQTT probe

The device also keeps an MQTT session with AWS IoT, and **this endpoint cannot
serve it**: that path verifies the broker's certificate against a CA stored in
flash and presents a client certificate of its own. Faking it would need the AWS
signing key, which is the whole point of a certificate.

What the container does instead is diagnostic. Point the broker's hostname at
this machine and every connection attempt is logged, with a timestamp and the
SNI from the TLS ClientHello:

```
2026-08-25 08:58:40 MQTT   tcp  CONNECT :8883 from 192.168.x.z (1576 B, sni a40…iot.eu-west-3.amazonaws.com)
```

That answers a question the HTTP side cannot: **is MQTT what disturbs your
network every N minutes?** If those log lines line up with dropouts you are
measuring, you have the culprit. If nothing ever connects, MQTT is not involved
and you can look elsewhere.

The listener never completes a handshake — it reads what arrives, logs it and
closes. A quick refusal is also the friendlier answer if a stalled handshake is
what blocks the device's network stack in the first place.

Set `MQTT_PORT=0` to switch it off.

## What it does not do

- **MQTT is not served, only observed.** That path uses `Authmode 2` with a CA
  chain *and* a client certificate (`mbedTLS_SSL_Connection_Init`). It cannot be
  answered without the signing key, and this container makes no attempt to — see
  the MQTT probe above.
- **Other endpoints are logged, not answered.** Requests that are not the
  telemetry upload get a 404. Pretending to be an endpoint whose expected reply
  nobody has reverse-engineered could change device behaviour in untested ways —
  time sync and tariff policies come from those URLs. Watch the log first and
  decide deliberately. `ACCEPT_ALL=1` answers everything with `{"code":0}` if
  you want to experiment.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `ACCEPT_ALL` | `0` | answer every path with `{"code":0}` |
| `ANSWER_TIME` | `1` | answer the time endpoint (sets the device's clock) |
| `TIME_LOCAL` | `0` | serve local time instead of UTC (the real server sends UTC) |
| `TIME_SUFFIX` | `04_0_0_0` | trailing fields of the time reply, copied from the real endpoint |
| `TZ` | `UTC` | which local time `TIME_LOCAL=1` means, e.g. `Europe/Berlin` |
| `HTTPS_PORT` | `443` | |
| `HTTP_PORT` | `80` | plain-http hamedata endpoints, logged only |
| `MQTT_PORT` | `8883` | MQTT connection probe, log only; `0` disables |
| `LOG_DIR` | `/data` | one JSONL file per day |
| `CERT_DIR` | `/certs` | certificate and key |
| `MAX_BODY` | `262144` | bytes kept per request |

## Keep it running — this matters more than it looks

The battery keeps unsent telemetry in a ring buffer and counts the records in it.
A record is added every five minutes. Records are removed only when an upload is
answered with `"code":0`.

If **more than one** record is left unconfirmed when a 1800-second timer expires,
the firmware concludes the network path is broken and resets the Ethernet bridge.
During each reset the device is gone from the network for two to three seconds:
no Modbus, not even ICMP. That is the "every 30 minutes my battery drops off"
report you will find in several places. Once the condition is met it tends to
stay met, so the resets continue on a fixed ~1824-second cadence.

Two things follow:

- **Downtime here is not free.** If this container is unreachable while records
  pile up, the device can enter that cycle. Answering the upload reliably is the
  whole job. Use `--restart unless-stopped`, and if the host reboots, check
  afterwards that the container came back.
- **A cold start is not a reliable cure.** The counter lives in regular SRAM with
  no persistence path, so it is zeroed on boot — but on the author's device it
  climbed back above the threshold within about 35 minutes and the cycle resumed.
  Rebooting is worth trying; do not expect it to hold.

None of this is caused by running offline. The same thing happens whenever the
real cloud is unreachable for long enough; a LAN endpoint simply fails less often
than a WAN dependency.

*Status: the reset mechanism itself is read out of the decompiled firmware and is
solid. Why the buffer stays above the threshold on some devices and not others is
still open — the firmware does have a drain path that should empty it. If you run
this container, upload counts from your `/data` logs would genuinely help.*

## A warning worth reading

TLS here is deliberately permissive: versions 1.0–1.2 and `SECLEVEL=0`, because
the device pins an older range in firmware and the exact values were not
resolvable. That is fine for one embedded client on your LAN talking to a server
that holds nothing of value. **Do not expose this container to the internet.**

## Verified how?

The requirements above were read out of the decompiled Control firmware v150 and
then confirmed against a real Venus D on firmware 150 over LAN:

- A POST to `/data-upload/v1/venus/…` is answered with
  `{"code":0,"message":"success","data":null}`. The firmware's own check
  (`FUN_0801774c`: `strstr` for `"code":`, then `atoi` on the next byte) evaluates
  that to 0 — accepted — and the device stops retrying the record.
- The time reply is byte-identical in shape to the real endpoint's. Both were
  queried in the same second and compared:
  `_2026_08_25_07_23_25_04_0_0_0`, in UTC.
- The region actually used by the device (`eu`) was observed on the wire rather
  than assumed.
- TLS 1.0, 1.1 and 1.2 handshakes all succeed; the device presents no client
  certificate on this path and validates nothing, matching `Authmode 0` in
  `HTTPS_TLS_Session_Init`.

What is **not** verified is the effect described under "Keep it running" on any
device other than the author's. If you run this, a log covering a few hours of
pings would be welcome in an issue.
