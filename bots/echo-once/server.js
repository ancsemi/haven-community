// echo-once — Haven community bot
//
// /echo <text> re-posts text. If a recipient_id is available on the slash
// payload (or FORCE_EPHEMERAL), posts with ephemeral:true + recipient_id for
// a private-style reply; otherwise public channel post.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const MAX_LENGTH = Math.max(1, parseInt(process.env.MAX_LENGTH || '2000', 10) || 2000);
const FORCE_EPHEMERAL = String(process.env.FORCE_EPHEMERAL || 'false').toLowerCase() === 'true';
const PREFER_EPHEMERAL = String(process.env.PREFER_EPHEMERAL || 'true').toLowerCase() !== 'false';
const PREFIX = process.env.PREFIX || '';
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

/**
 * Post to Haven webhook.
 * When recipientId is set, request an ephemeral/private-style delivery if the
 * server supports ephemeral + recipient_id on webhook POSTs.
 */
async function postToHaven(content, opts = {}) {
  const body = { content };
  if (HAVEN_USERNAME) body.username = HAVEN_USERNAME;
  if (HAVEN_AVATAR_URL) body.avatar_url = HAVEN_AVATAR_URL;

  const recipientId = opts.recipientId;
  const wantEphemeral = !!opts.ephemeral && recipientId != null && recipientId !== '';

  if (wantEphemeral) {
    body.ephemeral = true;
    body.recipient_id = recipientId;
  }

  const res = await fetch(HAVEN_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // If ephemeral unsupported, fall back to public once
    if (wantEphemeral && (res.status === 400 || res.status === 422)) {
      console.warn(
        `[${new Date().toISOString()}] ephemeral post failed (${res.status}); falling back to public`
      );
      return postToHaven(content, { ephemeral: false });
    }
    throw new Error(`Haven responded ${res.status}: ${text.slice(0, 300)}`);
  }
  return { ephemeral: wantEphemeral };
}

async function registerCommands() {
  const token = webhookToken();
  if (!token) return;
  const url = `${new URL(HAVEN_WEBHOOK_URL).origin}/api/webhooks/${token}/commands`;
  const cmds = [
    { command: 'echo', description: 'Echo text (ephemeral if recipient known)' },
    { command: 'say-echo', description: 'Alias for /echo' },
  ];
  for (const body of cmds) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[commands] register /${body.command} failed: ${res.status}`);
    } else {
      console.log(`[commands] registered /${body.command}`);
    }
  }
}

function extractRecipientId(payload) {
  const user = payload.user || {};
  const candidates = [
    payload.recipient_id,
    payload.recipientId,
    user.id,
    payload.user_id,
    payload.userId,
    payload.member && payload.member.user && payload.member.user.id,
  ];
  for (const c of candidates) {
    if (c != null && c !== '') return c;
  }
  return null;
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'echo' && command !== 'say-echo') return { ignored: true };

  const text = String(payload.args || '').trim().slice(0, MAX_LENGTH);
  if (!text) {
    await postToHaven(
      'Usage: `/echo <text>` — private/ephemeral when `recipient_id` is available, else public.'
    );
    return;
  }

  const recipientId = extractRecipientId(payload);
  const useEphemeral =
    FORCE_EPHEMERAL || (PREFER_EPHEMERAL && recipientId != null);

  const content = (PREFIX ? `${PREFIX}${text}` : text).slice(0, 4000);
  const result = await postToHaven(content, {
    ephemeral: useEphemeral,
    recipientId,
  });
  console.log(
    `[${new Date().toISOString()}] echo len=${text.length} ephemeral=${!!result.ephemeral} recipient=${recipientId || 'none'}`
  );
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `echo-once bot running. preferEphemeral=${PREFER_EPHEMERAL} force=${FORCE_EPHEMERAL}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    preferEphemeral: PREFER_EPHEMERAL,
    forceEphemeral: FORCE_EPHEMERAL,
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
      await postToHaven('✅ Echo-once bot received a test event.');
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
  console.log(
    `echo-once bot listening on :${PORT} (preferEphemeral=${PREFER_EPHEMERAL}, force=${FORCE_EPHEMERAL})`
  );
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
