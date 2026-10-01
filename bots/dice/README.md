# dice

Classic RPG dice for Haven: `/dice NdM+K` with cryptographically random faces.

## Commands

| Command | Description |
|---------|-------------|
| `/dice [notation]` | Roll dice (default `1d20` if omitted) |

Haven has its own built-in `/roll`, so this bot uses `/dice`.

### Notation

| Example | Meaning |
|---------|---------|
| `d20` | one 20-sided die |
| `2d6` | two six-siders |
| `4d6+2` | four d6 plus 2 |
| `1d8-1` | one d8 minus 1 |

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
cd haven-community/bots/dice
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

Needs Node 20.6 or newer (`--env-file` is what loads your `.env`). If the bot runs on localhost or a LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server, otherwise Haven will not deliver callbacks to it.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `DEFAULT_ROLL` | no | Notation when args empty (default `1d20`) |
| `MAX_DICE` | no | Max dice count (default `100`) |
| `MAX_SIDES` | no | Max sides per die (default `1000`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Uses `crypto.randomBytes` for face selection.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
