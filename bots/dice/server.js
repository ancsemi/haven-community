// dice — Haven community bot
//
// Slash /roll NdM+K classic dice notation (e.g. 2d6+3, d20, 4d6).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const MAX_DICE = Math.max(1, parseInt(process.env.MAX_DICE || '100', 10) || 100);
const MAX_SIDES = Math.max(2, parseInt(process.env.MAX_SIDES || '1000', 10) || 1000);
const DEFAULT_ROLL = (process.env.DEFAULT_ROLL || '1d20').trim() || '1d20';
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
    { command: 'roll', description: 'Roll dice: /roll NdM+K (e.g. 2d6+3)' },
    { command: 'dice', description: 'Alias for /roll' },
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

function secureInt(min, max) {
  // inclusive min/max
  const range = max - min + 1;
  if (range <= 0) return min;
  const buf = crypto.randomBytes(4);
  const n = buf.readUInt32BE(0);
  return min + (n % range);
}

function parseNotation(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!s) return parseNotation(DEFAULT_ROLL);

  // NdM(+|-K) or dM(+|-K)
  const m = s.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) {
    throw new Error('Invalid notation. Use `NdM+K` e.g. `2d6+3`, `d20`, `4d8-1`.');
  }
  const count = m[1] === '' ? 1 : parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const mod = m[3] ? parseInt(m[3], 10) : 0;

  if (!Number.isInteger(count) || count < 1) throw new Error('Dice count must be ≥ 1.');
  if (count > MAX_DICE) throw new Error(`Too many dice (max ${MAX_DICE}).`);
  if (!Number.isInteger(sides) || sides < 2) throw new Error('Sides must be ≥ 2.');
  if (sides > MAX_SIDES) throw new Error(`Too many sides (max ${MAX_SIDES}).`);
  if (!Number.isInteger(mod) || Math.abs(mod) > 100000) throw new Error('Modifier out of range.');

  return { count, sides, mod, notation: s || DEFAULT_ROLL };
}

function rollDice(spec) {
  const rolls = [];
  for (let i = 0; i < spec.count; i++) {
    rolls.push(secureInt(1, spec.sides));
  }
  const sum = rolls.reduce((a, b) => a + b, 0) + spec.mod;
  return { rolls, sum, spec };
}

function formatRoll(result, who) {
  const { rolls, sum, spec } = result;
  const modStr =
    spec.mod === 0 ? '' : spec.mod > 0 ? `+${spec.mod}` : String(spec.mod);
  const label = `${spec.count}d${spec.sides}${modStr}`;
  const detail =
    rolls.length <= 20
      ? rolls.join(', ')
      : `${rolls.slice(0, 20).join(', ')}… (+${rolls.length - 20} more)`;
  const lines = [
    `🎲 **${who || 'Roll'}** — \`${label}\``,
    `Rolls: [${detail}]`,
    `**Total: ${sum}**`,
  ];
  return lines.join('\n').slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'roll' && command !== 'dice') return { ignored: true };

  const args = String(payload.args || '').trim();
  const user = payload.user || {};
  const who = user.username || user.displayName || 'Roll';

  try {
    const spec = parseNotation(args || DEFAULT_ROLL);
    const result = rollDice(spec);
    await postToHaven(formatRoll(result, who));
  } catch (err) {
    await postToHaven(`❌ ${err.message}\nUsage: \`/roll 2d6+3\` · \`/roll d20\``);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`dice bot running. default=${DEFAULT_ROLL}`);
});
app.get('/health', (_req, res) =>
  res.json({ ok: true, defaultRoll: DEFAULT_ROLL, maxDice: MAX_DICE, maxSides: MAX_SIDES })
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
      await postToHaven('✅ Dice bot received a test event.');
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
  console.log(`dice bot listening on :${PORT}`);
  console.log(`  default=${DEFAULT_ROLL} maxDice=${MAX_DICE} maxSides=${MAX_SIDES}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
