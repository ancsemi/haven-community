# world-clock

Show the current time for a city or IANA timezone with `/clock`. Optional multi-zone **board** from `TIMEZONES`.

The command is `/clock` because `/time` is built into Haven and never reaches a bot.

Haven also does not pass slash command text that contains a second `/` on to bots (it treats it as a file path), so `/clock Europe/Berlin` won't work. Type IANA zone names with `_` in place of `/` (`Europe_Berlin`), or just the city part (`Berlin`, `New_York`).

## Commands

| Command | Description |
|---------|-------------|
| `/clock <city or Zone>` | Time for one place (e.g. `tokyo`, `Europe_London`) |
| `/clock` or `/clock board` | Snapshot of all zones in `TIMEZONES` |

### Examples

```
/clock nyc
/clock Europe_Berlin
/clock Buenos_Aires
/clock board
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
node --env-file=.env server.js
```

Requires Node 20.6 or newer (for `--env-file`).

If the bot runs on the same machine as Haven or on your local network (a `localhost` or LAN callback URL), the Haven server must have `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` set, or it will refuse to call the bot.

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
- Accepts IANA zones written with `_` instead of `/` (`America_Los_Angeles`), the city part of a zone (`Los_Angeles`), or `UTC`.
- `TIMEZONES` in `.env` is read by the bot directly, so it uses normal IANA names with `/`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
