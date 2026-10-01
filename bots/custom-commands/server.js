// custom-commands — Haven community bot
//
// Slash /tag set|get|delete|list for user-defined canned responses.
// Optional message-event prefix triggers (e.g. !faq) when ENABLE_PREFIX=true.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const STATE_FILE = process.env.STATE_FILE || './data/custom-commands-state.json';
const MAX_TAGS = Math.max(1, parseInt(process.env.MAX_TAGS || '100', 10) || 100);
const MAX_TAG_LEN = Math.max(1, parseInt(process.env.MAX_TAG_LEN || '64', 10) || 64);
const MAX_RESPONSE_LEN = Math.max(1, parseInt(process.env.MAX_RESPONSE_LEN || '2000', 10) || 2000);
const ENABLE_PREFIX = String(process.env.ENABLE_PREFIX || 'true').toLowerCase() === 'true';
const PREFIX = process.env.PREFIX != null && process.env.PREFIX !== '' ? process.env.PREFIX : '!';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return { tags: j.tags && typeof j.tags === 'object' ? j.tags : {} };
  } catch {
    return { tags: {} };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();

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

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_TAG_LEN);
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
      command: 'tag',
      description: 'Manage canned response tags',
      subcommands: [
        { name: 'set', description: 'Create or update a tag' },
        { name: 'get', description: 'Post a tag response' },
        { name: 'delete', description: 'Delete a tag' },
        { name: 'list', description: 'List all tags' },
      ],
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /tag');
  }
}

function tagCount() {
  return Object.keys(state.tags).length;
}

async function handleTagSlash(args, user) {
  const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (sub === 'list' || !sub) {
    const names = Object.keys(state.tags).sort();
    if (!names.length) {
      await postToHaven('📋 **Tags**\n_No tags yet. Use `/tag set <name> <response>`._');
      return;
    }
    await postToHaven(`📋 **Tags** (${names.length})\n${names.map((n) => `• \`${n}\``).join('\n')}`.slice(0, 4000));
    return;
  }

  if (sub === 'get') {
    const name = normalizeName(parts[1]);
    if (!name || !state.tags[name]) {
      await postToHaven(name ? `No tag named \`${name}\`.` : 'Usage: `/tag get <name>`');
      return;
    }
    await postToHaven(String(state.tags[name].response).slice(0, 4000));
    return;
  }

  if (sub === 'delete') {
    const name = normalizeName(parts[1]);
    if (!name) {
      await postToHaven('Usage: `/tag delete <name>`');
      return;
    }
    if (!state.tags[name]) {
      await postToHaven(`No tag named \`${name}\`.`);
      return;
    }
    delete state.tags[name];
    saveState(state);
    await postToHaven(`🗑️ Deleted tag \`${name}\`.`);
    return;
  }

  if (sub === 'set') {
    const name = normalizeName(parts[1]);
    const response = parts.slice(2).join(' ').trim().slice(0, MAX_RESPONSE_LEN);
    if (!name || !response) {
      await postToHaven('Usage: `/tag set <name> <response>`');
      return;
    }
    if (!state.tags[name] && tagCount() >= MAX_TAGS) {
      await postToHaven(`❌ Too many tags (max ${MAX_TAGS}). Delete some first.`);
      return;
    }
    state.tags[name] = {
      response,
      updatedAt: Date.now(),
      updatedBy: user && (user.username || user.displayName) ? (user.username || user.displayName) : '',
      updatedById: user && user.id != null ? user.id : null,
    };
    saveState(state);
    await postToHaven(`✅ Tag \`${name}\` saved.`);
    return;
  }

  await postToHaven('Usage: `/tag set|get|delete|list`');
}

function extractMessage(payload) {
  const msg = payload.message || payload.data || payload;
  const content = String(msg.content || payload.content || '').trim();
  const user = msg.user || msg.author || payload.user || payload.author || {};
  const isBot = !!(user.is_bot || user.isBot || msg.is_bot || msg.webhook_id || msg.webhookId);
  return { content, isBot };
}

async function handlePrefixMessage(payload) {
  if (!ENABLE_PREFIX) return { skipped: 'prefix-off' };
  const { content, isBot } = extractMessage(payload);
  if (isBot || !content) return { skipped: 'empty-or-bot' };
  if (!content.startsWith(PREFIX)) return { match: false };
  const name = normalizeName(content.slice(PREFIX.length));
  if (!name || content.slice(PREFIX.length).includes(' ')) return { match: false };
  const tag = state.tags[name];
  if (!tag) return { match: false };
  await postToHaven(String(tag.response).slice(0, 4000));
  console.log(`[${new Date().toISOString()}] prefix tag=${name}`);
  return { ok: true, tag: name };
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `custom-commands bot running. tags=${tagCount()} prefix=${ENABLE_PREFIX ? PREFIX : 'off'}`
  );
});
app.get('/health', (_req, res) => res.json({ ok: true, tags: tagCount(), prefix: ENABLE_PREFIX }));

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
      await postToHaven('✅ Custom-commands bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  try {
    if (event === 'slash_command' && String(payload.command || '').toLowerCase() === 'tag') {
      await handleTagSlash(payload.args, payload.user || {});
      return res.json({ ok: true });
    }
    if (event === 'message' || event === 'message-created' || event === 'message_create') {
      const result = await handlePrefixMessage(payload);
      return res.json(result);
    }
    return res.json({ ignored: `event=${event}` });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] handler error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  console.log(`custom-commands bot listening on :${PORT}`);
  console.log(`  tags: ${tagCount()}, prefix: ${ENABLE_PREFIX ? JSON.stringify(PREFIX) : 'off'}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
