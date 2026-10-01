# uuid-tool

Generate secure random **UUID v4** values: `/uuid` or `/uuid 5`.

Uses Node `crypto.randomUUID()` when available (fallback: `randomBytes` RFC 4122).

## Commands

| Command | Description |
|---------|-------------|
| `/uuid` | One UUID v4 |
| `/uuid <n>` | Up to `MAX_COUNT` UUIDs |
| `/guid …` | Alias |

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
cd haven-community/bots/uuid-tool
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
| `MAX_COUNT` | no | Max UUIDs per call (default `10`, hard max 50) |
| `DEFAULT_COUNT` | no | When no arg (default `1`) |
| `UPPERCASE` | no | `true` for uppercase hex (default `false`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
