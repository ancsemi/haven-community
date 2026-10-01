# urbandict

Look up slang on Urban Dictionary with `/ud <term>`.

## ⚠️ NSFW / content warning

Urban Dictionary is **user-generated and frequently NSFW, offensive, or inaccurate**.  
Do **not** deploy this bot in all-ages or professional channels without clear consent.  
This project does **not** filter definitions beyond basic length truncation.

## Commands

| Command | Description |
|---------|-------------|
| `/ud <term>` | Top definition(s) for a term |
| `/urban <term>` | Alias |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot (prefer an adult-only channel).
2. **Callback URL:** `https://your-bot-host/haven`
3. **Callback Secret** = `CALLBACK_SECRET`
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`
5. Optional: **Webhook Token** → `HAVEN_WEBHOOK_TOKEN`

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/urbandict
npm install
cp .env.example .env
# edit .env
node server.js
```

Uses the public `https://api.urbandictionary.com/v0/define` endpoint (no API key). Availability may change.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `MAX_RESULTS` | no | Definitions to show (1–5, default `1`) |
| `DEF_MAX_CHARS` | no | Truncate definition length (default `800`) |
| `NSFW_BANNER` | no | Prefix NSFW warning (default `true`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Results sorted by `thumbs_up`.
- `[bracket]` link markup from UD is stripped for readability.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`. Urban Dictionary content remains subject to their terms.
