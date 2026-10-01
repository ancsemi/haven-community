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
# edit .env and set MODERATOR_USER_IDS
node --env-file=.env server.js
```

Requires Node 20.6 or newer (for `--env-file`).

If the bot runs on the same machine as Haven or on your local network (a `localhost` or LAN callback URL), the Haven server must have `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` set, or it will refuse to call the bot.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `MODERATOR_USER_IDS` | yes | Comma-separated Haven user ids allowed to warn/clear. If empty, nobody can (the bot logs a warning at startup). |
| `APPROVER_USER_IDS` | no | Alias for `MODERATOR_USER_IDS` |
| `STATE_FILE` | no | JSON path (default `./data/warns-state.json`) |
| `MAX_WARNS_PER_USER` | no | Cap per user (default `50`) |
| `MAX_TARGETS` | no | Max number of different people with warns on file (default `1000`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Target is free-form text (user id or username string) so it works without a member lookup API.
- Not a real mute — log only.
- Only ids in `MODERATOR_USER_IDS` can issue or clear warns. Leaving it empty locks those commands for everyone; `/warns` still works.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
