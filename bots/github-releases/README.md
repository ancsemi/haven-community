# github-releases

Posts a formatted message to a Haven channel whenever a new release is published on a watched GitHub repository.

Listens for GitHub `release` webhook events, verifies the `X-Hub-Signature-256` HMAC, and posts a clean summary (title, tag, link, body) into a Haven channel via the bot webhook API.

## What the message looks like

```
🚀 New release: My App v1.4.0
https://github.com/owner/repo/releases/tag/v1.4.0

### Added
- Dark mode toggle
- New /summary slash command

### Fixed
- Crash when opening Settings on Windows
```

## Setup

### 1. Create a Haven bot

In your Haven server, go to **Settings → Server Admin Settings → Bots**, create a new bot in the channel where releases should be posted, and copy its **Webhook Token** and full **Webhook URL** (it looks like `https://your-haven.tld/api/webhooks/<64-hex-token>`).

### 2. Pick a GitHub webhook secret

Generate any random string (32+ characters). You'll give the same value to both GitHub and this bot.

```bash
# example
openssl rand -hex 32
```

### 3. Host this bot

Anywhere that can receive HTTPS POSTs from GitHub and reach your Haven server. Free options that work fine:

- [Fly.io](https://fly.io) (free hobby tier)
- [Railway](https://railway.app)
- [Render](https://render.com) (free tier)
- A small VPS
- Cloudflare Workers (would need a small port — the current code uses Node/Express)

Install and run:

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/github-releases
npm install
cp .env.example .env
# edit .env with your values, then (Node 20.6 or newer):
node --env-file=.env server.js
```

### 4. Configure the GitHub webhook

In the GitHub repo you want to track:

1. Go to **Settings → Webhooks → Add webhook**.
2. **Payload URL:** `https://your-bot-host.tld/github`
3. **Content type:** `application/json`
4. **Secret:** the same value you put in `GITHUB_WEBHOOK_SECRET`.
5. **Which events?** Pick "Let me select individual events" and tick only **Releases**.
6. Save.

Click "Recent Deliveries" on the webhook to verify GitHub got a `200 OK` on the ping.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL, e.g. `https://haven.example.com/api/webhooks/<token>` |
| `GITHUB_WEBHOOK_SECRET` | yes | Shared secret you set on the GitHub webhook. Used to verify `X-Hub-Signature-256`. |
| `HAVEN_USERNAME` | no | Override the bot's display name for these messages (e.g. `Release Bot`). |
| `HAVEN_AVATAR_URL` | no | Override the bot's avatar for these messages. |
| `REPO_FILTER` | no | If set, only post releases from this `owner/repo` (e.g. `ancsemi/Haven`). Otherwise, accepts all repos pointed at this endpoint. |
| `INCLUDE_PRERELEASES` | no | `true` to also post pre-releases. Defaults to `false`. |
| `INCLUDE_DRAFTS` | no | `true` to also post drafts. Defaults to `false`. |
| `BODY_MAX_CHARS` | no | Truncate the release body at this many characters. Default `1500`. |
| `PORT` | no | Port to listen on. Default `3000`. |

## What you'll see in Haven

The bot only triggers on the `release.published` event (or `prereleased` / `created` if you've opted in via env vars). Edits, deletes, and other release lifecycle events are ignored to prevent spam.

If the release body is longer than `BODY_MAX_CHARS` it gets truncated with a `… (see GitHub for full notes)` suffix.

## Troubleshooting

- **GitHub shows `401 invalid signature`** — your `GITHUB_WEBHOOK_SECRET` doesn't match what you put in GitHub's webhook config. Re-check.
- **GitHub shows `200 OK` but nothing appears in Haven** — check the bot logs. Either `HAVEN_WEBHOOK_URL` is wrong, or your Haven server rejected the message (rate limit / channel deleted / token revoked).
- **All releases post twice** — you have the GitHub webhook configured for both `released` and `published`. Use only `Releases` and let the bot's own event filter handle the rest.

## License

MIT. See the repo root `LICENSE`.
