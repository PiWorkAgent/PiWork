import { create } from 'zustand';
import type { Attachment, ContentBlock, TokenUsage, ContextUsageInfo, SessionStatsInfo, MessageTiming, ToolTiming, PluginMessageData } from '@pi/types';

/**
 * Live run state of one conversation.
 *
 * The composer used to keep a single window-global streaming state, so
 * switching conversations during a run either showed the other conversation's
 * stream or let a late chunk write into it. Each conversation now owns a slot;
 * the flat fields on the store mirror the slot of `activeStreamSessionId`, so
 * every existing reader (ChatTimeline, composer) keeps working unchanged.
 */
export interface SessionStream {
  isStreaming: boolean;
  /**
   * Identity of this run's reply.
   *
   * The live reply and the transcript message it becomes share it, so the
   * reader replaces one with the other instead of removing a message and
   * appending a different one. Those are two different cache updates that
   * land a tick apart (`setQueryData` notifies observers on a timeout), and
   * the gap in between used to repaint the whole transcript.
   */
  runId: string;
  blocks: ContentBlock[];
  usage: TokenUsage | null;
  contextUsage: ContextUsageInfo | null;
  sessionStats: SessionStatsInfo | null;
  messageTiming: MessageTiming | null;
  toolTimings: Map<string, number>;
  streamError: string | null;
  steering: string[];
  followUp: string[];
}

function emptyStream(): SessionStream {
  return {
    isStreaming: false,
    runId: '',
    blocks: [],
    usage: null,
    contextUsage: null,
    sessionStats: null,
    messageTiming: null,
    toolTimings: new Map(),
    streamError: null,
    steering: [],
    followUp: [],
  };
}

type VisibleStream = Pick<
  ComposerState,
  | 'isStreaming'
  | 'streamingRunId'
  | 'streamingBlocks'
  | 'streamingUsage'
  | 'contextUsage'
  | 'sessionStats'
  | 'messageTiming'
  | 'toolTimings'
  | 'streamError'
  | 'steeringQueue'
  | 'followUpQueue'
>;

function visibleOf(stream: SessionStream): VisibleStream {
  return {
    isStreaming: stream.isStreaming,
    streamingRunId: stream.runId,
    streamingBlocks: stream.blocks,
    streamingUsage: stream.usage,
    contextUsage: stream.contextUsage,
    sessionStats: stream.sessionStats,
    messageTiming: stream.messageTiming,
    toolTimings: stream.toolTimings,
    streamError: stream.streamError,
    steeringQueue: stream.steering,
    followUpQueue: stream.followUp,
  };
}

function snapshotVisible(state: ComposerState): SessionStream {
  return {
    isStreaming: state.isStreaming,
    runId: state.streamingRunId,
    blocks: state.streamingBlocks,
    usage: state.streamingUsage,
    contextUsage: state.contextUsage,
    sessionStats: state.sessionStats,
    messageTiming: state.messageTiming,
    toolTimings: state.toolTimings,
    streamError: state.streamError,
    steering: state.steeringQueue,
    followUp: state.followUpQueue,
  };
}

interface ComposerState {
  value: string;
  isStreaming: boolean;
  /** Identity of the visible conversation's live reply (see `SessionStream.runId`). */
  streamingRunId: string;
  isDragging: boolean;
  showSlashMenu: boolean;
  showMentionMenu: boolean;
  slashQuery: string;
  mentionQuery: string;
  pendingAttachments: Attachment[];
  streamingBlocks: ContentBlock[];
  streamingUsage: TokenUsage | null;
  contextUsage: ContextUsageInfo | null;
  sessionStats: SessionStatsInfo | null;
  messageTiming: MessageTiming | null;
  toolTimings: Map<string, number>;
  streamError: string | null;
  /**
   * The conversation whose last send failed before it ever reached the
   * session, so the text went back into the composer.
   *
   * "Failed" is two different states and they need different retries: a turn
   * that reached the session is replayed from the transcript, while one that
   * never got there exists only in the composer — sending that box again is
   * the retry, and replaying the previous stored turn would answer the wrong
   * message. Cleared as soon as a new run starts.
   */
  failedDraftSessionId: string | null;
  setFailedDraftSession: (sessionId: string | null) => void;
  triggerSend: number;
  /** The text the next triggered send carries (set together with triggerSend). */
  triggerContent: string;
  /**
   * Plugin message delivered with the triggered send, when the trigger came
   * from a plugin (`chat.send`). The composer then sends the turn as a plugin
   * request card instead of a typed user message.
   */
  triggerPluginMessage: PluginMessageData | null;
  /** Editing mode: the UI message ID being edited (for reference) */
  editingMessageId: string | null;
  /** Editing mode: current text content of the editing textarea */
  editingContent: string;
  /**
   * Where the next triggered send goes in the session tree.
   *
   * A conversation is a tree, and both "edit this question" and "retry this
   * answer" mean the same thing mechanically: send the next turn as a sibling
   * of an earlier one instead of after the current leaf. `replay` says the
   * prompt is that earlier turn's own stored text rather than the content
   * being sent, so the UI never has to round-trip the raw prompt.
   */
  pendingBranch: { entryId: string; replay: boolean } | null;
  /** Attachments carried by the next triggered send (a replayed turn's images). */
  triggerAttachments: Attachment[];

  /** Whether to trigger a smooth scroll to bottom in Virtuoso (incremented per request) */
  scrollToBottomTrigger: number;

  /** Steering and follow-up message queues (synced from SDK queue_update events) */
  steeringQueue: string[];
  followUpQueue: string[];

  /** Live run state per conversation (background runs included). */
  streams: Record<string, SessionStream>;
  /** The conversation whose slot the flat fields mirror. */
  activeStreamSessionId: string | null;
  /** Draft text per conversation. */
  drafts: Record<string, string>;
  /** Conversations with a send in flight in this window. */
  sessionPending: Record<string, boolean>;

  /** Switch the visible slot; stashes the current one and restores the target. */
  enterSession: (sessionId: string | null) => void;
  /** Write to one conversation's live state, mirroring it when it is visible. */
  updateSessionStream: (sessionId: string, update: Partial<SessionStream>) => void;
  setSessionToolTiming: (sessionId: string, timing: ToolTiming) => void;
  /** Start a run for a conversation (visible or background). */
  beginSessionStream: (sessionId: string) => void;
  /** End a run; `clear` also drops its live blocks (the answer is persisted now). */
  endSessionStream: (sessionId: string, options?: { clear?: boolean; error?: string | null }) => void;
  setSessionPending: (sessionId: string, pending: boolean) => void;

  /** Remove a queued item by type and index (visual-only, SDK queue unaffected) */
  removeQueuedItem: (type: 'steer' | 'followUp', index: number) => void;

  setValue: (value: string) => void;
  setIsDragging: (dragging: boolean) => void;
  setShowSlashMenu: (show: boolean, query?: string) => void;
  setShowMentionMenu: (show: boolean, query?: string) => void;
  addAttachment: (attachment: Attachment) => void;
  /** Update an attachment with base64 file data after FileReader completes */
  updateAttachmentData: (id: string, data: string) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setTriggerSend: (
    content: string,
    pluginMessage?: PluginMessageData,
    options?: { silent?: boolean; attachments?: Attachment[] },
  ) => void;
  /** Set (or clear, with null) the plugin message for the next triggered send. */
  setTriggerPluginMessage: (message: PluginMessageData | null) => void;
  /** Choose where the next triggered send branches from (null to send at the leaf). */
  setPendingBranch: (branch: { entryId: string; replay: boolean } | null) => void;
  /** Signal the chat timeline to scroll to bottom (e.g. after inserting a slash command message) */
  triggerScrollToBottom: () => void;
  /** Enter edit mode: remembers the entry the next send branches from */
  setEditingMessage: (entryId: string, messageId: string, initialContent: string) => void;
  /** Set editing content (e.g. as user types in the textarea) */
  setEditingContent: (content: string) => void;
  /** Exit edit mode: clear composer and editing state */
  clearEditingMessage: () => void;
  reset: () => void;
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  value: '',
  isStreaming: false,
  streamingRunId: '',
  isDragging: false,
  showSlashMenu: false,
  showMentionMenu: false,
  slashQuery: '',
  mentionQuery: '',
  pendingAttachments: [],
  streamingBlocks: [],
  streamingUsage: null,
  contextUsage: null,
  sessionStats: null,
  messageTiming: null,
  toolTimings: new Map(),
  streamError: null,
  failedDraftSessionId: null,
  triggerSend: 0,
  triggerContent: '',
  triggerPluginMessage: null,
  triggerAttachments: [],
  scrollToBottomTrigger: 0,
  pendingBranch: null,
  editingMessageId: null,
  editingContent: '',
  steeringQueue: [],
  followUpQueue: [],
  streams: {},
  activeStreamSessionId: null,
  drafts: {},
  sessionPending: {},

  enterSession: (sessionId) =>
    set((state) => {
      const streams = { ...state.streams };
      const drafts = { ...state.drafts };
      // Keep what the visible fields hold, even if a caller bypassed the
      // session-scoped setters.
      if (state.activeStreamSessionId) {
        streams[state.activeStreamSessionId] = snapshotVisible(state);
        drafts[state.activeStreamSessionId] = state.value;
      }
      const target = sessionId ? streams[sessionId] : undefined;
      return {
        streams,
        drafts,
        activeStreamSessionId: sessionId,
        value: sessionId ? (drafts[sessionId] ?? '') : '',
        ...visibleOf(target ?? emptyStream()),
      };
    }),

  updateSessionStream: (sessionId, update) =>
    set((state) => {
      const current = state.streams[sessionId] ?? emptyStream();
      const next = { ...current, ...update };
      const streams = { ...state.streams, [sessionId]: next };
      if (state.activeStreamSessionId !== sessionId) return { streams };
      return { streams, ...visibleOf(next) };
    }),

  setSessionToolTiming: (sessionId, timing) =>
    set((state) => {
      const current = state.streams[sessionId] ?? emptyStream();
      const next = {
        ...current,
        toolTimings: new Map(current.toolTimings).set(timing.toolCallId, timing.durationMs),
      };
      const streams = { ...state.streams, [sessionId]: next };
      if (state.activeStreamSessionId !== sessionId) return { streams };
      return { streams, ...visibleOf(next) };
    }),

  beginSessionStream: (sessionId) => {
    get().updateSessionStream(sessionId, {
      ...emptyStream(),
      isStreaming: true,
      runId: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    });
    // Whatever text the failure put back in the composer is being sent now.
    if (get().failedDraftSessionId === sessionId) set({ failedDraftSessionId: null });
  },

  setFailedDraftSession: (sessionId) => set({ failedDraftSessionId: sessionId }),

  endSessionStream: (sessionId, options = {}) => {
    get().updateSessionStream(sessionId, {
      isStreaming: false,
      streamError: options.error ?? null,
      ...(options.clear ? { blocks: [], usage: null, steering: [], followUp: [] } : {}),
    });
  },

  setSessionPending: (sessionId, pending) =>
    set((state) => {
      const sessionPending = { ...state.sessionPending };
      if (pending) sessionPending[sessionId] = true;
      else delete sessionPending[sessionId];
      return { sessionPending };
    }),

  setValue: (value) =>
    set((state) => ({
      value,
      drafts: state.activeStreamSessionId
        ? { ...state.drafts, [state.activeStreamSessionId]: value }
        : state.drafts,
    })),
  setIsDragging: (isDragging) => set({ isDragging }),
  setShowSlashMenu: (show, query = '') => set({ showSlashMenu: show, slashQuery: query }),
  setShowMentionMenu: (show, query = '') => set({ showMentionMenu: show, mentionQuery: query }),
  addAttachment: (attachment) =>
    set((s) => ({ pendingAttachments: [...s.pendingAttachments, attachment] })),
  updateAttachmentData: (id, data) =>
    set((s) => ({
      pendingAttachments: s.pendingAttachments.map((a) =>
        a.id === id ? { ...a, data, status: 'ready' as const } : a,
      ),
    })),
  removeAttachment: (id) =>
    set((s) => ({ pendingAttachments: s.pendingAttachments.filter((a) => a.id !== id) })),
  clearAttachments: () => set({ pendingAttachments: [] }),
  setTriggerSend: (content, pluginMessage, options) =>
    set((s) => {
      const triggered = {
        triggerContent: content,
        triggerPluginMessage: pluginMessage ?? null,
        triggerAttachments: options?.attachments ?? [],
        triggerSend: s.triggerSend + 1,
      };
      // A plugin request or a replayed turn is not a draft: the text never
      // flashes in the user's input box, and it never becomes their draft.
      if (pluginMessage || options?.silent) return triggered;
      return {
        ...triggered,
        value: content,
        drafts: s.activeStreamSessionId
          ? { ...s.drafts, [s.activeStreamSessionId]: content }
          : s.drafts,
      };
    }),
  setTriggerPluginMessage: (triggerPluginMessage) => set({ triggerPluginMessage }),
  setPendingBranch: (pendingBranch) => set({ pendingBranch }),
  triggerScrollToBottom: () => set((s) => ({ scrollToBottomTrigger: s.scrollToBottomTrigger + 1 })),
  setEditingMessage: (entryId, messageId, initialContent) =>
    set({
      editingMessageId: messageId,
      editingContent: initialContent,
      pendingBranch: { entryId, replay: false },
    }),
  setEditingContent: (content) => set({ editingContent: content }),
  clearEditingMessage: () =>
    set({ pendingBranch: null, editingMessageId: null, editingContent: '' }),
  removeQueuedItem: (type, index) =>
    set((s) => {
      if (type === 'steer') {
        return { steeringQueue: s.steeringQueue.filter((_, i) => i !== index) };
      }
      return { followUpQueue: s.followUpQueue.filter((_, i) => i !== index) };
    }),
  reset: () =>
    set({
      value: '',
      isStreaming: false,
      streamingRunId: '',
      isDragging: false,
      showSlashMenu: false,
      showMentionMenu: false,
      slashQuery: '',
      mentionQuery: '',
      pendingAttachments: [],
      streamingBlocks: [],
      streamingUsage: null,
      contextUsage: null,
      sessionStats: null,
      messageTiming: null,
      toolTimings: new Map(),
      streamError: null,
      failedDraftSessionId: null,
      triggerSend: 0,
      triggerContent: '',
      triggerPluginMessage: null,
      triggerAttachments: [],
      pendingBranch: null,
      editingMessageId: null,
      editingContent: '',
      steeringQueue: [],
      followUpQueue: [],
      streams: {},
      activeStreamSessionId: null,
      drafts: {},
      sessionPending: {},
    }),
}));
