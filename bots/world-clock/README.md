# world-clock

Show the current time for a city or IANA timezone with `/time`. Optional multi-zone **board** from `TIMEZONES`.

## Commands

| Command | Description |
|---------|-------------|
| `/time <city or Zone>` | Time for one place (e.g. `tokyo`, `Europe/London`) |
| `/time` or `/time board` | Snapshot of all zones in `TIMEZONES` |

### Examples

```
/time nyc
/time Europe/Berlin
/time board
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
cd haven-community/bots/world-clock
npm install
cp .env.example .env
# edit .env
node server.js
```

Uses Node’s built-in `Intl` / IANA timezone data (no external API).

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `TIMEZONES` | no | Comma-separated IANA zones (or `Label=Zone`) for the board |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Resolves common city aliases (nyc, london, tokyo, …) to IANA zones.
- Accepts raw zones like `America/Los_Angeles` or `UTC`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
