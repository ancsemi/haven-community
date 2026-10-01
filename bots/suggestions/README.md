# suggestions

Community suggestion box for Haven — submit ideas, list pending ones, approve or reject by id.

## Commands

| Command | Description |
|---------|-------------|
| `/suggest <text>` | Submit a suggestion |
| `/suggest list [pending\|all\|approved\|rejected]` | List suggestions (default pending) |
| `/suggest approve <id>` | Mark approved (optional approver gate) |
| `/suggest reject <id>` | Mark rejected (optional approver gate) |

### Example

```
/suggest Add dark mode for the mobile app
```

Bot posts:

```
💡 **Suggestion #1** — pending
Add dark mode for the mobile app
_by bob · 2026-08-06T12:00:00.000Z_
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
cd haven-community/bots/suggestions
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
| `STATE_FILE` | no | Suggestion state path (default `./data/suggestions-state.json`) |
| `MAX_SUGGESTIONS` | no | Max stored suggestions (default `200`) |
| `APPROVER_USER_IDS` | no | Comma-separated user ids who may approve/reject; empty = anyone |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- New suggestions start as `pending` and are posted to the channel.
- `APPROVER_USER_IDS` restricts moderate actions when set; leave empty to allow any user.
- State persists across restarts via `STATE_FILE`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
