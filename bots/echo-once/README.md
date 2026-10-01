# echo-once

`/echo <text>` re-posts your text as the bot.

- If the slash callback includes a user / `recipient_id` **and** `PREFER_EPHEMERAL=true`, the webhook POST sets `ephemeral: true` and `recipient_id` for a private-style reply (when Haven supports it).
- Otherwise the message is public in the channel.
- If ephemeral is rejected by the API, the bot **falls back to a public post**.

## Commands

| Command | Description |
|---------|-------------|
| `/echo <text>` | Echo text (ephemeral when possible) |
| `/say-echo <text>` | Alias |

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
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `PREFER_EPHEMERAL` | no | Use ephemeral when recipient known (default `true`) |
| `FORCE_EPHEMERAL` | no | Always request ephemeral when recipient present (default `false`) |
| `MAX_LENGTH` | no | Max text length (default `2000`) |
| `PREFIX` | no | Optional string prepended to echo |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Recipient is taken from `payload.recipient_id`, `payload.user.id`, or `user_id` fields.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
