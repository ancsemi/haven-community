// rss — Haven community bot
//
// Polls RSS/Atom feeds and posts new items into a Haven channel via the
// bot webhook API. /rss slash commands manage the feed list; add and remove
// are limited to ALLOWED_USER_IDS.
//
// Feed URLs are fetched with a guard: http/https only, and the host must
// resolve to a public address (no loopback, private, link-local, CGNAT or
// cloud metadata addresses). The check runs on the address actually
// connected to, and again on every redirect.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
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
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_FEEDS = Math.max(1, parseInt(process.env.MAX_FEEDS || '20', 10) || 20);
const MAX_FEED_BYTES = Math.max(65536, parseInt(process.env.MAX_FEED_BYTES || '2097152', 10) || 2097152);
const MAX_REDIRECTS = 3;
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}
if (!ALLOWED_USER_IDS.length) {
  console.warn('WARNING: ALLOWED_USER_IDS is empty, so nobody can /rss add or /rss remove. Add the Haven user ids of your admins.');
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      feeds: Array.isArray(j.feeds) ? j.feeds : [],
      seen: j.seen && typeof j.seen === 'object' ? j.seen : {},
      // Feeds removed with /rss remove, so FEED_URLS does not bring them back on restart.
      removed: Array.isArray(j.removed) ? j.removed : [],
    };
  } catch {
    return { feeds: [], seen: {}, removed: [] };
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
  if (state.removed.includes(url)) continue;
  if (state.feeds.length >= MAX_FEEDS) {
    console.warn(`[feeds] MAX_FEEDS (${MAX_FEEDS}) reached, not adding ${url}`);
    break;
  }
  if (!state.feeds.includes(url)) state.feeds.push(url);
}
saveState(state);

// ── Feed URL safety ─────────────────────────────────────

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc * 256) + Number(part), 0);
}

function inV4Range(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipv4ToInt(ip) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

const BLOCKED_V4 = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT (also some cloud metadata, e.g. 100.100.100.200)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, includes 169.254.169.254 metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
];

function isBlockedAddress(address) {
  const ip = String(address || '').replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(ip);
  if (family === 4) return BLOCKED_V4.some(([base, bits]) => inV4Range(ip, base, bits));
  if (family !== 6) return true;
  const lower = ip.toLowerCase();
  // IPv4 written inside IPv6 (::ffff:1.2.3.4, ::1.2.3.4, 64:ff9b::1.2.3.4)
  const embedded = lower.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) return isBlockedAddress(embedded[1]);
  // Expand to 8 groups so prefixes can be compared.
  const [head, tail] = lower.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  const g = groups.map((x) => parseInt(x || '0', 16));
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    // IPv4-mapped / IPv4-compatible in hex form
    return isBlockedAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    return isBlockedAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (includes fd00:ec2::254 metadata)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

// Throws if the URL is not http/https or its host is a blocked address.
// Hostnames are resolved here for a clear early error, and again by
// guardedLookup at connect time, which is the check that really counts.
async function assertSafeFeedUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('not a valid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http and https feeds are allowed');
  if (u.username || u.password) throw new Error('URLs with a username or password are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new Error(`${host} is a private or reserved address`);
    return u;
  }
  const addrs = await dns.promises.lookup(host, { all: true });
  if (!addrs.length) throw new Error(`${host} did not resolve`);
  const bad = addrs.find((a) => isBlockedAddress(a.address));
  if (bad) throw new Error(`${host} resolves to a private or reserved address (${bad.address})`);
  return u;
}

// dns.lookup wrapper used for the real connection, so a host cannot pass the
// early check and then resolve to a private address when we connect.
function guardedLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err);
    const bad = addrs.find((a) => isBlockedAddress(a.address));
    if (bad || !addrs.length) {
      return callback(new Error(`refusing to connect to ${hostname}: private or reserved address`));
    }
    if (options && options.all) return callback(null, addrs);
    return callback(null, addrs[0].address, addrs[0].family);
  });
}

// Fetches a feed body with the address guard, a size cap, a 20s timeout and
// manual redirects (each redirect target is checked again).
async function fetchFeedText(rawUrl, redirectsLeft = MAX_REDIRECTS) {
  const u = await assertSafeFeedUrl(rawUrl);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(u, {
      lookup: guardedLookup,
      headers: {
        'User-Agent': 'haven-bot-rss/1.0',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      timeout: 20000,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        let next;
        try {
          next = new URL(res.headers.location, u).toString();
        } catch {
          return reject(new Error('bad redirect location'));
        }
        return fetchFeedText(next, redirectsLeft - 1).then(resolve, reject);
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new Error(`fetch ${rawUrl} → ${status}`));
      }
      const declared = parseInt(res.headers['content-length'] || '0', 10);
      if (declared > MAX_FEED_BYTES) {
        res.destroy();
        return reject(new Error(`feed is larger than ${MAX_FEED_BYTES} bytes`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_FEED_BYTES) {
          res.destroy();
          reject(new Error(`feed is larger than ${MAX_FEED_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('feed request timed out')));
    req.on('error', reject);
  });
}

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

// With a recipientId, Haven shows the reply only to that one person.
async function postToHaven(content, recipientId) {
  const body = { content };
  if (HAVEN_USERNAME) body.username = HAVEN_USERNAME;
  if (HAVEN_AVATAR_URL) body.avatar_url = HAVEN_AVATAR_URL;
  if (recipientId != null) {
    body.ephemeral = true;
    body.recipient_id = recipientId;
  }
  const res = await fetch(HAVEN_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
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
  const xml = await fetchFeedText(feedUrl);
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
    // Save after every post so a failure later in the loop cannot repost this one.
    state.seen[feedUrl] = [...seen].slice(-500);
    saveState(state);
    console.log(`[${new Date().toISOString()}] posted: ${item.title}`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  for (const item of fresh) {
    if (item.guid) seen.add(item.guid);
  }
  state.seen[feedUrl] = [...seen].slice(-500);
  saveState(state);
}

// Shared by the timer and /rss poll so two polls never run at once.
let polling = false;

async function pollAll() {
  if (polling) return false;
  polling = true;
  try {
    for (const feed of [...state.feeds]) {
      try {
        await pollFeed(feed);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] poll failed ${feed}:`, err.message);
      }
    }
  } finally {
    polling = false;
  }
  return true;
}

// Fails closed: an empty allowlist means nobody may add or remove feeds.
function isAllowed(user) {
  if (!ALLOWED_USER_IDS.length) return false;
  if (!user || user.id == null) return false;
  return ALLOWED_USER_IDS.some((id) => String(id) === String(user.id));
}

function verifySignature(rawBody, headerValue) {
  if (!headerValue) return false;
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
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /rss');
  }
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
  if (payload.event !== 'slash_command' || payload.command !== 'rss') {
    return res.json({ ignored: true });
  }
  const args = String(payload.args || '').trim();
  const [sub, ...rest] = args.split(/\s+/);
  const arg = rest.join(' ').trim();
  // Haven sends the caller as payload.author ({ id, username }).
  const user = payload.author || {};
  try {
    if ((sub === 'add' || sub === 'remove') && arg && !isAllowed(user)) {
      console.warn(`[rss] ${sub} refused for ${user.username || 'unknown'} (id ${user.id ?? 'n/a'})`);
      await postToHaven(
        ALLOWED_USER_IDS.length
          ? `❌ You are not allowed to change the feed list. (Your user id is ${user.id ?? 'unknown'}.)`
          : `❌ Feed changes are turned off until the bot owner sets ALLOWED_USER_IDS. (Your user id is ${user.id ?? 'unknown'}.)`,
        user.id
      );
      return res.json({ ok: true });
    }
    if (sub === 'add' && arg) {
      if (!state.feeds.includes(arg)) {
        if (state.feeds.length >= MAX_FEEDS) {
          await postToHaven(`❌ Already watching ${MAX_FEEDS} feeds (the maximum). Remove one first.`, user.id);
          return res.json({ ok: true });
        }
        try {
          await assertSafeFeedUrl(arg);
        } catch (err) {
          await postToHaven(`❌ Can't watch that feed: ${err.message}.`, user.id);
          return res.json({ ok: true });
        }
        state.feeds.push(arg);
        state.removed = state.removed.filter((f) => f !== arg);
        saveState(state);
      }
      await postToHaven(`✅ Watching feed: ${arg}`);
      return res.json({ ok: true });
    }
    if (sub === 'remove' && arg) {
      state.feeds = state.feeds.filter((f) => f !== arg);
      delete state.seen[arg];
      if (!state.removed.includes(arg)) state.removed.push(arg);
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
      if (polling) {
        await postToHaven('⏳ A poll is already running.', user.id);
        return res.json({ ok: true });
      }
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
