# birthday

Members set their birthday with `/birthday set MM-DD`. Once per calendar day (in `TIMEZONE`, at/after `ANNOUNCE_HOUR`) the bot posts a happy-birthday list to the channel.

## Commands

| Command | Description |
|---------|-------------|
| `/birthday set MM-DD` | Save your birthday (also `3/14`, `03-14`) |
| `/birthday remove` | Remove yours |
| `/birthday list` | List all stored birthdays |
| `/birthday when [user]` | Look up you or someone else |
| `/birthday today` | Who has a birthday today (no wait for announce) |
| `/birthday MM-DD` | Shortcut for `set` |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. **Callback URL:** `https://your-bot-host/haven`
3. **Callback Secret** = `CALLBACK_SECRET`
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`
5. Optional: **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for slash registration

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/birthday
npm install
cp .env.example .env
# edit .env
node server.js
```

Keep the process running so the daily check can fire. Manual force: `POST /announce`.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `TIMEZONE` | no | IANA zone (default `UTC`) |
| `ANNOUNCE_HOUR` | no | Local hour 0–23 after which announce may run (default `9`) |
| `CHECK_INTERVAL_MS` | no | How often to re-check (default 15 min) |
| `STATE_FILE` | no | JSON path (default `./data/birthday-state.json`) |
| `MESSAGE_TEMPLATE` | no | Placeholders `{names}` `{date}` `{timezone}` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- State keyed by user id when available, else username.
- Announces at most once per `YYYY-MM-DD` in `TIMEZONE` (stored as `lastAnnounceDate`).
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
