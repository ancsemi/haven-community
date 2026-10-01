# animal-pics

Cute overload. `/cat` and `/dog` post a random animal image URL into the channel (no API keys for the defaults).

## Commands

| Command | Description |
|---------|-------------|
| `/cat` | Random cat picture |
| `/dog` | Random dog picture |
| `/animal` | Random cat or dog |
| `/animal cat` | Same as `/cat` |
| `/animal dog` | Same as `/dog` |

Haven will usually unfurl the image URL as an embed/preview.

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
cd haven-community/bots/animal-pics
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
| `CAT_SOURCE` | no | `cataas` (default) or `thecatapi` |
| `DOG_SOURCE` | no | `random.dog` (default), `dog.ceo`, or `place.dog` |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- **Cats:** [cataas.com](https://cataas.com/) direct image URL (cache-busted), or [TheCatAPI](https://thecatapi.com/) public search without a key.
- **Dogs:** [random.dog](https://random.dog/) JSON (skips video files, retries), with [dog.ceo](https://dog.ceo/) fallback; optional [place.dog](https://place.dog/).
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
