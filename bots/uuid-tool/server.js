// uuid-tool — Haven community bot
//
// /uuid [n] — generate n UUIDs v4 (crypto.randomUUID / randomBytes).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const MAX_COUNT = Math.max(1, Math.min(50, parseInt(process.env.MAX_COUNT || '10', 10) || 10));
const DEFAULT_COUNT = Math.max(1, Math.min(MAX_COUNT, parseInt(process.env.DEFAULT_COUNT || '1', 10) || 1));
const UPPERCASE = String(process.env.UPPERCASE || 'false').toLowerCase() === 'true';
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
  const url = `${new URL(HAVEN_WEBHOOK_URL).origin}/api/webhooks/${token}/commands`;
  const cmds = [
    { command: 'uuid', description: 'Generate UUID v4: /uuid [n]' },
    { command: 'guid', description: 'Alias for /uuid' },
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

function uuidV4() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 from randomBytes
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function generate(n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    let id = uuidV4();
    if (UPPERCASE) id = id.toUpperCase();
    list.push(id);
  }
  return list;
}

function parseCount(args) {
  const s = String(args || '').trim();
  if (!s) return DEFAULT_COUNT;
  const m = s.match(/^(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, MAX_COUNT);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'uuid' && command !== 'guid') return { ignored: true };

  const args = String(payload.args || '').trim();
  if (args.toLowerCase() === 'help') {
    await postToHaven(`Usage: \`/uuid [n]\` — generate up to **${MAX_COUNT}** UUID v4 values.`);
    return;
  }

  const n = parseCount(args);
  if (n == null) {
    await postToHaven(`Usage: \`/uuid [n]\` with n between 1 and ${MAX_COUNT}.`);
    return;
  }

  const ids = generate(n);
  const body =
    n === 1
      ? `🆔 **UUID v4**\n\`${ids[0]}\``
      : `🆔 **${n}× UUID v4**\n${ids.map((id, i) => `${i + 1}. \`${id}\``).join('\n')}`;
  await postToHaven(body.slice(0, 4000));
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`uuid-tool bot running. max=${MAX_COUNT}`);
});
app.get('/health', (_req, res) => res.json({ ok: true, maxCount: MAX_COUNT }));

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
      await postToHaven('✅ UUID bot received a test event.');
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
  console.log(`uuid-tool bot listening on :${PORT} (max=${MAX_COUNT})`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
