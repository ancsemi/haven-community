# trivia

Pull a question from [Open Trivia DB](https://opentdb.com/) with `/trivia start`. The **first correct chat message** wins (letter **A–D** or full answer text).

Subscribe the bot to **message** events (and slash callbacks) in Haven.

## Commands

| Command | Description |
|---------|-------------|
| `/trivia start` | New question |
| `/trivia skip` | Reveal answer and end round |
| `/trivia stop` | Cancel without revealing |
| `/trivia status` | Re-post active question |
| `/trivia scores` | Win leaderboard |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. **Callback URL:** `https://your-bot-host/haven`
3. **Callback Secret** = `CALLBACK_SECRET`
4. Enable **message** events (so answers are seen).
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`
6. Optional: **Webhook Token** → `HAVEN_WEBHOOK_TOKEN`

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/trivia
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
| `CATEGORY` | no | OpenTDB category id |
| `DIFFICULTY` | no | `easy`, `medium`, or `hard` |
| `TYPE` | no | `multiple` or `boolean` |
| `TIMEOUT_SEC` | no | Auto-reveal after N seconds (default `120`; `0` disables) |
| `STATE_FILE` | no | Active question + wins (default `./data/trivia-state.json`) |
| `ALLOW_BOTS` | no | Count bot messages as answers (default `false`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- HTML entities from OpenTDB are decoded before display/matching.
- True/False accepts `true`/`false`/`yes`/`no`/`t`/`f` and letters when listed.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
