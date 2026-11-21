/**
 * Which files a plugin card already presents.
 *
 * The timeline hides the assistant message's generic file card for exactly
 * these paths: the file viewer's completion card is the richer of the two, and
 * showing both read as the same document twice. Files no plugin card mentions
 * keep their generic card, so a plain `write`/script output is not left with
 * no affordance.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectCardPaths,
  pluginCoveredPaths,
} from '../../../packages/ui/src/lib/plugin-card-paths.ts';

test('collects path props at any depth of the card tree', () => {
  const card = {
    component: 'Card',
    props: { title: '文档已创建' },
    children: [
      {
        component: 'Row',
        children: [
          { component: 'Text', props: { text: 'hello.pptx' } },
          {
            component: 'Button',
            props: { label: '打开', path: '/work/hello.pptx' },
            events: { onClick: 'open_viewer' },
          },
        ],
      },
      { component: 'Button', props: { label: '打开', path: '/work/notes.md' } },
    ],
  };
  assert.deepEqual([...collectCardPaths(card)], ['/work/hello.pptx', '/work/notes.md']);
});

test('a plugin message contributes card paths and file-list paths', () => {
  const messages = [
    {
      role: 'plugin',
      pluginId: 'com.pi.files',
      card: {
        component: 'Card',
        children: [{ component: 'Button', props: { path: '/work/hello.pptx' } }],
      },
      files: [{ path: '/work/extra.xlsx', label: 'extra.xlsx' }],
    },
    { role: 'assistant', blocks: [] },
    { role: 'user', content: 'hi' },
  ];
  assert.deepEqual([...pluginCoveredPaths(messages)], ['/work/extra.xlsx', '/work/hello.pptx']);
});

test('no plugin messages means nothing is suppressed', () => {
  assert.equal(pluginCoveredPaths([{ role: 'assistant', blocks: [] }]).size, 0);
  assert.equal(pluginCoveredPaths([]).size, 0);
});

test('empty or non-string path props are ignored', () => {
  const card = {
    component: 'Row',
    children: [
      { component: 'Button', props: { path: '' } },
      { component: 'Button', props: { path: 42 } },
      { component: 'Text', props: { text: 'x' } },
    ],
  };
  assert.equal(collectCardPaths(card).size, 0);
});
