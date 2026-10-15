# Eine neue Control-Firmware prüfen

> 🇬🇧 English version: [NEW-FIRMWARE.md](NEW-FIRMWARE.md)

Die Seite Messwerte benennt jeden Schlüssel des Cloud-Uploads. Diese Namen wurden an einem Venus D mit Control-Firmware 151
geprüft und aus dem Firmware-Code von zehn dekompilierten Versionen gelesen. Erscheint eine neue Control-Firmware, prüft man,
ob die Schlüssel noch dasselbe bedeuten. Mit dem Skript in `tools/` dauert das wenige Minuten.

## Was das Skript tut

Der Upload ist ein einziger `sprintf` in `Cloud_UploadTelemetryData`. Der Decompiler zeigt nur dessen erste Argumente.
`tools/fw-key-sources.py` liest den Rest aus dem Assembler-Listing, ordnet jedes Argument dem Telemetrie-Verlaufssatz zu und
dann dem Code, der das Feld füllt (der Struct-Builder für Einzelwerte, der String-Formatter für die Kommalisten). Ergebnis je
Schlüssel: die Live-Variable, aus der er stammt, ihre Breite und ihr Vorzeichen. Dann vergleicht es jede Version mit einer
Referenzversion und gibt nur aus, was abweicht.

Python 3 mit der Standardbibliothek; nichts zu installieren.

## Schritte

1. **Dekompilieren** der neuen Control-Firmware so, wie es das Reverse-Engineering-Projekt macht (ein Ordner je Version mit den
   `.c`-Dateien und einem Ordner `listing/`; der Ordnername enthält `Control`).
2. **Skript laufen lassen** über alle Versionen, gegen die Venus-D-Referenz:

   ```bash
   python3 tools/fw-key-sources.py --root <Dekompilate-Ordner> --ref VNSD_Control_v151
   ```

   `--json <Ordner>` schreibt zusätzlich eine Datei je Version mit dem Rohergebnis. Ordnernamen auf der Kommandozeile
   begrenzen den Lauf.
3. **Bericht lesen.** Er hat drei Teile:
   - *keys sent*: die Schlüssel einer Version und die Referenzschlüssel, die ihr fehlen. Ein neuer Schlüssel steht unter *extra*.
   - *keys whose source differs*: je Schlüssel die Quelle der Referenz und die andere. Casts, lokale Variablennamen (`uVar2`)
     und `_g_`-Präfixe sind entfernt; was bleibt, ist ein echter Unterschied oder eine vom Analysten umbenannte Variable.
   - *could not be traced*: Argumente, denen das Skript nicht folgen konnte. Die prüft man im Listing von Hand.
4. **Jeden Unterschied beurteilen.** Ein anderer Name an derselben Stelle des Satzes mit denselben Nachbarn ist meist eine
   Umbenennung. Eine andere Variable, eine Konstante statt einer Variable, eine andere Breite oder eine andere Anzahl
   Listenelemente ist eine geänderte Bedeutung.
5. **Im Endpoint nachziehen.**
   - Neuer Schlüssel: in `SEED` in `src/keydefs.cjs` ergänzen (`F(...)` für „aus der Firmware gelesen"), mit Beschreibung und den
     Versionen, die ihn senden.
   - Gleicher Schlüssel, andere Bedeutung bei einem Modell oder einer Firmware: eine Zeile in `MODEL_SEED` in `src/keydefs.cjs`
     (`[key, model, fw, name, unit, scale, category, fmt, evidence, description]`; `fw` `'*'` für alle Firmware des Modells).
     Zeilen aus dem Firmware-Code gelten nicht als geprüft.
   - Schlüssel, die eine Version nicht mehr sendet, brauchen keine Änderung.
   - Den Kommentar oben in `src/keydefs.cjs` anpassen, dann ein Web-Release (siehe `RELEASING.de.md`): `src/keydefs.cjs` gehört zum
     Web-Bündel, ein neues Image ist nicht nötig.
6. **Einheit und Skalierung gegen Modbus prüfen.** Der Upload-Code liefert die Bedeutung, die Registerkarte die Einheit. Jedes
   Upload-Argument ist eine Kopie einer Firmware-Variable, und die Modbus-Deskriptortabelle derselben Firmware sagt, welches
   Register diese Variable ausliefert, mit welcher Skalierung und Einheit. `tools/fw-key-units.py` verbindet beides über die
   RAM-Adresse der Variable und vergleicht mit `src/keydefs.cjs`:

   ```bash
   python3 tools/fw-key-sources.py --root <Dekompilate-Ordner> --json traces
   python3 tools/fw-key-units.py --root <Dekompilate-Ordner> --folder VNSD_Control_v151 --traces traces \
       --registers <VNSD_Register_Map_Final_generated.csv> --column source_ptr_v151
   ```

   `OK` heißt: Die Registerkarte stimmt mit `src/keydefs.cjs` überein. `DIFF` heißt: nicht (`src/keydefs.cjs` korrigieren oder das
   Register ansehen). `NOREG` heißt: Kein Register liefert die Variable aus (Zellstatistik, CT-Leistung, MPPT-Ertrag, interne
   Zustände); Einheit und Skalierung beruhen dann auf dem Upload-Code und der Prüfung in Schritt 7. `NOVAR` heißt: Das Argument
   wird aus mehreren Variablen berechnet; den Formatter-Code von Hand lesen (die PV-Leistung ist so ein Fall: Die Firmware sendet
   den Registerwert in 0,1 W, oder 0 unter 101). Argumente mit einer Division (`/ 10`) werden verarbeitet, andere Rechnungen nicht.
7. **Am Gerät prüfen.** Keines der Skripte vergleicht Live-Daten. Einheit und Skalierung der Schlüssel ohne Register lassen sich
   nur an einem Gerät prüfen, das die Version fährt (ein Modbus-Wert in Home Assistant ist die beste Referenz). Bis dahin bleibt
   die Zeile *aus dem Firmware-Code*, nicht *geprüft*.

## Grenzen

- Das Skript erwartet die Ordnerstruktur des Reverse-Engineering-Projekts und liest den ersten `sprintf`-Aufruf, dessen Format
  mit `di=%s&sn=%s&to=%d` beginnt. Ändert eine Version den Aufbau des Uploads, meldet das Skript für diesen Ordner einen Fehler
  und macht mit den anderen weiter.
- Es liest bisher Thumb-2-Listings der Cortex-M-Builds. Ein anderes Compiler-Layout kann einzelne Schlüssel *unresolved*
  lassen; der Bericht führt sie auf.
- Binaries ohne Dekompilat sind nicht erfasst. Zuerst dekompilieren.
