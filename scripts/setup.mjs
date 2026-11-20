#!/usr/bin/env node
/**
 * One command from a fresh clone to a runnable dev tree: workspace install,
 * then the package builds.
 *
 * Why the build is part of it: `apps/desktop` imports the built output of the
 * workspace packages (`@pi/types`, `@pi/ui`, `@pi/sdk-wrapper`,
 * `@pi/plugin-sdk`), and that output does not exist after `pnpm install`
 * alone — the app would fail to typecheck or start.
 *
 * Plugins are NOT here anymore. Each one is its own repository under the
 * PiWorkAgent organization and builds in its own CI; the app installs them
 * through the plugin market. To work on one with live reload:
 *
 *   git clone https://github.com/PiWorkAgent/PiWork-Plugin-Browser
 *   PI_DEV_PLUGINS=/path/to/PiWork-Plugin-Browser pnpm dev:desktop:plugins
 *
 * Usage: node scripts/setup.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(cmd, args) {
  console.log(`\n━━━ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd: REPO, stdio: 'inherit', env: process.env });
  if (res.error) {
    console.error(`[setup] failed to spawn ${cmd}: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`[setup] ${cmd} exited with ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

const major = Number(process.versions.node.split('.')[0]);
if (Number.isNaN(major) || major < 20) {
  console.error(`[setup] Node >= 20 required, found ${process.versions.node}`);
  process.exit(2);
}
if (!existsSync(join(REPO, 'pnpm-workspace.yaml')) || !existsSync(join(REPO, 'apps', 'desktop'))) {
  console.error(`[setup] does not look like the repo root: ${REPO}`);
  process.exit(2);
}

console.log('[setup] PiWork — dev setup');
run(PNPM, ['install']);
run(PNPM, ['build']);

console.log(`
✓ setup complete

next:
  pnpm dev:desktop   — desktop app (installs plugins from the market)
  pnpm dev:web       — web dev server
  plugin authoring   — PI_DEV_PLUGINS=/path/to/PiWork-Plugin-<Name> pnpm dev:desktop:plugins
`);
