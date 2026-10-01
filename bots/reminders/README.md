# reminders

Schedule channel reminders from Haven chat — Carl / YAGPDB-style `/remind` for self-hosted Haven.

Persists pending reminders to disk and fires them by POSTing to the bot webhook when due.

## Commands

| Command | Description |
|---------|-------------|
| `/remind <duration> <text>` | Schedule a reminder (e.g. `10m`, `2h`, `1d`) |
| `/remind cancel <id>` | Cancel a pending reminder by id |
| `/reminders list` | List pending reminders |
| `/reminders` | Same as list |

### Duration units

- `s` — seconds
- `m` — minutes
- `h` — hours
- `d` — days
- `w` — weeks

Examples: `30s`, `10m`, `2h`, `1d`, `1w`.

## What the message looks like

When due:

```
⏰ **Reminder** (from Ada)
Stand up and stretch!
```

When created:

```
✅ Reminder **#12** set for in 10m (2026-04-01T12:34:00.000Z)
Stand up and stretch!
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the target channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** to a long random string; put the same value in `.env` as `CALLBACK_SECRET`.
4. Copy the full **Webhook URL** into `HAVEN_WEBHOOK_URL`.
5. Copy the **Webhook Token** into `HAVEN_WEBHOOK_TOKEN` so the bot can register `/remind` and `/reminders`.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/reminders
npm install
cp .env.example .env
# edit .env
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret matching the bot’s callback secret |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `STATE_FILE` | no | Pending reminders path (default `./data/reminders-state.json`) |
| `TICK_INTERVAL_MS` | no | How often to check due reminders (default `5000`) |
| `MAX_REMINDERS` | no | Cap on stored reminders (default `200`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Reminders survive process restarts via `STATE_FILE`.
- Fired reminders are removed from state after a successful post.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
