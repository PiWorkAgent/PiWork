import type {
  AuthLoginEvent,
  AuthNotice,
  AuthPromptOption,
  AuthPromptSpec,
} from '@pi/types';

/**
 * The SDK's login interaction, as this package sees it.
 *
 * `@earendil-works/pi-coding-agent` does not re-export its auth types, so the
 * shapes are mirrored structurally. The differences are deliberate:
 *
 *  - `signal` is accepted on prompts (the SDK races a manual-code prompt
 *    against the OAuth callback and aborts the loser) but never travels over
 *    the wire — the renderer cancels through `auth.cancelPrompt` instead.
 *  - Options are the same `{id,label,description?}` records the SDK prompts
 *    with; a `select` answer is the option id.
 */
export type BridgePrompt = { signal?: AbortSignal } & (
  | { type: 'text'; message: string; placeholder?: string }
  | { type: 'secret'; message: string; placeholder?: string }
  | { type: 'manual_code'; message: string; placeholder?: string }
  | { type: 'select'; message: string; options: readonly AuthPromptOption[] }
);

export type AuthEventSink = (event: AuthLoginEvent) => void;

interface PendingPrompt {
  spec: AuthPromptSpec;
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

type CloseReason = 'answered' | 'cancelled' | 'superseded';

function abortError(message: string): unknown {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError');
  return Object.assign(new Error(message), { name: 'AbortError' });
}

function toSpec(prompt: BridgePrompt): AuthPromptSpec {
  switch (prompt.type) {
    case 'select':
      return { type: 'select', message: prompt.message, options: prompt.options };
    default:
      return { type: prompt.type, message: prompt.message, placeholder: prompt.placeholder };
  }
}

/**
 * Sits between `ModelRuntime.login()` and the renderer's login dialog.
 *
 * One bridge exists per login attempt, in the process that runs the flow
 * (main). Every prompt parks a promise here until the renderer answers or the
 * prompt is cancelled/superseded; every notice is forwarded as an event. The
 * bridge is the single place that guarantees no prompt promise outlives the
 * login: `dispose()` rejects whatever is still pending.
 */
export class AuthInteractionBridge {
  private readonly pending = new Map<string, PendingPrompt>();
  private counter = 0;
  private disposed = false;

  constructor(
    private readonly loginId: string,
    private readonly providerId: string,
    private readonly sink: AuthEventSink,
  ) {}

  prompt(prompt: BridgePrompt): Promise<string> {
    if (this.disposed) return Promise.reject(abortError('登录流程已结束'));

    const requestId = `p${++this.counter}`;
    return new Promise<string>((resolve, reject) => {
      const entry: PendingPrompt = { spec: toSpec(prompt), resolve, reject, signal: prompt.signal };
      this.pending.set(requestId, entry);

      // The SDK aborts this prompt when the race it lost resolved elsewhere
      // (the OAuth callback arrived while the manual-code prompt was open).
      if (prompt.signal) {
        entry.onAbort = () => this.close(requestId, 'superseded');
        prompt.signal.addEventListener('abort', entry.onAbort, { once: true });
      }

      if (prompt.signal?.aborted) {
        // `close` would have been scheduled by the listener in the common
        // case; doing it directly keeps the failure ordered before the UI
        // ever sees a prompt it cannot answer.
        this.close(requestId, 'superseded');
        return;
      }

      this.sink({
        type: 'prompt',
        loginId: this.loginId,
        providerId: this.providerId,
        requestId,
        prompt: entry.spec,
      });
    });
  }

  notify(event: AuthNotice): void {
    if (this.disposed) return;
    this.sink({ type: 'notice', loginId: this.loginId, providerId: this.providerId, event });
  }

  /**
   * The renderer's answer. Returns false for prompts that are gone (the login
   * ended, the prompt was superseded, or a `select` value is not one of the
   * offered option ids) so a stale dialog cannot resolve a newer prompt.
   */
  respond(requestId: string, value: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    if (entry.spec.type === 'select' && !entry.spec.options.some((option) => option.id === value)) {
      return false;
    }
    this.close(requestId, 'answered', value);
    return true;
  }

  /** Cancel one prompt without aborting the whole login (user dismissal). */
  cancelPrompt(requestId: string): boolean {
    if (!this.pending.has(requestId)) return false;
    this.close(requestId, 'cancelled');
    return true;
  }

  /**
   * End of the login: reject everything still pending so the SDK's awaits
   * settle and no promise is left dangling. Later `respond` calls are no-ops.
   */
  dispose(reason: Exclude<CloseReason, 'answered'>): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const requestId of [...this.pending.keys()]) this.close(requestId, reason);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private close(requestId: string, reason: CloseReason, value?: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    this.sink({ type: 'prompt_closed', loginId: this.loginId, requestId, reason });
    if (reason === 'answered') entry.resolve(value ?? '');
    else entry.reject(abortError(reason === 'cancelled' ? '登录已取消' : '登录提示已失效'));
  }
}
