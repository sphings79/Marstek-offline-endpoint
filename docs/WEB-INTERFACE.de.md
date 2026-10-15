# Weboberfläche

**English: [WEB-INTERFACE.md](WEB-INTERFACE.md)**

Der Container hat eine kleine Weboberfläche: welche Batterien sich melden, ob
pünktlich, ob der *Endpoint selbst* lief, und eine Datei, die du an eine
Fehlermeldung hängen kannst. Nichts zu installieren, keine zusätzliche
Abhängigkeit: Sie steckt im selben Container, auf Port **8443**.

> Community-Projekt. Nicht mit Marstek verbunden und von Marstek weder
> empfohlen noch unterstützt. Die Bilder zeigen erfundene Geräte und Adressen;
> jedes ist die helle und die dunkle Darstellung derselben Seite.

![Geräte und Verfügbarkeit des Endpoints](img/web/desktop-overview.png)

## Erster Start und Anmeldung

1. Container starten und den einmaligen Einrichtungscode aus dem Log lesen. Er
   steht nur dort, nie in der Oberfläche:

   ```bash
   docker logs marstek-offline-endpoint 2>&1 | grep SETUP
   ```

2. `https://<Host>:8443/` öffnen. Das Zertifikat ist selbstsigniert, der Browser
   warnt einmal. Code eingeben und ein Passwort wählen (mindestens 8 Zeichen).
3. Es gibt **ein Konto**. Passwort vergessen? `auth.json` im Datenordner löschen;
   beim nächsten Aufruf fragt die Seite wieder nach einem Einrichtungscode. Ein
   Neustart ist nicht nötig.

Die Anmeldung folgt den OWASP-Empfehlungen: scrypt für das Passwort, ein
Sitzungs-Cookie mit `HttpOnly`, `SameSite=Strict` und `Secure` über HTTPS, ein
CSRF-Token bei jeder Änderung, 30 Minuten Leerlauf und höchstens 12 Stunden
Sitzungsdauer und eine Sperre nach 5 Fehlversuchen je Adresse in 15 Minuten. Die
Einstellungen zeigen die letzte Anmeldung und die Fehlversuche seitdem.

![Anmeldung](img/web/desktop-login.png)

## Geräte

Geräte werden erkannt, nicht eingerichtet: Die Upload-URL trägt die Geräte-ID,
die Zeitanfrage die Firmware-Stände und der Upload-Inhalt die Seriennummer (die
MAC-Adresse). Ein Gerät mit neuer Adresse erscheint unter derselben ID; eines,
das nach dem Entfernen wieder sendet, taucht wieder auf.

- **Übersicht**: Adresse, Firmware, letzter Upload und letzte Zeitanfrage, der
  übliche Rhythmus, Dauer des TLS-Handshakes, TLS-Fehler und ob der Ping
  beantwortet wird.
- **Geräteseite**: Name (Umbenennen im Dialog), alle Kennungen und darunter der
  Verlauf.
- Ein Gerät **entfernen** (seine Log-Dateien bleiben, bis die Aufbewahrungszeit
  abläuft) oder in ein anderes **zusammenführen**, für eine getauschte Platine,
  die eine neue ID meldet. Zusammenführen lässt sich nicht rückgängig machen.

![Geräteseite: Verlauf und Erreichbarkeit](img/web/desktop-device.png)

### Verlauf und Erreichbarkeit

Eine Grafik je Gerät, von einer Stunde bis zu allem Gespeicherten:

| Zeile | Zeigt |
|---|---|
| Endpoint | wann der Endpoint selbst lief (siehe unten) |
| Uploads, Zeitanfragen | angekommen gegen erwartet: grün wie erwartet, orange weniger, rot nichts |
| Ping | das Gerät antwortet auf Ping; rot markiert einen Aussetzer ab 2,5 s |
| TLS-Fehler | ein Punkt je fehlgeschlagenem Handshake |
| Dauer des TLS-Handshakes | je Verbindung; langsame fallen rot auf |

Antippen oder Anklicken der Grafik zeigt die Einzelheiten zu diesem Zeitpunkt.
Zeiten, in denen der Endpoint selbst aus war oder kein Netz hatte, sind über die
Geräte-Zeilen schraffiert, denn eine Lücke dort geht nicht aufs Gerät.

Der Ping läuft im Container, ein `ping` je Gerät, und schreibt nur Wechsel. Er
lässt sich je Gerät abschalten, oder für alles mit `PING=0`.

## Verfügbarkeit des Endpoints

Um „die Batterie war weg“ von „mein Endpoint war weg“ zu unterscheiden, schreibt
der Endpoint sein eigenes Leben mit:

- ein Herzschlag alle 30 s; beim nächsten Start weiß er, ob der letzte Lauf sauber
  endete (Neustart oder Update) oder nicht (Stromausfall, Absturz, `kill -9`);
- alle 5 s ein Ping an das Gateway des Netzes, in dem die Batterien hängen (die
  Schnittstelle, deren Subnetz ihre Adressen enthält; ohne bekannte Geräte die
  Standard-Route). Drei Fehlversuche hintereinander gelten als „kein Netz“, datiert
  auf den ersten Fehlversuch. Ein Gateway, das nie auf Ping antwortet, bleibt
  „unbekannt“ und schreibt nichts. Hat dieses Netz keine Standard-Route (siehe den
  macvlan-Hinweis unten), bleibt die Prüfung aus, statt das falsche Netz zu
  beobachten. `ENDPOINT_GATEWAY` ersetzt die Adresse.

Die Karte auf der Übersicht listet die Ausfälle mit Ursache und den Zeitanteil.
Die Aufzeichnung beginnt, wenn diese Funktion zum ersten Mal läuft; für früher
gibt es nichts.

## Messwerte

![Messwerte](img/web/desktop-measurements.png)

Neben dem Verlauf, *wann* eine Batterie gesprochen hat, hält der Endpoint fest, *was* sie
gesagt hat. Jeder Upload wird entschlüsselt, und die Werte, die sich **geändert** haben,
landen in einer SQLite-Datei, `measurements.db` im Datenordner: eine Zeile je Wert, mit
Zeit, Gerät und dem Rohtext, wie er kam. Ein gleich bleibender Wert fügt nichts hinzu, eine
ruhige Batterie kostet also wenig. Listen wie die Zellspannungen werden zu einem Schlüssel
je Position (`vc[2]`, `vc[3]`, ...). Geräte-ID und Seriennummer werden nicht als Werte
gespeichert.

Die Seite **Messwerte** zeigt den neuesten Wert jedes Schlüssels je Gerät, **nach
Kategorien gruppiert** (Firmware, Leistung, Energie, Batterie, Temperatur, Netz und Zähler,
Solar/MPPT, Status, Fehler, Verbindung, Gerät). Ein Tipp auf den Namen zeigt seine **Kurve**
über 24 Stunden bis zu allem Gespeicherten, mit den Firmware-Wechseln als gestrichelten
Linien. Eine eigene Karte listet den **Firmware-Verlauf**: wann sich die Steuer-, BMS-,
Wechselrichter- oder MPPT-Firmware geändert hat (antwortet eine Komponente mit 0, gilt das
als Lücke, nicht als Version). Die Grafik auf der Geräteseite markiert dieselben Wechsel.

Fast jeder Schlüssel hat inzwischen eine Bedeutung. Das Kennzeichen sagt, woher sie stammt:
*gegen Home Assistant geprüft* (Zähler und Zustände mit den Modbus-Werten von drei Venus D auf
Firmware 151 verglichen) oder *aus dem Firmware-Code* (der Upload ist ein einziges `sprintf`;
jedes Argument ist eine Kopie einer benannten Live-Variable der Steuer-Firmware 151). Der
Firmware-Code liefert die Bedeutung, nicht immer die Einheit: Wo er sie nicht liefert, bleibt
die Einheit leer und der Rohwert wird gezeigt. Schlüssel, die nur einige Firmware-Versionen
senden, stehen in ihrer Beschreibung (`p_sta`, `p_pow` ab Steuer-Firmware 151; `pv`, `sk`, `mv`,
`me`, `ma`, `fu` nicht beim VNSE3). `hd` ist noch unbekannt.

Das Entscheidende ist das **Namensfeld**: Jeder Schlüssel hat einen Namen, eine Einheit und
eine Skalierung, die du mit *Ändern* anpassen kannst. Sie gelten beim Lesen, die
gespeicherten Werte werden nie angefasst, eine spätere Korrektur macht also alle alten
Werte auf einmal richtig. Der Filter zeigt standardmäßig nur Schlüssel mit bestätigter Bedeutung; schalte ihn ab, um
alle zu sehen, auch solche, die nur in einer Firmware auftauchen, die du dokumentiert
noch nicht kennst.

**Modell und Firmware.** Ein anderes Modell oder eine andere Firmware kann andere Schlüssel
senden oder einen Schlüssel anders meinen. Die Datenbank hält deshalb das Gerätemodell und die
Steuer-Firmware (`dn`) bei jedem Wert fest. Das Modell stammt aus der Zeitanfrage (`VNSD-0` ist
ein VNSD, also ein Venus D; `VNSA` ein Venus A; `VNSE3` ein Venus E 3.0); die Seite zeigt es am
Gerät. Eine Bedeutung lässt sich für *alles*, für *eine Firmware*, für *ein Modell* oder für *ein
Modell mit einer Firmware* festlegen. Die genaueste Regel gewinnt: Modell mit Firmware, dann
Modell, dann Firmware, dann alles. Eine Regel lässt die anderen unverändert; wer eine breitere
speichert, ersetzt auch die engeren darin.

Die eingebauten Bedeutungen wurden an einem Venus D mit Firmware 151 geprüft und sind so
gekennzeichnet. Für jedes andere Modell und jede andere Firmware gelten sie dem Namen nach
weiter, aber als nicht geprüft, und die Seite sagt das. Wo der Firmware-Code eines anderen
Modells oder einer anderen Version einen Schlüssel aus einer anderen Variable speist, hat die
eingebaute Liste eine eigene Regel für dieses Modell (der Venus E 3.0 sendet in `vc` die Spannung
von 16 Zellen des Packs 1, nicht die Min/Max-Statistik von sechs Packs). Die Unterschiede aus
zehn dekompilierten Control-Firmwares stehen im Reverse-Engineering-Repository;
`docs/NEW-FIRMWARE.de.md` beschreibt, wie man eine neue Version prüft. Nach einem
Firmware-Wechsel wird jeder Wert noch einmal unter der neuen Firmware geschrieben.

- **Abschalten** unter *Einstellungen -> Messwerte-Datenbank*. Dann wird nichts aufgezeichnet,
  und das Gespeicherte bleibt.
- **Aufbewahrung** folgt der Aufbewahrung der Logs; der neueste Wert jedes Schlüssels bleibt
  immer.
- **Aus den Logs neu aufbauen** leert die Werte und füllt sie aus den Anfrage-Logs neu
  (deine Namen bleiben). Das passiert beim ersten Mal von selbst, eine neue Datenbank startet
  also mit dem Verlauf, den du schon hast.
- **Größe:** rund 19 MB für 12 Tage bei drei Batterien, weil sich Leistung und Spannung bei
  fast jedem Upload ändern. Langsame Werte kosten fast nichts.
- Das **Support-Paket** kann die Werte als `measurements.csv` je Gerät enthalten (Option,
  standardmäßig aus). Geräte-IDs, Seriennummern und Adressen sind wie üblich unkenntlich.
- Es braucht Node 22 (`node:sqlite`); das Container-Image bringt es mit. Ohne das sagt die
  Karte es, und sonst ändert sich nichts.

## Benachrichtigungen

![Benachrichtigungen](img/web/desktop-notifications.png)

Der Endpoint kann dir melden, wenn bei den Uploads etwas nicht stimmt. Einrichten auf der Seite
**Benachrichtigungen**: eine Karte mit dem Hauptschalter und dem Status, eine mit den Regeln und je Kanal eine Karte.
Es wird nichts gesendet, bevor du es einschaltest und einen Kanal einträgst. Der Hauptschalter ist eine Pause-Taste: Solange er aus ist, behalten die Kanäle ihre Einstellungen, senden aber nichts (sie erscheinen abgedunkelt). Wer einen Kanal einschaltet, schaltet den Hauptschalter mit ein.

| Wann | Standard |
|---|---|
| Eine Batterie hat das Dreifache ihres üblichen Abstands nicht hochgeladen (mindestens 15 Minuten, einstellbar) | an |
| Eine Batterie antwortet seit 60 Sekunden nicht auf Ping (einstellbar) | an |
| Der Endpoint ist nach einem unsauberen Stopp (Stromausfall, Absturz) gestartet oder hat kein Netz | an |
| Der Endpoint wurde normal neu gestartet | aus |
| Eine Firmware-Version hat gewechselt (Steuerung, BMS, Wechselrichter, MPPT) | aus |
| Der Vorfall ist vorbei | an |

Eine Nachricht je Vorfall, eine weitere, wenn er vorbei ist. Ein Neustart des Endpoints beginnt die
Upload-Zählung neu, ein Neustart wird also nie als fehlender Upload gemeldet, und ein noch offener
Vorfall wird nach einem Neustart nicht noch einmal gemeldet. Eine Nachricht, die nicht zugestellt
werden kann (etwa solange der Endpoint kein Netz hat), wartet und wird jede Minute bis zu 24 Stunden
lang erneut versucht; höchstens 30 Nachrichten pro Stunde verlassen den Container.

Kanäle (Telegram, Pushover, Home Assistant notify, Webhook):

- **Telegram:** Bot bei @BotFather anlegen, ihm einmal schreiben, Token und deine Chat-ID eintragen
  (Schritt für Schritt: [TELEGRAM.de.md](TELEGRAM.de.md)). Der Endpoint ruft `api.telegram.org` auf.
- **Pushover:** unter pushover.net/apps eine Anwendung anlegen und ihr API-Token sowie deinen User Key
  (oder einen Gruppen-Key) eintragen. Die Priorität ist wählbar: leise, normal, hoch (hoch ignoriert
  Ruhezeiten). Der Endpoint ruft `api.pushover.net` auf.
- **Home Assistant notify:** Adresse deines Home Assistant, ein langlebiges Zugriffstoken (Profilseite)
  und den notify-Dienst eintragen, z. B. `mobile_app_iphone` für die App auf einem Handy. Der Endpoint ruft
  `POST /api/services/notify/<Dienst>` auf.

- **Webhook:** ein POST an eine beliebige URL, für Dienste wie ntfy, Gotify, Slack, Discord oder ein eigenes
  Skript. Inhalt als JSON (`title`, `message`, `event`, `device`, `time`) oder als Klartext (nur die Nachricht,
  der Titel als `Title`-Header). Die Adresse enthält oft ein Geheimnis, sie wird deshalb wie ein Token gespeichert,
  und die Seite zeigt danach nur ihren Host. Ein `Authorization`-Header lässt sich ergänzen. `event` ist eines von
  `upload_missing`, `upload_back`, `ping_down`, `ping_up`, `endpoint_unclean_start`, `endpoint_restart`,
  `network_down`, `network_up`, `firmware_changed`, `test`.

„Speichern und testen“ schickt eine Testnachricht über den Kanal. Eine Nachricht nennt das Gerät so,
wie du es benannt hast (oder „Venus“ plus die letzten vier Zeichen der MAC); sie enthält nie eine
Geräte-ID, eine Adresse oder einen Messwert. Die Sprache der Nachrichten ist eine eigene Einstellung.
Tokens liegen in `secrets.json` im Datenordner (nur für den Besitzer lesbar), werden von der Seite nie
wieder angezeigt und sind nie Teil eines Support-Pakets.

## MQTT für Home Assistant

![MQTT](img/web/desktop-mqtt.png)

Auf einer eigenen Seite, **MQTT**, kann der Endpoint Gesundheitswerte an deinen
MQTT-Broker übertragen. Home Assistant findet sie selbst per MQTT-Discovery (Präfix
`homeassistant`), ohne YAML:

- je Gerät: letzter Upload (Zeitstempel), Upload-Abstand, erreichbar (Ping), Upload überfällig,
  TLS-Handshake-Dauer, TLS-Fehler und die vier Firmware-Versionen;
- für den Endpoint: Version, läuft seit, Netz, Verfügbarkeit und Anzahl der Ausfälle über 7 Tage.

**Messwerte (Option, standardmäßig aus).** Der Endpoint kann auch die Werte der Messwerte-Datenbank
übertragen, eine Home-Assistant-Entität je Schlüssel, benannt wie auf der Seite Messwerte (eine
Umbenennung dort kommt auch in Home Assistant an). Viele davon sind per Modbus gar nicht zu lesen: die
MPPT-Leistung und -Spannung, die vier PV-Eingänge, die CT-Leistung je Phase, Netzbezug und -einspeisung
des Zählers, die Zellindizes, die Fehlerworte der Packs und mehr. Wähle *Nur die Gesundheitswerte*, *Messwerte ergänzen, die Home Assistant per Modbus
nicht bekommt* (empfohlen: lässt die Schlüssel weg, die sich Modbus-Werten zuordnen ließen) oder *Alle Messwerte
ergänzen* und die Kategorien. Die Gesundheitswerte werden in jedem Fall gesendet. Die Werte kommen in einer JSON-Nachricht je Gerät; Zahlen tragen Einheit, Geräteklasse
und Zustandsklasse (Leistung, Energie, Spannung, Strom, Temperatur), Hex-Felder kommen als `0x..`-Text.
Adresse und Geräteuhr werden nie übertragen. Schaltest du eine Kategorie oder die ganze Option ab,
verschwinden ihre Entitäten wieder aus Home Assistant. Das Dropdown zeigt in Klammern, wie viele
Entitäten je Gerät jede Wahl erzeugt. Eine vierte Wahl, *Nur die Werte ergänzen, die ich auswähle*, lässt dich einzelne Werte
auf der Seite Messwerte wählen: ein Kästchen *MQTT* an jeder Zeile (und *alle / keine* für eine ganze Karte). Jeder Wert, der
gesendet wird, ist in jedem Modus mit einem kleinen Pfeil-Symbol in seiner Zeile markiert.

Alles geht nur an den Broker, den du eingetragen hast. Ein Verfügbarkeits-Topic mit Last Will lässt die Entitäten „nicht verfügbar“ werden, wenn der Endpoint weg
ist. Die Topics tragen einen kurzen Hash statt der Geräte-ID. Es wird nur gemeldet: nichts kommt aus Home
Assistant, nichts steuert eine Batterie, und die Batteriewerte selbst (Ladezustand, Leistung, ...) werden
nicht gesendet, weil Home Assistant sie schon per Modbus liest. Der MQTT-Client steckt im Endpoint
(MQTT 3.1.1, einfach oder mit TLS, Benutzer und Passwort), es muss also nichts installiert werden. Das
Passwort wird wie die Tokens oben aufbewahrt.

## Zwei Prozesse und Web-Updates

Der Container führt zwei Prozesse aus. Der **Hauptprozess** (`server.cjs`) beantwortet die Batterien auf den Ports 443 und 80,
schreibt die Tages-Logs der Anfragen und führt das Protokoll über das Leben des Endpoints selbst (Herzschlag, Netzprüfung).
Der **Web-Prozess** (`webproc.cjs`) betreibt diese Weboberfläche, die Messwerte-Datenbank, die Benachrichtigungen, den
MQTT-Client und den Ping. Der Hauptprozess startet ihn, versorgt ihn mit allem, was am Endpoint passiert, und startet ihn neu,
wenn er endet.

Das bringt dir: Ein Neustart oder Update der Web-Seite berührt den Endpoint, der die Batterien beantwortet, nicht. Ein Neustart
des Web-Prozesses dauert ein bis zwei Sekunden, du bleibst angemeldet (die Sitzungen liegen in `sessions.json`, als Hash),
Ereignisse in der Zwischenzeit werden zwischengespeichert, und die „Verfügbarkeit des Endpoints“ zählt ihn nicht als Ausfall,
weil dieses Protokoll der Hauptprozess führt. Das Konsolen-Log des Support-Pakets enthält weiter die Zeilen des Hauptprozesses.

### Nur die Weboberfläche aktualisieren

Die Update-Karte zeigt zwei Arten von Releases: **Container**-Releases (`vX.Y.Z`: ein neues Image, das du wie bisher holst) und
**Web**-Releases (`web-vX.Y.Z`: eine neue Web-Seite). Ein Web-Update wird von der Seite aus installiert, ohne neues Image und ohne
Neustart des Endpoints:

1. Ein Release `web-vX.Y.Z` trägt drei Dateien: `marstek-endpoint-web-X.Y.Z.tar.gz`, `.manifest.json` und `.manifest.sig`.
2. **Du drückst „Installieren“.** Nie wird von selbst etwas installiert; die Update-Prüfung liest nur Versionshinweise.
3. Der Endpoint lädt die drei Dateien (nur von github.com, über HTTPS), prüft die **Ed25519-Signatur** des Manifests gegen den
   öffentlichen Schlüssel, der Teil des Images ist (`webupdate.pub`), prüft die SHA-256 des Archivs gegen das Manifest, prüft,
   was das Manifest verlangt (siehe unten), liest das Archiv mit einem kleinen Leser, der nur die aufgelisteten schlichten
   Dateinamen akzeptiert (keine Links, kein `..`, keine zusätzlichen Dateien), und schreibt die Dateien nach
   `data/web-override/X.Y.Z/`.
4. Erst dann wird es aktuell gesetzt und der Web-Prozess startet neu. Wer ein Release auf GitHub veröffentlichen kann, aber den
   privaten Schlüssel nicht hat, kann keinen Endpoint dazu bringen, etwas zu installieren.
5. Startet die neue Version nicht, markiert der Hauptprozess sie nach drei Abstürzen innerhalb einer Minute als fehlgeschlagen,
   und die Web-Seite läuft wieder mit den Dateien des Images; die Karte sagt das. „Zurück zur Version im Image“ macht dasselbe
   von Hand.

**Mindestversionen.** Das Manifest trägt `requires.minContainer` (das älteste Image, mit dem die Web-Seite arbeitet) und
`requires.ipc` (die Version der Verständigung zwischen den beiden Prozessen). Die Seite zeigt, was ein Release braucht, bevor du
etwas drückst, und die Installation lehnt ein Release ab, das nicht passt („braucht Container X oder neuer: erst das Image
aktualisieren“). Die Anforderung wird bei jedem Start des Web-Prozesses erneut geprüft, ein Update, das zu einem neueren oder
älteren Image nicht mehr passt, wird also nicht benutzt. Ein installiertes Update wird außerdem ignoriert, sobald das Image eine
neuere oder gleiche Web-Version trägt.

Die neuen Versionsnummern erscheinen als `web-vX.Y.Z` neben der Container-Version. Benachrichtigungen können dich über neue
Container-Versionen und neue Web-Versionen informieren (Seite Benachrichtigungen, Regeln; beide standardmäßig aus).

Was weiter ein neues Image (einen Container-Neustart) braucht: `server.cjs` selbst, der Supervisor, Node und Alpine, die Zertifikate
und die Umgebungsvariablen (Ports, Proxy). Das Veröffentlichen von Web-Releases steht in `docs/RELEASING.md`.

## Einstellungen

![Einstellungen](img/web/desktop-settings.png)

- **Updates**: Einmal täglich fragt der Container bei `api.github.com` die
  öffentlichen Versionshinweise dieses Projekts ab und zeigt, was neu ist. Nur die
  Anfrage selbst verlässt das Netz (GitHub sieht die Adresse, von der sie kommt);
  nichts über deine Geräte wird gesendet, nichts wird heruntergeladen oder
  installiert. Standardmäßig an; wer keine ausgehenden Anfragen will, schaltet es
  ab.
- **Messwerte-Datenbank**: an/aus, was sie enthält, neu aufbauen aus den Logs (siehe oben).
- **Aufbewahrung der Logs**: ein Wert für alle Logs, standardmäßig 30 Tage.
- **Support-Paket**: siehe unten.
- **Anmeldung und Passwort.**
- **Speicherbelegung:** was der Datenordner enthält, nach Art (Logs, Messwerte-Datenbank, Einstellungen und
  Status, Sonstiges) als Balken und Tabelle, der freie Platz des Datenträgers und die Dateiliste
  mit Größe und Datum.
- **Konfiguration:** wo was liegt (Datenordner im Container und auf dem Host, Zertifikatordner), wie man
  das Passwort zurücksetzt (`auth.json`) und welche Einstellungen aus der Umgebung kommen.

### Support-Paket

Ein `.tar.gz` für eine Fehlermeldung, für alle Geräte oder eines, von 24 Stunden
bis zu allem Gespeicherten: Version und Einstellungen, die letzten Konsolenzeilen,
je Gerät eine Tabelle mit Uploads, Zeitanfragen, Ping-Aussetzern und TLS-Ereignissen
und die Ausfälle des Endpoints selbst. Optional die entschlüsselten Messwerte als `measurements.csv`.

Standardmäßig ist das Paket **unkenntlich gemacht**: Geräte-IDs, Seriennummern,
IP-Adressen und Namen werden zu `device-1`, `mac-1`, `ip-1`, und es sind keine
Anfrage-Inhalte enthalten. **Tokens und E-Mail-Adressen werden immer entfernt**,
auch bei „Rohdaten einschließen“, das die Anfragezeilen mit den echten Kennungen
ergänzt. Sieh die Datei durch, bevor du sie anhängst.

## Handy

Das Layout folgt dem Bildschirm: Burger-Menü, eine kompakte Grafik zum Antippen und
dieselben Seiten. Im Menü stehen auch Sprache, Darstellung und die Links.

| | | |
|---|---|---|
| ![Geräte](img/web/phone-overview.png) | ![Geräteseite](img/web/phone-device.png) | ![Menü](img/web/phone-menu.png) |
| ![Messwerte auf dem Handy](img/web/phone-measurements.png) | ![Benachrichtigungen auf dem Handy](img/web/phone-notifications.png) | ![MQTT auf dem Handy](img/web/phone-mqtt.png) |

## Hell, dunkel und System

Der Knopf in der Kopfzeile (Monitor, Sonne oder Mond, passend zur aktuellen Wahl)
öffnet ein kleines Menü: **System** folgt deinem Gerät, **Hell** und **Dunkel** sind
fest. Die Wahl bleibt im Browser gespeichert und gilt schon auf der Anmeldeseite.

![Einstellungen auf dem Handy](img/web/phone-settings.png)

## Hinter einem Reverse Proxy

Alles zum Listener wird mit Umgebungsvariablen gesetzt, mit Absicht: Ein falscher
Wert in der Oberfläche könnte dich aus ihr aussperren.

| Variable | Standard | Bedeutung |
|---|---|---|
| `WEB_PORT` | `8443` | Port der Oberfläche; `0` schaltet sie ab |
| `WEB_TLS` | `1` | `0` liefert reines HTTP, für einen Proxy, der TLS beendet, **und** ein vertrauenswürdiges Netz |
| `BASE_PATH` | — | unter einem Pfad bereitstellen, z. B. `/endpoint` |
| `TRUST_PROXY` | — | kommagetrennte Adressen oder IPv4-Netze (`172.18.0.0/16`), deren `X-Forwarded-*`-Header geglaubt werden. Ohne das sieht die Oberfläche für jeden Besucher die Proxy-Adresse, die Sperre zählt alle zusammen und die letzte Anmeldung zeigt den Proxy |
| `PING` | `1` | `0` schaltet Geräte-Ping und Gateway-Prüfung ab |
| `ENDPOINT_GATEWAY` | — | Adresse für die Netzprüfung statt des Gateways der Geräte |

TLS auch hinter dem Proxy anlassen, außer beide laufen auf demselben Host und du
hast einen Grund dagegen: Die Anmeldung darf nie im Klartext durch ein Netz.

### Der macvlan-Haken

Die Batterien brauchen den Endpoint auf Port 443. Belegt dein Proxy 443 schon,
braucht der Endpoint eine eigene Adresse, üblicherweise über ein **macvlan**-Netz.
Docker lässt den Host, und damit den Proxy auf demselben Host, einen macvlan-
Container nicht erreichen. Gib dem Endpoint ein zweites Netz, das der Proxy teilt,
und lass die Standard-Route im LAN:

```yaml
services:
  marstek-offline-endpoint:
    environment:
      TRUST_PROXY: "172.18.0.0/16"        # das Subnetz des Netzes "proxy"
    networks:
      endpoint_lan:
        ipv4_address: 192.168.1.231
        gw_priority: 1                    # Standard-Route bleibt im LAN (Docker 28+)
      proxy: {}

networks:
  proxy:
    external: true
  endpoint_lan:
    driver: macvlan
    driver_opts:
      parent: eth0
    ipam:
      config:
        - subnet: 192.168.1.0/24
          gateway: 192.168.1.1
          ip_range: 192.168.1.231/32
```

Ohne `gw_priority` kann die Standard-Route im Proxy-Netz landen. Die Netzprüfung
schaltet sich dann selbst ab (das Log nennt den Grund), und die Update-Abfrage
ginge über das Proxy-Netz hinaus. Bei älterem Docker darauf achten, dass das
LAN-Netz zuerst sortiert, oder `ENDPOINT_GATEWAY` setzen.

Traefik als Datei-Route (das selbstsignierte Zertifikat der Oberfläche wird auf
dem Weg innerhalb des Hosts akzeptiert; `lan-only` steht für eine Erlaubnisliste
deiner eigenen Netze):

```yaml
http:
  routers:
    endpoint:
      entryPoints: [websecure]
      rule: "Host(`endpoint.example.org`)"
      middlewares: [lan-only@file]
      service: endpoint
      tls: {}
  services:
    endpoint:
      loadBalancer:
        passHostHeader: true
        serversTransport: endpoint-selfsigned@file
        servers:
          - url: "https://marstek-offline-endpoint:8443"
  serversTransports:
    endpoint-selfsigned:
      insecureSkipVerify: true
```

Nginx Proxy Manager und Caddy gehen genauso: an
`https://marstek-offline-endpoint:8443` weiterleiten, mit abgeschalteter
Zertifikatsprüfung für genau dieses Ziel.

**Nicht ins Internet stellen.** Die Oberfläche listet deine Geräte und deren
Adressen. Beschränke die Proxy-Route auf dein eigenes Netz, wie oben.
