# password-gen

Generate a cryptographically strong password: `/password` or `/password 24 nosymbols`.

Uses `crypto.randomBytes` with rejection sampling (no `Math.random`).

## Privacy

Replies are **private**: the bot sends them as ephemeral messages to the person who ran the command (`ephemeral: true` with `recipient_id` set to the caller), so nobody else in the channel sees the password and it is not stored in channel history. If the private reply fails, the bot posts a short error in the channel instead. It never posts a password publicly.

## Commands

| Command | Description |
|---------|-------------|
| `/password` | Default length + mode |
| `/password <length>` | e.g. `/password 20` |
| `/password <length> <mode>` | Modes below |
| `/pw` · `/passwd` | Aliases |

### Modes

| Mode | Characters |
|------|------------|
| `symbols` (default) | lower + upper + digits + symbols |
| `nosymbols` / `alphanum` | lower + upper + digits |
| `alpha` | letters only |
| `pin` / `digits` | 0–9 |
| `hex` | 0–9a–f |

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
cd haven-community/bots/password-gen
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

This needs Node 20.6 or newer, which loads `.env` through `--env-file`.

If the bot runs on localhost or a LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server. Otherwise Haven's SSRF guard drops the slash command callbacks.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `DEFAULT_LENGTH` | no | Default length (default `16`) |
| `MIN_LENGTH` | no | Minimum (default `8`) |
| `MAX_LENGTH` | no | Maximum (default `64`) |
| `DEFAULT_MODE` | no | Default charset mode (default `symbols`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
