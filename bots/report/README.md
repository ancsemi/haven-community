# report

Members use `/report <text>` to flag issues. The bot posts the report to `REPORT_WEBHOOK_URL` (recommended: a private staff-channel bot) or falls back to `HAVEN_WEBHOOK_URL`.

## Commands

| Command | Description |
|---------|-------------|
| `/report <text>` | Submit a report |

## Setup

### 1. Create Haven bots

1. **Public bot** (slash + optional ack): create in a normal channel → `HAVEN_WEBHOOK_URL`, set **Callback URL** to `https://your-bot-host/haven` and **Callback Secret**.
2. **Staff bot** (optional): create in a staff-only channel → `REPORT_WEBHOOK_URL`. If omitted, reports go to the public webhook channel.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/report
npm install
cp .env.example .env
# edit .env
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Bot used for slash registration + public acks |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `REPORT_WEBHOOK_URL` | no | Staff destination (default = `HAVEN_WEBHOOK_URL`) |
| `ANONYMOUS` | no | `true` hides reporter name/id (default `false`) |
| `ACK_PUBLIC` | no | Post “submitted” ack to public channel (default `true`) |
| `MAX_LENGTH` | no | Max report length (default `1500`) |
| `COOLDOWN_SEC` | no | Per-user cooldown (default `60`) |
| `PREFIX` | no | Header line for staff post |
| `HAVEN_USERNAME` | no | Display name (default `Report Bot`) |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Staff post includes text, optional reporter identity, and ISO timestamp.
- Cooldown is in-memory only (resets on process restart).
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
