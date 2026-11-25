/**
 * Closing a browser tab must close the page it was showing.
 *
 * A browser panel tab hosts TWO native views: the plugin's own page and the
 * engine view it embeds. Closing the tab released the plugin page but only
 * *hid* the engine view — and hiding a WebContentsView does not stop the page.
 * A video kept playing after its tab (and the panel around it) was gone, with
 * no surface left anywhere to pause it.
 *
 * The engine page is what the reader calls "the tab", so it now goes with the
 * host tab — exactly what the plugin's own strip does with `tabs.close`, and
 * what `panel.closed` was supposed to arrange. A hide (column collapsed, panel
 * switched away from) must still leave the page alive.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PluginWebViews } from '../src/main/plugins/plugin-webview.ts';
import { LiveSlotRegistry } from '../src/main/plugins/slots.ts';

const PLUGIN = {
  id: 'com.pi.browser',
  enabled: true,
  state: 'installed',
  manifest: {
    permissions: ['browser'],
    contributes: {
      panels: [{ id: 'browser', entry: './ui/index.html', multiInstance: true }],
    },
  },
};

function makeBrowserManager() {
  const calls = { showTabTile: [], hideTab: [], closeTab: [] };
  return {
    calls,
    isConnected: () => true,
    connect: async () => {},
    showTabTile: (tag, bounds) => calls.showTabTile.push({ tag, bounds }),
    hideTab: (tag) => calls.hideTab.push(tag),
    closeTab: (tag) => calls.closeTab.push(tag),
    getTabView: () => null,
  };
}

function makeHarness() {
  const bm = makeBrowserManager();
  const liveSlots = new LiveSlotRegistry();
  const webViews = new PluginWebViews({
    registry: { get: (id) => (id === PLUGIN.id ? PLUGIN : undefined) },
    liveSlots,
    getWindow: () => null,
    browserManager: bm,
  });
  return { bm, liveSlots, webViews };
}

/**
 * Wire one host tab the way a mounted pane does: the panel slot with its view,
 * the tab key it reports under, and the engine slot embedded in its page.
 */
function hostTab(webViews, id) {
  const tabKey = `plugin:com.pi.browser:browser##${id}`;
  const panelSlotId = `com.pi.browser:browser:${id}`;
  const engineSlotId = `com.pi.browser:engine:page:${encodeURIComponent(tabKey)}`;
  webViews.views.set(panelSlotId, {
    setBounds() {},
    getBounds: () => ({ x: 0, y: 0, width: 700, height: 820 }),
  });
  webViews.attached.add(panelSlotId);
  webViews.tabByPanelSlot.set(panelSlotId, tabKey);
  webViews.panelSlotByTab.set(tabKey, panelSlotId);
  webViews.engineSlotsByTab.set(tabKey, new Set([engineSlotId]));
  webViews.registered.add(panelSlotId);
  webViews.registered.add(engineSlotId);
  return { tabKey, panelSlotId, engineSlotId };
}

/** Mount the engine slot and park it on engine tab `tag`, as the page does. */
async function showEngine(liveSlots, engineSlotId, tabKey, tag) {
  await liveSlots.attach(engineSlotId, { engine: true, tabKey });
  await liveSlots.setBounds(engineSlotId, { x: 0, y: 40, width: 700, height: 700 }, tag, {
    engine: true,
    tabKey,
  });
}

test('closing the host tab closes the engine page it was showing', async () => {
  const { bm, liveSlots, webViews } = makeHarness();
  const tab = hostTab(webViews, 't1');
  await showEngine(liveSlots, tab.engineSlotId, tab.tabKey, 'w1:t3');
  assert.deepEqual(
    bm.calls.showTabTile.map((c) => c.tag),
    ['w1:t3'],
    'the engine view should be positioned inside the panel',
  );

  webViews.destroySlot(tab.panelSlotId);

  assert.deepEqual(bm.calls.closeTab, ['w1:t3'], 'the closed tab takes its page with it');
});

test('hiding the panel leaves the engine page alive', async () => {
  const { bm, liveSlots, webViews } = makeHarness();
  const tab = hostTab(webViews, 't1');
  await showEngine(liveSlots, tab.engineSlotId, tab.tabKey, 'w1:t3');

  // What the column collapsing reports: hide, not release.
  liveSlots.detach(tab.engineSlotId);

  assert.deepEqual(bm.calls.closeTab, [], 'a hidden page is still a page the user can come back to');
});

test('a split showing the same page keeps it open until its last pane closes', async () => {
  const { bm, liveSlots, webViews } = makeHarness();
  const first = hostTab(webViews, 't1');
  const second = hostTab(webViews, 't2');
  await showEngine(liveSlots, first.engineSlotId, first.tabKey, 'w1:t3');
  await showEngine(liveSlots, second.engineSlotId, second.tabKey, 'w1:t3');

  webViews.destroySlot(first.panelSlotId);
  assert.deepEqual(bm.calls.closeTab, [], 'the other pane is still showing this page');

  webViews.destroySlot(second.panelSlotId);
  assert.deepEqual(bm.calls.closeTab, ['w1:t3'], 'the last pane to go takes the page with it');
});
