import type { AuthLoginEvent, AuthPromptAnswer } from '@pi/types';
import type { AuthService } from '@pi/sdk-wrapper';

/**
 * The slice of `WebContents` this module touches. Narrow on purpose: the
 * routing is unit-tested with a fake sender, and nothing here may reach into
 * Electron's runtime.
 */
export interface AuthSender {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
  once(event: 'destroyed', listener: () => void): unknown;
}

export interface AuthIpcDeps {
  /** Resolved lazily: services are created during app.whenReady. */
  getService: () => AuthService;
  /** `windows.broadcast` in production; a spy in tests. */
  broadcast: (channel: string, payload: unknown) => void;
}

export interface AuthIpc {
  /** Passed to `createRealAuthService({ sink })`. */
  sink: (event: AuthLoginEvent) => void;
  handle(action: string, params: unknown, sender: AuthSender): Promise<unknown>;
}

const AUTH_EVENT_CHANNEL = 'pi:auth:event';
/** Renderer-generated UUIDs. Bounded so a hostile page cannot grow the map. */
const LOGIN_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
/** How long an owner is kept after `settled`, waiting for the catalog event. */
const OWNER_LINGER_MS = 30_000;

function asRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
}

function parseLoginRequest(params: unknown): { loginId: string; providerId: string; type: 'api_key' | 'oauth' } {
  const input = asRecord(asRecord(params).input);
  if (typeof input.loginId !== 'string' || !LOGIN_ID_PATTERN.test(input.loginId)) {
    throw new Error('登录请求缺少有效的 loginId');
  }
  if (typeof input.providerId !== 'string' || !input.providerId) {
    throw new Error('登录请求缺少 providerId');
  }
  if (input.type !== 'api_key' && input.type !== 'oauth') {
    throw new Error('登录请求的认证方式无效');
  }
  return { loginId: input.loginId, providerId: input.providerId, type: input.type };
}

/**
 * Login routing for `auth.*`.
 *
 * The flow itself — and the prompt promises it parks on — lives in the adapter
 * inside this process. What this module owns is *which window may answer*: a
 * login is registered against the webContents that started it, every event is
 * delivered there and nowhere else, and a window that goes away cancels its
 * own login instead of leaving the flow waiting for a dialog that no longer
 * exists. `settled` is not the end of delivery — the best-effort catalog
 * refresh reports after it — so ownership lingers briefly.
 */
export function createAuthIpc(deps: AuthIpcDeps): AuthIpc {
  const owners = new Map<string, AuthSender>();
  const lingerTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function release(loginId: string): void {
    owners.delete(loginId);
    const timer = lingerTimers.get(loginId);
    if (timer) clearTimeout(timer);
    lingerTimers.delete(loginId);
  }

  function requireOwner(loginId: string, sender: AuthSender): void {
    const owner = owners.get(loginId);
    if (!owner || owner.id !== sender.id) {
      throw new Error('登录请求不属于当前窗口');
    }
  }

  const sink = (event: AuthLoginEvent): void => {
    // The service only emits per-login events; `changed` is produced here.
    const loginId = 'loginId' in event ? event.loginId : '';
    if (event.type === 'settled') {
      // Every window's provider list may be stale now.
      deps.broadcast(AUTH_EVENT_CHANNEL, { type: 'changed', providerId: event.providerId });
      // The catalog event follows; keep the owner until it lands (or the
      // backstop fires) so the dialog can still hear it.
      if (!lingerTimers.has(loginId)) {
        const timer = setTimeout(() => release(loginId), OWNER_LINGER_MS);
        timer.unref?.();
        lingerTimers.set(loginId, timer);
      }
    }

    const owner = owners.get(loginId);
    if (!owner || owner.isDestroyed()) {
      if (event.type === 'settled' || event.type === 'catalog') release(loginId);
      return;
    }
    owner.send(AUTH_EVENT_CHANNEL, event);
    if (event.type === 'catalog') release(loginId);
  };

  return {
    sink,

    async handle(action, params, sender) {
      const service = deps.getService();
      const p = asRecord(params);

      switch (action) {
        case 'listProviders':
          return service.listProviders();

        case 'listCredentials':
          return service.listCredentials();

        case 'login': {
          const input = parseLoginRequest(params);
          if (owners.has(input.loginId)) throw new Error('重复的登录请求');
          owners.set(input.loginId, sender);
          // A closed window must not leave a flow parked on an unanswerable
          // prompt (the OAuth callback would keep the process waiting).
          sender.once('destroyed', () => {
            if (owners.get(input.loginId) !== sender) return;
            release(input.loginId);
            void service.cancelLogin(input.loginId).catch(() => {});
          });
          try {
            return await service.login(input);
          } catch (error) {
            release(input.loginId);
            throw error;
          }
        }

        case 'respond': {
          const input = asRecord(p.input) as Partial<AuthPromptAnswer>;
          if (typeof input.loginId !== 'string' || typeof input.requestId !== 'string') {
            throw new Error('无效的登录回答');
          }
          requireOwner(input.loginId, sender);
          await service.respond({
            loginId: input.loginId,
            requestId: input.requestId,
            value: typeof input.value === 'string' ? input.value : '',
          });
          return undefined;
        }

        case 'cancelPrompt': {
          const input = asRecord(p.input);
          const loginId = String(input.loginId ?? '');
          const requestId = String(input.requestId ?? '');
          requireOwner(loginId, sender);
          await service.cancelPrompt({ loginId, requestId });
          return undefined;
        }

        case 'cancelLogin': {
          const loginId = String(p.loginId ?? '');
          requireOwner(loginId, sender);
          await service.cancelLogin(loginId);
          return undefined;
        }

        case 'logout': {
          const providerId = String(p.providerId ?? '');
          if (!providerId) throw new Error('登出请求缺少 providerId');
          await service.logout(providerId);
          deps.broadcast(AUTH_EVENT_CHANNEL, { type: 'changed', providerId });
          return undefined;
        }

        default:
          throw new Error(`未知的 auth 操作：${action}`);
      }
    },
  };
}
