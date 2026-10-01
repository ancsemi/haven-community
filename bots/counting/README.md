# counting

Counting-channel game for Haven: users post the next integer in sequence. Wrong numbers reset (or freeze in STRICT mode). Same user cannot count twice in a row.

## How it works

1. Point this bot at a dedicated counting channel (or any channel you want).
2. Users post **only** a whole number as the message body (e.g. `1`, then `2`, …).
3. Expected value is always `current + 1` (starts after `START_AT`, default next is `1`).
4. Failures:
   - **Default:** reset to `START_AT`, announce correction.
   - **STRICT=true:** freeze at the last good count; resume with `/count unfreeze`.

## Commands (optional helpers)

| Command | Description |
|---------|-------------|
| `/count status` | Show current count, high score, freeze state |
| `/count reset` | Reset to `START_AT` and clear freeze |
| `/count unfreeze` | Unfreeze after a STRICT fail |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the counting channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Subscribe to **`message`** events (and slash if using `/count`).
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
6. Optionally set **Webhook Token** → `HAVEN_WEBHOOK_TOKEN`.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/counting
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
| `STATE_FILE` | no | State path (default `./data/counting-state.json`) |
| `STRICT` | no | `true` = freeze on fail; `false` = reset (default) |
| `START_AT` | no | Value after reset / initial current (default `0`, so next is `1`) |
| `ALLOW_BOTS` | no | Count messages from bots (default `false`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Only messages that are exactly digits count; other chat is ignored.
- Same user (by id, else username) cannot count twice consecutively.
- High score is tracked in `STATE_FILE`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
