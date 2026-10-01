// color — Haven community bot
//
// /color #RRGGBB (or rgb/hsl) — show RGB/HSL breakdown as text.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
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
    { command: 'color', description: 'Color breakdown: /color #RRGGBB' },
    { command: 'colour', description: 'Alias for /color' },
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

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(raw) {
  let s = String(raw || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (/^[0-9a-f]{6}$/i.test(s)) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
      source: `#${s.toUpperCase()}`,
    };
  }
  if (/^[0-9a-f]{8}$/i.test(s)) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
      a: parseInt(s.slice(6, 8), 16) / 255,
      source: `#${s.toUpperCase()}`,
    };
  }
  return null;
}

function parseRgb(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/i);
  if (!m) {
    m = s.match(/^([0-9]{1,3})\s*[, ]\s*([0-9]{1,3})\s*[, ]\s*([0-9]{1,3})$/);
  }
  if (!m) return null;
  const r = clampByte(+m[1]);
  const g = clampByte(+m[2]);
  const b = clampByte(+m[3]);
  let a;
  if (m[4] != null) {
    a = String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a > 1) a = a / 255;
  }
  return { r, g, b, a, source: `rgb(${r}, ${g}, ${b})` };
}

function parseColor(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('#') || /^[0-9a-f]{3,8}$/i.test(s)) return parseHex(s);
  if (/^rgba?\(/i.test(s) || /^\d+\s*[, ]\s*\d+/.test(s)) return parseRgb(s);
  // named? skip — only hex/rgb
  if (!s.startsWith('#')) {
    const hex = parseHex(s);
    if (hex) return hex;
  }
  return null;
}

function rgbToHsl(r, g, b) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case R:
        h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
        break;
      case G:
        h = ((B - R) / d + 2) / 6;
        break;
      default:
        h = ((R - G) / d + 4) / 6;
        break;
    }
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 1000) / 10,
    l: Math.round(l * 1000) / 10,
  };
}

function rgbToHsv(r, g, b) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    switch (max) {
      case R:
        h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
        break;
      case G:
        h = ((B - R) / d + 2) / 6;
        break;
      default:
        h = ((R - G) / d + 4) / 6;
        break;
    }
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 1000) / 10,
    v: Math.round(v * 1000) / 10,
  };
}

function toHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((n) => clampByte(n).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function relativeLuminance(r, g, b) {
  const lin = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(l1, l2) {
  const a = Math.max(l1, l2);
  const b = Math.min(l1, l2);
  return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
}

function formatColor(c) {
  const hex = toHex(c.r, c.g, c.b);
  const hsl = rgbToHsl(c.r, c.g, c.b);
  const hsv = rgbToHsv(c.r, c.g, c.b);
  const lum = relativeLuminance(c.r, c.g, c.b);
  const onWhite = contrastRatio(lum, 1);
  const onBlack = contrastRatio(lum, 0);
  const lines = [
    `🎨 **Color** ${hex}`,
    `**RGB:** \`${c.r}, ${c.g}, ${c.b}\` · \`rgb(${c.r}, ${c.g}, ${c.b})\``,
    `**HSL:** \`${hsl.h}°, ${hsl.s}%, ${hsl.l}%\` · \`hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)\``,
    `**HSV:** \`${hsv.h}°, ${hsv.s}%, ${hsv.v}%\``,
    `**Decimal:** \`${(c.r << 16) | (c.g << 8) | c.b}\``,
  ];
  if (c.a != null && Number.isFinite(c.a)) {
    lines.push(`**Alpha:** \`${Math.round(c.a * 1000) / 1000}\``);
  }
  lines.push(
    `**Contrast:** vs white **${onWhite}:1** · vs black **${onBlack}:1**`,
    `**Luminance:** \`${Math.round(lum * 1000) / 1000}\``
  );
  // Text swatch (unicode blocks) — no image API needed
  lines.push('');
  lines.push(`\`${hex}\` ████  (preview depends on client font color support)`);
  return lines.join('\n').slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'color' && command !== 'colour') return { ignored: true };

  const args = String(payload.args || '').trim();
  if (!args || args.toLowerCase() === 'help') {
    await postToHaven(
      'Usage: `/color #RRGGBB` · `/color rgb(255, 128, 0)` · `/color 255 128 0`'
    );
    return;
  }

  const c = parseColor(args);
  if (!c) {
    await postToHaven(
      '❌ Could not parse color. Try `#1A2B3C`, `#abc`, or `rgb(26, 43, 60)`.'
    );
    return;
  }

  await postToHaven(formatColor(c));
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send('color bot running. POST slash to /haven');
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
      await postToHaven('✅ Color bot received a test event.');
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
  console.log(`color bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
