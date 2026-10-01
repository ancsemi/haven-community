# custom-commands

User-defined canned responses for Haven — Carl-style custom tags / text commands.

Manage tags with slash commands; optionally fire them from chat when someone types `!tagname` (prefix configurable).

## Commands

| Command | Description |
|---------|-------------|
| `/tag set <name> <response>` | Create or update a tag |
| `/tag get <name>` | Post a tag’s response |
| `/tag delete <name>` | Remove a tag |
| `/tag list` | List all tag names |

With `ENABLE_PREFIX=true` (default), a channel message whose content is exactly `{PREFIX}{name}` (e.g. `!rules`) posts that tag’s response.

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the target channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Subscribe to **`message`** if you want prefix triggers (or `*`).
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
6. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for `/tag` registration.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/custom-commands
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
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `STATE_FILE` | no | Tags JSON path (default `./data/custom-commands-state.json`) |
| `MAX_TAGS` | no | Cap on stored tags (default `100`) |
| `MAX_TAG_LEN` | no | Max tag name length (default `64`) |
| `MAX_RESPONSE_LEN` | no | Max response length (default `2000`) |
| `ENABLE_PREFIX` | no | `true` to respond to `!name` messages (default `true`) |
| `PREFIX` | no | Prefix character(s) (default `!`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Tag names are normalized to lowercase letters, digits, `_`, and `-`.
- Tags persist across restarts via `STATE_FILE`.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
