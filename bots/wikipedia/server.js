// wikipedia — Haven community bot
//
// Slash /wiki <query> via MediaWiki API (summary extract + link).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const WIKI_LANG = (process.env.WIKI_LANG || 'en').trim().toLowerCase().replace(/[^a-z-]/g, '') || 'en';
const EXTRACT_CHARS = Math.max(100, parseInt(process.env.EXTRACT_CHARS || '600', 10) || 600);
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);
const API_BASE = `https://${WIKI_LANG}.wikipedia.org/w/api.php`;
const PAGE_BASE = `https://${WIKI_LANG}.wikipedia.org/wiki/`;

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
    { command: 'wiki', description: 'Wikipedia summary: /wiki <query>' },
    { command: 'wikipedia', description: 'Alias for /wiki' },
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

async function wikiFetch(params) {
  const qs = new URLSearchParams({ format: 'json', origin: '*', ...params });
  const url = `${API_BASE}?${qs}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'haven-bot-wikipedia/1.0 (community; +https://github.com/ancsemi/haven-community)',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  return res.json();
}

async function searchTitle(query) {
  const data = await wikiFetch({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '1',
    srprop: '',
  });
  const hits = (data.query && data.query.search) || [];
  if (!hits.length) return null;
  return hits[0].title;
}

async function fetchExtract(title) {
  const data = await wikiFetch({
    action: 'query',
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    exchars: String(EXTRACT_CHARS),
    redirects: '1',
    inprop: 'url',
    titles: title,
  });
  const pages = (data.query && data.query.pages) || {};
  const page = Object.values(pages)[0];
  if (!page || page.missing != null) return null;
  return {
    title: page.title || title,
    extract: String(page.extract || '').trim(),
    url: page.fullurl || `${PAGE_BASE}${encodeURIComponent((page.title || title).replace(/ /g, '_'))}`,
  };
}

function formatPage(page) {
  let extract = page.extract || '_No summary available._';
  if (extract.length > EXTRACT_CHARS) {
    extract = extract.slice(0, EXTRACT_CHARS).trimEnd() + '…';
  }
  return `📚 **${page.title}**\n${extract}\n${page.url}`.slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'wiki' && command !== 'wikipedia') return { ignored: true };

  const query = String(payload.args || '').trim().slice(0, 200);
  if (!query) {
    await postToHaven('Usage: `/wiki <query>`');
    return;
  }

  try {
    const title = await searchTitle(query);
    if (!title) {
      await postToHaven(`No Wikipedia results for **${query}**.`);
      return;
    }
    const page = await fetchExtract(title);
    if (!page) {
      await postToHaven(`No page found for **${title}**.`);
      return;
    }
    await postToHaven(formatPage(page));
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`wikipedia bot running. lang=${WIKI_LANG}`);
});
app.get('/health', (_req, res) => res.json({ ok: true, lang: WIKI_LANG }));

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
      await postToHaven('✅ Wikipedia bot received a test event.');
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
  console.log(`wikipedia bot listening on :${PORT}`);
  console.log(`  lang=${WIKI_LANG} extractChars=${EXTRACT_CHARS}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
