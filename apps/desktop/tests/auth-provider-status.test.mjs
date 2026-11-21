/**
 * Provider status derivation.
 *
 * The SDK's `getProviderAuthStatus()` reads a cached snapshot, which goes
 * stale after a cancelled login or a logout whose sync failed. The badge must
 * follow the live credential store instead — the regression this file exists
 * for is a provider still showing 已连接 after its credential was deleted.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveProviderStatus } from '@pi/sdk-wrapper/adapters';

const none = { configured: false };

test('a stored OAuth credential is connected', () => {
  const status = deriveProviderStatus({
    storedType: 'oauth',
    live: { type: 'oauth', source: 'OAuth' },
    snapshot: { configured: true, source: 'stored' },
  });
  assert.equal(status.health, 'connected');
  assert.equal(status.storedType, 'oauth');
  assert.equal(status.source, 'stored');
  assert.equal(status.sourceLabel, 'OAuth');
});

test('a stored API key is connected', () => {
  const status = deriveProviderStatus({
    storedType: 'api_key',
    live: { type: 'api_key', source: 'configured API key' },
    snapshot: { configured: true, source: 'stored' },
  });
  assert.equal(status.health, 'connected');
  assert.equal(status.storedType, 'api_key');
});

test('environment credentials without a stored entry are ambient', () => {
  const status = deriveProviderStatus({
    live: { type: 'api_key', source: 'ANTHROPIC_API_KEY' },
    snapshot: { configured: true, source: 'environment', label: 'ANTHROPIC_API_KEY' },
  });
  assert.equal(status.health, 'ambient');
  assert.equal(status.source, 'environment');
  assert.equal(status.sourceLabel, 'ANTHROPIC_API_KEY');
});

test('models.json keys are ambient', () => {
  const status = deriveProviderStatus({
    live: { type: 'api_key', source: 'configured API key' },
    snapshot: { configured: true, source: 'models_json_key' },
  });
  assert.equal(status.health, 'ambient');
  assert.equal(status.source, 'models_json_key');
});

test('a stale stored snapshot without a credential is NOT connected', () => {
  const status = deriveProviderStatus({
    live: null,
    snapshot: { configured: true, source: 'stored' },
  });
  assert.equal(status.health, 'none');
});

test('nothing configured is none', () => {
  assert.equal(deriveProviderStatus({ live: null, snapshot: none }).health, 'none');
});
