# math

Safe calculator for Haven — `/math <expr>` with a recursive-descent parser (no `eval` / `Function`).

## Commands

| Command | Description |
|---------|-------------|
| `/math <expr>` | Evaluate expression |
| `/calc <expr>` | Alias |

### Supported operators

`+` `-` `*` `/` `^` (power, right-assoc) `%` (modulo) and parentheses.

### Examples

```
/math 2+2*3
/math (1+2)^3
/math 10%3
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
cd haven-community/bots/math
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
| `MAX_EXPR_LEN` | no | Max expression length (default `200`) |
| `HAVEN_WEBHOOK_TOKEN` | no | 64-hex token for slash registration |
| `PORT` | no | HTTP port (default `3000`) |

## Safety

- Only digits, `.`, `e`/`E`, and `+ - * / ^ % ( )` are accepted.
- No identifiers, function calls, or code execution.
- Guards division/modulo by zero and non-finite results.
- Accepts both `sha256=<hex>` and bare hex on `X-Haven-Signature`.

## License

MIT. See the repo root `LICENSE`.
