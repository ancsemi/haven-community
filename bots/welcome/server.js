// welcome — Haven community bot
//
// Listens for Haven member-joined webhook events and posts a configurable
// greeting into the channel via the bot webhook API.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET;
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const WELCOME_TEMPLATE = process.env.WELCOME_TEMPLATE
  || '👋 Welcome to the channel, **{username}**! Say hi and check the pinned rules.';
const STATE_FILE = process.env.STATE_FILE || './data/welcome-state.json';
const MAX_REMEMBERED = Math.max(1, parseInt(process.env.MAX_REMEMBERED || '5000', 10) || 5000);
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

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

// Haven can send member-joined again for someone who is already a member, so
// remember who has been welcomed (oldest dropped past MAX_REMEMBERED).
function loadWelcomed() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return Array.isArray(j.welcomed) ? j.welcomed.map(String).slice(-MAX_REMEMBERED) : [];
  } catch {
    return [];
  }
}

const welcomedList = loadWelcomed();
const welcomed = new Set(welcomedList);

function rememberWelcomed(key) {
  welcomed.add(key);
  welcomedList.push(key);
  while (welcomedList.length > MAX_REMEMBERED) welcomed.delete(welcomedList.shift());
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ welcomed: welcomedList }));
  } catch (err) {
    console.error('[state] save failed:', err.message);
  }
}

function renderTemplate(username, userId) {
  return WELCOME_TEMPLATE
    .replaceAll('{username}', username || 'friend')
    .replaceAll('{user_id}', String(userId ?? ''))
    .slice(0, 4000);
}

async function postToHaven(content) {
  const body = { content };
  if (HAVEN_USERNAME) body.username = HAVEN_USERNAME;
  if (HAVEN_AVATAR_URL) body.avatar_url = HAVEN_AVATAR_URL;
  const res = await fetch(HAVEN_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Haven responded ${res.status}: ${text.slice(0, 300)}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send('welcome bot is running. POST Haven member-joined events to /haven.');
});
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/haven', async (req, res) => {
  const raw = req.body;
  const sig = req.get('X-Haven-Signature') || '';
  const eventHeader = (req.get('X-Haven-Event') || '').toLowerCase();

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

  const event = (payload.event || eventHeader || '').toLowerCase();
  if (event === 'test') {
    try {
      await postToHaven('✅ Welcome bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }
  if (event !== 'member-joined') {
    return res.json({ ignored: `event=${event}` });
  }

  const user = payload.user || {};
  const username = user.username || user.displayName || 'friend';
  const userId = user.id;
  const key = userId != null ? `id:${userId}` : `name:${String(username).toLowerCase()}`;
  if (welcomed.has(key)) {
    return res.json({ ignored: 'already welcomed' });
  }
  const content = renderTemplate(username, userId);

  try {
    await postToHaven(content);
    rememberWelcomed(key);
    console.log(`[${new Date().toISOString()}] welcomed: ${username} (${userId})`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] post failed:`, err.message);
    res.status(502).json({ error: 'failed to post to Haven', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`welcome bot listening on :${PORT}`);
});
