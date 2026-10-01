# warns

Staff warning log for Haven. Records reasons in a local `STATE_FILE` — **does not** mute, kick, or ban (combine with `moderation` if you need real actions).

## Commands

| Command | Description |
|---------|-------------|
| `/warn <userId> <reason>` | Issue a warning |
| `/warns <userId>` | List warnings for a user |
| `/warn list <userId>` | Same as `/warns` |
| `/warn clear <userId>` | Clear all warns for a user |
| `/warn clear <userId> <id>` | Clear one warn by id |

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
cd haven-community/bots/warns
npm install
cp .env.example .env
# edit .env — set MODERATOR_USER_IDS in production
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `MODERATOR_USER_IDS` | no | Comma-separated ids allowed to warn/clear (empty = open) |
| `APPROVER_USER_IDS` | no | Alias for `MODERATOR_USER_IDS` |
| `STATE_FILE` | no | JSON path (default `./data/warns-state.json`) |
| `MAX_WARNS_PER_USER` | no | Cap per user (default `50`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Target is free-form text (user id or username string) so it works without a member lookup API.
- Not a real mute — log only.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
