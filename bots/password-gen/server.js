// password-gen — Haven community bot
//
// /password [length] — secure random password (crypto.randomBytes).
// Optional charset flags: /password 20 symbols|nosymbols|alphanum|pin
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const DEFAULT_LENGTH = Math.max(
  4,
  Math.min(128, parseInt(process.env.DEFAULT_LENGTH || '16', 10) || 16)
);
const MIN_LENGTH = Math.max(4, parseInt(process.env.MIN_LENGTH || '8', 10) || 8);
const MAX_LENGTH = Math.max(MIN_LENGTH, Math.min(256, parseInt(process.env.MAX_LENGTH || '64', 10) || 64));
const DEFAULT_MODE = String(process.env.DEFAULT_MODE || 'symbols').toLowerCase();
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
};

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
    {
      command: 'password',
      description: 'Generate a secure password: /password [length] [mode]',
    },
    { command: 'pw', description: 'Alias for /password' },
    { command: 'passwd', description: 'Alias for /password' },
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

function charsetForMode(mode) {
  const m = String(mode || DEFAULT_MODE).toLowerCase();
  if (m === 'pin' || m === 'digits' || m === 'numeric') return SETS.digits;
  if (m === 'alpha' || m === 'letters') return SETS.lower + SETS.upper;
  if (m === 'alphanum' || m === 'alphanumeric' || m === 'nosymbols' || m === 'no-symbols') {
    return SETS.lower + SETS.upper + SETS.digits;
  }
  if (m === 'hex') return '0123456789abcdef';
  // symbols / full / default
  return SETS.lower + SETS.upper + SETS.digits + SETS.symbols;
}

function secureIndex(maxExclusive) {
  // rejection sampling to avoid modulo bias
  if (maxExclusive <= 0) return 0;
  const maxUint = 0xffffffff;
  const limit = maxUint - (maxUint % maxExclusive);
  let x;
  do {
    x = crypto.randomBytes(4).readUInt32BE(0);
  } while (x >= limit);
  return x % maxExclusive;
}

function generatePassword(length, mode) {
  const charset = charsetForMode(mode);
  if (charset.length < 2) throw new Error('Charset too small.');
  let out = '';
  for (let i = 0; i < length; i++) {
    out += charset[secureIndex(charset.length)];
  }
  // For non-pin modes, ensure at least one of each major class when length allows
  if (mode !== 'pin' && mode !== 'digits' && mode !== 'numeric' && mode !== 'hex' && length >= 4) {
    const need = [];
    if (mode !== 'alpha' && mode !== 'letters') need.push(SETS.digits);
    need.push(SETS.lower, SETS.upper);
    if (mode === 'symbols' || mode === 'full' || !mode || mode === DEFAULT_MODE) {
      if (charset.includes('!')) need.push(SETS.symbols);
    }
    const chars = out.split('');
    for (let i = 0; i < need.length && i < length; i++) {
      const set = need[i];
      chars[i] = set[secureIndex(set.length)];
    }
    // shuffle
    for (let i = chars.length - 1; i > 0; i--) {
      const j = secureIndex(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    out = chars.join('');
  }
  return out;
}

function parseArgs(args) {
  const tokens = String(args || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  let length = DEFAULT_LENGTH;
  let mode = DEFAULT_MODE;
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      length = parseInt(t, 10);
      continue;
    }
    if (
      [
        'symbols',
        'full',
        'nosymbols',
        'no-symbols',
        'alphanum',
        'alphanumeric',
        'alpha',
        'letters',
        'pin',
        'digits',
        'numeric',
        'hex',
      ].includes(t)
    ) {
      mode = t === 'full' ? 'symbols' : t;
    }
  }
  return { length, mode };
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'password' && command !== 'pw' && command !== 'passwd') {
    return { ignored: true };
  }

  const args = String(payload.args || '').trim();
  if (args.toLowerCase() === 'help') {
    await postToHaven(
      `Usage: \`/password [length] [mode]\`\nModes: \`symbols\` (default), \`nosymbols\`, \`alphanum\`, \`alpha\`, \`pin\`, \`hex\`\nLength: ${MIN_LENGTH}–${MAX_LENGTH} (default ${DEFAULT_LENGTH}).\n⚠️ Posted publicly — change after copy if this channel is shared.`
    );
    return;
  }

  const { length, mode } = parseArgs(args);
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    await postToHaven(`❌ Length must be ${MIN_LENGTH}–${MAX_LENGTH}.`);
    return;
  }

  try {
    const pw = generatePassword(length, mode);
    await postToHaven(
      [
        '🔑 **Password generated**',
        `Length: **${length}** · mode: \`${mode}\``,
        `\`\`\`\n${pw}\n\`\`\``,
        '_Rotate if this channel is not private._',
      ].join('\n').slice(0, 4000)
    );
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
      `password-gen bot running. defaultLen=${DEFAULT_LENGTH} range=${MIN_LENGTH}-${MAX_LENGTH}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    defaultLength: DEFAULT_LENGTH,
    minLength: MIN_LENGTH,
    maxLength: MAX_LENGTH,
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
      await postToHaven('✅ Password-gen bot received a test event.');
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
  console.log(`password-gen bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
