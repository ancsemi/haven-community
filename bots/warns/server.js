// warns — Haven community bot
//
// /warn <userId> <reason>, /warns <userId>, /warn clear [userId] [id]
// Stores warnings in STATE_FILE (does not mute/kick by itself).
// Optional MODERATOR_USER_IDS / APPROVER_USER_IDS gate.
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
const STATE_FILE = process.env.STATE_FILE || './data/warns-state.json';
const MODERATOR_USER_IDS = (
  process.env.MODERATOR_USER_IDS ||
  process.env.APPROVER_USER_IDS ||
  ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_WARNS_PER_USER = Math.max(1, parseInt(process.env.MAX_WARNS_PER_USER || '50', 10) || 50);
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
      // userKey -> array of warn objects
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
      command: 'warn',
      description: 'Issue or clear a warning',
      subcommands: [
        { name: 'clear', description: 'Clear warns for a user' },
        { name: 'list', description: 'List warns (alias of /warns)' },
      ],
    },
    { command: 'warns', description: 'List warnings for a user: /warns <userId>' },
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

function isModerator(user) {
  if (!MODERATOR_USER_IDS.length) return true;
  if (!user || user.id == null) return false;
  return MODERATOR_USER_IDS.some((id) => String(id) === String(user.id));
}

function userLabel(user) {
  return (user && (user.username || user.displayName)) || 'staff';
}

function normalizeTarget(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  // strip <@id> style mentions if ever present
  const m = s.match(/^<@!?([^>]+)>$/);
  if (m) s = m[1];
  s = s.replace(/^@+/, '').slice(0, 128);
  return s || null;
}

function targetKey(target) {
  return String(target).toLowerCase();
}

function getWarns(target) {
  const key = targetKey(target);
  const list = state.users[key];
  return Array.isArray(list) ? list : [];
}

function setWarns(target, list) {
  const key = targetKey(target);
  if (!list.length) {
    delete state.users[key];
  } else {
    state.users[key] = list;
  }
  saveState();
}

function addWarn(target, reason, moderator) {
  const t = normalizeTarget(target);
  if (!t) throw new Error('Usage: `/warn <userId> <reason>`');
  const r = String(reason || '').trim().slice(0, 1000);
  if (!r) throw new Error('Usage: `/warn <userId> <reason>`');

  const list = getWarns(t);
  if (list.length >= MAX_WARNS_PER_USER) {
    throw new Error(`User already has ${MAX_WARNS_PER_USER} warns (max). Clear some first.`);
  }
  const warn = {
    id: state.nextId++,
    target: t,
    reason: r,
    createdAt: Date.now(),
    moderator: userLabel(moderator),
    moderatorId: moderator && moderator.id != null ? moderator.id : null,
  };
  list.push(warn);
  setWarns(t, list);
  return { warn, count: list.length };
}

function clearWarns(target, warnId) {
  const t = normalizeTarget(target);
  if (!t) throw new Error('Usage: `/warn clear <userId> [warnId]`');
  const list = getWarns(t);
  if (!list.length) throw new Error(`No warns on file for \`${t}\`.`);

  if (warnId != null && Number.isInteger(warnId)) {
    const next = list.filter((w) => w.id !== warnId);
    if (next.length === list.length) throw new Error(`No warn #${warnId} for \`${t}\`.`);
    setWarns(t, next);
    return { removed: 1, remaining: next.length, target: t };
  }

  setWarns(t, []);
  return { removed: list.length, remaining: 0, target: t };
}

function formatList(target) {
  const t = normalizeTarget(target);
  if (!t) return 'Usage: `/warns <userId>`';
  const list = getWarns(t).slice().sort((a, b) => a.id - b.id);
  if (!list.length) return `⚠️ **Warns for \`${t}\`**\n_None._`;
  const lines = list.map((w) => {
    const when = w.createdAt ? new Date(w.createdAt).toISOString().slice(0, 16).replace('T', ' ') : '';
    return `• **#${w.id}** ${w.reason}\n  _by ${w.moderator || 'staff'}${when ? ` · ${when} UTC` : ''}_`;
  });
  return `⚠️ **Warns for \`${t}\`** (${list.length})\n${lines.join('\n')}`.slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const user = payload.user || {};
  const parts = args.split(/\s+/).filter(Boolean);

  if (command === 'warns') {
    const target = parts[0];
    if (!target) {
      await postToHaven('Usage: `/warns <userId>`');
      return;
    }
    await postToHaven(formatList(target));
    return;
  }

  if (command !== 'warn') return { ignored: true };

  const sub = (parts[0] || '').toLowerCase();

  if (!sub || sub === 'help') {
    await postToHaven(
      'Usage: `/warn <userId> <reason>` · `/warns <userId>` · `/warn clear <userId> [id]` · `/warn list <userId>`'
    );
    return;
  }

  if (sub === 'list' || sub === 'show' || sub === 'get') {
    const target = parts[1];
    if (!target) {
      await postToHaven('Usage: `/warn list <userId>`');
      return;
    }
    await postToHaven(formatList(target));
    return;
  }

  if (sub === 'clear' || sub === 'remove' || sub === 'delete') {
    if (!isModerator(user)) {
      await postToHaven('❌ You are not allowed to clear warns.');
      return;
    }
    const target = parts[1];
    let warnId = null;
    if (parts[2]) {
      const n = parseInt(parts[2], 10);
      if (Number.isInteger(n)) warnId = n;
    }
    try {
      const result = clearWarns(target, warnId);
      if (warnId != null) {
        await postToHaven(
          `✅ Cleared warn **#${warnId}** for \`${result.target}\` (${result.remaining} remaining).`
        );
      } else {
        await postToHaven(
          `✅ Cleared **${result.removed}** warn(s) for \`${result.target}\`.`
        );
      }
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  // /warn <userId> <reason>  OR  /warn add <userId> <reason>
  if (!isModerator(user)) {
    await postToHaven('❌ You are not allowed to issue warns.');
    return;
  }

  let target;
  let reasonParts;
  if (sub === 'add' || sub === 'issue') {
    target = parts[1];
    reasonParts = parts.slice(2);
  } else {
    target = parts[0];
    reasonParts = parts.slice(1);
  }

  try {
    const { warn, count } = addWarn(target, reasonParts.join(' '), user);
    await postToHaven(
      [
        `⚠️ **Warning #${warn.id}** issued to \`${warn.target}\``,
        `**Reason:** ${warn.reason}`,
        `_by ${warn.moderator} · total warns: **${count}**_`,
        `List: \`/warns ${warn.target}\` · Clear: \`/warn clear ${warn.target}\``,
      ].join('\n').slice(0, 4000)
    );
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  const n = Object.keys(state.users).length;
  res.type('text/plain').send(`warns bot running. usersWithWarns=${n}`);
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    users: Object.keys(state.users).length,
    moderated: MODERATOR_USER_IDS.length > 0,
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
      await postToHaven('✅ Warns bot received a test event.');
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
  console.log(`warns bot listening on :${PORT}`);
  if (MODERATOR_USER_IDS.length) {
    console.log(`  moderator gate: ${MODERATOR_USER_IDS.length} id(s)`);
  } else {
    console.log('  moderator gate: open (anyone can warn)');
  }
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
