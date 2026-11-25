/**
 * Google's sign-in refuses an anonymous Chrome: an embedded browser that
 * presents Chrome's UA while nothing identifies the application is exactly
 * what "此浏览器或应用可能不安全" (`accounts.google.com/v3/signin/rejected`)
 * is for. The engine now presents Electron's own UA on Google's sign-in hosts
 * and Chrome's everywhere else (apps/desktop/src/main/browser/browser-user-agent.ts).
 *
 * These tests pin the pure decisions behind that switch: which URLs get which
 * UA, how a main-frame request's header is corrected, and when a redirect is
 * started over at its target so the landing page has the right UA from its
 * first request.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ENGINE_UA,
  MAX_SIGN_IN_RESTARTS,
  PLATFORM_TOKEN,
  buildElectronUserAgent,
  isGoogleSignInUrl,
  navigationRequestHeaders,
  restartsAtRedirect,
  userAgentForPage,
} from '../src/main/browser/browser-user-agent.ts';

const AGENTS = {
  chrome: ENGINE_UA,
  electron: buildElectronUserAgent({
    appName: 'PiWork',
    appVersion: '0.4.7',
    platformToken: PLATFORM_TOKEN,
    chromeVersion: '156.0.8078.100',
    electronVersion: '45.4.1',
  }),
};

test('Google sign-in hosts are exactly its account pages', () => {
  assert.equal(isGoogleSignInUrl('https://accounts.google.com/v3/signin/rejected?x=1'), true);
  assert.equal(isGoogleSignInUrl('https://accounts.youtube.com/accounts/SetSID'), true);
  assert.equal(isGoogleSignInUrl('http://accounts.google.com/'), true);

  assert.equal(isGoogleSignInUrl('https://google.com/'), false);
  assert.equal(isGoogleSignInUrl('https://mail.google.com/'), false);
  assert.equal(isGoogleSignInUrl('https://accounts.google.com.evil.test/'), false);
  assert.equal(isGoogleSignInUrl('https://notaccounts.google.com/'), false);
  assert.equal(isGoogleSignInUrl('https://evil.test/?u=https://accounts.google.com/'), false);
  assert.equal(isGoogleSignInUrl('pi-plugin://accounts.google.com/'), false);
  assert.equal(isGoogleSignInUrl('not a url'), false);
});

test('Google sign-in pages see Electron; every other page keeps Chrome', () => {
  assert.equal(userAgentForPage('https://accounts.google.com/o/oauth2/v2/auth', AGENTS), AGENTS.electron);
  assert.equal(userAgentForPage('https://chatgpt.com/auth/login', AGENTS), AGENTS.chrome);
  assert.equal(userAgentForPage('https://auth.openai.com/api/accounts/callback/google', AGENTS), AGENTS.chrome);
});

test("the two UAs stay in Electron's own shape", () => {
  assert.match(
    AGENTS.electron,
    /^Mozilla\/5\.0 \(.+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) PiWork\/0\.4\.7 Chrome\/156\.0\.8078\.100 Electron\/45\.4\.1 Safari\/537\.36$/,
  );
  assert.match(AGENTS.chrome, /Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
  // The Chrome UA must not identify the app or the framework…
  assert.equal(/Electron|PiWork/.test(AGENTS.chrome), false);
  // …and the Electron one must say both, which is what Google accepts.
  assert.match(AGENTS.electron, /PiWork\/0\.4\.7/);
  assert.match(AGENTS.electron, /Electron\/45\.4\.1/);
});

test('a main-frame request into Google is corrected to Electron', () => {
  const headers = {
    'User-Agent': AGENTS.chrome,
    Accept: 'text/html',
    'Sec-CH-UA': '"Not:A-Brand";v="8", "Chromium";v="156"',
  };
  const revised = navigationRequestHeaders(headers, 'https://accounts.google.com/v3/signin', AGENTS);
  assert.deepEqual(revised, { ...headers, 'User-Agent': AGENTS.electron });
  // Client hints are never touched: they are Chromium's own and agree with both.
  assert.equal(revised['Sec-CH-UA'], headers['Sec-CH-UA']);
});

test('a main-frame request leaving Google is corrected back to Chrome', () => {
  const headers = { 'user-agent': AGENTS.electron, Accept: 'text/html' };
  const revised = navigationRequestHeaders(headers, 'https://auth.openai.com/api/accounts/callback/google', AGENTS);
  assert.deepEqual(revised, { 'user-agent': AGENTS.chrome, Accept: 'text/html' });
  // The header name's casing is the page's own — the value is all that changes.
  assert.equal(Object.keys(revised).includes('user-agent'), true);
});

test('a header that already matches, a foreign UA, or no UA is left alone', () => {
  assert.equal(
    navigationRequestHeaders({ 'User-Agent': AGENTS.electron }, 'https://accounts.google.com/', AGENTS),
    null,
  );
  assert.equal(navigationRequestHeaders({ 'User-Agent': AGENTS.chrome }, 'https://example.com/', AGENTS), null);
  // A CDP override is not one of ours: it is not second-guessed.
  assert.equal(
    navigationRequestHeaders({ 'User-Agent': 'Mozilla/5.0 (custom)' }, 'https://accounts.google.com/', AGENTS),
    null,
  );
  assert.equal(navigationRequestHeaders({ Accept: 'text/html' }, 'https://accounts.google.com/', AGENTS), null);
});

test('a redirect across the sign-in boundary restarts; one within it does not', () => {
  const intoGoogle = {
    url: 'https://accounts.google.com/o/oauth2/v2/auth',
    isMainFrame: true,
    isSameDocument: false,
    presentedUa: AGENTS.chrome,
    restarts: 0,
  };
  assert.equal(restartsAtRedirect(intoGoogle, AGENTS), true);

  const backToSite = { ...intoGoogle, url: 'https://auth.openai.com/api/accounts/callback/google', presentedUa: AGENTS.electron };
  assert.equal(restartsAtRedirect(backToSite, AGENTS), true);

  // Already on Google, redirecting to another Google page: no restart.
  assert.equal(restartsAtRedirect({ ...intoGoogle, presentedUa: AGENTS.electron }, AGENTS), false);
  // Sub-frames and same-document navigations never take over the tab.
  assert.equal(restartsAtRedirect({ ...intoGoogle, isMainFrame: false }, AGENTS), false);
  assert.equal(restartsAtRedirect({ ...intoGoogle, isSameDocument: true }, AGENTS), false);
  // Non-web targets are Chromium's to refuse, as before.
  assert.equal(restartsAtRedirect({ ...intoGoogle, url: 'pi-plugin://com.pi.browser/ui/index.html' }, AGENTS), false);
});

test('the restart budget is finite', () => {
  const redirect = {
    url: 'https://accounts.google.com/o/oauth2/v2/auth',
    isMainFrame: true,
    isSameDocument: false,
    presentedUa: AGENTS.chrome,
    restarts: 0,
  };
  assert.equal(restartsAtRedirect({ ...redirect, restarts: MAX_SIGN_IN_RESTARTS - 1 }, AGENTS), true);
  assert.equal(restartsAtRedirect({ ...redirect, restarts: MAX_SIGN_IN_RESTARTS }, AGENTS), false);
});
