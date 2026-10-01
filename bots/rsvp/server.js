// rsvp — Haven community bot
//
// /event create <title> | /event rsvp <id> yes|no|maybe | /event show <id>
// Also: /event list, /event close <id>, /event delete <id>
// Events persist in STATE_FILE.
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
const STATE_FILE = process.env.STATE_FILE || './data/rsvp-state.json';
const MAX_EVENTS = Math.max(1, parseInt(process.env.MAX_EVENTS || '50', 10) || 50);
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
      events: j.events && typeof j.events === 'object' ? j.events : {},
    };
  } catch {
    return { nextId: 1, events: {} };
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
      command: 'event',
      description: 'Create events and RSVP',
      subcommands: [
        { name: 'create', description: 'Create an event' },
        { name: 'rsvp', description: 'RSVP yes/no/maybe' },
        { name: 'show', description: 'Show an event' },
        { name: 'list', description: 'List open events' },
        { name: 'close', description: 'Close an event' },
        { name: 'delete', description: 'Delete an event' },
      ],
    },
    { command: 'rsvp', description: 'Shortcut: /rsvp <id> yes|no|maybe' },
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

function userLabel(user) {
  return (user && (user.username || user.displayName)) || 'anon';
}

function userId(user) {
  return user && user.id != null ? String(user.id) : null;
}

function rsvpKey(user) {
  const id = userId(user);
  if (id) return `id:${id}`;
  return `name:${userLabel(user).toLowerCase()}`;
}

function openEvents() {
  return Object.values(state.events).filter((e) => e && e.status === 'open');
}

function pruneEvents() {
  const all = Object.values(state.events).filter(Boolean).sort((a, b) => a.id - b.id);
  while (all.length > MAX_EVENTS) {
    const drop = all.shift();
    delete state.events[String(drop.id)];
  }
}

function counts(ev) {
  const c = { yes: 0, no: 0, maybe: 0 };
  for (const r of Object.values(ev.rsvps || {})) {
    if (r && c[r.response] != null) c[r.response]++;
  }
  return c;
}

function namesFor(ev, response) {
  return Object.values(ev.rsvps || {})
    .filter((r) => r && r.response === response)
    .map((r) => r.username || r.key)
    .slice(0, 30);
}

function formatEvent(ev, detailed) {
  const c = counts(ev);
  const status = ev.status === 'open' ? 'open' : 'closed';
  const lines = [
    `📅 **Event #${ev.id}** — ${status}`,
    `**${ev.title}**`,
    `_Host: ${ev.host || 'anon'}_`,
    `✅ Yes: **${c.yes}** · ❌ No: **${c.no}** · 🤔 Maybe: **${c.maybe}**`,
  ];
  if (detailed) {
    const y = namesFor(ev, 'yes');
    const n = namesFor(ev, 'no');
    const m = namesFor(ev, 'maybe');
    if (y.length) lines.push(`**Yes:** ${y.join(', ')}`);
    if (n.length) lines.push(`**No:** ${n.join(', ')}`);
    if (m.length) lines.push(`**Maybe:** ${m.join(', ')}`);
    lines.push(`RSVP: \`/event rsvp ${ev.id} yes|no|maybe\``);
  }
  return lines.join('\n').slice(0, 4000);
}

function createEvent(title, user) {
  const t = String(title || '').trim().slice(0, 300);
  if (!t) throw new Error('Usage: `/event create <title>`');
  if (openEvents().length >= MAX_EVENTS) {
    throw new Error(`Too many events (max ${MAX_EVENTS}). Close or delete some first.`);
  }
  const id = state.nextId++;
  const ev = {
    id,
    title: t,
    status: 'open',
    createdAt: Date.now(),
    host: userLabel(user),
    hostId: userId(user),
    rsvps: {},
  };
  state.events[String(id)] = ev;
  pruneEvents();
  saveState();
  return ev;
}

function getEvent(id) {
  return state.events[String(id)] || null;
}

function setRsvp(id, response, user) {
  const ev = getEvent(id);
  if (!ev) throw new Error(`No event #${id}.`);
  if (ev.status !== 'open') throw new Error(`Event #${id} is closed.`);
  const resp = String(response || '').toLowerCase();
  const map = {
    yes: 'yes',
    y: 'yes',
    yea: 'yes',
    yeah: 'yes',
    going: 'yes',
    no: 'no',
    n: 'no',
    nope: 'no',
    maybe: 'maybe',
    m: 'maybe',
    interested: 'maybe',
  };
  const normalized = map[resp];
  if (!normalized) throw new Error('Response must be yes, no, or maybe.');
  const key = rsvpKey(user);
  ev.rsvps[key] = {
    key,
    response: normalized,
    username: userLabel(user),
    userId: userId(user),
    at: Date.now(),
  };
  saveState();
  return { ev, response: normalized };
}

function formatList() {
  const list = openEvents().sort((a, b) => a.id - b.id);
  if (!list.length) return '📅 **Events**\n_No open events. Create one with `/event create <title>`._';
  const lines = list.map((e) => {
    const c = counts(e);
    return `• **#${e.id}** ${e.title} — ✅${c.yes} ❌${c.no} 🤔${c.maybe}`;
  });
  return `📅 **Open events** (${list.length})\n${lines.join('\n')}`.slice(0, 4000);
}

async function handleEventArgs(args, user) {
  const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (!sub || sub === 'help') {
    await postToHaven(
      'Usage: `/event create <title>` · `/event rsvp <id> yes|no|maybe` · `/event show <id>` · `/event list` · `/event close <id>`'
    );
    return;
  }

  if (sub === 'create' || sub === 'new' || sub === 'add') {
    try {
      const ev = createEvent(parts.slice(1).join(' '), user);
      await postToHaven(`✅ Event created.\n${formatEvent(ev, true)}`);
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  if (sub === 'list' || sub === 'ls') {
    await postToHaven(formatList());
    return;
  }

  if (sub === 'show' || sub === 'get' || sub === 'info') {
    const id = parseInt(parts[1], 10);
    if (!Number.isInteger(id) || id < 1) {
      await postToHaven('Usage: `/event show <id>`');
      return;
    }
    const ev = getEvent(id);
    if (!ev) {
      await postToHaven(`No event #${id}.`);
      return;
    }
    await postToHaven(formatEvent(ev, true));
    return;
  }

  if (sub === 'rsvp' || sub === 'respond') {
    const id = parseInt(parts[1], 10);
    const response = parts[2];
    if (!Number.isInteger(id) || id < 1 || !response) {
      await postToHaven('Usage: `/event rsvp <id> yes|no|maybe`');
      return;
    }
    try {
      const { ev, response: r } = setRsvp(id, response, user);
      await postToHaven(
        `✅ **${userLabel(user)}** → **${r}** on event #${ev.id}.\n${formatEvent(ev, true)}`
      );
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  if (sub === 'close') {
    const id = parseInt(parts[1], 10);
    if (!Number.isInteger(id) || id < 1) {
      await postToHaven('Usage: `/event close <id>`');
      return;
    }
    const ev = getEvent(id);
    if (!ev) {
      await postToHaven(`No event #${id}.`);
      return;
    }
    ev.status = 'closed';
    ev.closedAt = Date.now();
    saveState();
    await postToHaven(`🔒 Event #${ev.id} closed.\n${formatEvent(ev, true)}`);
    return;
  }

  if (sub === 'delete' || sub === 'remove') {
    const id = parseInt(parts[1], 10);
    if (!Number.isInteger(id) || id < 1) {
      await postToHaven('Usage: `/event delete <id>`');
      return;
    }
    if (!getEvent(id)) {
      await postToHaven(`No event #${id}.`);
      return;
    }
    delete state.events[String(id)];
    saveState();
    await postToHaven(`🗑️ Deleted event #${id}.`);
    return;
  }

  // /event <title> convenience create if no known sub
  if (parts.length >= 1 && !/^\d+$/.test(sub)) {
    try {
      const ev = createEvent(parts.join(' '), user);
      await postToHaven(`✅ Event created.\n${formatEvent(ev, true)}`);
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  await postToHaven(
    'Usage: `/event create <title>` · `/event rsvp <id> yes|no|maybe` · `/event show <id>` · `/event list`'
  );
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const user = payload.user || {};

  if (command === 'event') {
    await handleEventArgs(args, user);
    return;
  }

  if (command === 'rsvp') {
    // /rsvp <id> yes|no|maybe
    const parts = args.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      await postToHaven('Usage: `/rsvp <id> yes|no|maybe`');
      return;
    }
    await handleEventArgs(`rsvp ${parts.join(' ')}`, user);
    return;
  }

  return { ignored: true };
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(`rsvp bot running. events=${Object.keys(state.events).length} open=${openEvents().length}`);
});
app.get('/health', (_req, res) =>
  res.json({ ok: true, events: Object.keys(state.events).length, open: openEvents().length })
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
      await postToHaven('✅ RSVP bot received a test event.');
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
  console.log(`rsvp bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
