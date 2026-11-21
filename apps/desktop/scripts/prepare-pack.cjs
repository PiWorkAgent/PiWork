#!/usr/bin/env node
/**
 * Prepare for electron-builder packaging.
 *
 * pnpm creates symlinks for workspace packages (node_modules/@pi/sdk-wrapper →
 * ../../../packages/sdk-wrapper). electron-builder follows these symlinks and
 * tries to include files from outside the app directory, which fails.
 *
 * `prepareForPack()` removes them and returns what it removed, so the pack
 * wrapper (run-pack.cjs) can put them back when electron-builder exits — a
 * bare run used to delete them permanently and break the next `pnpm dev`
 * until someone remembered to run `pnpm install`.
 *
 * Running this file directly still performs the removal (print-only), as
 * before; `run-pack.cjs` is the supported entry point.
 */
const fs = require('fs');
const path = require('path');

const appDir = path.resolve(__dirname, '..');

// Workspace packages that are bundled by electron-vite / vite
// and do NOT need to be in node_modules at runtime.
const WORKSPACE_SYMLINKS = ['@pi/sdk-wrapper', '@pi/types', '@pi/ui'];

const nodeModulesDir = path.join(appDir, 'node_modules');

function prepareForPack() {
  const removed = [];
  for (const pkg of WORKSPACE_SYMLINKS) {
    const linkPath = path.join(nodeModulesDir, pkg);
    if (!fs.existsSync(linkPath)) continue;

    const stat = fs.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) continue;

    const rawTarget = fs.readlinkSync(linkPath);
    // pnpm uses junctions on Windows, which need an absolute target.
    const target =
      process.platform === 'win32' ? path.resolve(path.dirname(linkPath), rawTarget) : rawTarget;
    console.log(`Removing workspace symlink: node_modules/${pkg} → ${rawTarget}`);
    fs.unlinkSync(linkPath);
    removed.push({ linkPath, target });
  }
  return removed;
}

function restoreWorkspaceSymlinks(removed) {
  for (const { linkPath, target } of removed) {
    if (fs.existsSync(linkPath)) continue;
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    try {
      fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      console.log(`Restored workspace symlink: node_modules/${path.relative(nodeModulesDir, linkPath)}`);
    } catch (err) {
      console.warn(
        `Could not restore node_modules/${path.relative(nodeModulesDir, linkPath)} ` +
        `(${err.message}); run "pnpm install" to recreate it.`,
      );
    }
  }
}

module.exports = { prepareForPack, restoreWorkspaceSymlinks };

if (require.main === module) {
  prepareForPack();
  console.log('Ready for packaging.');
}
