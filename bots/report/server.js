// report — Haven community bot
//
// /report <text> posts to REPORT_WEBHOOK_URL (or HAVEN_WEBHOOK_URL channel)
// with reporter id, or anonymously if ANONYMOUS=true.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const REPORT_WEBHOOK_URL = (process.env.REPORT_WEBHOOK_URL || '').trim() || HAVEN_WEBHOOK_URL;
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || 'Report Bot';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const ANONYMOUS = String(process.env.ANONYMOUS || 'false').toLowerCase() === 'true';
const ACK_PUBLIC = String(process.env.ACK_PUBLIC || 'true').toLowerCase() !== 'false';
const MAX_LENGTH = Math.max(1, parseInt(process.env.MAX_LENGTH || '1500', 10) || 1500);
const COOLDOWN_SEC = Math.max(0, parseInt(process.env.COOLDOWN_SEC || '60', 10) || 60);
const PREFIX = process.env.PREFIX || '🚨 **User report**';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}
if (!REPORT_WEBHOOK_URL) {
  console.error('FATAL: REPORT_WEBHOOK_URL or HAVEN_WEBHOOK_URL is required for posting reports.');
  process.exit(1);
}

const cooldowns = new Map();

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

function actorKey(user) {
  if (user && user.id != null && user.id !== '') return `id:${user.id}`;
  const name = (user && (user.username || user.displayName)) || '';
  return name ? `name:${String(name).toLowerCase()}` : 'anon';
}

async function postWebhook(url, content, username) {
  const body = { content };
  if (username) body.username = username;
  else if (HAVEN_USERNAME) body.username = HAVEN_USERNAME;
  if (HAVEN_AVATAR_URL) body.avatar_url = HAVEN_AVATAR_URL;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Webhook responded ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function postToChannel(content) {
  return postWebhook(HAVEN_WEBHOOK_URL, content, HAVEN_USERNAME);
}

async function postReport(content) {
  return postWebhook(REPORT_WEBHOOK_URL, content, HAVEN_USERNAME);
}

async function registerCommands() {
  const token = webhookToken();
  if (!token) return;
  const url = `${new URL(HAVEN_WEBHOOK_URL).origin}/api/webhooks/${token}/commands`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'report',
      description: 'Send a report to staff: /report <text>',
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status}`);
  } else {
    console.log('[commands] registered /report');
  }
}

function checkCooldown(key) {
  if (COOLDOWN_SEC <= 0) return null;
  const last = cooldowns.get(key) || 0;
  const now = Date.now();
  const wait = COOLDOWN_SEC * 1000 - (now - last);
  if (wait > 0) return Math.ceil(wait / 1000);
  cooldowns.set(key, now);
  return null;
}

function formatReport(text, user) {
  const lines = [PREFIX, '', text];
  if (!ANONYMOUS) {
    const name = (user && (user.username || user.displayName)) || 'unknown';
    const id = user && user.id != null ? String(user.id) : 'n/a';
    lines.push('');
    lines.push(`_Reporter: **${name}** · id \`${id}\`_`);
  } else {
    lines.push('');
    lines.push('_Reporter: anonymous_');
  }
  lines.push(`_At ${new Date().toISOString()}_`);
  return lines.join('\n').slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'report') return { ignored: true };

  const text = String(payload.args || '').trim().slice(0, MAX_LENGTH);
  const user = payload.user || {};

  if (!text) {
    await postToChannel(
      ANONYMOUS
        ? 'Usage: `/report <text>` — your identity is **hidden** from staff posts.'
        : 'Usage: `/report <text>` — staff will see your user id.'
    );
    return;
  }

  const key = actorKey(user);
  const wait = checkCooldown(key);
  if (wait != null) {
    await postToChannel(`⏳ Please wait **${wait}s** before another report.`);
    return;
  }

  try {
    await postReport(formatReport(text, user));
    if (ACK_PUBLIC) {
      await postToChannel('✅ Report submitted to staff. Thank you.');
    }
  } catch (err) {
    await postToChannel(`❌ Could not submit report: ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `report bot running. anonymous=${ANONYMOUS} separateWebhook=${REPORT_WEBHOOK_URL !== HAVEN_WEBHOOK_URL}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    anonymous: ANONYMOUS,
    separateReportWebhook: REPORT_WEBHOOK_URL !== HAVEN_WEBHOOK_URL,
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
      await postToChannel('✅ Report bot received a test event.');
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
  console.log(`report bot listening on :${PORT} (anonymous=${ANONYMOUS})`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
