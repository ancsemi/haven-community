# gitlab-releases

Posts a formatted message to a Haven channel whenever a **Release** is created (optionally updated) on a watched GitLab project.

Listens for GitLab webhooks, verifies `X-Gitlab-Token`, and posts title, tag, link, and description via the Haven bot webhook API.

## What the message looks like

```
🚀 **New release: group/project v1.4.0**
Tag: `v1.4.0`
https://gitlab.example.com/group/project/-/releases/v1.4.0
_by Alice_

### Added
- Feature X
```

## Setup

### 1. Create a Haven bot

In your Haven server: **Settings → Server Admin Settings → Bots**, create a bot in the target channel, copy **Webhook URL** → `HAVEN_WEBHOOK_URL`.

### 2. Pick a webhook token

Generate a long random secret. You will set the same value in GitLab’s webhook **Secret token** and in `GITLAB_WEBHOOK_TOKEN`.

```bash
openssl rand -hex 32
```

### 3. Host this bot

```bash
git clone https://github.com/ancsemi/haven-community.git
cd haven-community/bots/gitlab-releases
npm install
cp .env.example .env
# edit .env
node server.js
```

### 4. Configure the GitLab webhook

In the GitLab project (or group):

1. **Settings → Webhooks**.
2. **URL:** `https://your-bot-host.tld/gitlab`
3. **Secret token:** same as `GITLAB_WEBHOOK_TOKEN`.
4. Trigger: **Releases events** (and uncheck others if you only want releases).
5. Save / test.

## Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `HAVEN_WEBHOOK_URL` | yes | Full Haven bot webhook URL |
| `GITLAB_WEBHOOK_TOKEN` | yes | Shared secret; must match GitLab webhook token (`X-Gitlab-Token`) |
| `HAVEN_USERNAME` | no | Display name override |
| `HAVEN_AVATAR_URL` | no | Avatar override |
| `PROJECT_FILTER` | no | Only post for this `path_with_namespace` (e.g. `group/project`) |
| `INCLUDE_UPDATES` | no | `true` to also post release updates (default `false`) |
| `BODY_MAX_CHARS` | no | Max description length (default `1500`; `0` = no truncate) |
| `PORT` | no | HTTP port (default `3000`) |

## Behaviour

- Verifies `X-Gitlab-Token` with a timing-safe compare.
- Accepts release **create** by default; **update** only if `INCLUDE_UPDATES=true`.
- Ignores **delete** events.
- Does not use Haven slash callbacks (inbound GitLab only).

## License

MIT. See the repo root `LICENSE`.
