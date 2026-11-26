import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Columns2, Copy, Minus, PanelLeft, PanelRight, Square, X, ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';
import { usePanelStore } from '@/stores/panel-store';
import { countPluginUpdates, usePluginStore } from '@/stores/plugin-store';
import { useI18n } from '@/i18n';
import { columnOrder, columnSlots } from '@/lib/layout-arrangement';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * `-webkit-app-region` is not a Tailwind utility and neither tailwind config
 * registers a plugin for it, so a class name would be silently purged from the
 * build (both configs scan source for class NAMES). It must be an inline style.
 *
 * Exported for the three-column layout, whose header band is the window drag
 * region; interactive segments opt out with NO_DRAG.
 */
export const DRAG: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties;
export const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export type HostPlatform = 'darwin' | 'win32' | 'linux' | 'web';

/** Window-chrome facts the renderer needs. Supplied by the host, never sniffed. */
export interface HostChrome {
  platform: HostPlatform;
  /** px reserved on the left for native window controls (macOS traffic lights). */
  insetLeft: number;
  /** px reserved on the right for native window controls (Windows caption buttons). */
  insetRight: number;
  /** Host draws its own minimize/maximize/close (Linux frameless). */
  customControls: boolean;
  /** Page zoom (CSS px per DIP); the insets above are DIPs. */
  zoomFactor?: () => number;
}

const WEB_CHROME: HostChrome = {
  platform: 'web',
  insetLeft: 0,
  insetRight: 0,
  customControls: false,
  zoomFactor: () => 1,
};

/**
 * Read the chrome descriptor the Electron preload exposes. The browser build has
 * no preload, so it falls back to a chrome-less descriptor — which is correct
 * for a normal browser tab (no native title bar to avoid, nothing to drag).
 */
export function getHostChrome(): HostChrome {
  const api = (window as unknown as { electronAPI?: { chrome?: Partial<HostChrome> } }).electronAPI;
  if (!api?.chrome) return WEB_CHROME;
  return { ...WEB_CHROME, ...api.chrome };
}

function TitleBarButton({
  label,
  active,
  onClick,
  dot,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  /** Small activity dot — used when the toggled region is collapsed. */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          data-activity-dot={dot ? 'true' : undefined}
          onClick={onClick}
          className={cn(
            'relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            active && 'bg-accent text-accent-foreground',
          )}
        >
          {children}
          {dot && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
        </button>
      </TooltipTrigger>
      {/*
        Left, not below: this cluster sits at the window's right edge, and when
        the right column is open a tooltip dropping downward lands on that
        column's native pane — which is a separate view stacked above the
        renderer, so it would cover the tooltip. Opening sideways keeps the
        tooltip inside the title-bar band, where no pane exists.
      */}
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The tooltip a column toggle carries, by the side the column is on. Full
 * sentences per state, not "Hide" + a slot name glued together: the two halves
 * are one phrase in some languages.
 */
const SLOT_LABEL = {
  left: { shown: '隐藏左侧栏', hidden: '显示左侧栏' },
  center: { shown: '隐藏中间栏', hidden: '显示中间栏' },
  right: { shown: '隐藏右侧栏', hidden: '显示右侧栏' },
} as const;

/**
 * Sidebar visibility toggles. These actions already existed on the ui store but
 * nothing in the app ever called them — there was no affordance at all.
 */
export function LayoutToggles() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const centerPanelOpen = useUIStore((s) => s.centerPanelOpen);
  const toggleCenterPanel = useUIStore((s) => s.toggleCenterPanel);
  const chatRightOfPanels = useUIStore((s) => s.chatRightOfPanels);
  const toggleChatSide = useUIStore((s) => s.toggleChatSide);
  const panels = usePanelStore((s) => s.panels);
  const runtime = usePanelStore((s) => s.runtime);
  // Plugin updates surface here when the right column is collapsed: the
  // plugin center lives in that column, so its own mark is not on screen.
  const pluginUpdates = usePluginStore((s) => countPluginUpdates(s.installed, s.catalog));
  const { t } = useI18n();

  // Only offer the toggle when its region has something to show. Web registers
  // no right-region panels, so a right toggle there would open an empty column.
  const hasRightPanels = panels.some((p) => p.region === 'right' && !p.hidden);

  // The two columns that can trade places are the chat and the work panel.
  // The sidebar is the platform's left rail and never moves; with it open the
  // chat moves out to the far edge instead of crossing it.
  const canSwapSides = rightPanelOpen && centerPanelOpen;

  // The row as it is on screen. Both the order of the toggles and the side
  // each one names are read from it, so neither can drift from the window.
  const shape = { sidebarOpen, rightPanelOpen, centerPanelOpen, chatRight: chatRightOfPanels };
  // The side each work column is on right now.
  const slots = columnSlots(shape);
  // Left to right, the order the columns are drawn in.
  const placed = columnOrder(shape);

  // The right rail is only rendered while the sidebar is open, so a badge or
  // unread dot on a panel of a collapsed sidebar would otherwise be invisible.
  // Surface it on the toggle itself.
  const rightActivity = useMemo(() => {
    if (rightPanelOpen) return false;
    if (pluginUpdates > 0) return true;
    return panels.some((p) => {
      if (p.region !== 'right' || p.hidden) return false;
      const rt = runtime[p.id];
      if (!rt) return false;
      return (
        rt.pending === true ||
        (rt.badge !== undefined && rt.badge !== null && rt.badge !== '') ||
        rt.activity === 'streaming' ||
        rt.activity === 'working' ||
        rt.activity === 'error'
      );
    });
  }, [panels, runtime, rightPanelOpen, pluginUpdates]);

  // Both halves below — the order the toggles are drawn in and the side each
  // one names — follow the swap (see `columnOrder` / `columnSlots`), so the
  // second button is always "隐藏中间栏" and always hides what is in the middle.
  return (
    <>
      {placed.map((id) => {
        if (id === 'sidebar') {
          return (
            <TitleBarButton
              key={id}
              // Closed, the left slot belongs to whichever work column took
              // it — calling this button "左侧栏" then would name that column
              // twice.
              label={t(sidebarOpen ? '隐藏左侧栏' : '显示侧栏')}
              active={sidebarOpen}
              onClick={toggleSidebar}
            >
              <PanelLeft className="h-4 w-4" />
            </TitleBarButton>
          );
        }
        if (id === 'chat') {
          return (
            <TitleBarButton
              key={id}
              label={t(SLOT_LABEL[slots.chat][centerPanelOpen ? 'shown' : 'hidden'])}
              active={centerPanelOpen}
              onClick={toggleCenterPanel}
            >
              <Columns2 className="h-4 w-4" />
            </TitleBarButton>
          );
        }
        return hasRightPanels ? (
          <TitleBarButton
            key={id}
            label={t(SLOT_LABEL[slots.panel][rightPanelOpen ? 'shown' : 'hidden'])}
            active={rightPanelOpen}
            dot={rightActivity}
            onClick={toggleRightPanel}
          >
            <PanelRight className="h-4 w-4" />
          </TitleBarButton>
        ) : null;
      })}
      {hasRightPanels && canSwapSides && (
        <TitleBarButton
          label={t(chatRightOfPanels ? '对话放回左侧' : '对话换到右侧')}
          active={chatRightOfPanels}
          onClick={toggleChatSide}
        >
          <ArrowLeftRight className="h-4 w-4" />
        </TitleBarButton>
      )}
    </>
  );
}

/** Self-drawn caption buttons for frameless platforms (Linux). Rendered by
 *  the layout's header-trailing zone. */
export function WindowControls() {
  const { t } = useI18n();
  // The glyph has to follow the window's real state: a maximized frameless
  // window kept showing the "maximize" square on Linux, so there was no way to
  // tell the two states apart.
  const [maximized, setMaximized] = useState(false);
  const api = (window as unknown as {
    electronAPI?: { invoke?: (c: string, ...a: unknown[]) => Promise<unknown> };
  }).electronAPI;
  const invoke = (channel: string) => {
    api?.invoke?.(channel).catch(() => {});
  };

  useEffect(() => {
    if (!api?.invoke) return;
    let alive = true;
    const refresh = () => {
      api
        .invoke?.('pi:window:isMaximized')
        .then((value) => {
          if (alive) setMaximized(value === true);
        })
        .catch(() => {});
    };
    refresh();
    // Double-click on the band and WM gestures maximize too; resize is the
    // renderer-side signal for both.
    window.addEventListener('resize', refresh);
    return () => {
      alive = false;
      window.removeEventListener('resize', refresh);
    };
  }, [api]);

  const toggleMaximize = () => {
    invoke('pi:window:maximize');
    // The WM settles asynchronously; still refresh in case no resize fires.
    setTimeout(() => {
      api
        ?.invoke?.('pi:window:isMaximized')
        .then((value) => setMaximized(value === true))
        .catch(() => {});
    }, 120);
  };

  return (
    <div className="flex h-full items-stretch" style={NO_DRAG}>
      <button
        type="button"
        aria-label={t('最小化')}
        className="flex w-11 items-center justify-center text-muted-foreground hover:bg-accent"
        onClick={() => invoke('pi:window:minimize')}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={t(maximized ? '还原' : '最大化')}
        className="flex w-11 items-center justify-center text-muted-foreground hover:bg-accent"
        onClick={toggleMaximize}
      >
        {maximized ? <Copy className="h-3 w-3 -scale-x-100" /> : <Square className="h-3 w-3" />}
      </button>
      <button
        type="button"
        aria-label={t('关闭')}
        className="flex w-11 items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => invoke('pi:window:close')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
