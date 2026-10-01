# starboard

Highlights popular messages when they collect enough star reactions — classic Discord starboard for Haven.

Listens for Haven **`reaction-added`** events. Because each event may only include a single reaction, this bot **tracks counts in `STATE_FILE`** per `messageId` + emoji. When the count reaches `THRESHOLD`, it posts (or optionally re-posts) a starboard entry.

### What Haven gives this bot (and what it doesn't)

- A `reaction-added` event carries only the message id, the emoji and who reacted. It does **not** include the message text or the message author, so starboard posts show the count and message id, not the starred message itself.
- Haven has no "reaction removed" event, so counts only go up. Un-starring a message does not lower its count.
- A Haven bot only receives events from the channel it was created in, so the starboard only sees stars in that channel. To watch several channels, create a Haven bot in each one and point them all at this bot's callback URL with the same secret. Use `STARBOARD_WEBHOOK_URL` to post the results into a separate channel.

## What the message looks like

```
⭐ **3** | message `#142`
Last reaction by **Ada**
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot (often in a dedicated starboard channel, or use `STARBOARD_WEBHOOK_URL` for a second webhook).
2. Set **Callback URL** to `https://your-bot-host/haven` on the bot that receives reactions from the source channel(s).
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Subscribe to **`reaction-added`** (or `*`).
5. Copy the posting webhook URL into `HAVEN_WEBHOOK_URL` or `STARBOARD_WEBHOOK_URL`.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/starboard
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

Use Node 20.6 or newer. The `--env-file` flag is what loads your `.env`, and older Node versions do not have it.

If Haven reaches this bot at a `localhost` or LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server. Without it Haven refuses to call private addresses.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes* | Webhook used to post starboard lines (*or set `STARBOARD_WEBHOOK_URL`) |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `STAR_EMOJI` | no | Emoji to watch (default `⭐`) |
| `THRESHOLD` | no | Reactions needed before posting (default `3`) |
| `REPOST_ON_INCREMENT` | no | Re-post when count rises after first post (default `false`) |
| `STARBOARD_WEBHOOK_URL` | no | Alternate webhook for starboard posts |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `STATE_FILE` | no | Count / posted state (default `./data/starboard-state.json`) |
| `MAX_ENTRIES` | no | Max messages tracked in state (default `2000`); the least recently starred are dropped first |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Counts unique reactors when user id is present; otherwise increments per event.
- Signature verification accepts `sha256=<hex>` and bare hex.
- Old entries are pruned once more than `MAX_ENTRIES` messages are tracked. A pruned message that gets starred again starts counting from zero.

## License

MIT. See the repo root `LICENSE`.
