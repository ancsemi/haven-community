// translate — Haven community bot
//
// Slash /translate <lang> <text>. Uses LibreTranslate when LIBRETRANSLATE_URL
// is set; falls back to MyMemory free API.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const LIBRETRANSLATE_URL = (process.env.LIBRETRANSLATE_URL || '').trim().replace(/\/+$/, '');
const LIBRETRANSLATE_API_KEY = (process.env.LIBRETRANSLATE_API_KEY || '').trim();
const SOURCE_LANG = (process.env.SOURCE_LANG || 'auto').trim().toLowerCase() || 'auto';
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'translate',
      description: 'Translate text: /translate <lang> <text>',
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /translate');
  }
}

function normalizeLang(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c || c.length > 12) return null;
  if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(c) && c !== 'auto') return null;
  // MyMemory uses zh-CN style; accept simple codes
  const map = {
    jp: 'ja',
    jpn: 'ja',
    kr: 'ko',
    kor: 'ko',
    cn: 'zh-CN',
    zh: 'zh-CN',
    tw: 'zh-TW',
    iw: 'he',
    nb: 'no',
  };
  return map[c] || c;
}

async function translateLibre(text, target, source) {
  if (!LIBRETRANSLATE_URL) throw new Error('LibreTranslate not configured');
  const body = {
    q: text,
    source: source === 'auto' ? 'auto' : source,
    target: target.split('-')[0],
    format: 'text',
  };
  if (LIBRETRANSLATE_API_KEY) body.api_key = LIBRETRANSLATE_API_KEY;
  const res = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LibreTranslate ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const translated = json.translatedText || json.translation || '';
  if (!translated) throw new Error('LibreTranslate returned empty text');
  return {
    text: translated,
    detected: json.detectedLanguage && (json.detectedLanguage.language || json.detectedLanguage),
    engine: 'LibreTranslate',
  };
}

async function translateMyMemory(text, target, source) {
  const src = source === 'auto' ? 'en' : source;
  const tgt = target;
  const langpair = `${src}|${tgt}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'haven-bot-translate/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`MyMemory ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const translated = json.responseData && json.responseData.translatedText;
  if (!translated || json.responseStatus !== 200) {
    const detail = (json.responseDetails || json.responseData || json) + '';
    throw new Error(`MyMemory failed: ${String(detail).slice(0, 200)}`);
  }
  // MyMemory sometimes echoes MATCH warnings as the text
  if (String(translated).toUpperCase().includes('QUERY LENGTH LIMIT')) {
    throw new Error(translated);
  }
  return { text: translated, detected: src, engine: 'MyMemory' };
}

async function translate(text, targetLang) {
  const target = normalizeLang(targetLang);
  if (!target || target === 'auto') throw new Error('Target language required (e.g. es, fr, de, ja)');
  const source = normalizeLang(SOURCE_LANG) || 'auto';
  const clipped = String(text || '').slice(0, 1500);
  if (!clipped.trim()) throw new Error('Text is empty');

  if (LIBRETRANSLATE_URL) {
    try {
      return await translateLibre(clipped, target, source);
    } catch (err) {
      console.warn(`[libre] ${err.message} — falling back to MyMemory`);
    }
  }
  return translateMyMemory(clipped, target, source);
}

async function handleSlash(payload) {
  if (String(payload.command || '').toLowerCase() !== 'translate') return { ignored: true };
  const args = String(payload.args || '').trim();
  const m = args.match(/^(\S+)\s+([\s\S]+)$/);
  if (!m) {
    await postToHaven('Usage: `/translate <lang> <text>` (e.g. `/translate es Hello!`)');
    return;
  }
  const lang = m[1];
  const text = m[2].trim();
  try {
    const result = await translate(text, lang);
    const from = result.detected || SOURCE_LANG || '?';
    const to = normalizeLang(lang) || lang;
    await postToHaven(
      `🌐 **${from} → ${to}** _(${result.engine})_\n${result.text}`.slice(0, 4000)
    );
  } catch (err) {
    await postToHaven(`❌ Translation failed: ${err.message}`.slice(0, 1500));
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `translate bot running. libre=${LIBRETRANSLATE_URL || 'off'} fallback=MyMemory`
  );
});
app.get('/health', (_req, res) => res.json({
  ok: true,
  libretranslate: !!LIBRETRANSLATE_URL,
  sourceLang: SOURCE_LANG,
}));

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
      await postToHaven('✅ Translate bot received a test event.');
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
  console.log(`translate bot listening on :${PORT}`);
  console.log(`  LibreTranslate: ${LIBRETRANSLATE_URL || '(disabled — MyMemory only)'}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
