import { useQuery } from '@tanstack/react-query';
import type { AuthLoginEvent, ProviderAuthRow } from '@pi/types';
import { useSDK } from '@/hooks/use-sdk';
import { electronApi, type ElectronBridge } from '@/lib/electron-ipc';
import { hasDesktopWindowApi } from '@/lib/window-identity';

/**
 * Renderer-side access to the desktop auth bridge.
 *
 * The request/response half (`sdk.auth.*`) rides the normal SDK transport; the
 * live half — prompts, auth URLs, device codes — arrives on `pi:auth:event`
 * pushed by main to the window that started the login.
 */

interface AuthBridgeExtras {
  shell?: { openExternal?: (url: string) => Promise<unknown> };
  clipboard?: { write?: (text: string) => Promise<unknown> };
  removeListener?: (channel: string, callback: (...args: unknown[]) => void) => void;
}

function authBridge(): (ElectronBridge & AuthBridgeExtras) | undefined {
  return electronApi() as (ElectronBridge & AuthBridgeExtras) | undefined;
}

/**
 * Whether provider sign-in exists in this build. The web build has no event
 * channel back into the page, so the built-in section is hidden there instead
 * of offering buttons that cannot finish.
 */
export function hasAuthApi(): boolean {
  return hasDesktopWindowApi() && !!electronApi()?.on;
}

export const AUTH_PROVIDERS_QUERY_KEY = ['authProviders'] as const;

export function useAuthProvidersQuery() {
  const sdk = useSDK();
  return useQuery<ProviderAuthRow[]>({
    queryKey: AUTH_PROVIDERS_QUERY_KEY,
    queryFn: () => sdk.auth.listProviders(),
    enabled: hasAuthApi(),
    // Status depends on live credentials; a stale list is worse than a reload.
    staleTime: 10_000,
  });
}

/** Subscribe to login events; returns an unsubscribe. No-op in the web build. */
export function subscribeAuthEvents(handler: (event: AuthLoginEvent) => void): () => void {
  const api = authBridge();
  if (!api?.on) return () => {};
  const listener = (...args: unknown[]) => {
    const event = args[0] as AuthLoginEvent | undefined;
    if (event && typeof event === 'object' && typeof event.type === 'string') handler(event);
  };
  api.on('pi:auth:event', listener);
  return () => api.removeListener?.('pi:auth:event', listener);
}

/**
 * Open an authorization URL in the system browser. The SDK runs the OAuth
 * callback server in-process; only the browser hop is ours to make.
 */
export function openAuthUrl(url: string): void {
  if (!/^https:\/\//i.test(url)) return;
  void authBridge()?.shell?.openExternal?.(url).catch(() => {});
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Clipboard permission denied (or no secure context): use the host bridge.
  }
  await authBridge()?.clipboard?.write?.(text);
}
