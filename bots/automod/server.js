// automod — Haven community bot
//
// Listens for Haven message events, matches a word blocklist, then optionally
// warns, deletes the message, and/or mutes the author (can_moderate).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const BAD_WORDS_ENV = process.env.BAD_WORDS || '';
const BLOCKLIST_FILE = (process.env.BLOCKLIST_FILE || '').trim();
const WARN_ONLY = String(process.env.WARN_ONLY || 'false').toLowerCase() === 'true';
const AUTOMOD_DELETE = String(process.env.AUTOMOD_DELETE || 'true').toLowerCase() === 'true';
const AUTOMOD_MUTE = String(process.env.AUTOMOD_MUTE || 'false').toLowerCase() === 'true';
const MUTE_DURATION_MIN = Math.max(1, parseInt(process.env.MUTE_DURATION_MIN || '10', 10) || 10);
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const MODLOG_WEBHOOK_URL = (process.env.MODLOG_WEBHOOK_URL || '').trim();
const IGNORE_USER_IDS = new Set(
  (process.env.IGNORE_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

function loadBlocklist() {
  const words = [];
  for (const part of BAD_WORDS_ENV.split(',')) {
    const w = part.trim().toLowerCase();
    if (w) words.push(w);
  }
  if (BLOCKLIST_FILE) {
    try {
      const raw = fs.readFileSync(BLOCKLIST_FILE, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        words.push(t.toLowerCase());
      }
    } catch (err) {
      console.warn(`[blocklist] failed to read ${BLOCKLIST_FILE}: ${err.message}`);
    }
  }
  return [...new Set(words)].filter(Boolean);
}

const blocklist = loadBlocklist();
if (!blocklist.length) {
  console.warn('[automod] warning: empty blocklist — set BAD_WORDS or BLOCKLIST_FILE');
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

function webhookToken() {
  if (HAVEN_WEBHOOK_TOKEN) return HAVEN_WEBHOOK_TOKEN;
  const m = HAVEN_WEBHOOK_URL.match(/\/api\/webhooks\/([a-f0-9]{64})/i);
  return m ? m[1] : '';
}

function originBase() {
  return new URL(HAVEN_WEBHOOK_URL).origin;
}

function findMatch(content) {
  const lower = String(content || '').toLowerCase();
  if (!lower) return null;
  for (const word of blocklist) {
    if (word && lower.includes(word)) return word;
  }
  return null;
}

async function postWebhook(url, content) {
  const body = { content };
  if (HAVEN_USERNAME) body.username = HAVEN_USERNAME;
  if (HAVEN_AVATAR_URL) body.avatar_url = HAVEN_AVATAR_URL;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Haven responded ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function postModLog(content) {
  const url = MODLOG_WEBHOOK_URL || HAVEN_WEBHOOK_URL;
  await postWebhook(url, content.slice(0, 4000));
}

async function deleteMessage(messageId) {
  const token = webhookToken();
  if (!token || messageId == null) return false;
  const url = `${originBase()}/api/webhooks/${token}/messages/${messageId}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[delete] ${res.status} ${text.slice(0, 200)}`);
    return false;
  }
  return true;
}

async function muteUser(userId, reason) {
  const token = webhookToken();
  if (!token || userId == null) return false;
  const url = `${originBase()}/api/webhooks/${token}/moderation/mute`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: Number(userId),
      duration: MUTE_DURATION_MIN,
      reason: String(reason || 'automod').slice(0, 200),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[mute] ${res.status} ${text.slice(0, 200)}`);
    return false;
  }
  return true;
}

function extractMessage(payload) {
  const msg = payload.message || payload.data || payload;
  const content = msg.content || payload.content || '';
  const id = msg.id ?? msg.message_id ?? payload.message_id ?? payload.messageId ?? null;
  const user = msg.user || msg.author || payload.user || payload.author || {};
  const username = user.username || user.displayName || msg.username || 'unknown';
  const userId = user.id ?? msg.user_id ?? msg.userId ?? payload.user_id ?? null;
  const isBot = !!(user.is_bot || user.isBot || msg.is_bot || msg.webhook_id || msg.webhookId);
  return { content, id, username, userId, isBot };
}

async function handleMessage(payload) {
  const { content, id, username, userId, isBot } = extractMessage(payload);
  if (isBot) return { skipped: 'bot' };
  if (userId != null && IGNORE_USER_IDS.has(String(userId))) return { skipped: 'ignored-user' };

  const matched = findMatch(content);
  if (!matched) return { ok: true, match: false };

  const actions = [];

  if (WARN_ONLY) {
    await postModLog(
      `⚠️ **AutoMod** warning for **${username}**\nPlease avoid blocked language (\`${matched}\`).`
    );
    actions.push('warned');
    console.log(`[${new Date().toISOString()}] warn-only match=${matched} user=${username}`);
    return { ok: true, match: matched, actions };
  }

  if (AUTOMOD_DELETE && id != null) {
    const deleted = await deleteMessage(id);
    if (deleted) actions.push('deleted');
    else actions.push('delete-failed');
  }

  if (AUTOMOD_MUTE && userId != null) {
    const muted = await muteUser(userId, `automod: ${matched}`);
    if (muted) actions.push('muted');
    else actions.push('mute-failed');
  }

  actions.push('logged');
  const actionStr = actions.length ? actions.join(', ') : 'none';
  await postModLog(
    `🛡️ **AutoMod** blocked message from **${username}**${id != null ? ` (\`#${id}\`)` : ''}\nMatched: \`${matched}\`\nActions: ${actionStr}`
  );
  console.log(`[${new Date().toISOString()}] match=${matched} user=${username} actions=${actionStr}`);
  return { ok: true, match: matched, actions };
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `automod bot running. words=${blocklist.length} delete=${AUTOMOD_DELETE} mute=${AUTOMOD_MUTE} warnOnly=${WARN_ONLY}`
  );
});
app.get('/health', (_req, res) => res.json({
  ok: true,
  words: blocklist.length,
  delete: AUTOMOD_DELETE,
  mute: AUTOMOD_MUTE,
  warnOnly: WARN_ONLY,
}));

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
      await postModLog('✅ AutoMod bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  if (event !== 'message' && event !== 'message-created' && event !== 'message_create') {
    return res.json({ ignored: `event=${event}` });
  }

  try {
    const result = await handleMessage(payload);
    res.json(result);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] handler error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`automod bot listening on :${PORT}`);
  console.log(`  blocklist: ${blocklist.length} terms`);
  console.log(`  warnOnly=${WARN_ONLY} delete=${AUTOMOD_DELETE} mute=${AUTOMOD_MUTE} muteMin=${MUTE_DURATION_MIN}`);
});
