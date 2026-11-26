import type { Session, SessionWithMessages, SessionTreeResult } from '@pi/types';

export interface SessionService {
  list(workspaceId: string): Promise<Session[]>;
  get(id: string): Promise<SessionWithMessages>;
  create(workspaceId: string, title?: string): Promise<Session>;
  delete(id: string): Promise<void>;
  /**
   * Clear a conversation in place: every message is dropped, the session
   * itself stays — same id, same file, same title. This is the "start fresh
   * without losing the work panel" action: because the conversation is not
   * replaced, the window's panel layout and the plugin state (the browser's
   * tabs, for one) stay exactly where they are.
   *
   * The latest model and thinking-level choices are kept: they are settings
   * the user made for this conversation, not history.
   *
   * Refuses (throws) while the conversation has a run in flight — the file is
   * being written then. Callers stop the run first.
   */
  clear(id: string): Promise<void>;
  updateTitle(id: string, title: string): Promise<Session>;
  getTree(id: string): Promise<SessionTreeResult>;
  /**
   * Copy the conversation up to and including `throughEntryId` into a new,
   * independent session; the source is not modified.
   *
   * `throughEntryId` is the last SDK entry of the reply the user picked (the
   * reader exposes it as `Message.lastEntryId`): one UI message can span
   * several entries, and stopping at the first would cut a tool loop in half.
   * The new session contains the active path only — abandoned versions,
   * labels and tree structure outside that path are not copied.
   */
  fork(sourceId: string, throughEntryId: string, title?: string): Promise<SessionWithMessages>;
}
