# giveaway

Timed giveaways for Haven — start, enter, auto-pick a random winner when time is up (or end early).

## Commands

| Command | Description |
|---------|-------------|
| `/giveaway start <duration> <prize>` | Start a giveaway (`10m`, `2h`, `1d`, …) |
| `/giveaway enter <id>` | Enter an open giveaway |
| `/giveaway end <id>` | End early and pick a winner |
| `/giveaway list` | List open giveaways |

## What it looks like

```
🎉 **Giveaway #3** — Steam key
Ends: 2026-04-01T18:00:00.000Z (in 2h)
Enter: `/giveaway enter 3`
```

When finished:

```
🏆 **Giveaway #3** ended!
Prize: Steam key
Winner: **Ada** (from 12 entrants)
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
cd haven-community/bots/giveaway
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
| `STATE_FILE` | no | State path (default `./data/giveaway-state.json`) |
| `TICK_INTERVAL_MS` | no | How often to check expired giveaways (default `5000`) |
| `MAX_GIVEAWAYS` | no | Cap on stored giveaways (default `50`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- State persists across restarts; a tick loop ends expired open giveaways.
- Winner is chosen uniformly at random among entrants (or “no entrants” if empty).
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
