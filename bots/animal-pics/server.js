// animal-pics — Haven community bot
//
// Slash /cat and /dog — random animal image URLs from public endpoints
// (cataas, thecatapi without key, random.dog, place.dog).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const CAT_SOURCE = String(process.env.CAT_SOURCE || 'cataas').toLowerCase();
const DOG_SOURCE = String(process.env.DOG_SOURCE || 'random.dog').toLowerCase();
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

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
    { command: 'cat', description: 'Post a random cat picture' },
    { command: 'dog', description: 'Post a random dog picture' },
    { command: 'animal', description: 'Random cat or dog: /animal [cat|dog]' },
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

function isImageUrl(url) {
  const u = String(url || '').toLowerCase().split('?')[0];
  return /\.(jpe?g|png|gif|webp)$/.test(u);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'haven-community-animal-pics (https://github.com/Amnibro/haven-community)',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchCat() {
  // cataas: direct image URL with cache-bust
  if (CAT_SOURCE === 'thecatapi' || CAT_SOURCE === 'catapi') {
    try {
      const data = await fetchJson('https://api.thecatapi.com/v1/images/search');
      const url = Array.isArray(data) && data[0] && data[0].url;
      if (url) return { species: 'cat', url: String(url), source: 'thecatapi.com' };
    } catch (err) {
      console.warn('[cat] thecatapi failed:', err.message);
    }
  }

  // Default / fallback: cataas (no key)
  const bust = Date.now().toString(36);
  return {
    species: 'cat',
    url: `https://cataas.com/cat?${bust}`,
    source: 'cataas.com',
  };
}

async function fetchDog() {
  // random.dog JSON, skip video extensions
  if (DOG_SOURCE === 'place.dog' || DOG_SOURCE === 'placedog') {
    const w = 640 + (crypto.randomBytes(1)[0] % 100);
    const h = 480 + (crypto.randomBytes(1)[0] % 100);
    return {
      species: 'dog',
      url: `https://place.dog/${w}/${h}`,
      source: 'place.dog',
    };
  }

  // dog.ceo as alternate
  if (DOG_SOURCE === 'dog.ceo' || DOG_SOURCE === 'dogceo') {
    const data = await fetchJson('https://dog.ceo/api/breeds/image/random');
    if (data && data.status === 'success' && data.message) {
      return { species: 'dog', url: String(data.message), source: 'dog.ceo' };
    }
    throw new Error('dog.ceo returned no image');
  }

  // Default: random.dog — retry a few times to avoid mp4/webm
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      const data = await fetchJson('https://random.dog/woof.json');
      const url = data && data.url ? String(data.url) : '';
      if (url && isImageUrl(url)) {
        return { species: 'dog', url, source: 'random.dog' };
      }
      // video — try again
    } catch (err) {
      lastErr = err;
    }
  }

  // Fallback dog.ceo
  try {
    const data = await fetchJson('https://dog.ceo/api/breeds/image/random');
    if (data && data.message) {
      return { species: 'dog', url: String(data.message), source: 'dog.ceo' };
    }
  } catch (err) {
    lastErr = err;
  }

  throw lastErr || new Error('Could not get a dog image');
}

function formatAnimal(animal) {
  const emoji = animal.species === 'cat' ? '🐱' : '🐶';
  const label = animal.species === 'cat' ? 'Cat' : 'Dog';
  return `${emoji} **Random ${label}**\n${animal.url}\n\n_via ${animal.source}_`.slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'cat' && command !== 'dog' && command !== 'animal') {
    return { ignored: true };
  }

  let species = command;
  if (command === 'animal') {
    const arg = String(payload.args || '').trim().toLowerCase();
    if (arg === 'cat' || arg === 'kitten' || arg === 'kitty') species = 'cat';
    else if (arg === 'dog' || arg === 'puppy' || arg === 'pup') species = 'dog';
    else species = crypto.randomBytes(1)[0] % 2 === 0 ? 'cat' : 'dog';
  }

  try {
    const animal = species === 'cat' ? await fetchCat() : await fetchDog();
    await postToHaven(formatAnimal(animal));
  } catch (err) {
    await postToHaven(`❌ Could not fetch a ${species} pic: ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(`animal-pics bot running. cat=${CAT_SOURCE} dog=${DOG_SOURCE}`);
});
app.get('/health', (_req, res) =>
  res.json({ ok: true, catSource: CAT_SOURCE, dogSource: DOG_SOURCE })
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
      await postToHaven('✅ Animal-pics bot received a test event.');
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
  console.log(`animal-pics bot listening on :${PORT} (cat=${CAT_SOURCE} dog=${DOG_SOURCE})`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
