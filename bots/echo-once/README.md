# echo-once

`/echo <text>` re-posts your text as the bot.

- With `PREFER_EPHEMERAL=true` (the default), the webhook POST sets `ephemeral: true` and `recipient_id` to the caller's id, so only the person who ran the command sees the reply.
- With `PREFER_EPHEMERAL=false`, the message is public in the channel.
- If the private reply fails, the bot posts a short error instead. It never reposts your text in public.

## Commands

| Command | Description |
|---------|-------------|
| `/echo <text>` | Echo text back to you privately |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. **Callback URL:** `https://your-bot-host/haven`
3. **Callback Secret** = `CALLBACK_SECRET`
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`
5. Optional: **Webhook Token** → `HAVEN_WEBHOOK_TOKEN`

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/echo-once
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

This needs Node 20.6 or newer, which loads `.env` through `--env-file`.

If the bot runs on localhost or a LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server. Otherwise Haven's SSRF guard drops the slash command callbacks.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `PREFER_EPHEMERAL` | no | Reply privately to the caller (default `true`) |
| `FORCE_EPHEMERAL` | no | Always reply privately, even when `PREFER_EPHEMERAL=false` (default `false`) |
| `MAX_LENGTH` | no | Max text length (default `2000`) |
| `PREFIX` | no | Optional string prepended to echo |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- The recipient is the caller, taken from `payload.author.id` on the slash command callback.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
