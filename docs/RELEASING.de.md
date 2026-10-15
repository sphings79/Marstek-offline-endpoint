# Releases veröffentlichen

> 🇬🇧 English version: [RELEASING.md](RELEASING.md)

Zwei Arten von Release, ein Repository.

| Release | Tag | Was es ist | Wie es zum Endpoint kommt |
|---|---|---|---|
| Container | `vX.Y.Z` | ein neues Image (der Workflow baut es für alle Architekturen) | du holst es, der Container startet neu |
| Web | `web-vX.Y.Z` | nur die Web-Seite: drei signierte Dateien | der Besitzer drückt auf der Update-Karte *Installieren*, kein Container-Neustart |

Beide erscheinen mit ihren Versionshinweisen auf der Update-Karte. Die Versionshinweise sind das Änderungsprotokoll, das die
Leute lesen, schreib sie also für den Besitzer eines Endpoints.

## Ein Web-Release

1. Code ändern. `version` in `src/web-version.json` erhöhen (und `minContainer`, wenn die neue Web-Seite etwas braucht, das erst ein
   neueres Image liefert, zum Beispiel ein neues Feld in der Verständigung zwischen den beiden Prozessen; ändert sich die
   Verständigung selbst, müssen auch `IPC_VERSION` in `src/supervisor.cjs`, `src/webproc.cjs` und `tools/make-web-bundle.cjs` wechseln, was
   ein neues Image und ein Release beider Arten braucht).
2. Die drei Dateien bauen und signieren:

   ```bash
   node tools/make-web-bundle.cjs --key ~/.config/marstek-endpoint/web-signing.key
   ```

   Das schreibt `dist/marstek-endpoint-web-X.Y.Z.tar.gz`, `.manifest.json` und `.manifest.sig`.
3. Ein Release **mit dem Tag `web-vX.Y.Z`** veröffentlichen, die drei Dateien als Anhänge und das Änderungsprotokoll als Text:

   ```bash
   gh release create web-vX.Y.Z dist/marstek-endpoint-web-X.Y.Z.* --title "Web X.Y.Z" --notes-file notes.md
   ```

   Nicht als Vorabversion oder Entwurf markieren: Der Endpoint ignoriert beides.
4. Das nächste Image sollte dieselbe Web-Version tragen (das Dockerfile kopiert die Dateien und `src/web-version.json`); ein
   installiertes Update, das nicht neuer ist als die Dateien des Images, wird ignoriert.

## Vor dem ersten Release: noch nicht gegen echte Dienste getestet

Alles Folgende wurde nur gegen Mock-Server oder gar nicht getestet. Jeden Punkt abhaken, sobald er echt funktioniert hat.

- [x] Pushover (getestet am 2026-10-15)
- [x] Telegram: Bot-Token und Chat-ID, Test-Knopf (getestet am 2026-10-15; ein echter Vorfall noch nicht)
- [x] Home Assistant notify (getestet am 2026-10-15): Der Dienstname braucht das Präfix `mobile_app_` vollständig (`notify.mobile_app_<Gerät>` in den
      Entwicklerwerkzeugen, Aktionen). Ein falscher Name liefert HTTP 404, das der Test so anzeigt
- [x] Webhook: JSON und Klartext gegen einen echten HTTP-Server, mit Authorization-Header (getestet am 2026-10-15; ohne Header nicht versucht)
- [x] MQTT-Messwerte: Modus *ergänzen* läuft gegen einen echten Broker (getestet am 2026-10-15: Entitäten erscheinen mit Einheit und Geräteklasse, Schlüssel, die schon per Modbus kommen, fehlen erwartungsgemäß); die eigene Auswahl läuft auch (getestet am 2026-10-15 mit zwei Schlüsseln: nur diese beiden Entitäten bleiben, die früheren verschwinden); *alle* wurde nicht getestet (gleicher Weg wie *ergänzen*, nur ohne Filter)
- [ ] Ein Web-Update aus einem echten signierten Release installieren: `web-vX.Y.Z` veröffentlichen, *Installieren* drücken, die neue
      Web-Version und den Rückweg prüfen und prüfen, dass eine veränderte Datei abgelehnt wird. Vorher den Signaturschlüssel sichern
- [ ] Die Update-Prüfung gegen echte Releases: die Zeilen für Container und Web auf den Update-Karten und ihre Benachrichtigungen
- [x] `APP_VERSION`: jetzt ein Build-Argument in Dockerfile und Image-Workflow (`vX.Y.Z` bei einem Tag, `dev+<Commit>` bei main) (getestet mit dem v2.0.0-Image, 2026-10-16)
- [x] Die Screenshots in der Doku zeigen Version 2.0.0 (aufgenommen am 2026-10-16)

## Der Signaturschlüssel

Der Endpoint installiert ein Web-Update nur, wenn die Ed25519-Signatur des Manifests mit `src/webupdate.pub` stimmt, das Teil des
Images ist. Der **private Schlüssel gehört nicht ins Repository** und darf dort nicht liegen: Bewahre ihn dort auf, wo nur du ihn
lesen kannst (`~/.config/marstek-endpoint/web-signing.key`, Rechte 600), und sichere ihn. Ohne ihn lässt sich kein Web-Release
machen; mit ihm kann jeder eines machen. Geht er verloren oder gelangt er nach außen, ein neues Paar erzeugen, `src/webupdate.pub`
ersetzen, ein **neues Image** veröffentlichen und die Nutzer bitten, es zu holen: Ältere Images vertrauen weiter dem alten
Schlüssel.

```bash
node -e "const c=require('crypto'),fs=require('fs');const k=c.generateKeyPairSync('ed25519');
fs.writeFileSync('web-signing.key',k.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
fs.writeFileSync('src/webupdate.pub',k.publicKey.export({type:'spki',format:'pem'}))"
```

Der Signaturschlüssel und sein Pfad stehen in `SIGNATURSCHLUESSEL.md`; die Datei steht in `.gitignore` und bleibt aus dem öffentlichen Repository heraus.

## Entwickeln ohne Image-Build

`tools/dev-push.sh user@dockerhost /Host/Pfad/zu/data` kopiert die aktuellen Web-Dateien als immer benutztes Update in den
Datenordner eines laufenden Endpoints und startet nur den Web-Prozess neu. Der Endpoint, der die Batterien beantwortet, wird nicht
berührt. Das ist ein Test-Stand, kein Release: Er ist nicht signiert. Der Datenordner ist der, der unter `/data` eingebunden ist.
