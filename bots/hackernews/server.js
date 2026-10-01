// hackernews — Haven community bot
//
// Polls Hacker News top stories (Firebase API) and posts new items above
// SCORE_MIN. First poll primes seen ids only.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const POLL_INTERVAL_SEC = Math.max(60, parseInt(process.env.POLL_INTERVAL_SEC || '300', 10) || 300);
const SCORE_MIN = Math.max(0, parseInt(process.env.SCORE_MIN || '100', 10) || 100);
const TOP_N = Math.max(10, Math.min(100, parseInt(process.env.TOP_N || '30', 10) || 30));
const MAX_POSTS_PER_POLL = Math.max(1, parseInt(process.env.MAX_POSTS_PER_POLL || '5', 10) || 5);
const STATE_FILE = process.env.STATE_FILE || './data/hackernews-state.json';
const POST_MESSAGE = process.env.POST_MESSAGE
  || '🟠 **HN** ({score}) — {title}\n{url}\n_comments: {comments}_';
const PORT = parseInt(process.env.PORT || '3000', 10);

const HN_TOP = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const HN_ITEM = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

if (!HAVEN_WEBHOOK_URL) {
  console.error('FATAL: HAVEN_WEBHOOK_URL is required.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      seen: Array.isArray(j.seen) ? j.seen.map(String) : [],
      primed: !!j.primed,
    };
  } catch {
    return { seen: [], primed: false };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();

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

function formatStory(item) {
  const hnUrl = `https://news.ycombinator.com/item?id=${item.id}`;
  const url = item.url || hnUrl;
  return POST_MESSAGE
    .replaceAll('\\n', '\n')
    .replaceAll('{title}', item.title || 'Untitled')
    .replaceAll('{url}', url)
    .replaceAll('{score}', item.score != null ? String(item.score) : '?')
    .replaceAll('{by}', item.by || '')
    .replaceAll('{comments}', hnUrl)
    .replaceAll('{id}', String(item.id))
    .slice(0, 4000);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'haven-bot-hackernews/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${url} → ${res.status}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

async function fetchTopStories() {
  const ids = await fetchJson(HN_TOP);
  if (!Array.isArray(ids)) return [];
  const slice = ids.slice(0, TOP_N);
  const items = [];
  // sequential with small delay to be polite
  for (const id of slice) {
    try {
      const item = await fetchJson(HN_ITEM(id));
      if (item && item.type === 'story' && !item.deleted && !item.dead) {
        items.push({
          id: item.id,
          title: item.title || 'Untitled',
          url: item.url || '',
          score: item.score || 0,
          by: item.by || '',
          time: item.time || 0,
        });
      }
    } catch (err) {
      console.warn(`[item ${id}] ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return items;
}

async function pollOnce() {
  const items = await fetchTopStories();
  const seen = new Set(state.seen.map(String));

  if (!state.primed) {
    for (const it of items) {
      if (it.id != null) seen.add(String(it.id));
    }
    state.seen = [...seen].slice(-1000);
    state.primed = true;
    saveState(state);
    console.log(
      `[${new Date().toISOString()}] primed HN (${items.length} top stories, no posts to Haven)`
    );
    return;
  }

  const fresh = items
    .filter((it) => it.id != null && !seen.has(String(it.id)))
    .filter((it) => (it.score || 0) >= SCORE_MIN)
    // lower score first among new so we post steadily; actually prefer higher score
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, MAX_POSTS_PER_POLL);

  for (const it of fresh) {
    await postToHaven(formatStory(it));
    seen.add(String(it.id));
    console.log(`[${new Date().toISOString()}] posted HN ${it.id}: ${it.title} (${it.score})`);
    await new Promise((r) => setTimeout(r, 800));
  }

  // Also mark other new ids as seen so we don't post later if they never hit SCORE_MIN while still "new"
  // Optional: only mark posted. Spec says post new top stories above SCORE_MIN — mark only those we considered from top list that are below min too to avoid late spam when they climb.
  for (const it of items) {
    if (it.id != null) seen.add(String(it.id));
  }

  state.seen = [...seen].slice(-1000);
  saveState(state);
}

const app = express();

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `hackernews bot running. scoreMin=${SCORE_MIN} topN=${TOP_N} poll=${POLL_INTERVAL_SEC}s primed=${state.primed}`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    scoreMin: SCORE_MIN,
    topN: TOP_N,
    pollIntervalSec: POLL_INTERVAL_SEC,
    primed: state.primed,
    seen: state.seen.length,
  })
);
app.post('/poll', async (_req, res) => {
  try {
    await pollOnce();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`hackernews bot listening on :${PORT}`);
  console.log(`  SCORE_MIN=${SCORE_MIN} TOP_N=${TOP_N} poll every ${POLL_INTERVAL_SEC}s`);
  pollOnce().catch((e) => console.error('[poll]', e.message));
  setInterval(() => {
    pollOnce().catch((e) => console.error('[poll]', e.message));
  }, POLL_INTERVAL_SEC * 1000);
});
