/**
 * The app mark: a tapered "W" on a squircle tile.
 *
 * The artwork is generated rather than hand-drawn in a vector editor so the
 * geometry stays reproducible: change a vertex or a width below and re-run the
 * two icon scripts. This module is the shared source of truth for:
 *
 *   - make-icon.mjs     — macOS icon (824/1024 content grid, own shadow)
 *   - make-win-icon.mjs — Windows icon (full-bleed tile + simplified smalls)
 */

export const ICON_SIZE = 1024;

const round = (n) => Math.round(n * 100) / 100;
const pt = ([x, y]) => `${round(x)} ${round(y)}`;
const lerp = (a, b, t) => a + (b - a) * t;

// ── Squircle ────────────────────────────────────────────────────────────────
//
// A superellipse |x|^n + |y|^n = 1, which is the shape macOS uses for app
// tiles. n = 5 is the usual approximation of Apple's continuous corner —
// a plain rounded rect reads as visibly "off" next to native icons.
function squirclePath(cx, cy, r, n = 5, steps = 360) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([
      cx + r * Math.sign(c) * Math.abs(c) ** (2 / n),
      cy + r * Math.sign(s) * Math.abs(s) ** (2 / n),
    ]);
  }
  return `M${pts.map(pt).join('L')}Z`;
}

// ── The W ───────────────────────────────────────────────────────────────────
//
// A polyline with a half-width at every vertex, expanded into a closed
// outline. Wider at the feet than at the tips, so the letter gets a
// calligraphic taper instead of reading as a stroked font glyph.
const VERTICES = [
  { x: 256, y: 322, w: 44 },
  { x: 396, y: 702, w: 82 },
  { x: 512, y: 420, w: 74 },
  { x: 628, y: 702, w: 82 },
  { x: 768, y: 322, w: 44 },
];

/** Samples per segment; 24 is plenty — the outline is all straight edges. */
const SAMPLES = 24;

/**
 * Expand the polyline into one closed path.
 *
 * Each side (left = +normal, right = -normal) is a list of tokens; joins get a
 * round arc on the *outer* side only, and the two ends get a round cap. The
 * path is emitted as: start cap → right side → end cap → left side reversed.
 */
function wPath(vertices) {
  const left = [];
  const right = [];
  let prevU = null;

  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const u = [dx / len, dy / len];
    const n = [-u[1], u[0]];

    for (let k = 0; k <= SAMPLES; k++) {
      const t = k / SAMPLES;
      const p = [a.x + dx * t, a.y + dy * t];
      const h = lerp(a.w, b.w, t) / 2;
      const l = [p[0] + n[0] * h, p[1] + n[1] * h];
      const r = [p[0] - n[0] * h, p[1] - n[1] * h];

      // Join at the start of every segment but the first. The two sides of
      // the bend sit h apart around a shared vertex; fill the wedge on the
      // outside of the turn.
      if (i > 0 && k === 0) {
        const cross = prevU[0] * u[1] - prevU[1] * u[0];
        // cross > 0 turns clockwise on screen, which leaves the gap on the
        // right side; negative leaves it on the left. Sweeping the short way
        // round means a right-side join runs with the traversal (1) and a
        // left-side join runs against it (0).
        if (cross > 0) right.push({ arc: true, r: h, from: right[right.length - 1].to, to: r, sweep: 1 });
        else if (cross < 0) left.push({ arc: true, r: h, from: left[left.length - 1].to, to: l, sweep: 0 });
      }

      left.push({ to: l });
      right.push({ to: r });
    }
    prevU = u;
  }

  const h0 = vertices[0].w / 2;
  const hN = vertices[vertices.length - 1].w / 2;

  /**
   * Emit tokens as path commands. When `reversed`, walk the list backwards:
   * a line still lands on the same point, but an arc must run from its `to`
   * back to its `from`, which also mirrors its sweep flag.
   */
  const emit = (tokens, reversed) => {
    const out = [];
    for (let idx = 0; idx < tokens.length; idx++) {
      const tok = reversed ? tokens[tokens.length - 1 - idx] : tokens[idx];
      if (tok.arc) {
        const sweep = reversed ? 1 - tok.sweep : tok.sweep;
        const target = reversed ? tok.from : tok.to;
        out.push(`A${round(tok.r)} ${round(tok.r)} 0 0 ${sweep} ${pt(target)}`);
      } else {
        out.push(`L${pt(tok.to)}`);
      }
    }
    return out.join('');
  };

  return [
    `M${pt(left[0].to)}`,
    // start cap: left → right, around the back of the first vertex
    `A${round(h0)} ${round(h0)} 0 0 1 ${pt(right[0].to)}`,
    emit(right.slice(1), false),
    // end cap: right → left, around the far side of the last vertex
    `A${round(hN)} ${round(hN)} 0 0 1 ${pt(left[left.length - 1].to)}`,
    emit(left.slice(1), true),
    'Z',
  ].join('');
}

/**
 * Build the 1024×1024 SVG.
 *
 * Defaults reproduce the macOS artwork: the tile occupies the 824px Apple
 * content grid with a drop shadow in the transparent margin.
 *
 * @param {object} [options]
 * @param {number} [options.tileRadius] squircle radius (412 = macOS grid)
 * @param {number} [options.markScale] scale of the W around the centre
 * @param {boolean} [options.simple] flat colors, no shadows — for 16/24/32px
 * @param {boolean} [options.outerShadow] include the tile's drop shadow
 */
export function buildIconSvg({
  tileRadius = 412,
  markScale = 1,
  simple = false,
  outerShadow = true,
} = {}) {
  const tile = squirclePath(ICON_SIZE / 2, ICON_SIZE / 2, tileRadius);
  const vertices = VERTICES.map((v) => ({
    x: ICON_SIZE / 2 + (v.x - ICON_SIZE / 2) * markScale,
    y: ICON_SIZE / 2 + (v.y - ICON_SIZE / 2) * markScale,
    w: v.w * markScale,
  }));
  const w = wPath(vertices);

  const tileFill = simple ? '#EDEFF3' : 'url(#tile)';
  const markFill = simple ? '#0B0B0D' : 'url(#mark)';
  const seatFilter = outerShadow && !simple ? ' filter="url(#seat)"' : '';
  const liftFilter = simple ? '' : ' filter="url(#lift)"';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
  <defs>
    <!-- Paper and ink, like the app itself: a near-white surface carrying
         near-black content (globals.css: background 0 0% 100%, foreground
         0 0% 5%). No hue anywhere. -->
    <linearGradient id="tile" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#FEFEFE"/>
      <stop offset="0.55" stop-color="#F4F4F6"/>
      <stop offset="1" stop-color="#D9D9DE"/>
    </linearGradient>
    <!-- The sheen is what keeps a white tile from dissolving into a white
         desktop: a raised top edge and a faint bottom turn. -->
    <linearGradient id="lip" x1="0.5" y1="0" x2="0.5" y2="0.42">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.07"/>
    </linearGradient>
    <linearGradient id="mark" x1="0.12" y1="0" x2="0.88" y2="1">
      <stop offset="0" stop-color="#1B1B1F"/>
      <stop offset="0.6" stop-color="#0B0B0D"/>
      <stop offset="1" stop-color="#000000"/>
    </linearGradient>
    <!-- A shallow drop shadow, so the letter sits on the surface instead of
         being printed flat onto it. -->
    <filter id="lift" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="9" stdDeviation="11" flood-color="#000000" flood-opacity="0.16"/>
    </filter>
    <!-- A white tile on a white desktop has no edge of its own. -->
    <filter id="seat" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000000" flood-opacity="0.13"/>
    </filter>
  </defs>

  <path d="${tile}" fill="${tileFill}"${seatFilter}/>
  ${simple ? '' : `<path d="${tile}" fill="none" stroke="#000000" stroke-opacity="0.08" stroke-width="2"/>
  <path d="${tile}" fill="url(#lip)"/>`}

  <path d="${w}" fill="${markFill}"${liftFilter}/>
</svg>
`;
}
