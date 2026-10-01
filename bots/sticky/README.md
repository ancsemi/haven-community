# sticky

Keep a notice near the bottom of the channel: `/sticky set <text>`, then on **message** events the bot re-posts the sticky every `STICKY_EVERY_N` messages (default 15), with an optional minimum interval.

> Haven has no true pin API here — this is a re-post approximation.

## Commands

| Command | Description |
|---------|-------------|
| `/sticky set <text>` | Set / replace sticky text |
| `/sticky show` | Post sticky now |
| `/sticky clear` | Remove sticky |
| `/sticky on` / `/sticky off` | Enable / disable re-posts |
| `/sticky status` | Counter and preview |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. **Callback URL:** `https://your-bot-host/haven`
3. **Callback Secret** = `CALLBACK_SECRET`
4. Enable **message** events.
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`
6. Optional: **Webhook Token** → `HAVEN_WEBHOOK_TOKEN`

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/sticky
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
| `STICKY_EVERY_N` | no | Messages between re-posts (default `15`) |
| `MIN_SECONDS_BETWEEN` | no | Extra cooldown seconds (default `30`) |
| `MAX_LENGTH` | no | Max sticky length (default `1500`) |
| `PREFIX` | no | Header above sticky text |
| `STATE_FILE` | no | JSON path (default `./data/sticky-state.json`) |
| `ALLOWED_USER_IDS` | no | Who may set/clear (empty = anyone) |
| `ALLOW_BOTS` | no | Count bot messages (default `false`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Bot messages are ignored for the counter unless `ALLOW_BOTS=true`.
- Counter resets after each successful re-post.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
