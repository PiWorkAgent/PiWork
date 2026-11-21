#!/usr/bin/env node
/**
 * Build the Windows icon (`icon-win.ico`), which differs from the macOS one in
 * two ways that matter on Windows:
 *
 *   - FULL-BLEED tile. The macOS icon keeps Apple's 824/1024 content grid with
 *     a transparent margin; Windows does not crop or mask icons, so the same
 *     artwork reads as an undersized tile next to native taskbar pins.
 *   - FLAT SMALL SIZES. 16/24/32px are rendered from a simplified source (no
 *     gradients or drop shadows, a thicker W) instead of being shrunk from the
 *     1024px art, where the shadows turn to mush.
 *
 * Output: a multi-resolution, PNG-compressed ICO (16/24/32/48/64/128/256) that
 * electron-builder embeds as-is (`win.icon`). The same file is used by rcedit
 * for the exe, and by NSIS for the installer/uninstaller icon.
 *
 * Usage: node build/make-win-icon.mjs
 *
 * Requires Google Chrome (SVG rasteriser) and macOS `sips` (resampling).
 * Authoring step only — the committed .ico is what packaging reads.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIconSvg } from './icon-art.mjs';

const BUILD = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FULL_SIZE = 1024;

// The macOS tile spans 824 of 1024; scale the mark with the tile so the
// composition is unchanged, just larger on the canvas.
const fullSvg = buildIconSvg({
  tileRadius: 512,
  markScale: FULL_SIZE / 824,
  outerShadow: false,
});

// Small sizes: no shadows/stroke, flat near-white tile, bolder W.
const smallSvg = buildIconSvg({
  tileRadius: 512,
  markScale: 1.3,
  simple: true,
  outerShadow: false,
});

const svgPath = join(BUILD, 'icon-win.svg');
writeFileSync(svgPath, fullSvg);
console.log(`→ ${svgPath}`);

const work = mkdtempSync(join(tmpdir(), 'pi-win-icon-'));
try {
  const render = (svg, size, out) => {
    const html = join(work, `icon-${size}.html`);
    writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;background:transparent}
        svg{display:block;width:${size}px;height:${size}px}
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
        `--window-size=${size},${size}`,
        `--screenshot=${out}`,
        `file://${html}`,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
  };

  // Small entries are rasterised straight from the simplified vector at their
  // target size — sharper than shrinking a 1024px raster.
  const entries = [16, 24, 32].map((size) => {
    const out = join(work, `icon-${size}.png`);
    render(smallSvg, size, out);
    return { size, png: readFileSync(out) };
  });

  // Everything ≥48 keeps the full artwork (gradient + letter shadow).
  const fullPng = join(work, 'full.png');
  render(fullSvg, FULL_SIZE, fullPng);
  for (const size of [48, 64, 128, 256]) {
    const out = join(work, `icon-${size}.png`);
    execFileSync('sips', ['-z', String(size), String(size), fullPng, '--out', out], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    entries.push({ size, png: readFileSync(out) });
  }

  const icoPath = join(BUILD, 'icon-win.ico');
  writeFileSync(icoPath, buildIco(entries));
  console.log(`→ ${icoPath} (${entries.map((e) => e.size).join('/')}px)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

/**
 * Pack PNG entries into a PNG-compressed ICO. Width/height 0 means 256 in the
 * directory, matching what Windows and electron-builder's own icon tool emit.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach((entry, index) => {
    const at = index * 16;
    const dimension = entry.size >= 256 ? 0 : entry.size;
    directory.writeUInt8(dimension, at);
    directory.writeUInt8(dimension, at + 1);
    directory.writeUInt8(0, at + 2); // palette
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // color planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}
