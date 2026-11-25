/**
 * How a failed run reads in the transcript.
 *
 * The agent's message is written for its own CLI — "Use /login … See:
 * D:\Program Files\PiWork\resources\app.asar\node_modules\…\providers.md" — and
 * this app answers the missing-credential case itself (设置 → 模型) instead of
 * repeating that advice with paths that do not exist on the reader's disk.
 *
 * These tests pin that split: which failures count as a credential problem,
 * and what is left of the text once the documentation tail is removed.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyStreamError, cleanStreamError } from '../../../packages/ui/src/lib/stream-error.ts';

/** The message that made the error card worth building, verbatim. */
const NO_KEY =
  'No API key found for the selected model. Use /login to log into a provider via OAuth or API key. ' +
  'See: D:\\Program Files\\PiWork\\resources\\app.asar\\node_modules\\@earendil-works\\pi-coding-agent\\docs\\providers.md ' +
  'D:\\Program Files\\PiWork\\resources\\app.asar\\node_modules\\@earendil-works\\pi-coding-agent\\docs\\models.md';

test('a missing credential is a configuration error', () => {
  assert.equal(classifyStreamError(NO_KEY), 'configuration');
  assert.equal(classifyStreamError('Missing API key for provider openai'), 'configuration');
  assert.equal(classifyStreamError('API key is not set'), 'configuration');
  assert.equal(classifyStreamError('Invalid API key provided'), 'configuration');
  assert.equal(classifyStreamError('Please use /login to authenticate'), 'configuration');
  assert.equal(classifyStreamError('当前模型未配置 API Key'), 'configuration');
  // A provider rejecting the key outright, in the two shapes it arrives in:
  // Anthropic's wire body and an OpenAI-style 401.
  assert.equal(
    classifyStreamError(
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    ),
    'configuration',
  );
  assert.equal(classifyStreamError('401 Unauthorized: incorrect API key'), 'configuration');
});

test('everything else stays a plain failure', () => {
  assert.equal(classifyStreamError('fetch failed: ECONNRESET'), 'other');
  assert.equal(classifyStreamError('Rate limit exceeded, retry later (429)'), 'other');
  assert.equal(classifyStreamError('Tool "bash" failed with exit code 1'), 'other');
  // "not configured" alone is not enough: tool and server errors say it too,
  // and sending someone to the model settings for those wastes a click.
  assert.equal(classifyStreamError('MCP server not configured'), 'other');
  assert.equal(classifyStreamError(''), 'other');
});

test('the documentation tail is cut off', () => {
  assert.equal(
    cleanStreamError(NO_KEY),
    'No API key found for the selected model. Use /login to log into a provider via OAuth or API key.',
  );
  assert.equal(cleanStreamError('Provider unavailable. SEE: /opt/pi/docs/faq.md'), 'Provider unavailable.');
});

test('the message is folded onto one line', () => {
  assert.equal(cleanStreamError('  fetch\n\tdid  \n fail '), 'fetch did fail');
});

test('an error without noise is left alone', () => {
  assert.equal(cleanStreamError('fetch failed'), 'fetch failed');
  assert.equal(cleanStreamError('Tool "bash" failed with exit code 1'), 'Tool "bash" failed with exit code 1');
});

test('a message that is only that tail is returned whole', () => {
  // Better a noisy message than an empty card.
  assert.equal(cleanStreamError('See: /opt/pi/docs/models.md'), 'See: /opt/pi/docs/models.md');
});
