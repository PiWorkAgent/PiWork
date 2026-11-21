import { useEffect } from 'react';
import { applyFontScale, useThemeStore } from '../stores/theme-store';

export function useTheme() {
  const { theme, resolvedTheme, fontScale, setTheme, setResolvedTheme, setFontScale } = useThemeStore();

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateResolved = () => {
      if (theme === 'system') {
        const resolved = mediaQuery.matches ? 'dark' : 'light';
        setResolvedTheme(resolved);
        applyTheme(resolved);
      } else {
        setResolvedTheme(theme);
        applyTheme(theme);
      }
    };

    updateResolved();

    const handler = () => {
      if (theme === 'system') {
        updateResolved();
      }
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme, setResolvedTheme]);

  // The action already applies the size; doing it once more on mount (and on
  // any future external `setState`) keeps <html> in step with the store.
  // The native title-bar overlay is sized in device pixels by the host, not by
  // CSS, so it has to be told again whenever the header band changes height.
  useEffect(() => {
    applyFontScale(fontScale);
    syncNativeTitleBar();
  }, [fontScale]);

  // Page zoom changes the header band's DIP height without changing its CSS
  // height, so the native overlay has to be re-synced (and colors follow).
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(syncNativeTitleBar, 120);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return { theme, resolvedTheme, fontScale, setTheme, setFontScale };
}

function applyTheme(theme: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  syncNativeTitleBar();
}

/**
 * Push the resolved theme colors to the host's native window chrome — Windows
 * draws its caption buttons via `titleBarOverlay` and has to be told the color.
 * No-op in the browser build, which has no preload bridge.
 */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Computed color → channels. Handles `rgb()`/`rgba()` and the `color(srgb …)`
 * serialization Chromium uses for `color-mix()` (Tailwind 4's `bg-black/80`).
 */
function parseRgb(value: string): Rgb | null {
  const legacy = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
  if (legacy) return { r: Number(legacy[1]), g: Number(legacy[2]), b: Number(legacy[3]) };
  const srgb = /color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (srgb) {
    return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255 };
  }
  return null;
}

function clampAlpha(alpha: number): number {
  return Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
}

function alphaOf(value: string): number {
  const rgba = /rgba\([^)]*[,\s/]\s*([\d.]+)\s*\)$/i.exec(value);
  if (rgba) return clampAlpha(Number(rgba[1]));
  const srgb = /color\([^)]*\/\s*([\d.]+)\s*\)/i.exec(value);
  if (srgb) return clampAlpha(Number(srgb[1]));
  // `oklab(0 0 0 / 0.8)` & friends: the separator form is the same.
  const slashPercent = /\/\s*([\d.]+)%\s*\)$/.exec(value);
  if (slashPercent) return clampAlpha(Number(slashPercent[1]) / 100);
  const slash = /\/\s*([\d.]+)\s*\)$/.exec(value);
  if (slash) return clampAlpha(Number(slash[1]));
  return 1;
}

function compositeColor(base: Rgb, overlay: Rgb, alpha: number): string {
  const mix = (a: number, b: number): number => Math.round(a * (1 - alpha) + b * alpha);
  return `rgb(${mix(base.r, overlay.r)}, ${mix(base.g, overlay.g)}, ${mix(base.b, overlay.b)})`;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Full-window modal backdrops (`bg-black/80`, `bg-black/50`) currently on
 * screen. The Windows caption area is painted by the OS ABOVE the page, so a
 * DOM backdrop cannot dim it — the overlay color is composed from the theme
 * background and the topmost backdrop instead.
 */
const activeChromeOverlays = new Set<HTMLElement>();

/**
 * Register a modal backdrop for as long as it is mounted. Returns the release
 * function (call from the effect cleanup).
 */
export function registerNativeChromeOverlay(element: HTMLElement): () => void {
  activeChromeOverlays.add(element);
  syncNativeTitleBar();
  return () => {
    activeChromeOverlays.delete(element);
    syncNativeTitleBar();
  };
}

function syncNativeTitleBar() {
  const api = (window as unknown as {
    electronAPI?: {
      invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
      chrome?: { zoomFactor?: () => number };
    };
  }).electronAPI;
  if (!api?.invoke) return;

  // Read the tokens back off the DOM so this stays correct if the palette
  // changes — no color values are duplicated here.
  const styles = getComputedStyle(document.body);
  const background = styles.backgroundColor;
  const foreground = styles.color;
  if (!background || !foreground) return;

  let color = background;
  let symbolColor = foreground;
  // The topmost backdrop wins when dialogs are stacked.
  const top = [...activeChromeOverlays].pop();
  const backgroundRgb = parseRgb(background);
  const foregroundRgb = parseRgb(foreground);
  if (top && backgroundRgb && foregroundRgb) {
    const backdrop = getComputedStyle(top).backgroundColor;
    // Every full-window backdrop in this app is black (`bg-black/80`,
    // `bg-black/50`). If the computed value is serialized in a space we do not
    // parse, dim with black rather than silently skipping the dim.
    const backdropRgb = parseRgb(backdrop) ?? { r: 0, g: 0, b: 0 };
    color = compositeColor(backgroundRgb, backdropRgb, alphaOf(backdrop));
    const composited = parseRgb(color);
    // Dimmed surfaces can flip the required glyph contrast (light theme:
    // near-black glyphs on a dark corner). Pick whichever theme color reads
    // better against the composited background.
    if (composited) {
      symbolColor =
        contrastRatio(composited, foregroundRgb) >= contrastRatio(composited, backgroundRgb)
          ? foreground
          : background;
    }
  }

  // The caption buttons sit on the header band, which follows the 字号
  // setting. Report its measured height rather than a copy of the constant in
  // main, which would drift the moment either side changes. The overlay is
  // measured in DIPs while `offsetHeight` is CSS px, so apply page zoom.
  const header = document.querySelector<HTMLElement>('[data-drag-region]');
  const zoomValue = api.chrome?.zoomFactor?.() ?? 1;
  const zoom = Number.isFinite(zoomValue) && zoomValue > 0 ? zoomValue : 1;
  const height = header ? header.offsetHeight * zoom : undefined;

  api.invoke('pi:window:setTitleBarOverlay', { color, symbolColor, height }).catch(() => {});
}
