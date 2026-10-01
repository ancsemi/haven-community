# purge

Delete recent channel messages that this bot has **seen** via Haven `message` events.

Haven bots do not get a full message history API, so this bot keeps an in-memory **ring buffer** of recent message ids + content, then:

- `/purge match <substring>` — DELETE matching buffered messages  
- `/purge last <n>` — DELETE the last N **tracked** messages (not full channel history)

## Commands

| Command | Description |
|---------|-------------|
| `/purge match <substring>` | Delete tracked messages containing the text |
| `/purge last <n>` | Delete last N tracked messages (capped by `MAX_DELETE`) |
| `/purge status` | Show how many messages are buffered |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Subscribe to **`message`** events (and slash commands).
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
6. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` (**required** for DELETE).
7. Ensure the bot is allowed to delete messages (moderation / delete capability as required by your Haven version).

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/purge
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
| `BUFFER_SIZE` | no | Ring buffer capacity (default `200`) |
| `MAX_DELETE` | no | Max deletes per command (default `25`) |
| `ALLOWED_USER_IDS` | no | Comma-separated user ids; empty = anyone |
| `HAVEN_WEBHOOK_TOKEN` | yes* | Token for message DELETE + slash (*required in practice) |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Only messages received **after** the bot started (and while it is running) can be purged.
- Deletes use `DELETE /api/webhooks/<token>/messages/<id>`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
