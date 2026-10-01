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

Then:

1. Set the bot’s **Callback URL** to `https://your-bot-host/haven`.
2. Set a **Callback Secret** (same value as `CALLBACK_SECRET` below). This is required: the bot will not start without it, and it rejects any request to `/haven` that is not signed with it.
3. Copy the **Webhook Token** into `HAVEN_WEBHOOK_TOKEN`.
4. Put your admins' Haven user ids in `ALLOWED_USER_IDS`. Only they can `/rss add` and `/rss remove`; with an empty list nobody can. If you don't know your id, run `/rss add` once and the bot tells you privately.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/rss
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

Use Node 20.6 or newer. The `--env-file` flag is what loads your `.env`, and older Node versions do not have it.

If Haven reaches this bot at a `localhost` or LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server. Without it Haven refuses to call private addresses.

### 3. Add feeds

Either put comma-separated URLs in `FEED_URLS`, or use the slash commands:

- `/rss add https://example.com/feed.xml` (allowlisted users only)
- `/rss list`
- `/rss remove https://example.com/feed.xml` (allowlisted users only)
- `/rss poll`

A feed removed with `/rss remove` stays removed after a restart, even if it is still listed in `FEED_URLS`. Add it again with `/rss add` to bring it back.

### Which feed URLs are allowed

Feeds must be `http` or `https`, and the host must resolve to a public internet address. The bot refuses loopback (`localhost`, `127.0.0.1`), private LAN ranges (`10.x`, `172.16.x` to `172.31.x`, `192.168.x`), link-local and cloud metadata addresses (`169.254.x`), CGNAT (`100.64.x`) and their IPv6 equivalents. This is checked on the address the bot actually connects to, and again on every redirect (at most 3). A feed on your own LAN will not work with this bot.

Feed responses larger than `MAX_FEED_BYTES` are dropped.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret matching the Haven bot's callback secret |
| `ALLOWED_USER_IDS` | yes | Comma-separated Haven user ids allowed to add and remove feeds. Empty means nobody can |
| `FEED_URLS` | no | Comma-separated seed feed URLs |
| `MAX_FEEDS` | no | Max feeds watched at once (default `20`) |
| `MAX_FEED_BYTES` | no | Max size of one feed response in bytes (default `2097152`, 2 MB) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `POLL_INTERVAL_SEC` | no | Poll period (default `300`) |
| `MAX_ITEMS_PER_FEED` | no | Max new items posted per poll per feed (default `3`) |
| `BODY_MAX_CHARS` | no | Truncate summaries (default `400`) |
| `STATE_FILE` | no | Seen-item state path (default `./data/rss-state.json`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration (taken from `HAVEN_WEBHOOK_URL` if empty) |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- First successful poll of a feed **marks current items as seen** without posting (avoids dumping history).
- Later polls post only **new** item GUIDs/links.
- State is stored on disk (and saved after every post) so restarts and errors do not re-spam.
- Only one poll runs at a time. A timer tick or `/rss poll` that arrives during a poll is skipped.

## License

MIT. See the repo root `LICENSE`.
