export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'custom';

export type ThinkLevel = 'off' | 'low' | 'medium' | 'high';

export interface ModelInfo {
  id: string;
  name: string;
  /** Coarse family, kept for callers that only care about the API shape. */
  provider: ModelProvider;
  /** Exact SDK provider id, e.g. `anthropic`, `openai-codex`, `DeepSeek-Flash`. */
  providerId: string;
  /** Provider display name for picker group headers. */
  providerName: string;
  supportsThinking: boolean;
  thinkLevels: ThinkLevel[];
  maxTokens: number;
  isAvailable: boolean;
}

/**
 * What the active model can accept. Derived from the SDK model object (the
 * `input` array in models.json); used to choose the host's system-prompt
 * capability note and to filter image tool results before they reach a model
 * that cannot read them.
 */
export interface ModelCapabilities {
  /** e.g. ['text'] or ['text', 'image']. */
  input: string[];
  /** True when `input` includes 'image'. */
  vision: boolean;
  contextWindow?: number;
  maxTokens?: number;
}
