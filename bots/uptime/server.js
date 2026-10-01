// uptime — Haven community bot
//
// Polls TARGET_URLS on an interval and posts to Haven when a target flips
// between up and down. Includes measured latency in the message.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const TARGET_URLS = (process.env.TARGET_URLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const INTERVAL = Math.max(15, parseInt(process.env.INTERVAL || '60', 10) || 60);
const METHOD = String(process.env.METHOD || 'GET').toUpperCase() === 'HEAD' ? 'HEAD' : 'GET';
const OK_STATUSES = (process.env.OK_STATUSES || '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n));
const TIMEOUT_MS = Math.max(1000, parseInt(process.env.TIMEOUT_MS || '10000', 10) || 10000);
const STATE_FILE = process.env.STATE_FILE || './data/uptime-state.json';
const ANNOUNCE_INITIAL = String(process.env.ANNOUNCE_INITIAL || 'false').toLowerCase() === 'true';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL) {
  console.error('FATAL: HAVEN_WEBHOOK_URL is required.');
  process.exit(1);
}
if (!TARGET_URLS.length) {
  console.error('FATAL: TARGET_URLS must list at least one URL.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      // url → { up: boolean, status: number, latencyMs: number, at: number }
      targets: j.targets && typeof j.targets === 'object' ? j.targets : {},
    };
  } catch {
    return { targets: {} };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();

function isUp(statusCode) {
  if (OK_STATUSES.length) return OK_STATUSES.includes(statusCode);
  return statusCode >= 200 && statusCode < 400;
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

async function checkUrl(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: METHOD,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'haven-bot-uptime/1.0' },
    });
    const latencyMs = Date.now() - started;
    // Drain body for GET so sockets free quickly
    if (METHOD === 'GET') await res.arrayBuffer().catch(() => {});
    return {
      up: isUp(res.status),
      status: res.status,
      latencyMs,
      error: null,
    };
  } catch (err) {
    return {
      up: false,
      status: 0,
      latencyMs: Date.now() - started,
      error: err.message || String(err),
    };
  }
}

function formatFlip(url, result) {
  const icon = result.up ? '🟢' : '🔴';
  const label = result.up ? 'UP' : 'DOWN';
  const lines = [
    `${icon} **${label}** ${url}`,
    `status=${result.status} · latency=${result.latencyMs}ms${result.error ? ` · Error: ${result.error}` : ''}`,
  ];
  return lines.join('\n').slice(0, 4000);
}

async function pollOnce() {
  for (const url of TARGET_URLS) {
    const result = await checkUrl(url);
    const prev = state.targets[url];
    const sample = {
      up: result.up,
      status: result.status,
      latencyMs: result.latencyMs,
      at: Date.now(),
      error: result.error,
    };

    if (!prev) {
      state.targets[url] = sample;
      saveState(state);
      if (ANNOUNCE_INITIAL) {
        try {
          await postToHaven(formatFlip(url, result));
        } catch (err) {
          console.error(`[post] ${url}:`, err.message);
        }
      } else {
        console.log(`[${new Date().toISOString()}] primed ${url} up=${result.up} status=${result.status} ${result.latencyMs}ms`);
      }
      continue;
    }

    if (prev.up !== result.up) {
      try {
        await postToHaven(formatFlip(url, result));
        console.log(`[${new Date().toISOString()}] flip ${url} ${prev.up ? 'UP' : 'DOWN'} → ${result.up ? 'UP' : 'DOWN'} ${result.latencyMs}ms`);
      } catch (err) {
        console.error(`[post] ${url}:`, err.message);
        continue;
      }
    } else {
      console.log(`[${new Date().toISOString()}] ok ${url} up=${result.up} ${result.latencyMs}ms`);
    }

    state.targets[url] = sample;
    saveState(state);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const app = express();

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `uptime bot running. targets=${TARGET_URLS.length} interval=${INTERVAL}s method=${METHOD}`
  );
});
app.get('/health', (_req, res) => {
  const summary = {};
  for (const url of TARGET_URLS) {
    const t = state.targets[url];
    summary[url] = t
      ? { up: t.up, status: t.status, latencyMs: t.latencyMs, at: t.at }
      : null;
  }
  res.json({ ok: true, interval: INTERVAL, targets: summary });
});
app.post('/poll', async (_req, res) => {
  try {
    await pollOnce();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`uptime bot listening on :${PORT}`);
  console.log(`  targets: ${TARGET_URLS.join(', ')}`);
  console.log(`  interval=${INTERVAL}s method=${METHOD} timeout=${TIMEOUT_MS}ms`);
  pollOnce().catch((e) => console.error('[poll]', e.message));
  setInterval(() => {
    pollOnce().catch((e) => console.error('[poll]', e.message));
  }, INTERVAL * 1000);
});
