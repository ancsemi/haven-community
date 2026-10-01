# youtube

Posts new YouTube uploads into a Haven channel by polling each channel’s public Atom feed — **no API key required**.

Feed URL used:

```
https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
```

## What the message looks like

```
▶️ **Cool Channel** uploaded a video
**My new video title**
https://www.youtube.com/watch?v=xxxxxxxxxxx
```

## Setup

### 1. Find channel IDs

Channel IDs look like `UCxxxxxxxxxxxxxxxxxxxxxx`. You can find them on the channel’s About page, or from a video page’s source / share tools.

Set them comma-separated in `CHANNEL_IDS`.

### 2. Create a Haven bot

**Settings → Server Admin Settings → Bots** → create a bot in the announce channel. Copy the **Webhook URL** into `HAVEN_WEBHOOK_URL`.

No callback URL is required for polling-only operation.

### 3. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/youtube
npm install
cp .env.example .env
# edit .env
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CHANNEL_IDS` | yes | Comma-separated YouTube channel IDs |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `POLL_INTERVAL_SEC` | no | Poll period (default `300`, min `60`) |
| `MAX_ITEMS_PER_CHANNEL` | no | Max new videos posted per poll per channel (default `3`) |
| `STATE_FILE` | no | Seen-video state (default `./data/youtube-state.json`) |
| `UPLOAD_MESSAGE` | no | Template: `{channel}` `{title}` `{url}` `{published}` |
| `PORT` | no | HTTP port for health (default `3000`) |

## Behaviour

- First successful poll of a channel **marks current videos as seen** without posting (avoids dumping history).
- Later polls post only **new** video IDs.
- State is stored on disk so restarts do not re-spam.

## License

MIT. See the repo root `LICENSE`.
