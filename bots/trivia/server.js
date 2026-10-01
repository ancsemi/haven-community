// trivia — Haven community bot
//
// /trivia start pulls a question from Open Trivia DB; first correct message
// (message events) wins. /trivia skip | status | stop.
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
const STATE_FILE = process.env.STATE_FILE || './data/trivia-state.json';
const CATEGORY = (process.env.CATEGORY || '').trim(); // OpenTDB category id optional
const DIFFICULTY = String(process.env.DIFFICULTY || '').toLowerCase(); // easy|medium|hard
const TYPE = String(process.env.TYPE || '').toLowerCase(); // multiple|boolean
const TIMEOUT_SEC = Math.max(0, parseInt(process.env.TIMEOUT_SEC || '120', 10) || 120);
const ALLOW_BOTS = String(process.env.ALLOW_BOTS || 'false').toLowerCase() === 'true';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);
const OTDB = 'https://opentdb.com/api.php';

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      active: j.active && typeof j.active === 'object' ? j.active : null,
      wins: j.wins && typeof j.wins === 'object' ? j.wins : {},
    };
  } catch {
    return { active: null, wins: {} };
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
      command: 'trivia',
      description: 'Trivia game from Open Trivia DB',
      subcommands: [
        { name: 'start', description: 'Start a new question' },
        { name: 'skip', description: 'Skip / reveal answer' },
        { name: 'stop', description: 'Cancel active question' },
        { name: 'status', description: 'Show active question' },
        { name: 'scores', description: 'Win leaderboard' },
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

function decodeHtml(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function normalizeAnswer(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function answersMatch(guess, correct) {
  const g = normalizeAnswer(guess);
  const c = normalizeAnswer(correct);
  if (!g || !c) return false;
  if (g === c) return true;
  // boolean aliases
  if (c === 'true' && ['t', 'yes', 'y', 'true'].includes(g)) return true;
  if (c === 'false' && ['f', 'no', 'n', 'false'].includes(g)) return true;
  // allow letter choice: a/b/c/d when active has choices
  return false;
}

function letterMatch(guess, active) {
  const g = String(guess || '').trim().toLowerCase();
  const m = g.match(/^([a-d])(?:[\).:]|\s|$)/i) || g.match(/^([a-d])$/i);
  if (!m || !active.choices) return false;
  const idx = m[1].toLowerCase().charCodeAt(0) - 97;
  const choice = active.choices[idx];
  if (!choice) return false;
  return normalizeAnswer(choice) === normalizeAnswer(active.correct);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchQuestion() {
  const params = new URLSearchParams({ amount: '1' });
  if (CATEGORY) params.set('category', CATEGORY);
  if (DIFFICULTY === 'easy' || DIFFICULTY === 'medium' || DIFFICULTY === 'hard') {
    params.set('difficulty', DIFFICULTY);
  }
  if (TYPE === 'multiple' || TYPE === 'boolean') params.set('type', TYPE);

  const res = await fetch(`${OTDB}?${params}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'haven-bot-trivia/1.0',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Open Trivia DB HTTP ${res.status}`);
  const data = await res.json();
  if (data.response_code !== 0 || !data.results || !data.results[0]) {
    throw new Error(`Open Trivia DB code ${data.response_code} (no results)`);
  }
  const q = data.results[0];
  const question = decodeHtml(q.question);
  const correct = decodeHtml(q.correct_answer);
  const incorrect = (q.incorrect_answers || []).map(decodeHtml);
  const type = q.type || 'multiple';
  let choices = null;
  if (type === 'boolean') {
    choices = ['True', 'False'];
  } else {
    choices = shuffle([correct, ...incorrect]);
  }
  return {
    question,
    correct,
    choices,
    category: decodeHtml(q.category || ''),
    difficulty: q.difficulty || '',
    type,
  };
}

function formatQuestion(active) {
  const lines = [
    '🧠 **Trivia**',
    active.category ? `_${active.category}${active.difficulty ? ` · ${active.difficulty}` : ''}_` : '',
    '',
    active.question,
  ].filter(Boolean);

  if (active.choices && active.choices.length) {
    lines.push('');
    active.choices.forEach((c, i) => {
      lines.push(`**${String.fromCharCode(65 + i)}.** ${c}`);
    });
    lines.push('');
    lines.push('_Reply with the letter or the full answer._');
  } else {
    lines.push('');
    lines.push('_Type the answer in chat._');
  }
  if (TIMEOUT_SEC > 0) {
    lines.push(`_Timeout: ${TIMEOUT_SEC}s · \`/trivia skip\` to reveal_`);
  }
  return lines.join('\n').slice(0, 4000);
}

function recordWin(username, userId) {
  const key = userId != null ? `id:${userId}` : `name:${String(username || 'anon').toLowerCase()}`;
  if (!state.wins[key]) {
    state.wins[key] = { wins: 0, username: username || 'anon', userId: userId != null ? userId : null };
  }
  state.wins[key].wins += 1;
  state.wins[key].username = username || state.wins[key].username;
}

function scoresText() {
  const list = Object.values(state.wins)
    .filter(Boolean)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 15);
  if (!list.length) return '🧠 **Trivia scores**\n_No wins yet._';
  const lines = list.map((w, i) => `${i + 1}. **${w.username}** — ${w.wins}`);
  return `🧠 **Trivia scores**\n${lines.join('\n')}`.slice(0, 4000);
}

function extractMessage(payload) {
  const msg = payload.message || payload.data || payload;
  const content = String(msg.content || payload.content || '').trim();
  const user = msg.user || msg.author || payload.user || payload.author || {};
  const username = user.username || user.displayName || msg.username || 'unknown';
  const userId = user.id ?? msg.user_id ?? msg.userId ?? payload.user_id ?? null;
  const isBot = !!(user.is_bot || user.isBot || msg.is_bot || msg.webhook_id || msg.webhookId);
  return { content, username, userId, isBot };
}

function isExpired(active) {
  if (!active || !TIMEOUT_SEC) return false;
  return Date.now() > (active.startedAt || 0) + TIMEOUT_SEC * 1000;
}

async function expireIfNeeded() {
  if (!state.active) return false;
  if (!isExpired(state.active)) return false;
  const correct = state.active.correct;
  state.active = null;
  saveState();
  await postToHaven(`⌛ Time's up! The answer was **${correct}**.`);
  return true;
}

async function startRound() {
  if (state.active && !isExpired(state.active)) {
    throw new Error('A question is already active. `/trivia skip` or answer it first.');
  }
  const q = await fetchQuestion();
  state.active = {
    ...q,
    startedAt: Date.now(),
  };
  saveState();
  return state.active;
}

async function handleMessage(payload) {
  await expireIfNeeded();
  if (!state.active) return { ignored: true, reason: 'no-active' };

  const { content, username, userId, isBot } = extractMessage(payload);
  if (!content) return { ignored: true };
  if (isBot && !ALLOW_BOTS) return { skipped: 'bot' };
  // ignore slash-like
  if (content.startsWith('/')) return { ignored: true };

  const active = state.active;
  const ok =
    answersMatch(content, active.correct) || letterMatch(content, active);

  if (!ok) return { ignored: true, reason: 'wrong' };

  const correct = active.correct;
  state.active = null;
  recordWin(username, userId);
  saveState();
  await postToHaven(
    `🎉 **${username}** got it! Answer: **${correct}**\n(_${state.wins[userId != null ? `id:${userId}` : `name:${String(username).toLowerCase()}`].wins} win(s)_)`.slice(
      0,
      4000
    )
  );
  return { ok: true, winner: username };
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'trivia') return { ignored: true };

  const args = String(payload.args || '').trim();
  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || 'start').toLowerCase();

  await expireIfNeeded();

  if (sub === 'start' || sub === 'new' || sub === 'play') {
    try {
      const active = await startRound();
      await postToHaven(formatQuestion(active));
    } catch (err) {
      await postToHaven(`❌ ${err.message}`);
    }
    return;
  }

  if (sub === 'skip' || sub === 'reveal') {
    if (!state.active) {
      await postToHaven('No active trivia question.');
      return;
    }
    const correct = state.active.correct;
    state.active = null;
    saveState();
    await postToHaven(`⏭️ Skipped. The answer was **${correct}**.`);
    return;
  }

  if (sub === 'stop' || sub === 'cancel' || sub === 'end') {
    if (!state.active) {
      await postToHaven('No active trivia question.');
      return;
    }
    state.active = null;
    saveState();
    await postToHaven('🛑 Trivia round cancelled (answer hidden).');
    return;
  }

  if (sub === 'status' || sub === 'show') {
    if (!state.active) {
      await postToHaven('No active trivia question. Start with `/trivia start`.');
      return;
    }
    await postToHaven(formatQuestion(state.active));
    return;
  }

  if (sub === 'scores' || sub === 'score' || sub === 'leaderboard' || sub === 'top') {
    await postToHaven(scoresText());
    return;
  }

  if (sub === 'help') {
    await postToHaven(
      'Usage: `/trivia start` · `/trivia skip` · `/trivia stop` · `/trivia status` · `/trivia scores`'
    );
    return;
  }

  // default: start
  try {
    const active = await startRound();
    await postToHaven(formatQuestion(active));
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `trivia bot running. active=${!!state.active} wins=${Object.keys(state.wins).length}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    active: !!state.active,
    wins: Object.keys(state.wins).length,
    timeoutSec: TIMEOUT_SEC,
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
      await postToHaven('✅ Trivia bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  const event = String(payload.event || '').toLowerCase();

  if (event === 'slash_command') {
    try {
      const result = await handleSlash(payload);
      if (result && result.ignored) return res.json({ ignored: true });
      return res.json({ ok: true });
    } catch (err) {
      console.error('slash handler error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (event === 'message' || event === 'message_create' || event === 'message-created') {
    try {
      const result = await handleMessage(payload);
      return res.json(result || { ok: true });
    } catch (err) {
      console.error('message handler error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.json({ ignored: true });
});

app.listen(PORT, async () => {
  console.log(`trivia bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
  if (TIMEOUT_SEC > 0) {
    setInterval(() => {
      expireIfNeeded().catch((e) => console.error('expire:', e.message));
    }, 15_000);
  }
});
