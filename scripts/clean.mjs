#!/usr/bin/env node
/**
 * Cross-platform `rm -rf` for package `clean` scripts.
 *
 * pnpm runs scripts through cmd.exe on Windows, which has no `rm`/`rm -rf`,
 * so every package's clean task failed there. This accepts plain paths and
 * simple `*`/`?` globs (matched against file names in the directory), and
 * resolves them against the caller's cwd (the package directory).
 *
 * Usage: node ../../scripts/clean.mjs dist "*.tsbuildinfo"
 */
import { readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const GLOB = /[*?]/;

function escapeRe(value) {
  return value.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
}

function expand(pattern) {
  if (!GLOB.test(pattern)) return [resolve(pattern)];
  const slash = pattern.lastIndexOf('/');
  const dir = resolve(slash >= 0 ? pattern.slice(0, slash) || '/' : '.');
  const namePattern = slash >= 0 ? pattern.slice(slash + 1) : pattern;
  const re = new RegExp(
    `^${escapeRe(namePattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`,
  );
  try {
    return readdirSync(dir)
      .filter((name) => re.test(name))
      .map((name) => resolve(dir, name));
  } catch {
    return [];
  }
}

for (const pattern of process.argv.slice(2)) {
  for (const target of expand(pattern)) {
    rmSync(target, { recursive: true, force: true });
  }
}
