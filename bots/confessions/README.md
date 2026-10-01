# confessions

Anonymous confessions for Haven. `/confess <text>` is re-posted as **Confession Bot** with **no author name** in the message body.

## Commands

| Command | Description |
|---------|-------------|
| `/confess <text>` | Post anonymously under the bot username |

### Example

```
/confess I still use light mode.
```

Channel sees (from Confession Bot):

```
🙊 **Confession**
I still use light mode.
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the confessions channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
5. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for slash registration.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/confessions
npm install
cp .env.example .env
# edit .env
node server.js
```

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `HAVEN_USERNAME` | no | Bot display name (default `Confession Bot`) |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `MAX_LENGTH` | no | Max confession length (default `1500`) |
| `COOLDOWN_SEC` | no | Per-user cooldown seconds (default `30`; `0` disables) |
| `PREFIX` | no | Line before the confession text |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Privacy notes

- The **posted message content never includes** the confessor’s username or user id.
- Cooldown tracking uses an in-memory key derived from the caller (not written to channel).
- Haven/server logs and slash payload delivery may still see the invoking user on the **callback side** — treat the bot host as trusted, same as any slash bot.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
