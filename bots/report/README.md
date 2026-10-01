# report

Members use `/report <text>` to flag issues. The bot posts the report to `REPORT_WEBHOOK_URL`, a bot in a private staff channel. Replies to the reporter (usage, cooldown, "submitted") are private messages only they can see.

`REPORT_WEBHOOK_URL` is required for reports to work. If it is not set, the bot never posts reports in the public channel: it tells the reporter that reports are not set up and sends nothing.

## Commands

| Command | Description |
|---------|-------------|
| `/report <text>` | Submit a report |

## Setup

### 1. Create Haven bots

1. **Public bot** (slash command + private replies): create in a normal channel → `HAVEN_WEBHOOK_URL`, set **Callback URL** to `https://your-bot-host/haven` and **Callback Secret**.
2. **Staff bot** (required): create in a staff-only channel → `REPORT_WEBHOOK_URL`. Use a different channel from the public bot, or reports will be visible to everyone there.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/report
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
| `HAVEN_WEBHOOK_URL` | yes | Bot used for slash registration and private replies |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `REPORT_WEBHOOK_URL` | yes | Staff-only channel bot that receives reports. Without it, reports are refused |
| `ANONYMOUS` | no | `true` hides reporter name/id (default `false`) |
| `ACK` | no | Send the reporter a private “submitted” message (default `true`). The old name `ACK_PUBLIC` still works |
| `MAX_LENGTH` | no | Max report length (default `1500`) |
| `COOLDOWN_SEC` | no | Per-user cooldown in seconds (default `60`, `0` turns it off) |
| `PREFIX` | no | Header line for staff post |
| `HAVEN_USERNAME` | no | Display name (default `Report Bot`) |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Staff post includes text, optional reporter identity, and ISO timestamp.
- Cooldown is per reporter (by user id) and in-memory only (resets on process restart).
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
