// say — Haven community bot
//
// Slash /say <text> re-posts the text as the bot. Only ALLOWED_USER_IDS may
// use it; an empty list means nobody can.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_LENGTH = Math.max(1, parseInt(process.env.MAX_LENGTH || '2000', 10) || 2000);
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}
if (!ALLOWED_USER_IDS.length) {
  console.warn('WARNING: ALLOWED_USER_IDS is empty, so nobody can use /say. Add the Haven user ids of your staff.');
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

// Fails closed: an empty allowlist means nobody may use /say.
function isAllowed(user) {
  if (!ALLOWED_USER_IDS.length) return false;
  if (!user || user.id == null) return false;
  return ALLOWED_USER_IDS.some((id) => String(id) === String(user.id));
}

// With a recipientId, Haven shows the reply only to that one person.
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
}

async function registerCommands() {
  const token = webhookToken();
  if (!token) return;
  const url = `${new URL(HAVEN_WEBHOOK_URL).origin}/api/webhooks/${token}/commands`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'say',
      description: 'Re-post text as the bot: /say <text>',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /say');
  }
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'say') return { ignored: true };

  // Haven sends the caller as payload.author ({ id, username }).
  const user = payload.author || {};
  const who = `${user.username || 'unknown'} (id ${user.id ?? 'n/a'})`;
  if (!isAllowed(user)) {
    console.warn(`[${new Date().toISOString()}] say refused for ${who}`);
    await postToHaven(
      ALLOWED_USER_IDS.length
        ? `❌ You are not allowed to use \`/say\`. (Your user id is ${user.id ?? 'unknown'}.)`
        : `❌ \`/say\` is turned off until the bot owner sets ALLOWED_USER_IDS. (Your user id is ${user.id ?? 'unknown'}.)`,
      user.id
    );
    return;
  }

  const text = String(payload.args || '').trim().slice(0, MAX_LENGTH);
  if (!text) {
    await postToHaven('Usage: `/say <text>`', user.id);
    return;
  }

  await postToHaven(text.slice(0, 4000));
  // Audit line: who really sent each /say message.
  console.log(`[${new Date().toISOString()}] say by ${who} len=${text.length}`);
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(`say bot running. allowlist=${ALLOWED_USER_IDS.length || 'empty (say disabled)'}`);
});
app.get('/health', (_req, res) =>
  res.json({ ok: true, allowedUsers: ALLOWED_USER_IDS.length })
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
      await postToHaven('✅ Say bot received a test event.');
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
  console.log(`say bot listening on :${PORT}`);
  console.log(`  allowlist: ${ALLOWED_USER_IDS.length || 'empty (say disabled)'}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
