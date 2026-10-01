# translate

Slash-command translation for Haven. Tries **LibreTranslate** first (if `LIBRETRANSLATE_URL` is set), then falls back to the free **MyMemory** API.

## Commands

| Command | Description |
|---------|-------------|
| `/translate <lang> <text>` | Translate text into language code `lang` (e.g. `es`, `fr`, `de`, `ja`) |

### Example

```
/translate es Hello friends!
```

```
🌐 **en → es**
Hola amigos!
```

## Setup

### 1. Create a Haven bot

1. **Settings → Server Admin Settings → Bots** → create a bot.
2. Set **Callback URL** to `https://your-bot-host/haven`.
3. Set **Callback Secret** (same as `CALLBACK_SECRET`).
4. Copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.
5. Copy **Webhook Token** → `HAVEN_WEBHOOK_TOKEN` for slash registration.

### 2. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/translate
npm install
cp .env.example .env
# edit .env
node server.js
```

### 3. Translation backends

- **LibreTranslate** — set `LIBRETRANSLATE_URL` to a public or self-hosted instance (optional `LIBRETRANSLATE_API_KEY`).
- **MyMemory** — used automatically when LibreTranslate is unset or fails. Rate-limited free tier; no key required.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `CALLBACK_SECRET` | yes | HMAC secret for `/haven` |
| `LIBRETRANSLATE_URL` | no | LibreTranslate base URL (no trailing slash) |
| `LIBRETRANSLATE_API_KEY` | no | API key if the instance requires one |
| `SOURCE_LANG` | no | Source language (`auto` default; MyMemory uses `en` when auto) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## License

MIT. See the repo root `LICENSE`.
