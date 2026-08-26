# Einrichtung von Grund auf

**English: [SETUP.md](SETUP.md)**

Diese Anleitung geht davon aus, dass du noch nie Docker benutzt hast, noch nie
einen Raspberry Pi eingerichtet und noch nie einen DNS-Eintrag angefasst hast.
Jeder Befehl lässt sich kopieren und einfügen. Wenn du Docker schon irgendwo
laufen hast, spring direkt zu [Schritt 4](#schritt-4--docker-installieren).

Etwa 45 Minuten, das meiste davon Warten auf Downloads.

---

## Was du brauchst

- **Einen Raspberry Pi**, Modell 3B oder neuer. Es geht alles, was dauerhaft
  läuft — ein alter Laptop, ein NAS mit Docker, ein Mini-PC. Der Container
  beantwortet rund zwanzig Anfragen pro Stunde, Leistung spielt also keine Rolle.
- **Eine SD-Karte**, 8 GB oder größer, und eine Möglichkeit, sie zu beschreiben.
- **Einen Netzwerkanschluss per Kabel** für den Pi. WLAN geht auch, aber das Ding
  muss dauerhaft erreichbar sein, und Kabel ist eine Fehlerquelle weniger.
- **Einen DNS-Server, den du kontrollierst** — Pi-hole, AdGuard Home, eine
  Fritz!Box, OPNsense, irgendetwas, wo du sagen kannst: „dieser Hostname zeigt auf
  jene Adresse". Hast du keinen, kannst du AdGuard Home später auf denselben Pi
  installieren.
- Deinen **Marstek Venus im selben Netz**, über seine IP erreichbar.

Du musst **nichts** ins Internet öffnen, **nichts** an der Batterie umstellen und
keine Firmware aufspielen.

---

## Schritt 1 — Raspberry Pi OS auf die SD-Karte

1. Lade den **Raspberry Pi Imager** von <https://www.raspberrypi.com/software/>
   und installiere ihn.
2. SD-Karte einstecken.
3. Im Imager:
   - **Raspberry-Pi-Gerät** — dein Modell auswählen.
   - **Betriebssystem** → *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite
     (64-bit)**. „Lite" heißt ohne Desktop, und genau das willst du.
   - **SD-Karte** — deine Karte. Zweimal hinschauen, sie wird gelöscht.
4. Auf **Weiter** klicken und dann **Einstellungen bearbeiten**, wenn er es
   anbietet:
   - **Hostname**: `marstek-endpoint`
   - **Benutzername und Passwort**: frei wählen und *aufschreiben*.
   - **WLAN einrichten**: nur, wenn du kein Kabel legen kannst.
   - **Spracheinstellungen**: deine Zeitzone, z. B. `Europe/Berlin`.
   - Reiter **Dienste** → **SSH aktivieren** ankreuzen → *Passwort zur
     Anmeldung verwenden*.
5. Speichern, bestätigen, schreiben lassen. Dauert ein paar Minuten.

Karte in den Pi, Netzwerkkabel anstecken, dann Strom.

---

## Schritt 2 — Anmelden

Gib ihm eine Minute zum Starten. Dann an deinem eigenen Rechner ein Terminal
öffnen (macOS: Terminal; Windows: PowerShell) und:

```bash
ssh pi@marstek-endpoint.local
```

`pi` durch deinen gewählten Benutzernamen ersetzen. Die Frage nach dem
Fingerabdruck mit `yes` beantworten, dann das Passwort eingeben.

Falls `.local` nicht auflöst, such die Adresse des Pi in der Geräteliste deines
Routers und nimm die: `ssh pi@192.168.1.60`.

Sobald eine Eingabezeile mit `$` am Ende erscheint, bist du drin.

---

## Schritt 3 — Dem Pi eine feste Adresse geben

Deine DNS-Einträge zeigen auf diesen Rechner, seine Adresse darf sich also nicht
ändern.

**Der einfache Weg** ist eine feste Zuordnung im Router: Pi in der Geräteliste
suchen und so etwas wie „immer diese Adresse zuweisen" ankreuzen. Fertig —
weiter zum nächsten Schritt.

**Der andere Weg**, direkt auf dem Pi (Raspberry Pi OS Bookworm und neuer):

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

Pass die drei Adressen an dein Netz an: `192.168.1.60` ist die Adresse, die du
dem Pi gibst (nimm eine außerhalb des DHCP-Bereichs deines Routers), und
`192.168.1.1` ist dein Router. Deine SSH-Sitzung bricht ab — verbinde dich mit
der neuen Adresse neu.

Nachsehen, ob es gegriffen hat:

```bash
hostname -I
```

**Schreib dir diese Adresse auf.** Sie kommt unten noch zweimal vor.

---

## Schritt 4 — Docker installieren

```bash
curl -fsSL https://get.docker.com | sudo sh
```

Das dauert ein paar Minuten. Danach deinem Benutzer erlauben, Docker ohne `sudo`
zu bedienen — und dafür sorgen, dass Docker beim Booten startet:

```bash
sudo usermod -aG docker "$USER" && sudo systemctl enable --now docker
```

Ab- und wieder anmelden, damit die Gruppenzugehörigkeit greift:

```bash
exit
```

```bash
ssh pi@marstek-endpoint.local
```

Probe:

```bash
docker run --rm hello-world
```

Es sollte „Hello from Docker!" erscheinen. Kommt ein Rechtefehler, hat die Ab-
und Anmeldung nicht gegriffen — noch einmal.

---

## Schritt 5 — Container starten

Ordner anlegen und starten:

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

`Europe/Berlin` auf deine Zeitzone anpassen. **Das ist wichtig** — der Container
stellt die Uhr deiner Batterie, und ohne die Angabe landet sie auf UTC.

Nachsehen, ob er läuft:

```bash
docker logs marstek-offline-endpoint
```

Du willst drei „listening"-Zeilen sehen und keine Fehler:

```
https listening on :443
http  listening on :80
mqtt probe listening on :8883
```

Beim ersten Start wird außerdem ein selbstsigniertes Zertifikat nach `./certs`
erzeugt. Das ist so gewollt und reicht — die Batterie prüft es nicht.

---

## Schritt 6 — Neustartfest machen

Das ist nicht optional. Fehlt der Container lange genug, fällt die Batterie in
den 30-Minuten-Takt zurück.

```bash
sudo reboot
```

Eine Minute warten, neu anmelden, nachsehen:

```bash
docker ps
```

Der Container muss dort stehen, mit einem Status wie `Up 40 seconds`. Fehlt er,
ist Docker nicht beim Booten gestartet — dann `sudo systemctl enable docker` und
noch einmal neu starten.

---

## Schritt 7 — Die Adresse deiner Batterie finden

Schau in der Geräteliste deines Routers nach etwas, das *Marstek*, *VenusE*,
*VNSD* oder ähnlich heißt. Notier die IP, z. B. `192.168.1.50`.

Prüfen, ob sie antwortet:

```bash
ping -c3 192.168.1.50
```

---

## Schritt 8 — DNS auf den Pi zeigen lassen

Das ist der Schritt, der die Batterie tatsächlich umleitet. Du brauchst **zwei**
Einträge, jeder für eine ganze Domain samt Unterdomains:

| Domain | zeigt auf |
|---|---|
| `marstekcloud.com` | deinen Pi, z. B. `192.168.1.60` |
| `hamedata.com` | deinen Pi, z. B. `192.168.1.60` |

### AdGuard Home

1. Web-Oberfläche von AdGuard Home öffnen.
2. **Filter → DNS-Umschreibungen → DNS-Umschreibung hinzufügen.**
3. Vier Einträge anlegen — jeweils die nackte Domain **und** den Platzhalter:

   | Domain | IP |
   |---|---|
   | `marstekcloud.com` | `192.168.1.60` |
   | `*.marstekcloud.com` | `192.168.1.60` |
   | `hamedata.com` | `192.168.1.60` |
   | `*.hamedata.com` | `192.168.1.60` |

Mehr ist nicht nötig, AdGuard übernimmt Umschreibungen sofort.

### Pi-hole

Die Maske *Local DNS Records* nimmt nur exakte Hostnamen, was hier umständlich
ist. Nimm stattdessen einen dnsmasq-Schnipsel:

```bash
sudo tee /etc/dnsmasq.d/99-marstek.conf >/dev/null <<'EOF'
address=/marstekcloud.com/192.168.1.60
address=/hamedata.com/192.168.1.60
EOF
```

```bash
pihole restartdns
```

(Vorher `192.168.1.60` durch die Adresse deines Pi ersetzen.)

### Fritz!Box, OPNsense, dnsmasq, anderes

Überall, wo sich eine „lokale DNS-Überschreibung" oder ein „Host Override" für
eine ganze Domain anlegen lässt, gelten dieselben zwei Einträge. In OPNsense:
*Services → Unbound DNS → Overrides → Domain Overrides*.

### Sicherstellen, dass die Batterie diesen DNS-Server auch benutzt

Dein Router verteilt per DHCP einen DNS-Server — und das muss der sein, den du
gerade bearbeitet hast. Schau in die DHCP-Einstellungen. Von einem anderen
Rechner im Netz kannst du die Umschreibung prüfen:

```bash
nslookup api-eu.marstekcloud.com 192.168.1.60
```

Es muss die Adresse deines Pi zurückkommen, keine öffentliche. (Ersetze
`192.168.1.60` durch die Adresse deines **DNS-Servers**, falls das ein anderer
Rechner ist.)

Manche Geräte ignorieren den per DHCP verteilten DNS und nutzen einen fest
eingebauten. Wenn später gar nichts im Log auftaucht, ist das der wahrscheinliche
Grund — siehe [Wenn etwas nicht klappt](#wenn-etwas-nicht-klappt).

---

## Schritt 9 — Prüfen, ob die Batterie mit dir spricht

Zurück auf dem Pi:

```bash
docker logs -f marstek-offline-endpoint
```

Innerhalb von etwa fünf Minuten sollten Zeilen erscheinen wie:

```
2026-08-26 08:17:38 TIME   http  GET  eu.hamedata.com/app/neng/getDateInfoeu.php?uid=… (0 B)
2026-08-26 08:19:07 ACCEPT https POST api-eu.marstekcloud.com/data-upload/v1/venus/… (1204 B)
```

`TIME` ist die Batterie, die nach der Uhrzeit fragt. `ACCEPT` ist der
Telemetrie-Upload, dem bestätigt wird, dass er angekommen ist. Mit `Strg-C`
beendest du die Ausgabe.

Zwei Kontrollen:

```bash
docker logs --since 30m marstek-offline-endpoint | grep -c TIME
```

Erwartet werden rund **3** — eine pro zehn Minuten. Kommen 12, werden die
Antworten abgelehnt; dann stell sicher, dass du das aktuelle Image hast
(`docker pull` und neu anlegen).

```bash
cd ~/marstek-offline-endpoint/data && ls
```

Dort muss eine Datei `requests-YYYY-MM-TT.jsonl` liegen. Das ist deine
Telemetrie — und sie bleibt zu Hause.

---

## Schritt 10 — Nachweisen, dass die Ausfälle weg sind

Speicher das als `pingwatch.sh` auf einem Rechner, der durchläuft:

```bash
cat > ~/pingwatch.sh <<'EOF'
#!/bin/sh
IP="${1:?Aufruf: pingwatch.sh <ip>}"
F=0
while true; do
  if ping -c1 -W1 "$IP" >/dev/null 2>&1; then
    [ "$F" -gt 0 ] && echo "$(date '+%F %T')  WIEDER DA nach ${F}s"
    F=0
  else
    [ "$F" -eq 0 ] && echo "$(date '+%F %T')  WEG"
    F=$((F+1))
  fi
  sleep 1
done
EOF
chmod +x ~/pingwatch.sh
```

Im Hintergrund starten und in eine Datei schreiben lassen:

```bash
nohup ~/pingwatch.sh 192.168.1.50 > ~/pingwatch.log 2>&1 &
```

Nach zwei Stunden nachsehen:

```bash
cat ~/pingwatch.log
```

**Leer ist das Ziel.** Vorher stand dort alle 30 Minuten ein `WEG`, jeweils zwei
bis drei Sekunden lang.

Kommen weiterhin Einträge im 30-Minuten-Abstand, ist der Puffer in der Batterie
noch nicht leergelaufen. Gib ihr noch eine Stunde — beim gemessenen Gerät
dauerte es rund 45 Minuten ab dem ersten angenommenen Upload.

---

## Wenn etwas nicht klappt

**Nach 15 Minuten steht gar nichts im Log.**
Die Batterie landet nicht bei deinem Pi. Prüf den `nslookup` aus Schritt 8. Sieht
der richtig aus, hat die Batterie womöglich eine alte Antwort gespeichert oder
ignoriert deinen DNS-Server — Batterie stromlos machen, wieder einschalten, fünf
Minuten warten. Immer noch nichts? Dann hat sie einen fest eingebauten
DNS-Server. Leg eine Firewall-Regel an, die Verkehr von der Batterie-IP auf Port
443 und 80 auf den Pi umbiegt (DNAT).

**`TIME`-Zeilen kommen, aber kein `ACCEPT`.**
`hamedata.com` ist umgeleitet, `marstekcloud.com` nicht. Prüf den zweiten
DNS-Eintrag, samt Platzhalter.

**Vier `TIME`-Zeilen hintereinander im 20-Sekunden-Abstand, alle zehn Minuten.**
Die Batterie lehnt die Antwort ab. Du hast ein altes Image:

```bash
cd ~/marstek-offline-endpoint && docker stop marstek-offline-endpoint && docker rm marstek-offline-endpoint && docker pull ghcr.io/sphings79/marstek-offline-endpoint:latest
```

danach den `docker run`-Befehl aus Schritt 5 erneut ausführen.

**Uploads kommen exakt alle 86 Sekunden.**
Eine Weile normal. Der Rückstau in der Batterie liegt über drei, die Firmware
drosselt sich selbst. Das gibt sich, während der Puffer leerläuft — schau in
einer Stunde noch einmal.

**`port is already allocated`.**
Auf dem Pi belegt schon etwas Port 443 oder 80. Brauchst du diese Oberfläche,
setz den Endpunkt auf einen anderen Rechner — die Ports sind nicht verhandelbar,
die Batterie verbindet sich auf 443 und 80.

**Nach einem Neustart ist der Container weg.**

```bash
sudo systemctl enable docker && sudo reboot
```

**Noch einmal von vorn.**

```bash
docker stop marstek-offline-endpoint && docker rm marstek-offline-endpoint
```

danach wieder der `docker run` aus Schritt 5. Deine Daten und das Zertifikat
bleiben in `~/marstek-offline-endpoint` erhalten.

---

## Alles rückgängig machen

1. Die angelegten DNS-Einträge entfernen (AdGuard-Umschreibungen löschen, oder
   `/etc/dnsmasq.d/99-marstek.conf` löschen und `pihole restartdns`).
2. Container stoppen:

   ```bash
   docker stop marstek-offline-endpoint && docker rm marstek-offline-endpoint
   ```

Die Batterie spricht dann wieder mit der Marstek-Cloud — und fällt wieder alle 30
Minuten aus dem Netz, wenn sie diese nicht erreicht. Am Gerät selbst wurde nichts
verändert, es gibt dort also auch nichts rückgängig zu machen.

---

## Aktuell halten

```bash
cd ~/marstek-offline-endpoint && docker stop marstek-offline-endpoint && docker rm marstek-offline-endpoint && docker pull ghcr.io/sphings79/marstek-offline-endpoint:latest
```

danach wieder der `docker run`-Befehl aus Schritt 5. Daten und Zertifikat liegen
in den eingehängten Ordnern und bleiben erhalten.
