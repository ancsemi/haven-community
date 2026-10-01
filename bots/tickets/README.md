# tickets

Simple support-ticket bot for Haven — open a ticket card in-channel, list open ones, close by id.

## Commands

| Command | Description |
|---------|-------------|
| `/ticket open <subject>` | Open a ticket and post a card |
| `/ticket close [id]` | Close a ticket you opened (id optional if you have exactly one open). Staff can close any ticket. |
| `/ticket list` | List open tickets |

### Example

```
/ticket open Cannot join voice after update
```

Bot posts:

```
🎫 **Ticket #1** — open
**Subject:** Cannot join voice after update
_Opened by alice · 2026-08-06T12:00:00.000Z_
Close: `/ticket close 1`
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
5. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for slash registration.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/tickets
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

Requires Node 20.6 or newer (for `--env-file`).

If the bot runs on the same machine as Haven or on your local network (a `localhost` or LAN callback URL), the Haven server must have `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` set, or it will refuse to call the bot.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `STATE_FILE` | no | Ticket state path (default `./data/tickets-state.json`) |
| `MAX_OPEN` | no | Max concurrent open tickets (default `50`) |
| `MAX_CLOSED_KEEP` | no | Closed tickets retained in state (default `100`) |
| `STAFF_USER_IDS` | no | Comma-separated Haven user ids allowed to close anyone's ticket. Empty means people can only close their own. |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Open tickets persist across restarts via `STATE_FILE`.
- Ticket cards are posted publicly to the bot's channel.
- `/ticket close` without an id closes your only open ticket (if exactly one).
- Only the person who opened a ticket, or someone listed in `STAFF_USER_IDS`, can close it. Anyone else gets an error.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
