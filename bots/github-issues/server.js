// github-issues — Haven community bot
//
// Listens for GitHub issues webhooks, verifies HMAC, and posts opened/closed
// (and optional reopened/labeled) issue cards into a Haven channel.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const GITHUB_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const REPO_FILTER = (process.env.REPO_FILTER || '').trim().toLowerCase();
const ACTIONS = new Set(
  (process.env.ACTIONS || 'opened,closed,reopened')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
const BODY_MAX_CHARS = Math.max(0, parseInt(process.env.BODY_MAX_CHARS || '800', 10) || 800);
const IGNORE_PRS = String(process.env.IGNORE_PRS || 'true').toLowerCase() !== 'false';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !GITHUB_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and GITHUB_WEBHOOK_SECRET are both required.');
  process.exit(1);
}

function verifySignature(rawBody, headerValue) {
  if (!headerValue || !headerValue.startsWith('sha256=')) return false;
  const expected = crypto
    .createHmac('sha256', GITHUB_SECRET)
    .update(rawBody)
    .digest('hex');
  const provided = headerValue.slice(7);
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function truncate(text, max) {
  const t = String(text || '').trim();
  if (max <= 0 || t.length <= max) return t;
  return t.slice(0, max).trimEnd() + '\n\n… (see GitHub for full text)';
}

function buildMessage(payload) {
  const issue = payload.issue || {};
  const repo = payload.repository || {};
  const action = payload.action || '';
  const sender = (payload.sender && payload.sender.login) || '';
  const repoFull = repo.full_name || 'unknown/unknown';
  const number = issue.number != null ? issue.number : '?';
  const title = issue.title || 'Untitled';
  const url = issue.html_url || '';
  const user = (issue.user && issue.user.login) || '';
  const labels = (issue.labels || [])
    .map((l) => (typeof l === 'string' ? l : l.name))
    .filter(Boolean)
    .slice(0, 8);

  let icon = '📌';
  if (action === 'opened') icon = '🆕';
  else if (action === 'closed') icon = issue.state_reason === 'not_planned' ? '🚫' : '✅';
  else if (action === 'reopened') icon = '🔄';
  else if (action === 'labeled' || action === 'unlabeled') icon = '🏷️';
  else if (action === 'assigned' || action === 'unassigned') icon = '👤';

  const lines = [];
  lines.push(`${icon} **Issue ${action}: ${repoFull}#${number}**`);
  lines.push(`**${title}**`);
  if (url) lines.push(url);
  if (user) lines.push(`_Author: @${user}_`);
  if (sender && sender !== user) lines.push(`_By: @${sender}_`);
  if (labels.length) lines.push(`Labels: ${labels.map((l) => `\`${l}\``).join(' ')}`);
  if (action === 'closed' && issue.state_reason) {
    lines.push(`_Reason: ${issue.state_reason}_`);
  }

  const body = truncate(issue.body || '', BODY_MAX_CHARS);
  if (body && (action === 'opened' || action === 'reopened' || action === 'edited')) {
    lines.push('');
    lines.push(body);
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
app.use('/github', express.raw({ type: '*/*', limit: '2mb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send('github-issues bot is running. POST GitHub issues webhooks to /github.');
});

app.get('/health', (_req, res) =>
  res.json({ ok: true, actions: [...ACTIONS], ignorePrs: IGNORE_PRS })
);

app.post('/github', async (req, res) => {
  const sig = req.get('X-Hub-Signature-256');
  const event = (req.get('X-GitHub-Event') || '').toLowerCase();
  const raw = req.body;

  if (!verifySignature(raw, sig)) {
    console.warn(`[${new Date().toISOString()}] rejected: bad signature (event=${event})`);
    return res.status(401).json({ error: 'invalid signature' });
  }

  if (event === 'ping') return res.json({ pong: true });
  if (event !== 'issues') return res.json({ ignored: `event=${event}` });

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }

  const action = String(payload.action || '').toLowerCase();
  const issue = payload.issue || {};
  const repo = payload.repository || {};

  if (IGNORE_PRS && issue.pull_request) {
    return res.json({ ignored: 'pull_request' });
  }

  if (!ACTIONS.has(action)) {
    return res.json({ ignored: `action=${action}` });
  }

  if (REPO_FILTER && (repo.full_name || '').toLowerCase() !== REPO_FILTER) {
    return res.json({ ignored: `repo=${repo.full_name}` });
  }

  const message = buildMessage(payload);
  try {
    await postToHaven(message);
    console.log(
      `[${new Date().toISOString()}] posted: ${repo.full_name}#${issue.number} ${action}`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] post failed:`, err.message);
    res.status(502).json({ error: 'failed to post to Haven', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`github-issues bot listening on :${PORT}`);
  console.log(`  actions: ${[...ACTIONS].join(', ')}`);
  if (REPO_FILTER) console.log(`  filtering to repo: ${REPO_FILTER}`);
  console.log(`  ignore PRs: ${IGNORE_PRS ? 'on' : 'off'}`);
});
