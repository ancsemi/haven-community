# base64

Encode or decode Base64 text in chat: `/b64 encode hello` / `/b64 decode aGVsbG8=`.

## Commands

| Command | Description |
|---------|-------------|
| `/b64 encode <text>` | UTF-8 → Base64 |
| `/b64 decode <data>` | Base64 → UTF-8 (or hex if binary) |
| `/b64 e …` / `/b64 d …` | Shortcuts |
| `/base64 …` | Alias |

URL-safe Base64 (`-` / `_`) is accepted on decode.

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
cd haven-community/bots/base64
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
| `MAX_INPUT` | no | Max input length (default `1500`) |
| `MAX_OUTPUT` | no | Max output length (default `3000`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Results are public in the channel — do not paste secrets you care about.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
