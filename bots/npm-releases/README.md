# npm-releases

Polls the npm registry for one or more packages and posts to a Haven channel when `dist-tags.latest` changes.

First successful poll for each package only **primes** state (no spam of historical versions).

## What the message looks like

```
📦 npm release — `express`
**4.21.0**
https://www.npmjs.com/package/express/v/4.21.0
_2024-09-11T12:00:00.000Z_
```

## Setup

### 1. Create a Haven bot

**Settings → Server Admin Settings → Bots** → create a bot → copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/npm-releases
npm install
cp .env.example .env
# set HAVEN_WEBHOOK_URL and PACKAGE_NAMES
node server.js
```

No outbound public URL is required (poll-only), unless you want `/health` or manual `POST /poll`.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `PACKAGE_NAMES` | yes | Comma-separated package names (supports scopes like `@babel/core`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `POLL_INTERVAL_SEC` | no | Poll interval (default `600`, minimum `60`) |
| `INCLUDE_PRERELEASES` | no | `true` to announce prerelease `latest` tags (default `false`) |
| `STATE_FILE` | no | JSON file of last seen versions (default `./data/npm-releases-state.json`) |
| `REGISTRY_BASE` | no | Registry root (default `https://registry.npmjs.org`) |
| `POST_MESSAGE` | no | Template with `{package}` `{version}` `{url}` `{time}` `{description}` |
| `PORT` | no | HTTP port for health/poll (default `3000`) |

## Behaviour

- Compares stored version vs `dist-tags.latest` from the registry metadata document.
- Versions containing a pre-release hyphen (e.g. `1.0.0-rc.1`) are skipped unless `INCLUDE_PRERELEASES=true` (state still advances).
- Manual refresh: `POST /poll`.
- Health: `GET /health` returns packages and last known versions.

## License

MIT. See the repo root `LICENSE`.
