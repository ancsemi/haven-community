// giveaway — Haven community bot
//
// Slash /giveaway start|enter|end|list. Open giveaways are stored in STATE_FILE
// and resolved (random winner) when duration ends or /giveaway end is used.
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
const STATE_FILE = process.env.STATE_FILE || './data/giveaway-state.json';
const TICK_INTERVAL_MS = Math.max(1000, parseInt(process.env.TICK_INTERVAL_MS || '5000', 10) || 5000);
const MAX_GIVEAWAYS = Math.max(1, parseInt(process.env.MAX_GIVEAWAYS || '50', 10) || 50);
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
      giveaways: j.giveaways && typeof j.giveaways === 'object' ? j.giveaways : {},
    };
  } catch {
    return { nextId: 1, giveaways: {} };
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

function parseDuration(token) {
  const m = String(token || '').trim().match(/^(\d+)\s*([smhdw])$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  const unit = m[2].toLowerCase();
  const mult = unit === 's' ? 1000
    : unit === 'm' ? 60 * 1000
    : unit === 'h' ? 60 * 60 * 1000
    : unit === 'd' ? 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;
  const ms = n * mult;
  if (ms > 30 * 24 * 60 * 60 * 1000) return null;
  return { ms, label: `${n}${unit}` };
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'giveaway',
      description: 'Start, enter, or end a giveaway',
      subcommands: [
        { name: 'start', description: 'Start a giveaway: start <duration> <prize>' },
        { name: 'enter', description: 'Enter a giveaway by id' },
        { name: 'end', description: 'End a giveaway early and pick a winner' },
        { name: 'list', description: 'List open giveaways' },
      ],
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /giveaway');
  }
}

function entrantKey(user) {
  if (user && user.id != null) return `id:${user.id}`;
  const name = (user && (user.username || user.displayName)) || 'anon';
  return `name:${String(name).toLowerCase()}`;
}

function entrantLabel(user) {
  return (user && (user.username || user.displayName)) || 'someone';
}

function getG(id) {
  return state.giveaways[String(id)] || null;
}

function pruneClosed() {
  const ids = Object.keys(state.giveaways);
  if (ids.length <= MAX_GIVEAWAYS) return;
  const sorted = ids
    .map((id) => state.giveaways[id])
    .filter(Boolean)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  while (sorted.length > MAX_GIVEAWAYS) {
    const drop = sorted.shift();
    if (drop && drop.status !== 'open') delete state.giveaways[String(drop.id)];
    else break;
  }
}

function pickWinner(g) {
  const entrants = Object.values(g.entrants || {});
  if (!entrants.length) return null;
  const idx = crypto.randomInt(entrants.length);
  return entrants[idx];
}

async function endGiveaway(g, reason) {
  if (!g || g.status !== 'open') return false;
  g.status = 'ended';
  g.endedAt = Date.now();
  g.endReason = reason || 'ended';
  const winner = pickWinner(g);
  g.winner = winner;
  saveState(state);

  const count = Object.keys(g.entrants || {}).length;
  if (winner) {
    await postToHaven(
      `🏆 **Giveaway #${g.id}** ended!\nPrize: ${g.prize}\nWinner: **${winner.name}** (from ${count} entrant${count === 1 ? '' : 's'})`.slice(0, 4000)
    );
  } else {
    await postToHaven(
      `🏆 **Giveaway #${g.id}** ended!\nPrize: ${g.prize}\n_No entrants — no winner._`
    );
  }
  console.log(`[${new Date().toISOString()}] ended #${g.id} winner=${winner ? winner.name : 'none'}`);
  return true;
}

async function tick() {
  const now = Date.now();
  const due = Object.values(state.giveaways).filter((g) => g.status === 'open' && g.endsAt <= now);
  for (const g of due) {
    try {
      await endGiveaway(g, 'timer');
    } catch (err) {
      console.error(`[tick] #${g.id}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

function listOpen() {
  const open = Object.values(state.giveaways)
    .filter((g) => g.status === 'open')
    .sort((a, b) => a.endsAt - b.endsAt);
  if (!open.length) return '🎁 **Giveaways**\n_No open giveaways._';
  const lines = open.map((g) => {
    const n = Object.keys(g.entrants || {}).length;
    return `• **#${g.id}** — ${g.prize}\n  ends ${new Date(g.endsAt).toISOString()} · ${n} entrant${n === 1 ? '' : 's'} · \`/giveaway enter ${g.id}\``;
  });
  return `🎁 **Open giveaways** (${open.length})\n${lines.join('\n')}`.slice(0, 4000);
}

async function handleSlash(payload) {
  if (String(payload.command || '').toLowerCase() !== 'giveaway') return { ignored: true };
  const args = String(payload.args || '').trim();
  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();
  const user = payload.user || {};

  if (sub === 'list' || !sub) {
    await postToHaven(listOpen());
    return;
  }

  if (sub === 'start') {
    const dur = parseDuration(parts[1]);
    const prize = parts.slice(2).join(' ').trim().slice(0, 500);
    if (!dur || !prize) {
      await postToHaven('Usage: `/giveaway start <duration> <prize>` (e.g. `2h Steam key`)');
      return;
    }
    const openCount = Object.values(state.giveaways).filter((g) => g.status === 'open').length;
    if (openCount >= MAX_GIVEAWAYS) {
      await postToHaven(`❌ Too many open giveaways (max ${MAX_GIVEAWAYS}).`);
      return;
    }
    const id = state.nextId++;
    const g = {
      id,
      prize,
      durationLabel: dur.label,
      endsAt: Date.now() + dur.ms,
      createdAt: Date.now(),
      status: 'open',
      entrants: {},
      host: entrantLabel(user),
      hostId: user.id != null ? user.id : null,
    };
    state.giveaways[String(id)] = g;
    pruneClosed();
    saveState(state);
    await postToHaven(
      `🎉 **Giveaway #${id}** — ${prize}\nEnds: ${new Date(g.endsAt).toISOString()} (in ${dur.label})\nEnter: \`/giveaway enter ${id}\``.slice(0, 4000)
    );
    return;
  }

  if (sub === 'enter') {
    const id = parseInt(parts[1], 10);
    if (!Number.isInteger(id)) {
      await postToHaven('Usage: `/giveaway enter <id>`');
      return;
    }
    const g = getG(id);
    if (!g || g.status !== 'open') {
      await postToHaven(`No open giveaway #${id}.`);
      return;
    }
    if (Date.now() > g.endsAt) {
      await endGiveaway(g, 'timer');
      return;
    }
    const key = entrantKey(user);
    if (g.entrants[key]) {
      await postToHaven(`You're already entered in giveaway #${id}.`);
      return;
    }
    g.entrants[key] = { name: entrantLabel(user), id: user.id != null ? user.id : null, at: Date.now() };
    saveState(state);
    const n = Object.keys(g.entrants).length;
    await postToHaven(`✅ **${entrantLabel(user)}** entered giveaway #${id} (${n} entrant${n === 1 ? '' : 's'}).`);
    return;
  }

  if (sub === 'end') {
    const id = parseInt(parts[1], 10);
    if (!Number.isInteger(id)) {
      await postToHaven('Usage: `/giveaway end <id>`');
      return;
    }
    const g = getG(id);
    if (!g || g.status !== 'open') {
      await postToHaven(`No open giveaway #${id}.`);
      return;
    }
    await endGiveaway(g, 'manual');
    return;
  }

  await postToHaven('Usage: `/giveaway start|enter|end|list`');
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  const open = Object.values(state.giveaways).filter((g) => g.status === 'open').length;
  res.type('text/plain').send(`giveaway bot running. open=${open} tick=${TICK_INTERVAL_MS}ms`);
});
app.get('/health', (_req, res) => {
  const open = Object.values(state.giveaways).filter((g) => g.status === 'open').length;
  res.json({ ok: true, open });
});

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
      await postToHaven('✅ Giveaway bot received a test event.');
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
  console.log(`giveaway bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), TICK_INTERVAL_MS);
});
