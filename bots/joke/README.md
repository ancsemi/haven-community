# joke

Need a laugh? `/joke` pulls a random joke from public APIs (no API key).

## Commands

| Command | Description |
|---------|-------------|
| `/joke` | Random joke (default source from env) |
| `/joke dad` | Dad joke via icanhazdadjoke |
| `/joke programming` | Programming joke via Official Joke API |
| `/joke any` | Setup/punchline via Official Joke API |
| `/dadjoke` | Shortcut for dad jokes |

Punchlines from the Official Joke API are wrapped in spoiler marks (`||…||`) when Haven supports them.

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
cd haven-community/bots/joke
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
| `JOKE_SOURCE` | no | Default when no args: `dadjoke` (default), `official`, or `programming` |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Default path uses [icanhazdadjoke.com](https://icanhazdadjoke.com/) (JSON, free, no key).
- Programming / general jokes use [Official Joke API](https://github.com/15Dkatz/official_joke_api).
- If Official Joke API fails, falls back to a dad joke.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
