# automod

Lightweight word-list automoderation for Haven channels — Dyno / Carl-style filter for self-hosted Haven.

Listens for Haven **`message`** events, matches against a configurable blocklist, then warns, optionally deletes the message, and optionally mutes the author (when the bot has `can_moderate`).

## What the mod-log looks like

```
🛡️ **AutoMod** blocked message from **Ada** (`#42`)
Matched: `spamword`
Actions: deleted, warned
```

With `WARN_ONLY=true`:

```
⚠️ **AutoMod** warning for **Ada**
Please avoid blocked language (`spamword`).
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the channel to protect.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same value as `CALLBACK_SECRET`).
4. Under event subscriptions, include **`message`** (or `*`).
5. Copy the full **Webhook URL** into `HAVEN_WEBHOOK_URL`.
6. Copy the **Webhook Token** into `HAVEN_WEBHOOK_TOKEN` if you want delete/mute actions.
7. If using mute: enable **`can_moderate`** on the bot in Haven’s Bot Manager.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/automod
npm install
cp .env.example .env
# edit .env — set BAD_WORDS and/or BLOCKLIST_FILE
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret matching the bot’s callback secret |
| `BAD_WORDS` | no* | Comma-separated words/phrases (*or use `BLOCKLIST_FILE`) |
| `BLOCKLIST_FILE` | no* | Path to file with one word/phrase per line |
| `WARN_ONLY` | no | `true` = post a warning only (no delete/mute). Default `false` |
| `AUTOMOD_DELETE` | no | `true` = DELETE the message via webhook API. Default `true` |
| `AUTOMOD_MUTE` | no | `true` = mute author via bot moderation API. Default `false` |
| `MUTE_DURATION_MIN` | no | Mute length in minutes (default `10`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token (defaults to token parsed from webhook URL) |
| `MODLOG_WEBHOOK_URL` | no | Alternate webhook for mod-log lines |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `IGNORE_USER_IDS` | no | Comma-separated user ids to skip |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Matching is **case-insensitive** substring match on message content.
- Bot/webhook-authored messages (when identifiable) are ignored when possible.
- Signature verification accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.
- Delete uses `DELETE /api/webhooks/<token>/messages/<id>`.
- Mute uses `POST /api/webhooks/<token>/moderation/mute` with `{ userId, duration, reason }` (requires `can_moderate`).

## License

MIT. See the repo root `LICENSE`.
