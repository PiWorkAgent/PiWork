/**
 * Chat links open in the app's own browser.
 *
 * The shell window is not a browser — a Markdown link is `target=_blank` and
 * the main process sends every such request to `shell.openExternal`. That is
 * the right FALLBACK (an install without the browser plugin has nowhere
 * else), but with the plugin installed a click should land in the right
 * column, as a new tab, with the column revealed — not in Safari.
 *
 * Modified clicks and non-web schemes keep the system browser: the caller
 * only prevents the default when this returns true.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { usePanelStore } from '../../../packages/ui/src/stores/panel-store.ts';
import { useUIStore } from '../../../packages/ui/src/stores/ui-store.ts';
import {
  browserPanelKey,
  isPlainClick,
  openLinkInBrowserPanel,
  webUrl,
} from '../../../packages/ui/src/lib/open-link.ts';

function plugin({ id = 'com.test.browser', permissions = ['browser'], region } = {}) {
  return {
    id,
    name: id,
    version: '1.0.0',
    source: 'user',
    state: 'active',
    permissions,
    panels: [
      {
        id: 'browser',
        title: '浏览器',
        entry: './ui/index.html',
        multiInstance: true,
        keepAlive: 'lru',
        scope: 'session',
        ...(region ? { region } : {}),
      },
    ],
    commands: [],
    tools: [],
    messageRenderers: [],
    contextProviders: [],
    settings: [],
  };
}

function reset(plugins = [plugin()]) {
  usePanelStore.setState({
    panels: [],
    focusedId: { left: null, right: null },
    openPanelIds: { left: [], right: [] },
    panelOrder: { left: [], right: [] },
    splitGroups: { left: [], right: [] },
    currentSessionId: null,
    sessionPanels: {},
    sessionOrder: [],
    mountedIds: [],
    recency: [],
    runtime: {},
    params: {},
    tabTitles: {},
    activationNonces: {},
    pluginPanelsSynced: false,
  });
  usePanelStore.getState().setPluginPanels(plugins);
  useUIStore.setState({ rightPanelOpen: false });
  return plugins;
}

test('a plain click opens the link as a new tab and reveals the column', () => {
  const plugins = reset();

  assert.equal(openLinkInBrowserPanel('https://github.com/trending', plugins), true);

  const s = usePanelStore.getState();
  const key = s.openPanelIds.right[0];
  assert.equal(s.openPanelIds.right.length, 1, 'one tab');
  assert.ok(key.startsWith('plugin:com.test.browser:browser'), `tab key: ${key}`);
  assert.deepEqual(s.params[key], { url: 'https://github.com/trending' });
  assert.equal(s.focusedId.right, key, 'the new tab is the one on screen');
  assert.equal(useUIStore.getState().rightPanelOpen, true, 'the column comes into view');
});

test('identical open params land in one tab, not two', () => {
  const plugins = reset();

  // Once the panel mounts it rewrites the tab's params to the engine tab it
  // got, so this host-level dedupe covers the moment before that happens — a
  // later click on the same URL opens a new tab, as it would in a browser.
  openLinkInBrowserPanel('https://github.com/trending', plugins);
  openLinkInBrowserPanel('https://github.com/trending', plugins);

  assert.equal(usePanelStore.getState().openPanelIds.right.length, 1);
});

test('only a plain click is taken; modified clicks keep the system browser', () => {
  const plain = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  assert.equal(isPlainClick(plain), true);
  assert.equal(isPlainClick({ ...plain, metaKey: true }), false);
  assert.equal(isPlainClick({ ...plain, ctrlKey: true }), false);
  assert.equal(isPlainClick({ ...plain, shiftKey: true }), false);
  assert.equal(isPlainClick({ ...plain, altKey: true }), false);
  assert.equal(isPlainClick({ ...plain, button: 1 }), false, 'middle click');
  assert.equal(isPlainClick({ ...plain, defaultPrevented: true }), false);
});

test('a second, different link gets its own tab', () => {
  const plugins = reset();

  openLinkInBrowserPanel('https://github.com/trending', plugins);
  openLinkInBrowserPanel('https://example.com/a', plugins);

  assert.equal(usePanelStore.getState().openPanelIds.right.length, 2);
});

test('no browser plugin means the system browser keeps it', () => {
  const plugins = reset([plugin({ id: 'com.test.other', permissions: ['storage'] })]);

  assert.equal(browserPanelKey(plugins), null);
  assert.equal(openLinkInBrowserPanel('https://github.com/trending', plugins), false);
  assert.equal(usePanelStore.getState().openPanelIds.right.length, 0);
  assert.equal(useUIStore.getState().rightPanelOpen, false, 'nothing to reveal');
});

test('the URL handler is a right-column panel, not any panel', () => {
  const plugins = reset([plugin({ region: 'left' })]);

  assert.equal(browserPanelKey(plugins), null);
  assert.equal(openLinkInBrowserPanel('https://example.com', plugins), false);
});

test('only web URLs are taken; mailto and friends stay with the OS', () => {
  const plugins = reset();

  assert.equal(webUrl('mailto:someone@example.com'), null);
  assert.equal(webUrl('file:///tmp/x.html'), null);
  assert.equal(webUrl('not a url'), null);
  assert.equal(openLinkInBrowserPanel('mailto:someone@example.com', plugins), false);
  assert.equal(openLinkInBrowserPanel('file:///tmp/x.html', plugins), false);
  assert.equal(usePanelStore.getState().openPanelIds.right.length, 0);

  // http and https both qualify.
  assert.equal(openLinkInBrowserPanel('http://example.com', plugins), true);
  assert.equal(openLinkInBrowserPanel('https://example.com', plugins), true);
});
