// npm-releases — Haven community bot
//
// Polls registry.npmjs.org for PACKAGE_NAMES and posts when a new version
// appears. First poll primes state only (no flood).
//
// See README.md for setup. Configuration is via environment variables only.

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const HAVEN_WEBHOOK_URL = process.env.HAVEN_WEBHOOK_URL;
const PACKAGE_NAMES = (process.env.PACKAGE_NAMES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HAVEN_USERNAME = process.env.HAVEN_USERNAME || '';
const HAVEN_AVATAR_URL = process.env.HAVEN_AVATAR_URL || '';
const POLL_INTERVAL_SEC = Math.max(60, parseInt(process.env.POLL_INTERVAL_SEC || '600', 10) || 600);
const INCLUDE_PRERELEASES =
  String(process.env.INCLUDE_PRERELEASES || 'false').toLowerCase() === 'true';
const STATE_FILE = process.env.STATE_FILE || './data/npm-releases-state.json';
const REGISTRY_BASE = (process.env.REGISTRY_BASE || 'https://registry.npmjs.org').replace(
  /\/$/,
  ''
);
const POST_MESSAGE =
  process.env.POST_MESSAGE ||
  '📦 **npm release** — `{package}`\n**{version}**\n{url}\n_{time}_';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!HAVEN_WEBHOOK_URL) {
  console.error('FATAL: HAVEN_WEBHOOK_URL is required.');
  process.exit(1);
}
if (!PACKAGE_NAMES.length) {
  console.error(
    'FATAL: PACKAGE_NAMES must list at least one package (e.g. express,lodash,@scope/pkg).'
  );
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    return { versions: j.versions && typeof j.versions === 'object' ? j.versions : {} };
  } catch {
    return { versions: {} };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();

// Semver-ish prerelease: anything with a hyphen after the core (1.0.0-beta.1)
function hasPreTag(version) {
  const v = String(version || '');
  const core = v.split('+')[0];
  return core.includes('-');
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

function formatRelease(pkg, version, meta) {
  const url = `https://www.npmjs.com/package/${pkg}/v/${encodeURIComponent(version)}`;
  const time = meta && meta.time ? meta.time : '';
  return POST_MESSAGE.replaceAll('\\n', '\n')
    .replaceAll('{package}', pkg)
    .replaceAll('{version}', version)
    .replaceAll('{url}', url)
    .replaceAll('{time}', time)
    .replaceAll('{description}', (meta && meta.description) || '')
    .slice(0, 4000);
}

async function fetchPackage(pkg) {
  const pathUrl = pkg.startsWith('@')
    ? `${REGISTRY_BASE}/${pkg.split('/').map(encodeURIComponent).join('/')}`
    : `${REGISTRY_BASE}/${encodeURIComponent(pkg)}`;

  const res = await fetch(pathUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'haven-bot-npm-releases/1.0',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) throw new Error(`package not found: ${pkg}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${pkg} → ${res.status}: ${text.slice(0, 150)}`);
  }
  return res.json();
}

function pickVersions(doc) {
  const versions = Object.keys(doc.versions || {});
  const times = doc.time || {};
  // Prefer “latest” dist-tag as primary signal; also track all published
  const distTags = doc['dist-tags'] || {};
  const latest = distTags.latest || '';
  return { versions, times, latest, distTags, description: doc.description || '' };
}

async function pollPackage(pkg) {
  const doc = await fetchPackage(pkg);
  const { times, latest, description } = pickVersions(doc);

  if (!latest) {
    console.warn(`[${new Date().toISOString()}] ${pkg}: no dist-tags.latest`);
    return;
  }

  if (hasPreTag(latest) && !INCLUDE_PRERELEASES) {
    // Still prime/update state so we don't spam when they flip to stable later incorrectly
  }

  const prev = state.versions[pkg];
  if (prev == null) {
    state.versions[pkg] = latest;
    saveState(state);
    console.log(
      `[${new Date().toISOString()}] primed ${pkg}@${latest} (no post to Haven)`
    );
    return;
  }

  if (prev === latest) return;

  if (hasPreTag(latest) && !INCLUDE_PRERELEASES) {
    state.versions[pkg] = latest;
    saveState(state);
    console.log(
      `[${new Date().toISOString()}] skipped prerelease ${pkg}@${latest}`
    );
    return;
  }

  const meta = {
    time: times[latest] || '',
    description,
  };
  await postToHaven(formatRelease(pkg, latest, meta));
  state.versions[pkg] = latest;
  saveState(state);
  console.log(`[${new Date().toISOString()}] posted ${pkg}@${latest} (was ${prev})`);
}

async function pollAll() {
  for (const pkg of PACKAGE_NAMES) {
    try {
      await pollPackage(pkg);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] poll failed ${pkg}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

const app = express();

app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      `npm-releases bot running. packages=${PACKAGE_NAMES.length} poll=${POLL_INTERVAL_SEC}s`
    );
});
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    packages: PACKAGE_NAMES,
    pollIntervalSec: POLL_INTERVAL_SEC,
    versions: state.versions,
  })
);
app.post('/poll', async (_req, res) => {
  try {
    await pollAll();
    res.json({ ok: true, versions: state.versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`npm-releases bot listening on :${PORT}`);
  console.log(`  packages: ${PACKAGE_NAMES.join(', ')}`);
  console.log(`  poll every ${POLL_INTERVAL_SEC}s; prereleases=${INCLUDE_PRERELEASES}`);
  pollAll().catch((e) => console.error('initial poll:', e.message));
  setInterval(() => {
    pollAll().catch((e) => console.error('poll:', e.message));
  }, POLL_INTERVAL_SEC * 1000);
});
