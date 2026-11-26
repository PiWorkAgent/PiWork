/**
 * Clearing a conversation in place.
 *
 * "Clear chat history" is not "delete the conversation": the session keeps its
 * file and id — which is what keeps the window's panel layout and the plugin
 * state (the browser's tabs) where they are — and loses its messages. The
 * latest model / thinking choice and the title ride along, because they are
 * settings the user made for this conversation, not history.
 *
 * The rewrite happens underneath SessionManager, so the file must stay one the
 * manager can open: a header plus valid setup entries, no dangling parents.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createRealSessionService } from '../../../packages/sdk-wrapper/src/adapters/session.ts';

const BASE = 1_790_000_000_000;

function message(id, parentId, ts, role, text) {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: new Date(ts).toISOString(),
    message: { role, content: [{ type: 'text', text }], timestamp: ts },
  };
}

function setup(type, id, parentId, ts, extra) {
  return { type, id, parentId, timestamp: new Date(ts).toISOString(), ...extra };
}

function writeSession(root, name, entries) {
  const file = join(root, name);
  const header = {
    type: 'session',
    version: 3,
    id: name.replace(/\.jsonl$/, ''),
    timestamp: new Date(BASE).toISOString(),
    cwd: root,
  };
  writeFileSync(file, [header, ...entries].map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { file, header };
}

function tempDir(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-clear-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return root;
}

function fixture(root) {
  return writeSession(root, 'conversation.jsonl', [
    setup('model_change', 'm1', null, BASE + 1, { provider: 'test', modelId: 'model-a' }),
    setup('thinking_level_change', 't1', 'm1', BASE + 2, { thinkingLevel: 'high' }),
    setup('session_info', 'n1', 't1', BASE + 3, { name: '重构布置' }),
    message('u1', 'n1', BASE + 4, 'user', '第一个问题'),
    message('a1', 'u1', BASE + 5, 'assistant', '第一个回答'),
    message('u2', 'a1', BASE + 6, 'user', '第二个问题'),
    message('a2', 'u2', BASE + 7, 'assistant', '第二个回答'),
  ]);
}

test('clearing drops the messages and keeps the session itself', async (t) => {
  const root = tempDir(t);
  const { file, header } = fixture(root);

  const service = createRealSessionService();
  await service.clear(file);

  assert.ok(existsSync(file), 'the session file is still there — the id stays');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8').split('\n')[0]), header);

  const session = await service.get(file);
  assert.deepEqual(session.messages, [], 'no messages left');
  assert.equal(session.title, '重构布置', 'the title survives — it is not history');
  assert.equal(session.messageCount, 0);
});

test('the model and thinking choices survive the clear', async (t) => {
  const root = tempDir(t);
  const { file } = fixture(root);
  await createRealSessionService().clear(file);

  const sm = SessionManager.open(file);
  const types = sm.getEntries().map((e) => e.type);
  assert.deepEqual(types, ['model_change', 'thinking_level_change', 'session_info']);

  const model = sm.getEntries().find((e) => e.type === 'model_change');
  assert.equal(model.provider, 'test');
  assert.equal(model.modelId, 'model-a');
  const thinking = sm.getEntries().find((e) => e.type === 'thinking_level_change');
  assert.equal(thinking.thinkingLevel, 'high');
});

test('a cleared conversation still takes new messages', async (t) => {
  const root = tempDir(t);
  const { file } = fixture(root);

  const service = createRealSessionService();
  await service.clear(file);

  // The next turn appends to the file the way the agent would.
  const sm = SessionManager.open(file);
  sm.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: '清空之后的第一个问题' }],
    timestamp: BASE + 100,
  });

  const session = await service.get(file);
  assert.deepEqual(
    session.messages.map((m) => m.content),
    ['清空之后的第一个问题'],
  );
  assert.equal(session.title, '重构布置');
});

test('clearing a conversation that does not exist is an error, not a silent no-op', async (t) => {
  const root = tempDir(t);
  await assert.rejects(
    () => createRealSessionService().clear(join(root, 'nope.jsonl')),
    /会话不存在/,
  );
});

test('clearing refuses a file that is not a session', async (t) => {
  const root = tempDir(t);
  const file = join(root, 'notes.jsonl');
  writeFileSync(file, '{"type":"message","id":"x"}\n');
  await assert.rejects(() => createRealSessionService().clear(file), /不是有效的会话文件/);
});
