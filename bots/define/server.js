// define — Haven community bot
//
// Slash /define <word> via Free Dictionary API (api.dictionaryapi.dev).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const MAX_MEANINGS = Math.max(1, parseInt(process.env.MAX_MEANINGS || '3', 10) || 3);
const MAX_DEFS = Math.max(1, parseInt(process.env.MAX_DEFS || '2', 10) || 2);
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);
const DICT_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'define',
      description: 'Define a word: /define <word>',
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /define');
  }
}

function cleanWord(raw) {
  return String(raw || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z'-]/g, '')
    .slice(0, 64);
}

async function fetchDefinition(word) {
  const url = `${DICT_BASE}/${encodeURIComponent(word)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'haven-bot-define/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Dictionary API error: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  return data[0];
}

function formatEntry(entry, word) {
  const lines = [`📖 **${entry.word || word}**`];
  const phonetics = (entry.phonetics || [])
    .map((p) => p.text)
    .filter(Boolean);
  if (entry.phonetic) phonetics.unshift(entry.phonetic);
  const uniquePh = [...new Set(phonetics)].slice(0, 2);
  if (uniquePh.length) lines.push(`_${uniquePh.join(' · ')}_`);

  const meanings = (entry.meanings || []).slice(0, MAX_MEANINGS);
  if (!meanings.length) {
    lines.push('_No definitions found._');
    return lines.join('\n').slice(0, 4000);
  }

  for (const m of meanings) {
    const pos = m.partOfSpeech || 'unknown';
    lines.push('');
    lines.push(`**${pos}**`);
    const defs = (m.definitions || []).slice(0, MAX_DEFS);
    defs.forEach((d, i) => {
      lines.push(`${i + 1}. ${String(d.definition || '').slice(0, 400)}`);
      if (d.example) lines.push(`   _e.g._ ${String(d.example).slice(0, 200)}`);
    });
  }

  return lines.join('\n').slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'define') return { ignored: true };

  const args = String(payload.args || '').trim();
  const word = cleanWord(args);
  if (!word) {
    await postToHaven('Usage: `/define <word>`');
    return;
  }

  try {
    const entry = await fetchDefinition(word);
    if (!entry) {
      await postToHaven(`No definition found for **${word}**.`);
      return;
    }
    await postToHaven(formatEntry(entry, word));
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send('define bot running. POST slash to /haven');
});
app.get('/health', (_req, res) => res.json({ ok: true }));

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
      await postToHaven('✅ Define bot received a test event.');
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
  console.log(`define bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
