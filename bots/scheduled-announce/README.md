# scheduled-announce

Posts canned messages into a Haven channel on a schedule — interval (`every_minutes`) and/or daily wall-clock (`HH:MM`).

No full cron parser (keeps the bot dependency-free). Good enough for standups, reminders, and hourly pings.

## Schedule formats

### `SCHEDULES_JSON` (preferred)

```json
[
  { "every_minutes": 60, "message": "⏰ Hourly check-in" },
  { "daily": "09:00", "message": "☀️ Good morning!" },
  { "daily": "18:30", "message": "Evening standup", "timezone_offset_minutes": -300 }
]
```

- `every_minutes` — fire every N minutes (from bot start / last fire tracked in state).
- `daily` — `HH:MM` in 24h; optional `timezone_offset_minutes` from UTC (default `0` = UTC).
- `message` — text posted to Haven (max 4000 chars).

### `CRON_SPECS` (simple string alternative)

Only used if `SCHEDULES_JSON` is empty:

```
every:60|Hourly check-in;daily:09:00|Good morning
```

## Setup

### 1. Create a Haven bot

**Settings → Server Admin Settings → Bots** → create a bot in the announce channel. Copy the **Webhook URL** into `HAVEN_WEBHOOK_URL`.

No callback URL is required.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/scheduled-announce
npm install
cp .env.example .env
# edit .env — set SCHEDULES_JSON
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `SCHEDULES_JSON` | yes* | JSON array of schedules (*or use `CRON_SPECS`) |
| `CRON_SPECS` | no | Simple `every:N\|msg;daily:HH:MM\|msg` list |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `STATE_FILE` | no | Last-fire times (default `./data/scheduled-announce-state.json`) |
| `TICK_INTERVAL_MS` | no | Scheduler tick (default `15000`) |
| `PORT` | no | HTTP port for health (default `3000`) |

## Behaviour

- Interval jobs track `lastFiredAt` so restarts do not double-fire immediately (fires when elapsed ≥ interval).
- Daily jobs fire once per calendar day (key = `YYYY-MM-DD` in the schedule’s offset timezone).
- Tick loop runs every `TICK_INTERVAL_MS`.

## License

MIT. See the repo root `LICENSE`.
