// joke — Haven community bot
//
// Slash /joke — fetch a random joke from icanhazdadjoke (default)
// or Official Joke API (programming / general).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const JOKE_SOURCE = String(process.env.JOKE_SOURCE || 'dadjoke').toLowerCase();
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);
const DADJOKE_URL = 'https://icanhazdadjoke.com/';
const OFFICIAL_RANDOM = 'https://official-joke-api.appspot.com/random_joke';
const OFFICIAL_PROGRAMMING =
  'https://official-joke-api.appspot.com/jokes/programming/random';

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

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
    { command: 'joke', description: 'Tell a random joke: /joke [dad|programming|any]' },
    { command: 'dadjoke', description: 'Dad joke only' },
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

function resolveKind(args, forceDad) {
  if (forceDad) return 'dad';
  const a = String(args || '').trim().toLowerCase();
  if (!a) {
    if (JOKE_SOURCE === 'programming' || JOKE_SOURCE === 'official') return 'any';
    return 'dad';
  }
  if (a === 'dad' || a === 'dadjoke' || a === 'dad-joke') return 'dad';
  if (a === 'programming' || a === 'code' || a === 'dev') return 'programming';
  if (a === 'any' || a === 'random' || a === 'general' || a === 'official') return 'any';
  return 'dad';
}

async function fetchDadJoke() {
  const res = await fetch(DADJOKE_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'haven-community-joke-bot (https://github.com/Amnibro/haven-community)',
    },
  });
  if (!res.ok) throw new Error(`icanhazdadjoke HTTP ${res.status}`);
  const data = await res.json();
  const joke = String(data.joke || '').trim();
  if (!joke) throw new Error('Empty joke from icanhazdadjoke');
  return { kind: 'Dad joke', text: joke, source: 'icanhazdadjoke.com' };
}

async function fetchOfficial(kind) {
  const url = kind === 'programming' ? OFFICIAL_PROGRAMMING : OFFICIAL_RANDOM;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'haven-community-joke-bot (https://github.com/Amnibro/haven-community)',
    },
  });
  if (!res.ok) throw new Error(`Official Joke API HTTP ${res.status}`);
  let data = await res.json();
  // programming endpoint returns an array
  if (Array.isArray(data)) data = data[0] || {};
  const setup = String(data.setup || '').trim();
  const punchline = String(data.punchline || '').trim();
  if (!setup && !punchline) throw new Error('Empty joke from Official Joke API');
  const text = punchline ? `${setup}\n\n||${punchline}||` : setup;
  const type = data.type || kind;
  return {
    kind: type === 'programming' ? 'Programming joke' : 'Joke',
    text,
    source: 'official-joke-api',
  };
}

async function getJoke(kind) {
  if (kind === 'dad') return fetchDadJoke();
  try {
    return await fetchOfficial(kind === 'programming' ? 'programming' : 'any');
  } catch (err) {
    // Fallback to dad jokes if official API is down
    console.warn('[joke] official API failed, falling back to dadjoke:', err.message);
    return fetchDadJoke();
  }
}

function formatJoke(joke) {
  return `😄 **${joke.kind}**\n${joke.text}\n\n_via ${joke.source}_`.slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'joke' && command !== 'dadjoke') return { ignored: true };

  const args = String(payload.args || '').trim();
  const kind = resolveKind(args, command === 'dadjoke');

  try {
    const joke = await getJoke(kind);
    await postToHaven(formatJoke(joke));
  } catch (err) {
    await postToHaven(`❌ Could not fetch a joke: ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`joke bot running. defaultSource=${JOKE_SOURCE}`);
});
app.get('/health', (_req, res) => res.json({ ok: true, source: JOKE_SOURCE }));

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
      await postToHaven('✅ Joke bot received a test event.');
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
  console.log(`joke bot listening on :${PORT} (source=${JOKE_SOURCE})`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
