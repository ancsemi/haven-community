# sticky

Keep a notice near the bottom of the channel: `/sticky set <text>`, then on **message** events the bot re-posts the sticky every `STICKY_EVERY_N` messages (default 15), with an optional minimum interval. Each re-post deletes the previous copy, so only one sticky is in the channel at a time.

> Haven has no true pin API here — this is a re-post approximation.

## Commands

| Command | Description |
|---------|-------------|
| `/sticky set <text>` | Set / replace sticky text and post it now (allowlist only) |
| `/sticky show` | Show the sticky text, privately to you |
| `/sticky clear` | Remove sticky and its copy in the channel (allowlist only) |
| `/sticky on` / `/sticky off` | Enable / disable re-posts (allowlist only) |
| `/sticky status` | Counter and preview, privately to you |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. **Callback URL:** `https://your-bot-host/haven`
3. **Callback Secret** = `CALLBACK_SECRET`
4. Enable **message** events.
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`
6. Optional: **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` (if empty, it is taken from the webhook URL; it is needed to delete old copies)
7. Put your staff's Haven user ids in `ALLOWED_USER_IDS`. This is required: with an empty list nobody can set, clear or toggle the sticky. If you don't know your id, run `/sticky set test` once and the bot tells you privately.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/sticky
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

Use Node 20.6 or newer. The `--env-file` flag is what loads your `.env`, and older Node versions do not have it.

If Haven reaches this bot at a `localhost` or LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server. Without it Haven refuses to call private addresses.

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
| `ALLOWED_USER_IDS` | yes | Comma-separated Haven user ids who may set, clear and toggle the sticky. Empty means nobody can |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Haven never sends bot or webhook messages to bots, so only messages from people count toward `STICKY_EVERY_N`.
- Counter resets after each successful re-post. Only one re-post runs at a time.
- The bot remembers the id of its current sticky copy in `STATE_FILE` and deletes that copy before the next one appears.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
