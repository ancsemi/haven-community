# custom-commands

User-defined canned responses for Haven: Carl-style custom tags and text commands.

Manage tags with slash commands; optionally fire them from chat when someone types `!tagname` (prefix configurable).

## Commands

| Command | Description |
|---------|-------------|
| `/tag set <name> <response>` | Create a tag, or update one you created |
| `/tag get <name>` | Post a tag’s response |
| `/tag delete <name>` | Remove a tag you created |
| `/tag list` | List all tag names |

With `ENABLE_PREFIX=true` (default), a channel message whose content is exactly `{PREFIX}{name}` (e.g. `!rules`) posts that tag’s response.

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot in the target channel.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Bots receive **`message`** events by default, so there is nothing extra to turn on. Prefix triggers need them.
5. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
6. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for `/tag` registration.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/custom-commands
npm install
cp .env.example .env
# edit .env
node --env-file=.env server.js
```

Needs Node 20.6 or newer (`--env-file` is what loads your `.env`). If the bot runs on localhost or a LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server, otherwise Haven will not deliver callbacks to it.

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
| `ADMIN_USER_IDS` | no | Comma-separated Haven user ids that may overwrite or delete anyone's tag (empty = only each tag's creator, the bot warns at startup) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Tag names are normalized to lowercase letters, digits, `_`, and `-`.
- Tags persist across restarts via `STATE_FILE`.
- Anyone can create a tag. Only its creator, or an id in `ADMIN_USER_IDS`, can overwrite or delete it. Tags saved by older versions of this bot have no recorded creator, so only `ADMIN_USER_IDS` can change those.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
