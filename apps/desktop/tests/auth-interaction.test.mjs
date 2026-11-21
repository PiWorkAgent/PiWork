/**
 * `AuthInteractionBridge` — the seam between an SDK login flow and the
 * renderer's dialog.
 *
 * Every prompt the SDK asks parks a promise in the bridge; the UI answers (or
 * cancels) it. Two races matter and are covered here:
 *
 *  - the OAuth callback can resolve the login while a manual-code prompt is
 *    still open, and the SDK aborts that prompt through its own signal;
 *  - the user can close the dialog at any point, after which no prompt promise
 *    may be left dangling.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthInteractionBridge } from '@pi/sdk-wrapper/adapters';

function makeBridge() {
  const events = [];
  const bridge = new AuthInteractionBridge('login-abcdef12', 'anthropic', (event) =>
    events.push(event),
  );
  return { bridge, events };
}

function isAbort(error) {
  return error && error.name === 'AbortError';
}

test('emits the prompt and resolves it with the renderer answer', async () => {
  const { bridge, events } = makeBridge();
  const answer = bridge.prompt({ type: 'secret', message: 'Enter Anthropic API key' });

  assert.equal(events.length, 1);
  const [promptEvent] = events;
  assert.equal(promptEvent.type, 'prompt');
  assert.equal(promptEvent.loginId, 'login-abcdef12');
  assert.equal(promptEvent.providerId, 'anthropic');
  assert.deepEqual(promptEvent.prompt, {
    type: 'secret',
    message: 'Enter Anthropic API key',
    placeholder: undefined,
  });

  assert.equal(bridge.respond(promptEvent.requestId, 'sk-test'), true);
  assert.equal(await answer, 'sk-test');

  const closed = events.at(-1);
  assert.equal(closed.type, 'prompt_closed');
  assert.equal(closed.requestId, promptEvent.requestId);
  assert.equal(closed.reason, 'answered');
});

test('rejects select answers that are not one of the offered ids', async () => {
  const { bridge, events } = makeBridge();
  const answer = bridge.prompt({
    type: 'select',
    message: 'Select Anthropic login method:',
    options: [
      { id: 'browser', label: 'Browser' },
      { id: 'copy_code', label: 'Copy code' },
    ],
  });
  const requestId = events[0].requestId;

  assert.equal(bridge.respond(requestId, 'device_code'), false);
  assert.equal(bridge.respond(requestId, 'copy_code'), true);
  assert.equal(await answer, 'copy_code');
});

test('cancelPrompt rejects only that prompt and keeps the bridge usable', async () => {
  const { bridge, events } = makeBridge();
  const first = bridge.prompt({ type: 'text', message: 'first' });
  const firstId = events[0].requestId;

  assert.equal(bridge.cancelPrompt(firstId), true);
  await assert.rejects(first, isAbort);
  assert.equal(events.at(-1).reason, 'cancelled');
  assert.equal(bridge.cancelPrompt(firstId), false);

  const second = bridge.prompt({ type: 'text', message: 'second' });
  const secondId = events.at(-1).requestId;
  bridge.respond(secondId, 'ok');
  assert.equal(await second, 'ok');
});

test('a per-prompt abort marks the prompt superseded (OAuth callback race)', async () => {
  const { bridge, events } = makeBridge();
  const controller = new AbortController();
  const answer = bridge.prompt({
    type: 'manual_code',
    message: 'Paste the code …',
    signal: controller.signal,
  });

  controller.abort();
  await assert.rejects(answer, isAbort);
  const closed = events.at(-1);
  assert.equal(closed.type, 'prompt_closed');
  assert.equal(closed.reason, 'superseded');
  assert.equal(bridge.respond(closed.requestId, 'whatever'), false);
});

test('dispose rejects every pending prompt and ignores later answers', async () => {
  const { bridge, events } = makeBridge();
  const first = bridge.prompt({ type: 'text', message: 'one' });
  const second = bridge.prompt({ type: 'secret', message: 'two' });
  const ids = events.filter((e) => e.type === 'prompt').map((e) => e.requestId);

  bridge.dispose('cancelled');
  await assert.rejects(first, isAbort);
  await assert.rejects(second, isAbort);
  assert.equal(bridge.pendingCount, 0);
  for (const id of ids) assert.equal(bridge.respond(id, 'late'), false);

  // Prompts requested after disposal fail fast instead of hanging the flow.
  await assert.rejects(bridge.prompt({ type: 'text', message: 'three' }), isAbort);
});
