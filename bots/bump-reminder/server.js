// bump-reminder — Haven community bot
//
// /bump records a timestamp; reminds the channel every BUMP_EVERY_HOURS
// (Disboard-style). Also /bump status and /bump set hours.
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
const STATE_FILE = process.env.STATE_FILE || './data/bump-reminder-state.json';
const BUMP_EVERY_HOURS = Math.max(
  0.25,
  parseFloat(process.env.BUMP_EVERY_HOURS || '2') || 2
);
const CHECK_INTERVAL_MS = Math.max(
  15_000,
  parseInt(process.env.CHECK_INTERVAL_MS || '60000', 10) || 60_000
);
const REMIND_MESSAGE =
  process.env.REMIND_MESSAGE ||
  '⏰ **Time to bump!**\nUse `/bump` after you bump the server listing.';
const BUMP_ACK_MESSAGE =
  process.env.BUMP_ACK_MESSAGE ||
  '✅ Bump recorded. Next reminder in about **{hours}h** (around {when}).';
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
      lastBumpAt: typeof j.lastBumpAt === 'number' ? j.lastBumpAt : null,
      lastRemindAt: typeof j.lastRemindAt === 'number' ? j.lastRemindAt : null,
      everyHours:
        typeof j.everyHours === 'number' && j.everyHours > 0 ? j.everyHours : BUMP_EVERY_HOURS,
      lastBumper: j.lastBumper || '',
    };
  } catch {
    return {
      lastBumpAt: null,
      lastRemindAt: null,
      everyHours: BUMP_EVERY_HOURS,
      lastBumper: '',
    };
  }
}

function saveState() {
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
  const url = `${new URL(HAVEN_WEBHOOK_URL).origin}/api/webhooks/${token}/commands`;
  const cmds = [
    {
      command: 'bump',
      description: 'Record a bump or show status',
      subcommands: [
        { name: 'status', description: 'Show next bump reminder time' },
        { name: 'set', description: 'Set hours between reminders' },
      ],
    },
  ];
  for (const body of cmds) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[commands] register failed: ${res.status}`);
    } else {
      console.log(`[commands] registered /${body.command}`);
    }
  }
}

function intervalMs() {
  return state.everyHours * 60 * 60 * 1000;
}

function nextDueAt() {
  if (state.lastBumpAt == null) return null;
  return state.lastBumpAt + intervalMs();
}

function formatWhen(ts) {
  if (ts == null) return 'n/a';
  return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function formatDuration(ms) {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function statusText() {
  const due = nextDueAt();
  const lines = [
    '📌 **Bump reminder status**',
    `Interval: **${state.everyHours}h**`,
  ];
  if (state.lastBumpAt == null) {
    lines.push('_No bump recorded yet. Run `/bump` after you bump._');
  } else {
    lines.push(`Last bump: ${formatWhen(state.lastBumpAt)}${state.lastBumper ? ` by **${state.lastBumper}**` : ''}`);
    lines.push(`Next reminder: ${formatWhen(due)} (${formatDuration(due - Date.now())})`);
  }
  if (state.lastRemindAt) lines.push(`Last reminded: ${formatWhen(state.lastRemindAt)}`);
  return lines.join('\n').slice(0, 4000);
}

function recordBump(user) {
  state.lastBumpAt = Date.now();
  state.lastBumper = (user && (user.username || user.displayName)) || '';
  // Allow a new remind cycle after this bump
  state.lastRemindAt = null;
  saveState();
  const due = nextDueAt();
  return BUMP_ACK_MESSAGE.replaceAll('{hours}', String(state.everyHours))
    .replaceAll('{when}', formatWhen(due))
    .replaceAll('{user}', state.lastBumper || 'someone')
    .slice(0, 4000);
}

async function maybeRemind() {
  const due = nextDueAt();
  if (due == null) return;
  if (Date.now() < due) return;
  // Don't spam: one remind until next /bump
  if (state.lastRemindAt != null && state.lastRemindAt >= due) return;

  try {
    await postToHaven(REMIND_MESSAGE.slice(0, 4000));
    state.lastRemindAt = Date.now();
    saveState();
    console.log(`[${new Date().toISOString()}] posted bump reminder`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] remind failed:`, err.message);
  }
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'bump') return { ignored: true };

  const args = String(payload.args || '').trim();
  const user = payload.user || {};
  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (!sub || sub === 'now' || sub === 'done' || sub === 'record') {
    await postToHaven(recordBump(user));
    return;
  }

  if (sub === 'status' || sub === 'info' || sub === 'when') {
    await postToHaven(statusText());
    return;
  }

  if (sub === 'set' || sub === 'hours' || sub === 'interval') {
    const n = parseFloat(parts[1]);
    if (!Number.isFinite(n) || n < 0.25 || n > 168) {
      await postToHaven('Usage: `/bump set <hours>` (0.25–168)');
      return;
    }
    state.everyHours = n;
    saveState();
    await postToHaven(`✅ Reminder interval set to **${n}h**.\n${statusText()}`);
    return;
  }

  if (sub === 'help') {
    await postToHaven(
      'Usage: `/bump` (record) · `/bump status` · `/bump set <hours>`'
    );
    return;
  }

  // Unknown sub → treat as record for Disboard muscle-memory
  await postToHaven(recordBump(user));
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `bump-reminder bot running. everyHours=${state.everyHours} lastBump=${state.lastBumpAt || 'none'}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    everyHours: state.everyHours,
    lastBumpAt: state.lastBumpAt,
    nextDueAt: nextDueAt(),
    lastRemindAt: state.lastRemindAt,
  })
);
app.post('/remind', async (_req, res) => {
  try {
    await postToHaven(REMIND_MESSAGE.slice(0, 4000));
    state.lastRemindAt = Date.now();
    saveState();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
      await postToHaven('✅ Bump-reminder bot received a test event.');
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
  console.log(
    `bump-reminder bot listening on :${PORT} (every ${state.everyHours}h, check ${CHECK_INTERVAL_MS}ms)`
  );
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
  maybeRemind().catch((e) => console.error('initial check:', e.message));
  setInterval(() => {
    maybeRemind().catch((e) => console.error('check:', e.message));
  }, CHECK_INTERVAL_MS);
});
