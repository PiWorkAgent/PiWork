import type { PluginInfo } from '@pi/types';
import { pluginPanelId, usePanelStore } from '@/stores/panel-store';
import { useUIStore } from '@/stores/ui-store';

/**
 * Where a link in the app's own UI opens.
 *
 * The shell window is not a browser: markdown links render `target=_blank` and
 * the main process hands every such request to `shell.openExternal`
 * (`window-manager.ts`), so a click lands in Safari/Chrome even when the app's
 * own browser panel sits right there — with the user's logins and the agent's
 * page tools in it. That default is the right fallback (an install predating
 * the browser plugin has nowhere else to go), not the right answer.
 *
 * So a plain click on a web link opens a NEW tab in the browser panel.
 * Everything else keeps the system browser: modified clicks (⌘/Ctrl, shift,
 * alt — the platform's "somewhere else" gestures), non-web schemes
 * (`mailto:`, `file:`), and any setup where no plugin claims web pages (an
 * older install, the web build).
 */

/** The right-column panel that shows web pages, or null when nothing does. */
export function browserPanelKey(plugins: readonly PluginInfo[]): string | null {
  // The `browser` capability is what a plugin is GRANTED to own web pages
  // with; the panel it contributes is where those pages are shown. No plugin
  // id is named here, so a different browser plugin would qualify too.
  for (const plugin of plugins) {
    if (!plugin.permissions?.includes('browser')) continue;
    const panel = plugin.panels?.find(
      (p) => Boolean(p.entry) && !p.hidden && (p.region ?? 'right') === 'right',
    );
    if (panel) return pluginPanelId(plugin.id, panel.id);
  }
  return null;
}

/** `href` as an absolute http(s) URL, or null when it is not one. */
export function webUrl(href: string | undefined | null): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The part of a click this decision reads (so it can be tested without a DOM). */
export interface LinkClick {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Whether this click is a plain one — the kind that belongs in the panel.
 * Modified clicks are the platform's "somewhere else" gestures and keep the
 * system browser.
 */
export function isPlainClick(event: LinkClick): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/**
 * Open `href` as a new tab in the browser panel. Returns false when the link
 * is not the panel's to take — the caller must then let the default happen.
 */
export function openLinkInBrowserPanel(href: string, plugins: readonly PluginInfo[]): boolean {
  const url = webUrl(href);
  if (!url) return false;
  const key = browserPanelKey(plugins);
  // The panel must exist in the store, not merely in the plugin list: an id
  // opened before the registry sync lands becomes a tab that shows nothing
  // until reconcile — visibly broken, and slower than the system browser.
  if (!key || !usePanelStore.getState().panels.some((p) => p.id === key)) return false;
  // What a file preview does: reveal the column, then open the tab in it.
  useUIStore.setState({ rightPanelOpen: true });
  usePanelStore.getState().openPanel(key, { focus: true, params: { url } });
  return true;
}
