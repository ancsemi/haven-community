# reddit

Polls subreddit “new” listings and posts fresh threads into a Haven channel.

Uses `https://www.reddit.com/r/{sub}/new.json` with a required descriptive **User-Agent**. First poll **primes** seen post IDs without spamming history.

> **Heads up:** Reddit often blocks its public `.json` endpoints for requests from cloud and VPS hosting IP ranges (you will see `403` or `429` errors in the log). This bot works best from a home connection. If it is blocked where you host it, there is no setting here that fixes that.

## What the message looks like

```
📌 **r/selfhosted** — Cool new project
https://www.reddit.com/r/selfhosted/comments/...
_by u/someone · 42 points_
```

## Setup

### 1. Create a Haven bot

**Settings → Server Admin Settings → Bots** → create a bot in the feed channel. Copy the **Webhook URL** into `HAVEN_WEBHOOK_URL`.

No callback URL is required for polling-only operation.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/reddit
npm install
cp .env.example .env
# edit .env — set SUBREDDITS and a unique USER_AGENT
node --env-file=.env server.js
```

Use Node 20.6 or newer. The `--env-file` flag is what loads your `.env`, and older Node versions do not have it.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `SUBREDDITS` | yes | Comma-separated subreddit names (no `r/`) |
| `USER_AGENT` | no | Reddit User-Agent (default includes bot name; set something unique) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `POLL_INTERVAL_SEC` | no | Poll period (default `120`, min `60`) |
| `MAX_ITEMS_PER_SUB` | no | Max new posts per sub per poll (default `3`) |
| `STATE_FILE` | no | Seen-id state (default `./data/reddit-state.json`) |
| `POST_MESSAGE` | no | Template: `{sub}` `{title}` `{url}` `{author}` `{score}` |
| `POLL_TOKEN` | no | Enables `POST /poll` (send `Authorization: Bearer <token>`). Empty means `POST /poll` is off |
| `PORT` | no | HTTP port for health (default `3000`) |

## Behaviour

- First poll per sub marks current posts as seen (no posts).
- Later polls post only new post IDs.
- Respect Reddit rate limits: keep poll interval ≥ 60s and a few subs only.
- Only one poll runs at a time. A timer tick or `POST /poll` that arrives during a poll is skipped.
- Seen ids are saved after every post, so a failure partway through never reposts what already went out.
- `{url}` is always the Reddit comments page for the post.

## License

MIT. See the repo root `LICENSE`.
