#!/usr/bin/env node
/**
 * Draw the macOS app icon: a tapered "W" monogram on a macOS-style squircle.
 *
 * The artwork lives in `icon-art.mjs` (shared with `make-win-icon.mjs`):
 *
 *   1. build the SVG (squircle + variable-width W outline)
 *   2. rasterise it with headless Chrome at 1024x1024 on a transparent canvas
 *   3. hand the PNG to generate-icons.sh, which writes icon.icns + icon.png
 *
 * Usage:                  node build/make-icon.mjs
 * Windows-specific icon:  node build/make-win-icon.mjs
 *
 * Requires Google Chrome (for the SVG rasteriser) and macOS iconutil/sips.
 * This is an authoring step, not part of the build — electron-builder only
 * ever reads the committed icon.png / icon.icns / icon-win.ico.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_SIZE, buildIconSvg } from './icon-art.mjs';

const BUILD = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ── Rasterise ───────────────────────────────────────────────────────────────

const svgPath = join(BUILD, 'icon-source.svg');
const pngPath = join(BUILD, 'icon-source.png');

const svg = buildIconSvg();
writeFileSync(svgPath, svg);
console.log(`→ ${svgPath}`);

const work = mkdtempSync(join(tmpdir(), 'pi-icon-'));
try {
  // Chrome screenshots a page, not an SVG, so wrap it and kill the margins.
  const html = join(work, 'icon.html');
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent}
      svg{display:block}
    </style>${svg}`,
  );

  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${ICON_SIZE},${ICON_SIZE}`,
      `--screenshot=${pngPath}`,
      `file://${html}`,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`→ ${pngPath}`);
execFileSync(join(BUILD, 'generate-icons.sh'), [pngPath], { stdio: 'inherit' });
