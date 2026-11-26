/**
 * The empty-workbench snake.
 *
 * Hiding all three columns leaves a blank window; this turns that dead end
 * into a place to rest. The rules live here as plain functions over plain
 * data — no canvas, no timers, no React — so every one of them can be tested
 * without a window, and the component is left with drawing and key handling.
 *
 * Randomness is a parameter, never `Math.random()` inline: a test hands in a
 * scripted generator and gets the same board every time.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';
export type GameStatus = 'ready' | 'running' | 'paused' | 'over';

export interface Cell {
  x: number;
  y: number;
}

/** The token on a timer: worth more, gone if you are slow. */
export interface Bonus {
  cell: Cell;
  /** Ticks left before it vanishes. */
  ttl: number;
}

export interface Game {
  cols: number;
  rows: number;
  /** Head first. */
  body: Cell[];
  /** The direction the snake is travelling in. */
  dir: Direction;
  /**
   * Turns accepted but not yet applied — one per tick. Steering is a queue
   * because a fast double-tap (up, then left) would otherwise overwrite the
   * first turn and fold the snake sideways into itself.
   */
  queued: Direction[];
  food: Cell;
  /** Static walls, added one per level. */
  blocks: Cell[];
  bonus: Bonus | null;
  /** Tokens eaten. */
  score: number;
  status: GameStatus;
}

/** What the timed token is worth. */
export const BONUS_POINTS = 3;
/** Ticks a timed token stays on the board. */
export const BONUS_TTL = 45;
/** Tokens eaten between levels. */
export const TOKENS_PER_LEVEL = 5;
/** A bonus token appears every this many ordinary ones. */
const BONUS_EVERY = 4;
/** Walls stop being added here, or the board becomes a maze. */
export const MAX_BLOCKS = 12;
/** Cells the snake must be able to reach around a new obstacle. */
const SPAWN_CLEARANCE = 3;

const DELTA: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export interface GameOptions {
  cols?: number;
  rows?: number;
  rand?: () => number;
}

/** Level 1 until the fifth token, then one higher per five. */
export function level(score: number): number {
  return 1 + Math.floor(score / TOKENS_PER_LEVEL);
}

/** A fresh round, three cells long, in the middle of the board, heading right. */
export function createGame(opts: GameOptions = {}): Game {
  const cols = opts.cols ?? 24;
  const rows = opts.rows ?? 15;
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  const body: Cell[] = [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ];
  const game: Game = {
    cols,
    rows,
    body,
    dir: 'right',
    queued: [],
    food: { x: 0, y: 0 },
    blocks: [],
    bonus: null,
    score: 0,
    status: 'ready',
  };
  return { ...game, food: placeFood(game, opts.rand) };
}

interface Board {
  cols: number;
  rows: number;
  body: Cell[];
  blocks?: Cell[];
  food?: Cell;
  bonus?: Bonus | null;
}

const key = (c: Cell): string => `${c.x},${c.y}`;

/**
 * Every cell nothing occupies. Static walls count as occupied — a token or a
 * wall must never appear inside the snake, inside a wall, or on top of the
 * other token.
 */
function freeCells(board: Board, headClearance = 0): Cell[] {
  const taken = new Set<string>([
    ...board.body.map(key),
    ...(board.blocks ?? []).map(key),
  ]);
  if (board.food) taken.add(key(board.food));
  if (board.bonus) taken.add(key(board.bonus.cell));
  const head = board.body[0];

  const free: Cell[] = [];
  for (let y = 0; y < board.rows; y++) {
    for (let x = 0; x < board.cols; x++) {
      if (taken.has(`${x},${y}`)) continue;
      // Keep a little air around the head: an obstacle that appears one cell
      // ahead is not a decision, it is a coin flip.
      if (headClearance > 0 && head) {
        const far = Math.max(Math.abs(x - head.x), Math.abs(y - head.y));
        if (far < headClearance) continue;
      }
      free.push({ x, y });
    }
  }
  return free;
}

function pick(cells: Cell[], rand: () => number): Cell | null {
  if (cells.length === 0) return null;
  const index = Math.min(cells.length - 1, Math.floor(rand() * cells.length));
  return cells[index];
}

/** A free cell for the next token, uniform over the empty ones. */
export function placeFood(board: Board, rand: () => number = Math.random): Cell {
  return pick(freeCells(board), rand) ?? { x: 0, y: 0 };
}

/** Begin the round. A round already under way is left alone. */
export function start(game: Game): Game {
  return game.status === 'ready' ? { ...game, status: 'running' } : game;
}

export function togglePause(game: Game): Game {
  if (game.status === 'running') return { ...game, status: 'paused' };
  if (game.status === 'paused') return { ...game, status: 'running' };
  return game;
}

/**
 * Steer. A reversal is dropped: the snake would run into its own neck, and
 * nothing in the game teaches that the death was a keypress away.
 */
export function turn(game: Game, dir: Direction): Game {
  if (game.status === 'over' || game.status === 'paused') return game;
  if (game.queued.length >= 2) return game;
  const last = game.queued.length > 0 ? game.queued[game.queued.length - 1] : game.dir;
  if (dir === last || dir === OPPOSITE[last]) return game;
  return { ...game, queued: [...game.queued, dir] };
}

/**
 * Advance one tick.
 *
 * Two rules keep it fair rather than merely correct: the tail vacates its cell
 * in the same tick the head moves (so following your own tail is legal), and a
 * wall or a bite ends the round where it is — no wrap-around, which would make
 * the board edges lie.
 */
export function tick(game: Game, rand: () => number = Math.random): Game {
  if (game.status !== 'running') return game;

  // The clock ages the timed token too: it is a race, not a decoration.
  let bonus = game.bonus ? { ...game.bonus, ttl: game.bonus.ttl - 1 } : null;
  if (bonus && bonus.ttl <= 0) bonus = null;

  const dir = game.queued.length > 0 ? game.queued[0] : game.dir;
  const queued = game.queued.slice(1);
  const head = game.body[0];
  const next = { x: head.x + DELTA[dir].x, y: head.y + DELTA[dir].y };

  const out = next.x < 0 || next.y < 0 || next.x >= game.cols || next.y >= game.rows;
  if (out) return { ...game, dir, queued, bonus, status: 'over' };

  if (game.blocks.some((c) => c.x === next.x && c.y === next.y)) {
    return { ...game, dir, queued, bonus, status: 'over' };
  }

  const eating = next.x === game.food.x && next.y === game.food.y;
  const eatingBonus = bonus !== null && next.x === bonus.cell.x && next.y === bonus.cell.y;
  const solid = eating ? game.body : game.body.slice(0, -1);
  if (solid.some((c) => c.x === next.x && c.y === next.y)) {
    return { ...game, dir, queued, bonus, status: 'over' };
  }

  if (!eating && !eatingBonus) {
    return { ...game, dir, queued, bonus, body: [next, ...game.body.slice(0, -1)] };
  }

  // A token grows the snake; the timed one only pays, so the board does not
  // punish the player for reaching for it.
  const body = eating ? [next, ...game.body] : [next, ...game.body.slice(0, -1)];
  const score = game.score + (eating ? 1 : BONUS_POINTS);
  const nextGame: Game = {
    ...game,
    dir,
    queued,
    body,
    score,
    bonus: eatingBonus ? null : bonus,
  };
  if (!eating) return nextGame;

  nextGame.food = placeFood(nextGame, rand);

  if (score % BONUS_EVERY === 0 && !nextGame.bonus) {
    const cell = pick(freeCells(nextGame, SPAWN_CLEARANCE), rand);
    if (cell) nextGame.bonus = { cell, ttl: BONUS_TTL };
  }

  if (level(score) > level(game.score) && nextGame.blocks.length < MAX_BLOCKS) {
    const cell = pick(freeCells(nextGame, SPAWN_CLEARANCE), rand);
    if (cell) nextGame.blocks = [...nextGame.blocks, cell];
  }

  return nextGame;
}

/**
 * Milliseconds between ticks. One step faster per level, floored so the last
 * few tokens are still playable by a human hand rather than a stopwatch.
 */
export function tickMs(score: number): number {
  return Math.max(60, 140 - (level(score) - 1) * 12);
}
