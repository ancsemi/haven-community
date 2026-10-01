// quotes — Haven community bot
//
// Slash /quote add|random|get|list. Quotes persist in STATE_FILE.
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
const STATE_FILE = process.env.STATE_FILE || './data/quotes-state.json';
const MAX_QUOTES = Math.max(1, parseInt(process.env.MAX_QUOTES || '500', 10) || 500);
const LIST_LIMIT = Math.max(1, parseInt(process.env.LIST_LIMIT || '15', 10) || 15);
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
      nextId: Number.isInteger(j.nextId) && j.nextId > 0 ? j.nextId : 1,
      quotes: j.quotes && typeof j.quotes === 'object' ? j.quotes : {},
    };
  } catch {
    return { nextId: 1, quotes: {} };
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
      command: 'quote',
      description: 'Add, list, get, or random quote',
      subcommands: [
        { name: 'add', description: 'Add a quote' },
        { name: 'random', description: 'Random quote' },
        { name: 'get', description: 'Get quote by id' },
        { name: 'list', description: 'List recent quotes' },
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

function allQuotes() {
  return Object.values(state.quotes).filter(Boolean);
}

function formatQuote(q) {
  const who = q.author || 'anon';
  const when = q.createdAt ? new Date(q.createdAt).toISOString().slice(0, 10) : '';
  const lines = [`💬 **Quote #${q.id}**`, `> ${q.text}`];
  lines.push(`_— ${who}${when ? ` · ${when}` : ''}_`);
  return lines.join('\n').slice(0, 4000);
}

function pruneQuotes() {
  const ids = Object.keys(state.quotes).map(Number).sort((a, b) => a - b);
  while (ids.length > MAX_QUOTES) {
    const drop = ids.shift();
    delete state.quotes[String(drop)];
  }
}

function addQuote(text, user) {
  const body = String(text || '').trim().slice(0, 1500);
  if (!body) throw new Error('Usage: `/quote add <text>`');
  const id = state.nextId++;
  const q = {
    id,
    text: body,
    createdAt: Date.now(),
    author: (user && (user.username || user.displayName)) || '',
    authorId: user && user.id != null ? user.id : null,
  };
  state.quotes[String(id)] = q;
  pruneQuotes();
  saveState(state);
  return q;
}

function getQuote(id) {
  return state.quotes[String(id)] || null;
}

function randomQuote() {
  const list = allQuotes();
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function formatList() {
  const list = allQuotes().sort((a, b) => b.id - a.id).slice(0, LIST_LIMIT);
  if (!list.length) return '💬 **Quotes**\n_No quotes yet. Add one with `/quote add <text>`._';
  const lines = list.map((q) => {
    const preview = q.text.length > 60 ? `${q.text.slice(0, 57)}…` : q.text;
    return `• **#${q.id}** ${preview}`;
  });
  return `💬 **Quotes** (showing ${list.length} of ${allQuotes().length})\n${lines.join('\n')}`.slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const user = payload.user || {};

  if (command !== 'quote') return { ignored: true };

  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (!sub || sub === 'help') {
    await postToHaven(
      'Usage: `/quote add <text>` · `/quote random` · `/quote get <id>` · `/quote list`'
    );
    return;
  }

  if (sub === 'add') {
    const text = parts.slice(1).join(' ').trim();
    try {
      const q = addQuote(text, user);
      await postToHaven(`✅ Saved.\n${formatQuote(q)}`);
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  if (sub === 'random') {
    const q = randomQuote();
    if (!q) {
      await postToHaven('No quotes yet. Add one with `/quote add <text>`.');
      return;
    }
    await postToHaven(formatQuote(q));
    return;
  }

  if (sub === 'get') {
    const id = parseInt(parts[1], 10);
    if (!Number.isInteger(id) || id < 1) {
      await postToHaven('Usage: `/quote get <id>`');
      return;
    }
    const q = getQuote(id);
    if (!q) {
      await postToHaven(`No quote #${id}.`);
      return;
    }
    await postToHaven(formatQuote(q));
    return;
  }

  if (sub === 'list') {
    await postToHaven(formatList());
    return;
  }

  // Convenience: /quote <text> without "add" still adds if not a known sub
  try {
    const q = addQuote(args, user);
    await postToHaven(`✅ Saved.\n${formatQuote(q)}`);
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`quotes bot running. quotes=${allQuotes().length}`);
});
app.get('/health', (_req, res) => res.json({ ok: true, quotes: allQuotes().length }));

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
      await postToHaven('✅ Quotes bot received a test event.');
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
  console.log(`quotes bot listening on :${PORT}`);
  console.log(`  quotes stored: ${allQuotes().length}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
