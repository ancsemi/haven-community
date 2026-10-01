# hackernews

Polls [Hacker News](https://news.ycombinator.com/) **top stories** via the public Firebase API and posts **new** stories whose score is at least `SCORE_MIN`.

## Behaviour

- Uses `https://hacker-news.firebaseio.com/v0/topstories.json` + per-item fetch.
- First poll **primes** seen story ids (no posts).
- Later polls post unseen stories with `score >= SCORE_MIN` (highest score first, capped by `MAX_POSTS_PER_POLL`).
- Stories that appear in the top list below the threshold are still marked seen so they don’t spam later if they climb after leaving the “new to us” set. Raise `SCORE_MIN` carefully.

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
node server.js
```

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
| `PORT` | no | HTTP port (default `3000`) |

## Endpoints

| Path | Description |
|------|-------------|
| `GET /` | Human status |
| `GET /health` | JSON health |
| `POST /poll` | Force a poll cycle |

## License

MIT. See the repo root `LICENSE`.
