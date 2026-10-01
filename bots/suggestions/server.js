// suggestions — Haven community bot
//
// Slash /suggest to submit ideas; /suggest list; /suggest approve|reject <id>.
// Optional APPROVER_USER_IDS gate for moderate actions.
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
const STATE_FILE = process.env.STATE_FILE || './data/suggestions-state.json';
const MAX_SUGGESTIONS = Math.max(1, parseInt(process.env.MAX_SUGGESTIONS || '200', 10) || 200);
const APPROVER_USER_IDS = (process.env.APPROVER_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
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
      suggestions: j.suggestions && typeof j.suggestions === 'object' ? j.suggestions : {},
    };
  } catch {
    return { nextId: 1, suggestions: {} };
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
      command: 'suggest',
      description: 'Submit or moderate suggestions',
      subcommands: [
        { name: 'list', description: 'List pending suggestions' },
        { name: 'approve', description: 'Approve a suggestion by id' },
        { name: 'reject', description: 'Reject a suggestion by id' },
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

function isApprover(user) {
  if (!APPROVER_USER_IDS.length) return true;
  if (!user || user.id == null) return false;
  return APPROVER_USER_IDS.some((id) => String(id) === String(user.id));
}

function statusIcon(status) {
  if (status === 'approved') return '✅';
  if (status === 'rejected') return '❌';
  return '💡';
}

function formatSuggestion(s) {
  const who = s.username || 'anon';
  const when = s.createdAt ? new Date(s.createdAt).toISOString() : '';
  const lines = [
    `${statusIcon(s.status)} **Suggestion #${s.id}** — ${s.status}`,
    s.text,
    `_by ${who}${when ? ` · ${when}` : ''}_`,
  ];
  if (s.moderator) {
    lines.push(`_Moderated by ${s.moderator}${s.moderatedAt ? ` · ${new Date(s.moderatedAt).toISOString()}` : ''}_`);
  }
  return lines.join('\n').slice(0, 4000);
}

function listPending() {
  return Object.values(state.suggestions)
    .filter((s) => s && s.status === 'pending')
    .sort((a, b) => a.id - b.id);
}

function formatList(filter) {
  let items = Object.values(state.suggestions).filter(Boolean);
  if (filter === 'pending' || !filter) {
    items = items.filter((s) => s.status === 'pending');
  } else if (filter === 'all') {
    items = items.sort((a, b) => b.id - a.id).slice(0, 30);
  } else if (filter === 'approved' || filter === 'rejected') {
    items = items.filter((s) => s.status === filter);
  }
  items = items.sort((a, b) => a.id - b.id);
  if (!items.length) {
    const label = filter && filter !== 'pending' ? filter : 'pending';
    return `💡 **Suggestions**\n_No ${label} suggestions._`;
  }
  const lines = items.map((s) => {
    const who = s.username || 'anon';
    const preview = s.text.length > 80 ? `${s.text.slice(0, 77)}…` : s.text;
    return `• ${statusIcon(s.status)} **#${s.id}** [${s.status}] ${preview} _(${who})_`;
  });
  return `💡 **Suggestions** (${items.length})\n${lines.join('\n')}`.slice(0, 4000);
}

function pruneSuggestions() {
  const ids = Object.keys(state.suggestions).map(Number).sort((a, b) => a - b);
  while (ids.length > MAX_SUGGESTIONS) {
    const drop = ids.shift();
    delete state.suggestions[String(drop)];
  }
}

function addSuggestion(text, user) {
  const body = String(text || '').trim().slice(0, 1500);
  if (!body) throw new Error('Usage: `/suggest <text>`');
  const id = state.nextId++;
  const item = {
    id,
    text: body,
    status: 'pending',
    createdAt: Date.now(),
    userId: user && user.id != null ? user.id : null,
    username: (user && (user.username || user.displayName)) || '',
    moderatedAt: null,
    moderator: '',
    moderatorId: null,
  };
  state.suggestions[String(id)] = item;
  pruneSuggestions();
  saveState(state);
  return item;
}

function setStatus(id, status, user) {
  const s = state.suggestions[String(id)];
  if (!s) throw new Error(`No suggestion #${id}.`);
  if (s.status !== 'pending') throw new Error(`Suggestion #${id} is already ${s.status}.`);
  if (status !== 'approved' && status !== 'rejected') throw new Error('Invalid status.');
  s.status = status;
  s.moderatedAt = Date.now();
  s.moderator = (user && (user.username || user.displayName)) || '';
  s.moderatorId = user && user.id != null ? user.id : null;
  saveState(state);
  return s;
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const user = payload.user || {};

  if (command !== 'suggest') return { ignored: true };

  const parts = args.split(/\s+/).filter(Boolean);
  const head = (parts[0] || '').toLowerCase();

  if (!args) {
    await postToHaven(
      'Usage: `/suggest <text>` · `/suggest list [pending|all]` · `/suggest approve|reject <id>`'
    );
    return;
  }

  if (head === 'list') {
    const filter = (parts[1] || 'pending').toLowerCase();
    const allowed = new Set(['pending', 'all', 'approved', 'rejected']);
    await postToHaven(formatList(allowed.has(filter) ? filter : 'pending'));
    return;
  }

  if (head === 'approve' || head === 'reject') {
    if (!isApprover(user)) {
      await postToHaven('❌ You are not allowed to moderate suggestions.');
      return;
    }
    const id = parseInt(parts[1], 10);
    if (!Number.isInteger(id) || id < 1) {
      await postToHaven(`Usage: \`/suggest ${head} <id>\``);
      return;
    }
    try {
      const s = setStatus(id, head === 'approve' ? 'approved' : 'rejected', user);
      await postToHaven(formatSuggestion(s));
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  try {
    const text = args;
    const s = addSuggestion(text, user);
    await postToHaven(formatSuggestion(s));
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`suggestions bot running. pending=${listPending().length}`);
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    pending: listPending().length,
    total: Object.keys(state.suggestions).length,
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
      await postToHaven('✅ Suggestions bot received a test event.');
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
  console.log(`suggestions bot listening on :${PORT}`);
  console.log(`  pending: ${listPending().length}, approvers: ${APPROVER_USER_IDS.length || 'any'}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
