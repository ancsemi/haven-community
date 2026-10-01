// report — Haven community bot
//
// /report <text> posts to REPORT_WEBHOOK_URL (a staff-only channel) with the
// reporter's id, or anonymously if ANONYMOUS=true. Replies to the reporter are
// private (ephemeral). Without REPORT_WEBHOOK_URL the bot refuses reports
// rather than posting them in the public channel.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const REPORT_WEBHOOK_URL = (process.env.REPORT_WEBHOOK_URL || '').trim();
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || 'Report Bot';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const ANONYMOUS = String(process.env.ANONYMOUS || 'false').toLowerCase() === 'true';
// ACK_PUBLIC is the old name; the ack is now always private to the reporter.
const ACK = String(process.env.ACK ?? process.env.ACK_PUBLIC ?? 'true').toLowerCase() !== 'false';
const MAX_LENGTH = Math.max(1, parseInt(process.env.MAX_LENGTH || '1500', 10) || 1500);
const COOLDOWN_RAW = parseInt(process.env.COOLDOWN_SEC ?? '60', 10);
const COOLDOWN_SEC = Number.isInteger(COOLDOWN_RAW) && COOLDOWN_RAW >= 0 ? COOLDOWN_RAW : 60;
const PREFIX = process.env.PREFIX || '🚨 **User report**';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}
if (!REPORT_WEBHOOK_URL) {
  console.warn('WARNING: REPORT_WEBHOOK_URL is not set, so /report is refused. Point it at a bot in a staff-only channel.');
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

async function postWebhook(url, content, username, recipientId) {
  const body = { content };
  if (username) body.username = username;
  else if (HAVEN_USERNAME) body.username = HAVEN_USERNAME;
  if (HAVEN_AVATAR_URL) body.avatar_url = HAVEN_AVATAR_URL;
  // With a recipientId, Haven shows the message only to that one person.
  if (recipientId != null) {
    body.ephemeral = true;
    body.recipient_id = recipientId;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Webhook responded ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function postToChannel(content) {
  return postWebhook(HAVEN_WEBHOOK_URL, content, HAVEN_USERNAME);
}

// Private reply to the reporter. Never falls back to a public post.
async function replyTo(user, content) {
  if (!user || user.id == null) {
    console.warn('[report] no reporter id, private reply skipped');
    return;
  }
  return postWebhook(HAVEN_WEBHOOK_URL, content, HAVEN_USERNAME, user.id);
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
    signal: AbortSignal.timeout(10000),
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
  // Haven sends the caller as payload.author ({ id, username }).
  const user = payload.author || {};

  if (!REPORT_WEBHOOK_URL) {
    await replyTo(user, '❌ Reports are not set up on this server yet, so nothing was sent. Please contact a moderator directly.');
    return;
  }

  if (!text) {
    await replyTo(
      user,
      ANONYMOUS
        ? 'Usage: `/report <text>`. Your identity is **hidden** from staff posts.'
        : 'Usage: `/report <text>`. Staff will see your username and user id.'
    );
    return;
  }

  const key = actorKey(user);
  const wait = checkCooldown(key);
  if (wait != null) {
    await replyTo(user, `⏳ Please wait **${wait}s** before another report.`);
    return;
  }

  try {
    await postReport(formatReport(text, user));
    if (ACK) {
      await replyTo(user, '✅ Report submitted to staff. Thank you.');
    }
  } catch (err) {
    console.error('[report] could not submit:', err.message);
    await replyTo(user, '❌ Could not submit your report. Please try again later or contact a moderator directly.');
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `report bot running. anonymous=${ANONYMOUS} reportWebhookSet=${!!REPORT_WEBHOOK_URL}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    anonymous: ANONYMOUS,
    reportWebhookSet: !!REPORT_WEBHOOK_URL,
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
