# hackernews

Polls [Hacker News](https://news.ycombinator.com/) **top stories** via the public Firebase API and posts **new** stories whose score is at least `SCORE_MIN`.

## Behaviour

- Uses `https://hacker-news.firebaseio.com/v0/topstories.json` + per-item fetch.
- First poll **primes** seen story ids (no posts).
- Later polls post unseen stories with `score >= SCORE_MIN` (highest score first, capped by `MAX_POSTS_PER_POLL`).
- Only stories that were actually posted are marked seen. A story below `SCORE_MIN` is checked again on later polls, so it still gets posted if it climbs past the threshold while it is in the top `TOP_N`.
- Polls never overlap: if a poll is still running when the next one is due, the new one is skipped.

## Setup

### 1. Create a Haven bot

**Settings → Server Admin Settings → Bots** → create a bot → copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/hackernews
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

This needs Node 20.6 or newer, which loads `.env` through `--env-file`.

Host needs outbound HTTPS to `hacker-news.firebaseio.com`.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `POLL_INTERVAL_SEC` | no | Poll period (default `300`, min `60`) |
| `SCORE_MIN` | no | Minimum score to post (default `100`) |
| `TOP_N` | no | How many top ids to inspect (default `30`) |
| `MAX_POSTS_PER_POLL` | no | Max Haven posts per cycle (default `5`) |
| `STATE_FILE` | no | Seen ids path (default `./data/hackernews-state.json`) |
| `POST_MESSAGE` | no | Template: `{title}` `{url}` `{score}` `{by}` `{comments}` `{id}` |
| `POLL_TOKEN` | no | Enables `POST /poll`; callers must send `Authorization: Bearer <token>` (or `X-Poll-Token`). Unset means the endpoint is off |
| `PORT` | no | HTTP port (default `3000`) |

## Endpoints

| Path | Description |
|------|-------------|
| `GET /` | Human status |
| `GET /health` | JSON health |
| `POST /poll` | Force a poll cycle (needs `POLL_TOKEN`) |

## License

MIT. See the repo root `LICENSE`.
