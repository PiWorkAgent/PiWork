import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import {
  createGame,
  level,
  start,
  tick,
  tickMs,
  togglePause,
  turn,
  type Cell,
  type Direction,
  type Game,
} from '@/lib/snake';

/** Board geometry. The canvas is drawn in CSS px and scaled by the DPR. */
const CELL = 20;
const BEST_KEY = 'pi:snake-best';
/** How long the ring left by an eaten token lasts. */
const RIPPLE_MS = 320;

const KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};

const center = (c: Cell): { x: number; y: number } => ({
  x: c.x * CELL + CELL / 2,
  y: c.y * CELL + CELL / 2,
});

function readBest(): number {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    const value = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    // Private mode / blocked storage: a high score is not worth failing over.
    return 0;
  }
}

function writeBest(score: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, String(score));
  } catch {
    /* ignore */
  }
}

interface Ripple {
  x: number;
  y: number;
  at: number;
}

/**
 * One frame. Everything is the inherited text colour, drawn at different
 * alphas — the app has no hue anywhere and the board should not introduce one.
 */
function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  game: Game,
  now: number,
  ripple: Ripple | null,
): void {
  const width = game.cols * CELL;
  const height = game.rows * CELL;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== width * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const ink = getComputedStyle(canvas).color || '#111';
  const dead = game.status === 'over';
  const pulse = (Math.sin(now / 260) + 1) / 2;

  // Grid dots: enough to read the cells, not enough to be a pattern.
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.12;
  for (let y = 0; y < game.rows; y++) {
    for (let x = 0; x < game.cols; x++) {
      ctx.fillRect(x * CELL + CELL / 2 - 1, y * CELL + CELL / 2 - 1, 2, 2);
    }
  }
  ctx.globalAlpha = 1;

  // Walls. A wall is furniture: flat, quiet, never mistaken for the snake.
  for (const block of game.blocks) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.roundRect(block.x * CELL + 2, block.y * CELL + 2, CELL - 4, CELL - 4, 3);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // The ordinary token: a filled dot that breathes.
  const food = center(game.food);
  ctx.fillStyle = ink;
  ctx.globalAlpha = dead ? 0.4 : 1;
  ctx.beginPath();
  ctx.arc(food.x, food.y, CELL * 0.16 + pulse * CELL * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // The timed token: a diamond that blinks out as its clock runs down, so the
  // last seconds are visible rather than surprising.
  if (game.bonus) {
    const urgent = game.bonus.ttl < 10;
    const blinkOn = !urgent || Math.floor(now / 180) % 2 === 0;
    if (blinkOn) {
      const b = center(game.bonus.cell);
      const size = CELL * 0.3 + pulse * 1.2;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = ink;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      // Punch the middle out, so it reads as a token and not a fourth block.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(-size / 6, -size / 6, size / 3, size / 3);
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // The snake: one tapered stroke rather than a row of squares, so it reads as
  // a body. Narrower towards the tail, widening with every token.
  const points = game.body.map(center);
  const girth = CELL * (0.5 + Math.min(0.03 * game.body.length, 0.16));
  ctx.globalAlpha = dead ? 0.35 : 1;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < points.length - 1; i++) {
    const t = i / Math.max(1, points.length - 1);
    ctx.lineWidth = girth * (1 - 0.42 * t);
    ctx.beginPath();
    ctx.moveTo(points[i].x, points[i].y);
    ctx.lineTo(points[i + 1].x, points[i + 1].y);
    ctx.stroke();
  }
  const head = points[0];
  ctx.beginPath();
  ctx.arc(head.x, head.y, girth * 0.72, 0, Math.PI * 2);
  ctx.fill();

  // Eyes, punched through the head so they work in either theme and never
  // look like a separate colour was added.
  if (!dead) {
    const dx = { up: 0, down: 0, left: -1, right: 1 }[game.dir];
    const dy = { up: -1, down: 1, left: 0, right: 0 }[game.dir];
    const px = -dy;
    const py = dx;
    const eye = CELL * 0.13;
    const forward = CELL * 0.18;
    const apart = CELL * 0.21;
    ctx.globalCompositeOperation = 'destination-out';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(
        head.x + dx * forward + px * apart * side,
        head.y + dy * forward + py * apart * side,
        eye,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;

  // The ring left by the token just eaten.
  if (ripple && now - ripple.at < RIPPLE_MS) {
    const progress = (now - ripple.at) / RIPPLE_MS;
    ctx.globalAlpha = (1 - progress) * 0.5;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, CELL * (0.2 + progress * 0.9), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/**
 * What the window shows when every column has been put away, the sidebar
 * included.
 *
 * It is reachable in three clicks and leads nowhere on its own, so instead of
 * a white void it is a small easter egg: a game of snake, drawn in the app's
 * own ink (no colour anywhere, matching the mark). Restoring any column from
 * the title bar unmounts this whole component, which takes the clock, the
 * animation frame and the key listener with it.
 */
export function EmptyWorkbench() {
  const { t } = useI18n();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game>(() => createGame());
  const [best, setBest] = useState(readBest);

  // The animation frame reads the latest board through a ref: re-subscribing
  // it on every tick would drop frames for no reason.
  const gameRef = useRef(game);
  gameRef.current = game;
  const rippleRef = useRef<Ripple | null>(null);
  const prevScore = useRef(0);

  // The clock. One interval per tick length: a levelled-up score shortens it.
  useEffect(() => {
    if (game.status !== 'running') return;
    const id = window.setInterval(() => setGame((g) => tick(g)), tickMs(game.score));
    return () => window.clearInterval(id);
  }, [game.status, game.score]);

  // Only steer while this screen is the one on screen — the listener is
  // mounted with it and removed with it, so no other view inherits it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never eat a keystroke meant for a field: the board owns arrows and
      // space, which are ordinary keys inside an input.
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const dir = KEYS[e.key];
      if (dir) {
        e.preventDefault();
        setGame((g) => {
          if (g.status === 'over' || g.status === 'paused') return g;
          return turn(start(g), dir);
        });
        return;
      }
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        setGame((g) => {
          if (g.status === 'over') return createGame();
          if (g.status === 'ready') return start(g);
          return togglePause(g);
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A finished round is worth remembering, once.
  useEffect(() => {
    if (game.status !== 'over' || game.score <= best) return;
    setBest(game.score);
    writeBest(game.score);
  }, [game.status, game.score, best]);

  // Leave a ring where a token was eaten.
  useEffect(() => {
    if (game.score > prevScore.current) {
      const head = game.body[0];
      rippleRef.current = { ...center(head), at: performance.now() };
    }
    prevScore.current = game.score;
  }, [game.score, game.body]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // A moving board animates; a still one is painted once and left alone.
    const moving = game.status === 'running' || game.status === 'ready';
    if (!moving) {
      render(ctx, canvas, game, performance.now(), rippleRef.current);
      return;
    }
    let raf = 0;
    const frame = (now: number) => {
      render(ctx, canvas, gameRef.current, now, rippleRef.current);
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [game.status, game]);

  const hint =
    game.status === 'ready'
      ? t('按方向键开始，空格也可以')
      : game.status === 'paused'
        ? t('已暂停，空格继续')
        : game.status === 'over'
          ? t('上下文溢出了，空格重来')
          : t('空格暂停');

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-5 overflow-hidden p-8">
      <p className="text-center text-xs text-muted-foreground">{t('闲着也是闲着，吃掉几个 token')}</p>

      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('吃 token：用方向键操控的小蛇')}
        // A focus ring would be noise on a board that takes keys directly.
        tabIndex={-1}
        style={{ width: game.cols * CELL, height: game.rows * CELL }}
        className="max-h-[60vh] max-w-full"
      />

      <div className="text-center text-xs text-muted-foreground">
        <p>{hint}</p>
        <p className="mt-1 tabular-nums">
          {t('LV {level} · 本局 {score} · 最高 {best}', {
            level: String(level(game.score)),
            score: String(game.score),
            best: String(best),
          })}
        </p>
      </div>
    </div>
  );
}
