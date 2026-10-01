// crypto — Haven community bot
//
// Slash /crypto <symbol> via CoinGecko simple price API (no API key).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const crypto = require('crypto');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || '';
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const VS_CURRENCY = String(process.env.VS_CURRENCY || 'usd').toLowerCase().replace(/[^a-z]/g, '') || 'usd';
const HAVEN_WEBHOOK_TOKEN = (process.env.HAVEN_WEBHOOK_TOKEN || '').trim();
const PORT = parseInt(process.env.PORT || '3000', 10);
const COINGECKO_SIMPLE = 'https://api.coingecko.com/api/v3/simple/price';
const COINGECKO_SEARCH = 'https://api.coingecko.com/api/v3/search';

if (!HAVEN_WEBHOOK_URL || !CALLBACK_SECRET) {
  console.error('FATAL: HAVEN_WEBHOOK_URL and CALLBACK_SECRET are both required.');
  process.exit(1);
}

// Common tickers → CoinGecko ids (fallback when search is slow/unavailable)
const SYMBOL_MAP = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  doge: 'dogecoin',
  xrp: 'ripple',
  ada: 'cardano',
  dot: 'polkadot',
  avax: 'avalanche-2',
  matic: 'matic-network',
  pol: 'polygon-ecosystem-token',
  link: 'chainlink',
  ltc: 'litecoin',
  bnb: 'binancecoin',
  atom: 'cosmos',
  near: 'near',
  apt: 'aptos',
  arb: 'arbitrum',
  op: 'optimism',
  sui: 'sui',
  pepe: 'pepe',
  shib: 'shiba-inu',
  uni: 'uniswap',
  aave: 'aave',
  trx: 'tron',
  ton: 'the-open-network',
  xmr: 'monero',
  etc: 'ethereum-classic',
  bch: 'bitcoin-cash',
  usdt: 'tether',
  usdc: 'usd-coin',
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
      command: 'crypto',
      description: 'Crypto price: /crypto <symbol or id>',
    }),
  });
  if (!res.ok) {
    console.warn(`[commands] register failed: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    console.log('[commands] registered /crypto');
  }
}

function normalizeQuery(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^\$/, '')
    .split(/\s+/)[0]
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 64);
}

async function resolveCoinId(query) {
  if (!query) return null;
  if (SYMBOL_MAP[query]) return { id: SYMBOL_MAP[query], symbol: query, name: SYMBOL_MAP[query] };

  // Treat hyphenated strings as possible CoinGecko ids first
  if (query.includes('-') || query.length > 6) {
    return { id: query, symbol: query, name: query };
  }

  const url = `${COINGECKO_SEARCH}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'haven-bot-crypto/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    // Fall back: try query as id
    return { id: query, symbol: query, name: query };
  }
  const data = await res.json();
  const coins = Array.isArray(data.coins) ? data.coins : [];
  if (!coins.length) return null;

  const bySymbol = coins.find((c) => String(c.symbol || '').toLowerCase() === query);
  const hit = bySymbol || coins[0];
  return {
    id: hit.id,
    symbol: String(hit.symbol || query).toLowerCase(),
    name: hit.name || hit.id,
  };
}

async function fetchPrice(coinId) {
  const params = new URLSearchParams({
    ids: coinId,
    vs_currencies: VS_CURRENCY,
    include_24hr_change: 'true',
    include_market_cap: 'true',
    include_24hr_vol: 'true',
  });
  const url = `${COINGECKO_SIMPLE}?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'haven-bot-crypto/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  const data = await res.json();
  return data[coinId] || null;
}

function formatMoney(n, currency) {
  if (n == null || !Number.isFinite(Number(n))) return 'n/a';
  const v = Number(n);
  const cur = currency.toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: v < 1 ? 6 : 2,
    }).format(v);
  } catch {
    return `${v} ${cur}`;
  }
}

function formatCompact(n) {
  if (n == null || !Number.isFinite(Number(n))) return 'n/a';
  try {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(Number(n));
  } catch {
    return String(n);
  }
}

function formatPrice(meta, priceRow) {
  const cur = VS_CURRENCY;
  const price = priceRow[cur];
  const change = priceRow[`${cur}_24h_change`];
  const mcap = priceRow[`${cur}_market_cap`];
  const vol = priceRow[`${cur}_24h_vol`];
  const changeStr =
    change == null || !Number.isFinite(Number(change))
      ? 'n/a'
      : `${Number(change) >= 0 ? '+' : ''}${Number(change).toFixed(2)}%`;
  const arrow = Number(change) > 0 ? '📈' : Number(change) < 0 ? '📉' : '➖';
  const sym = (meta.symbol || meta.id || '').toUpperCase();
  const lines = [
    `🪙 **${meta.name || meta.id}** (${sym})`,
    `**${formatMoney(price, cur)}** ${arrow} 24h: **${changeStr}**`,
  ];
  if (mcap != null) lines.push(`Market cap: ${formatCompact(mcap)} ${cur.toUpperCase()}`);
  if (vol != null) lines.push(`24h vol: ${formatCompact(vol)} ${cur.toUpperCase()}`);
  lines.push(`_via CoinGecko · ${meta.id}_`);
  return lines.join('\n').slice(0, 4000);
}

async function handleSlash(payload) {
  const command = String(payload.command || '').toLowerCase();
  if (command !== 'crypto') return { ignored: true };

  const query = normalizeQuery(payload.args);
  if (!query) {
    await postToHaven('Usage: `/crypto <symbol>` e.g. `/crypto btc` or `/crypto ethereum`');
    return;
  }

  try {
    const meta = await resolveCoinId(query);
    if (!meta || !meta.id) {
      await postToHaven(`No coin found for **${query}**.`);
      return;
    }
    const row = await fetchPrice(meta.id);
    if (!row) {
      await postToHaven(`No price data for **${meta.id}**. Try a CoinGecko id (e.g. \`bitcoin\`).`);
      return;
    }
    await postToHaven(formatPrice(meta, row));
  } catch (err) {
    await postToHaven(`❌ ${err.message}`);
  }
}

const app = express();
app.use('/haven', express.raw({ type: '*/*', limit: '256kb' }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(`crypto bot running. vs=${VS_CURRENCY}`);
});
app.get('/health', (_req, res) => res.json({ ok: true, vs: VS_CURRENCY }));

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
      await postToHaven('✅ Crypto bot received a test event.');
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
  console.log(`crypto bot listening on :${PORT}`);
  console.log(`  vs currency: ${VS_CURRENCY}`);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[commands]', e.message);
  }
});
