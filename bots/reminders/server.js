// reminders — Haven community bot
//
// Slash commands to schedule channel reminders. Pending items are stored in
// STATE_FILE and delivered via the bot webhook when due.
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
const STATE_FILE = process.env.STATE_FILE || './data/reminders-state.json';
const TICK_INTERVAL_MS = Math.max(1000, parseInt(process.env.TICK_INTERVAL_MS || '5000', 10) || 5000);
const MAX_REMINDERS = Math.max(1, parseInt(process.env.MAX_REMINDERS || '200', 10) || 200);
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
      reminders: Array.isArray(j.reminders) ? j.reminders : [],
    };
  } catch {
    return { nextId: 1, reminders: [] };
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
  if (ms > 365 * 24 * 60 * 60 * 1000) return null;
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
  const origin = new URL(HAVEN_WEBHOOK_URL).origin;
  const base = `${origin}/api/webhooks/${token}/commands`;
  const cmds = [
    {
      command: 'remind',
      description: 'Schedule or cancel a reminder',
      subcommands: [
        { name: 'cancel', description: 'Cancel a reminder by id' },
      ],
    },
    {
      command: 'reminders',
      description: 'List pending reminders',
      subcommands: [
        { name: 'list', description: 'List pending reminders' },
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

function listText() {
  const now = Date.now();
  const pending = state.reminders
    .filter((r) => r.dueAt > now)
    .sort((a, b) => a.dueAt - b.dueAt);
  if (!pending.length) return '📋 **Reminders**\n_No pending reminders._';
  const lines = pending.map((r) => {
    const when = new Date(r.dueAt).toISOString();
    const who = r.username ? ` · ${r.username}` : '';
    return `• **#${r.id}** in ${r.durationLabel} (${when})${who}\n  ${r.text}`;
  });
  return `📋 **Reminders** (${pending.length})\n${lines.join('\n')}`.slice(0, 4000);
}

function addReminder(durationLabel, ms, text, user) {
  if (state.reminders.length >= MAX_REMINDERS) {
    throw new Error(`Too many reminders (max ${MAX_REMINDERS}). Cancel some first.`);
  }
  const id = state.nextId++;
  const dueAt = Date.now() + ms;
  const item = {
    id,
    text: String(text || '').slice(0, 1500),
    durationLabel,
    dueAt,
    createdAt: Date.now(),
    userId: user && user.id != null ? user.id : null,
    username: (user && (user.username || user.displayName)) || '',
  };
  state.reminders.push(item);
  saveState(state);
  return item;
}

function cancelReminder(id) {
  const before = state.reminders.length;
  state.reminders = state.reminders.filter((r) => r.id !== id);
  if (state.reminders.length === before) return false;
  saveState(state);
  return true;
}

async function tick() {
  const now = Date.now();
  const due = state.reminders.filter((r) => r.dueAt <= now);
  if (!due.length) return;
  const remaining = state.reminders.filter((r) => r.dueAt > now);
  state.reminders = remaining;
  saveState(state);
  for (const r of due) {
    const who = r.username ? ` (from ${r.username})` : '';
    const content = `⏰ **Reminder**${who}\n${r.text}`.slice(0, 4000);
    try {
      await postToHaven(content);
      console.log(`[${new Date().toISOString()}] fired reminder #${r.id}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] failed reminder #${r.id}:`, err.message);
      state.reminders.push(r);
      saveState(state);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const user = payload.user || {};

  if (command === 'reminders') {
    const sub = args.split(/\s+/)[0] || 'list';
    if (sub === 'list' || !args) {
      await postToHaven(listText());
      return;
    }
    await postToHaven('Usage: `/reminders list`');
    return;
  }

  if (command !== 'remind') {
    return { ignored: true };
  }

  const parts = args.split(/\s+/).filter(Boolean);
  if (!parts.length) {
    await postToHaven('Usage: `/remind <duration> <text>` · `/remind cancel <id>` · `/reminders list`');
    return;
  }

  if (parts[0].toLowerCase() === 'cancel') {
    const id = parseInt(parts[1], 10);
    if (!Number.isInteger(id) || id < 1) {
      await postToHaven('Usage: `/remind cancel <id>`');
      return;
    }
    const ok = cancelReminder(id);
    await postToHaven(ok ? `🗑️ Cancelled reminder **#${id}**.` : `No pending reminder **#${id}**.`);
    return;
  }

  const dur = parseDuration(parts[0]);
  if (!dur) {
    await postToHaven('Invalid duration. Use e.g. `10m`, `2h`, `1d`, `30s`.');
    return;
  }
  const text = parts.slice(1).join(' ').trim();
  if (!text) {
    await postToHaven('Usage: `/remind <duration> <text>`');
    return;
  }

  try {
    const item = addReminder(dur.label, dur.ms, text, user);
    await postToHaven(
      `✅ Reminder **#${item.id}** set for in ${item.durationLabel} (${new Date(item.dueAt).toISOString()})\n${item.text}`.slice(0, 4000)
    );
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`reminders bot running. pending=${state.reminders.length} tick=${TICK_INTERVAL_MS}ms`);
});
app.get('/health', (_req, res) => res.json({ ok: true, pending: state.reminders.length }));

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
      await postToHaven('✅ Reminders bot received a test event.');
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
  console.log(`reminders bot listening on :${PORT}`);
  console.log(`  pending: ${state.reminders.length}, tick every ${TICK_INTERVAL_MS}ms`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), TICK_INTERVAL_MS);
});
