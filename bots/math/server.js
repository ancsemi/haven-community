// math — Haven community bot
//
// Slash /math <expr> with a safe recursive-descent evaluator
// (+ - * / ^ % parentheses). No Function/eval on raw input.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const MAX_EXPR_LEN = Math.max(16, parseInt(process.env.MAX_EXPR_LEN || '200', 10) || 200);
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
    { command: 'math', description: 'Evaluate expression: /math 2+2*3' },
    { command: 'calc', description: 'Alias for /math' },
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

// ── Safe recursive-descent parser ──────────────────────────────────────────
// Grammar:
//   expr   = term  ((+|-) term)*
//   term   = power ((*|/|%) power)*
//   power  = unary (^ unary)*   // right-assoc
//   unary  = (+|-) unary | primary
//   primary = number | '(' expr ')'

function tokenize(input) {
  const s = String(input || '').replace(/\s+/g, '');
  if (!s) throw new Error('Empty expression.');
  if (s.length > MAX_EXPR_LEN) throw new Error(`Expression too long (max ${MAX_EXPR_LEN}).`);
  if (!/^[0-9+\-*/^%().eE]+$/.test(s)) {
    throw new Error('Only numbers and + - * / ^ % ( ) are allowed.');
  }
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if ('+-*/^%()'.includes(c)) {
      tokens.push({ type: c });
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      let sawDot = false;
      while (j < s.length && /[0-9.]/.test(s[j])) {
        if (s[j] === '.') {
          if (sawDot) throw new Error('Invalid number.');
          sawDot = true;
        }
        j += 1;
      }
      // optional scientific exponent: 1e-3
      if (j < s.length && (s[j] === 'e' || s[j] === 'E')) {
        let k = j + 1;
        if (k < s.length && (s[k] === '+' || s[k] === '-')) k += 1;
        const startExp = k;
        while (k < s.length && /[0-9]/.test(s[k])) k += 1;
        if (k === startExp) throw new Error('Invalid scientific notation.');
        j = k;
      }
      const numStr = s.slice(i, j);
      const value = Number(numStr);
      if (!Number.isFinite(value)) throw new Error(`Invalid number: ${numStr}`);
      tokens.push({ type: 'num', value });
      i = j;
      continue;
    }
    throw new Error(`Unexpected character: ${c}`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

function parseExpr(tokens) {
  let pos = 0;

  function peek() {
    return tokens[pos];
  }
  function consume(type) {
    const t = tokens[pos];
    if (type && t.type !== type) throw new Error(`Expected ${type}, got ${t.type}`);
    pos += 1;
    return t;
  }

  function parsePrimary() {
    const t = peek();
    if (t.type === 'num') {
      consume('num');
      return t.value;
    }
    if (t.type === '(') {
      consume('(');
      const v = parseExpression();
      if (peek().type !== ')') throw new Error('Missing closing ).');
      consume(')');
      return v;
    }
    throw new Error('Expected number or (.');
  }

  function parseUnary() {
    if (peek().type === '+') {
      consume('+');
      return parseUnary();
    }
    if (peek().type === '-') {
      consume('-');
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePower() {
    let left = parseUnary();
    if (peek().type === '^') {
      consume('^');
      const right = parsePower(); // right-assoc
      if (Math.abs(right) > 1000) throw new Error('Exponent too large.');
      const v = Math.pow(left, right);
      if (!Number.isFinite(v)) throw new Error('Result not finite.');
      return v;
    }
    return left;
  }

  function parseTerm() {
    let left = parsePower();
    while (['*', '/', '%'].includes(peek().type)) {
      const op = consume().type;
      const right = parsePower();
      if (op === '*') left = left * right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero.');
        left = left / right;
      } else {
        if (right === 0) throw new Error('Modulo by zero.');
        left = left % right;
      }
      if (!Number.isFinite(left)) throw new Error('Result not finite.');
    }
    return left;
  }

  function parseExpression() {
    let left = parseTerm();
    while (peek().type === '+' || peek().type === '-') {
      const op = consume().type;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
      if (!Number.isFinite(left)) throw new Error('Result not finite.');
    }
    return left;
  }

  const value = parseExpression();
  if (peek().type !== 'eof') throw new Error(`Unexpected token: ${peek().type}`);
  return value;
}

function evaluate(expr) {
  const tokens = tokenize(expr);
  return parseExpr(tokens);
}

function formatResult(expr, value) {
  let shown = value;
  if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-12) {
    shown = Math.round(value);
  } else {
    shown = Number(value.toPrecision(12));
  }
  return `🧮 \`${expr}\` = **${shown}**`.slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'math' && command !== 'calc') return { ignored: true };

  const expr = String(payload.args || '').trim();
  if (!expr) {
    await postToHaven('Usage: `/math <expr>` e.g. `/math (2+3)*4^2` · ops: `+ - * / ^ % ( )`');
    return;
  }

  try {
    const value = evaluate(expr);
    await postToHaven(formatResult(expr, value));
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send('math bot running. safe recursive-descent evaluator.');
});
app.get('/health', (_req, res) => res.json({ ok: true, maxExprLen: MAX_EXPR_LEN }));

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
      await postToHaven('✅ Math bot received a test event.');
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
  console.log(`math bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
