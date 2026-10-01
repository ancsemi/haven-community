# timezone-convert

Convert a wall-clock time between timezones: `/tz 3:30pm America/New_York Europe/London`.

Uses `Intl` / IANA zones (no external API). City aliases like `nyc`, `london`, `tokyo` are supported.

## Commands

| Command | Description |
|---------|-------------|
| `/tz <time> <from> <to>` | Convert today's time from one zone to another |
| `/tz now <zone>` | Current time in a zone |
| `/convert …` | Alias for `/tz` |

### Examples

```
/tz 3:30pm America/New_York Europe/London
/tz 15:00 nyc london
/tz 9:00am Tokyo -> Los Angeles
/tz now Sydney
```

Time is interpreted as **today** in the source zone (DST-aware).

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. **Callback URL:** `https://your-bot-host/haven`
3. **Callback Secret** = `CALLBACK_SECRET`
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`
5. Optional: **Webhook Token** → `HAVEN_WEBHOOK_TOKEN`

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/timezone-convert
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
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Accepts 24h (`15:30`) or 12h (`3:30pm`) times.
- Zones: full IANA ids or common city aliases.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
