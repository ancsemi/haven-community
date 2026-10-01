# rss

Polls RSS/Atom feeds and posts new items into a Haven channel — the classic Discord “feed bot” for self-hosted Haven.

## What the message looks like

```
📰 **Example Blog** — New post title
https://example.com/posts/new-post

Short summary of the article if the feed provides one…
```

## Setup

### 1. Create a Haven bot

**Settings → Server Admin Settings → Bots** → create a bot in the channel that should receive feed posts. Copy the **Webhook URL**.

If you want `/rss` slash management:

1. Set the bot’s **Callback URL** to `https://your-bot-host/haven`.
2. Set a **Callback Secret** (same value as `CALLBACK_SECRET` below).
3. Copy the **Webhook Token** into `HAVEN_WEBHOOK_TOKEN`.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/rss
npm install
cp .env.example .env
# edit .env
node server.js
```

### 3. Add feeds

Either put comma-separated URLs in `FEED_URLS`, or (with slash commands enabled):

- `/rss add https://example.com/feed.xml`
- `/rss list`
- `/rss remove https://example.com/feed.xml`

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `FEED_URLS` | no | Comma-separated seed feed URLs |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `POLL_INTERVAL_SEC` | no | Poll period (default `300`) |
| `MAX_ITEMS_PER_FEED` | no | Max new items posted per poll per feed (default `3`) |
| `BODY_MAX_CHARS` | no | Truncate summaries (default `400`) |
| `STATE_FILE` | no | Seen-item state path (default `./data/rss-state.json`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `CALLBACK_SECRET` | no | HMAC secret matching Haven bot settings |
| `PUBLIC_BASE_URL` | no | Public base URL of this bot (for docs/logging) |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- First successful poll of a feed **marks current items as seen** without posting (avoids dumping history).
- Later polls post only **new** item GUIDs/links.
- State is stored on disk so restarts do not re-spam.

## License

MIT. See the repo root `LICENSE`.
