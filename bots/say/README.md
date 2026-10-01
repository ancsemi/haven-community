# say

Re-post text into the channel **as the bot** with `/say <text>`. Useful for staff announcements without showing the operator’s username.

## Commands

| Command | Description |
|---------|-------------|
| `/say <text>` | Post `text` as the bot |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
5. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for slash registration.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/say
npm install
cp .env.example .env
# edit .env — set ALLOWED_USER_IDS for staff-only use
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `ALLOWED_USER_IDS` | no | Comma-separated user ids; empty = anyone |
| `MAX_LENGTH` | no | Max text length (default `2000`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Posts exactly the provided text (truncated) via the bot webhook.
- Restrict who can announce with `ALLOWED_USER_IDS`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
