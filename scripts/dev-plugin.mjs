#!/usr/bin/env node
/**
 * Launch the desktop app with a plugin CHECKOUT as a dev plugin root.
 *
 * This is the PLUGIN-AUTHORING mode. `pnpm dev:desktop` (the default) runs the
 * customer path instead: plugins come from `~/.pi/agent/plugins/`, installed
 * and updated through the plugin center's market. Use this script when the
 * point is to see edits to a plugin's source immediately.
 *
 * The plugins live in their own repositories (PiWorkAgent/PiWork-Plugin-*), so
 * the checkout is named explicitly — there is no in-repo default anymore:
 *
 *   PI_DEV_PLUGINS=/path/to/PiWork-Plugin-Browser pnpm dev:desktop:plugins
 *
 * Why the env var exists: the plugin registry resolves roots by priority
 * (dev 3 > user 2), and `~/.pi/agent/plugins/` — the user root — always
 * shadows a checkout below it. So without `PI_DEV_PLUGINS`, edits are never
 * loaded and the app silently runs whatever stale copy sits in
 * `~/.pi/agent/plugins/`. That has repeatedly looked like "my change had no
 * effect".
 *
 * Usage:  PI_DEV_PLUGINS=<checkout> node scripts/dev-plugin.mjs [extra args for electron-vite]
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const DEV_ROOT = process.env.PI_DEV_PLUGINS ? resolve(process.env.PI_DEV_PLUGINS) : null;

if (!DEV_ROOT) {
  console.error('[dev-plugin] set PI_DEV_PLUGINS to a plugin checkout, e.g.:');
  console.error('[dev-plugin]   git clone https://github.com/PiWorkAgent/PiWork-Plugin-Browser');
  console.error('[dev-plugin]   PI_DEV_PLUGINS=/path/to/PiWork-Plugin-Browser pnpm dev:desktop:plugins');
  process.exit(1);
}

if (!existsSync(join(DEV_ROOT, 'manifest.json'))) {
  console.error(`[dev-plugin] ${DEV_ROOT} does not look like a plugin checkout (no manifest.json)`);
  console.error('[dev-plugin] point PI_DEV_PLUGINS at the root of one plugin repository');
  process.exit(1);
}

process.env.PI_DEV_PLUGINS = DEV_ROOT;

// ── Make it visually unambiguous which root is live ────────────────────
console.log(`[dev-plugin] plugin-authoring mode (checkout plugins win over user copies)`);
console.log(`[dev-plugin] PI_DEV_PLUGINS = ${DEV_ROOT}`);

try {
  const userRoot = join(homedir(), '.pi', 'agent', 'plugins');
  const devIds = readdirSync(DEV_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(DEV_ROOT, d.name, 'manifest.json')))
    .map((d) => d.name);
  const userIds = existsSync(userRoot)
    ? readdirSync(userRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(userRoot, d.name, 'manifest.json')))
        .map((d) => d.name)
    : [];
  const shadowed = devIds.filter((id) => userIds.includes(id));
  console.log(`[dev-plugin] dev plugins   : ${devIds.join(', ') || '(none)'}`);
  if (shadowed.length) {
    console.log(`[dev-plugin] shadowing ${shadowed.length} user copy/copies: ${shadowed.join(', ')}`);
  }
} catch (err) {
  console.warn('[dev-plugin] could not enumerate plugin roots:', err.message);
}

// ── Launch ─────────────────────────────────────────────────────────────
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const pnpmArgs = ['--filter', '@pi/desktop', 'dev', ...process.argv.slice(2)];
// `.cmd` shims need a shell on Node ≥20.12 (EINVAL); quote args because the
// repo path may contain spaces.
const quoteArg = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
const child =
  process.platform === 'win32'
    ? spawn([pnpm, ...pnpmArgs].map(quoteArg).join(' '), {
        stdio: 'inherit',
        env: process.env,
        cwd: REPO,
        shell: true,
      })
    : spawn(pnpm, pnpmArgs, {
        stdio: 'inherit',
        env: process.env,
        cwd: REPO,
      });

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
