# quotes

Community quote book for Haven — add, list, fetch by id, or pick a random quote.

## Commands

| Command | Description |
|---------|-------------|
| `/quote add <text>` | Save a quote |
| `/quote random` | Random quote |
| `/quote get <id>` | Quote by id |
| `/quote list` | Recent quotes (preview) |

Bare `/quote <text>` (without a subcommand keyword) also adds a quote.

### Example

```
/quote add Never tell me the odds.
/quote random
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
cd haven-community/bots/quotes
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
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `STATE_FILE` | no | Quote state path (default `./data/quotes-state.json`) |
| `MAX_QUOTES` | no | Max stored quotes (default `500`) |
| `LIST_LIMIT` | no | Max rows in `/quote list` (default `15`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Quotes persist across restarts via `STATE_FILE`.
- Oldest quotes are pruned when over `MAX_QUOTES`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
