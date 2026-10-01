# purge

Delete recent channel messages that this bot has **seen** via Haven `message` events.

Haven bots do not get a full message history API, so this bot keeps an in-memory **ring buffer** of recent message ids + content, then:

- `/purge match <substring>` — DELETE matching buffered messages  
- `/purge last <n>` — DELETE the last N **tracked** messages (not full channel history)

## Commands

| Command | Description |
|---------|-------------|
| `/purge match <substring>` | Delete tracked messages containing the text |
| `/purge last <n>` | Delete last N tracked messages (capped by `MAX_DELETE`, at most 20) |
| `/purge status` | Show how many messages are buffered |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Subscribe to **`message`** events (and slash commands).
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
6. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` (**required** for DELETE).
7. Put your moderators' Haven user ids in `ALLOWED_USER_IDS`. This is required: with an empty list nobody can use `/purge`. If you don't know your id, run `/purge` once and the bot tells you privately.

No moderation permission is needed on the Haven bot. Haven lets any bot delete single messages in its own channel with its webhook token, which is also why the allowlist matters.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/purge
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
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `BUFFER_SIZE` | no | Ring buffer capacity (default `200`) |
| `MAX_DELETE` | no | Max deletes per command (default `20`, never more than `20`) |
| `ALLOWED_USER_IDS` | yes | Comma-separated Haven user ids allowed to purge. Empty means nobody can |
| `HAVEN_WEBHOOK_TOKEN` | yes* | Token for message DELETE + slash (*required in practice) |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Only messages received **after** the bot started (and while it is running) can be purged.
- Haven never sends bot or webhook messages to bots, so the bot cannot see or purge other bots' messages.
- Deletes use `DELETE /api/webhooks/<token>/messages/<id>`, one message per request.
- Haven allows 30 webhook requests per minute per IP, so deletes are spaced 2.5 seconds apart. A full purge of 20 messages takes about 50 seconds, and only one purge runs at a time.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
