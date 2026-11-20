/**
 * `_state.json`: the plugin preferences that survive a restart.
 *
 * Two rules matter and neither is visible on screen:
 *   - a preference belongs to the copy it was set on, so uninstalling drops it
 *     (a reinstall must not arrive disabled);
 *   - the file also carries the registry override, which uninstall must not
 *     take with it.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PluginRegistry } from '../src/main/plugins/registry.ts';

function withRegistry(files, fn) {
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-registry-'));
  const pluginsRoot = join(agentDir, 'plugins');
  try {
    mkdirSync(pluginsRoot, { recursive: true });
    for (const [path, body] of Object.entries(files)) {
      const target = join(pluginsRoot, path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    }
    const registry = new PluginRegistry({ agentDir, appVersion: '1.0.0' });
    registry.scan();
    return fn(registry, pluginsRoot);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
}

const DEMO = { id: 'com.test.demo', name: 'Demo', version: '1.0.0' };

test('uninstall forgets the preference, not the registry override', () => {
  withRegistry(
    {
      'com.test.demo/manifest.json': DEMO,
      '_state.json': {
        registry: 'https://example.test/index.json',
        plugins: { 'com.test.demo': { enabled: false }, 'com.other.plugin': { enabled: false } },
      },
    },
    (registry, pluginsRoot) => {
      assert.equal(registry.get('com.test.demo').enabled, false);

      registry.forgetPlugin('com.test.demo');

      const saved = JSON.parse(readFileSync(join(pluginsRoot, '_state.json'), 'utf8'));
      assert.equal(saved.plugins['com.test.demo'], undefined);
      // Someone else's preference is theirs to keep.
      assert.deepEqual(saved.plugins['com.other.plugin'], { enabled: false });
      assert.equal(saved.registry, 'https://example.test/index.json');
    },
  );
});

test('forgetting the last preference leaves a clean file', () => {
  withRegistry(
    {
      'com.test.demo/manifest.json': DEMO,
      '_state.json': { plugins: { 'com.test.demo': { enabled: false } } },
    },
    (registry, pluginsRoot) => {
      registry.forgetPlugin('com.test.demo');
      const saved = JSON.parse(readFileSync(join(pluginsRoot, '_state.json'), 'utf8'));
      assert.deepEqual(saved, {});
    },
  );
});

test('forgetting a plugin nobody saved writes nothing', () => {
  withRegistry({ 'com.test.demo/manifest.json': DEMO, '_state.json': { plugins: {} } }, (registry, pluginsRoot) => {
    const before = readFileSync(join(pluginsRoot, '_state.json'), 'utf8');
    registry.forgetPlugin('com.pi.unknown');
    assert.equal(readFileSync(join(pluginsRoot, '_state.json'), 'utf8'), before);
  });
});
