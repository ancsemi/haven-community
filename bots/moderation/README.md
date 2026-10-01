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
node --env-file=.env server.js
```

This needs Node 20.6 or newer, which loads `.env` through `--env-file`.

If the bot runs on localhost or a LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server. Otherwise Haven's SSRF guard drops the slash command callbacks.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `DEFAULT_MUTE_MIN` | no | Default mute minutes (default `10`) |
| `ALLOWED_USER_IDS` | yes | Comma-separated Haven user ids allowed to run commands. If it is empty, every command is refused |
| `HAVEN_WEBHOOK_TOKEN` | no* | 64-hex token (*required in practice for mod REST) |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Calls `POST /api/webhooks/<token>/moderation/{kick|ban|unban|mute|unmute}` with `{ userId, reason }` (mute also sends `duration` in minutes, and kick sends the `channelCode` of the channel the command ran in, which is the channel the user is kicked from).
- Posts a public confirmation (or error) to the channel after each action.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.
- Only the Haven user ids in `ALLOWED_USER_IDS` can run commands. With no ids set, the bot refuses everyone and logs a warning at startup.

## License

MIT. See the repo root `LICENSE`.
