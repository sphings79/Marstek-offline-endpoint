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

## What it does not do

- **MQTT is untouched.** That path uses `Authmode 2` with a CA chain *and* a
  client certificate (`mbedTLS_SSL_Connection_Init`). It cannot be answered this
  way, and this container makes no attempt to.
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
| `HTTPS_PORT` | `443` | |
| `HTTP_PORT` | `80` | plain-http hamedata endpoints, logged only |
| `LOG_DIR` | `/data` | one JSONL file per day |
| `CERT_DIR` | `/certs` | certificate and key |
| `MAX_BODY` | `262144` | bytes kept per request |

## A warning worth reading

TLS here is deliberately permissive: versions 1.0–1.2 and `SECLEVEL=0`, because
the device pins an older range in firmware and the exact values were not
resolvable. That is fine for one embedded client on your LAN talking to a server
that holds nothing of value. **Do not expose this container to the internet.**

## Verified how?

The two requirements above were read out of the decompiled Control firmware
v150, and the server was tested against them: a POST to
`/data-upload/v1/venus/…` is answered with `{"code":0,"msg":"ok"}`, the
firmware's own check (`strstr` for `"code":` then `atoi` on the next byte)
evaluates that to 0 — accepted — and TLS 1.0, 1.1 and 1.2 handshakes all
succeed. What has **not** been tested at the time of writing is a real battery
talking to it; if you get there first, an issue with your log would be welcome.

---

Unofficial community tool. Not affiliated with Marstek. Use at your own risk.
