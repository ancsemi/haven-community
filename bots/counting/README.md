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
| `/count reset` | Reset to `START_AT` and clear freeze. Only ids in `ADMIN_USER_IDS`; refused for everyone while that is empty |
| `/count unfreeze` | Unfreeze after a STRICT fail |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the counting channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Bots receive **`message`** events by default, so there is nothing extra to turn on.
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
6. Optionally set **Webhook Token** → `HAVEN_WEBHOOK_TOKEN`.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/counting
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
| `STATE_FILE` | no | State path (default `./data/counting-state.json`) |
| `STRICT` | no | `true` = freeze on fail; `false` = reset (default) |
| `START_AT` | no | Value after reset / initial current (default `0`, so next is `1`) |
| `ALLOW_BOTS` | no | Count messages from bots (default `false`) |
| `ADMIN_USER_IDS` | no | Comma-separated Haven user ids allowed to use `/count reset` (empty = nobody, the bot warns at startup) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Only messages that are exactly digits count; other chat is ignored.
- Same user (by id, else username) cannot count twice consecutively.
- High score is tracked in `STATE_FILE`.
- Always answers Haven with 200, even when posting fails, so Haven does not retry a message and count it twice. Errors are logged.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
