// rss — Haven community bot
//
// Polls RSS/Atom feeds and posts new items into a Haven channel via the
// bot webhook API. Optional /rss slash commands manage the feed list.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const POLL_INTERVAL_SEC = Math.max(60, parseInt(process.env.POLL_INTERVAL_SEC || '300', 10) || 300);
const MAX_ITEMS_PER_FEED = Math.max(1, parseInt(process.env.MAX_ITEMS_PER_FEED || '3', 10) || 3);
const BODY_MAX_CHARS = Math.max(0, parseInt(process.env.BODY_MAX_CHARS || '400', 10) || 400);
const STATE_FILE = process.env.STATE_FILE || './data/rss-state.json';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL) {
  console.error('FATAL: HAVEN_WEBHOOK_URL is required.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      feeds: Array.isArray(j.feeds) ? j.feeds : [],
      seen: j.seen && typeof j.seen === 'object' ? j.seen : {},
    };
  } catch {
    return { feeds: [], seen: {} };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();
const seed = (process.env.FEED_URLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
for (const url of seed) {
  if (!state.feeds.includes(url)) state.feeds.push(url);
}
saveState(state);

function stripTags(html) {
  return String(html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tagContent(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`, 'i');
  const m = block.match(re);
  return m ? stripTags(m[1] || m[2] || '') : '';
}

function attrHref(block) {
  const m = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i)
    || block.match(/<link[^>]*>([^<]+)<\/link>/i);
  if (!m) return '';
  return stripTags(m[1] || '');
}

function parseFeed(xml, feedUrl) {
  const items = [];
  const chunks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of chunks) {
    const title = tagContent(block, 'title') || 'Untitled';
    let link = tagContent(block, 'link') || attrHref(block);
    if (!link) {
      const id = tagContent(block, 'id') || tagContent(block, 'guid');
      if (id && /^https?:\/\//i.test(id)) link = id;
    }
    const guid = tagContent(block, 'guid') || tagContent(block, 'id') || link || title;
    let summary = tagContent(block, 'description') || tagContent(block, 'summary') || tagContent(block, 'content');
    if (BODY_MAX_CHARS > 0 && summary.length > BODY_MAX_CHARS) {
      summary = summary.slice(0, BODY_MAX_CHARS).trimEnd() + '…';
    }
    items.push({ title, link, guid, summary, feedUrl });
  }
  return items;
}

function feedTitle(xml, feedUrl) {
  const m = xml.match(/<title[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i);
  return m ? stripTags(m[1] || m[2] || '') : feedUrl;
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

function buildMessage(item, title) {
  const lines = [`📰 **${title}** — ${item.title}`];
  if (item.link) lines.push(item.link);
  if (item.summary) {
    lines.push('');
    lines.push(item.summary);
  }
  return lines.join('\n').slice(0, 4000);
}

async function pollFeed(feedUrl) {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'haven-bot-rss/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`fetch ${feedUrl} → ${res.status}`);
  const xml = await res.text();
  const title = feedTitle(xml, feedUrl);
  const items = parseFeed(xml, feedUrl);
  if (!state.seen[feedUrl]) state.seen[feedUrl] = [];
  const seen = new Set(state.seen[feedUrl]);
  const isFirst = seen.size === 0;
  const fresh = [];
  for (const item of items) {
    if (!item.guid || seen.has(item.guid)) continue;
    fresh.push(item);
  }
  if (isFirst) {
    for (const item of items) {
      if (item.guid) seen.add(item.guid);
    }
    state.seen[feedUrl] = [...seen].slice(0, 500);
    saveState(state);
    console.log(`[${new Date().toISOString()}] primed ${feedUrl} (${items.length} items, no posts)`);
    return;
  }
  const toPost = fresh.slice(0, MAX_ITEMS_PER_FEED).reverse();
  for (const item of toPost) {
    await postToHaven(buildMessage(item, title));
    seen.add(item.guid);
    console.log(`[${new Date().toISOString()}] posted: ${item.title}`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  for (const item of fresh) {
    if (item.guid) seen.add(item.guid);
  }
  state.seen[feedUrl] = [...seen].slice(-500);
  saveState(state);
}

async function pollAll() {
  for (const feed of [...state.feeds]) {
    try {
      await pollFeed(feed);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] poll failed ${feed}:`, err.message);
    }
  }
}

function verifySignature(rawBody, headerValue) {
  if (!CALLBACK_SECRET || !headerValue) return !CALLBACK_SECRET;
  const provided = headerValue.startsWith('sha256=') ? headerValue.slice(7) : headerValue;
  const expected = crypto.createHmac('sha256', CALLBACK_SECRET).update(rawBody).digest('hex');
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

async function registerCommands() {
  if (!HAVEN_WEBHOOK_TOKEN) return;
  const base = HAVEN_WEBHOOK_URL.replace(/\/api\/webhooks\/[^/]+\/?$/, '') || '';
  const tokenFromUrl = (HAVEN_WEBHOOK_URL.match(/\/api\/webhooks\/([a-f0-9]{64})/i) || [])[1];
  const token = HAVEN_WEBHOOK_TOKEN || tokenFromUrl;
  if (!token) return;
  const url = `${new URL(HAVEN_WEBHOOK_URL).origin}/api/webhooks/${token}/commands`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'rss',
      description: 'Manage RSS/Atom feeds for this channel',
      subcommands: [
        { name: 'add', description: 'Add a feed URL' },
        { name: 'remove', description: 'Remove a feed URL' },
        { name: 'list', description: 'List watched feeds' },
        { name: 'poll', description: 'Poll all feeds now' },
      ],
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /rss');
  }
  void base;
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`rss bot running. feeds=${state.feeds.length} poll=${POLL_INTERVAL_SEC}s`);
});
app.get('/health', (_req, res) => res.json({ ok: true, feeds: state.feeds.length }));

app.post('/haven', async (req, res) => {
  const raw = req.body;
  const sig = req.get('X-Haven-Signature') || '';
  if (CALLBACK_SECRET && !verifySignature(raw, sig)) {
    return res.status(401).json({ error: 'invalid signature' });
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || ''));
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }
  if (payload.event !== 'slash_command' || payload.command !== 'rss') {
    return res.json({ ignored: true });
  }
  const args = String(payload.args || '').trim();
  const [sub, ...rest] = args.split(/\s+/);
  const arg = rest.join(' ').trim();
  try {
    if (sub === 'add' && arg) {
      if (!state.feeds.includes(arg)) {
        state.feeds.push(arg);
        saveState(state);
      }
      await postToHaven(`✅ Watching feed: ${arg}`);
      return res.json({ ok: true });
    }
    if (sub === 'remove' && arg) {
      state.feeds = state.feeds.filter((f) => f !== arg);
      delete state.seen[arg];
      saveState(state);
      await postToHaven(`🗑️ Removed feed: ${arg}`);
      return res.json({ ok: true });
    }
    if (sub === 'list') {
      const body = state.feeds.length
        ? state.feeds.map((f, i) => `${i + 1}. ${f}`).join('\n')
        : '_No feeds configured._';
      await postToHaven(`📋 **RSS feeds**\n${body}`);
      return res.json({ ok: true });
    }
    if (sub === 'poll') {
      await postToHaven('🔄 Polling feeds…');
      pollAll().catch(() => {});
      return res.json({ ok: true });
    }
    await postToHaven('Usage: `/rss add <url>` · `/rss remove <url>` · `/rss list` · `/rss poll`');
    res.json({ ok: true });
  } catch (err) {
    console.error('slash handler error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  console.log(`rss bot listening on :${PORT}`);
  console.log(`  feeds: ${state.feeds.length}, poll every ${POLL_INTERVAL_SEC}s`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
  pollAll().catch(() => {});
  setInterval(() => pollAll().catch(() => {}), POLL_INTERVAL_SEC * 1000);
});
