// leveling — Haven community bot
//
// Awards XP on message events (with cooldown), stores levels in STATE_FILE,
// posts level-up congratulations, and provides /rank and /levels.
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
const STATE_FILE = process.env.STATE_FILE || './data/leveling-state.json';
const XP_PER_MESSAGE = Math.max(1, parseInt(process.env.XP_PER_MESSAGE || '15', 10) || 15);
const XP_COOLDOWN_SEC = Math.max(0, parseInt(process.env.XP_COOLDOWN_SEC || '60', 10) || 60);
const XP_BASE = Math.max(1, parseFloat(process.env.XP_BASE || '5') || 5);
const XP_EXP = Math.max(1, parseFloat(process.env.XP_EXP || '2') || 2);
const LEVELUP_MESSAGE = process.env.LEVELUP_MESSAGE
  || '🎉 **{username}** reached **level {level}**!';
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
      users: j.users && typeof j.users === 'object' ? j.users : {},
      cooldown: j.cooldown && typeof j.cooldown === 'object' ? j.cooldown : {},
    };
  } catch {
    return { users: {}, cooldown: {} };
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

function xpForLevel(level) {
  return Math.floor(XP_BASE * Math.pow(level, XP_EXP));
}

function levelFromXp(xp) {
  let level = 0;
  let remaining = Math.max(0, Number(xp) || 0);
  while (level < 10000) {
    const need = xpForLevel(level + 1);
    if (remaining < need) break;
    remaining -= need;
    level += 1;
  }
  return { level, intoLevel: remaining, nextNeed: xpForLevel(level + 1) };
}

function userKey(userId, username) {
  if (userId != null && userId !== '') return `id:${userId}`;
  return `name:${String(username || 'unknown').toLowerCase()}`;
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
      command: 'rank',
      description: 'Show your level and XP (or another user)',
    },
    {
      command: 'levels',
      description: 'Show the top 10 leaderboard',
      subcommands: [
        { name: 'leaderboard', description: 'Top 10 by XP' },
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

function ensureUser(key, username) {
  if (!state.users[key]) {
    state.users[key] = { xp: 0, username: username || 'unknown', messages: 0 };
  }
  if (username) state.users[key].username = username;
  return state.users[key];
}

function rankOf(key) {
  const sorted = Object.entries(state.users)
    .map(([k, u]) => ({ key: k, xp: u.xp || 0 }))
    .sort((a, b) => b.xp - a.xp);
  const idx = sorted.findIndex((e) => e.key === key);
  return idx < 0 ? sorted.length + 1 : idx + 1;
}

function findUserByQuery(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  if (state.users[`id:${q}`]) return { key: `id:${q}`, user: state.users[`id:${q}`] };
  if (state.users[`name:${q}`]) return { key: `name:${q}`, user: state.users[`name:${q}`] };
  for (const [key, user] of Object.entries(state.users)) {
    if (String(user.username || '').toLowerCase() === q) return { key, user };
  }
  for (const [key, user] of Object.entries(state.users)) {
    if (String(user.username || '').toLowerCase().includes(q)) return { key, user };
  }
  return null;
}

function formatRank(key, user) {
  const { level, intoLevel, nextNeed } = levelFromXp(user.xp || 0);
  const rank = rankOf(key);
  const name = user.username || 'unknown';
  return [
    `📊 **${name}** — rank #${rank}`,
    `Level **${level}** · **${user.xp || 0}** XP`,
    `Progress: ${intoLevel}/${nextNeed} XP to next level`,
    `Messages tracked: ${user.messages || 0}`,
  ].join('\n');
}

function formatLeaderboard(limit) {
  const sorted = Object.entries(state.users)
    .map(([key, u]) => ({ key, ...u }))
    .sort((a, b) => (b.xp || 0) - (a.xp || 0))
    .slice(0, limit);
  if (!sorted.length) return '🏆 **Leaderboard**\n_No XP yet — send some messages!_';
  const lines = sorted.map((u, i) => {
    const { level } = levelFromXp(u.xp || 0);
    return `${i + 1}. **${u.username || 'unknown'}** — Lv ${level} · ${u.xp || 0} XP`;
  });
  return `🏆 **Leaderboard** (top ${sorted.length})\n${lines.join('\n')}`.slice(0, 4000);
}

function extractMessage(payload) {
  const msg = payload.message || payload.data || payload;
  const content = String(msg.content || payload.content || '');
  const user = msg.user || msg.author || payload.user || payload.author || {};
  const username = user.username || user.displayName || msg.username || 'unknown';
  const userId = user.id ?? msg.user_id ?? msg.userId ?? payload.user_id ?? null;
  const isBot = !!(user.is_bot || user.isBot || msg.is_bot || msg.webhook_id || msg.webhookId);
  return { content, username, userId, isBot };
}

async function awardXp(payload) {
  const { content, username, userId, isBot } = extractMessage(payload);
  if (isBot) return { skipped: 'bot' };
  if (!String(content || '').trim()) return { skipped: 'empty' };

  const key = userKey(userId, username);
  const now = Date.now();
  const last = state.cooldown[key] || 0;
  if (XP_COOLDOWN_SEC > 0 && now - last < XP_COOLDOWN_SEC * 1000) {
    return { skipped: 'cooldown' };
  }

  const user = ensureUser(key, username);
  const before = levelFromXp(user.xp || 0).level;
  user.xp = (user.xp || 0) + XP_PER_MESSAGE;
  user.messages = (user.messages || 0) + 1;
  user.username = username;
  state.cooldown[key] = now;
  const after = levelFromXp(user.xp).level;
  saveState(state);

  if (after > before) {
    const text = LEVELUP_MESSAGE
      .replaceAll('{username}', username)
      .replaceAll('{level}', String(after))
      .slice(0, 4000);
    await postToHaven(text);
    console.log(`[${new Date().toISOString()}] level-up ${username} → ${after}`);
    return { ok: true, levelUp: after, xp: user.xp };
  }
  return { ok: true, xp: user.xp, level: after };
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  const args = String(payload.args || '').trim();
  const invoker = payload.user || {};

  if (command === 'levels') {
    await postToHaven(formatLeaderboard(10));
    return;
  }

  if (command === 'rank') {
    const query = args;
    if (query) {
      const found = findUserByQuery(query);
      if (!found) {
        await postToHaven(`No XP data for \`${query}\`.`);
        return;
      }
      await postToHaven(formatRank(found.key, found.user));
      return;
    }
    const key = userKey(invoker.id, invoker.username || invoker.displayName);
    const user = ensureUser(key, invoker.username || invoker.displayName || 'you');
    saveState(state);
    await postToHaven(formatRank(key, user));
    return;
  }

  return { ignored: true };
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `leveling bot running. users=${Object.keys(state.users).length} xp/msg=${XP_PER_MESSAGE} cd=${XP_COOLDOWN_SEC}s`
  );
});
app.get('/health', (_req, res) => res.json({
  ok: true,
  users: Object.keys(state.users).length,
  xpPerMessage: XP_PER_MESSAGE,
  cooldownSec: XP_COOLDOWN_SEC,
}));

app.post('/haven', async (req, res) => {
  const raw = req.body;
  const sig = req.get('X-Haven-Signature') || '';
  const eventHeader = (req.get('X-Haven-Event') || '').toLowerCase();

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

  const event = (payload.event || eventHeader || '').toLowerCase();

  if (event === 'test') {
    try {
      await postToHaven('✅ Leveling bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  try {
    if (event === 'slash_command') {
      const result = await handleSlash(payload);
      if (result && result.ignored) return res.json({ ignored: true });
      return res.json({ ok: true });
    }
    if (event === 'message' || event === 'message-created' || event === 'message_create') {
      const result = await awardXp(payload);
      return res.json(result);
    }
    return res.json({ ignored: `event=${event}` });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] handler error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  console.log(`leveling bot listening on :${PORT}`);
  console.log(`  users: ${Object.keys(state.users).length}, xp/msg=${XP_PER_MESSAGE}, cooldown=${XP_COOLDOWN_SEC}s`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
