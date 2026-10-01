# github-issues

Posts a formatted message to a Haven channel when GitHub issues are opened, closed, or reopened (configurable).

Listens for GitHub `issues` webhook events, verifies `X-Hub-Signature-256` HMAC (same pattern as `github-releases`), and posts a short card (repo, number, title, link, labels, optional body).

## What the message looks like

```
🆕 Issue opened: owner/repo#42
**Login button broken on mobile**
https://github.com/owner/repo/issues/42
_Author: @alice_
Labels: `bug` `mobile`

Steps to reproduce…
```

## Setup

### 1. Create a Haven bot

In your Haven server: **Settings → Server Admin Settings → Bots**, create a bot in the channel that should receive issue posts, and copy the full **Webhook URL**.

### 2. Pick a GitHub webhook secret

```bash
openssl rand -hex 32
```

Use the same value in GitHub and in `GITHUB_WEBHOOK_SECRET`.

### 3. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/github-issues
npm install
cp .env.example .env
# edit .env
node server.js
```

### 4. Configure the GitHub webhook

In the GitHub repo (or org):

1. **Settings → Webhooks → Add webhook**
2. **Payload URL:** `https://your-bot-host.tld/github`
3. **Content type:** `application/json`
4. **Secret:** same as `GITHUB_WEBHOOK_SECRET`
5. **Events:** “Let me select individual events” → tick **Issues** only
6. Save, then check **Recent Deliveries** for a `200` on the ping

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `GITHUB_WEBHOOK_SECRET` | yes | Shared secret; verifies `X-Hub-Signature-256` |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `REPO_FILTER` | no | If set, only this `owner/repo` |
| `ACTIONS` | no | Comma list (default `opened,closed,reopened`). Also supports e.g. `labeled`, `assigned`, `edited` |
| `IGNORE_PRS` | no | `true` (default) skips issue events that are pull requests |
| `BODY_MAX_CHARS` | no | Body snippet length (default `800`; `0` = omit truncation but still length-capped in message) |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Verifies HMAC over the **raw** body before JSON parse.
- Ignores non-`issues` events (except `ping`).
- Default actions: opened / closed / reopened.
- Body text is included for opened/reopened/edited only.

## License

MIT. See the repo root `LICENSE`.
