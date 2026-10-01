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
// Failed checks in a row before a target is reported DOWN (one blip is not an outage).
const FAIL_THRESHOLD = Math.max(1, parseInt(process.env.FAIL_THRESHOLD || '2', 10) || 2);
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
    signal: AbortSignal.timeout(10000),
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
  // Check every target at once so one slow URL doesn't delay the rest.
  const results = await Promise.all(TARGET_URLS.map((url) => checkUrl(url)));
  for (let i = 0; i < TARGET_URLS.length; i++) {
    const url = TARGET_URLS[i];
    const result = results[i];
    const prev = state.targets[url];
    const sample = {
      up: result.up,
      status: result.status,
      latencyMs: result.latencyMs,
      at: Date.now(),
      error: result.error,
      failStreak: result.up ? 0 : ((prev && prev.failStreak) || 0) + 1,
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

    if (prev.up && !result.up && sample.failStreak < FAIL_THRESHOLD) {
      // Not down for long enough yet: keep reporting it as up.
      sample.up = true;
      console.log(`[${new Date().toISOString()}] fail ${sample.failStreak}/${FAIL_THRESHOLD} ${url} status=${result.status}${result.error ? ` ${result.error}` : ''}`);
    } else if (prev.up !== result.up) {
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

// Skip a tick if the previous poll is still running (slow targets or Haven).
let polling = false;
async function runPoll() {
  if (polling) return;
  polling = true;
  try {
    await pollOnce();
  } finally {
    polling = false;
  }
}

const app = express();

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `uptime bot running. targets=${TARGET_URLS.length} interval=${INTERVAL}s method=${METHOD}`
  );
});
// Counts only: /health is unauthenticated, so it must not reveal which URLs are watched.
app.get('/health', (_req, res) => {
  let up = 0;
  let down = 0;
  for (const url of TARGET_URLS) {
    const t = state.targets[url];
    if (t) {
      if (t.up) up++;
      else down++;
    }
  }
  res.json({ ok: true, interval: INTERVAL, targets: TARGET_URLS.length, up, down });
});

app.listen(PORT, () => {
  console.log(`uptime bot listening on :${PORT}`);
  console.log(`  targets: ${TARGET_URLS.join(', ')}`);
  console.log(`  interval=${INTERVAL}s method=${METHOD} timeout=${TIMEOUT_MS}ms`);
  runPoll().catch((e) => console.error('[poll]', e.message));
  setInterval(() => {
    runPoll().catch((e) => console.error('[poll]', e.message));
  }, INTERVAL * 1000);
});
