/**
 * The empty-workbench snake.
 *
 * The board is what a user lands on by hiding every column, so a rule that
 * silently misbehaves (a tail that kills, a token that spawns inside the
 * snake, a queued turn that folds the snake into itself) would be a bug people
 * meet exactly once — on the screen that is supposed to be the friendly one.
 * These tests pin those rules headlessly; the component only draws and reads
 * keys.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BONUS_POINTS,
  BONUS_TTL,
  MAX_BLOCKS,
  createGame,
  level,
  placeFood,
  start,
  tick,
  tickMs,
  togglePause,
  turn,
} from '../../../packages/ui/src/lib/snake.ts';

const at = (x, y) => ({ x, y });
const game = (overrides = {}) => ({
  cols: 10,
  rows: 6,
  body: [at(5, 3), at(4, 3), at(3, 3)],
  dir: 'right',
  queued: [],
  food: at(0, 0),
  blocks: [],
  bonus: null,
  score: 0,
  status: 'running',
  ...overrides,
});

test('a fresh board is three cells long, in the middle, with a reachable token', () => {
  const g = createGame({ cols: 10, rows: 6, rand: () => 0 });
  assert.equal(g.body.length, 3);
  assert.deepEqual(g.body[0], at(5, 3));
  assert.equal(g.status, 'ready');
  assert.equal(g.score, 0);
  assert.ok(g.food.x >= 0 && g.food.x < g.cols && g.food.y >= 0 && g.food.y < g.rows);
  assert.ok(!g.body.some((c) => c.x === g.food.x && c.y === g.food.y), 'never inside the snake');
});

test('the token only ever lands on a free cell, and uniformly among them', () => {
  const board = { cols: 3, rows: 2, body: [at(0, 0), at(1, 0)] };
  // rand() == 0 picks the first free cell in scan order; 0.999… the last.
  assert.deepEqual(placeFood(board, () => 0), at(2, 0));
  assert.deepEqual(placeFood(board, () => 0.999), at(2, 1));
  for (let i = 0; i < 50; i++) {
    const cell = placeFood(board, () => i / 50);
    assert.ok(!board.body.some((c) => c.x === cell.x && c.y === cell.y));
  }
});

test('a full board has nowhere to spawn, and does not crash', () => {
  const board = { cols: 2, rows: 1, body: [at(0, 0), at(1, 0)] };
  assert.deepEqual(placeFood(board, () => 0), at(0, 0));
});

test('a tick moves the head one cell and drops the tail', () => {
  const g = tick(game());
  assert.deepEqual(g.body, [at(6, 3), at(5, 3), at(4, 3)]);
  assert.equal(g.score, 0);
});

test('the wall ends the round instead of wrapping', () => {
  const g = tick(game({ body: [at(9, 3), at(8, 3), at(7, 3)] }));
  assert.equal(g.status, 'over');
  assert.deepEqual(g.body, [at(9, 3), at(8, 3), at(7, 3)], 'the board stays where it was');
});

test('eating grows the snake, scores, and respawns the token off the body', () => {
  const g = tick(game({ food: at(6, 3) }), () => 0.5);
  assert.equal(g.score, 1);
  assert.equal(g.body.length, 4);
  assert.deepEqual(g.body[0], at(6, 3));
  assert.ok(!g.body.some((c) => c.x === g.food.x && c.y === g.food.y));
});

test('the tail vacates its cell in the same tick, so following it is legal', () => {
  const g = tick(game({ dir: 'up', body: [at(4, 3), at(5, 3), at(5, 2), at(4, 2)] }));
  assert.equal(g.status, 'running');
  assert.deepEqual(g.body[0], at(4, 2));
  assert.equal(g.body.length, 4);
});

test('running into anything but the tail ends the round', () => {
  const g = tick(game({ dir: 'up', body: [at(4, 3), at(4, 2), at(3, 2), at(3, 3), at(5, 3)] }));
  assert.equal(g.status, 'over');
});

test('a reversal is dropped: nothing in the game says the neck kills', () => {
  const g = turn(game(), 'left');
  assert.deepEqual(g.queued, []);
});

test('turns queue up, one per tick, so a fast double-tap cannot fold the snake', () => {
  let g = turn(game(), 'up');
  g = turn(g, 'left');
  assert.deepEqual(g.queued, ['up', 'left']);
  // A third tap before the clock catches up is dropped rather than stacked.
  assert.deepEqual(turn(g, 'down').queued, ['up', 'left']);

  const first = tick(g);
  assert.deepEqual(first.body[0], at(5, 2), 'up applied first');
  assert.deepEqual(first.queued, ['left']);
  const second = tick(first);
  assert.deepEqual(second.body[0], at(4, 2), 'then left');
  assert.equal(second.status, 'running');
});

test('pause freezes the board, resume unfreezes it, and neither steers', () => {
  const paused = togglePause(game());
  assert.equal(paused.status, 'paused');
  assert.deepEqual(tick(paused).body, paused.body, 'a paused board does not move');
  assert.deepEqual(turn(paused, 'up').queued, [], 'no steering while paused');
  assert.equal(togglePause(paused).status, 'running');
});

test('a ready board does not move until it is started', () => {
  const g = createGame({ rand: () => 0 });
  assert.deepEqual(tick(g).body, g.body);
  assert.equal(start(g).status, 'running');
  assert.equal(start(start(g)).status, 'running', 'idempotent');
});

test('the clock tightens a step per level, then stops tightening', () => {
  assert.equal(level(0), 1);
  assert.equal(level(4), 1);
  assert.equal(level(5), 2);
  assert.equal(level(10), 3);

  assert.equal(tickMs(0), 140);
  assert.equal(tickMs(4), 140, 'still the first level');
  assert.equal(tickMs(5), 128);
  assert.equal(tickMs(10), 116);
  assert.equal(tickMs(60), 60, 'floored, so the late game stays playable');
});

test('a wall ends the round, and tokens never spawn on one', () => {
  const g = tick(game({ blocks: [at(6, 3)] }));
  assert.equal(g.status, 'over');

  const board = { cols: 4, rows: 2, body: [at(0, 0)], blocks: [at(1, 0), at(2, 0), at(3, 0)] };
  for (let i = 0; i < 20; i++) {
    const cell = placeFood(board, () => i / 20);
    assert.ok(!board.blocks.some((c) => c.x === cell.x && c.y === cell.y), `landed on a wall at ${cell.x},${cell.y}`);
  }
});

test('levelling up drops one wall, clear of the head and of everything solid', () => {
  // Score 4 → eats → 5 is the first level-up.
  const g = tick(game({ score: 4, food: at(6, 3) }), () => 0.5);
  assert.equal(g.status, 'running');
  assert.equal(g.score, 5);
  assert.equal(g.blocks.length, 1, 'exactly one wall per level');

  const wall = g.blocks[0];
  assert.ok(!g.body.some((c) => c.x === wall.x && c.y === wall.y), 'not in the snake');
  assert.notEqual(`${wall.x},${wall.y}`, `${g.food.x},${g.food.y}`, 'not on the token');
  const head = g.body[0];
  assert.ok(Math.max(Math.abs(wall.x - head.x), Math.abs(wall.y - head.y)) >= 3, 'leaves the head some air');
});

test('walls stop accumulating at the cap', () => {
  const blocks = Array.from({ length: MAX_BLOCKS }, (_, i) => at(i % 10, 0));
  const g = tick(game({ score: 4, food: at(6, 3), blocks }), () => 0);
  assert.equal(g.blocks.length, MAX_BLOCKS);
});

test('the timed token appears every fourth one and pays more', () => {
  const spawned = tick(game({ score: 3, food: at(6, 3) }), () => 0);
  assert.equal(spawned.score, 4);
  assert.ok(spawned.bonus, 'a bonus token after the fourth');
  assert.equal(spawned.bonus.ttl, BONUS_TTL);
  assert.ok(
    !spawned.body.some((c) => c.x === spawned.bonus.cell.x && c.y === spawned.bonus.cell.y),
    'never inside the snake',
  );

  // Cashing it in pays three and does not lengthen the snake.
  const paid = tick(game({ bonus: { cell: at(6, 3), ttl: 10 } }));
  assert.equal(paid.score, BONUS_POINTS);
  assert.equal(paid.body.length, 3);
  assert.equal(paid.bonus, null, 'collected, gone');
});

test('the timed token runs out on its own', () => {
  let g = game({ bonus: { cell: at(0, 5), ttl: 2 } });
  g = tick(g);
  assert.equal(g.bonus?.ttl, 1);
  g = tick(g);
  assert.equal(g.bonus, null, 'expired, and the board carries on');
  assert.equal(g.status, 'running');
});

test('a long run never puts the token under the snake', () => {
  let g = start(createGame({ cols: 12, rows: 8, rand: () => 0.37 }));
  let seed = 0;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 200 && g.status === 'running'; i++) {
    // Steer in a small square so the snake survives long enough to eat.
    g = turn(g, i % 20 < 5 ? 'up' : i % 20 < 10 ? 'right' : i % 20 < 15 ? 'down' : 'left');
    g = tick(g, rand);
    assert.ok(!g.body.some((c) => c.x === g.food.x && c.y === g.food.y), `token under the snake at tick ${i}`);
  }
});
