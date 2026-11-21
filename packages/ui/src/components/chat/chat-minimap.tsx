import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { Message, PluginMessage, ToolCallBlock, ToolResultBlock } from '@pi/types';
import { useAskStore } from '@/stores/ask-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useUIStore } from '@/stores/ui-store';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';

/**
 * A slim turn rail for the conversation, modelled on the editor overview ruler
 * and on the turn outline shipped by ChatGPT / Notion / VS Code chat — a
 * timeline, not a second scrollbar.
 *
 * Geometry comes from Virtuoso's own size model (`getState().ranges`), never
 * from mounted DOM: only a couple of screens are ever rendered, and the sizes
 * are the same ones the scroller uses for scrollHeight, so the rail, the
 * viewport bracket and a click's landing point agree by construction.
 *
 * The collapsed rail is deliberately quiet:
 *   - a 2px spine carries each turn's length;
 *   - a user turn adds a 12px chapter tick — the marks the eye scans for;
 *   - assistant / plugin spans stay barely visible;
 *   - error → a destructive marker, pending → amber, streaming → emerald,
 *     all 3px at the start of the turn (overview-ruler semantics);
 *   - day boundaries are 1px rules.
 * Hovering a turn opens a small card with its role and first line, the pattern
 * every shipped equivalent uses; the rail itself never carries text.
 */

/** Date separator as produced by `addDateSeparators` in chat-timeline. */
export type MinimapSeparator = { type: 'date_separator'; id: string; label?: string };
export type MinimapItem = Message | MinimapSeparator;

type EntryKind = 'date' | Message['role'];
type EntryTone = 'normal' | 'running' | 'warning' | 'error';

interface MinimapEntry {
  kind: EntryKind;
  tone: EntryTone;
  /** One-line preview shown in the hover card; empty for date separators. */
  label: string;
}

interface SizeRangeLike {
  startIndex: number;
  endIndex: number;
  size: number;
}

interface Geometry {
  count: number;
  /** `start[i]` is the content-space offset of item i; `start[count]` is the total. */
  start: Float64Array;
  total: number;
}

interface ThemeColors {
  /** HSL triplet, e.g. `0 0% 5%`; alpha is appended per use. */
  foreground: string;
  destructive: string;
}

/** Virtuoso's initial estimate before anything has been measured. */
const FALLBACK_ITEM_HEIGHT = 56;
/** CSS width of the canvas (and the pointer target). */
const RAIL_WIDTH = 16;
/** Width of a user-turn tick / state marker; the spine is 2px. */
const TICK_WIDTH = 12;
const TICK_INSET = (RAIL_WIDTH - TICK_WIDTH) / 2;
/** Minimum thumb height in CSS px so it stays grabbable in very long chats. */
const MIN_THUMB_HEIGHT = 12;
/** Amber-500 / emerald-500: the same pair the timeline already uses. */
const WARNING_COLOR = '#f59e0b';
const RUNNING_COLOR = '#10b981';

function isSeparator(item: MinimapItem): item is MinimapSeparator {
  return (item as { type?: string }).type === 'date_separator';
}

function hasToolError(message: Message): boolean {
  return (message.blocks ?? []).some(
    (block) => block.type === 'tool_result' && Boolean((block as ToolResultBlock).isError),
  );
}

function hostsPendingRequest(message: Message, pendingIds: ReadonlySet<string>): boolean {
  return (message.blocks ?? []).some(
    (block) => block.type === 'tool_call' && pendingIds.has((block as ToolCallBlock).toolCallId),
  );
}

/** Strip the most common Markdown syntax so the preview reads as text. */
function plainPreview(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First readable line of a message, for the hover card. */
function snippetOf(message: Message): string {
  const raw =
    message.role === 'plugin'
      ? (message as PluginMessage).title || message.content || ''
      : message.content || '';
  const line = plainPreview(raw.replace(/\[Attached:[^\]]*\]/g, ' '));
  if (line) return line.length > 96 ? `${line.slice(0, 96)}…` : line;

  // A reply that is only tool calls still deserves a recognizable label.
  const tool = (message.blocks ?? []).find((block) => block.type === 'tool_call') as
    ToolCallBlock | undefined;
  return tool?.toolName ?? '';
}

function buildEntries(
  items: readonly MinimapItem[],
  pendingIds: ReadonlySet<string>,
): MinimapEntry[] {
  return items.map((item) => {
    if (isSeparator(item)) return { kind: 'date', tone: 'normal', label: item.label ?? '' };

    const message = item;
    const pluginStatus =
      message.role === 'plugin' ? (message as PluginMessage).pluginStatus : undefined;

    let tone: EntryTone = 'normal';
    if (message.status === 'error' || hasToolError(message) || pluginStatus === 'error') {
      tone = 'error';
    } else if (hostsPendingRequest(message, pendingIds) || pluginStatus === 'warning') {
      tone = 'warning';
    } else if (message.status === 'streaming') {
      tone = 'running';
    }

    return { kind: message.role, tone, label: snippetOf(message) };
  });
}

function roleLabelKey(kind: EntryKind): MessageKey | null {
  if (kind === 'date') return null;
  if (kind === 'user') return '你';
  if (kind === 'assistant') return '助手';
  if (kind === 'plugin') return '插件';
  return '系统';
}

function sizesFromRanges(ranges: readonly SizeRangeLike[], count: number): Float64Array {
  const sizes = new Float64Array(count);
  let filled = 0;
  for (const range of ranges) {
    if (filled >= count) break;
    const from = Math.max(0, Math.min(count - 1, range.startIndex));
    const to = Math.max(from, Math.min(count - 1, range.endIndex));
    const size = range.size > 0 ? range.size : FALLBACK_ITEM_HEIGHT;
    for (let i = from; i <= to; i++) {
      if (sizes[i] === 0) {
        sizes[i] = size;
        filled++;
      }
    }
  }
  for (let i = 0; i < count; i++) {
    if (sizes[i] === 0) sizes[i] = FALLBACK_ITEM_HEIGHT;
  }
  return sizes;
}

function readTheme(): ThemeColors {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    foreground: read('--foreground', '0 0% 10%'),
    destructive: read('--destructive', '0 72% 51%'),
  };
}

/**
 * The rail is a timeline, not a scrollbar: a 2px spine carries the turn
 * lengths, and user turns add a 12px tick at their start — the chapter marks
 * the eye scans for. State is a 3px marker at the top of its turn.
 */
function spineColor(kind: EntryKind, theme: ThemeColors): string {
  switch (kind) {
    case 'assistant':
      return `hsl(${theme.foreground} / 0.12)`;
    case 'plugin':
    case 'system':
      return `hsl(${theme.foreground} / 0.07)`;
    default:
      return `hsl(${theme.foreground} / 0.18)`;
  }
}

function toneColor(tone: EntryTone, theme: ThemeColors): string | null {
  if (tone === 'error') return `hsl(${theme.destructive} / 0.92)`;
  if (tone === 'warning') return WARNING_COLOR;
  if (tone === 'running') return RUNNING_COLOR;
  return null;
}

export interface ChatMinimapProps {
  /** The very items handed to Virtuoso, in order. */
  items: readonly MinimapItem[];
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  /** The Virtuoso scroller element; geometry and scroll state live there. */
  scroller: HTMLElement | null;
  /** True while the pointer is anywhere over the conversation viewport. */
  active: boolean;
  /** Reset the transient hover state when the conversation changes. */
  sessionId: string | null;
}

/**
 * The rail fades in only for a conversation worth navigating and only while
 * the pointer is inside the timeline (or the rail itself is keyboard-focused).
 */
export function ChatMinimap({ items, virtuosoRef, scroller, active, sessionId }: ChatMinimapProps) {
  const { t } = useI18n();
  const pendingByToolCall = usePermissionStore((s) => s.pendingByToolCall);
  const askRequests = useAskStore((s) => s.requests);
  const activeSessionId = useUIStore((s) => s.activeSessionId);

  const pendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const request of Object.values(pendingByToolCall)) {
      if (request.sessionId === activeSessionId) ids.add(request.toolCallId);
    }
    for (const request of Object.values(askRequests)) {
      if (request.sessionId === activeSessionId) ids.add(request.toolCallId);
    }
    return ids;
  }, [pendingByToolCall, askRequests, activeSessionId]);

  const entries = useMemo(() => buildEntries(items, pendingIds), [items, pendingIds]);
  // Tone/kind sequence only: during streaming the array identity changes every
  // token, but almost all of those redraws would be identical.
  const signature = useMemo(
    () => entries.map((entry) => `${entry.kind}:${entry.tone}`).join('|'),
    [entries],
  );

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollElementRef = useRef<HTMLElement | null>(scroller);
  const entriesRef = useRef(entries);
  const geoRef = useRef<Geometry | null>(null);
  const themeRef = useRef<ThemeColors | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const hoverRef = useRef(-1);
  const dragRef = useRef(false);
  const grabOffsetRef = useRef(0);
  const frameRef = useRef(0);
  const mountedRef = useRef(true);
  const activeRef = useRef(false);
  const longRef = useRef(false);
  const [long, setLong] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Entry whose hover card is open; null when the pointer is outside a turn. */
  const [hoverCard, setHoverCard] = useState<number | null>(null);
  const hoverTimerRef = useRef(0);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** Pointer position inside the canvas; the card tracks it, not the entry centre. */
  const hoverYRef = useRef(0);

  const scrollerDomId = useId();

  scrollElementRef.current = scroller;
  entriesRef.current = entries;
  activeRef.current = active || focused;

  const ensureContentCanvas = useCallback(() => {
    if (!contentCanvasRef.current) contentCanvasRef.current = document.createElement('canvas');
    return contentCanvasRef.current;
  }, []);

  const drawContent = useCallback(() => {
    const geo = geoRef.current;
    const canvas = canvasRef.current;
    const content = ensureContentCanvas();
    const size = sizeRef.current;
    if (!geo || !canvas || size.height <= 0 || size.width <= 0) return;

    const width = Math.round(size.width * size.dpr);
    const height = Math.round(size.height * size.dpr);
    if (content.width !== width || content.height !== height) {
      content.width = width;
      content.height = height;
    }
    const ctx = content.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const theme = themeRef.current ?? readTheme();
    themeRef.current = theme;
    const scale = geo.total > 0 ? size.height / geo.total : 0;
    const list = entriesRef.current;
    const count = Math.min(list.length, geo.count);

    for (let i = 0; i < count; i++) {
      const entry = list[i];
      const top = geo.start[i] * scale;
      const bottom = geo.start[i + 1] * scale;

      if (entry.kind === 'date') {
        // A day is a quiet rule, not a block.
        ctx.fillStyle = `hsl(${theme.foreground} / 0.22)`;
        ctx.fillRect(
          TICK_INSET,
          Math.min(size.height - 1, top + (bottom - top) / 2),
          TICK_WIDTH,
          1,
        );
        continue;
      }

      const height = Math.max(1, bottom - top - 1);
      const spineWidth = entry.kind === 'assistant' || entry.kind === 'user' ? 2 : 1.5;
      ctx.fillStyle = spineColor(entry.kind, theme);
      ctx.beginPath();
      ctx.roundRect((RAIL_WIDTH - spineWidth) / 2, top, spineWidth, height, spineWidth / 2);
      ctx.fill();

      // A user turn is the chapter marker the eye scans for.
      if (entry.kind === 'user') {
        ctx.fillStyle = `hsl(${theme.foreground} / 0.58)`;
        ctx.beginPath();
        ctx.roundRect(TICK_INSET, top, TICK_WIDTH, 2, 1);
        ctx.fill();
      }

      const marker = toneColor(entry.tone, theme);
      if (marker) {
        ctx.fillStyle = marker;
        ctx.beginPath();
        ctx.roundRect(TICK_INSET, top, TICK_WIDTH, 3, 1.5);
        ctx.fill();
      }
    }
  }, [ensureContentCanvas]);

  const drawView = useCallback(() => {
    const canvas = canvasRef.current;
    const content = ensureContentCanvas();
    const size = sizeRef.current;
    const scrollerElement = scrollElementRef.current;
    if (!canvas || size.height <= 0 || size.width <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Blit the static layer 1:1 in device pixels.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (content.width !== canvas.width || content.height !== canvas.height) {
      drawContent();
    }
    ctx.drawImage(content, 0, 0);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);

    const geo = geoRef.current;
    const theme = themeRef.current ?? readTheme();
    themeRef.current = theme;
    const scale = geo && geo.total > 0 ? size.height / geo.total : 0;

    // Hovered turn: a soft highlight plus a crisp chapter tick. The hover card
    // carries the text, so the rail itself stays wordless.
    const hover = hoverRef.current;
    if (geo && scale > 0 && hover >= 0 && hover < Math.min(entriesRef.current.length, geo.count)) {
      const top = geo.start[hover] * scale;
      const bottom = geo.start[hover + 1] * scale;
      const height = Math.max(2, bottom - top);
      ctx.fillStyle = `hsl(${theme.foreground} / 0.055)`;
      ctx.beginPath();
      ctx.roundRect(TICK_INSET, top, TICK_WIDTH, height, 2);
      ctx.fill();
      ctx.fillStyle = `hsl(${theme.foreground} / 0.72)`;
      ctx.beginPath();
      ctx.roundRect(TICK_INSET, top, TICK_WIDTH, 2, 1);
      ctx.fill();
    }

    if (scrollerElement) {
      const scrollHeight = scrollerElement.scrollHeight;
      const clientHeight = scrollerElement.clientHeight;
      const scrollTop = scrollerElement.scrollTop;
      if (scrollHeight > 0) {
        const thumbHeight = Math.min(
          size.height,
          Math.max(MIN_THUMB_HEIGHT, (clientHeight / scrollHeight) * size.height),
        );
        const thumbTop = Math.min(
          Math.max(0, (scrollTop / scrollHeight) * size.height),
          size.height - thumbHeight,
        );
        // A viewport bracket, not a solid thumb: the turns stay readable
        // underneath while the window's extent is still obvious.
        const thumbWidth = 10;
        const thumbX = (RAIL_WIDTH - thumbWidth) / 2;
        ctx.fillStyle = `hsl(${theme.foreground} / 0.035)`;
        ctx.strokeStyle = `hsl(${theme.foreground} / ${dragRef.current ? 0.28 : 0.16})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(thumbX + 0.5, thumbTop + 0.5, thumbWidth - 1, thumbHeight - 1, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = `hsl(${theme.foreground} / ${dragRef.current ? 0.5 : 0.34})`;
        ctx.fillRect(thumbX + 2, thumbTop, thumbWidth - 4, 1);
        ctx.fillRect(thumbX + 2, thumbTop + thumbHeight - 1, thumbWidth - 4, 1);
      }
      const maxScroll = Math.max(1, scrollHeight - clientHeight);
      hostRef.current?.setAttribute(
        'aria-valuenow',
        String(Math.round((scrollTop / maxScroll) * 100)),
      );
    }
  }, [drawContent, ensureContentCanvas]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      drawView();
    });
  }, [drawView]);

  const updateLong = useCallback(() => {
    const geo = geoRef.current;
    const scrollerElement = scrollElementRef.current;
    const next = !!geo && !!scrollerElement && geo.total > scrollerElement.clientHeight * 1.5;
    if (longRef.current !== next) {
      longRef.current = next;
      setLong(next);
    }
  }, []);

  const refreshGeometry = useCallback(() => {
    const handle = virtuosoRef.current;
    const count = entriesRef.current.length;
    if (!handle || count === 0) {
      geoRef.current = null;
      return;
    }
    try {
      handle.getState((state) => {
        if (!mountedRef.current) return;
        const sizes = sizesFromRanges(state.ranges as SizeRangeLike[], count);
        const start = new Float64Array(count + 1);
        let total = 0;
        for (let i = 0; i < count; i++) {
          start[i] = total;
          total += sizes[i];
        }
        start[count] = total;
        geoRef.current = { count, start, total };
        drawContent();
        scheduleDraw();
        updateLong();
      });
    } catch {
      // Virtuoso not mounted yet; the next scroll/resize pass retries.
    }
  }, [drawContent, scheduleDraw, updateLong, virtuosoRef]);

  const resizeCanvases = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (
      sizeRef.current.width === width &&
      sizeRef.current.height === height &&
      sizeRef.current.dpr === dpr
    ) {
      return;
    }
    sizeRef.current = { width, height, dpr };
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    drawContent();
    scheduleDraw();
    updateLong();
  }, [drawContent, scheduleDraw, updateLong]);

  // Static layer redraw: only when the block sequence or the theme changes.
  useEffect(() => {
    drawContent();
    scheduleDraw();
  }, [signature, drawContent, scheduleDraw]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.setAttribute('aria-valuemin', '0');
    host.setAttribute('aria-valuemax', '100');
    host.setAttribute('aria-valuenow', '0');
  }, []);

  // Theme is class-based (`.dark` on <html>); a class flip invalidates the
  // resolved HSL triplets cached for the canvas.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      themeRef.current = null;
      drawContent();
      scheduleDraw();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [drawContent, scheduleDraw]);

  // Canvas size follows the rail's rendered box; DPR changes (window moving
  // between displays) come through the same observer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => resizeCanvases());
    observer.observe(canvas);
    resizeCanvases();
    return () => observer.disconnect();
  }, [resizeCanvases]);

  // Scroller wiring: scroll drives the thumb, resize and periodic passes keep
  // the geometry model in step with streaming growth and image loads.
  useEffect(() => {
    if (!scroller) return;
    let lastGeometryAt = 0;
    const onScroll = () => {
      scheduleDraw();
      const now = performance.now();
      if (now - lastGeometryAt > 250) {
        lastGeometryAt = now;
        refreshGeometry();
      }
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(() => refreshGeometry());
    observer.observe(scroller);
    refreshGeometry();
    const timer = window.setInterval(() => {
      if (activeRef.current || dragRef.current) refreshGeometry();
    }, 800);

    if (!scroller.id) scroller.id = scrollerDomId;
    hostRef.current?.setAttribute('aria-controls', scroller.id);

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [scroller, refreshGeometry, scheduleDraw, scrollerDomId]);

  useEffect(() => {
    refreshGeometry();
  }, [items.length, refreshGeometry]);

  // The pointer may still be over the rail when another conversation lands;
  // its index belongs to the old transcript, so close the card and let the
  // next pointer move resolve the new turn under the cursor.
  useEffect(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = 0;
    }
    hoverRef.current = -1;
    setHoverCard(null);
  }, [sessionId]);

  // Entering the timeline is the moment the rail becomes visible; refresh then
  // so a long idle stream is not shown with stale block heights.
  useEffect(() => {
    if (!active) return;
    refreshGeometry();
    scheduleDraw();
  }, [active, refreshGeometry, scheduleDraw]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = 0;
      }
      // Reset the handle too: under StrictMode the cleanup runs and the same
      // refs survive the simulated remount, so a stale id would block every
      // later frame with "already scheduled".
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, []);

  const canvasHeight = () => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    return canvas.clientHeight || canvas.getBoundingClientRect().height;
  };

  const thumbMetrics = () => {
    const scrollerElement = scrollElementRef.current;
    const height = canvasHeight();
    if (!scrollerElement || height <= 0) return null;
    const scrollHeight = Math.max(1, scrollerElement.scrollHeight);
    const thumbHeight = Math.min(
      height,
      Math.max(MIN_THUMB_HEIGHT, (scrollerElement.clientHeight / scrollHeight) * height),
    );
    const top = Math.min(
      Math.max(0, (scrollerElement.scrollTop / scrollHeight) * height),
      height - thumbHeight,
    );
    return { height, top, thumbHeight };
  };

  const contentYAt = (clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return Math.min(rect.height, Math.max(0, clientY - rect.top));
  };

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = 0;
    }
  }, []);

  const showHoverCard = (index: number, immediate: boolean) => {
    clearHoverTimer();
    if (index < 0) {
      setHoverCard(null);
      return;
    }
    if (immediate) {
      setHoverCard(index);
      return;
    }
    // A short delay keeps the card from flickering while the pointer sweeps
    // across the rail.
    hoverTimerRef.current = window.setTimeout(() => setHoverCard(index), 90);
  };

  const positionCard = () => {
    const element = cardRef.current;
    const height = sizeRef.current.height;
    if (!element || height <= 0) return;
    element.style.top = `${Math.min(height - 36, Math.max(36, hoverYRef.current))}px`;
  };

  const updateHover = (index: number, immediate: boolean) => {
    if (index !== hoverRef.current) {
      hoverRef.current = index;
      scheduleDraw();
    }
    if (immediate || index !== hoverCard) showHoverCard(index, immediate);
    positionCard();
  };

  const entryAt = (y: number): number => {
    const geo = geoRef.current;
    const height = canvasHeight();
    if (!geo || height <= 0) return -1;
    const target = (y / height) * geo.total;
    const count = Math.min(entriesRef.current.length, geo.count);
    let low = 0;
    let high = count - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (geo.start[mid] <= target) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  };

  const scrollToPointer = (y: number) => {
    const scrollerElement = scrollElementRef.current;
    const height = canvasHeight();
    if (!scrollerElement || height <= 0) return;
    const fraction = (y - grabOffsetRef.current) / height;
    const max = Math.max(0, scrollerElement.scrollHeight - scrollerElement.clientHeight);
    scrollerElement.scrollTop = Math.min(max, Math.max(0, fraction * scrollerElement.scrollHeight));
    scheduleDraw();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrollElementRef.current || !longRef.current) return;
    // No focus() here: a pointer click must not pin the rail open after the
    // pointer leaves. Keyboard users reach it with Tab (tabIndex below).
    event.preventDefault();
    hostRef.current?.setPointerCapture(event.pointerId);
    const y = contentYAt(event.clientY);
    hoverYRef.current = y;
    const metrics = thumbMetrics();
    if (metrics) {
      const inside = y >= metrics.top && y <= metrics.top + metrics.thumbHeight;
      grabOffsetRef.current = inside ? y - metrics.top : metrics.thumbHeight / 2;
    } else {
      grabOffsetRef.current = 0;
    }
    dragRef.current = true;
    setDragging(true);
    scrollToPointer(y);
    updateHover(entryAt(y), true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const y = contentYAt(event.clientY);
    hoverYRef.current = y;
    if (dragRef.current) {
      scrollToPointer(y);
      updateHover(entryAt(y), true);
      return;
    }
    updateHover(entryAt(y), false);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    setDragging(false);
    if (hostRef.current?.hasPointerCapture(event.pointerId)) {
      hostRef.current.releasePointerCapture(event.pointerId);
    }
    scheduleDraw();
  };

  const handlePointerLeave = () => {
    if (dragRef.current) return;
    clearHoverTimer();
    if (hoverRef.current !== -1 || hoverCard !== null) {
      hoverRef.current = -1;
      setHoverCard(null);
      scheduleDraw();
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const scrollerElement = scrollElementRef.current;
    if (!scrollerElement) return;
    scrollerElement.scrollBy({ top: event.deltaY });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const scrollerElement = scrollElementRef.current;
    if (!scrollerElement) return;
    const page = scrollerElement.clientHeight * 0.9;
    switch (event.key) {
      case 'ArrowUp':
        scrollerElement.scrollBy({ top: -40 });
        break;
      case 'ArrowDown':
        scrollerElement.scrollBy({ top: 40 });
        break;
      case 'PageUp':
        scrollerElement.scrollBy({ top: -page });
        break;
      case 'PageDown':
        scrollerElement.scrollBy({ top: page });
        break;
      case 'Home':
        scrollerElement.scrollTop = 0;
        break;
      case 'End':
        scrollerElement.scrollTop = scrollerElement.scrollHeight;
        break;
      default:
        return;
    }
    event.preventDefault();
    scheduleDraw();
  };

  useEffect(() => {
    if (long && (active || focused)) return;
    clearHoverTimer();
    hoverRef.current = -1;
    setHoverCard(null);
  }, [long, active, focused, clearHoverTimer]);

  const visible = long && (active || focused);

  const card = hoverCard !== null ? entries[hoverCard] : undefined;
  const cardKey = card ? roleLabelKey(card.kind) : null;
  const cardRole = cardKey ? t(cardKey) : '';
  const cardTop = Math.min(
    Math.max(36, hoverYRef.current),
    Math.max(36, sizeRef.current.height - 36),
  );

  return (
    <div
      ref={hostRef}
      role="scrollbar"
      aria-label={t('对话导航')}
      aria-orientation="vertical"
      tabIndex={long ? 0 : -1}
      data-visible={visible ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => {
        if (!dragRef.current) return;
        dragRef.current = false;
        setDragging(false);
        scheduleDraw();
      }}
      onPointerLeave={handlePointerLeave}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      className={cn(
        'absolute bottom-2 right-2 top-2 z-10 w-4 rounded-full',
        'transition-opacity duration-200 motion-reduce:transition-none',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        dragging ? 'cursor-grabbing' : 'cursor-pointer',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
      {card && (
        <div
          ref={cardRef}
          aria-hidden="true"
          style={{ top: cardTop }}
          className={cn(
            'pointer-events-none absolute right-[calc(100%+10px)] z-10 w-max max-w-60 -translate-y-1/2',
            'rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md',
            'animate-in fade-in-0 duration-150 motion-reduce:animate-none',
          )}
        >
          {cardRole && (
            <div className="text-[0.625rem] font-medium text-muted-foreground">{cardRole}</div>
          )}
          <div className={cn('line-clamp-2 text-xs leading-snug', cardRole && 'mt-0.5')}>
            {card.label || cardRole || '—'}
          </div>
          <span className="absolute -right-[5px] top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-r border-t border-border bg-popover" />
        </div>
      )}
    </div>
  );
}
