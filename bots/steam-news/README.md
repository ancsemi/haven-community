# steam-news

Polls [Steam Web API](https://developer.valvesoftware.com/wiki/Steam_Web_API) news for one or more **app IDs** and posts new items (by `gid`) into a Haven channel. No API key required for public news.

## Behaviour

- First poll **primes** seen `gid`s (nothing posted) so restarts don’t re-spam history.
- Later polls post only new gids, oldest-first, capped by `MAX_ITEMS_PER_APP`.
- State is stored in `STATE_FILE` and saved after every post, so a failure partway through never reposts what already went out.
- Only one poll runs at a time. A timer tick or `POST /poll` that arrives during a poll is skipped.
- If a news item has no link, `{url}` falls back to the game's Steam news page.

## Setup

### 1. Create a Haven bot

**Settings → Server Admin Settings → Bots** → create a bot in the channel → copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.

### 2. Find Steam app IDs

On a store page, the URL is `https://store.steampowered.com/app/<APPID>/...` (e.g. CS2 = `730`).

### 3. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/steam-news
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

Use Node 20.6 or newer. The `--env-file` flag is what loads your `.env`, and older Node versions do not have it.

Host needs outbound HTTPS to `api.steampowered.com`.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `APP_IDS` | yes | Comma-separated Steam app ids |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `POLL_INTERVAL_SEC` | no | Poll period (default `300`, min `60`) |
| `MAX_ITEMS_PER_APP` | no | Max new posts per app per poll (default `3`) |
| `NEWS_COUNT` | no | Items fetched per app (default `15`) |
| `BODY_MAX_CHARS` | no | Snippet length (default `400`). `0` posts no snippet, just the title and link |
| `STATE_FILE` | no | Seen gids path (default `./data/steam-news-state.json`) |
| `POST_MESSAGE` | no | Template with `{app}` `{title}` `{url}` `{feed}` `{author}` `{contents}` |
| `POLL_TOKEN` | no | Enables `POST /poll`. Empty means `POST /poll` is off |
| `PORT` | no | HTTP port (default `3000`) |

## Endpoints

| Path | Description |
|------|-------------|
| `GET /` | Human status |
| `GET /health` | JSON health |
| `POST /poll` | Force a poll cycle. Only when `POLL_TOKEN` is set; send `Authorization: Bearer <POLL_TOKEN>` |

## License

MIT. See the repo root `LICENSE`.
