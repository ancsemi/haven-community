# mod-notes

Staff-only notepad: store free-form notes against a user id/name in a local `STATE_FILE`.

This does **not** warn, mute, or ban — combine with `warns` / `moderation` if you need enforcement.

## Commands

| Command | Description |
|---------|-------------|
| `/note add <userId> <text>` | Add a note |
| `/note list <userId>` | List notes |
| `/note remove <userId> <id>` | Delete one note |
| `/note clear <userId>` | Delete all notes for a user |
| `/notes <userId>` | Alias for list |
| `/note <userId> <text>` | Shortcut for add |

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot (staff channel recommended).
2. **Callback URL:** `https://your-bot-host/haven`
3. **Callback Secret** = `CALLBACK_SECRET`
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`
5. Optional: **Webhook Token** → `HAVEN_WEBHOOK_TOKEN`

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/mod-notes
npm install
cp .env.example .env
# set ALLOWED_USER_IDS to staff Haven user ids
node --env-file=.env server.js
```

This needs Node 20.6 or newer, which loads `.env` through `--env-file`.

If the bot runs on localhost or a LAN address, set `HAVEN_ALLOW_PRIVATE_CALLBACKS=true` on the Haven server. Otherwise Haven's SSRF guard drops the slash command callbacks.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `ALLOWED_USER_IDS` | yes | Comma-separated staff Haven user ids. If it is empty, every note command is refused |
| `MODERATOR_USER_IDS` | no | Alias for allowlist |
| `APPROVER_USER_IDS` | no | Alias for allowlist |
| `STATE_FILE` | no | JSON path (default `./data/mod-notes-state.json`) |
| `MAX_NOTES_PER_USER` | no | Cap (default `100`) |
| `MAX_NOTE_LENGTH` | no | Per-note length (default `1000`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | Slash registration token |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Only the Haven user ids in `ALLOWED_USER_IDS` (or its aliases) can use the note commands. With no ids set, the bot refuses everyone and logs a warning at startup.
- Target is free-form (user id or name string).
- Notes are **public in the bot channel** unless you host the bot only in a private staff channel.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
