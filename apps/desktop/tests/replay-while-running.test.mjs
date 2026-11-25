/**
 * Retrying a failed turn while its run is still alive.
 *
 * The agent reports each failed attempt as it happens and then retries it on
 * its own, so the error card can be on screen while the session still counts
 * as busy. pi's tree navigation refuses to run then, with a message about its
 * own internal state ("Wait for the current response to finish before
 * navigating the session tree.") — which is what a reader saw after clicking
 * 重试 on a turn they had just fixed the model for. A replay now waits for the
 * attempt to settle, and says something actionable if it never does.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitUntilReplayable } from '../../../packages/sdk-wrapper/src/adapters/chat.ts';

/** A session stub whose run settles when `settle()` is called. */
function session({ streaming }) {
  let idleResolve;
  const idle = new Promise((resolve) => {
    idleResolve = resolve;
  });
  const fake = {
    isStreaming: streaming,
    waitForIdle: () => idle,
    settle() {
      fake.isStreaming = false;
      idleResolve();
    },
  };
  return fake;
}

test('an idle session is not waited on at all', async () => {
  const fake = session({ streaming: false });
  fake.waitForIdle = () => {
    throw new Error('must not wait');
  };
  await waitUntilReplayable(fake);
});

test('a replay waits for the attempt still retrying behind the error card', async () => {
  const fake = session({ streaming: true });
  const replay = waitUntilReplayable(fake, 5_000);
  setTimeout(() => fake.settle(), 20);
  await replay;
  assert.equal(fake.isStreaming, false);
});

test('a run that never settles gets a sentence, not a state name', async () => {
  const fake = session({ streaming: true });
  await assert.rejects(waitUntilReplayable(fake, 30), /上一轮还在进行中/);
});
