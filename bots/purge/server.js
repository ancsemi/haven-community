// purge — Haven community bot
//
// Tracks recent message ids from message events (ring buffer). Slash
// /purge match <substring> deletes matching buffered messages via DELETE API.
// /purge last <n> is limited (deletes last n tracked messages).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const BUFFER_SIZE = Math.max(10, parseInt(process.env.BUFFER_SIZE || '200', 10) || 200);
const MAX_DELETE = Math.max(1, parseInt(process.env.MAX_DELETE || '25', 10) || 25);
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

/** @type {{ id: string|number, content: string, username: string, at: number }[]} */
const ring = [];

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

function originBase() {
  return new URL(HAVEN_WEBHOOK_URL).origin;
}

function isAllowed(user) {
  if (!ALLOWED_USER_IDS.length) return true;
  if (!user || user.id == null) return false;
  return ALLOWED_USER_IDS.some((id) => String(id) === String(user.id));
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

async function deleteMessage(messageId) {
  const token = webhookToken();
  if (!token || messageId == null) return false;
  const url = `${originBase()}/api/webhooks/${token}/messages/${messageId}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[delete] ${messageId} → ${res.status} ${text.slice(0, 200)}`);
    return false;
  }
  return true;
}

async function registerCommands() {
  const token = webhookToken();
  if (!token) return;
  const url = `${new URL(HAVEN_WEBHOOK_URL).origin}/api/webhooks/${token}/commands`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'purge',
      description: 'Delete recent messages: match <text> or last <n>',
      subcommands: [
        { name: 'match', description: 'Delete buffered messages containing substring' },
        { name: 'last', description: 'Delete last N buffered messages' },
        { name: 'status', description: 'Show buffer size' },
      ],
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /purge');
  }
}

function pushMessage(entry) {
  if (entry.id == null) return;
  // de-dupe by id
  const idx = ring.findIndex((e) => String(e.id) === String(entry.id));
  if (idx >= 0) ring.splice(idx, 1);
  ring.push(entry);
  while (ring.length > BUFFER_SIZE) ring.shift();
}

function extractMessage(payload) {
  const msg = payload.message || payload.data || payload;
  const content = String(msg.content || payload.content || '');
  const id = msg.id ?? msg.message_id ?? payload.message_id ?? payload.messageId ?? null;
  const user = msg.user || msg.author || payload.user || payload.author || {};
  const username = user.username || user.displayName || msg.username || '';
  const isBot = !!(user.is_bot || user.isBot || msg.is_bot || msg.webhook_id || msg.webhookId);
  return { content, id, username, isBot };
}

function removeFromRing(ids) {
  const set = new Set(ids.map(String));
  for (let i = ring.length - 1; i >= 0; i--) {
    if (set.has(String(ring[i].id))) ring.splice(i, 1);
  }
}

async function deleteMany(entries) {
  let ok = 0;
  let fail = 0;
  const deletedIds = [];
  for (const e of entries) {
    const success = await deleteMessage(e.id);
    if (success) {
      ok += 1;
      deletedIds.push(e.id);
    } else {
      fail += 1;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  removeFromRing(deletedIds);
  return { ok, fail };
}

async function handleMessage(payload) {
  const { content, id, username, isBot } = extractMessage(payload);
  if (id == null) return { skipped: 'no-id' };
  // Track bots too so spam from bots can be purged
  pushMessage({
    id,
    content: content.slice(0, 500),
    username: isBot ? `${username || 'bot'}(bot)` : username,
    at: Date.now(),
  });
  return { ok: true, buffered: ring.length };
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'purge') return { ignored: true };

  const user = payload.user || {};
  if (!isAllowed(user)) {
    await postToHaven('❌ You are not allowed to use `/purge`.');
    return;
  }

  const args = String(payload.args || '').trim();
  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (!sub || sub === 'help') {
    await postToHaven(
      'Usage: `/purge match <substring>` · `/purge last <n>` · `/purge status`\n' +
        `_Only messages seen by this bot since startup (buffer ${BUFFER_SIZE}) can be deleted._`
    );
    return;
  }

  if (sub === 'status') {
    await postToHaven(
      `🧹 **Purge buffer:** **${ring.length}** / ${BUFFER_SIZE} messages tracked. Max delete per command: **${MAX_DELETE}**.`
    );
    return;
  }

  if (sub === 'last') {
    const n = parseInt(parts[1], 10);
    if (!Number.isInteger(n) || n < 1) {
      await postToHaven('Usage: `/purge last <n>` — deletes the last N **tracked** messages.');
      return;
    }
    const count = Math.min(n, MAX_DELETE, ring.length);
    if (!count) {
      await postToHaven('Buffer empty — no tracked messages to delete yet.');
      return;
    }
    const slice = ring.slice(-count);
    const { ok, fail } = await deleteMany(slice);
    await postToHaven(
      `🧹 Deleted **${ok}** message(s)` +
        (fail ? `, **${fail}** failed` : '') +
        ` from last **${count}** tracked.`
    );
    return;
  }

  if (sub === 'match') {
    const needle = parts.slice(1).join(' ').trim();
    if (!needle) {
      await postToHaven('Usage: `/purge match <substring>`');
      return;
    }
    const lower = needle.toLowerCase();
    const matches = ring.filter((e) => String(e.content || '').toLowerCase().includes(lower));
    const toDelete = matches.slice(-MAX_DELETE);
    if (!toDelete.length) {
      await postToHaven(
        `No tracked messages matching \`${needle.slice(0, 80)}\` (buffer has ${ring.length}).`
      );
      return;
    }
    const { ok, fail } = await deleteMany(toDelete);
    await postToHaven(
      `🧹 Purged **${ok}** message(s) matching \`${needle.slice(0, 60)}\`` +
        (fail ? ` (**${fail}** failed)` : '') +
        (matches.length > MAX_DELETE ? ` _(capped at ${MAX_DELETE})_` : '') +
        '.'
    );
    return;
  }

  await postToHaven('Usage: `/purge match <substring>` · `/purge last <n>` · `/purge status`');
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(`purge bot running. buffer=${ring.length}/${BUFFER_SIZE} maxDelete=${MAX_DELETE}`);
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    buffer: ring.length,
    bufferSize: BUFFER_SIZE,
    maxDelete: MAX_DELETE,
  })
);

app.post('/haven', async (req, res) => {
  const raw = req.body;
  const sig = req.get('X-Haven-Signature') || '';
  const eventHeader = (req.get('X-Haven-Event') || '').toLowerCase();

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

  const event = (payload.event || eventHeader || '').toLowerCase();

  if (event === 'test') {
    try {
      await postToHaven('✅ Purge bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

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

  if (event === 'message' || event === 'message-created' || event === 'message_create') {
    try {
      const result = await handleMessage(payload);
      return res.json(result);
    } catch (err) {
      console.error('message handler error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.json({ ignored: `event=${event}` });
});

app.listen(PORT, async () => {
  console.log(`purge bot listening on :${PORT}`);
  console.log(
    `  buffer=${BUFFER_SIZE} maxDelete=${MAX_DELETE} allowlist=${ALLOWED_USER_IDS.length || 'any'}`
  );
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
