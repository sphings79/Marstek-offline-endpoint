# Telegram: Bot, Bot-ID und Chat-ID

> 🇬🇧 English version: [TELEGRAM.md](TELEGRAM.md)

Die Kachel *Telegram* auf der Seite Benachrichtigungen braucht zwei Dinge: das **Token** eines Bots und die **Chat-ID** der
Unterhaltung, in die der Bot schreiben soll. Diese Seite zeigt, wie man beides bekommt, für einen privaten Chat mit dem Bot und für
eine Gruppe. Der Endpoint sendet nur; was du dem Bot schreibst, liest er nie.

## 1. Einen Bot erstellen

1. Öffne in Telegram **@BotFather** (den offiziellen, mit dem blauen Haken) und sende `/newbot`.
2. BotFather fragt nach einem **Namen** (wird im Chat angezeigt, beliebiger Text) und einem **Benutzernamen**. Der Benutzername muss
   einmalig sein und auf `bot` enden, zum Beispiel `marstek_endpoint_bot`.
3. BotFather antwortet mit dem **Token**, einer Zeile wie `123456789:AAH…`. Wer es hat, kann als dein Bot schreiben: Behalte es
   für dich. Gelangt es nach außen, sende `/revoke` an BotFather, wähle den Bot und trage das neue Token in der Kachel ein.
4. Füge das Token in das Feld **Bot-Token** der Telegram-Kachel ein. Es wird auf dem Server gespeichert und nie wieder angezeigt.

## 2. Die ID des Bots selbst

Normalerweise brauchst du sie nicht, der Endpoint arbeitet nur mit dem Token. Wenn du sie trotzdem willst: Sie ist die Zahl vor dem
Doppelpunkt im Token (`123456789` im Beispiel). Die Daten des Bots liefert auch:

```
https://api.telegram.org/bot<TOKEN>/getMe
```

Dort ist `"id"` die Bot-ID und `"username"` sein Name. Gib die Adresse nicht weiter, sie enthält das Token.

## 3. Chat-ID eines privaten Chats

1. Öffne deinen Bot in Telegram und schreibe ihm etwas, zum Beispiel `/start`. Ohne diesen Schritt darf ein Bot dir nicht schreiben.
2. Öffne diese Adresse im Browser, mit deinem Token hinter `bot` und ohne spitze Klammern:

   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

3. Suche in der Antwort `"chat":{"id":123456789,…,"type":"private"}`. Diese Zahl ist die Chat-ID. Bei einem privaten Chat ist sie
   gleich deiner Telegram-Benutzer-ID und positiv.
4. Trage sie in das Feld **Chat-ID** ein, schalte Telegram ein und drücke *Speichern und Telegram testen*.

Lautet die Antwort `"result":[]`, hat der Bot noch keine Nachricht bekommen (oder sie ist älter als 24 Stunden): Schreibe ihm noch
einmal und lade die Seite neu.

## 4. Chat-ID einer Gruppe

1. Füge den Bot der Gruppe hinzu (Gruppeninfo, *Mitglied hinzufügen*, nach dem Benutzernamen des Bots suchen).
2. Schreibe eine Nachricht, die der Bot sieht. Standardmäßig bekommt ein Bot in einer Gruppe nur Befehle und Nachrichten, die ihn
   erwähnen; sende also `/start@dein_bot_benutzername` (oder erwähne ihn mit `@dein_bot_benutzername hallo`). Ist der Bot
   Administrator der Gruppe, sieht er jede Nachricht.
3. Öffne die `getUpdates`-Adresse aus Schritt 3 und finde den Eintrag mit `"chat":{"id":-1001234567890,…,"type":"supergroup"}`
   (oder `"group"`). Die ID einer Gruppe ist **negativ**, bei einer Supergruppe beginnt sie mit `-100`. Kopiere die ganze Zahl mit dem
   Minuszeichen.
4. Trage sie in das Feld **Chat-ID** ein.

Hinweise:

- Wird eine Gruppe zur Supergruppe (das passiert, wenn man manche Funktionen einschaltet), ändert sich ihre Chat-ID. Dann noch einmal
  nachsehen.
- Ein Kanal funktioniert wie eine Gruppe: Den Bot als Administrator hinzufügen und die Kanal-ID (beginnt ebenfalls mit `-100`) oder
  bei einem öffentlichen Kanal `@Kanalname` nehmen.
- Nachrichten in einer Gruppe sieht jedes Mitglied. Die Nachrichten des Endpoints tragen den Gerätenamen, den du vergeben hast,
  nie eine Geräte-ID oder eine Adresse; überlege trotzdem, wer sie lesen soll.

## 5. Test

Drücke in der Kachel *Speichern und Telegram testen*. Die Nachricht *Testnachricht vom Marstek Offline Endpoint* sollte nach
wenigen Sekunden ankommen. Wenn nicht, zeigt die Kachel den HTTP-Status, mit dem Telegram geantwortet hat: `401` heißt falsches Token, `400` oder `403`
meist falsche Chat-ID oder ein Bot, dem nie geschrieben wurde (oder der aus der Gruppe entfernt wurde).
