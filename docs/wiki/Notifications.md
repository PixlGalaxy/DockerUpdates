# Notifications

Configure them in **Settings > Notifications**. Every channel has a **Test** button, and secrets (webhook URLs, tokens) are never sent back to the browser.

## Events

| Event | Sent when |
| --- | --- |
| Update available | A scheduled check found a new image (once per new version) |
| Container updated | A container was updated |
| Update failed | An update or a check failed (e.g. registry login required) |
| Image cleanup | Old images were removed, with the space freed |
| Health alerts | A container becomes unhealthy, is healthy again, crashes, or keeps restarting |

**Include manual actions**: also notify about updates you start from the UI, not only automatic runs.

## Discord

1. In your Discord server: *Server Settings > Integrations > Webhooks > New Webhook*, choose the channel and **Copy Webhook URL**.
2. Paste it in **Webhook URL** (`https://discord.com/api/webhooks/…`).
3. Optional **Mention**: `@here`, `<@USER_ID>` or `<@&ROLE_ID>` to ping someone.

Messages are rich embeds with the container, the version change and the host.

## Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the **bot token** (`123456789:AA…`).
2. Send any message to your bot (or add it to a group / channel).
3. Get the **chat ID**: open `https://api.telegram.org/bot<token>/getUpdates` and look for `"chat":{"id":…}`. Groups start with `-100`; public channels can use `@channelname`.

## ntfy

1. **Topic URL**: `https://ntfy.sh/<a-hard-to-guess-topic>` or your own server.
2. **Access token** (optional) for protected topics (`tk_…`).
3. Subscribe to the same topic in the ntfy app.

Failed updates are sent with high priority.

## Webhook

A `POST` with a JSON body to any URL (Home Assistant, n8n, your own API…):

```json
{
  "event": "updated",
  "title": "Containers updated",
  "message": "1 container was updated automatically.",
  "items": [{ "name": "jellyfin", "image": "jellyfin/jellyfin:latest", "from": "10.9.0", "to": "10.9.1" }],
  "trigger": "auto",
  "host": "tower",
  "timestamp": "2026-10-06T04:00:12.345Z"
}
```

`event` is one of `update-available`, `updated`, `update-failed`, `cleanup`, `unhealthy`, `recovered`, `crashed`, `test`.

With a **Secret**, every request carries `X-DockerUpdates-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw body with your secret. Verify it before trusting the request, for example in Node.js:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-dockerupdates-signature']))
```
