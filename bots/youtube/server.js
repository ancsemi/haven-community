// youtube — Haven community bot
//
// Polls YouTube channel Atom feeds (no API key) and posts new uploads into a
// Haven channel via the bot webhook API. First poll primes seen IDs only.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CHANNEL_IDS = (process.env.CHANNEL_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const POLL_INTERVAL_SEC = Math.max(60, parseInt(process.env.POLL_INTERVAL_SEC || '300', 10) || 300);
const MAX_ITEMS_PER_CHANNEL = Math.max(1, parseInt(process.env.MAX_ITEMS_PER_CHANNEL || '3', 10) || 3);
const STATE_FILE = process.env.STATE_FILE || './data/youtube-state.json';
const UPLOAD_MESSAGE = process.env.UPLOAD_MESSAGE
  || '▶️ **{channel}** uploaded a video\n**{title}**\n{url}';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL) {
  console.error('FATAL: HAVEN_WEBHOOK_URL is required.');
  process.exit(1);
}
if (!CHANNEL_IDS.length) {
  console.error('FATAL: CHANNEL_IDS must list at least one YouTube channel id.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      seen: j.seen && typeof j.seen === 'object' ? j.seen : {},
    };
  } catch {
    return { seen: {} };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();

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

function feedUrl(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

function parseEntries(xml) {
  const items = [];
  const chunks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of chunks) {
    const title = tagContent(block, 'title') || 'Untitled';
    let link = attrHref(block) || tagContent(block, 'link');
    const videoId = tagContent(block, 'yt:videoId') || '';
    if (!link && videoId) link = `https://www.youtube.com/watch?v=${videoId}`;
    const id = tagContent(block, 'id') || videoId || link || title;
    const published = tagContent(block, 'published') || tagContent(block, 'updated') || '';
    const author = tagContent(block, 'name') || '';
    items.push({ title, link, id, videoId, published, author });
  }
  return items;
}

function channelTitle(xml, channelId) {
  // Prefer the feed-level title (first <title> before entries)
  const head = xml.split(/<entry[\s>]/i)[0] || xml;
  const m = head.match(/<title[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i);
  return m ? stripTags(m[1] || m[2] || '') : channelId;
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

function formatUpload(item, channelName) {
  return UPLOAD_MESSAGE
    .replaceAll('\\n', '\n')
    .replaceAll('{channel}', channelName || item.author || 'YouTube')
    .replaceAll('{title}', item.title || '')
    .replaceAll('{url}', item.link || '')
    .replaceAll('{published}', item.published || '')
    .slice(0, 4000);
}

async function pollChannel(channelId) {
  const url = feedUrl(channelId);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'haven-bot-youtube/1.0',
      Accept: 'application/atom+xml, application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`fetch ${channelId} → ${res.status}`);
  const xml = await res.text();
  const channelName = channelTitle(xml, channelId);
  const items = parseEntries(xml);

  if (!state.seen[channelId]) state.seen[channelId] = [];
  const seen = new Set(state.seen[channelId]);
  const isFirst = seen.size === 0;

  if (isFirst) {
    for (const item of items) {
      if (item.id) seen.add(item.id);
      if (item.videoId) seen.add(item.videoId);
    }
    state.seen[channelId] = [...seen].slice(0, 500);
    saveState(state);
    console.log(`[${new Date().toISOString()}] primed ${channelId} (${items.length} videos, no posts)`);
    return;
  }

  const fresh = [];
  for (const item of items) {
    const keys = [item.id, item.videoId].filter(Boolean);
    if (!keys.length) continue;
    if (keys.some((k) => seen.has(k))) continue;
    fresh.push(item);
  }

  const toPost = fresh.slice(0, MAX_ITEMS_PER_CHANNEL).reverse();
  for (const item of toPost) {
    await postToHaven(formatUpload(item, channelName));
    if (item.id) seen.add(item.id);
    if (item.videoId) seen.add(item.videoId);
    console.log(`[${new Date().toISOString()}] posted: ${item.title}`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  for (const item of fresh) {
    if (item.id) seen.add(item.id);
    if (item.videoId) seen.add(item.videoId);
  }
  state.seen[channelId] = [...seen].slice(-500);
  saveState(state);
}

async function pollAll() {
  for (const id of CHANNEL_IDS) {
    try {
      await pollChannel(id);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] poll failed ${id}:`, err.message);
    }
  }
}

const app = express();

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `youtube bot running. channels=${CHANNEL_IDS.length} poll=${POLL_INTERVAL_SEC}s`
  );
});
app.get('/health', (_req, res) => res.json({
  ok: true,
  channels: CHANNEL_IDS,
  pollIntervalSec: POLL_INTERVAL_SEC,
}));
app.post('/poll', async (_req, res) => {
  try {
    await pollAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`youtube bot listening on :${PORT}`);
  console.log(`  channels: ${CHANNEL_IDS.join(', ')}`);
  console.log(`  poll every ${POLL_INTERVAL_SEC}s`);
  pollAll().catch((e) => console.error('[poll]', e.message));
  setInterval(() => {
    pollAll().catch((e) => console.error('[poll]', e.message));
  }, POLL_INTERVAL_SEC * 1000);
});
