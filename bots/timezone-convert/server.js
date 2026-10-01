// timezone-convert — Haven community bot
//
// /tz <time> <fromZone> <toZone> — convert a clock time between IANA zones
// (or city aliases). Also /tz now <zone> for current time.
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

const CITY_ZONES = {
  utc: 'UTC',
  gmt: 'UTC',
  london: 'Europe/London',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  amsterdam: 'Europe/Amsterdam',
  rome: 'Europe/Rome',
  madrid: 'Europe/Madrid',
  moscow: 'Europe/Moscow',
  istanbul: 'Europe/Istanbul',
  dubai: 'Asia/Dubai',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata',
  singapore: 'Asia/Singapore',
  hongkong: 'Asia/Hong_Kong',
  'hong kong': 'Asia/Hong_Kong',
  tokyo: 'Asia/Tokyo',
  seoul: 'Asia/Seoul',
  shanghai: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  auckland: 'Pacific/Auckland',
  nyc: 'America/New_York',
  'new york': 'America/New_York',
  newyork: 'America/New_York',
  chicago: 'America/Chicago',
  denver: 'America/Denver',
  phoenix: 'America/Phoenix',
  la: 'America/Los_Angeles',
  'los angeles': 'America/Los_Angeles',
  losangeles: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  sf: 'America/Los_Angeles',
  vancouver: 'America/Vancouver',
  toronto: 'America/Toronto',
  montreal: 'America/Toronto',
  mexico: 'America/Mexico_City',
  'mexico city': 'America/Mexico_City',
  saopaulo: 'America/Sao_Paulo',
  'sao paulo': 'America/Sao_Paulo',
  cairo: 'Africa/Cairo',
  johannesburg: 'Africa/Johannesburg',
};

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
      command: 'tz',
      description: 'Convert time: /tz 3:30pm America/New_York Europe/London',
    },
    {
      command: 'convert',
      description: 'Alias for /tz',
    },
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

function isValidZone(zone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function resolveZone(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (raw.includes('/') || raw.toUpperCase() === 'UTC' || raw.startsWith('Etc/')) {
    const z = raw.toUpperCase() === 'UTC' ? 'UTC' : raw;
    if (isValidZone(z)) return z;
  }
  const key = raw.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = key.replace(/\s+/g, '');
  const mapped = CITY_ZONES[key] || CITY_ZONES[compact];
  if (mapped && isValidZone(mapped)) return mapped;
  const asZone = raw.replace(/\s+/g, '_');
  if (isValidZone(asZone)) return asZone;
  return null;
}

function parseTimeToken(token) {
  const s = String(token || '').trim().toLowerCase();
  if (s === 'now' || s === 'current') return { kind: 'now' };

  // 15:30, 15:30:00, 3:30pm, 3pm
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i);
  // 1530, 1530pm
  if (!m) m = s.match(/^(\d{1,2})(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  let minute = 0;
  let second = 0;
  let ampm = null;

  if (m[0].includes(':')) {
    minute = m[2] != null ? parseInt(m[2], 10) : 0;
    second = m[3] != null && !/am|pm/i.test(m[3]) ? parseInt(m[3], 10) : 0;
    ampm = m[4] || (m[3] && /am|pm/i.test(m[3]) ? m[3] : null);
  } else {
    minute = parseInt(m[2] || '0', 10);
    ampm = m[3] || null;
  }

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59 || second > 59) {
    return null;
  }

  if (ampm) {
    const ap = String(ampm).toLowerCase();
    if (hour < 1 || hour > 12) return null;
    if (ap === 'am') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }

  return { kind: 'clock', hour, minute, second: second || 0 };
}

// Get offset minutes of zone at a given UTC instant
function offsetMinutesAt(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const tzName = (parts.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT';
  // GMT, GMT+5, GMT-5:30, UTC, UTC+9
  const m = tzName.match(/(?:GMT|UTC)([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!m) {
    if (/^(GMT|UTC)$/i.test(tzName)) return 0;
    // Fallback: compare formatted hour in zone vs UTC
    return offsetViaParts(date, timeZone);
  }
  const sign = m[1].startsWith('-') ? -1 : 1;
  const h = Math.abs(parseInt(m[1], 10));
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  return sign * (h * 60 + mins);
}

function offsetViaParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    parts.hour === '24' ? 0 : +parts.hour,
    +parts.minute,
    +parts.second
  );
  return (asUTC - date.getTime()) / 60000;
}

function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  // Iteratively refine UTC guess using zone offset (handles DST)
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const off = offsetMinutesAt(new Date(utc), timeZone);
    utc = Date.UTC(year, month - 1, day, hour, minute, second) - off * 60000;
  }
  return new Date(utc);
}

function partsInZone(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  let hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    weekday: parts.weekday,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function formatParts(p, zone) {
  return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} (${zone})`;
}

function formatNice(date, zone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
}

function convertClock(clock, fromZone, toZone) {
  const now = new Date();
  const today = partsInZone(now, fromZone);
  const utcDate = zonedTimeToUtc(
    +today.year,
    +today.month,
    +today.day,
    clock.hour,
    clock.minute,
    clock.second || 0,
    fromZone
  );
  return utcDate;
}

function tokenizeArgs(args) {
  // Support: "3:30pm America/New_York Europe/London"
  // or "15:00 NYC London" or "now Tokyo"
  // Also "3:30 pm New York -> London" / "to"
  let s = String(args || '').trim();
  s = s.replace(/\s*->\s*/g, ' ').replace(/\s+to\s+/gi, ' ');
  const tokens = s.split(/\s+/).filter(Boolean);
  return tokens;
}

function parseConversion(args) {
  const tokens = tokenizeArgs(args);
  if (!tokens.length) return { error: 'usage' };

  if (tokens[0].toLowerCase() === 'now' || tokens[0].toLowerCase() === 'current') {
    if (tokens.length < 2) return { error: 'Usage: `/tz now <zone>`' };
    // remaining tokens may be multi-word city for one zone, or two zones
    // Prefer last token as optional second zone if two zones resolve
    const rest = tokens.slice(1).join(' ');
    // try full rest as one zone
    let zone = resolveZone(rest);
    if (zone) return { kind: 'now', zone };
    // try split last word
    if (tokens.length >= 3) {
      const z1 = resolveZone(tokens.slice(1, -1).join(' '));
      const z2 = resolveZone(tokens[tokens.length - 1]);
      if (z1 && z2) return { kind: 'now', zone: z1, also: z2 };
    }
    return { error: `Unknown zone: \`${rest}\`` };
  }

  // time may be "3:30pm" or "3:30" "pm"
  let i = 0;
  let timeTok = tokens[i++];
  if (i < tokens.length && /^(am|pm)$/i.test(tokens[i])) {
    timeTok = `${timeTok}${tokens[i++]}`;
  }
  const clock = parseTimeToken(timeTok);
  if (!clock || clock.kind !== 'clock') {
    return { error: 'Could not parse time. Examples: `15:30`, `3:30pm`, `now`.' };
  }

  const remaining = tokens.slice(i);
  if (remaining.length < 2) {
    return { error: 'Usage: `/tz <time> <fromZone> <toZone>`' };
  }

  // Find split: try progressive from-zone / to-zone partitions
  for (let split = 1; split < remaining.length; split++) {
    const fromRaw = remaining.slice(0, split).join(' ');
    const toRaw = remaining.slice(split).join(' ');
    const fromZone = resolveZone(fromRaw);
    const toZone = resolveZone(toRaw);
    if (fromZone && toZone) {
      return { kind: 'convert', clock, fromZone, toZone, fromLabel: fromRaw, toLabel: toRaw };
    }
  }

  return {
    error: `Could not resolve zones from: \`${remaining.join(' ')}\`. Use IANA ids (America/New_York) or cities (nyc, london).`,
  };
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'tz' && command !== 'convert') return { ignored: true };

  const args = String(payload.args || '').trim();
  if (!args || args.toLowerCase() === 'help') {
    await postToHaven(
      [
        '**Timezone convert**',
        '• `/tz <time> <from> <to>` — e.g. `/tz 3:30pm America/New_York Europe/London`',
        '• `/tz 15:00 nyc london`',
        '• `/tz now Tokyo`',
      ].join('\n')
    );
    return;
  }

  const parsed = parseConversion(args);
  if (parsed.error) {
    await postToHaven(
      parsed.error === 'usage'
        ? 'Usage: `/tz <time> <fromZone> <toZone>` or `/tz now <zone>`'
        : `❌ ${parsed.error}`
    );
    return;
  }

  if (parsed.kind === 'now') {
    const date = new Date();
    const lines = [
      '🕒 **Current time**',
      `**${parsed.zone}:** ${formatNice(date, parsed.zone)}`,
    ];
    if (parsed.also) {
      lines.push(`**${parsed.also}:** ${formatNice(date, parsed.also)}`);
    }
    await postToHaven(lines.join('\n').slice(0, 4000));
    return;
  }

  const utcDate = convertClock(parsed.clock, parsed.fromZone, parsed.toZone);
  const fromP = partsInZone(utcDate, parsed.fromZone);
  const toP = partsInZone(utcDate, parsed.toZone);
  const msg = [
    '🌐 **Timezone convert**',
    `**From:** ${formatParts(fromP, parsed.fromZone)}`,
    `**To:** ${formatParts(toP, parsed.toZone)}`,
    '',
    `_${formatNice(utcDate, parsed.fromZone)}_ → _${formatNice(utcDate, parsed.toZone)}_`,
  ].join('\n');
  await postToHaven(msg.slice(0, 4000));
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send('timezone-convert bot running. POST slash to /haven');
});
app.get('/health', (_req, res) => res.json({ ok: true }));

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
      await postToHaven('✅ Timezone-convert bot received a test event.');
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
  console.log(`timezone-convert bot listening on :${PORT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
