# color

Inspect a color: `/color #RRGGBB` prints hex, RGB, HSL/HSV, decimal, luminance, and contrast vs white/black (text only — no image generation).

## Commands

| Command | Description |
|---------|-------------|
| `/color #RRGGBB` | Full breakdown |
| `/color #RGB` | Short hex expanded |
| `/color rgb(r, g, b)` | CSS-style RGB |
| `/colour …` | Alias |

### Examples

```
/color #1A73E8
/color abc
/color rgb(255, 128, 0)
/color 26, 43, 60
```

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
cd haven-community/bots/color
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
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Contrast ratios use relative luminance (WCAG-style formula).
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
