// weather — Haven community bot
//
// Slash /weather <place> using Open-Meteo geocoding + forecast (no API key).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const TEMP_UNIT = String(process.env.TEMP_UNIT || 'celsius').toLowerCase() === 'fahrenheit'
  ? 'fahrenheit'
  : 'celsius';
const WIND_UNIT = (() => {
  const w = String(process.env.WIND_UNIT || 'kmh').toLowerCase();
  if (w === 'mph' || w === 'ms') return w;
  return 'kmh';
})();
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

const WMO = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function weatherEmoji(code) {
  if (code === 0 || code === 1) return '☀️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌤️';
}

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
      command: 'weather',
      description: 'Current weather for a place: /weather <place>',
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /weather');
  }
}

async function geocode(place) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'haven-bot-weather/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const json = await res.json();
  const hit = json.results && json.results[0];
  if (!hit) throw new Error(`Place not found: ${place}`);
  return {
    name: hit.name,
    country: hit.country || '',
    admin1: hit.admin1 || '',
    lat: hit.latitude,
    lon: hit.longitude,
    timezone: hit.timezone || 'auto',
  };
}

async function forecast(lat, lon, timezone) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
    temperature_unit: TEMP_UNIT,
    wind_speed_unit: WIND_UNIT,
    timezone: timezone || 'auto',
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'haven-bot-weather/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Forecast failed: ${res.status}`);
  return res.json();
}

function tempLabel() {
  return TEMP_UNIT === 'fahrenheit' ? '°F' : '°C';
}

function windLabel() {
  if (WIND_UNIT === 'mph') return 'mph';
  if (WIND_UNIT === 'ms') return 'm/s';
  return 'km/h';
}

function formatPlace(geo) {
  const bits = [geo.name];
  if (geo.admin1 && geo.admin1 !== geo.name) bits.push(geo.admin1);
  if (geo.country) bits.push(geo.country);
  return bits.join(', ');
}

function formatWeather(geo, data) {
  const cur = data.current || {};
  const code = cur.weather_code;
  const desc = WMO[code] || `Code ${code}`;
  const emoji = weatherEmoji(code);
  const t = cur.temperature_2m;
  const feels = cur.apparent_temperature;
  const hum = cur.relative_humidity_2m;
  const wind = cur.wind_speed_10m;
  const unit = tempLabel();
  const lines = [
    `${emoji} **${formatPlace(geo)}**`,
    `${t != null ? `${t}${unit}` : '—'} · ${desc}`,
  ];
  const meta = [];
  if (wind != null) meta.push(`Wind ${wind} ${windLabel()}`);
  if (hum != null) meta.push(`Humidity ${hum}%`);
  if (meta.length) lines.push(meta.join(' · '));
  if (feels != null) lines.push(`Feels like ${feels}${unit}`);
  return lines.join('\n').slice(0, 4000);
}

async function handleSlash(payload) {
  if (String(payload.command || '').toLowerCase() !== 'weather') return { ignored: true };
  const place = String(payload.args || '').trim();
  if (!place) {
    await postToHaven('Usage: `/weather <place>` (e.g. `/weather Tokyo`)');
    return;
  }
  try {
    const geo = await geocode(place.slice(0, 200));
    const data = await forecast(geo.lat, geo.lon, geo.timezone);
    await postToHaven(formatWeather(geo, data));
  } catch (err) {
    await postToHaven(`❌ Weather lookup failed: ${err.message}`.slice(0, 1500));
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`weather bot running. temp=${TEMP_UNIT} wind=${WIND_UNIT}`);
});
app.get('/health', (_req, res) => res.json({ ok: true, tempUnit: TEMP_UNIT, windUnit: WIND_UNIT }));

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
      await postToHaven('✅ Weather bot received a test event.');
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
  console.log(`weather bot listening on :${PORT}`);
  console.log(`  temp=${TEMP_UNIT} wind=${WIND_UNIT}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
