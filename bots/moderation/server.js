// moderation — Haven community bot
//
// Slash /kick /ban /unban /mute /unmute wrapping Haven bot moderation REST.
// Requires can_moderate on the webhook bot. Optional ALLOWED_USER_IDS gate.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const DEFAULT_MUTE_MIN = Math.max(1, parseInt(process.env.DEFAULT_MUTE_MIN || '10', 10) || 10);
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

function isAllowed(user) {
  if (!ALLOWED_USER_IDS.length) return true;
  if (!user || user.id == null) return false;
  return ALLOWED_USER_IDS.some((id) => String(id) === String(user.id));
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

async function modAction(action, payload) {
  const token = webhookToken();
  if (!token) throw new Error('Missing webhook token (set HAVEN_WEBHOOK_TOKEN or use a full HAVEN_WEBHOOK_URL).');
  const url = `${originBase()}/api/webhooks/${token}/moderation/${action}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`${action} failed (${res.status}): ${text.slice(0, 300) || res.statusText}`);
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }
  return data;
}

async function registerCommands() {
  const token = webhookToken();
  if (!token) return;
  const base = `${originBase()}/api/webhooks/${token}/commands`;
  const cmds = [
    { command: 'kick', description: 'Kick a user: /kick <userId> [reason]' },
    { command: 'ban', description: 'Ban a user: /ban <userId> [reason]' },
    { command: 'unban', description: 'Unban a user: /unban <userId> [reason]' },
    { command: 'mute', description: 'Mute a user: /mute <userId> [minutes] [reason]' },
    { command: 'unmute', description: 'Unmute a user: /unmute <userId> [reason]' },
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

function parseUserId(token) {
  if (token == null || token === '') return null;
  const cleaned = String(token).replace(/^<@!?/, '').replace(/>$/, '').trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseModArgs(args, { withDuration } = {}) {
  const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { error: 'missing userId' };
  const userId = parseUserId(parts[0]);
  if (userId == null) return { error: 'userId must be a numeric id' };

  let duration = DEFAULT_MUTE_MIN;
  let reasonParts = parts.slice(1);

  if (withDuration && reasonParts.length) {
    const maybeMin = parseInt(reasonParts[0], 10);
    if (Number.isInteger(maybeMin) && maybeMin > 0 && String(maybeMin) === reasonParts[0]) {
      duration = maybeMin;
      reasonParts = reasonParts.slice(1);
    }
  }

  const reason = reasonParts.join(' ').trim().slice(0, 200) || 'moderation';
  return { userId, duration, reason };
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const user = payload.user || {};
  const actor = user.username || user.displayName || 'mod';

  const known = new Set(['kick', 'ban', 'unban', 'mute', 'unmute']);
  if (!known.has(command)) return { ignored: true };

  if (!isAllowed(user)) {
    await postToHaven('❌ You are not allowed to use moderation commands.');
    return;
  }

  if (!args) {
    const usage =
      command === 'mute'
        ? '`/mute <userId> [minutes] [reason]`'
        : `\`/${command} <userId> [reason]\``;
    await postToHaven(`Usage: ${usage}`);
    return;
  }

  const parsed = parseModArgs(args, { withDuration: command === 'mute' });
  if (parsed.error) {
    await postToHaven(`❌ ${parsed.error}`);
    return;
  }

  const { userId, duration, reason } = parsed;
  const fullReason = `${reason} (by ${actor})`.slice(0, 200);

  try {
    if (command === 'kick') {
      await modAction('kick', { userId, reason: fullReason });
      await postToHaven(`👢 **Kicked** user \`${userId}\`\nReason: ${reason}\n_by ${actor}_`);
      return;
    }
    if (command === 'ban') {
      await modAction('ban', { userId, reason: fullReason });
      await postToHaven(`🔨 **Banned** user \`${userId}\`\nReason: ${reason}\n_by ${actor}_`);
      return;
    }
    if (command === 'unban') {
      await modAction('unban', { userId, reason: fullReason });
      await postToHaven(`🕊️ **Unbanned** user \`${userId}\`\nReason: ${reason}\n_by ${actor}_`);
      return;
    }
    if (command === 'mute') {
      await modAction('mute', { userId, duration, reason: fullReason });
      await postToHaven(
        `🔇 **Muted** user \`${userId}\` for **${duration}** min\nReason: ${reason}\n_by ${actor}_`
      );
      return;
    }
    if (command === 'unmute') {
      await modAction('unmute', { userId, reason: fullReason });
      await postToHaven(`🔊 **Unmuted** user \`${userId}\`\nReason: ${reason}\n_by ${actor}_`);
      return;
    }
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `moderation bot running. defaultMuteMin=${DEFAULT_MUTE_MIN} allowlist=${ALLOWED_USER_IDS.length || 'any'}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    defaultMuteMin: DEFAULT_MUTE_MIN,
    allowedUsers: ALLOWED_USER_IDS.length,
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
      await postToHaven('✅ Moderation bot received a test event.');
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
  console.log(`moderation bot listening on :${PORT}`);
  console.log(
    `  defaultMuteMin=${DEFAULT_MUTE_MIN} allowlist=${ALLOWED_USER_IDS.length || 'any (open)'}`
  );
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
