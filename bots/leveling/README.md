# leveling

Message-based XP and levels for Haven — MEE6-style rank / leaderboard for self-hosted servers.

Awards XP on `message` events (with cooldown), posts a congratulations line on level-up, and exposes `/rank` and `/levels`.

## Commands

| Command | Description |
|---------|-------------|
| `/rank [user]` | Show rank card for yourself or a username |
| `/levels` | Top 10 leaderboard |
| `/levels leaderboard` | Same as `/levels` |

## What level-up looks like

```
🎉 **Ada** reached **level 5**!
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Subscribe to **`message`** (or `*`) so XP can be awarded.
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
6. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for slash registration.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/leveling
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
| `STATE_FILE` | no | XP state path (default `./data/leveling-state.json`) |
| `XP_PER_MESSAGE` | no | XP granted per message after cooldown (default `15`) |
| `XP_COOLDOWN_SEC` | no | Per-user cooldown between XP grants (default `60`) |
| `XP_BASE` | no | Level curve base (default `5`) |
| `XP_EXP` | no | Level curve exponent (default `2`) |
| `LEVELUP_MESSAGE` | no | Template with `{username}` and `{level}` |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## XP formula

Level is derived from total XP. Cumulative XP required to reach level `L` is approximately:

```
sum_{i=1..L} floor(XP_BASE * i^XP_EXP)
```

Default `XP_BASE=5`, `XP_EXP=2` → level 1 needs 5 XP, level 2 needs 5+20, etc.

## Behaviour

- Bot/webhook messages do not earn XP.
- Cooldown is per user id (or username key if id missing).
- State persists across restarts.
- Signature verification accepts `sha256=<hex>` and bare hex.

## License

MIT. See the repo root `LICENSE`.
