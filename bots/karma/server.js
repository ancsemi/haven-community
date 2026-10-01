// karma — Haven community bot
//
// Message ++ / -- on names, plus /karma [user] and /karma top. Scores in STATE_FILE.
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
const STATE_FILE = process.env.STATE_FILE || './data/karma-state.json';
const ALLOW_SELF = String(process.env.ALLOW_SELF || 'false').toLowerCase() === 'true';
const TOP_N = Math.max(1, parseInt(process.env.TOP_N || '10', 10) || 10);
const ANNOUNCE = String(process.env.ANNOUNCE || 'true').toLowerCase() !== 'false';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return { scores: j.scores && typeof j.scores === 'object' ? j.scores : {} };
  } catch {
    return { scores: {} };
  }
}

function saveState(state) {
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

function normalizeName(name) {
  return String(name || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .slice(0, 64);
}

function displayKey(key) {
  // scores stored as lowercase names; show original-ish from key
  return key;
}

function getScore(name) {
  const key = normalizeName(name);
  if (!key) return 0;
  const n = state.scores[key];
  return Number.isFinite(n) ? n : 0;
}

function addScore(name, delta) {
  const key = normalizeName(name);
  if (!key) throw new Error('Empty name.');
  const cur = getScore(key);
  state.scores[key] = cur + delta;
  saveState(state);
  return { key, score: state.scores[key] };
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'karma',
      description: 'Check karma: /karma [user] or /karma top',
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /karma');
  }
}

function extractMessage(payload) {
  const msg = payload.message || payload.data || payload;
  const content = String(msg.content || payload.content || '').trim();
  const user = msg.user || msg.author || payload.user || payload.author || {};
  const username = user.username || user.displayName || msg.username || 'unknown';
  const userId = user.id ?? msg.user_id ?? msg.userId ?? payload.user_id ?? null;
  const isBot = !!(user.is_bot || user.isBot || msg.is_bot || msg.webhook_id || msg.webhookId);
  return { content, username, userId, isBot };
}

function parseKarmaOps(content) {
  // name++ name-- @name++ ++name --name (also "name ++")
  const ops = [];
  const re =
    /(?:^|[\s,])(?:@)?([A-Za-z0-9_.-]{2,32})\s*(\+\+|--)|(?:^|[\s,])(\+\+|--)\s*(?:@)?([A-Za-z0-9_.-]{2,32})(?=$|[\s,])/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[1] && m[2]) {
      ops.push({ name: m[1], delta: m[2] === '++' ? 1 : -1 });
    } else if (m[3] && m[4]) {
      ops.push({ name: m[4], delta: m[3] === '++' ? 1 : -1 });
    }
  }
  return ops;
}

function topList(n) {
  return Object.entries(state.scores)
    .map(([k, v]) => ({ name: k, score: Number(v) || 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, n);
}

function formatTop() {
  const list = topList(TOP_N);
  if (!list.length) return '✨ **Karma**\n_No scores yet. Try `someone++` in chat._';
  const lines = list.map((e, i) => `${i + 1}. **${e.name}** — **${e.score}**`);
  return `✨ **Karma leaderboard**\n${lines.join('\n')}`.slice(0, 4000);
}

async function handleMessage(payload) {
  const { content, username, isBot } = extractMessage(payload);
  if (isBot) return { skipped: 'bot' };
  if (!content) return { ignored: true };

  const ops = parseKarmaOps(content);
  if (!ops.length) return { ignored: true };

  const results = [];
  for (const op of ops) {
    const target = normalizeName(op.name);
    const actor = normalizeName(username);
    if (!target) continue;
    if (!ALLOW_SELF && target === actor) {
      results.push({ target, error: 'self' });
      continue;
    }
    const { score } = addScore(target, op.delta);
    results.push({ target, delta: op.delta, score });
  }

  if (!results.length) return { ok: true, empty: true };

  if (ANNOUNCE) {
    const lines = results.map((r) => {
      if (r.error === 'self') return `⛔ You can't change your own karma, **${username}**.`;
      const sign = r.delta > 0 ? '++' : '--';
      return `✨ **${r.target}**${sign} → **${r.score}**`;
    });
    await postToHaven(lines.join('\n').slice(0, 4000));
  }

  return { ok: true, results: results.length };
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'karma') return { ignored: true };

  const args = String(payload.args || '').trim();
  const user = payload.user || {};
  const parts = args.split(/\s+/).filter(Boolean);
  const head = (parts[0] || '').toLowerCase();

  if (!args || head === 'me') {
    const name = normalizeName(user.username || user.displayName || 'you');
    const score = getScore(name);
    await postToHaven(`✨ **${name}** has **${score}** karma.`);
    return;
  }

  if (head === 'top' || head === 'leaderboard' || head === 'list') {
    await postToHaven(formatTop());
    return;
  }

  const name = normalizeName(parts.join(' '));
  if (!name) {
    await postToHaven('Usage: `/karma [user]` · `/karma top` · `/karma me`');
    return;
  }
  const score = getScore(name);
  await postToHaven(`✨ **${displayKey(name)}** has **${score}** karma.`);
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`karma bot running. users=${Object.keys(state.scores).length}`);
});
app.get('/health', (_req, res) =>
  res.json({ ok: true, users: Object.keys(state.scores).length })
);

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
      await postToHaven('✅ Karma bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

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

  if (event === 'message' || event === 'message-created' || event === 'message_create') {
    try {
      const result = await handleMessage(payload);
      return res.json(result);
    } catch (err) {
      console.error('message handler error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.json({ ignored: `event=${event}` });
});

app.listen(PORT, async () => {
  console.log(`karma bot listening on :${PORT}`);
  console.log(`  users tracked: ${Object.keys(state.scores).length} allowSelf=${ALLOW_SELF}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
