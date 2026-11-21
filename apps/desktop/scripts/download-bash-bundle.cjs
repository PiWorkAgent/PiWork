#!/usr/bin/env node
/**
 * Download MinGit for bundling with the Windows installer.
 *
 * The **busybox** MinGit flavor is required here: standard MinGit ships NO
 * shell at all (no bash.exe, no ash.exe — only dash.exe), and the agent's bash
 * tool has no cmd.exe fallback, so a standard-MinGit bundle would leave every
 * clean Windows machine with a dead shell. The busybox flavor provides
 * ash.exe (busybox shell + coreutils: ls, cat, grep, sed, awk, find, mkdir,
 * rm, etc.) in a ~40 MB zip. injectBundledShell (src/main/index.ts) searches
 * mingw64/bin for bash.exe then ash.exe and finds ash.exe here. The bundle is
 * placed in bash-bundle/ and included as extraResources in the Windows NSIS
 * installer.
 *
 * Caching:
 *   - bash-bundle/.version tracks the downloaded release tag
 *   - If .version matches the target → skip download
 *   - If network fails but cached bundle exists → reuse it
 *   - --force bypasses all caching
 *
 * Version pinning:
 *   GIT_FOR_WINDOWS_VERSION=v2.54.0.windows.1  (pin to a specific release)
 *   GIT_FOR_WINDOWS_VERSION=latest              (auto-detect, default)
 *
 * Proxy support:
 *   Reads https_proxy / HTTPS_PROXY / all_proxy / ALL_PROXY env vars.
 *   Creates an HTTP CONNECT tunnel for HTTPS requests through HTTP proxies.
 *
 * Usage: node scripts/download-bash-bundle.cjs [--force]
 */

const https = require('https');
const http = require('http');
const tls = require('tls');
const { URL } = require('url');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

const FORCE = process.argv.includes('--force');
// Escape hatch for a deliberately shell-less/source-only build. The default is
// to FAIL when no usable bundle is on disk: the copy is only a warning in
// electron-builder, so a silent no-op here used to ship a green Windows
// installer whose agent had no shell at all.
const ALLOW_MISSING = process.argv.includes('--allow-missing');
const PINNED_VERSION = process.env.GIT_FOR_WINDOWS_VERSION || 'latest';
const APPS_DIR = path.resolve(__dirname, '..');
const BUNDLE_DIR = path.join(APPS_DIR, 'bash-bundle');
const VERSION_FILE = path.join(BUNDLE_DIR, '.version');
const TEMP_DIR = path.join(APPS_DIR, '.bash-bundle-tmp');

// ── Proxy ───────────────────────────────────────────────────────────────────
//
// Node's https module doesn't respect https_proxy env vars, so we detect them
// ourselves and create an HTTP CONNECT proxy agent.

function detectProxy(targetUrl) {
  const proto = targetUrl.startsWith('https') ? 'https' : 'http';
  const candidates = [
    process.env[`${proto}_proxy`],
    process.env[`${proto}_proxy`.toUpperCase()],
    process.env.all_proxy,
    process.env.ALL_PROXY,
  ];
  for (const c of candidates) {
    if (c && c.trim() && !c.startsWith('socks')) return c.trim();
  }
  return null;
}

/**
 * HTTPS-over-HTTP-CONNECT agent.
 *
 * `new https.Agent({ createConnection })` is NOT a thing — Agent ignores that
 * constructor option (it calls the prototype method), so the old version here
 * silently went direct and failed on proxy-only networks. Subclassing and
 * overriding the method is the supported route; the returned socket must also
 * be TLS-wrapped, since https.Agent expects a secure socket.
 */
class HttpsProxyAgent extends https.Agent {
  constructor(proxyUrl) {
    super({ keepAlive: false });
    this.proxy = new URL(proxyUrl);
    this.proxyAuth = this.proxy.username
      ? 'Basic ' +
        Buffer.from(
          `${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`,
        ).toString('base64')
      : null;
  }

  createConnection(options, callback) {
    const host = options.host;
    const port = options.port || 443;
    const headers = { Host: `${host}:${port}` };
    if (this.proxyAuth) headers['Proxy-Authorization'] = this.proxyAuth;

    const req = http.request({
      host: this.proxy.hostname,
      port: parseInt(this.proxy.port, 10) || 3128,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers,
      agent: false,
    });
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        callback(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
        return;
      }
      const secure = tls.connect(
        { socket, servername: options.servername || host },
        () => callback(null, secure),
      );
      secure.once('error', callback);
    });
    req.once('error', callback);
    req.end();
  }
}

function createProxyAgent(proxyUrl) {
  return new HttpsProxyAgent(proxyUrl);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[bash-bundle] ${msg}`); }
function warn(msg) { console.warn(`[bash-bundle] WARN: ${msg}`); }

function httpsGet(url) {
  const opts = { headers: { 'User-Agent': 'pi-coding-agent-builder' } };
  const proxy = detectProxy(url);
  if (proxy) opts.agent = createProxyAgent(proxy);
  return new Promise((resolve, reject) => {
    https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function httpsGetJson(url) {
  const res = await httpsGet(url);
  let body = '';
  for await (const chunk of res) body += chunk;
  return JSON.parse(body);
}

async function downloadFile(url, destPath) {
  log(`Downloading ${url}`);
  const res = await httpsGet(url);
  const file = fs.createWriteStream(destPath);
  await streamPipeline(res, file);
  log(`Saved to ${destPath}`);
}

function rmdir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function extractZip(zipPath, destDir) {
  rmdir(destDir);
  fs.mkdirSync(destDir, { recursive: true });

  if (process.platform === 'win32') {
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { stdio: 'inherit' },
    );
  } else if (process.platform === 'darwin') {
    // ditto handles Windows-created symlinks correctly, unlike unzip.
    execSync(`ditto -x -k "${zipPath}" "${destDir}"`, { stdio: 'inherit' });
  } else {
    try {
      execSync(`7z x -o"${destDir}" "${zipPath}" -y`, { stdio: 'pipe' });
    } catch {
      execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
    }
  }
}

function getCachedVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      return fs.readFileSync(VERSION_FILE, 'utf-8').trim();
    }
  } catch {}
  return null;
}

/** A bundle the app can actually use (injectBundledShell's search order). */
function hasUsableBundle() {
  const candidates = [
    'ucrt64/bin/bash.exe',
    'ucrt64/bin/ash.exe',
    'mingw64/bin/bash.exe',
    'mingw64/bin/ash.exe',
    'bin/bash.exe',
    'bin/ash.exe',
    'usr/bin/bash.exe',
  ];
  return candidates.some((rel) => fs.existsSync(path.join(BUNDLE_DIR, rel)));
}

/**
 * End the run after a failure: reuse an existing bundle, or stop the build
 * instead of producing an installer with a dead shell.
 */
function failWithoutBundle(reason) {
  if (hasUsableBundle()) {
    log(`Reusing existing bundle — ${reason}`);
    return;
  }
  if (ALLOW_MISSING) {
    warn(`${reason} — continuing WITHOUT a bundled shell (--allow-missing).`);
    return;
  }
  throw new Error(
    `${reason} — no usable bash bundle. Refusing to build a Windows package ` +
    'with no shell. Fix the network/proxy, set GIT_FOR_WINDOWS_VERSION to a ' +
    'reachable release, provide bash-bundle/ yourself, or pass --allow-missing.',
  );
}

function dirSize(dir) {
  let size = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) {
        try { size += fs.statSync(path.join(entry.parentPath || dir, entry.name)).size; } catch {}
      }
    }
  } catch {}
  return size;
}

// ── API ─────────────────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com/repos/git-for-windows/git/releases/latest';
const PINNED_RE = /^v\d+\.\d+\.\d+\.windows\.\d+$/;

/**
 * Resolve target tag and assets. Makes ONE API call for the 'latest' case.
 * For pinned versions, fetches from the tag-specific endpoint.
 */
async function resolveRelease() {
  let tag, assets;

  if (PINNED_VERSION !== 'latest' && PINNED_RE.test(PINNED_VERSION)) {
    tag = PINNED_VERSION;
    log(`Using pinned version: ${tag}`);
  } else {
    log('Fetching latest Git for Windows release...');
    const data = await httpsGetJson(GITHUB_API);
    tag = data.tag_name;
    assets = data.assets;
    log(`Latest release: ${tag}`);
  }

  // For pinned versions, we still need the assets list
  if (!assets) {
    const data = await httpsGetJson(
      `https://api.github.com/repos/git-for-windows/git/releases/tags/${tag}`,
    );
    assets = data.assets;
  }

  return { tag, assets };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const cachedVersion = getCachedVersion();

  // ── Cache check ──
  if (!FORCE && cachedVersion) {
    // Pinned version matches cache → skip
    if (PINNED_VERSION !== 'latest' && cachedVersion === PINNED_VERSION) {
      log(`Bundle exists with pinned version ${cachedVersion}. Skipping.`);
      return;
    }
    // Latest → check if remote version changed
    if (PINNED_VERSION === 'latest') {
      try {
        const data = await httpsGetJson(GITHUB_API);
        if (cachedVersion === data.tag_name) {
          log(`Bundle is up to date (${cachedVersion}). Skipping.`);
          return;
        }
        log(`Update available: ${cachedVersion} → ${data.tag_name}. Re-downloading...`);
      } catch {
        log(`Cannot check for updates (network error). Reusing cached ${cachedVersion}.`);
        return;
      }
    }
  }

  if (FORCE) log('--force: re-downloading bundle.');

  // ── Resolve release ──
  let tag, assets;
  try {
    const result = await resolveRelease();
    tag = result.tag;
    assets = result.assets;
  } catch (err) {
    warn(`Failed to resolve release: ${err.message}`);
    if (cachedVersion) {
      log(`Reusing cached bundle (${cachedVersion}).`);
      return;
    }
    failWithoutBundle('Failed to resolve the Git for Windows release');
    return;
  }

  // ── Find asset ──
  //
  // The version segment in the asset name no longer matches the tag: upstream
  // ships `MinGit-2.56.0.4-busybox-64-bit.zip` for `v2.56.0.windows.4`, while
  // older releases used `MinGit-2.54.0-...`. Reconstructing the name from the
  // tag therefore finds nothing and the release silently ships without bash —
  // so match the known-good exact name first, then fall back to the shape.
  const cleanVersion = tag.replace(/^v/, '').replace(/\.windows\.\d+$/, '');
  // busybox flavor — see the header comment for why standard MinGit is not usable.
  // Upstream names x64 `…-64-bit.zip` and arm64 `…-arm64.zip`; picking the
  // x64 tree for an arm64 installer only worked under x64 emulation (and not
  // at all on Windows 10 ARM).
  const archToken =
    process.argv.includes('--arm64') || process.arch === 'arm64' ? 'arm64' : '64-bit';
  const assetName = `MinGit-${cleanVersion}-busybox-${archToken}.zip`;
  const asset =
    assets.find((a) => a.name === assetName) ??
    assets.find((a) => new RegExp(`^MinGit-[\\d.]+-busybox-${archToken}\\.zip$`, 'i').test(a.name));

  if (!asset) {
    warn(`Asset "${assetName}" (or any MinGit-*-busybox-${archToken}.zip) not found in release ${tag}.`);
    if (cachedVersion) return log(`Reusing cached (${cachedVersion}).`);
    failWithoutBundle(`No busybox MinGit asset for ${process.arch} in ${tag}`);
    return;
  }

  log(`Found ${assetName} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);

  // ── Download ──
  const zipPath = path.join(APPS_DIR, '.mingit-tmp.zip');
  try {
    await downloadFile(asset.browser_download_url, zipPath);
  } catch (err) {
    warn(`Download failed: ${err.message}`);
    try { fs.unlinkSync(zipPath); } catch {}
    if (cachedVersion) {
      log(`Reusing cached bundle (${cachedVersion}).`);
      return;
    }
    failWithoutBundle('Download failed');
    return;
  }

  // ── Extract ──
  try {
    extractZip(zipPath, TEMP_DIR);
  } catch (err) {
    warn(`Extraction failed: ${err.message}`);
    try { fs.unlinkSync(zipPath); } catch {}
    rmdir(TEMP_DIR);
    failWithoutBundle('Extraction failed');
    return;
  }

  // ── Copy to bundle dir ──
  // MinGit 2.54+ zips may or may not have a top-level wrapper directory.
  // Handle both cases: single wrapper dir → copy contents of that dir;
  // multiple top-level entries → copy everything.
  const entries = fs.readdirSync(TEMP_DIR, { withFileTypes: true });
  if (entries.length === 0) {
    rmdir(TEMP_DIR);
    failWithoutBundle('Extracted archive was empty');
    return;
  }

  const dirs = entries.filter((d) => d.isDirectory());
  const files = entries.filter((d) => !d.isDirectory());

  rmdir(BUNDLE_DIR);
  fs.mkdirSync(BUNDLE_DIR, { recursive: true });

  let copySource;
  if (dirs.length === 1 && files.length === 0) {
    // Single directory wrapper (e.g. MinGit-2.54.0-busybox-64-bit/)
    copySource = path.join(TEMP_DIR, dirs[0].name);
  } else {
    // No wrapper — copy all entries individually to avoid nesting issues
    copySource = TEMP_DIR;
  }

  log(`Copying to ${BUNDLE_DIR}...`);

  if (copySource === TEMP_DIR) {
    // Copy each entry individually.
    for (const entry of entries) {
      const src = path.join(TEMP_DIR, entry.name);
      fs.cpSync(src, path.join(BUNDLE_DIR, entry.name), { recursive: true });
    }
  } else {
    fs.cpSync(copySource, BUNDLE_DIR, { recursive: true });
  }

  // ── Verify the copy actually produced a shell ──
  // The copy can "succeed" while extracting an archive shape we do not
  // recognize; the build must not continue on that.
  if (!hasUsableBundle()) {
    rmdir(BUNDLE_DIR);
    try { fs.unlinkSync(zipPath); } catch {}
    rmdir(TEMP_DIR);
    throw new Error(
      `Extracted MinGit ${tag} has no usable shell (searched ucrt64/bin, mingw64/bin, bin)`,
    );
  }

  // ── Version marker ──
  fs.writeFileSync(VERSION_FILE, tag, 'utf-8');

  // ── Report ──
  const sizeMB = (dirSize(BUNDLE_DIR) / 1024 / 1024).toFixed(1);
  log(`Bundle ready: ${tag} (${sizeMB} MB)`);

  // ── Cleanup ──
  try { fs.unlinkSync(zipPath); } catch {}
  rmdir(TEMP_DIR);
}

main().catch((err) => {
  warn(`Unexpected error: ${err.message}`);
  if (ALLOW_MISSING || hasUsableBundle()) {
    warn('Continuing with the existing (or explicitly waived) bundle.');
    process.exit(0);
  }
  console.error(
    '[bash-bundle] ERROR: no usable shell bundle. The Windows installer would ship ' +
    'without a shell — failing the build. (Pass --allow-missing to override.)',
  );
  process.exit(1);
});
