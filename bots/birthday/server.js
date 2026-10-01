// birthday — Haven community bot
//
// /birthday set MM-DD, /birthday remove, /birthday list, /birthday when [user]
// Daily check in TIMEZONE posts happy-birthday list once per day.
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
const STATE_FILE = process.env.STATE_FILE || './data/birthday-state.json';
const TIMEZONE = process.env.TIMEZONE || 'UTC';
const CHECK_INTERVAL_MS = Math.max(
  60_000,
  parseInt(process.env.CHECK_INTERVAL_MS || String(15 * 60 * 1000), 10) || 15 * 60 * 1000
);
const ANNOUNCE_HOUR = Math.max(0, Math.min(23, parseInt(process.env.ANNOUNCE_HOUR || '9', 10) || 9));
const MESSAGE_TEMPLATE =
  process.env.MESSAGE_TEMPLATE ||
  '🎂 **Happy birthday!**\n{names}\n\nHave an awesome day!';
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
      birthdays: j.birthdays && typeof j.birthdays === 'object' ? j.birthdays : {},
      lastAnnounceDate: j.lastAnnounceDate || '',
    };
  } catch {
    return { birthdays: {}, lastAnnounceDate: '' };
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
      command: 'birthday',
      description: 'Set or list birthdays (MM-DD)',
      subcommands: [
        { name: 'set', description: 'Set your birthday MM-DD' },
        { name: 'remove', description: 'Remove your birthday' },
        { name: 'list', description: 'List known birthdays' },
        { name: 'when', description: 'Look up a user birthday' },
        { name: 'today', description: 'Who has a birthday today' },
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

function parseMMDD(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) m = s.match(/^(\d{1,2})(\d{2})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // rough validity (Feb 30 etc. rejected via Date check in UTC non-leap-safe enough)
  const probe = new Date(Date.UTC(2024, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function userKey(user) {
  if (user && user.id != null && user.id !== '') return `id:${user.id}`;
  const name = (user && (user.username || user.displayName)) || '';
  if (name) return `name:${name.toLowerCase()}`;
  return null;
}

function displayName(entry) {
  return entry.username || entry.userId || 'someone';
}

function partsInTimezone(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    mmdd: `${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10) || 0,
  };
}

function todaysBirthdays(mmdd) {
  return Object.values(state.birthdays).filter((b) => b && b.mmdd === mmdd);
}

function formatList() {
  const list = Object.values(state.birthdays)
    .filter(Boolean)
    .sort((a, b) => a.mmdd.localeCompare(b.mmdd) || displayName(a).localeCompare(displayName(b)));
  if (!list.length) return '🎂 **Birthdays**\n_None set. Use `/birthday set MM-DD`._';
  const lines = list.map((b) => `• **${displayName(b)}** — ${b.mmdd}`);
  return `🎂 **Birthdays** (${list.length}) · TZ \`${TIMEZONE}\`\n${lines.join('\n')}`.slice(0, 4000);
}

function formatToday(list, mmdd) {
  if (!list.length) return `🎂 No birthdays today (${mmdd}, ${TIMEZONE}).`;
  const names = list.map((b) => `• **${displayName(b)}**`).join('\n');
  return MESSAGE_TEMPLATE.replaceAll('{names}', names)
    .replaceAll('{date}', mmdd)
    .replaceAll('{timezone}', TIMEZONE)
    .slice(0, 4000);
}

async function maybeAnnounce() {
  const { dateKey, mmdd, hour } = partsInTimezone();
  if (hour < ANNOUNCE_HOUR) return;
  if (state.lastAnnounceDate === dateKey) return;
  const list = todaysBirthdays(mmdd);
  state.lastAnnounceDate = dateKey;
  saveState();
  if (!list.length) {
    console.log(`[${new Date().toISOString()}] no birthdays on ${mmdd} (${TIMEZONE})`);
    return;
  }
  try {
    await postToHaven(formatToday(list, mmdd));
    console.log(`[${new Date().toISOString()}] announced ${list.length} birthday(s) for ${mmdd}`);
  } catch (err) {
    // allow retry next tick
    state.lastAnnounceDate = '';
    saveState();
    console.error(`[${new Date().toISOString()}] announce failed:`, err.message);
  }
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'birthday') return { ignored: true };

  const args = String(payload.args || '').trim();
  const user = payload.user || {};
  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (!sub || sub === 'help') {
    await postToHaven(
      'Usage: `/birthday set MM-DD` · `/birthday remove` · `/birthday list` · `/birthday when [user]` · `/birthday today`'
    );
    return;
  }

  if (sub === 'set') {
    const mmdd = parseMMDD(parts.slice(1).join(' '));
    if (!mmdd) {
      await postToHaven('Usage: `/birthday set MM-DD` (e.g. `03-14` or `3/14`)');
      return;
    }
    const key = userKey(user);
    if (!key) {
      await postToHaven('❌ Could not identify you.');
      return;
    }
    state.birthdays[key] = {
      key,
      mmdd,
      userId: user.id != null ? user.id : null,
      username: user.username || user.displayName || '',
      updatedAt: Date.now(),
    };
    saveState();
    await postToHaven(`✅ Birthday set to **${mmdd}** for **${displayName(state.birthdays[key])}** (${TIMEZONE}).`);
    return;
  }

  if (sub === 'remove' || sub === 'clear' || sub === 'delete') {
    const key = userKey(user);
    if (!key || !state.birthdays[key]) {
      await postToHaven('No birthday on file for you.');
      return;
    }
    delete state.birthdays[key];
    saveState();
    await postToHaven('✅ Your birthday was removed.');
    return;
  }

  if (sub === 'list') {
    await postToHaven(formatList());
    return;
  }

  if (sub === 'today') {
    const { mmdd } = partsInTimezone();
    await postToHaven(formatToday(todaysBirthdays(mmdd), mmdd));
    return;
  }

  if (sub === 'when' || sub === 'get') {
    const q = parts.slice(1).join(' ').trim().toLowerCase();
    if (!q) {
      const key = userKey(user);
      const mine = key && state.birthdays[key];
      if (!mine) {
        await postToHaven('No birthday on file for you. Set one with `/birthday set MM-DD`.');
        return;
      }
      await postToHaven(`🎂 **${displayName(mine)}** — ${mine.mmdd}`);
      return;
    }
    const found = Object.values(state.birthdays).find((b) => {
      if (!b) return false;
      if (String(b.userId) === q) return true;
      return (b.username || '').toLowerCase() === q || (b.username || '').toLowerCase().includes(q);
    });
    if (!found) {
      await postToHaven(`No birthday found for \`${q}\`.`);
      return;
    }
    await postToHaven(`🎂 **${displayName(found)}** — ${found.mmdd}`);
    return;
  }

  // Convenience: /birthday MM-DD
  const asDate = parseMMDD(args);
  if (asDate) {
    const key = userKey(user);
    if (!key) {
      await postToHaven('❌ Could not identify you.');
      return;
    }
    state.birthdays[key] = {
      key,
      mmdd: asDate,
      userId: user.id != null ? user.id : null,
      username: user.username || user.displayName || '',
      updatedAt: Date.now(),
    };
    saveState();
    await postToHaven(`✅ Birthday set to **${asDate}** (${TIMEZONE}).`);
    return;
  }

  await postToHaven(
    'Usage: `/birthday set MM-DD` · `/birthday remove` · `/birthday list` · `/birthday when [user]` · `/birthday today`'
  );
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `birthday bot running. people=${Object.keys(state.birthdays).length} tz=${TIMEZONE} hour=${ANNOUNCE_HOUR}`
    );
});
app.get('/health', (_req, res) => {
  const now = partsInTimezone();
  res.json({
    ok: true,
    count: Object.keys(state.birthdays).length,
    timezone: TIMEZONE,
    announceHour: ANNOUNCE_HOUR,
    today: now.mmdd,
    lastAnnounceDate: state.lastAnnounceDate,
  });
});
app.post('/announce', async (_req, res) => {
  try {
    state.lastAnnounceDate = '';
    await maybeAnnounce();
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
      await postToHaven('✅ Birthday bot received a test event.');
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
  console.log(`birthday bot listening on :${PORT} (tz=${TIMEZONE}, hour>=${ANNOUNCE_HOUR})`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
  maybeAnnounce().catch((e) => console.error('initial check:', e.message));
  setInterval(() => {
    maybeAnnounce().catch((e) => console.error('check:', e.message));
  }, CHECK_INTERVAL_MS);
});
