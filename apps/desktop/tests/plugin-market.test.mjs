/**
 * Plugin market: where the catalog comes from and when an installed plugin
 * counts as updatable.
 *
 * The install path itself (download → sha256 → extract → validate → atomic
 * replace) is exercised through the plugin center and the registry tooling;
 * what is tested here is the part that is silently wrong: resolving a
 * release's relative asset names, and comparing versions when a catalog can
 * be older than the installed copy.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparePluginVersions } from '@pi/types';
import {
  DEFAULT_REGISTRY_URL,
  isRetryableNetworkError,
  resolveEntryUrl,
  undeclaredPermissions,
} from '../src/main/plugins/marketplace.ts';
import { shouldAutoRollback } from '../src/main/plugins/install-policy.ts';

test('the default registry is the latest release index of the plugins repo', () => {
  assert.match(DEFAULT_REGISTRY_URL, /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/latest\/download\/index\.json$/);
});

test('relative catalog entries resolve beside the index they came from', () => {
  const index = 'https://github.com/owner/plugins/releases/latest/download/index.json';
  assert.equal(
    resolveEntryUrl(index, 'com.pi.files-0.6.0.zip'),
    'https://github.com/owner/plugins/releases/latest/download/com.pi.files-0.6.0.zip',
  );
  assert.equal(
    resolveEntryUrl(index, './com.pi.files-0.6.0.zip'),
    'https://github.com/owner/plugins/releases/latest/download/com.pi.files-0.6.0.zip',
  );
});

test('absolute URLs and paths pass through untouched', () => {
  const index = '/home/me/market/index.json';
  assert.equal(resolveEntryUrl(index, '/opt/zips/a.zip'), '/opt/zips/a.zip');
  assert.equal(
    resolveEntryUrl(index, 'https://cdn.example.com/a.zip'),
    'https://cdn.example.com/a.zip',
  );
  assert.equal(resolveEntryUrl(index, 'a.zip'), '/home/me/market/a.zip');
});

test('versions order like semver, not like strings', () => {
  assert.equal(comparePluginVersions('0.10.0', '0.9.0'), 1);
  assert.equal(comparePluginVersions('0.9.0', '0.10.0'), -1);
  assert.equal(comparePluginVersions('1.0.0', '1.0.0'), 0);
  // Stamped dev builds sort below the release they are built from.
  assert.equal(comparePluginVersions('0.9.31-dev.20261119', '0.9.31'), -1);
  // Unparseable versions never read as an update.
  assert.equal(comparePluginVersions('nightly', '0.9.0'), 0);
});

test('a package may not declare permissions the catalog left out', () => {
  // The normal case: entry generated from the same manifest.
  assert.deepEqual(undeclaredPermissions(['network', 'storage'], ['network', 'storage']), []);
  // Under-reported catalog: the package asks for more than the user saw.
  assert.deepEqual(undeclaredPermissions(['network'], ['network', 'filesystem']), ['filesystem']);
  // No catalog permissions at all is the worst case, not a free pass.
  assert.deepEqual(undeclaredPermissions(undefined, ['network', 'filesystem']), [
    'filesystem',
    'network',
  ]);
  // Over-reporting in the catalog is harmless: the user consents to more.
  assert.deepEqual(undeclaredPermissions(['network', 'storage'], ['network']), []);
  // Scoped and unscoped grants are different permissions.
  assert.deepEqual(undeclaredPermissions(['network'], ['network:api.example.com']), [
    'network:api.example.com',
  ]);
  // Duplicates in a hand-written manifest collapse.
  assert.deepEqual(undeclaredPermissions([], ['network', 'network']), ['network']);
});

test('only a dead connection is worth downloading twice', () => {
  // A stuck edge (accepted the socket, sent nothing) and transport failures
  // are retried on a fresh connection.
  assert.equal(isRetryableNetworkError(new Error('net::ERR_CONNECTION_RESET')), true);
  assert.equal(
    isRetryableNetworkError(new Error('download stalled: https://x/y.zip sent no data for 30s')),
    true,
  );
  // The server answered — repeating the request only repeats the wait.
  assert.equal(isRetryableNetworkError(new Error('fetch https://x/y.zip failed: HTTP 404')), false);
  assert.equal(isRetryableNetworkError(new Error('integrity check failed for a (sha256 mismatch)')), false);
  assert.equal(isRetryableNetworkError('not an error'), false);
});

test('a failed update rolls back only when there is a working copy to return to', () => {
  const base = {
    previousVersion: '1.0.0',
    attemptedVersion: '2.0.0',
    state: 'error',
    hasPreviousCopy: true,
  };
  // The case this exists for: an update that installs but cannot start.
  assert.equal(shouldAutoRollback(base), true);
  assert.equal(shouldAutoRollback({ ...base, state: 'crashed' }), true);
  // It started — later crashes are the crash-restart path, not a bad package.
  assert.equal(shouldAutoRollback({ ...base, state: 'active' }), false);
  // First install: nothing to go back to.
  assert.equal(shouldAutoRollback({ ...base, previousVersion: null }), false);
  // Same-version reinstall: restoring an unrelated older copy would be wrong.
  assert.equal(shouldAutoRollback({ ...base, attemptedVersion: '1.0.0' }), false);
  // The outgoing copy is gone (or was never kept) — do not promise a rollback.
  assert.equal(shouldAutoRollback({ ...base, hasPreviousCopy: false }), false);
});
