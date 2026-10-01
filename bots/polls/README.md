# polls

Simple multi-option polls for Haven. Create with `/survey`, vote with `/vote`, see tallies with `/survey results`.

The command is `/survey`, not `/poll`, because Haven reserves `/poll` for its own built-in polls and refuses to let a bot register it.

## Commands

| Command | Description |
|---------|-------------|
| `/survey Question \| option1 \| option2 \| option3` | Create a poll (pipe-separated) |
| `/survey results <id>` | Show current tallies |
| `/vote <id> <n>` | Vote for option number `n` (1-based) |

### Example

```
/survey Pizza night? | Yes | No | Maybe later
```

Bot posts:

```
📊 **Poll #1** — Pizza night?
1. Yes
2. No
3. Maybe later
Vote: `/vote 1 <n>`
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
5. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for slash registration.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/polls
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

Use Node 20.6 or newer. The `--env-file` flag is what loads your `.env`, and older Node versions do not have it.

If Haven reaches this bot at a `localhost` or LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server. Without it Haven refuses to call private addresses.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `STATE_FILE` | no | Poll state path (default `./data/polls-state.json`) |
| `MAX_POLLS` | no | Max stored polls (default `100`) |
| `MAX_OPTIONS` | no | Max options per poll (default `10`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- One vote per Haven account per poll, keyed by user id (voting again moves your vote).
- Polls persist across restarts via `STATE_FILE`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
