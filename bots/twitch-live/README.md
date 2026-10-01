# twitch-live

Posts into a Haven channel when watched Twitch streamers go live — classic go-live notifier for self-hosted Haven.

Uses the Twitch Helix API with an **app access token** (`TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET`). Tracks who is already live in `STATE_FILE` so restarts and re-polls do not spam.

## What the message looks like

```
🔴 **CoolStreamer** is live!
Speedruns and vibes
Just Chatting
https://www.twitch.tv/coolstreamer
```

## Setup

### 1. Twitch developer app

1. Create an application at [dev.twitch.tv/console](https://dev.twitch.tv/console).
2. Copy **Client ID** and generate a **Client Secret**.
3. Put them in `.env` as `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`.
4. Set `TWITCH_USER_LOGINS` to comma-separated logins (not display names).

### 2. Create a Haven bot

**Settings → Server Admin Settings → Bots** → create a bot in the announce channel. Copy the **Webhook URL** into `HAVEN_WEBHOOK_URL`.

No callback URL is required for polling-only operation.

### 3. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/twitch-live
npm install
cp .env.example .env
# edit .env
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `TWITCH_CLIENT_ID` | yes | Twitch application client id |
| `TWITCH_CLIENT_SECRET` | yes | Twitch application client secret |
| `TWITCH_USER_LOGINS` | yes | Comma-separated Twitch logins to watch |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `POLL_INTERVAL_SEC` | no | Poll period (default `60`, min `30`) |
| `STATE_FILE` | no | Live-state path (default `./data/twitch-live-state.json`) |
| `LIVE_MESSAGE` | no | Template with `{login}` `{display_name}` `{title}` `{game}` `{url}` `{viewers}` |
| `PORT` | no | HTTP port for health (default `3000`) |

## Behaviour

- Obtains a Helix app token via `client_credentials`; refreshes before expiry.
- First poll **seeds** currently-live streamers without posting (avoids dump on deploy).
- Later polls post only on **offline → live** transitions.
- When a streamer goes offline, state is cleared so the next go-live notifies again.

## License

MIT. See the repo root `LICENSE`.
