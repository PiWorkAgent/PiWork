/**
 * `panel.mounted` arrives BEFORE the native view it belongs to.
 *
 * The shell's LiveSlot raises the mount report and attaches the slot in two
 * effects, in that order, so on a brand-new tab main is asked to route the
 * report while `ensureView` has not run yet. Dropping it there left a freshly
 * opened panel blank — a packaged build runs effects once, so nothing
 * re-reported; dev's StrictMode masked it by mounting every effect twice.
 * The report must be kept so `did-finish-load` can replay it to the page that
 * is created a moment later.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PluginWebViews } from '../src/main/plugins/plugin-webview.ts';

function makeWebViews() {
  return new PluginWebViews({
    registry: { get: () => undefined },
    liveSlots: { setFactory() {}, unregister() {}, detach() {} },
    getWindow: () => null,
  });
}

function fakeView() {
  const sent = [];
  return {
    sent,
    view: {
      webContents: {
        isDestroyed: () => false,
        send: (channel, payload) => sent.push({ channel, payload }),
      },
    },
  };
}

test('keeps the report when the view has not been created yet', () => {
  const webViews = makeWebViews();
  const slotId = 'com.pi.files:viewer:tab-1';
  const params = { file: '/work/a.xlsx' };

  const res = webViews.handlePanelMounted({
    slotId,
    panelId: 'viewer',
    tabId: 'tab-1',
    params,
    workspaceId: '/work',
  });

  assert.equal(res.ok, true);
  // The stored report is exactly what did-finish-load replays; losing it here
  // is the bug this test exists for.
  const kept = webViews.mounted.get(slotId);
  assert.ok(kept, 'mount report was dropped because the view did not exist');
  assert.deepEqual(kept.params, params);
  assert.equal(kept.workspaceId, '/work');
});

test('delivers immediately once the view exists', () => {
  const webViews = makeWebViews();
  const slotId = 'com.pi.files:viewer:tab-2';
  const { sent, view } = fakeView();
  webViews.views.set(slotId, view);

  webViews.handlePanelMounted({ slotId, panelId: 'viewer', tabId: 'tab-2', params: { file: '/work/b.pdf' } });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'pi:plugin:panel-mounted');
  assert.deepEqual(sent[0].payload.params, { file: '/work/b.pdf' });
});
