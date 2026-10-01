// counting — Haven community bot
//
// Listens for message events and expects sequential integers. Wrong numbers
// post a correction and either reset the count or freeze (STRICT mode).
// No double-count from the same user twice in a row.
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
const STATE_FILE = process.env.STATE_FILE || './data/counting-state.json';
const STRICT = String(process.env.STRICT || 'false').toLowerCase() === 'true';
const START_AT = Math.max(0, parseInt(process.env.START_AT || '0', 10) || 0);
const ALLOW_BOTS = String(process.env.ALLOW_BOTS || 'false').toLowerCase() === 'true';
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
    return {
      current: Number.isInteger(j.current) ? j.current : START_AT,
      lastUserId: j.lastUserId != null ? j.lastUserId : null,
      lastUsername: j.lastUsername || '',
      frozen: !!j.frozen,
      highScore: Number.isInteger(j.highScore) ? j.highScore : START_AT,
    };
  } catch {
    return {
      current: START_AT,
      lastUserId: null,
      lastUsername: '',
      frozen: false,
      highScore: START_AT,
    };
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
  const origin = new URL(HAVEN_WEBHOOK_URL).origin;
  const base = `${origin}/api/webhooks/${token}/commands`;
  const cmds = [
    {
      command: 'count',
      description: 'Show or manage the counting game',
      subcommands: [
        { name: 'status', description: 'Show current count' },
        { name: 'reset', description: 'Reset count to start' },
        { name: 'unfreeze', description: 'Unfreeze after STRICT fail' },
      ],
    },
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

function extractMessage(payload) {
  const msg = payload.message || payload.data || payload;
  const content = String(msg.content || payload.content || '').trim();
  const user = msg.user || msg.author || payload.user || payload.author || {};
  const username = user.username || user.displayName || msg.username || 'unknown';
  const userId = user.id ?? msg.user_id ?? msg.userId ?? payload.user_id ?? null;
  const isBot = !!(user.is_bot || user.isBot || msg.is_bot || msg.webhook_id || msg.webhookId);
  return { content, username, userId, isBot };
}

function parseCountMessage(content) {
  // Only pure integers (optional leading +); reject "1 hello", "1.0", etc.
  const m = String(content || '').trim().match(/^(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isInteger(n) ? n : null;
}

function userSame(userId, username) {
  if (userId != null && state.lastUserId != null) {
    return String(userId) === String(state.lastUserId);
  }
  if (!username || !state.lastUsername) return false;
  return String(username).toLowerCase() === String(state.lastUsername).toLowerCase();
}

function statusText() {
  const lines = [
    `🔢 **Counting**`,
    `Current: **${state.current}** → next is **${state.current + 1}**`,
    `High score: **${state.highScore}**`,
  ];
  if (state.lastUsername) lines.push(`Last: ${state.lastUsername}`);
  if (state.frozen) lines.push(`⚠️ **Frozen** (STRICT) — use \`/count unfreeze\``);
  lines.push(`Mode: ${STRICT ? 'STRICT (freeze on fail)' : 'reset on fail'}`);
  return lines.join('\n');
}

async function handleMessage(payload) {
  const { content, username, userId, isBot } = extractMessage(payload);
  if (isBot && !ALLOW_BOTS) return { skipped: 'bot' };

  const n = parseCountMessage(content);
  if (n == null) return { ignored: true, reason: 'not-a-count' };

  if (state.frozen) {
    await postToHaven(
      `🧊 Counting is **frozen** at **${state.current}**. Use \`/count unfreeze\` to continue (next: **${state.current + 1}**).`
    );
    return { ok: true, frozen: true };
  }

  const expected = state.current + 1;

  if (userSame(userId, username)) {
    await postToHaven(
      `⛔ **${username}**, you can't count twice in a row. Someone else must post **${expected}**.`
    );
    return { ok: true, double: true };
  }

  if (n !== expected) {
    const ruined = state.current;
    if (STRICT) {
      state.frozen = true;
      saveState(state);
      await postToHaven(
        `💥 **${username}** ruined it! Expected **${expected}**, got **${n}**.\nCount frozen at **${ruined}** (high: **${state.highScore}**). \`/count unfreeze\` to resume.`
      );
      return { ok: true, fail: true, frozen: true };
    }
    state.current = START_AT;
    state.lastUserId = null;
    state.lastUsername = '';
    saveState(state);
    await postToHaven(
      `💥 **${username}** ruined it! Expected **${expected}**, got **${n}**.\nReset to **${START_AT}**. Next number: **${START_AT + 1}** (high: **${state.highScore}**).`
    );
    return { ok: true, fail: true, reset: true };
  }

  state.current = n;
  state.lastUserId = userId;
  state.lastUsername = username;
  if (n > state.highScore) state.highScore = n;
  saveState(state);

  // Light milestone cheers
  if (n > 0 && n % 100 === 0) {
    await postToHaven(`🎉 Milestone! Count reached **${n}** — keep going!`);
  }

  return { ok: true, current: n };
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  if (command !== 'count') return { ignored: true };

  const sub = (args.split(/\s+/)[0] || 'status').toLowerCase();

  if (sub === 'status' || sub === 'show' || !args) {
    await postToHaven(statusText());
    return;
  }

  if (sub === 'reset') {
    state.current = START_AT;
    state.lastUserId = null;
    state.lastUsername = '';
    state.frozen = false;
    saveState(state);
    await postToHaven(`🔄 Count reset to **${START_AT}**. Next: **${START_AT + 1}**.`);
    return;
  }

  if (sub === 'unfreeze') {
    if (!state.frozen) {
      await postToHaven('Counting is not frozen.');
      return;
    }
    state.frozen = false;
    state.lastUserId = null;
    state.lastUsername = '';
    saveState(state);
    await postToHaven(`🔓 Unfrozen at **${state.current}**. Next number: **${state.current + 1}**.`);
    return;
  }

  await postToHaven('Usage: `/count status` · `/count reset` · `/count unfreeze`');
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `counting bot running. current=${state.current} frozen=${state.frozen} strict=${STRICT}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    current: state.current,
    highScore: state.highScore,
    frozen: state.frozen,
    strict: STRICT,
  })
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
      await postToHaven('✅ Counting bot received a test event.');
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
  console.log(`counting bot listening on :${PORT}`);
  console.log(
    `  current=${state.current} high=${state.highScore} strict=${STRICT} frozen=${state.frozen}`
  );
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
