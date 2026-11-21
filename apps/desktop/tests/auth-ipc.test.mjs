/**
 * `auth.*` routing: which window may answer a login, and where its events go.
 *
 * A login belongs to the window that started it. A second window must not be
 * able to answer its prompts, and a window that closes mid-flow must cancel
 * the login instead of leaving the main process waiting on a prompt nobody
 * can see.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthIpc } from '../src/main/ipc/auth.ts';

function makeSender(id) {
  const listeners = [];
  const sender = {
    id,
    sent: [],
    isDestroyed() {
      return sender.destroyed === true;
    },
    send(channel, payload) {
      sender.sent.push({ channel, payload });
    },
    once(event, listener) {
      assert.equal(event, 'destroyed');
      listeners.push(listener);
    },
    destroy() {
      sender.destroyed = true;
      for (const listener of listeners) listener();
    },
  };
  sender.destroyed = false;
  return sender;
}

function makeIpc() {
  const calls = [];
  const service = {
    async listProviders() {
      return [];
    },
    async listCredentials() {
      return [];
    },
    async login(input) {
      calls.push({ type: 'login', input });
      return { loginId: input.loginId };
    },
    async respond(input) {
      calls.push({ type: 'respond', input });
    },
    async cancelPrompt(input) {
      calls.push({ type: 'cancelPrompt', input });
    },
    async cancelLogin(loginId) {
      calls.push({ type: 'cancelLogin', loginId });
    },
    async logout(providerId) {
      calls.push({ type: 'logout', providerId });
    },
  };
  const broadcasts = [];
  const ipc = createAuthIpc({
    getService: () => service,
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
  });
  return { ipc, calls, broadcasts };
}

const LOGIN_ID = 'abcdef12-login-1';

test('events reach only the window that started the login', async () => {
  const { ipc } = makeIpc();
  const owner = makeSender(1);
  const other = makeSender(2);

  await ipc.handle(
    'login',
    { input: { loginId: LOGIN_ID, providerId: 'anthropic', type: 'oauth' } },
    owner,
  );

  ipc.sink({
    type: 'prompt',
    loginId: LOGIN_ID,
    providerId: 'anthropic',
    requestId: 'p1',
    prompt: { type: 'secret', message: 'key' },
  });

  assert.equal(owner.sent.length, 1);
  assert.equal(owner.sent[0].channel, 'pi:auth:event');
  assert.equal(owner.sent[0].payload.requestId, 'p1');
  assert.equal(other.sent.length, 0);
});

test('a second window cannot answer another window’s login', async () => {
  const { ipc, calls } = makeIpc();
  const owner = makeSender(1);
  const intruder = makeSender(2);

  await ipc.handle(
    'login',
    { input: { loginId: LOGIN_ID, providerId: 'openai', type: 'api_key' } },
    owner,
  );

  await assert.rejects(
    ipc.handle(
      'respond',
      { input: { loginId: LOGIN_ID, requestId: 'p1', value: 'sk-x' } },
      intruder,
    ),
    /不属于当前窗口/,
  );
  assert.equal(calls.filter((c) => c.type === 'respond').length, 0);
});

test('duplicate login ids are rejected', async () => {
  const { ipc } = makeIpc();
  const owner = makeSender(1);
  const input = { loginId: LOGIN_ID, providerId: 'anthropic', type: 'api_key' };

  await ipc.handle('login', { input }, owner);
  await assert.rejects(ipc.handle('login', { input }, owner), /重复的登录请求/);
});

test('settled broadcasts a change to every window and catalog still arrives', async () => {
  const { ipc, broadcasts } = makeIpc();
  const owner = makeSender(1);
  await ipc.handle(
    'login',
    { input: { loginId: LOGIN_ID, providerId: 'openai', type: 'oauth' } },
    owner,
  );

  ipc.sink({ type: 'settled', loginId: LOGIN_ID, providerId: 'openai', ok: true });
  assert.deepEqual(broadcasts.at(-1), {
    channel: 'pi:auth:event',
    payload: { type: 'changed', providerId: 'openai' },
  });

  // Ownership lingers for the best-effort catalog refresh that follows.
  ipc.sink({ type: 'catalog', loginId: LOGIN_ID, providerId: 'openai', ok: false, error: 'timeout' });
  assert.equal(owner.sent.at(-1).payload.type, 'catalog');

  // After the catalog event the login is released: nothing more is delivered.
  const before = owner.sent.length;
  ipc.sink({ type: 'notice', loginId: LOGIN_ID, providerId: 'openai', event: { type: 'progress', message: 'late' } });
  assert.equal(owner.sent.length, before);
});

test('a destroyed window cancels its login', async () => {
  const { ipc, calls } = makeIpc();
  const owner = makeSender(1);
  await ipc.handle(
    'login',
    { input: { loginId: LOGIN_ID, providerId: 'anthropic', type: 'oauth' } },
    owner,
  );

  owner.destroy();
  assert.equal(calls.filter((c) => c.type === 'cancelLogin').length, 1);

  const before = owner.sent.length;
  ipc.sink({
    type: 'prompt',
    loginId: LOGIN_ID,
    providerId: 'anthropic',
    requestId: 'p2',
    prompt: { type: 'text', message: 'x' },
  });
  assert.equal(owner.sent.length, before);
});

test('logout broadcasts the change', async () => {
  const { ipc, broadcasts } = makeIpc();
  await ipc.handle('logout', { providerId: 'anthropic' }, makeSender(1));
  assert.deepEqual(broadcasts.at(-1), {
    channel: 'pi:auth:event',
    payload: { type: 'changed', providerId: 'anthropic' },
  });
});
