/**
 * Saved-model keys with built-in providers enabled.
 *
 * The historical format is the bare model id. Two providers can now advertise
 * the same id (aggregators especially), so an ambiguous pick must persist as
 * `provider/id` — a form the chat service's `findModelById` already resolves —
 * while everything else keeps the bare id for backwards compatibility.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesModelSelection, preferredModelSelection } from '@pi/sdk-wrapper';
import { toModelInfo } from '@pi/sdk-wrapper/adapters';

const UNIQUE = [
  { id: 'claude-sonnet-5', providerId: 'anthropic' },
  { id: 'gpt-5.5', providerId: 'openai' },
];

const AMBIGUOUS = [
  { id: 'deepseek-chat', providerId: 'deepseek' },
  { id: 'deepseek-chat', providerId: 'openrouter' },
];

test('a bare id matches its model', () => {
  assert.equal(matchesModelSelection('gpt-5.5', UNIQUE[1]), true);
  assert.equal(matchesModelSelection('gpt-5.5', UNIQUE[0]), false);
});

test('a provider-qualified selection matches only that provider', () => {
  assert.equal(matchesModelSelection('deepseek/deepseek-chat', AMBIGUOUS[0]), true);
  assert.equal(matchesModelSelection('deepseek/deepseek-chat', AMBIGUOUS[1]), false);
  assert.equal(matchesModelSelection('openrouter/deepseek-chat', AMBIGUOUS[1]), true);
});

test('an empty selection matches nothing', () => {
  assert.equal(matchesModelSelection('', UNIQUE[0]), false);
});

test('unique ids keep the historical bare form', () => {
  assert.equal(preferredModelSelection(UNIQUE, UNIQUE[0]), 'claude-sonnet-5');
});

test('an id served by two providers is qualified', () => {
  assert.equal(preferredModelSelection(AMBIGUOUS, AMBIGUOUS[0]), 'deepseek/deepseek-chat');
  assert.equal(preferredModelSelection(AMBIGUOUS, AMBIGUOUS[1]), 'openrouter/deepseek-chat');
});

test('ModelInfo carries the provider identity the picker groups by', () => {
  const info = toModelInfo(
    {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      provider: 'anthropic',
      reasoning: true,
      thinkingLevelMap: { off: null, low: 'low', medium: 'medium', high: 'high' },
      maxTokens: 64000,
    },
    'Anthropic',
  );
  assert.equal(info.id, 'claude-sonnet-5');
  assert.equal(info.provider, 'anthropic');
  assert.equal(info.providerId, 'anthropic');
  assert.equal(info.providerName, 'Anthropic');
  assert.equal(info.supportsThinking, true);
  assert.deepEqual(info.thinkLevels, ['off', 'low', 'medium', 'high']);
  assert.equal(info.isAvailable, true);
});
