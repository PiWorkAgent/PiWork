#!/usr/bin/env node
/**
 * electron-builder wrapper: removes the workspace symlinks electron-builder
 * cannot follow, runs the builder, and ALWAYS restores the links afterwards
 * (including on failure / Ctrl-C), so a local pack no longer leaves the dev
 * tree requiring `pnpm install` again.
 *
 * Usage: node scripts/run-pack.cjs --mac|--win|--linux [...electron-builder args]
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { prepareForPack, restoreWorkspaceSymlinks } = require('./prepare-pack.cjs');

const appDir = path.resolve(__dirname, '..');

let cli;
try {
  cli = path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js');
} catch {
  console.error('[pack] electron-builder is not installed in apps/desktop — run pnpm install.');
  process.exit(1);
}

const removed = prepareForPack();
let status = 1;
try {
  const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
    cwd: appDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error('[pack] failed to start electron-builder:', result.error.message);
    status = 1;
  } else {
    status = result.status ?? 1;
  }
} finally {
  restoreWorkspaceSymlinks(removed);
}

process.exit(status);
