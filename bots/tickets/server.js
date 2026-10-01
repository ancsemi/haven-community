// tickets — Haven community bot
//
// Slash /ticket open|close|list for simple support tickets. Open tickets are
// stored in STATE_FILE; ticket cards are posted to the channel.
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
const STATE_FILE = process.env.STATE_FILE || './data/tickets-state.json';
const MAX_OPEN = Math.max(1, parseInt(process.env.MAX_OPEN || '50', 10) || 50);
const MAX_CLOSED_KEEP = Math.max(0, parseInt(process.env.MAX_CLOSED_KEEP || '100', 10) || 100);
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
      tickets: j.tickets && typeof j.tickets === 'object' ? j.tickets : {},
    };
  } catch {
    return { nextId: 1, tickets: {} };
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
      command: 'ticket',
      description: 'Open, close, or list support tickets',
      subcommands: [
        { name: 'open', description: 'Open a ticket with a subject' },
        { name: 'close', description: 'Close a ticket by id' },
        { name: 'list', description: 'List open tickets' },
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

function openTickets() {
  return Object.values(state.tickets).filter((t) => t && t.status === 'open');
}

function formatTicketCard(t) {
  const who = t.username || 'anon';
  const when = t.createdAt ? new Date(t.createdAt).toISOString() : '';
  const lines = [
    `🎫 **Ticket #${t.id}** — open`,
    `**Subject:** ${t.subject}`,
    `_Opened by ${who}${when ? ` · ${when}` : ''}_`,
    `Close: \`/ticket close ${t.id}\``,
  ];
  return lines.join('\n').slice(0, 4000);
}

function formatList() {
  const open = openTickets().sort((a, b) => a.id - b.id);
  if (!open.length) return '🎫 **Tickets**\n_No open tickets._';
  const lines = open.map((t) => {
    const who = t.username || 'anon';
    return `• **#${t.id}** — ${t.subject} _(${who})_`;
  });
  return `🎫 **Open tickets** (${open.length})\n${lines.join('\n')}`.slice(0, 4000);
}

function pruneClosed() {
  if (MAX_CLOSED_KEEP <= 0) {
    for (const [k, t] of Object.entries(state.tickets)) {
      if (t && t.status === 'closed') delete state.tickets[k];
    }
    return;
  }
  const closed = Object.values(state.tickets)
    .filter((t) => t && t.status === 'closed')
    .sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0));
  while (closed.length > MAX_CLOSED_KEEP) {
    const drop = closed.shift();
    delete state.tickets[String(drop.id)];
  }
}

function openTicket(subject, user) {
  const open = openTickets();
  if (open.length >= MAX_OPEN) {
    throw new Error(`Too many open tickets (max ${MAX_OPEN}). Close some first.`);
  }
  const subj = String(subject || '').trim().slice(0, 500);
  if (!subj) throw new Error('Usage: `/ticket open <subject>`');
  const id = state.nextId++;
  const ticket = {
    id,
    subject: subj,
    status: 'open',
    createdAt: Date.now(),
    closedAt: null,
    userId: user && user.id != null ? user.id : null,
    username: (user && (user.username || user.displayName)) || '',
  };
  state.tickets[String(id)] = ticket;
  saveState(state);
  return ticket;
}

function closeTicket(id, user) {
  const t = state.tickets[String(id)];
  if (!t) throw new Error(`No ticket #${id}.`);
  if (t.status === 'closed') throw new Error(`Ticket #${id} is already closed.`);
  t.status = 'closed';
  t.closedAt = Date.now();
  t.closedBy = (user && (user.username || user.displayName)) || '';
  t.closedById = user && user.id != null ? user.id : null;
  pruneClosed();
  saveState(state);
  return t;
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const user = payload.user || {};

  if (command !== 'ticket') return { ignored: true };

  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (!sub || sub === 'help') {
    await postToHaven(
      'Usage: `/ticket open <subject>` · `/ticket close [id]` · `/ticket list`'
    );
    return;
  }

  if (sub === 'list') {
    await postToHaven(formatList());
    return;
  }

  if (sub === 'open') {
    const subject = parts.slice(1).join(' ').trim();
    try {
      const t = openTicket(subject, user);
      await postToHaven(formatTicketCard(t));
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  if (sub === 'close') {
    let id = parseInt(parts[1], 10);
    if (!Number.isInteger(id) || id < 1) {
      const mine = openTickets()
        .filter((t) => {
          if (user && user.id != null && t.userId != null) return String(t.userId) === String(user.id);
          const name = (user.username || user.displayName || '').toLowerCase();
          return name && (t.username || '').toLowerCase() === name;
        })
        .sort((a, b) => b.id - a.id);
      if (mine.length === 1) {
        id = mine[0].id;
      } else if (mine.length > 1) {
        await postToHaven(
          `You have multiple open tickets. Specify an id: ${mine.map((t) => `#${t.id}`).join(', ')}`
        );
        return;
      } else {
        await postToHaven('Usage: `/ticket close <id>`');
        return;
      }
    }
    try {
      const t = closeTicket(id, user);
      const who = t.closedBy || 'staff';
      await postToHaven(
        `✅ **Ticket #${t.id}** closed by ${who}.\n~~${t.subject}~~`.slice(0, 4000)
      );
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  await postToHaven(
    'Usage: `/ticket open <subject>` · `/ticket close [id]` · `/ticket list`'
  );
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`tickets bot running. open=${openTickets().length}`);
});
app.get('/health', (_req, res) =>
  res.json({ ok: true, open: openTickets().length, total: Object.keys(state.tickets).length })
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
      await postToHaven('✅ Tickets bot received a test event.');
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
  console.log(`tickets bot listening on :${PORT}`);
  console.log(`  open tickets: ${openTickets().length}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
