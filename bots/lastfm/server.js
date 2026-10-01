// lastfm — Haven community bot
//
// /np [user] — Last.fm recent / now-playing tracks (LASTFM_API_KEY required).
// Optional DEFAULT_USER and per-Haven-user link via /np set <lastfm_user>.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const LASTFM_API_KEY = (process.env.LASTFM_API_KEY || '').trim();
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const DEFAULT_USER = (process.env.DEFAULT_USER || '').trim();
const STATE_FILE = process.env.STATE_FILE || './data/lastfm-state.json';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);
const API = 'https://ws.audioscrobbler.com/2.0/';

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}
if (!LASTFM_API_KEY) {
  console.error('FATAL: LASTFM_API_KEY is required (get one at https://www.last.fm/api/account/create).');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return { links: j.links && typeof j.links === 'object' ? j.links : {} };
  } catch {
    return { links: {} };
  }
}

function saveState() {
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
  const cmds = [
    {
      command: 'np',
      description: 'Last.fm now playing: /np [user]',
      subcommands: [
        { name: 'set', description: 'Link your Last.fm username' },
        { name: 'unset', description: 'Unlink Last.fm username' },
        { name: 'whoami', description: 'Show linked Last.fm user' },
      ],
    },
    { command: 'lastfm', description: 'Alias for /np' },
  ];
  for (const body of cmds) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[commands] register /${body.command} failed: ${res.status}`);
    } else {
      console.log(`[commands] registered /${body.command}`);
    }
  }
}

function havenUserKey(user) {
  if (user && user.id != null && user.id !== '') return `id:${user.id}`;
  const name = (user && (user.username || user.displayName)) || '';
  if (name) return `name:${name.toLowerCase()}`;
  return null;
}

function sanitizeLfmUser(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@/, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .slice(0, 64);
}

function resolveLfmUser(argsUser, havenUser) {
  const explicit = sanitizeLfmUser(argsUser);
  if (explicit) return explicit;
  const key = havenUserKey(havenUser);
  if (key && state.links[key]) return state.links[key];
  if (DEFAULT_USER) return DEFAULT_USER;
  return null;
}

async function fetchRecent(lfmUser, limit = 1) {
  const params = new URLSearchParams({
    method: 'user.getrecenttracks',
    user: lfmUser,
    api_key: LASTFM_API_KEY,
    format: 'json',
    limit: String(limit),
  });
  const res = await fetch(`${API}?${params}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'haven-bot-lastfm/1.0',
    },
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.message) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (data.error) throw new Error(data.message || `Last.fm error ${data.error}`);
  let tracks = data.recenttracks && data.recenttracks.track;
  if (!tracks) return [];
  if (!Array.isArray(tracks)) tracks = [tracks];
  return tracks;
}

function trackFields(t) {
  const artist =
    (t.artist && (t.artist['#text'] || t.artist.name || t.artist)) || 'Unknown artist';
  const name = t.name || 'Unknown track';
  const album = (t.album && (t.album['#text'] || t.album.name)) || '';
  const url = t.url || '';
  const now = !!(t['@attr'] && (t['@attr'].nowplaying === 'true' || t['@attr'].nowplaying === true));
  return { artist: String(artist), name: String(name), album: String(album), url, now };
}

function formatNp(lfmUser, tracks) {
  if (!tracks.length) {
    return `🎧 **${lfmUser}** has no recent scrobbles.`;
  }
  const t = trackFields(tracks[0]);
  const icon = t.now ? '▶️' : '🎧';
  const label = t.now ? 'Now playing' : 'Last played';
  const lines = [
    `${icon} **${label}** — [${lfmUser}](https://www.last.fm/user/${encodeURIComponent(lfmUser)})`,
    `**${t.artist}** — ${t.name}`,
  ];
  if (t.album) lines.push(`_Album: ${t.album}_`);
  if (t.url) lines.push(t.url);
  return lines.join('\n').slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'np' && command !== 'lastfm') return { ignored: true };

  const args = String(payload.args || '').trim();
  const user = payload.user || {};
  const parts = args.split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  if (sub === 'set' || sub === 'link') {
    const lfm = sanitizeLfmUser(parts[1] || '');
    const key = havenUserKey(user);
    if (!lfm) {
      await postToHaven('Usage: `/np set <lastfm_username>`');
      return;
    }
    if (!key) {
      await postToHaven('❌ Could not identify you.');
      return;
    }
    state.links[key] = lfm;
    saveState();
    await postToHaven(`✅ Linked to Last.fm user **${lfm}**. Try \`/np\`.`);
    return;
  }

  if (sub === 'unset' || sub === 'unlink' || sub === 'clear') {
    const key = havenUserKey(user);
    if (key && state.links[key]) {
      delete state.links[key];
      saveState();
      await postToHaven('✅ Unlinked your Last.fm username.');
    } else {
      await postToHaven('No Last.fm link on file for you.');
    }
    return;
  }

  if (sub === 'whoami' || sub === 'me') {
    const key = havenUserKey(user);
    const linked = key && state.links[key];
    if (linked) await postToHaven(`🎧 You are linked as **${linked}**.`);
    else if (DEFAULT_USER) await postToHaven(`No personal link. Default user: **${DEFAULT_USER}**.`);
    else await postToHaven('No link. Use `/np set <lastfm_username>`.');
    return;
  }

  if (sub === 'help') {
    await postToHaven(
      'Usage: `/np [lastfm_user]` · `/np set <user>` · `/np unset` · `/np whoami`'
    );
    return;
  }

  // /np [user] — if first token is not a subcommand, treat as username
  const queryUser = sub && !['set', 'unset', 'link', 'unlink', 'clear', 'whoami', 'me', 'help'].includes(sub)
    ? parts.join(' ')
    : '';
  const lfmUser = resolveLfmUser(queryUser, user);
  if (!lfmUser) {
    await postToHaven(
      'Usage: `/np <lastfm_user>` or `/np set <lastfm_user>` first (or set DEFAULT_USER).'
    );
    return;
  }

  try {
    const tracks = await fetchRecent(lfmUser, 1);
    await postToHaven(formatNp(lfmUser, tracks));
  } catch (err) {
    await postToHaven(`❌ Last.fm: ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(`lastfm bot running. links=${Object.keys(state.links).length} default=${DEFAULT_USER || 'none'}`);
});
app.get('/health', (_req, res) =>
  res.json({ ok: true, links: Object.keys(state.links).length, defaultUser: DEFAULT_USER || null })
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
      await postToHaven('✅ Last.fm bot received a test event.');
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
  console.log(`lastfm bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
