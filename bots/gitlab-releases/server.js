// gitlab-releases — Haven community bot
//
// Listens for GitLab Release webhooks, verifies the shared token header, and
// posts formatted release notes into a Haven channel.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const GITLAB_TOKEN = process.env.GITLAB_WEBHOOK_TOKEN || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const PROJECT_FILTER = (process.env.PROJECT_FILTER || '').trim().toLowerCase();
const INCLUDE_UPDATES = String(process.env.INCLUDE_UPDATES || 'false').toLowerCase() === 'true';
const BODY_MAX_CHARS = Math.max(0, parseInt(process.env.BODY_MAX_CHARS || '1500', 10) || 1500);
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !GITLAB_TOKEN) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and GITLAB_WEBHOOK_TOKEN are both required.');
  process.exit(1);
}

function tokensEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

function projectPath(payload) {
  const p = payload.project || {};
  return (
    p.path_with_namespace ||
    payload.project_path ||
    (p.namespace && p.name ? `${p.namespace}/${p.name}` : '') ||
    p.name ||
    'unknown/project'
  );
}

function buildMessage(payload) {
  const project = projectPath(payload);
  const name = payload.name || payload.tag || 'release';
  const tag = payload.tag || '';
  const url = payload.url || (payload.project && payload.project.web_url) || '';
  const action = (payload.action || '').toLowerCase();
  const author =
    (payload.commit && payload.commit.author && payload.commit.author.name) ||
    payload.author_name ||
    '';

  let description = String(payload.description || '').trim();
  if (BODY_MAX_CHARS > 0 && description.length > BODY_MAX_CHARS) {
    description =
      description.slice(0, BODY_MAX_CHARS).trimEnd() + '\n\n… (see GitLab for full notes)';
  }

  const icon = action === 'update' ? '📝' : action === 'delete' ? '🗑️' : '🚀';
  const kind = action === 'update' ? 'updated release' : action === 'delete' ? 'deleted release' : 'release';

  const lines = [];
  lines.push(`${icon} **New ${kind}: ${project} ${name}**`);
  if (tag && tag !== name) lines.push(`Tag: \`${tag}\``);
  if (url) lines.push(url);
  if (author) lines.push(`_by ${author}_`);
  if (description) {
    lines.push('');
    lines.push(description);
  }
  return lines.join('\n').slice(0, 4000);
}

async function postToHaven(content) {
  const body = { content };
  if (HAVEN_USERNAME) body.username = HAVEN_USERNAME;
  if (HAVEN_AVATAR_URL) body.avatar_url = HAVEN_AVATAR_URL;
  const res = await fetch(HAVEN_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Haven responded ${res.status}: ${text.slice(0, 300)}`);
  }
}

const app = express();
app.use('/gitlab', express.raw({ type: '*/*', limit: '2mb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send('gitlab-releases bot is running. POST GitLab Release webhooks to /gitlab.');
});
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/gitlab', async (req, res) => {
  const tokenHeader = req.get('X-Gitlab-Token') || '';
  const event = (req.get('X-Gitlab-Event') || '').toLowerCase();
  const raw = req.body;

  if (!tokensEqual(tokenHeader, GITLAB_TOKEN)) {
    console.warn(`[${new Date().toISOString()}] rejected: bad X-Gitlab-Token (event=${event})`);
    return res.status(401).json({ error: 'invalid token' });
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || ''));
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }

  // GitLab may send object_kind=release and/or X-Gitlab-Event: Release Hook
  const kind = String(payload.object_kind || payload.event_name || '').toLowerCase();
  const isRelease =
    kind === 'release' ||
    event.includes('release') ||
    (payload.tag != null && payload.name != null && payload.action != null);

  if (!isRelease) {
    return res.json({ ignored: `event=${event || kind || 'unknown'}` });
  }

  const action = String(payload.action || 'create').toLowerCase();
  if (action === 'delete') {
    return res.json({ ignored: 'action=delete' });
  }
  if (action === 'update' && !INCLUDE_UPDATES) {
    return res.json({ ignored: 'action=update' });
  }
  // create (and optionally update) accepted

  const path = projectPath(payload).toLowerCase();
  if (PROJECT_FILTER && path !== PROJECT_FILTER) {
    return res.json({ ignored: `project=${path}` });
  }

  const message = buildMessage(payload);
  try {
    await postToHaven(message);
    console.log(`[${new Date().toISOString()}] posted: ${path} ${payload.tag || payload.name}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] post failed:`, err.message);
    res.status(502).json({ error: 'failed to post to Haven', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`gitlab-releases bot listening on :${PORT}`);
  if (PROJECT_FILTER) console.log(`  filtering to project: ${PROJECT_FILTER}`);
  console.log(`  include updates: ${INCLUDE_UPDATES ? 'on' : 'off'}`);
});
