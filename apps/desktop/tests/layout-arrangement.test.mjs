/**
 * Where the workbench columns sit.
 *
 * One preference: which side of the work panel the chat is on. The sidebar is
 * the platform's left rail and never moves. With the sidebar closed the two
 * visible columns trade places; with it open the chat moves out to the far
 * edge (sidebar | panel | chat).
 *
 * The layout, the header segments, the drag arithmetic and the native-view
 * re-measure all derive from these functions — this file pins the geometry so
 * a change here cannot silently put a column in the wrong place.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIVIDER_WIDTH,
  dividerCenterX,
  isPanelFirst,
  panelLeftOffset,
  panelWidthAtPointer,
  rowOrder,
} from '../../../packages/ui/src/lib/layout-arrangement.ts';

const shape = (overrides = {}) => ({
  sidebarOpen: true,
  rightPanelOpen: true,
  centerPanelOpen: true,
  chatRight: false,
  ...overrides,
});

test('the panel leads the chat only when all three columns are there to order', () => {
  assert.equal(isPanelFirst(shape({ chatRight: true })), true, 'sidebar open, chat right');
  assert.equal(isPanelFirst(shape({ chatRight: true, sidebarOpen: false })), true, 'sidebar closed');
  assert.equal(isPanelFirst(shape({ chatRight: false })), false, 'preference off');
  assert.equal(isPanelFirst(shape({ chatRight: true, rightPanelOpen: false })), false, 'no panel');
  assert.equal(isPanelFirst(shape({ chatRight: true, centerPanelOpen: false })), false, 'no chat');
});

test('the sidebar keeps the leading slots in both arrangements', () => {
  for (const chatRight of [false, true]) {
    const order = rowOrder(shape({ chatRight, sidebarOpen: false }));
    assert.equal(order.sidebar, 0);
    assert.equal(order.leftDivider, 1);
    const values = [order.sidebar, order.leftDivider, order.center, order.rightDivider, order.right];
    assert.equal(new Set(values).size, values.length, 'orders are distinct');
  }
});

test('the chat sits between the sidebar and the panel by default', () => {
  const order = rowOrder(shape());
  assert.ok(order.sidebar < order.center, 'sidebar before chat');
  assert.ok(order.center < order.rightDivider, 'chat before the divider');
  assert.ok(order.rightDivider < order.right, 'divider before the panel');
});

test('with the preference on, panel and divider come before the chat', () => {
  const order = rowOrder(shape({ chatRight: true }));
  assert.ok(order.sidebar < order.right, 'sidebar still leads');
  assert.ok(order.right < order.rightDivider, 'panel, then its divider');
  assert.ok(order.rightDivider < order.center, 'then the chat at the far edge');
});

test('the panel is anchored at the row edge or just past the sidebar', () => {
  assert.equal(panelLeftOffset(false, 300), 0, 'no sidebar: the row edge');
  assert.equal(panelLeftOffset(true, 300), 300 + DIVIDER_WIDTH, 'past the sidebar and its divider');
});

test('the divider is the panel\'s chat-facing edge, so the panel grows towards the chat', () => {
  const rowWidth = 1400;

  // Panel at the right edge: pulling the divider left widens it.
  const right = { rowWidth, leftOffset: 0, panelFirst: false };
  assert.equal(panelWidthAtPointer({ ...right, x: 1000 }), 400);
  assert.equal(panelWidthAtPointer({ ...right, x: 999 }), 401);

  // Panel in front of the chat: pulling the divider right widens it.
  const left = { rowWidth, leftOffset: panelLeftOffset(true, 300), panelFirst: true };
  assert.equal(panelWidthAtPointer({ ...left, x: 704 }), 400);
  assert.equal(panelWidthAtPointer({ ...left, x: 705 }), 401);
});

test('the divider sits where the pointer would measure its own width', () => {
  const rowWidth = 1400;
  const panelWidth = 500;
  const leftOffset = panelLeftOffset(true, 300);

  for (const panelFirst of [false, true]) {
    const x = dividerCenterX({ rowWidth, panelWidth, leftOffset, panelFirst });
    const at = panelWidthAtPointer({ x, rowWidth, leftOffset, panelFirst });
    assert.equal(at, panelWidth + DIVIDER_WIDTH / 2, `panelFirst=${panelFirst}: half the handle`);
  }
});

test('the divider moves with the column that owns it', () => {
  const rowWidth = 1400;
  const leftOffset = panelLeftOffset(true, 300);
  const at = (panelFirst, width) => dividerCenterX({ rowWidth, panelWidth: width, leftOffset, panelFirst });

  assert.ok(at(false, 500) < at(false, 400), 'default: a wider panel reaches further left');
  assert.ok(at(true, 500) > at(true, 400), 'panel first: a wider panel reaches further right');
  assert.equal(at(false, 500), rowWidth - 500 - DIVIDER_WIDTH / 2);
  assert.equal(at(true, 500), leftOffset + 500 + DIVIDER_WIDTH / 2);
});
