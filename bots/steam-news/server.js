// steam-news — Haven community bot
//
// Polls Steam news for APP_IDS and posts items with new gids to Haven.
// First poll primes seen gids only (no flood).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const APP_IDS = (process.env.APP_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const POLL_INTERVAL_SEC = Math.max(60, parseInt(process.env.POLL_INTERVAL_SEC || '300', 10) || 300);
const MAX_ITEMS_PER_APP = Math.max(1, parseInt(process.env.MAX_ITEMS_PER_APP || '3', 10) || 3);
const NEWS_COUNT = Math.max(5, Math.min(50, parseInt(process.env.NEWS_COUNT || '15', 10) || 15));
const BODY_MAX_CHARS = Math.max(0, parseInt(process.env.BODY_MAX_CHARS || '400', 10) || 400);
const STATE_FILE = process.env.STATE_FILE || './data/steam-news-state.json';
const POST_MESSAGE = process.env.POST_MESSAGE
  || '🎮 **Steam news** — {app}\n**{title}**\n{url}\n_{feed}_';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL) {
  console.error('FATAL: HAVEN_WEBHOOK_URL is required.');
  process.exit(1);
}
if (!APP_IDS.length) {
  console.error('FATAL: APP_IDS must list at least one Steam app id (e.g. 730,570).');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return { seen: j.seen && typeof j.seen === 'object' ? j.seen : {} };
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

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

function formatItem(appId, item) {
  let contents = stripHtml(item.contents || '');
  if (BODY_MAX_CHARS > 0 && contents.length > BODY_MAX_CHARS) {
    contents = contents.slice(0, BODY_MAX_CHARS).trimEnd() + '…';
  }
  let msg = POST_MESSAGE
    .replaceAll('\\n', '\n')
    .replaceAll('{app}', String(appId))
    .replaceAll('{title}', item.title || 'Untitled')
    .replaceAll('{url}', item.url || '')
    .replaceAll('{feed}', item.feedlabel || item.feedname || '')
    .replaceAll('{author}', item.author || '')
    .replaceAll('{contents}', contents);
  if (contents && !POST_MESSAGE.includes('{contents}')) {
    msg = `${msg}\n${contents}`;
  }
  return msg.slice(0, 4000);
}

async function fetchNews(appId) {
  const params = new URLSearchParams({
    appid: String(appId),
    count: String(NEWS_COUNT),
    maxlength: String(BODY_MAX_CHARS > 0 ? BODY_MAX_CHARS + 100 : 0),
    format: 'json',
  });
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?${params}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'haven-bot-steam-news/1.0',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`app ${appId} → ${res.status}: ${text.slice(0, 150)}`);
  }
  const json = await res.json();
  const items = (json.appnews && json.appnews.newsitems) || [];
  return items.map((n) => ({
    gid: String(n.gid),
    title: n.title || 'Untitled',
    url: n.url || n.contents || '',
    author: n.author || '',
    contents: n.contents || '',
    feedlabel: n.feedlabel || '',
    feedname: n.feedname || '',
    date: n.date || 0,
  }));
}

async function pollApp(appId) {
  const items = await fetchNews(appId);
  if (!state.seen[appId]) state.seen[appId] = [];
  const seen = new Set(state.seen[appId]);
  const isFirst = seen.size === 0;

  if (isFirst) {
    for (const it of items) {
      if (it.gid) seen.add(it.gid);
    }
    state.seen[appId] = [...seen].slice(0, 500);
    saveState(state);
    console.log(
      `[${new Date().toISOString()}] primed app ${appId} (${items.length} items, no posts to Haven)`
    );
    return;
  }

  const fresh = items.filter((it) => it.gid && !seen.has(it.gid));
  // API is newest-first; post oldest-of-fresh first
  const toPost = fresh.slice(0, MAX_ITEMS_PER_APP).reverse();
  for (const it of toPost) {
    await postToHaven(formatItem(appId, it));
    seen.add(it.gid);
    console.log(`[${new Date().toISOString()}] posted app ${appId}: ${it.title}`);
    await new Promise((r) => setTimeout(r, 800));
  }
  for (const it of fresh) {
    if (it.gid) seen.add(it.gid);
  }
  state.seen[appId] = [...seen].slice(-500);
  saveState(state);
}

async function pollAll() {
  for (const appId of APP_IDS) {
    try {
      await pollApp(appId);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] poll failed app ${appId}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

const app = express();

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(`steam-news bot running. apps=${APP_IDS.length} poll=${POLL_INTERVAL_SEC}s`);
});
app.get('/health', (_req, res) =>
  res.json({ ok: true, appIds: APP_IDS, pollIntervalSec: POLL_INTERVAL_SEC })
);
app.post('/poll', async (_req, res) => {
  try {
    await pollAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`steam-news bot listening on :${PORT}`);
  console.log(`  apps: ${APP_IDS.join(', ')}`);
  console.log(`  poll every ${POLL_INTERVAL_SEC}s`);
  pollAll().catch((e) => console.error('[poll]', e.message));
  setInterval(() => {
    pollAll().catch((e) => console.error('[poll]', e.message));
  }, POLL_INTERVAL_SEC * 1000);
});
