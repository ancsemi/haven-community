# afk

Mark yourself AFK with `/away`, clear with `/back`, and auto-announce when someone mentions an AFK username.

## Commands

| Command | Description |
|---------|-------------|
| `/away [reason]` | Set AFK status (optional reason) |
| `/back` | Clear AFK status |

Haven has its own built-in `/afk`, so this bot uses `/away`.

### Message behaviour

- If a message **mentions** an AFK user’s username (word boundary or `@name`), the bot posts that they are AFK (reason + how long).
- Announce is rate-limited per AFK user via `COOLDOWN_SEC`.
- If an AFK user posts a normal message, their AFK status is cleared automatically and the bot says they are back.

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Bots receive **`message`** events by default, so there is nothing extra to turn on.
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
6. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for slash registration.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/afk
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

Needs Node 20.6 or newer (`--env-file` is what loads your `.env`). If the bot runs on localhost or a LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server, otherwise Haven will not deliver callbacks to it.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `STATE_FILE` | no | AFK state path (default `./data/afk-state.json`) |
| `COOLDOWN_SEC` | no | Min seconds between mention announces per AFK user (default `60`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- AFK entries persist across restarts via `STATE_FILE`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.
- Handles `slash_command` and `message` / `message-created` events.
- Always answers Haven with 200, even when posting fails, so Haven does not retry and repeat an announcement. Errors are logged.

## License

MIT. See the repo root `LICENSE`.
