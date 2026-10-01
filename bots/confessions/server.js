// confessions — Haven community bot
//
// Slash /confess <text> posts anonymously as Confession Bot (no author name).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || 'Confession Bot';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const MAX_LENGTH = Math.max(1, parseInt(process.env.MAX_LENGTH || '1500', 10) || 1500);
const COOLDOWN_SEC = Math.max(0, parseInt(process.env.COOLDOWN_SEC || '30', 10) || 30);
const PREFIX = process.env.PREFIX || '🙊 **Confession**';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

// In-memory cooldowns only (no author stored in posts)
const cooldowns = new Map();

function verifySignature(rawBody, headerValue) {
  if (!headerValue) return false;
  const provided = headerValue.startsWith('sha256=') ? headerValue.slice(7) : headerValue;
  const expected = crypto
    .createHmac('sha256', CALLBACK_SECRET)
    .update(rawBody)
    .digest('hex');
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function webhookToken() {
  if (HAVEN_WEBHOOK_TOKEN) return HAVEN_WEBHOOK_TOKEN;
  const m = HAVEN_WEBHOOK_URL.match(/\/api\/webhooks\/([a-f0-9]{64})/i);
  return m ? m[1] : '';
}

function actorKey(user) {
  if (user && user.id != null && user.id !== '') return `id:${user.id}`;
  const name = (user && (user.username || user.displayName)) || '';
  return name ? `name:${String(name).toLowerCase()}` : 'anon';
}

async function postToHaven(content) {
  const body = { content, username: HAVEN_USERNAME };
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

async function registerCommands() {
  const token = webhookToken();
  if (!token) return;
  const url = `${new URL(HAVEN_WEBHOOK_URL).origin}/api/webhooks/${token}/commands`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'confess',
      description: 'Post an anonymous confession',
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /confess');
  }
}

function checkCooldown(key) {
  if (COOLDOWN_SEC <= 0) return null;
  const last = cooldowns.get(key) || 0;
  const now = Date.now();
  const wait = COOLDOWN_SEC * 1000 - (now - last);
  if (wait > 0) return Math.ceil(wait / 1000);
  cooldowns.set(key, now);
  return null;
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'confess') return { ignored: true };

  const text = String(payload.args || '').trim().slice(0, MAX_LENGTH);
  const user = payload.user || {};

  if (!text) {
    await postToHaven('Usage: `/confess <text>` — your name is **not** shown.');
    return;
  }

  const key = actorKey(user);
  const wait = checkCooldown(key);
  if (wait != null) {
    // Still post as Confession Bot so we don't leak identity; keep message generic
    await postToHaven(`⏳ Please wait **${wait}s** before another confession.`);
    return;
  }

  // Never include author username or id in the public confession body
  const content = `${PREFIX}\n${text}`.slice(0, 4000);
  await postToHaven(content);
  console.log(`[${new Date().toISOString()}] confession posted (len=${text.length})`);
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`confessions bot running. username=${HAVEN_USERNAME}`);
});
app.get('/health', (_req, res) =>
  res.json({ ok: true, username: HAVEN_USERNAME, cooldownSec: COOLDOWN_SEC })
);

app.post('/haven', async (req, res) => {
  const raw = req.body;
  const sig = req.get('X-Haven-Signature') || '';

  if (!verifySignature(raw, sig)) {
    console.warn(`[${new Date().toISOString()}] rejected: bad signature`);
    return res.status(401).json({ error: 'invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || ''));
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }

  if (payload.event === 'test') {
    try {
      await postToHaven('✅ Confessions bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  if (payload.event !== 'slash_command') {
    return res.json({ ignored: true });
  }

  try {
    const result = await handleSlash(payload);
    if (result && result.ignored) return res.json({ ignored: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('slash handler error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  console.log(`confessions bot listening on :${PORT}`);
  console.log(`  posts as: ${HAVEN_USERNAME} cooldown=${COOLDOWN_SEC}s`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
