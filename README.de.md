# Marstek Offline Endpoint

**English: [README.md](README.md) · Schritt-für-Schritt-Anleitung: [docs/SETUP.de.md](docs/SETUP.de.md) ([english](docs/SETUP.md))**

Ein kleiner Container für deinen Heimserver, der den Telemetrie-Upload
beantwortet, den eine **Marstek-Venus**-Batterie erwartet — Venus E, Venus D,
Venus E v3. Die Batterie hört auf, alle halbe Stunde ihren eigenen Netzwerkchip
zurückzusetzen, Modbus TCP bleibt stehen, und keiner deiner Messwerte verlässt
dein Netz.

![Vorher und nachher: alle 1824 Sekunden ein Ausfall, danach sieben Stunden keiner](docs/img/result.svg)

Gemessen an einem Venus D mit Control-Firmware v150 über LAN, am 26. August 2026.
Vorher verschwand die Batterie im 30-Minuten-Takt aus dem Netz. Danach sieben
Stunden lang kein einziges Mal — und der Upload pendelte sich auf exakt 300
Sekunden ein, einen pro Datensatz. Genau so sieht ein leerer Puffer aus.

## Ist das dein Problem?

- Dein Marstek Venus **verschwindet alle 30 Minuten für ein paar Sekunden aus dem
  Netz** und ist danach wieder da
- Home Assistant zeigt die Batterie in festem Takt als *nicht verfügbar*, und ein
  Neuladen oder Neustart hilft für eine Weile
- Modbus TCP läuft regelmäßig in Timeouts — `Cannot connect to Modbus device at
  …:502`, `Timeout writing to register 0xA410`, `No response received after 0
  retries`
- Sogar **Ping** zur Batterie bleibt zwei bis fünf Sekunden aus
- Es fing nach dem Update auf Firmware **v150** an, oder es tritt auf, sobald die
  Batterie kein Internet erreicht

Wenn ja: Es liegt weder an deinem Netz noch an deinem Switch noch an deiner
Modbus-Integration. Es ist die Firmware der Batterie — und das hier stoppt sie.

## Das Problem

![Wie der Firmware-Watchdog arbeitet](docs/img/how-it-works.svg)

Ab Control-Firmware **v150** puffert das Gerät Telemetrie-Datensätze und lädt sie
in die Marstek-Cloud. Wird der Puffer dabei nicht geleert, setzt die Firmware
**ihren eigenen Netzwerkchip per Hardware zurück**, auf einem festen Timer:

| | Ethernet (CH395) | WLAN (FC41D) |
|---|---|---|
| Timer | 1800 s (30 min) | 900 s (15 min) |
| nötiger Rückstau | mehr als 1 Datensatz | jeder Datensatz |

Während der Chip im Reset ist, ist er schlicht weg — Modbus-TCP-Sitzungen
sterben, Ping antwortet nicht mehr, und zwei bis drei Sekunden später ist alles
wieder da. Immer wieder, auf die Sekunde. **WLAN ist dabei die härtere Variante,
nicht die mildere** — ein Wechsel des Anschlusses hilft also nicht.

Wer seine Batterie vom Internet fernhält, bekommt genau das.

Vollständige Analyse mit Firmware-Adressen, Bedingungen und Aufrufkette:
<https://github.com/sphings79/marstek_venus_modbus_dev/issues/2>

## Was dieser Container macht

![Zwei DNS-Einträge schicken die Batterie auf deinen eigenen Rechner](docs/img/network.svg)

Zwei DNS-Einträge lenken die Batterie auf deinen Rechner. Der Container
beantwortet, worauf die Firmware wartet, der Rückstau entsteht gar nicht erst,
und der Reset bleibt aus. **An der Batterie wird nichts verändert** — keine
Einstellung, keine Firmware.

Als Nebeneffekt bekommst du deine Telemetrie lokal: rund siebzig Felder pro
Upload, in einer JSONL-Datei, die dir gehört.

## Schnellstart

Es gibt ein fertiges Image für **amd64, 386, arm64, armv7 und armv6** — also für
einen normalen Server, ein altes 32-bit-Notebook, ein NAS oder jeden Raspberry Pi
bis hinunter zum Zero. Ein 3B reicht völlig; das Ding beantwortet eine Handvoll
Anfragen pro Stunde.

```bash
docker run -d --name marstek-offline-endpoint --restart unless-stopped \
  -p 443:443 -p 80:80 \
  -e TZ=Europe/Berlin \
  -v "$PWD/data:/data" -v "$PWD/certs:/certs" \
  ghcr.io/sphings79/marstek-offline-endpoint:latest
```

`--restart unless-stopped` bringt den Container nach einem Neustart von selbst
zurück, sofern Docker selbst beim Booten startet (`sudo systemctl enable docker`).
**Setz `TZ`** — der echte Endpunkt antwortet in der Lokalzeit des Geräts, und
ohne `TZ` ist die Lokalzeit des Containers UTC.

Alternativ mit Compose: `docker-compose.yml` aus diesem Repo kopieren und
`docker compose up -d`.

Die Ports 443 und 80 müssen auf dem Host frei sein. Beim ersten Start wird ein
selbstsigniertes Zertifikat nach `./certs` erzeugt; löschen erzeugt ein neues.

**Noch nie gemacht?** [docs/SETUP.de.md](docs/SETUP.de.md) führt dich von der
leeren SD-Karte an durch alles: Raspberry Pi OS aufspielen, feste Adresse,
Docker installieren, die DNS-Einträge in Pi-hole und AdGuard Home, und wie du
nachweist, dass es funktioniert hat.

## DNS umbiegen

Die Upload-URL lautet in der Firmware
`https://api-%s.marstekcloud.com/data-upload/v1/venus/%s`, wobei `%s` ein
Regionskürzel ist; der Zeitendpunkt liegt auf `eu.hamedata.com`. Wenn du die
ganzen Domains umbiegst, spielt die Region keine Rolle mehr:

```
# dnsmasq / Pi-hole / AdGuard Home
address=/marstekcloud.com/192.168.x.y
address=/hamedata.com/192.168.x.y
```

Ignoriert deine Batterie den eigenen DNS-Server, nimm stattdessen eine
Firewall-Regel: alles von der Batterie-IP auf Port 443 und 80 per DNAT auf den
Container. In beiden Fällen muss die Batterie den Container **erreichen** können
— steht sie in einem abgeschotteten VLAN, gib diese eine Route frei.

**Den MQTT-Broker bitte nicht umleiten.** Warum, steht unter
[Was er nicht kann](#was-er-nicht-kann).

## Prüfen, ob es geklappt hat

```bash
docker logs -f marstek-offline-endpoint
```

Innerhalb weniger Minuten solltest du eine Zeitabfrage und einen Upload sehen:

```
2026-08-26 08:17:38 TIME   http GET eu.hamedata.com/app/neng/getDateInfoeu.php?uid=… (0 B)
2026-08-26 08:19:07 ACCEPT https POST api-eu.marstekcloud.com/data-upload/v1/venus/… (1204 B)
```

Zwei Zahlen verraten dir, ob es läuft:

- **Zeitabfragen: eine pro rund 600 Sekunden.** Vier Stück im 20-Sekunden-Abstand
  heißen, die Antwort wird abgelehnt — siehe
  [Wie wir es gefunden haben](docs/HOW-WE-FOUND-IT.md).
- **Uploads: etwa einer pro 300 Sekunden, unregelmäßig.** Ein starres
  86-Sekunden-Raster heißt, der Rückstau liegt über drei und die Firmware
  drosselt. Das löst sich innerhalb ein bis zwei Stunden von selbst, während der
  Puffer leerläuft.

Danach beobachtest du die Batterie selbst. Diese Schleife gibt nur dann eine
Zeile aus, wenn ein Ping verloren geht — und genau so sieht ein Chip-Reset von
außen aus:

```bash
IP=192.168.1.50; F=0
while true; do
  if ping -c1 -W1 "$IP" >/dev/null 2>&1; then
    [ $F -gt 0 ] && echo "$(date '+%F %T')  WIEDER DA nach ${F}s"; F=0
  else
    [ $F -eq 0 ] && echo "$(date '+%F %T')  WEG"; F=$((F+1))
  fi
  sleep 1
done
```

Zwei ruhige Halbstunden-Fenster, und die Sache ist erledigt.

## Die Uhr

Das Gerät fragt alle rund 600 Sekunden einen Zeitendpunkt ab. Der Container
beantwortet ihn, die Batterie stellt ihre Echtzeituhr also nach deinem Rechner
statt nach einer Cloud, die sie nicht erreicht. Die Antwort ist byte-genau die,
die der echte Endpunkt liefert:

```
_2026_08_26_08_24_29_04_0_0_0
```

`HTTP_ParseServerDateTime_UpdateRTC` sucht den Unterstrich und liest danach feste
Offsets — Jahr, Monat, Tag, Stunde, Minute, Sekunde —, die Trennzeichen
ignoriert sie. Die vier hinteren Felder bleiben konstant, während die Zeit
weiterläuft; es sind also Parameter, keine Zeitwerte. Sie werden wörtlich
übernommen statt erfunden, weil die Firmware aus dieser Gegend etwas liest
(`HexChar_To_TimeOffsetIndex`) und Raten dort fahrlässig wäre. Mit `TIME_SUFFIX`
überschreibbar, falls jemand herausfindet, was sie bedeuten.

**Der echte Server antwortet in der Lokalzeit des Geräts**, dieser also auch.
Nachgemessen, indem eine echte Antwort durch den Container durchgereicht wurde:
Ihr `Date`-Kopf sagte `20:05:42 GMT`, der Rumpf `_2026_08_25_22_05_42_…` — zwei
Stunden voraus, also CEST. Deshalb `TZ` setzen. `TIME_LOCAL=0` erzwingt UTC, und
`ANSWER_TIME=0` hält den Container ganz von der Uhr deines Geräts fern.

Die Konsolenzeilen tragen lokale Uhrzeit, die JSONL bleibt bei ISO-8601 in UTC —
für Maschinen eindeutig. Vergleich die beiden nicht mit bloßem Auge, ohne den
Versatz mitzudenken.

## Deine Telemetrie lesen

Alles, was das Gerät hochlädt, landet in `data/requests-YYYY-MM-DD.jsonl`:

```bash
./decode.py            # neuester Upload, dekodiert
./decode.py --raw      # samt der Schlüssel, die noch niemand zugeordnet hat
./decode.py --all      # jeder Upload in der Datei
```

Eine Bedeutung bekommt nur, was gegen eine zweite Quelle bestätigt wurde — dasselbe
Gerät im selben Moment über Modbus gelesen. Der Rest wird roh ausgegeben statt
geraten. Geräte-ID, Seriennummer und IP werden maskiert, außer du gibst
`--no-redact` an.

## Was er nicht kann

**MQTT wird nicht bedient, und kann es auch nicht.** Das Gerät hält eine
MQTT-Sitzung zu AWS IoT, und dieser Pfad prüft das Broker-Zertifikat gegen eine
CA im Flash **und** legt ein eigenes Client-Zertifikat vor
(`mbedTLS_SSL_Conf_Authmode(conf, 2)`). Das zu fälschen bräuchte den
AWS-Signaturschlüssel — und genau dagegen ist ein Zertifikat gedacht.

Der Container kann Verbindungsversuche **protokollieren**, wenn du den
Broker-Hostnamen hierher zeigen lässt; so wurde MQTT als Ursache der Ausfälle
ausgeschlossen. Im Normalbetrieb aber Finger weg: Eine angenommene und dann
verworfene Verbindung lässt das Gerät alle 5,5 Sekunden neu versuchen, dauerhaft,
auf demselben Netzwerkchip, über den auch alles andere läuft. `MQTT_PORT=0`
schaltet den Listener ab.

**Andere Endpunkte werden protokolliert, nicht beantwortet.** Anfragen, die weder
Upload noch Zeitabfrage sind, bekommen ein 404. Sich als Endpunkt auszugeben,
dessen erwartete Antwort niemand analysiert hat, könnte das Geräteverhalten auf
ungetestete Weise ändern. Erst ins Log schauen, dann bewusst entscheiden. Mit
`ACCEPT_ALL=1` wird alles mit `{"code":0}` beantwortet, falls du experimentieren
willst.

## Was das nicht behebt

Die 30-Minuten-Resets hören auf. **Eine zweite, kleinere Unterbrechung nicht** —
und das gehört gesagt, bevor du dir die Mühe machst.

Seit Firmware v150 läuft der Telemetrie-Upload über TLS: v149.2 schickte ihn im
Klartext an `hamedata.com`, v150 schickt ihn per HTTPS an
`api-eu.marstekcloud.com`, und der gesamte TLS-Code ist neu in dieser Version.
Jeder Upload kostet das Gerät damit einen Schlüsselaustausch, und der dauert auf
diesem Mikrocontroller rund vier Sekunden — in denen es keinen Modbus bedient.
Ping und ARP beantwortet es weiter, deshalb ist es von einem Reset gut zu
unterscheiden.

Gemessen über 11,7 Stunden an einem zweiten Gerät, nachdem dessen Puffer leer war:

| | |
|---|---|
| Modbus-Lücken länger als 3,5 s | **141** — 12,0 pro Stunde |
| TLS-Handshakes im selben Zeitraum | **141** |
| Lücken, die mit einem Handshake zusammenfallen | **141 von 141** |

Zwölf pro Stunde ist einer pro Datensatz, also einer pro Upload. Kein einziger
unerklärter Ausfall — aber eben auch kein Upload ohne einen.

**Liegt der Antwort-Timeout deines Modbus-Clients unter etwa 8 Sekunden, wirst du
also weiterhin alle fünf Minuten einen Fehler protokollieren.** Den Timeout
hochzusetzen ist die Abhilfe, und es ist die einzige: Hier rechnet die Firmware,
und kein Endpunkt kann ihr das abnehmen. Mit der echten Cloud passiert dasselbe.

## Er muss laufen — wichtiger, als es aussieht

Alle fünf Minuten kommt ein Datensatz in den Puffer, und er verschwindet erst,
wenn ein Upload beantwortet wurde. Bleibt mehr als einer unbestätigt, wenn der
1800-Sekunden-Timer abläuft, beginnen die Resets — und der Zustand hält sich
selbst, weil die Firmware dann auf einen Upload pro 60 Sekunden drosselt.

**Ausfallzeit ist hier also nicht gratis.** Nimm `--restart unless-stopped`, sorg
dafür, dass Docker beim Booten startet, und schau nach einem Neustart des Hosts
nach, ob der Container wieder da ist. Fällst du doch einmal in den Takt, löst er
sich von selbst wieder auf, sobald Uploads beantwortet werden — beim gemessenen
Gerät dauerte das rund 45 Minuten.

Nichts davon liegt am Offline-Betrieb. Dasselbe passiert, wann immer die echte
Cloud lange genug nicht erreichbar ist; eine Gegenstelle im LAN fällt nur
seltener aus als eine im WAN.

## Einstellungen

| Variable | Vorgabe | Bedeutung |
|---|---|---|
| `TZ` | `UTC` | **unbedingt setzen** — welche Lokalzeit die Antwort nutzt, z. B. `Europe/Berlin` |
| `ANSWER_TIME` | `1` | Zeitendpunkt beantworten (stellt die Uhr des Geräts) |
| `TIME_LOCAL` | `1` | Lokalzeit liefern wie der echte Server; `0` erzwingt UTC |
| `TIME_SUFFIX` | `04_0_0_0` | hintere Felder der Zeitantwort, vom echten Endpunkt übernommen |
| `ACCEPT_ALL` | `0` | jeden Pfad mit `{"code":0}` beantworten |
| `HTTPS_PORT` | `443` | |
| `HTTP_PORT` | `80` | Klartext-Endpunkte auf hamedata |
| `MQTT_PORT` | `8883` | MQTT-Verbindungsprobe, nur Protokoll; `0` schaltet ab |
| `LOG_DIR` | `/data` | eine JSONL-Datei pro Tag |
| `CERT_DIR` | `/certs` | Zertifikat und Schlüssel |
| `MAX_BODY` | `262144` | Bytes, die pro Anfrage aufgehoben werden |
| `PROXY_TIME_IP` | — | Diagnose: Zeitabfrage weiterreichen und die echte Antwort wörtlich zurückgeben |
| `PROXY_TIME_HOST` | `eu.hamedata.com` | Host-Kopfzeile beim Durchreichen |
| `PROXY_TIME_PORT` | `80` | Port der Gegenstelle |
| `PROXY_TIME_MS` | `8000` | danach aufgeben und selbst antworten |

### Diagnose: die Zeitabfrage durchreichen

Manchmal muss man wissen, ob sich das Gerät anders verhält, wenn die Antwort
**echt** ist statt nur gut nachgebaut. Das lässt sich durch noch so genaues
Byte-Vergleichen nicht klären — `PROXY_TIME_IP` reicht die Zeitabfrage deshalb an
den echten Endpunkt weiter und gibt zurück, was von dort kommt, byte-genau und
ohne dass Node etwas umformt.

**Der Telemetrie-Upload wird nie durchgereicht.** Was in diesem Modus dein Netz
verlässt, ist allein das Zeit-GET mit Geräte-ID und Firmwareständen — keine
Messwerte. Variable wieder entfernen, und der Betrieb ist erneut vollständig
offline.

Sie nimmt bewusst eine Adresse statt eines Hostnamens: Der Container ist ja das,
worauf der DNS des Geräts zeigt — den Namen hier aufzulösen liefe im Kreis.

```bash
curl -s -H 'accept: application/dns-json' 'https://1.1.1.1/dns-query?name=eu.hamedata.com&type=A'
```

## Wie wir es gefunden haben

Der Mechanismus kam aus der dekompilierten Firmware. Den Container aber so
hinzubekommen, dass das **Gerät ihn akzeptiert**, kostete vier Irrwege und ein
Experiment, das die Sache entschied. Wer etwas Ähnliches debuggt oder wissen
will, wie weit die Belege tatsächlich reichen:
[docs/HOW-WE-FOUND-IT.md](docs/HOW-WE-FOUND-IT.md).

## Woran wurde das geprüft?

Die Anforderungen stammen aus der dekompilierten Control-Firmware v150 und wurden
anschließend an einem echten Venus D mit Firmware 150 über LAN bestätigt:

- **Die Antwort ist byte-identisch mit der des echten Endpunkts** — nicht bloß
  ähnlich. Eine echte Antwort wurde mitgeschnitten, indem sie durch diesen
  Container durchgereicht wurde, und die selbst gebaute dagegen gehalten:
  dieselben 232 Bytes, dieselben Kopfzeilen in derselben Reihenfolge, dasselbe
  Chunked-Framing. Nur `Date`, `Trace-Id` und der Zeitstempel unterscheiden sich,
  wie es sein muss. Das ist wichtiger, als es klingt: Eine von Node
  zusammengesetzte Antwort — gleicher Rumpf, gleiches Chunked-Framing, aber mit
  zusätzlichem `Keep-Alive: timeout=5` und anderer Reihenfolge — wurde
  **abgelehnt**, das Gerät versuchte es viermal und stellte seine Uhr nicht.
- **Auch die Antwort des Upload-Hosts wurde roh mitgeschnitten**, mit einem POST
  ohne Nutzlast, den das Gateway mit
  `{"code":51,"message":"The d field is required"}` ablehnt. Er steht hinter
  einem Kong-Gateway und schickt sieben Kopfzeilen, die der Zeitendpunkt nicht
  sendet; der Container bildet sie nach, in derselben Reihenfolge.
- **Der echte Endpunkt antwortet mit keep-alive und schließt nie**, das Gerät
  wartet seinen vollen 20-Sekunden-Timeout also bei jedem Upload ab. Das ist
  normal und kein Fehler. Schädlich ist nur, die Verbindung währenddessen zu
  kappen: `mbedTLS_SSL_Recv_WithRetry` (`0x08015914`) gibt dann den Fehler statt
  der Bytes zurück, und der Aufrufer schreibt ihn als Länge weiter. Dieser
  Container hält die Verbindung 25 Sekunden und beendet sie sauber; er reißt sie
  nie ab.
- **Die Prüfung der Firmware selbst** (`FUN_0801774c`: `strstr` auf `"code":`,
  dann `atoi` auf das nächste Byte) wertet unseren Rumpf zu 0 aus — angenommen.
- **TLS 1.0, 1.1 und 1.2 werden alle ausgehandelt**; das Gerät legt auf diesem
  Pfad kein Client-Zertifikat vor und prüft nichts, passend zu `Authmode 0` in
  `HTTPS_TLS_Session_Init`.
- **Die tatsächlich genutzte Region (`eu`)** wurde auf dem Draht beobachtet, nicht
  angenommen.

## Ein Hinweis, den du lesen solltest

TLS ist hier bewusst großzügig eingestellt: Versionen 1.0 bis 1.2 und
`SECLEVEL=0`, weil das Gerät in der Firmware einen älteren Bereich festlegt und
die genauen Werte nicht auflösbar waren. Für einen eingebetteten Client im
eigenen LAN, der mit einem Server ohne schützenswerten Inhalt spricht, ist das in
Ordnung. **Setz diesen Container nicht ins Internet.**

## Verwandte Projekte

- 🔌 **[Marstek Venus Modbus — Dev-Fork](https://github.com/sphings79/marstek_venus_modbus_dev)** —
  die Home-Assistant-Integration, die die Batterie über Modbus TCP ausliest. Sie kann
  diese Ausfälle nicht verhindern, aber sie kommt in Sekunden statt Minuten zurück und
  legt einen Reparatur-Eintrag an, wenn das Gerät von sich aus aus dem
  RS485-Steuermodus fällt. Wer diesen Container betreibt, will das meistens auch.
  ([Upstream](https://github.com/ViperRNMC/marstek_venus_modbus))
- 🖥️ **[venuscontrol](https://github.com/sphings79/venuscontrol)** — cloudfreie
  Web-Bluetooth-Steuerung für Venus A / D, inklusive OTA-Firmware-Updates
- 🔬 **[Venus D Firmware Reverse Engineering](https://github.com/sphings79/Marstek-Venus-D-Firmware-Reverse-Engineering)** —
  dort kommt die Analyse hinter diesem Container her
- 📦 **[Marstek-Firmware-Archiv](https://github.com/sphings79/marstek-firmware-archiv)**
- 🌐 **[Weitere Projekte und Werkzeuge](https://sphings-dev.de/)**

---

## Sponsor this project

Diese Tools entstehen in meiner Freizeit und bleiben kostenlos, quelloffen und cloudfrei.
Wenn dir eines davon einen Nachmittag gespart hat, kannst du mir [einen Kaffee ausgeben](https://buymeacoffee.com/sphings).

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-sphings-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=000000)](https://buymeacoffee.com/sphings)

## Lizenz

MIT — siehe [LICENSE](LICENSE).
