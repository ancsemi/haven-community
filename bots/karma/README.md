# karma

Reddit-style karma for Haven: give points with `name++` / `name--` in chat, or check scores with `/karma`.

## Chat

| Pattern | Effect |
|---------|--------|
| `alice++` or `++alice` | +1 for alice |
| `bob--` or `--bob` | −1 for bob |

Self-votes are blocked unless `ALLOW_SELF=true`.

## Commands

| Command | Description |
|---------|-------------|
| `/karma` or `/karma me` | Your score |
| `/karma <user>` | Someone else's score |
| `/karma top` | Leaderboard |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Subscribe to **`message`** events and slash commands.
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
6. Optionally set **Webhook Token** → `HAVEN_WEBHOOK_TOKEN`.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/karma
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
| `STATE_FILE` | no | Scores path (default `./data/karma-state.json`) |
| `ALLOW_SELF` | no | Allow self ++/-- (default `false`) |
| `TOP_N` | no | Leaderboard size (default `10`) |
| `ANNOUNCE` | no | Post channel messages on ++/-- (default `true`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Names are matched case-insensitively (2–32 chars, alnum / `_` `.` `-`).
- Scores persist in `STATE_FILE`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
