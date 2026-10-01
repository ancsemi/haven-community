# polls

Simple multi-option polls for Haven — create with `/poll`, vote with `/vote`, tallies with `/poll results`.

## Commands

| Command | Description |
|---------|-------------|
| `/poll Question \| option1 \| option2 \| option3` | Create a poll (pipe-separated) |
| `/poll results <id>` | Show current tallies |
| `/vote <id> <n>` | Vote for option number `n` (1-based) |

### Example

```
/poll Pizza night? | Yes | No | Maybe later
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
node server.js
```

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

- One vote per user per poll (changing vote moves the tally).
- Polls persist across restarts via `STATE_FILE`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
