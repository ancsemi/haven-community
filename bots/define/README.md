# define

Look up English definitions with `/define <word>` via the free [Free Dictionary API](https://dictionaryapi.dev/) (no API key).

## Commands

| Command | Description |
|---------|-------------|
| `/define <word>` | Show phonetic + meanings for a word |

### Example

```
/define serendipity
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
cd haven-community/bots/define
npm install
cp .env.example .env
# edit .env
node server.js
```

The host needs outbound HTTPS access to `api.dictionaryapi.dev`.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `MAX_MEANINGS` | no | Parts of speech to show (default `3`) |
| `MAX_DEFS` | no | Definitions per part of speech (default `2`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Uses `GET https://api.dictionaryapi.dev/api/v2/entries/en/<word>`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.
- English entries only (API language path is `en`).

## License

MIT. See the repo root `LICENSE`.
