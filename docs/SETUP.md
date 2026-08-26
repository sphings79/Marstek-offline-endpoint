# Setting this up from scratch

**Deutsch: [SETUP.de.md](SETUP.de.md)**

This guide assumes you have never used Docker, never used a Raspberry Pi, and
have never edited a DNS entry. Every command can be copied and pasted. If you
already run Docker somewhere, skip to [step 4](#step-4--install-docker).

Roughly 45 minutes, most of it waiting for downloads.

---

## What you need

- **A Raspberry Pi**, model 3B or newer. Anything that stays on works — an old
  laptop, a NAS with Docker, a mini PC. The container answers about twenty
  requests an hour, so performance is irrelevant.
- **An SD card**, 8 GB or larger, and a way to write it.
- **A wired network connection** for the Pi. WiFi works, but this thing needs to
  be reachable all the time and cable is one less thing to fail.
- **A DNS server you control** — Pi-hole, AdGuard Home, a Fritz!Box, OPNsense,
  anything where you can say "this hostname points at that address". If you have
  none, you can install AdGuard Home on the same Pi later.
- Your **Marstek Venus on the same network**, reachable by IP.

You do **not** need to open anything to the internet, change anything on the
battery, or flash any firmware.

---

## Step 1 — Put Raspberry Pi OS on the SD card

1. Download **Raspberry Pi Imager** from <https://www.raspberrypi.com/software/>
   and install it.
2. Insert the SD card.
3. In the Imager:
   - **Raspberry Pi Device** — pick your model.
   - **Operating System** → *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite
     (64-bit)**. "Lite" means no desktop, which is what you want.
   - **Storage** — your SD card. Check twice; it gets erased.
4. Click **Next**, then **Edit Settings** when it offers to customise:
   - **Hostname**: `marstek-endpoint`
   - **Username and password**: pick something and *write it down*.
   - **Configure wireless LAN**: only if you cannot use a cable.
   - **Locale**: your timezone, e.g. `Europe/Berlin`.
   - **Services** tab → tick **Enable SSH** → *Use password authentication*.
5. Save, confirm, and let it write. Takes a few minutes.

Put the card in the Pi, plug in the network cable, then power.

---

## Step 2 — Log in

Give it a minute to boot, then from your own computer open a terminal
(macOS: Terminal; Windows: PowerShell) and:

```bash
ssh pi@marstek-endpoint.local
```

Replace `pi` with the username you chose. Say `yes` to the fingerprint question,
then enter your password.

If `.local` does not resolve, find the Pi's address in your router's list of
connected devices and use that instead: `ssh pi@192.168.1.60`.

Once you see a prompt ending in `$`, you are in.

---

## Step 3 — Give the Pi a fixed address

Your DNS entries will point at this machine, so its address must not change.

**The easy way** is a DHCP reservation in your router: find the Pi in the device
list, and tick something like "always assign this address". Done — skip ahead.

**The other way**, on the Pi itself (Raspberry Pi OS Bookworm and newer):

```bash
sudo nmcli con mod "Wired connection 1" \
  ipv4.method manual \
  ipv4.addresses 192.168.1.60/24 \
  ipv4.gateway 192.168.1.1 \
  ipv4.dns 192.168.1.1
```

```bash
sudo nmcli con up "Wired connection 1"
```

Adjust the three addresses to your network: `192.168.1.60` is the address you are
giving the Pi (pick one outside your router's DHCP range), and `192.168.1.1` is
your router. Your SSH session will drop — reconnect to the new address.

Check it took:

```bash
hostname -I
```

**Write this address down.** It is used twice more below.

---

## Step 4 — Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
```

That takes a few minutes. Then allow your user to run Docker without `sudo`, and
make sure Docker itself starts when the Pi boots:

```bash
sudo usermod -aG docker "$USER" && sudo systemctl enable --now docker
```

Log out and back in so the group membership applies:

```bash
exit
```

```bash
ssh pi@marstek-endpoint.local
```

Verify:

```bash
docker run --rm hello-world
```

You should see "Hello from Docker!". If you get a permission error, the logout
did not take — log out and in again.

---

## Step 5 — Start the container

Make a folder for it and start it:

```bash
mkdir -p ~/marstek-offline-endpoint && cd ~/marstek-offline-endpoint
```

```bash
docker run -d --name marstek-offline-endpoint --restart unless-stopped \
  -p 443:443 -p 80:80 \
  -e TZ=Europe/Berlin \
  -v "$PWD/data:/data" -v "$PWD/certs:/certs" \
  ghcr.io/sphings79/marstek-offline-endpoint:latest
```

Change `Europe/Berlin` to your own timezone. **This matters** — the container
sets your battery's clock, and without it the battery ends up on UTC.

Check it started:

```bash
docker logs marstek-offline-endpoint
```

You want to see three "listening" lines and no errors:

```
https listening on :443
http  listening on :80
mqtt probe listening on :8883
```

The first start also generates a self-signed certificate into `./certs`. That is
expected and sufficient — the battery does not verify it.

---

## Step 6 — Make sure it survives a reboot

This is not optional. If the container is missing for long enough, the battery
falls back into the 30-minute cycle.

```bash
sudo reboot
```

Wait a minute, log back in, and check:

```bash
docker ps
```

The container should be listed with a status like `Up 40 seconds`. If it is not
there, Docker did not start at boot — run `sudo systemctl enable docker` and
reboot once more.

---

## Step 7 — Find your battery's address

Look in your router's list of connected devices for something named *Marstek*,
*VenusE*, *VNSD* or similar. Note the IP, e.g. `192.168.1.50`.

Confirm it answers:

```bash
ping -c3 192.168.1.50
```

---

## Step 8 — Point DNS at the Pi

This is the step that actually redirects the battery. You need **two** entries,
each covering a whole domain including subdomains:

| domain | points to |
|---|---|
| `marstekcloud.com` | your Pi, e.g. `192.168.1.60` |
| `hamedata.com` | your Pi, e.g. `192.168.1.60` |

### AdGuard Home

1. Open the AdGuard Home web interface.
2. **Filters → DNS rewrites → Add DNS rewrite.**
3. Add four entries — the bare domain *and* the wildcard, for both domains:

   | Domain | IP |
   |---|---|
   | `marstekcloud.com` | `192.168.1.60` |
   | `*.marstekcloud.com` | `192.168.1.60` |
   | `hamedata.com` | `192.168.1.60` |
   | `*.hamedata.com` | `192.168.1.60` |

That is all — AdGuard applies rewrites immediately.

### Pi-hole

Pi-hole's *Local DNS Records* screen only takes exact hostnames, which is fiddly
here. Use a dnsmasq snippet instead:

```bash
sudo tee /etc/dnsmasq.d/99-marstek.conf >/dev/null <<'EOF'
address=/marstekcloud.com/192.168.1.60
address=/hamedata.com/192.168.1.60
EOF
```

```bash
pihole restartdns
```

(Change `192.168.1.60` to your Pi's address first.)

### Fritz!Box, OPNsense, a plain dnsmasq, something else

Anywhere you can define a "local DNS override" or "host override" for a whole
domain, the same two entries apply. In OPNsense: *Services → Unbound DNS →
Overrides → Domain Overrides*.

### Make sure the battery actually uses that DNS server

Your router hands out a DNS server over DHCP — it must be the one you just
edited. Check your DHCP settings. From another machine on the network you can
confirm the rewrite works:

```bash
nslookup api-eu.marstekcloud.com 192.168.1.60
```

It should answer with your Pi's address, not a public one. (Replace
`192.168.1.60` with your **DNS server's** address if that is a different machine.)

Some devices ignore the DHCP-supplied DNS and use a hardcoded one. If nothing
shows up in the logs later, that is the likely reason — see
[Troubleshooting](#troubleshooting).

---

## Step 9 — Check that the battery is talking to you

Back on the Pi:

```bash
docker logs -f marstek-offline-endpoint
```

Within about five minutes you should see lines like:

```
2026-08-26 08:17:38 TIME   http  GET  eu.hamedata.com/app/neng/getDateInfoeu.php?uid=… (0 B)
2026-08-26 08:19:07 ACCEPT https POST api-eu.marstekcloud.com/data-upload/v1/venus/… (1204 B)
```

`TIME` is the battery asking what time it is. `ACCEPT` is it uploading telemetry
and being told the upload was accepted. Press `Ctrl-C` to stop following.

Two sanity checks:

```bash
docker logs --since 30m marstek-offline-endpoint | grep -c TIME
```

You want roughly **3** — one per ten minutes. If you get 12, the replies are
being rejected; make sure you are on the current image (`docker pull` and
recreate).

```bash
cd ~/marstek-offline-endpoint/data && ls
```

There should be a `requests-YYYY-MM-DD.jsonl` file. That is your telemetry,
staying at home.

---

## Step 10 — Prove the dropouts are gone

Save this as `pingwatch.sh` on any machine that stays on:

```bash
cat > ~/pingwatch.sh <<'EOF'
#!/bin/sh
IP="${1:?usage: pingwatch.sh <ip>}"
F=0
while true; do
  if ping -c1 -W1 "$IP" >/dev/null 2>&1; then
    [ "$F" -gt 0 ] && echo "$(date '+%F %T')  UP    after ${F}s"
    F=0
  else
    [ "$F" -eq 0 ] && echo "$(date '+%F %T')  DOWN"
    F=$((F+1))
  fi
  sleep 1
done
EOF
chmod +x ~/pingwatch.sh
```

Run it in the background and let it write to a file:

```bash
nohup ~/pingwatch.sh 192.168.1.50 > ~/pingwatch.log 2>&1 &
```

Come back in two hours:

```bash
cat ~/pingwatch.log
```

**Empty is the goal.** Before the fix you would see a `DOWN` every 30 minutes,
lasting two to three seconds.

If entries are still appearing at 30-minute intervals, the buffer inside the
battery has not drained yet. Give it another hour — on the measured device it
took about 45 minutes from the first accepted upload.

---

## Troubleshooting

**Nothing at all in the log after 15 minutes.**
The battery is not resolving to your Pi. Check `nslookup` from step 8. If that
looks right, the battery may be caching an old answer or ignoring your DNS
server — power-cycle the battery and wait five minutes. Still nothing? Your
battery has a hardcoded DNS server. Add a firewall rule that redirects traffic
from the battery's IP on ports 443 and 80 to the Pi (DNAT).

**`TIME` lines appear but no `ACCEPT`.**
`hamedata.com` is redirected but `marstekcloud.com` is not. Re-check that second
DNS entry, including the wildcard.

**Four `TIME` lines in a row, 20 seconds apart, every ten minutes.**
The battery is rejecting the reply. You are on an old image:

```bash
cd ~/marstek-offline-endpoint && docker stop marstek-offline-endpoint && docker rm marstek-offline-endpoint && docker pull ghcr.io/sphings79/marstek-offline-endpoint:latest
```

then run the `docker run` command from step 5 again.

**Uploads arrive exactly every 86 seconds.**
Normal for a while. The backlog inside the battery is above three, so the
firmware is throttling itself. It clears as the buffer drains — check again in
an hour.

**`port is already allocated`.**
Something else on the Pi uses 443 or 80. If that is a web interface you need,
put the endpoint on a different machine — the ports are not negotiable, the
battery connects to 443 and 80.

**The container is gone after a reboot.**

```bash
sudo systemctl enable docker && sudo reboot
```

**Starting over.**

```bash
docker stop marstek-offline-endpoint && docker rm marstek-offline-endpoint
```

then the `docker run` from step 5 again. Your data and certificate survive in
`~/marstek-offline-endpoint`.

---

## Undoing all of it

1. Remove the DNS entries you added (AdGuard rewrites, or delete
   `/etc/dnsmasq.d/99-marstek.conf` and `pihole restartdns`).
2. Stop the container:

   ```bash
   docker stop marstek-offline-endpoint && docker rm marstek-offline-endpoint
   ```

The battery goes back to talking to Marstek's cloud, and to dropping off the
network every 30 minutes if it cannot reach it. Nothing on the device was
changed, so there is nothing on it to undo.

---

---

## Reading the battery in Home Assistant

This container keeps the battery on the network. To actually read it — power,
state of charge, per-cell voltages — you want the Modbus integration:
**<https://github.com/sphings79/marstek_venus_modbus_dev>**

---

## Keeping it updated

```bash
cd ~/marstek-offline-endpoint && docker stop marstek-offline-endpoint && docker rm marstek-offline-endpoint && docker pull ghcr.io/sphings79/marstek-offline-endpoint:latest
```

then the `docker run` command from step 5 again. Data and certificate are in the
mounted folders and survive.
