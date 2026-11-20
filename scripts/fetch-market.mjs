#!/usr/bin/env node
/**
 * Download the published plugin market into a directory, so the installer can
 * bundle an offline snapshot of it.
 *
 * Why this exists: the plugins live in their own repositories now, aggregated
 * by `PiWorkAgent/PiWork-Registry` into one index. Packaging no longer
 * builds them, it fetches the newest registry release. The snapshot is what a
 * fresh install uses when the hosted registry is unreachable (see
 * PluginMarketplace's fallback), so a packaged app can install plugins without
 * any network at all.
 *
 * Only OFFICIAL plugins are bundled: each entry was downloaded from the
 * publisher's own release, and shipping a community plugin inside the installer
 * would redistribute third-party code the user never chose. Community plugins
 * stay online-only.
 *
 * Integrity: every zip is checked against the index's sha256. A mismatch
 * fails the packaging run — shipping a snapshot the app would refuse to
 * install is worse than failing here.
 *
 * Usage:
 *   node scripts/fetch-market.mjs [--out <dir>] [--index <url>] [--tag <tag>] [--all]
 *
 *   --out    output directory (default: market-dist, relative to cwd)
 *   --index  index URL (default: the registry's latest release)
 *   --tag    use the index of a specific registry release tag
 *   --all    bundle every entry, not just `official: true` (local testing)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const REGISTRY_SLUG = 'PiWorkAgent/PiWork-Registry';
const LATEST_INDEX = `https://github.com/${REGISTRY_SLUG}/releases/latest/download/index.json`;

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${name} needs a value`);
    process.exit(2);
  }
  return value;
}

const OUT = resolve(argValue('--out', 'market-dist'));
const TAG = argValue('--tag', null);
const INCLUDE_COMMUNITY = process.argv.includes('--all');
const INDEX_URL = (() => {
  const value =
    argValue('--index', null) ??
    (TAG ? `https://github.com/${REGISTRY_SLUG}/releases/download/${TAG}/index.json` : LATEST_INDEX);
  // A local index (test fixtures, a market copied off a machine) is given as a
  // path, commonly relative to the cwd — resolve it so fetchBytes sees an
  // absolute path instead of trying to fetch "market-dist/index.json".
  return isAbsolute(value) || /^https?:/i.test(value) ? value : resolve(value);
})();

async function fetchBytes(url) {
  if (isAbsolute(url)) {
    const { readFileSync } = await import('node:fs');
    return readFileSync(url);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Relative entries resolve against the index URL; GitHub redirects each one. */
function entryUrl(url) {
  if (isAbsolute(url) || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (/^https?:/i.test(INDEX_URL)) return new URL(url, INDEX_URL).toString();
  return join(dirname(INDEX_URL), url);
}

/** Asset name for the local copy, whether the entry was a URL or a path. */
function assetName(url, fallback) {
  try {
    const path = /^https?:/i.test(url) ? new URL(url).pathname : url;
    // URL pathnames are percent-encoded; a third-party asset with a space or
    // non-ASCII character must still land on disk under its real name.
    return decodeURIComponent(basename(path)) || fallback;
  } catch {
    return fallback;
  }
}

console.log(`[market] index: ${INDEX_URL}`);
const index = JSON.parse((await fetchBytes(INDEX_URL)).toString('utf-8'));
if (!index || !Array.isArray(index.plugins) || index.plugins.length === 0) {
  throw new Error('market index has no plugins — publish the registry first');
}

const selected = INCLUDE_COMMUNITY
  ? index.plugins
  : index.plugins.filter((entry) => entry.official === true);
const skipped = index.plugins.length - selected.length;
if (skipped > 0) console.log(`[market] ${skipped} community plugin(s) not bundled`);
if (selected.length === 0) {
  throw new Error('no official plugins in the index — refusing to bundle an empty market');
}

mkdirSync(OUT, { recursive: true });
const entries = [];
for (const entry of selected) {
  const from = entryUrl(entry.url);
  const fileName = assetName(from, `${entry.id}.zip`);
  const bytes = await fetchBytes(from);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (!entry.sha256 || actual !== entry.sha256.toLowerCase()) {
    throw new Error(`integrity check failed for ${entry.id} (sha256 mismatch)`);
  }
  writeFileSync(join(OUT, fileName), bytes);
  // Bundled entries must point at the LOCAL copy: the snapshot is for offline
  // installs, and an absolute URL would send the app back to the network.
  entries.push({ ...entry, url: fileName });
  console.log(`  ${entry.id.padEnd(18)} v${entry.version.padEnd(10)} ${fileName}`);
}

writeFileSync(
  join(OUT, 'index.json'),
  `${JSON.stringify({ ...index, plugins: entries }, null, 2)}\n`,
);
console.log(`[market] wrote ${entries.length} plugin(s) to ${OUT}`);
