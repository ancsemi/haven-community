// twitch-live — Haven community bot
//
// Polls Twitch Helix for configured user logins and posts to Haven when a
// streamer transitions from offline to live. Live state is persisted so
// restarts do not re-notify.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const TWITCH_CLIENT_ID = (process.env.TWITCH_CLIENT_ID || '').trim();
const TWITCH_CLIENT_SECRET = (process.env.TWITCH_CLIENT_SECRET || '').trim();
const TWITCH_USER_LOGINS = (process.env.TWITCH_USER_LOGINS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const POLL_INTERVAL_SEC = Math.max(30, parseInt(process.env.POLL_INTERVAL_SEC || '60', 10) || 60);
const STATE_FILE = process.env.STATE_FILE || './data/twitch-live-state.json';
const LIVE_MESSAGE = process.env.LIVE_MESSAGE
  || '🔴 **{display_name}** is live!\n{title}\n{game}\n{url}';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL, TWITCH_CLIENT_ID, and TWITCH_CLIENT_SECRET are required.');
  process.exit(1);
}
if (!TWITCH_USER_LOGINS.length) {
  console.error('FATAL: TWITCH_USER_LOGINS must list at least one login.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      // login → { streamId, title, startedAt }
      live: j.live && typeof j.live === 'object' ? j.live : {},
      primed: !!j.primed,
    };
  } catch {
    return { live: {}, primed: false };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();

let appToken = null;
let appTokenExpiresAt = 0;

async function getAppToken() {
  if (appToken && Date.now() < appTokenExpiresAt - 60_000) return appToken;
  const body = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    client_secret: TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Twitch token ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  appToken = json.access_token;
  appTokenExpiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000;
  return appToken;
}

async function helixGet(pathAndQuery) {
  const token = await getAppToken();
  const res = await fetch(`https://api.twitch.tv/helix${pathAndQuery}`, {
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Helix ${pathAndQuery} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchStreamsByLogin(logins) {
  // Helix allows multiple user_login= params
  const qs = logins.map((l) => `user_login=${encodeURIComponent(l)}`).join('&');
  const json = await helixGet(`/streams?${qs}`);
  return Array.isArray(json.data) ? json.data : [];
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

function formatLive(stream) {
  const login = stream.user_login || stream.user_name || '';
  const display = stream.user_name || login;
  const title = stream.title || '';
  const game = stream.game_name || '';
  const viewers = stream.viewer_count != null ? String(stream.viewer_count) : '';
  const url = login ? `https://www.twitch.tv/${login}` : 'https://www.twitch.tv';
  return LIVE_MESSAGE
    .replaceAll('\\n', '\n')
    .replaceAll('{login}', login)
    .replaceAll('{display_name}', display)
    .replaceAll('{title}', title)
    .replaceAll('{game}', game)
    .replaceAll('{url}', url)
    .replaceAll('{viewers}', viewers)
    .slice(0, 4000);
}

async function pollOnce() {
  const streams = await fetchStreamsByLogin(TWITCH_USER_LOGINS);
  const byLogin = new Map();
  for (const s of streams) {
    const login = String(s.user_login || '').toLowerCase();
    if (login) byLogin.set(login, s);
  }

  if (!state.primed) {
    for (const login of TWITCH_USER_LOGINS) {
      const s = byLogin.get(login);
      if (s) {
        state.live[login] = {
          streamId: s.id,
          title: s.title || '',
          startedAt: s.started_at || new Date().toISOString(),
        };
      }
    }
    state.primed = true;
    saveState(state);
    console.log(`[${new Date().toISOString()}] primed live state (${Object.keys(state.live).length} already live, no posts)`);
    return;
  }

  for (const login of TWITCH_USER_LOGINS) {
    const s = byLogin.get(login);
    const was = state.live[login];
    if (s) {
      const streamId = s.id;
      if (!was || was.streamId !== streamId) {
        // Newly live (or new stream session id)
        try {
          await postToHaven(formatLive(s));
          console.log(`[${new Date().toISOString()}] live: ${login} — ${s.title || ''}`);
        } catch (err) {
          console.error(`[${new Date().toISOString()}] post failed ${login}:`, err.message);
          continue;
        }
        state.live[login] = {
          streamId,
          title: s.title || '',
          startedAt: s.started_at || new Date().toISOString(),
        };
        saveState(state);
        await new Promise((r) => setTimeout(r, 800));
      } else {
        // Still same stream — keep metadata fresh
        state.live[login] = {
          streamId,
          title: s.title || was.title || '',
          startedAt: was.startedAt || s.started_at || '',
        };
      }
    } else if (was) {
      delete state.live[login];
      saveState(state);
      console.log(`[${new Date().toISOString()}] offline: ${login}`);
    }
  }
  saveState(state);
}

const app = express();

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `twitch-live bot running. watching=${TWITCH_USER_LOGINS.length} poll=${POLL_INTERVAL_SEC}s live=${Object.keys(state.live).length}`
  );
});
app.get('/health', (_req, res) => res.json({
  ok: true,
  watching: TWITCH_USER_LOGINS,
  live: Object.keys(state.live),
  primed: state.primed,
  pollIntervalSec: POLL_INTERVAL_SEC,
}));
app.post('/poll', async (_req, res) => {
  try {
    await pollOnce();
    res.json({ ok: true, live: Object.keys(state.live) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`twitch-live bot listening on :${PORT}`);
  console.log(`  logins: ${TWITCH_USER_LOGINS.join(', ')}`);
  console.log(`  poll every ${POLL_INTERVAL_SEC}s`);
  pollOnce().catch((e) => console.error('[poll]', e.message));
  setInterval(() => {
    pollOnce().catch((e) => console.error('[poll]', e.message));
  }, POLL_INTERVAL_SEC * 1000);
});
