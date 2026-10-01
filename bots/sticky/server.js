// sticky — Haven community bot
//
// /sticky set <text> stores a sticky message; on message events, re-posts it
// every STICKY_EVERY_N messages (rate-limited). Each re-post deletes the
// previous copy so only one sticky is in the channel at a time.
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
const STATE_FILE = process.env.STATE_FILE || './data/sticky-state.json';
const STICKY_EVERY_N = Math.max(1, parseInt(process.env.STICKY_EVERY_N || '15', 10) || 15);
const MIN_SECONDS_RAW = parseInt(process.env.MIN_SECONDS_BETWEEN ?? '30', 10);
const MIN_SECONDS_BETWEEN = Number.isInteger(MIN_SECONDS_RAW) && MIN_SECONDS_RAW >= 0 ? MIN_SECONDS_RAW : 30;
const MAX_LENGTH = Math.max(1, parseInt(process.env.MAX_LENGTH || '1500', 10) || 1500);
const PREFIX = process.env.PREFIX || '📌 **Sticky**';
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}
if (!ALLOWED_USER_IDS.length) {
  console.warn('WARNING: ALLOWED_USER_IDS is empty, so nobody can set, clear or toggle the sticky. Add the Haven user ids of your staff.');
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      text: typeof j.text === 'string' ? j.text : '',
      enabled: j.enabled !== false,
      messageCount: Number.isInteger(j.messageCount) ? j.messageCount : 0,
      lastPostedAt: typeof j.lastPostedAt === 'number' ? j.lastPostedAt : 0,
      setBy: j.setBy || '',
      setAt: j.setAt || null,
      // Haven message id of the sticky copy currently in the channel.
      lastMessageId: j.lastMessageId ?? null,
    };
  } catch {
    return {
      text: '',
      enabled: true,
      messageCount: 0,
      lastPostedAt: 0,
      setBy: '',
      setAt: null,
      lastMessageId: null,
    };
  }
}

function saveState() {
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

// Fails closed: an empty allowlist means nobody may manage the sticky.
function isAllowed(user) {
  if (!ALLOWED_USER_IDS.length) return false;
  if (!user || user.id == null) return false;
  return ALLOWED_USER_IDS.some((id) => String(id) === String(user.id));
}

// With a recipientId, Haven shows the reply only to that one person.
// Returns Haven's JSON reply, which includes message_id for normal posts.
async function postToHaven(content, recipientId) {
  const body = { content };
  if (HAVEN_USERNAME) body.username = HAVEN_USERNAME;
  if (HAVEN_AVATAR_URL) body.avatar_url = HAVEN_AVATAR_URL;
  if (recipientId != null) {
    body.ephemeral = true;
    body.recipient_id = recipientId;
  }
  const res = await fetch(HAVEN_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Haven responded ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

// Deletes one of this bot's earlier messages. Best effort: a copy that is
// already gone (404) or a network error is only logged.
async function deleteMessage(messageId) {
  const token = webhookToken();
  if (!token || messageId == null) return false;
  const url = `${new URL(HAVEN_WEBHOOK_URL).origin}/api/webhooks/${token}/messages/${encodeURIComponent(messageId)}`;
  try {
    const res = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(10000) });
    if (!res.ok && res.status !== 404) {
      console.warn(`[sticky] delete of old copy ${messageId} failed: ${res.status}`);
    }
    return res.ok;
  } catch (err) {
    console.warn(`[sticky] delete of old copy ${messageId} failed: ${err.message}`);
    return false;
  }
}

async function registerCommands() {
  const token = webhookToken();
  if (!token) return;
  const url = `${new URL(HAVEN_WEBHOOK_URL).origin}/api/webhooks/${token}/commands`;
  const cmds = [
    {
      command: 'sticky',
      description: 'Manage channel sticky message',
      subcommands: [
        { name: 'set', description: 'Set sticky text' },
        { name: 'show', description: 'Show current sticky' },
        { name: 'clear', description: 'Clear sticky' },
        { name: 'on', description: 'Enable re-posts' },
        { name: 'off', description: 'Disable re-posts' },
        { name: 'status', description: 'Show sticky status' },
      ],
    },
  ];
  for (const body of cmds) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[commands] register failed: ${res.status}`);
    } else {
      console.log(`[commands] registered /${body.command}`);
    }
  }
}

function formatSticky() {
  if (!state.text) return null;
  return `${PREFIX}\n${state.text}`.slice(0, 4000);
}

function statusText() {
  const lines = [
    '📌 **Sticky status**',
    `Enabled: **${state.enabled ? 'yes' : 'no'}**`,
    `Every: **${STICKY_EVERY_N}** messages (min ${MIN_SECONDS_BETWEEN}s apart)`,
    `Counter: **${state.messageCount}**`,
  ];
  if (state.setBy) lines.push(`Set by: ${state.setBy}`);
  if (state.setAt) lines.push(`Set at: ${new Date(state.setAt).toISOString()}`);
  if (state.lastPostedAt) {
    lines.push(`Last re-post: ${new Date(state.lastPostedAt).toISOString()}`);
  }
  if (state.text) {
    const preview =
      state.text.length > 120 ? `${state.text.slice(0, 117)}…` : state.text;
    lines.push('', `Preview:\n${preview}`);
  } else {
    lines.push('', '_No sticky text. `/sticky set <text>`_');
  }
  return lines.join('\n').slice(0, 4000);
}

// Posts a fresh sticky copy, then deletes the previous one.
async function postStickyCopy() {
  const content = formatSticky();
  if (!content) return false;
  const data = await postToHaven(content);
  const previous = state.lastMessageId;
  state.lastMessageId = data && data.message_id != null ? data.message_id : null;
  state.messageCount = 0;
  state.lastPostedAt = Date.now();
  saveState();
  if (previous != null && String(previous) !== String(state.lastMessageId)) await deleteMessage(previous);
  return true;
}

async function removeStickyCopy() {
  const previous = state.lastMessageId;
  state.lastMessageId = null;
  saveState();
  if (previous != null) await deleteMessage(previous);
}

// Set while a re-post is in flight so a burst of messages cannot post twice.
let reposting = false;

async function maybeRepost() {
  if (reposting) return false;
  if (!state.enabled || !state.text) return false;
  if (state.messageCount < STICKY_EVERY_N) return false;
  const now = Date.now();
  if (MIN_SECONDS_BETWEEN > 0 && now - state.lastPostedAt < MIN_SECONDS_BETWEEN * 1000) {
    return false;
  }

  reposting = true;
  try {
    return await postStickyCopy();
  } finally {
    reposting = false;
  }
}

// Haven only sends message events for messages people post, never for bot or
// webhook messages, so every event here counts toward the re-post.
async function handleMessage(payload) {
  if (!state.enabled || !state.text) return { ignored: true, reason: 'inactive' };

  state.messageCount += 1;
  saveState();

  try {
    const posted = await maybeRepost();
    return { ok: true, count: state.messageCount, posted };
  } catch (err) {
    console.error('sticky repost failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'sticky') return { ignored: true };

  const args = String(payload.args || '').trim();
  // Haven sends the caller as payload.author ({ id, username }).
  const user = payload.author || {};
  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (!sub || sub === 'help') {
    await postToHaven(
      'Usage: `/sticky set <text>` · `/sticky show` · `/sticky clear` · `/sticky on|off` · `/sticky status`',
      user.id
    );
    return;
  }

  // show and status reply privately so they cannot be used to spam the channel.
  if (sub === 'show' || sub === 'get') {
    const content = formatSticky();
    await postToHaven(content || 'No sticky set. Use `/sticky set <text>`.', user.id);
    return;
  }

  if (sub === 'status' || sub === 'info') {
    await postToHaven(statusText(), user.id);
    return;
  }

  // Everything below changes the sticky, so it needs the allowlist.
  if (!isAllowed(user)) {
    console.warn(`[sticky] ${sub} refused for ${user.username || 'unknown'} (id ${user.id ?? 'n/a'})`);
    await postToHaven(
      ALLOWED_USER_IDS.length
        ? `❌ You are not allowed to manage sticky. (Your user id is ${user.id ?? 'unknown'}.)`
        : `❌ Sticky management is turned off until the bot owner sets ALLOWED_USER_IDS. (Your user id is ${user.id ?? 'unknown'}.)`,
      user.id
    );
    return;
  }

  if (sub === 'on' || sub === 'enable') {
    state.enabled = true;
    saveState();
    await postToHaven('✅ Sticky re-posts **enabled**.');
    return;
  }

  if (sub === 'off' || sub === 'disable') {
    state.enabled = false;
    saveState();
    await postToHaven('✅ Sticky re-posts **disabled** (text kept).');
    return;
  }

  if (sub === 'clear' || sub === 'remove' || sub === 'delete') {
    state.text = '';
    state.messageCount = 0;
    state.setBy = '';
    state.setAt = null;
    saveState();
    await removeStickyCopy();
    await postToHaven('🗑️ Sticky cleared.', user.id);
    return;
  }

  // /sticky set <text>, or the /sticky <text> shortcut
  const text = (sub === 'set' || sub === 'update' ? parts.slice(1).join(' ').trim() : args).slice(0, MAX_LENGTH);
  if (!text) {
    await postToHaven('Usage: `/sticky set <text>`', user.id);
    return;
  }
  state.text = text;
  state.enabled = true;
  state.setBy = (user.username || user.displayName || '') || '';
  state.setAt = Date.now();
  saveState();
  // Post the new sticky right away (this also removes the old copy).
  reposting = true;
  try {
    await postStickyCopy();
  } catch (err) {
    console.error('sticky post failed:', err.message);
    await postToHaven('⚠️ Sticky saved, but posting it failed. It will be posted on the next re-post.', user.id);
    return;
  } finally {
    reposting = false;
  }
  await postToHaven(`✅ Sticky set (re-post every **${STICKY_EVERY_N}** messages).`, user.id);
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `sticky bot running. enabled=${state.enabled} everyN=${STICKY_EVERY_N} hasText=${!!state.text}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    enabled: state.enabled,
    hasText: !!state.text,
    everyN: STICKY_EVERY_N,
    messageCount: state.messageCount,
  })
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
      await postToHaven('✅ Sticky bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  const event = String(payload.event || '').toLowerCase();

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

  if (event === 'message' || event === 'message_create' || event === 'message-created') {
    try {
      const result = await handleMessage(payload);
      return res.json(result || { ok: true });
    } catch (err) {
      console.error('message handler error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.json({ ignored: true });
});

app.listen(PORT, async () => {
  console.log(
    `sticky bot listening on :${PORT} (every ${STICKY_EVERY_N} msgs, min ${MIN_SECONDS_BETWEEN}s)`
  );
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
