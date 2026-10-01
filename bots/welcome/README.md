# welcome

Posts a configurable welcome message whenever someone joins the bot’s Haven channel — MEE6 / ProBot style greeter for Haven.

Uses Haven’s `member-joined` webhook event (Haven 3.13+).

## What the message looks like

```
👋 Welcome to the channel, **Ada**! Say hi and check the pinned rules.
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the channel people join.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** to a long random string; put the same value in `.env` as `CALLBACK_SECRET`.
4. Under event subscriptions, include **`member-joined`** (or `*` for all events).
5. Copy the full **Webhook URL** into `HAVEN_WEBHOOK_URL`.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/welcome
npm install
cp .env.example .env
# edit .env
node server.js
```

### 3. Test

Have a test user join the channel (or leave and re-join). You should see the welcome line within a few seconds. Haven’s bot panel also has a “test delivery” action if your server version exposes it.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | Same secret as the bot’s callback secret (HMAC) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `WELCOME_TEMPLATE` | no | Message template; `{username}` and `{user_id}` are substituted |
| `PORT` | no | Listen port (default `3000`) |

## Template placeholders

- `{username}` — display name of the joiner
- `{user_id}` — numeric user id

## License

MIT. See the repo root `LICENSE`.
