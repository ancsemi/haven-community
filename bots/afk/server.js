// afk — Haven community bot
//
// Slash /afk [reason] and /back. On message events, if an AFK username is
// mentioned, announce that they are AFK (with optional reason).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const STATE_FILE = process.env.STATE_FILE || './data/afk-state.json';
const COOLDOWN_SEC = Math.max(0, parseInt(process.env.COOLDOWN_SEC || '60', 10) || 60);
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      afk: j.afk && typeof j.afk === 'object' ? j.afk : {},
      lastAnnounce: j.lastAnnounce && typeof j.lastAnnounce === 'object' ? j.lastAnnounce : {},
    };
  } catch {
    return { afk: {}, lastAnnounce: {} };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();

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

function userKey(user) {
  if (user && user.id != null && user.id !== '') return `id:${user.id}`;
  const name = (user && (user.username || user.displayName)) || '';
  return name ? `name:${String(name).toLowerCase()}` : null;
}

function displayName(entry, fallback) {
  return (entry && entry.username) || fallback || 'someone';
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

async function registerCommands() {
  const token = webhookToken();
  if (!token) return;
  const origin = new URL(HAVEN_WEBHOOK_URL).origin;
  const base = `${origin}/api/webhooks/${token}/commands`;
  const cmds = [
    { command: 'afk', description: 'Mark yourself AFK with optional reason' },
    { command: 'back', description: 'Clear your AFK status' },
  ];
  for (const body of cmds) {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[commands] register /${body.command} failed: ${res.status} ${await res.text().catch(() => '')}`);
    } else {
      console.log(`[commands] registered /${body.command}`);
    }
  }
}

function setAfk(user, reason) {
  const key = userKey(user);
  if (!key) throw new Error('Could not identify user.');
  const username = (user.username || user.displayName || '').trim() || 'user';
  const entry = {
    username,
    userId: user.id != null ? user.id : null,
    reason: String(reason || '').trim().slice(0, 300),
    since: Date.now(),
  };
  state.afk[key] = entry;
  // Also index by name so mention matching works when only names appear in text.
  const nameKey = `name:${username.toLowerCase()}`;
  if (nameKey !== key) state.afk[nameKey] = { ...entry, aliasOf: key };
  saveState(state);
  return entry;
}

function clearAfk(user) {
  const key = userKey(user);
  if (!key) return null;
  const entry = state.afk[key] || null;
  const username = (entry && entry.username) || user.username || user.displayName || '';
  delete state.afk[key];
  if (username) delete state.afk[`name:${String(username).toLowerCase()}`];
  // Drop alias rows pointing at this key
  for (const [k, v] of Object.entries(state.afk)) {
    if (v && v.aliasOf === key) delete state.afk[k];
  }
  saveState(state);
  return entry;
}

function formatDuration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

function afkMessage(entry) {
  const name = displayName(entry);
  const ago = entry.since ? formatDuration(Date.now() - entry.since) : '?';
  const reason = entry.reason ? ` — ${entry.reason}` : '';
  return `💤 **${name}** is AFK${reason} _(for ${ago})_`;
}

function findMentionedAfk(content, authorKey) {
  const text = String(content || '');
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = [];
  const seen = new Set();

  for (const [key, entry] of Object.entries(state.afk)) {
    if (!entry || entry.aliasOf) continue;
    if (authorKey && key === authorKey) continue;
    const name = String(entry.username || '').trim();
    if (!name || name.length < 2) continue;
    const nameLower = name.toLowerCase();
    // word-ish match: whole username as substring with non-alnum boundaries when possible
    const re = new RegExp(`(^|[^a-z0-9_])${nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_]|$)`, 'i');
    if (!re.test(lower) && !lower.includes(`@${nameLower}`)) continue;
    const id = entry.userId != null ? `id:${entry.userId}` : key;
    if (seen.has(id)) continue;
    seen.add(id);
    found.push(entry);
  }
  return found;
}

function canAnnounce(entry) {
  const id = entry.userId != null ? `id:${entry.userId}` : `name:${(entry.username || '').toLowerCase()}`;
  const last = state.lastAnnounce[id] || 0;
  const now = Date.now();
  if (COOLDOWN_SEC > 0 && now - last < COOLDOWN_SEC * 1000) return false;
  state.lastAnnounce[id] = now;
  saveState(state);
  return true;
}

function extractMessage(payload) {
  const msg = payload.message || payload.data || payload;
  const content = msg.content || payload.content || '';
  const user = msg.user || msg.author || payload.user || payload.author || {};
  const username = user.username || user.displayName || msg.username || 'unknown';
  const userId = user.id ?? msg.user_id ?? msg.userId ?? payload.user_id ?? null;
  const isBot = !!(user.is_bot || user.isBot || msg.is_bot || msg.webhook_id || msg.webhookId);
  return { content, user: { id: userId, username, displayName: username }, isBot };
}

async function handleMessage(payload) {
  const { content, user, isBot } = extractMessage(payload);
  if (isBot) return { skipped: 'bot' };

  const key = userKey(user);
  // Auto-clear AFK when the AFK user posts a normal message
  if (key && state.afk[key]) {
    const entry = clearAfk(user);
    if (entry) {
      await postToHaven(`👋 **${displayName(entry)}** is back!`);
      return { ok: true, cleared: true };
    }
  }

  const mentioned = findMentionedAfk(content, key);
  if (!mentioned.length) return { ok: true, match: false };

  const lines = [];
  for (const entry of mentioned) {
    if (!canAnnounce(entry)) continue;
    lines.push(afkMessage(entry));
  }
  if (!lines.length) return { ok: true, match: true, cooled: true };
  await postToHaven(lines.join('\n').slice(0, 4000));
  return { ok: true, match: true, count: lines.length };
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const user = payload.user || {};

  if (command === 'afk') {
    try {
      const entry = setAfk(user, args);
      const reason = entry.reason ? ` — ${entry.reason}` : '';
      await postToHaven(`💤 **${displayName(entry)}** is now AFK${reason}`);
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  if (command === 'back') {
    const entry = clearAfk(user);
    if (!entry) {
      await postToHaven('You were not marked AFK.');
      return;
    }
    await postToHaven(`👋 **${displayName(entry, user.username)}** is back!`);
    return;
  }

  return { ignored: true };
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  const count = Object.values(state.afk).filter((e) => e && !e.aliasOf).length;
  res.type('text/plain').send(`afk bot running. afk=${count} cooldown=${COOLDOWN_SEC}s`);
});
app.get('/health', (_req, res) => {
  const count = Object.values(state.afk).filter((e) => e && !e.aliasOf).length;
  res.json({ ok: true, afk: count, cooldownSec: COOLDOWN_SEC });
});

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
      await postToHaven('✅ AFK bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  if (event === 'slash_command') {
    try {
      const result = await handleSlash(payload);
      if (result && result.ignored) return res.json({ ignored: true });
      return res.json({ ok: true });
    } catch (err) {
      console.error('slash handler error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (event === 'message' || event === 'message-created' || event === 'message_create') {
    try {
      const result = await handleMessage(payload);
      return res.json(result);
    } catch (err) {
      console.error('message handler error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.json({ ignored: `event=${event}` });
});

app.listen(PORT, async () => {
  const count = Object.values(state.afk).filter((e) => e && !e.aliasOf).length;
  console.log(`afk bot listening on :${PORT}`);
  console.log(`  afk users: ${count}, announce cooldown: ${COOLDOWN_SEC}s`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
