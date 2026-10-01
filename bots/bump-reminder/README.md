# bump-reminder

Disboard-style bump timer for Haven. After someone runs `/bump`, the bot waits `BUMP_EVERY_HOURS` (default **2**) and posts a reminder in the channel. One reminder per cycle until the next `/bump`.

## Commands

| Command | Description |
|---------|-------------|
| `/bump` | Record that you just bumped |
| `/bump status` | Show last bump and next reminder |
| `/bump set <hours>` | Change interval (persisted in state) |

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
cd haven-community/bots/bump-reminder
npm install
cp .env.example .env
# edit .env
node server.js
```

Keep the process running so the interval checker can fire. Manual remind: `POST /remind`.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `BUMP_EVERY_HOURS` | no | Default interval hours (default `2`) |
| `CHECK_INTERVAL_MS` | no | How often to check due reminders (default `60000`) |
| `STATE_FILE` | no | JSON path (default `./data/bump-reminder-state.json`) |
| `REMIND_MESSAGE` | no | Channel message when due |
| `BUMP_ACK_MESSAGE` | no | Reply after `/bump` (`{hours}` `{when}` `{user}`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Does **not** call Disboard; you still bump on the listing site, then `/bump` here.
- After a due reminder posts, it will not re-post until another `/bump`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
