// reddit — Haven community bot
//
// Polls https://www.reddit.com/r/{sub}/new.json for SUBREDDITS and posts new
// threads to Haven. Requires a descriptive User-Agent. First poll primes only.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const SUBREDDITS = (process.env.SUBREDDITS || '')
  .split(',')
  .map((s) => s.trim().replace(/^r\//i, '').toLowerCase())
  .filter(Boolean);
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const POLL_INTERVAL_SEC = Math.max(60, parseInt(process.env.POLL_INTERVAL_SEC || '120', 10) || 120);
const MAX_ITEMS_PER_SUB = Math.max(1, parseInt(process.env.MAX_ITEMS_PER_SUB || '3', 10) || 3);
const STATE_FILE = process.env.STATE_FILE || './data/reddit-state.json';
const USER_AGENT = (process.env.USER_AGENT || 'haven-bot-reddit/1.0 (community; +https://github.com/ancsemi/haven-community)').trim();
const POST_MESSAGE = process.env.POST_MESSAGE
  || '📌 **r/{sub}** — {title}\n{url}\n_by u/{author} · {score} points_';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL) {
  console.error('FATAL: HAVEN_WEBHOOK_URL is required.');
  process.exit(1);
}
if (!SUBREDDITS.length) {
  console.error('FATAL: SUBREDDITS must list at least one subreddit.');
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

function formatPost(sub, post) {
  return POST_MESSAGE
    .replaceAll('\\n', '\n')
    .replaceAll('{sub}', sub)
    .replaceAll('{title}', post.title || '')
    .replaceAll('{url}', post.url || '')
    .replaceAll('{author}', post.author || '')
    .replaceAll('{score}', post.score != null ? String(post.score) : '')
    .slice(0, 4000);
}

async function fetchSubNew(sub) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`r/${sub} → ${res.status}: ${text.slice(0, 150)}`);
  }
  const json = await res.json();
  const children = (json.data && json.data.children) || [];
  return children
    .map((c) => c.data)
    .filter(Boolean)
    .map((d) => ({
      id: d.id || d.name,
      title: d.title || 'Untitled',
      author: d.author || 'unknown',
      score: d.score,
      url: d.url && !d.url.includes('reddit.com')
        ? (d.permalink ? `https://www.reddit.com${d.permalink}` : d.url)
        : (d.permalink ? `https://www.reddit.com${d.permalink}` : d.url || ''),
      created: d.created_utc,
    }));
}

async function pollSub(sub) {
  const posts = await fetchSubNew(sub);
  if (!state.seen[sub]) state.seen[sub] = [];
  const seen = new Set(state.seen[sub]);
  const isFirst = seen.size === 0;

  if (isFirst) {
    for (const p of posts) {
      if (p.id) seen.add(p.id);
    }
    state.seen[sub] = [...seen].slice(0, 500);
    saveState(state);
    console.log(`[${new Date().toISOString()}] primed r/${sub} (${posts.length} posts, no posts to Haven)`);
    return;
  }

  const fresh = posts.filter((p) => p.id && !seen.has(p.id));
  // Reddit new.json is newest-first; post oldest-of-fresh first
  const toPost = fresh.slice(0, MAX_ITEMS_PER_SUB).reverse();
  for (const p of toPost) {
    await postToHaven(formatPost(sub, p));
    seen.add(p.id);
    console.log(`[${new Date().toISOString()}] posted r/${sub}: ${p.title}`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  for (const p of fresh) {
    if (p.id) seen.add(p.id);
  }
  state.seen[sub] = [...seen].slice(-500);
  saveState(state);
}

async function pollAll() {
  for (const sub of SUBREDDITS) {
    try {
      await pollSub(sub);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] poll failed r/${sub}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const app = express();

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `reddit bot running. subs=${SUBREDDITS.length} poll=${POLL_INTERVAL_SEC}s`
  );
});
app.get('/health', (_req, res) => res.json({
  ok: true,
  subreddits: SUBREDDITS,
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
  console.log(`reddit bot listening on :${PORT}`);
  console.log(`  subs: ${SUBREDDITS.map((s) => 'r/' + s).join(', ')}`);
  console.log(`  poll every ${POLL_INTERVAL_SEC}s`);
  pollAll().catch((e) => console.error('[poll]', e.message));
  setInterval(() => {
    pollAll().catch((e) => console.error('[poll]', e.message));
  }, POLL_INTERVAL_SEC * 1000);
});
