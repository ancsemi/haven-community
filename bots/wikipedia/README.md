# wikipedia

Look up a Wikipedia article summary with `/wiki <query>` via the public MediaWiki API (no key).

## Commands

| Command | Description |
|---------|-------------|
| `/wiki <query>` | Search + intro extract + article URL |
| `/wikipedia <query>` | Alias |

### Example

```
/wiki Final Fantasy X
```

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
cd haven-community/bots/wikipedia
npm install
cp .env.example .env
# edit .env
node server.js
```

Host needs outbound HTTPS to `*.wikipedia.org`.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `WIKI_LANG` | no | Language subdomain (default `en`) |
| `EXTRACT_CHARS` | no | Max extract length (default `600`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Uses MediaWiki `action=query` search + plaintext intro extract.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
