# weather

Current conditions for a place via **Open-Meteo** geocoding + forecast APIs — **no API key required**.

## Commands

| Command | Description |
|---------|-------------|
| `/weather <place>` | Look up weather for a city / place name |

### Example

```
/weather Tokyo
```

```
🌤️ **Tokyo, Japan**
14°C · Partly cloudy
Wind 12 km/h · Humidity 62%
Feels like 13°C
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
5. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for slash registration.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/weather
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
| `TEMP_UNIT` | no | `celsius` (default) or `fahrenheit` |
| `WIND_UNIT` | no | `kmh` (default), `mph`, or `ms` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## APIs used

- Geocoding: `https://geocoding-api.open-meteo.com/v1/search`
- Forecast: `https://api.open-meteo.com/v1/forecast`

## License

MIT. See the repo root `LICENSE`.
