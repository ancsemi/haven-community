// scheduled-announce — Haven community bot
//
// Posts scheduled messages via HAVEN_WEBHOOK_URL. Supports every_minutes
// intervals and daily HH:MM (no full cron parser).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const STATE_FILE = process.env.STATE_FILE || './data/scheduled-announce-state.json';
const TICK_INTERVAL_MS = Math.max(5000, parseInt(process.env.TICK_INTERVAL_MS || '15000', 10) || 15000);
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL) {
  console.error('FATAL: HAVEN_WEBHOOK_URL is required.');
  process.exit(1);
}

function parseSchedules() {
  const rawJson = (process.env.SCHEDULES_JSON || '').trim();
  if (rawJson) {
    try {
      const arr = JSON.parse(rawJson);
      if (!Array.isArray(arr)) throw new Error('SCHEDULES_JSON must be an array');
      return arr.map((item, i) => normalizeSchedule(item, i)).filter(Boolean);
    } catch (err) {
      console.error('FATAL: invalid SCHEDULES_JSON:', err.message);
      process.exit(1);
    }
  }
  const cronSpecs = (process.env.CRON_SPECS || '').trim();
  if (!cronSpecs) {
    console.error('FATAL: set SCHEDULES_JSON or CRON_SPECS with at least one schedule.');
    process.exit(1);
  }
  return cronSpecs
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((spec, i) => {
      const pipe = spec.indexOf('|');
      const head = pipe >= 0 ? spec.slice(0, pipe).trim() : spec;
      const message = pipe >= 0 ? spec.slice(pipe + 1).trim() : '';
      if (!message) return null;
      const every = head.match(/^every:(\d+)$/i);
      if (every) {
        return normalizeSchedule({ every_minutes: parseInt(every[1], 10), message }, i);
      }
      const daily = head.match(/^daily:(\d{1,2}:\d{2})$/i);
      if (daily) {
        return normalizeSchedule({ daily: daily[1], message }, i);
      }
      console.warn(`[schedules] ignoring unrecognized spec: ${head}`);
      return null;
    })
    .filter(Boolean);
}

function normalizeSchedule(item, index) {
  if (!item || typeof item !== 'object') return null;
  const message = String(item.message || '').trim().slice(0, 4000);
  if (!message) return null;
  const id = item.id != null ? String(item.id) : `job-${index}`;
  if (item.every_minutes != null || item.everyMinutes != null) {
    const mins = Math.max(1, parseInt(item.every_minutes ?? item.everyMinutes, 10) || 0);
    if (!mins) return null;
    return { id, type: 'interval', everyMinutes: mins, message };
  }
  const daily = item.daily || item.hhmm || item.time;
  if (daily) {
    const m = String(daily).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
      console.warn(`[schedules] bad daily time for ${id}: ${daily}`);
      return null;
    }
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    const offset = parseInt(item.timezone_offset_minutes ?? item.timezoneOffsetMinutes ?? 0, 10) || 0;
    return {
      id,
      type: 'daily',
      hour: hh,
      minute: mm,
      offsetMinutes: offset,
      message,
    };
  }
  console.warn(`[schedules] job ${id} needs every_minutes or daily`);
  return null;
}

const schedules = parseSchedules();
if (!schedules.length) {
  console.error('FATAL: no valid schedules configured.');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return {
      // id → { lastFiredAt, lastDailyKey }
      jobs: j.jobs && typeof j.jobs === 'object' ? j.jobs : {},
    };
  } catch {
    return { jobs: {} };
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

function localParts(nowMs, offsetMinutes) {
  const d = new Date(nowMs + offsetMinutes * 60 * 1000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    dayKey: `${y}-${mo}-${day}`,
  };
}

async function fireJob(job) {
  await postToHaven(job.message);
  console.log(`[${new Date().toISOString()}] fired ${job.id} (${job.type})`);
}

async function tick() {
  const now = Date.now();
  for (const job of schedules) {
    if (!state.jobs[job.id]) state.jobs[job.id] = {};
    const st = state.jobs[job.id];

    if (job.type === 'interval') {
      const intervalMs = job.everyMinutes * 60 * 1000;
      const last = st.lastFiredAt || 0;
      if (!last) {
        // Prime: record start so we don't fire immediately on deploy unless interval already elapsed from epoch
        st.lastFiredAt = now;
        saveState(state);
        continue;
      }
      if (now - last >= intervalMs) {
        try {
          await fireJob(job);
          st.lastFiredAt = now;
          saveState(state);
        } catch (err) {
          console.error(`[tick] ${job.id}:`, err.message);
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      continue;
    }

    if (job.type === 'daily') {
      const parts = localParts(now, job.offsetMinutes);
      if (parts.hour === job.hour && parts.minute === job.minute) {
        if (st.lastDailyKey === parts.dayKey) continue;
        try {
          await fireJob(job);
          st.lastDailyKey = parts.dayKey;
          st.lastFiredAt = now;
          saveState(state);
        } catch (err) {
          console.error(`[tick] ${job.id}:`, err.message);
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
}

const app = express();

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    `scheduled-announce running. jobs=${schedules.length} tick=${TICK_INTERVAL_MS}ms`
  );
});
app.get('/health', (_req, res) => res.json({
  ok: true,
  jobs: schedules.map((j) => ({
    id: j.id,
    type: j.type,
    everyMinutes: j.everyMinutes,
    daily: j.type === 'daily' ? `${String(j.hour).padStart(2, '0')}:${String(j.minute).padStart(2, '0')}` : undefined,
    offsetMinutes: j.offsetMinutes,
  })),
}));
app.post('/tick', async (_req, res) => {
  try {
    await tick();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`scheduled-announce bot listening on :${PORT}`);
  for (const j of schedules) {
    if (j.type === 'interval') console.log(`  [${j.id}] every ${j.everyMinutes}m`);
    else console.log(`  [${j.id}] daily ${String(j.hour).padStart(2, '0')}:${String(j.minute).padStart(2, '0')} offset=${j.offsetMinutes}m`);
  }
  tick().catch((e) => console.error('[tick]', e.message));
  setInterval(() => {
    tick().catch((e) => console.error('[tick]', e.message));
  }, TICK_INTERVAL_MS);
});
