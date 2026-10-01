// mod-notes — Haven community bot
//
// Staff notes: /note add <userId> <text>, /note list <userId>, /note remove …
// Stored in STATE_FILE. Optional ALLOWED_USER_IDS (or MODERATOR_USER_IDS).
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
const STATE_FILE = process.env.STATE_FILE || './data/mod-notes-state.json';
const ALLOWED_USER_IDS = (
  process.env.ALLOWED_USER_IDS ||
  process.env.MODERATOR_USER_IDS ||
  process.env.APPROVER_USER_IDS ||
  ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_NOTES_PER_USER = Math.max(
  1,
  parseInt(process.env.MAX_NOTES_PER_USER || '100', 10) || 100
);
const MAX_NOTE_LENGTH = Math.max(1, parseInt(process.env.MAX_NOTE_LENGTH || '1000', 10) || 1000);
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
      users: j.users && typeof j.users === 'object' ? j.users : {},
    };
  } catch {
    return { nextId: 1, users: {} };
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

function isAllowed(user) {
  if (!ALLOWED_USER_IDS.length) return true;
  if (!user || user.id == null) return false;
  return ALLOWED_USER_IDS.some((id) => String(id) === String(user.id));
}

function staffLabel(user) {
  return (user && (user.username || user.displayName)) || 'staff';
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
      command: 'note',
      description: 'Staff notes on a user',
      subcommands: [
        { name: 'add', description: 'Add a note' },
        { name: 'list', description: 'List notes for a user' },
        { name: 'remove', description: 'Remove a note by id' },
        { name: 'clear', description: 'Clear all notes for a user' },
      ],
    },
    { command: 'notes', description: 'Alias: /notes list <userId>' },
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

function normalizeTarget(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^<@!?([^>]+)>$/);
  if (m) s = m[1];
  s = s.replace(/^@+/, '').slice(0, 128);
  return s || null;
}

function targetKey(target) {
  return String(target).toLowerCase();
}

function getNotes(target) {
  const key = targetKey(target);
  const list = state.users[key];
  return Array.isArray(list) ? list : [];
}

function setNotes(target, list) {
  const key = targetKey(target);
  if (!list.length) delete state.users[key];
  else state.users[key] = list;
  saveState();
}

function addNote(target, text, staff) {
  const t = normalizeTarget(target);
  if (!t) throw new Error('Usage: `/note add <userId> <text>`');
  const body = String(text || '').trim().slice(0, MAX_NOTE_LENGTH);
  if (!body) throw new Error('Usage: `/note add <userId> <text>`');

  const list = getNotes(t);
  if (list.length >= MAX_NOTES_PER_USER) {
    throw new Error(`User already has ${MAX_NOTES_PER_USER} notes (max). Remove some first.`);
  }
  const note = {
    id: state.nextId++,
    target: t,
    text: body,
    createdAt: Date.now(),
    author: staffLabel(staff),
    authorId: staff && staff.id != null ? staff.id : null,
  };
  list.push(note);
  setNotes(t, list);
  return { note, count: list.length };
}

function removeNote(target, noteId) {
  const t = normalizeTarget(target);
  if (!t) throw new Error('Usage: `/note remove <userId> <noteId>`');
  if (!Number.isInteger(noteId) || noteId < 1) {
    throw new Error('Usage: `/note remove <userId> <noteId>`');
  }
  const list = getNotes(t);
  const next = list.filter((n) => n.id !== noteId);
  if (next.length === list.length) throw new Error(`No note #${noteId} for \`${t}\`.`);
  setNotes(t, next);
  return { remaining: next.length, target: t };
}

function clearNotes(target) {
  const t = normalizeTarget(target);
  if (!t) throw new Error('Usage: `/note clear <userId>`');
  const list = getNotes(t);
  if (!list.length) throw new Error(`No notes on file for \`${t}\`.`);
  setNotes(t, []);
  return { removed: list.length, target: t };
}

function formatList(target) {
  const t = normalizeTarget(target);
  if (!t) return 'Usage: `/note list <userId>`';
  const list = getNotes(t).slice().sort((a, b) => a.id - b.id);
  if (!list.length) return `📝 **Mod notes for \`${t}\`**\n_None._`;
  const lines = list.map((n) => {
    const when = n.createdAt
      ? new Date(n.createdAt).toISOString().slice(0, 16).replace('T', ' ')
      : '';
    return `• **#${n.id}** ${n.text}\n  _by ${n.author || 'staff'}${when ? ` · ${when} UTC` : ''}_`;
  });
  return `📝 **Mod notes for \`${t}\`** (${list.length})\n${lines.join('\n')}`.slice(0, 4000);
}

async function denyIfNeeded(user) {
  if (isAllowed(user)) return false;
  await postToHaven('❌ You are not allowed to use staff notes.');
  return true;
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const user = payload.user || {};
  const parts = args.split(/\s+/).filter(Boolean);

  if (command === 'notes') {
    // /notes [list] <userId>
    if (await denyIfNeeded(user)) return;
    let target = parts[0];
    if (target && ['list', 'show', 'get'].includes(target.toLowerCase())) {
      target = parts[1];
    }
    if (!target) {
      await postToHaven('Usage: `/notes <userId>` or `/note list <userId>`');
      return;
    }
    await postToHaven(formatList(target));
    return;
  }

  if (command !== 'note') return { ignored: true };

  const sub = (parts[0] || '').toLowerCase();

  if (!sub || sub === 'help') {
    await postToHaven(
      'Usage: `/note add <userId> <text>` · `/note list <userId>` · `/note remove <userId> <id>` · `/note clear <userId>`'
    );
    return;
  }

  if (await denyIfNeeded(user)) return;

  if (sub === 'list' || sub === 'show' || sub === 'get') {
    const target = parts[1];
    if (!target) {
      await postToHaven('Usage: `/note list <userId>`');
      return;
    }
    await postToHaven(formatList(target));
    return;
  }

  if (sub === 'add' || sub === 'new' || sub === 'create') {
    const target = parts[1];
    const text = parts.slice(2).join(' ');
    try {
      const { note, count } = addNote(target, text, user);
      await postToHaven(
        [
          `✅ **Note #${note.id}** on \`${note.target}\``,
          note.text,
          `_by ${note.author} · total notes: **${count}**_`,
        ].join('\n').slice(0, 4000)
      );
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  if (sub === 'remove' || sub === 'delete' || sub === 'rm') {
    const target = parts[1];
    const id = parseInt(parts[2], 10);
    try {
      const result = removeNote(target, id);
      await postToHaven(
        `🗑️ Removed note **#${id}** for \`${result.target}\` (${result.remaining} remaining).`
      );
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  if (sub === 'clear') {
    const target = parts[1];
    try {
      const result = clearNotes(target);
      await postToHaven(`🗑️ Cleared **${result.removed}** note(s) for \`${result.target}\`.`);
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  // Convenience: /note <userId> <text> → add
  if (parts.length >= 2) {
    try {
      const { note, count } = addNote(parts[0], parts.slice(1).join(' '), user);
      await postToHaven(
        [
          `✅ **Note #${note.id}** on \`${note.target}\``,
          note.text,
          `_by ${note.author} · total notes: **${count}**_`,
        ].join('\n').slice(0, 4000)
      );
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  await postToHaven(
    'Usage: `/note add <userId> <text>` · `/note list <userId>` · `/note remove <userId> <id>`'
  );
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `mod-notes bot running. users=${Object.keys(state.users).length} allowlist=${ALLOWED_USER_IDS.length || 'open'}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    users: Object.keys(state.users).length,
    allowlist: ALLOWED_USER_IDS.length,
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
      await postToHaven('✅ Mod-notes bot received a test event.');
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
  console.log(`mod-notes bot listening on :${PORT}`);
  console.log(
    `  allowlist: ${ALLOWED_USER_IDS.length ? ALLOWED_USER_IDS.length + ' id(s)' : 'open (anyone)'}`
  );
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
