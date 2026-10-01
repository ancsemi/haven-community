# lastfm

Show what someone is listening to via Last.fm: `/np [user]`.

Requires a free **Last.fm API key** ([create an API account](https://www.last.fm/api/account/create)).

## Commands

| Command | Description |
|---------|-------------|
| `/np` | Now playing / last track for your linked user or `DEFAULT_USER` |
| `/np <lastfm_user>` | Look up a specific Last.fm username |
| `/np set <lastfm_user>` | Link your Haven identity to a Last.fm user |
| `/np unset` | Remove your link |
| `/np whoami` | Show your linked username |
| `/lastfm …` | Alias for `/np` |

## Setup

### 1. Last.fm API key

1. Visit https://www.last.fm/api/account/create
2. Create an application and copy the **API key** → `LASTFM_API_KEY`

### 2. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. **Callback URL:** `https://your-bot-host/haven`
3. **Callback Secret** = `CALLBACK_SECRET`
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`
5. Optional: **Webhook Token** → `HAVEN_WEBHOOK_TOKEN`

### 3. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/lastfm
npm install
cp .env.example .env
# set LASTFM_API_KEY, HAVEN_WEBHOOK_URL, CALLBACK_SECRET
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `LASTFM_API_KEY` | yes | Last.fm API key |
| `DEFAULT_USER` | no | Last.fm username when none given / linked |
| `STATE_FILE` | no | User→Last.fm links (default `./data/lastfm-state.json`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Uses `user.getrecenttracks`; marks **Now playing** when Last.fm sets `nowplaying`.
- Links are stored locally (not on Last.fm).
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
