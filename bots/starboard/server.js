// starboard — Haven community bot
//
// Listens for reaction-added events, tracks counts in STATE_FILE (payload may
// only include a single reaction), and posts to a starboard webhook when the
// STAR_EMOJI threshold is met.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL || '';
const STARBOARD_WEBHOOK_URL = (process.env.STARBOARD_WEBHOOK_URL || '').trim();
const POST_URL = STARBOARD_WEBHOOK_URL || HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const STAR_EMOJI = process.env.STAR_EMOJI || '⭐';
const THRESHOLD = Math.max(1, parseInt(process.env.THRESHOLD || '3', 10) || 3);
const REPOST_ON_INCREMENT = String(process.env.REPOST_ON_INCREMENT || 'false').toLowerCase() === 'true';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const STATE_FILE = process.env.STATE_FILE || './data/starboard-state.json';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!POST_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL (or STARBOARD_WEBHOOK_URL) and CALLBACK_SECRET are required.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      // key: `${messageId}::${emoji}` → { count, reactors: string[], postedAtCount, content, lastAuthor }
      entries: j.entries && typeof j.entries === 'object' ? j.entries : {},
    };
  } catch {
    return { entries: {} };
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

function emojiMatch(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

function entryKey(messageId, emoji) {
  return `${messageId}::${emoji}`;
}

async function postToStarboard(content) {
  const body = { content };
  if (HAVEN_USERNAME) body.username = HAVEN_USERNAME;
  if (HAVEN_AVATAR_URL) body.avatar_url = HAVEN_AVATAR_URL;
  const res = await fetch(POST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Haven responded ${res.status}: ${text.slice(0, 300)}`);
  }
}

function extractReaction(payload) {
  const messageId = payload.messageId
    ?? payload.message_id
    ?? (payload.message && (payload.message.id || payload.message.message_id))
    ?? null;
  const emoji = payload.emoji
    ?? (payload.reaction && payload.reaction.emoji)
    ?? '';
  const author = payload.author || payload.user || {};
  const authorName = author.username || author.displayName || author.display_name || 'someone';
  const authorId = author.id != null ? String(author.id) : null;
  const msg = payload.message || {};
  const content = msg.content || payload.content || payload.messageContent || '';
  const msgAuthor = msg.user || msg.author || payload.messageAuthor || null;
  return { messageId, emoji, authorName, authorId, content, msgAuthor };
}

function buildStarboardMessage(messageId, emoji, entry) {
  const lines = [];
  lines.push(`${emoji} **${entry.count}** | message \`#${messageId}\``);
  if (entry.lastAuthor) lines.push(`Last reaction by **${entry.lastAuthor}**`);
  if (entry.msgAuthor) lines.push(`Original author: **${entry.msgAuthor}**`);
  if (entry.content) {
    lines.push('');
    lines.push(String(entry.content).slice(0, 1500));
  }
  return lines.join('\n').slice(0, 4000);
}

async function handleReaction(payload) {
  const { messageId, emoji, authorName, authorId, content, msgAuthor } = extractReaction(payload);
  if (messageId == null || !emojiMatch(emoji, STAR_EMOJI)) {
    return { ignored: true, reason: 'emoji-or-id' };
  }

  const key = entryKey(messageId, STAR_EMOJI);
  if (!state.entries[key]) {
    state.entries[key] = {
      count: 0,
      reactors: [],
      postedAtCount: 0,
      content: '',
      lastAuthor: '',
      msgAuthor: '',
    };
  }
  const entry = state.entries[key];

  if (content && !entry.content) entry.content = String(content).slice(0, 2000);
  if (msgAuthor) {
    const name = msgAuthor.username || msgAuthor.displayName || msgAuthor.display_name || '';
    if (name) entry.msgAuthor = name;
  }
  entry.lastAuthor = authorName;

  if (authorId) {
    if (!entry.reactors.includes(authorId)) {
      entry.reactors.push(authorId);
      entry.count = entry.reactors.length;
    }
  } else {
    entry.count = (entry.count || 0) + 1;
  }

  saveState(state);

  const shouldPost = entry.count >= THRESHOLD && (
    entry.postedAtCount === 0
    || (REPOST_ON_INCREMENT && entry.count > entry.postedAtCount)
  );

  if (!shouldPost) {
    return { ok: true, count: entry.count, posted: false };
  }

  const text = buildStarboardMessage(messageId, STAR_EMOJI, entry);
  await postToStarboard(text);
  entry.postedAtCount = entry.count;
  saveState(state);
  console.log(`[${new Date().toISOString()}] starboard #${messageId} count=${entry.count}`);
  return { ok: true, count: entry.count, posted: true };
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `starboard bot running. emoji=${STAR_EMOJI} threshold=${THRESHOLD} entries=${Object.keys(state.entries).length}`
  );
});
app.get('/health', (_req, res) => res.json({
  ok: true,
  emoji: STAR_EMOJI,
  threshold: THRESHOLD,
  entries: Object.keys(state.entries).length,
}));

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
      await postToStarboard('✅ Starboard bot received a test event.');
      return res.json({ ok: true, test: true });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  if (event !== 'reaction-added' && event !== 'reaction_added') {
    return res.json({ ignored: `event=${event}` });
  }

  try {
    const result = await handleReaction(payload);
    res.json(result);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] handler error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`starboard bot listening on :${PORT}`);
  console.log(`  emoji=${STAR_EMOJI} threshold=${THRESHOLD} repost=${REPOST_ON_INCREMENT}`);
});
