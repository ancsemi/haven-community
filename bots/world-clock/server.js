// world-clock — Haven community bot
//
// Slash /time <city or Zone> using Intl / IANA timezones.
// Optional TIMEZONES env list for /time board (multi-zone snapshot).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const TIMEZONES = (process.env.TIMEZONES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

// City / alias → IANA zone (subset of common lookups)
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
  bangalore: 'Asia/Kolkata',
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
  boston: 'America/New_York',
  miami: 'America/New_York',
  chicago: 'America/Chicago',
  dallas: 'America/Chicago',
  denver: 'America/Denver',
  phoenix: 'America/Phoenix',
  la: 'America/Los_Angeles',
  'los angeles': 'America/Los_Angeles',
  losangeles: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  sf: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  vancouver: 'America/Vancouver',
  toronto: 'America/Toronto',
  montreal: 'America/Toronto',
  mexico: 'America/Mexico_City',
  'mexico city': 'America/Mexico_City',
  saopaulo: 'America/Sao_Paulo',
  'sao paulo': 'America/Sao_Paulo',
  buenosaires: 'America/Argentina/Buenos_Aires',
  cairo: 'Africa/Cairo',
  johannesburg: 'Africa/Johannesburg',
  lagos: 'Africa/Lagos',
  nairobi: 'Africa/Nairobi',
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'time',
      description: 'Show time for a city/zone, or board if no args',
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /time');
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

  // Direct IANA zone (Europe/London, America/New_York, UTC, Etc/GMT+5)
  if (raw.includes('/') || raw.toUpperCase() === 'UTC' || raw.startsWith('Etc/')) {
    const z = raw === 'UTC' || raw.toUpperCase() === 'UTC' ? 'UTC' : raw;
    if (isValidZone(z)) return { zone: z, label: z };
  }

  const key = raw.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = key.replace(/\s+/g, '');
  const mapped = CITY_ZONES[key] || CITY_ZONES[compact];
  if (mapped && isValidZone(mapped)) return { zone: mapped, label: raw };

  // Try replacing spaces with underscores for America/New_York style
  const asZone = raw.replace(/\s+/g, '_');
  if (isValidZone(asZone)) return { zone: asZone, label: asZone };

  // Case-insensitive match against known city keys
  for (const [city, zone] of Object.entries(CITY_ZONES)) {
    if (city === key || city === compact) {
      if (isValidZone(zone)) return { zone, label: raw };
    }
  }

  return null;
}

function formatInZone(date, zone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  return dtf.format(date);
}

function offsetLabel(date, zone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    }).formatToParts(date);
    const tz = parts.find((p) => p.type === 'timeZoneName');
    return tz ? tz.value : '';
  } catch {
    return '';
  }
}

function formatSingle(resolved) {
  const now = new Date();
  const when = formatInZone(now, resolved.zone);
  const off = offsetLabel(now, resolved.zone);
  const lines = [
    `🌍 **${resolved.label}**`,
    `**${when}**`,
    `_Zone: \`${resolved.zone}\`${off ? ` · ${off}` : ''}_`,
  ];
  return lines.join('\n').slice(0, 4000);
}

function formatBoard(zones) {
  const now = new Date();
  if (!zones.length) {
    return (
      '🌍 **World clock**\n_No TIMEZONES configured. Use `/time <city or Zone>` ' +
      'or set TIMEZONES=Europe/London,America/New_York_'
    );
  }
  const lines = [`🌍 **World clock** · ${formatInZone(now, 'UTC')} UTC`];
  for (const z of zones) {
    const zone = z.includes('=') ? z.split('=')[1].trim() : z;
    const label = z.includes('=') ? z.split('=')[0].trim() : z;
    if (!isValidZone(zone)) {
      lines.push(`• **${label}** — invalid zone \`${zone}\``);
      continue;
    }
    lines.push(`• **${label}** — ${formatInZone(now, zone)}`);
  }
  return lines.join('\n').slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'time') return { ignored: true };

  const args = String(payload.args || '').trim();
  const sub = args.toLowerCase();

  if (!args || sub === 'board' || sub === 'list') {
    await postToHaven(formatBoard(TIMEZONES));
    return;
  }

  const resolved = resolveZone(args);
  if (!resolved) {
    await postToHaven(
      `❌ Unknown place or zone: **${args}**\nTry an IANA zone (\`Europe/London\`) or city (\`tokyo\`, \`nyc\`).\nOr \`/time\` / \`/time board\` for the configured board.`
    );
    return;
  }

  await postToHaven(formatSingle(resolved));
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`world-clock bot running. boardZones=${TIMEZONES.length}`);
});
app.get('/health', (_req, res) => res.json({ ok: true, boardZones: TIMEZONES.length }));

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
      await postToHaven('✅ World-clock bot received a test event.');
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
  console.log(`world-clock bot listening on :${PORT}`);
  console.log(`  board zones: ${TIMEZONES.length || 0}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
