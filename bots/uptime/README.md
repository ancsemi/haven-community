# uptime

Polls a list of URLs and posts to Haven when status flips **up ↔ down**, including measured latency.

## What the message looks like

```
🔴 **DOWN** https://example.com
status=0 · latency=10004ms · Error: fetch failed
```

```
🟢 **UP** https://example.com
status=200 · latency=142ms
```

## Setup

### 1. Create a Haven bot

**Settings → Server Admin Settings → Bots** → create a bot in the status channel. Copy the **Webhook URL** into `HAVEN_WEBHOOK_URL`.

No callback URL is required for polling-only operation.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/uptime
npm install
cp .env.example .env
# edit .env — set TARGET_URLS
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `TARGET_URLS` | yes | Comma-separated URLs to poll |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `INTERVAL` | no | Poll interval seconds (default `60`, min `15`) |
| `METHOD` | no | `GET` or `HEAD` (default `GET`) |
| `OK_STATUSES` | no | Comma-separated OK codes; empty = any 2xx/3xx |
| `TIMEOUT_MS` | no | Request timeout (default `10000`) |
| `STATE_FILE` | no | Last-known status path (default `./data/uptime-state.json`) |
| `ANNOUNCE_INITIAL` | no | `true` to post status on first poll (default `false`) |
| `PORT` | no | HTTP port for health (default `3000`) |

## Behaviour

- First poll **records** status without posting (unless `ANNOUNCE_INITIAL=true`).
- Later polls post only when **up/down flips**.
- Latency is wall-clock time for the HTTP attempt (milliseconds).
- State persists so restarts do not re-spam the last flip.

## License

MIT. See the repo root `LICENSE`.
