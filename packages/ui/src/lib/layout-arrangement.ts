/**
 * Where each column sits in the workbench row.
 *
 * The sidebar is the platform's left rail and never moves. The one preference
 * is which side of the WORK PANEL the chat sits on: with the sidebar closed
 * that is the only pair of visible columns, so it reads as the two of them
 * swapping; with the sidebar open the chat either sits between the two columns
 * or takes the far edge.
 *
 * The row is ordered with CSS `order`, never by moving nodes: the centre owns
 * the composer and the right column owns the native views, and a tree reorder
 * would remount both. Everything that depends on the arrangement — the header
 * segments, the drag arithmetic, the native-view re-measure — derives it from
 * these functions, so no two copies of the rule can drift apart.
 */

/** Width of each resize divider (matches the `w-1` handles). */
export const DIVIDER_WIDTH = 4;

export interface RowShape {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  centerPanelOpen: boolean;
  /** The stored preference: chat to the right of the panel. */
  chatRight: boolean;
}

/** The work panel is to the LEFT of the chat (the chat takes the far edge). */
export function isPanelFirst(shape: RowShape): boolean {
  return shape.chatRight && shape.rightPanelOpen && shape.centerPanelOpen;
}

export interface RowOrder {
  sidebar: number;
  leftDivider: number;
  center: number;
  rightDivider: number;
  right: number;
}

/**
 * Flex order per column. The default row is sidebar | chat | panel; with the
 * preference on, the panel moves in front of the chat and the chat takes the
 * far edge. The sidebar and its divider keep the leading slots either way.
 */
export function rowOrder(shape: RowShape): RowOrder {
  return isPanelFirst(shape)
    ? { sidebar: 0, leftDivider: 1, right: 2, rightDivider: 3, center: 4 }
    : { sidebar: 0, leftDivider: 1, center: 2, rightDivider: 3, right: 4 };
}

/** x of the panel's outer edge — the side away from the chat. */
export function panelLeftOffset(sidebarOpen: boolean, sidebarWidth: number): number {
  return sidebarOpen ? sidebarWidth + DIVIDER_WIDTH : 0;
}

export type ColumnId = 'sidebar' | 'chat' | 'panel';

/**
 * The order the column toggles are drawn in: left to right, the same order the
 * columns are on screen. After a swap the panel's button moves into the middle
 * slot and the chat's to the right, so a button always sits where its column
 * sits — its icon says which column it is, its place says which side.
 *
 * A collapsed column keeps its slot: that is where it comes back.
 */
export function columnOrder(shape: RowShape): ColumnId[] {
  return shape.chatRight ? ['sidebar', 'panel', 'chat'] : ['sidebar', 'chat', 'panel'];
}

export type ColumnSlot = 'left' | 'center' | 'right';

/**
 * The side each work column carries in its toggle's label.
 *
 * The chat and the panel trade places, so a toggle named for its own column
 * ("chat" / "panel") would contradict what the user reads off the window half
 * the time. The label is positional instead: it names the side the column is
 * on RIGHT NOW, so "隐藏中间栏" always hides whatever the eye finds in the
 * middle.
 *
 * A column that is not on screen has no side; it is named for the side it
 * would take when shown — which is what its restore button promises.
 */
export function columnSlots(shape: RowShape): { chat: ColumnSlot; panel: ColumnSlot } {
  // The pair as it reads with both open. With the sidebar closed the two
  // visible columns really are the row's left and right, so the left one is
  // named 'left'.
  const first: ColumnSlot = shape.sidebarOpen ? 'center' : 'left';
  const both = shape.chatRight
    ? { panel: first, chat: 'right' as ColumnSlot }
    : { chat: first, panel: 'right' as ColumnSlot };
  if (shape.centerPanelOpen && shape.rightPanelOpen) return both;
  // Nothing on screen: name each column for where it lands once both are
  // open. "The middle one" twice in a row is not a choice, and a restore
  // button should point past the state it is restoring from.
  if (!shape.centerPanelOpen && !shape.rightPanelOpen) return both;
  // Only one is on screen: it spans the whole work area, so the middle is the
  // honest name for it.
  return shape.centerPanelOpen
    ? { chat: 'center', panel: both.panel }
    : { chat: both.chat, panel: 'center' };
}

/**
 * The panel's width for a pointer at `x` (row px).
 *
 * The divider is always the panel's chat-facing edge, so the panel grows by
 * pulling the divider towards the chat: when the panel sits against the row's
 * right edge its width is what is left of the pointer, and when it sits
 * against the sidebar its width is what is right of it.
 */
export function panelWidthAtPointer(pointer: {
  x: number;
  rowWidth: number;
  /** Left edge of the panel, from `panelLeftOffset`. */
  leftOffset: number;
  panelFirst: boolean;
}): number {
  return pointer.panelFirst ? pointer.x - pointer.leftOffset : pointer.rowWidth - pointer.x;
}

/** x of the divider's centre — where the collapse hint pill is drawn. */
export function dividerCenterX(divider: {
  rowWidth: number;
  panelWidth: number;
  leftOffset: number;
  panelFirst: boolean;
}): number {
  const half = DIVIDER_WIDTH / 2;
  return divider.panelFirst
    ? divider.leftOffset + divider.panelWidth + half
    : divider.rowWidth - divider.panelWidth - half;
}

/**
 * Native views are positioned in window coordinates, so a column that MOVES
 * without resizing is invisible to a ResizeObserver. The layout announces such
 * a move and the mounted slots re-measure.
 */
export const LAYOUT_SHIFT_EVENT = 'pi:layout:shift';

export function notifyLayoutShift(): void {
  window.dispatchEvent(new CustomEvent(LAYOUT_SHIFT_EVENT));
}
