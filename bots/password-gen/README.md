# password-gen

Generate a cryptographically strong password: `/password` or `/password 24 nosymbols`.

Uses `crypto.randomBytes` with rejection sampling (no `Math.random`).

## ⚠️ Channel privacy

Passwords are **posted to the channel**. Prefer a private/test channel, then change the password if others can see the history. This bot does not DM (use `echo-once` patterns elsewhere if you need ephemeral replies).

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
node server.js
```

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
