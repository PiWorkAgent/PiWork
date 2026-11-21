import type { Message, PluginMessage, UiNode } from '@pi/types';

/**
 * Files a plugin already surfaces in its own card.
 *
 * The host ends every assistant turn that wrote files with a generic file
 * card (size, download, open in system app). A plugin like the file viewer
 * posts a richer per-run completion card for the same documents — so the
 * conversation shows the same file twice. These helpers find the paths a
 * rendered plugin card points at, and the timeline hides the generic card
 * for exactly those paths: files written with no plugin card (a plain `write`
 * tool, a script's output) keep theirs.
 *
 * Paths come from `props.path` anywhere in the declarative tree (the office
 * card's 打开 button carries one) and from `message.files`.
 */

/** Collect every string `path` prop in a card tree. */
export function collectCardPaths(node: UiNode | undefined, out: Set<string> = new Set()): Set<string> {
  if (!node) return out;
  const path = node.props?.path;
  if (typeof path === 'string' && path) out.add(path);
  for (const child of node.children ?? []) collectCardPaths(child, out);
  return out;
}

/**
 * Paths covered by plugin messages that are actually rendered.
 *
 * Callers must pass the messages the timeline shows (after per-plugin muting):
 * a muted plugin renders no card, so its paths must NOT suppress the host
 * card — otherwise the file would have no affordance at all.
 */
export function pluginCoveredPaths(messages: readonly Message[]): Set<string> {
  const paths = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'plugin') continue;
    const pluginMessage = message as PluginMessage;
    for (const file of pluginMessage.files ?? []) {
      if (file.path) paths.add(file.path);
    }
    collectCardPaths(pluginMessage.card, paths);
  }
  return paths;
}
