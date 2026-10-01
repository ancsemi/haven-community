# rsvp

Simple event RSVP for Haven: create an event, collect yes / no / maybe, show tallies.

## Commands

| Command | Description |
|---------|-------------|
| `/event create <title>` | Create an open event |
| `/event rsvp <id> yes\|no\|maybe` | Record your RSVP |
| `/event show <id>` | Show title, counts, and names |
| `/event list` | List open events |
| `/event close <id>` | Close (no more RSVPs). Host or `ADMIN_USER_IDS` only |
| `/event delete <id>` | Remove event. Host or `ADMIN_USER_IDS` only |
| `/rsvp <id> yes\|no\|maybe` | Shortcut for RSVP |

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
cd haven-community/bots/rsvp
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
| `STATE_FILE` | no | JSON path (default `./data/rsvp-state.json`) |
| `MAX_EVENTS` | no | Cap on stored events (default `50`). Oldest closed events are pruned first; open events are never pruned |
| `ADMIN_USER_IDS` | no | Comma-separated Haven user ids who may close or delete any event. Empty means only each event's host can |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- RSVPs are keyed by Haven user id, one per account; changing your response overwrites it.
- The person who creates an event is its host and can always close or delete it.
- Accepts aliases: `y`/`going` → yes, `n`/`nope` → no, `m`/`interested` → maybe.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
