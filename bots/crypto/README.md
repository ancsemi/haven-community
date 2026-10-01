# crypto

Crypto price lookup for Haven via CoinGecko’s free **simple price** API (no API key).

## Commands

| Command | Description |
|---------|-------------|
| `/crypto <symbol>` | Price + 24h change (e.g. `btc`, `eth`, or CoinGecko id `solana`) |

### Examples

```
/crypto btc
/crypto ethereum
/crypto $sol
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
cd haven-community/bots/crypto
npm install
cp .env.example .env
# edit .env
node server.js
```

The host needs outbound HTTPS to `api.coingecko.com`. Free-tier rate limits apply.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `VS_CURRENCY` | no | Quote currency (default `usd`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Resolves common tickers via a built-in map, otherwise CoinGecko search / id.
- Calls `GET /api/v3/simple/price` for price, 24h change, market cap, and volume.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
