// base64: Haven community bot
//
// /encode <text> and /decode <base64>: Base64 encode or decode UTF-8 text.
// Haven only routes command names made of letters, so /b64 would never arrive.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const MAX_INPUT = Math.max(16, parseInt(process.env.MAX_INPUT || '1500', 10) || 1500);
const MAX_OUTPUT = Math.max(16, parseInt(process.env.MAX_OUTPUT || '3000', 10) || 3000);
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
  const cmds = [
    { command: 'encode', description: 'Base64 encode: /encode <text>' },
    { command: 'decode', description: 'Base64 decode: /decode <base64>' },
  ];
  for (const body of cmds) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[commands] register /${body.command} failed: ${res.status}`);
    } else {
      console.log(`[commands] registered /${body.command}`);
    }
  }
}

function truncateOut(s) {
  const t = String(s || '');
  if (t.length <= MAX_OUTPUT) return t;
  return t.slice(0, MAX_OUTPUT) + '…';
}

function encodeText(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

function decodeText(b64) {
  const cleaned = String(b64 || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  if (!cleaned) throw new Error('Empty input.');
  if (!/^[A-Za-z0-9+/]+=*$/.test(cleaned)) {
    throw new Error('Invalid Base64 characters.');
  }
  // pad
  const pad = cleaned.length % 4 === 0 ? cleaned : cleaned + '='.repeat(4 - (cleaned.length % 4));
  const buf = Buffer.from(pad, 'base64');
  // detect binary-ish
  const asUtf8 = buf.toString('utf8');
  const roundTrip = Buffer.from(asUtf8, 'utf8').equals(buf);
  if (!roundTrip) {
    return {
      text: buf.toString('hex'),
      note: 'Decoded bytes are not clean UTF-8; showing hex.',
    };
  }
  return { text: asUtf8 };
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'encode' && command !== 'decode') return { ignored: true };

  const args = String(payload.args || '').trim();
  if (!args || args.toLowerCase() === 'help') {
    await postToHaven(
      'Usage: `/encode <text>` · `/decode <base64>` (if the Base64 contains `/`, swap each one for `_`)'
    );
    return;
  }

  const op = command;
  const rest = args;

  if (rest.length > MAX_INPUT) {
    await postToHaven(`❌ Input too long (max ${MAX_INPUT} characters).`);
    return;
  }

  try {
    if (op === 'encode') {
      const out = truncateOut(encodeText(rest));
      await postToHaven(`🔐 **Base64 encode**\n\`\`\`\n${out}\n\`\`\``.slice(0, 4000));
      return;
    }
    const result = decodeText(rest);
    const body = result.note
      ? `🔓 **Base64 decode** (_${result.note}_)\n\`\`\`\n${truncateOut(result.text)}\n\`\`\``
      : `🔓 **Base64 decode**\n\`\`\`\n${truncateOut(result.text)}\n\`\`\``;
    await postToHaven(body.slice(0, 4000));
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`base64 bot running. maxInput=${MAX_INPUT}`);
});
app.get('/health', (_req, res) => res.json({ ok: true, maxInput: MAX_INPUT }));

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
      await postToHaven('✅ Base64 bot received a test event.');
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
  console.log(`base64 bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
