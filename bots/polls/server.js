// polls — Haven community bot
//
// Slash /poll for creating polls and viewing results; /vote <id> <n> to cast
// a vote. State is persisted to STATE_FILE.
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
const STATE_FILE = process.env.STATE_FILE || './data/polls-state.json';
const MAX_POLLS = Math.max(1, parseInt(process.env.MAX_POLLS || '100', 10) || 100);
const MAX_OPTIONS = Math.max(2, parseInt(process.env.MAX_OPTIONS || '10', 10) || 10);
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
      polls: j.polls && typeof j.polls === 'object' ? j.polls : {},
    };
  } catch {
    return { nextId: 1, polls: {} };
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
      command: 'poll',
      description: 'Create a poll or view results',
      subcommands: [
        { name: 'results', description: 'Show tallies for a poll id' },
      ],
    },
    {
      command: 'vote',
      description: 'Vote on a poll: /vote <id> <option number>',
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

function voterKey(user) {
  if (user && user.id != null) return `id:${user.id}`;
  const name = (user && (user.username || user.displayName)) || 'anon';
  return `name:${String(name).toLowerCase()}`;
}

function tallies(poll) {
  const counts = poll.options.map(() => 0);
  for (const choice of Object.values(poll.votes || {})) {
    if (Number.isInteger(choice) && choice >= 0 && choice < counts.length) counts[choice] += 1;
  }
  return counts;
}

function formatPoll(poll, withTallies) {
  const counts = tallies(poll);
  const total = counts.reduce((a, b) => a + b, 0);
  const lines = [`📊 **Poll #${poll.id}** — ${poll.question}`];
  poll.options.forEach((opt, i) => {
    if (withTallies) {
      const c = counts[i];
      const pct = total ? Math.round((c / total) * 100) : 0;
      lines.push(`${i + 1}. ${opt} — **${c}** (${pct}%)`);
    } else {
      lines.push(`${i + 1}. ${opt}`);
    }
  });
  if (withTallies) lines.push(`_Total votes: ${total}_`);
  else lines.push(`Vote: \`/vote ${poll.id} <n>\``);
  if (poll.author) lines.push(`_by ${poll.author}_`);
  return lines.join('\n').slice(0, 4000);
}

function prunePolls() {
  const ids = Object.keys(state.polls).map(Number).sort((a, b) => a - b);
  while (ids.length > MAX_POLLS) {
    const drop = ids.shift();
    delete state.polls[String(drop)];
  }
}

function createPoll(rawArgs, user) {
  const parts = String(rawArgs || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 3) {
    throw new Error('Usage: `/poll Question | option1 | option2 [| option3…]`');
  }
  const question = parts[0].slice(0, 500);
  const options = parts.slice(1).map((o) => o.slice(0, 200)).slice(0, MAX_OPTIONS);
  if (options.length < 2) throw new Error('Need at least 2 options.');

  const id = state.nextId++;
  const poll = {
    id,
    question,
    options,
    votes: {},
    createdAt: Date.now(),
    author: (user && (user.username || user.displayName)) || '',
    authorId: user && user.id != null ? user.id : null,
  };
  state.polls[String(id)] = poll;
  prunePolls();
  saveState(state);
  return poll;
}

function getPoll(id) {
  return state.polls[String(id)] || null;
}

function castVote(id, optionNum, user) {
  const poll = getPoll(id);
  if (!poll) throw new Error(`No poll #${id}.`);
  const idx = optionNum - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) {
    throw new Error(`Option must be 1–${poll.options.length}.`);
  }
  const key = voterKey(user);
  poll.votes[key] = idx;
  saveState(state);
  return poll;
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const user = payload.user || {};

  if (command === 'vote') {
    const parts = args.split(/\s+/).filter(Boolean);
    const id = parseInt(parts[0], 10);
    const n = parseInt(parts[1], 10);
    if (!Number.isInteger(id) || !Number.isInteger(n)) {
      await postToHaven('Usage: `/vote <poll id> <option number>`');
      return;
    }
    try {
      const poll = castVote(id, n, user);
      const who = user.username || user.displayName || 'You';
      await postToHaven(`✅ **${who}** voted **${n}. ${poll.options[n - 1]}** on poll #${id}.`);
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  if (command !== 'poll') return { ignored: true };

  const lower = args.toLowerCase();
  if (lower.startsWith('results')) {
    const id = parseInt(args.slice('results'.length).trim(), 10);
    if (!Number.isInteger(id)) {
      await postToHaven('Usage: `/poll results <id>`');
      return;
    }
    const poll = getPoll(id);
    if (!poll) {
      await postToHaven(`No poll #${id}.`);
      return;
    }
    await postToHaven(formatPoll(poll, true));
    return;
  }

  if (!args) {
    await postToHaven(
      'Usage: `/poll Question | option1 | option2` · `/poll results <id>` · `/vote <id> <n>`'
    );
    return;
  }

  try {
    const poll = createPoll(args, user);
    await postToHaven(formatPoll(poll, false));
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`polls bot running. polls=${Object.keys(state.polls).length}`);
});
app.get('/health', (_req, res) => res.json({ ok: true, polls: Object.keys(state.polls).length }));

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
      await postToHaven('✅ Polls bot received a test event.');
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
  console.log(`polls bot listening on :${PORT}`);
  console.log(`  polls stored: ${Object.keys(state.polls).length}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
