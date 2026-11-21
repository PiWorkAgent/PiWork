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
function syncNativeTitleBar() {
  const api = (window as unknown as {
    electronAPI?: { invoke?: (channel: string, ...args: unknown[]) => Promise<unknown> };
  }).electronAPI;
  if (!api?.invoke) return;

  // Read the tokens back off the DOM so this stays correct if the palette
  // changes — no color values are duplicated here.
  const styles = getComputedStyle(document.body);
  const color = styles.backgroundColor;
  const symbolColor = styles.color;
  if (!color || !symbolColor) return;

  // The caption buttons sit on the header band, which is sized in rem and so
  // follows the 字号 setting. Report its measured height rather than a copy of
  // the constant in main, which would drift the moment either side changes.
  const header = document.querySelector<HTMLElement>('[data-drag-region]');
  const height = header?.offsetHeight;

  api.invoke('pi:window:setTitleBarOverlay', { color, symbolColor, height }).catch(() => {});
}
