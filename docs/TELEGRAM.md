# Telegram: bot, bot ID and chat ID

> 🇩🇪 Deutsche Version: [TELEGRAM.de.md](TELEGRAM.de.md)

The *Telegram* tile on the Notifications page needs two things: the **token** of a bot and the **chat ID** of the conversation the
bot should write to. This page shows how to get both, for a private chat with the bot and for a group. The endpoint only sends
messages; it never reads what you write to the bot.

## 1. Create a bot

1. In Telegram open **@BotFather** (the official one, with the blue check) and send `/newbot`.
2. BotFather asks for a **name** (shown in the chat, any text) and a **username**. The username must be unique and end in `bot`,
   for example `marstek_endpoint_bot`.
3. BotFather answers with the **token**, a line like `123456789:AAH…`. Whoever has it can write as your bot: keep it to yourself.
   If it leaks, send `/revoke` to BotFather, pick the bot and enter the new token in the tile.
4. Paste the token into the field **Bot token** of the Telegram tile. It is stored on the server and never shown again.

## 2. The ID of the bot itself

You normally do not need it, the endpoint works with the token alone. If you want it anyway: it is the number in front of the
colon in the token (`123456789` in the example). The bot's own data also comes from:

```
https://api.telegram.org/bot<TOKEN>/getMe
```

where `"id"` is the bot ID and `"username"` its name. Do not share the address, it contains the token.

## 3. Chat ID of a private chat

1. Open your bot in Telegram and write it something, for example `/start`. Without this step a bot is not allowed to write to you.
2. Open this address in a browser, with your token behind `bot` and no angle brackets:

   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

3. In the answer look for `"chat":{"id":123456789,…,"type":"private"}`. That number is the chat ID. For a private chat it equals your
   Telegram user ID and is positive.
4. Enter it in the field **Chat ID**, switch Telegram on and press *Save and test Telegram*.

If the answer is `"result":[]`, the bot has not received a message yet (or the messages are older than 24 hours): write to it
again and reload.

## 4. Chat ID of a group

1. Add the bot to the group (group info, *Add member*, search for the bot's username).
2. Write a message that the bot sees. By default a bot in a group only gets commands and messages that mention it, so send
   `/start@your_bot_username` (or mention it with `@your_bot_username hello`). If the bot is an administrator of the group it sees
   every message.
3. Open the `getUpdates` address from step 3 and find the entry with `"chat":{"id":-1001234567890,…,"type":"supergroup"}` (or
   `"group"`). The ID of a group is **negative**, a supergroup's starts with `-100`. Copy the whole number including the minus sign.
4. Enter it in the field **Chat ID**.

Notes:

- When a group is turned into a supergroup (it happens when you switch on some features), its chat ID changes. Look it up again.
- A channel works like a group: add the bot as an administrator, and use the channel ID (also starts with `-100`) or `@channelname`
  for a public channel.
- Messages in a group are visible to every member. The endpoint's messages carry the device name you gave, never a device ID or an
  address, but think about who should read them.

## 5. Test

Press *Save and test Telegram* in the tile. The message *Test message from the Marstek Offline Endpoint* should arrive within a
few seconds. If not, the tile shows the HTTP status Telegram answered with: `401` means a wrong token, `400` or `403` usually a wrong chat ID or a
bot that was never written to (or that was removed from the group).
