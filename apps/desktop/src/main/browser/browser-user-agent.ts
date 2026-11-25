/**
 * The user agents the engine presents, and where.
 *
 * Two jobs pull opposite ways:
 *
 *  - Ordinary sites must see a plain Chrome UA. zhipin.com and similar CDNs
 *    drop Electron's default, and Cloudflare's challenge widget — which reads
 *    the app-wide fallback from its cross-site iframe — treats a UA that
 *    contradicts the client hints as automation.
 *  - Google's sign-in must NOT see a plain Chrome UA. It refuses a browser
 *    that claims to be Chrome while nothing else identifies the application
 *    ("此浏览器或应用可能不安全", `accounts.google.com/v3/signin/rejected`): an
 *    anonymous Chrome is exactly what an embedded app that hides who it is
 *    looks like. It accepts Electron's own UA, which names the app and the
 *    framework. (Same finding, same fix: penguin-harness #1505, 2026-11.)
 *
 * So the UA follows the tab's main frame: Google's sign-in hosts get Electron's
 * own UA, every other page keeps Chrome's. Client hints (`Sec-CH-UA*`,
 * `navigator.userAgentData`) stay Chromium's own on every page — they agree
 * with both strings, and rewriting them would only create a new mismatch.
 */

/** Chromium version of this build — a UA must not disagree with the client hints. */
const CHROME_MAJOR = (process.versions.chrome || '130.0.0.0').split('.')[0];

// The platform token must match where the app actually runs: a Macintosh UA on
// Windows/Linux contradicts Sec-CH-UA-Platform (which Chromium keeps truthful)
// and makes download pages offer the macOS build. Only the `Electron` token is
// hidden from ordinary sites, not the OS.
export const PLATFORM_TOKEN =
  process.platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64';

/** What ordinary sites see: plain Chrome, no application or Electron token. */
export const ENGINE_UA =
  `Mozilla/5.0 (${PLATFORM_TOKEN}) ` +
  `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

/** The two user agents a tab presents (userAgentForPage). */
export interface EngineUserAgents {
  /** What every page but Google's sign-in sees. */
  chrome: string;
  /** Electron's own, unmodified: what Google's sign-in sees. */
  electron: string;
}

/**
 * Electron's own UA, rebuilt in Electron's own format — the framework writes
 * the default as `<app>/<version> Chrome/<chromium> Electron/<electron>`, but
 * main sets `app.userAgentFallback` to the Chrome spoof before any window
 * exists, so the original cannot be read back.
 */
export function buildElectronUserAgent(parts: {
  appName: string;
  appVersion: string;
  platformToken: string;
  chromeVersion: string;
  electronVersion: string;
}): string {
  return (
    `Mozilla/5.0 (${parts.platformToken}) ` +
    `AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `${parts.appName}/${parts.appVersion} ` +
    `Chrome/${parts.chromeVersion} Electron/${parts.electronVersion} Safari/537.36`
  );
}

/**
 * Google's sign-in: its account pages, and the hop a finished sign-in sets
 * YouTube's cookies through on its way back.
 */
const GOOGLE_SIGN_IN_HOSTS: ReadonlySet<string> = new Set([
  'accounts.google.com',
  'accounts.youtube.com',
]);

/** Whether `url` is a page of Google's sign-in. */
export function isGoogleSignInUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === 'https:' || protocol === 'http:') && GOOGLE_SIGN_IN_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * The UA a tab presents while its main frame is at `url`, in its requests and
 * in its pages' `navigator.userAgent` alike.
 */
export function userAgentForPage(url: string, agents: EngineUserAgents): string {
  return isGoogleSignInUrl(url) ? agents.electron : agents.chrome;
}

/**
 * The headers a main-frame request goes out with.
 *
 * Chromium writes a navigation's User-Agent as it creates the navigation,
 * before `did-start-navigation` — where the tab takes the UA of the page it is
 * going to. The request in flight therefore still names the UA of the page
 * being left; this replaces it with the UA that page will present. A UA that
 * is neither of the engine's (an override set over CDP) and every other
 * header, client hints included, go as they are. Null when nothing changes.
 */
export function navigationRequestHeaders(
  headers: Readonly<Record<string, string>>,
  url: string,
  agents: EngineUserAgents,
): Record<string, string> | null {
  const name = Object.keys(headers).find((key) => key.toLowerCase() === 'user-agent');
  if (name === undefined) return null;
  const sent = headers[name];
  if (sent !== agents.chrome && sent !== agents.electron) return null;
  const wanted = userAgentForPage(url, agents);
  if (sent === wanted) return null;
  return { ...headers, [name]: wanted };
}

/**
 * How many times in a row a tab's navigation may start over at a redirect
 * before redirects are followed as they come. A chain that bounces across the
 * sign-in boundary forever would otherwise bounce forever, where Chromium's
 * own redirect limit would have ended it.
 */
export const MAX_SIGN_IN_RESTARTS = 4;

/**
 * Whether a redirect starts its navigation over at the redirect's target.
 *
 * A page's `navigator.userAgent` can only change as its navigation starts;
 * changed later, Chromium would reload the page the tab is leaving. So a
 * main-frame redirect into or out of Google's sign-in would land with the UA
 * of the address the navigation started at — Chrome's on the sign-in (which
 * refuses it), or Electron's on the site after it. Starting over at the
 * target gives the navigation the right one from its first request.
 */
export function restartsAtRedirect(
  redirect: {
    url: string;
    isMainFrame: boolean;
    isSameDocument: boolean;
    presentedUa: string;
    restarts: number;
  },
  agents: EngineUserAgents,
): boolean {
  if (!redirect.isMainFrame || redirect.isSameDocument) return false;
  if (redirect.restarts >= MAX_SIGN_IN_RESTARTS) return false;
  if (!/^https?:/i.test(redirect.url)) return false;
  return userAgentForPage(redirect.url, agents) !== redirect.presentedUa;
}
