// urbandict — Haven community bot
//
// /ud <term> via Urban Dictionary public API.
// Content is often NSFW — README warns operators.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const MAX_RESULTS = Math.max(1, Math.min(5, parseInt(process.env.MAX_RESULTS || '1', 10) || 1));
const DEF_MAX_CHARS = Math.max(100, parseInt(process.env.DEF_MAX_CHARS || '800', 10) || 800);
const NSFW_BANNER = String(process.env.NSFW_BANNER || 'true').toLowerCase() !== 'false';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);
const UD_API = 'https://api.urbandictionary.com/v0/define';

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
    { command: 'ud', description: 'Urban Dictionary lookup (often NSFW)' },
    { command: 'urban', description: 'Alias for /ud' },
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

function cleanBrackets(s) {
  // Urban Dictionary uses [word] for links
  return String(s || '').replace(/\[|\]/g, '');
}

function truncate(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd() + '…';
}

async function fetchDefinitions(term) {
  const url = `${UD_API}?term=${encodeURIComponent(term)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'haven-bot-urbandict/1.0',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Urban Dictionary HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data.list) ? data.list : [];
  // Prefer higher thumbs_up
  return list
    .slice()
    .sort((a, b) => (b.thumbs_up || 0) - (a.thumbs_up || 0) || (b.thumbs_down || 0) - (a.thumbs_down || 0));
}

function formatEntry(entry, term, index, total) {
  const word = cleanBrackets(entry.word || term);
  const def = truncate(cleanBrackets(entry.definition || ''), DEF_MAX_CHARS);
  const example = truncate(cleanBrackets(entry.example || ''), Math.min(400, DEF_MAX_CHARS));
  const up = entry.thumbs_up || 0;
  const down = entry.thumbs_down || 0;
  const link =
    entry.permalink ||
    `https://www.urbandictionary.com/define.php?term=${encodeURIComponent(word)}`;

  const lines = [];
  if (index === 0 && NSFW_BANNER) {
    lines.push('⚠️ _Urban Dictionary results are often NSFW / unmoderated._');
    lines.push('');
  }
  const head =
    total > 1 ? `📖 **${word}** (${index + 1}/${total})` : `📖 **${word}**`;
  lines.push(head);
  lines.push(def);
  if (example) {
    lines.push('');
    lines.push(`_Example:_ ${example}`);
  }
  lines.push('');
  lines.push(`👍 ${up} · 👎 ${down}`);
  lines.push(link);
  return lines.join('\n').slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'ud' && command !== 'urban') return { ignored: true };

  const term = String(payload.args || '').trim().slice(0, 100);
  if (!term) {
    await postToHaven(
      'Usage: `/ud <term>` — ⚠️ results are often NSFW. Not for all-ages channels.'
    );
    return;
  }

  try {
    const list = await fetchDefinitions(term);
    if (!list.length) {
      await postToHaven(`No Urban Dictionary results for **${term}**.`);
      return;
    }
    const pick = list.slice(0, MAX_RESULTS);
    // Post top result (or a few concatenated carefully under limit)
    if (pick.length === 1) {
      await postToHaven(formatEntry(pick[0], term, 0, 1));
    } else {
      const chunks = pick.map((e, i) => formatEntry(e, term, i, pick.length));
      let combined = chunks[0];
      for (let i = 1; i < chunks.length; i++) {
        const next = `${combined}\n\n---\n\n${chunks[i]}`;
        if (next.length > 3900) break;
        combined = next;
      }
      await postToHaven(combined.slice(0, 4000));
    }
  } catch (err) {
    await postToHaven(`❌ Urban Dictionary: ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`urbandict bot running. maxResults=${MAX_RESULTS}`);
});
app.get('/health', (_req, res) =>
  res.json({ ok: true, maxResults: MAX_RESULTS, nsfwBanner: NSFW_BANNER })
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
      await postToHaven('✅ Urban Dictionary bot received a test event.');
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
  console.log(`urbandict bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
