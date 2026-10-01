# moderation

Slash-command wrappers around Haven’s bot moderation REST API: kick, ban, unban, mute, unmute.

**Requires** the Haven bot to have **`can_moderate`** enabled in Server Admin → Bots.

## Commands

| Command | Description |
|---------|-------------|
| `/kick <userId> [reason]` | Kick a user |
| `/ban <userId> [reason]` | Ban a user |
| `/unban <userId> [reason]` | Unban a user |
| `/mute <userId> [minutes] [reason]` | Mute for N minutes (default from env) |
| `/unmute <userId> [reason]` | Clear mute |

### Examples

```
/kick 42 spamming invites
/mute 42 30 cool down please
/ban 99 harassment
/unban 99 appeal accepted
/unmute 42
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the channel.
2. Enable **`can_moderate`** for this bot.
3. Set **Callback URL** to `https://your-bot-host/haven`.
4. Set **Callback Secret** (same as `CALLBACK_SECRET`).
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
6. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` (needed for moderation REST + slash registration).

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/moderation
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
| `DEFAULT_MUTE_MIN` | no | Default mute minutes (default `10`) |
| `ALLOWED_USER_IDS` | no | Comma-separated user ids allowed to run commands; empty = anyone |
| `HAVEN_WEBHOOK_TOKEN` | no* | 64-hex token (*required in practice for mod REST) |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Calls `POST /api/webhooks/<token>/moderation/{kick|ban|unban|mute|unmute}` with `{ userId, reason }` (mute also sends `duration` in minutes).
- Posts a public confirmation (or error) to the channel after each action.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.
- Restrict who can run commands with `ALLOWED_USER_IDS` when you do not trust open slash access.

## License

MIT. See the repo root `LICENSE`.
