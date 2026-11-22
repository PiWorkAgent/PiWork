import {
  CredentialSynchronizationError,
  type ModelRuntime,
  type SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type {
  AuthCredentialInfo,
  AuthNotice,
  AuthMethodInfo,
  AuthMethodType,
  AuthPromptAnswer,
  ProviderAuthRow,
} from '@pi/types';
import type { AuthService } from '../services/auth.js';
import { getSharedModelRuntime } from './model-runtime.js';
import { deriveProviderStatus } from './auth-status.js';
import { modelsJsonProviderIds } from './config.js';
import { AuthInteractionBridge, type AuthEventSink } from '../utils/auth-bridge.js';

/**
 * Structural views of the SDK's auth types. `pi-coding-agent` exports the
 * runtime but not the interaction types, and re-declaring them by hand would
 * silently drift; deriving them from `login()` keeps the compiler in charge.
 */
type SdkLogin = ModelRuntime['login'];
type SdkInteraction = Parameters<SdkLogin>[2];
type SdkProvider = ReturnType<ModelRuntime['getProviders']>[number];
type SdkPrompt = Parameters<SdkInteraction['prompt']>[0];
type SdkNotice = Parameters<SdkInteraction['notify']>[0];

export interface RealAuthServiceOptions {
  /** Supplies the stable device id OpenAI's ChatGPT flow requires. */
  settingsManager: SettingsManager;
  /** The process-wide runtime; falls back to the shared one when omitted. */
  runtime?: ModelRuntime;
  /** Where login events go (desktop main pushes them to the owning window). */
  sink: AuthEventSink;
  /** Introduced to providers during OAuth (ChatGPT `agent_name_hint`, Codex originator). */
  agentName?: string;
}

interface ActiveLogin {
  providerId: string;
  controller: AbortController;
  bridge: AuthInteractionBridge;
}

const CHECK_AUTH_TIMEOUT_MS = 2_500;
const CREDENTIALS_TIMEOUT_MS = 10_000;
const CATALOG_TIMEOUT_MS = 15_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Health sort order for the Settings list: usable first, then alphabetical. */
function healthRank(row: ProviderAuthRow): number {
  return row.health === 'connected' ? 0 : row.health === 'ambient' ? 1 : 2;
}

function methodInfo(provider: SdkProvider): AuthMethodInfo[] {
  const methods: AuthMethodInfo[] = [];
  const oauth = provider.auth?.oauth;
  if (oauth) {
    methods.push({
      type: 'oauth',
      label: oauth.loginLabel ?? oauth.name,
      subscription: oauth.isSubscription === true,
      interactive: true,
    });
  }
  const apiKey = provider.auth?.apiKey;
  if (apiKey) {
    methods.push({
      type: 'api_key',
      label: apiKey.name,
      subscription: false,
      // Ambient-only providers (Bedrock's credential chain, local endpoints)
      // expose auth without an interactive setup.
      interactive: !!apiKey.login,
    });
  }
  return methods;
}

export function createRealAuthService(options: RealAuthServiceOptions): AuthService {
  let runtimePromise: Promise<ModelRuntime> | undefined = options.runtime
    ? Promise.resolve(options.runtime)
    : undefined;
  const getRuntime = async (): Promise<ModelRuntime> =>
    (runtimePromise ??= getSharedModelRuntime());

  /** Login attempts in flight, keyed by the renderer's loginId. */
  const active = new Map<string, ActiveLogin>();

  const emit: AuthEventSink = options.sink;

  async function hasStoredCredential(
    runtime: ModelRuntime,
    providerId: string,
  ): Promise<boolean> {
    try {
      const credentials = await runtime.listCredentials({
        signal: AbortSignal.timeout(CREDENTIALS_TIMEOUT_MS),
      });
      return credentials.some((entry) => entry.providerId === providerId);
    } catch {
      return false;
    }
  }

  /**
   * Best-effort catalog refresh after a login, mirroring the CLI: `login()`
   * only restores the cached catalog, so providers whose real model list comes
   * from their API (OpenRouter, Radius) would otherwise stay stale until the
   * next `refresh`. Never fails the login.
   */
  function refreshCatalog(loginId: string, providerId: string): void {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    void (async () => {
      try {
        const runtime = await getRuntime();
        const result = await runtime.refresh({
          providers: [providerId],
          allowNetwork: true,
          signal: controller.signal,
        });
        const failure = result.errors.get(providerId);
        emit({
          type: 'catalog',
          loginId,
          providerId,
          ok: !result.aborted && !failure,
          error: failure ? errorMessage(failure) : undefined,
        });
      } catch (error) {
        emit({ type: 'catalog', loginId, providerId, ok: false, error: errorMessage(error) });
      } finally {
        clearTimeout(timer);
      }
    })();
  }

  async function runLogin(
    runtime: ModelRuntime,
    loginId: string,
    providerId: string,
    type: AuthMethodType,
    controller: AbortController,
    bridge: AuthInteractionBridge,
  ): Promise<void> {
    try {
      await runtime.login(
        providerId,
        type,
        {
          signal: controller.signal,
          // The casts only remove the SDK's per-prompt `signal`, which the
          // bridge accepts; the shapes are otherwise identical.
          prompt: (prompt: SdkPrompt) => bridge.prompt(prompt),
          notify: (event: SdkNotice) => bridge.notify(event as AuthNotice),
        },
        {
          getDeviceId: () => options.settingsManager.getOrCreateDeviceId(),
          ...(options.agentName ? { agentName: options.agentName } : {}),
        },
      );
      emit({ type: 'settled', loginId, providerId, ok: true });
      refreshCatalog(loginId, providerId);
    } catch (error) {
      const saved = await hasStoredCredential(runtime, providerId);
      if (error instanceof CredentialSynchronizationError) {
        // The credential is on disk; only the local snapshot failed to follow.
        emit({
          type: 'settled',
          loginId,
          providerId,
          ok: true,
          credentialSaved: true,
          error: errorMessage(error),
        });
        refreshCatalog(loginId, providerId);
      } else if (controller.signal.aborted || saved) {
        // An abort that raced the auth.json write: the store decides.
        emit({
          type: 'settled',
          loginId,
          providerId,
          ok: saved,
          cancelled: true,
          credentialSaved: saved,
          error: saved ? undefined : errorMessage(error),
        });
        if (saved) refreshCatalog(loginId, providerId);
      } else {
        emit({ type: 'settled', loginId, providerId, ok: false, error: errorMessage(error) });
      }
    } finally {
      // Nothing may outlive the flow: reject whatever prompts are still open.
      bridge.dispose('cancelled');
      active.delete(loginId);
    }
  }

  return {
    async listProviders(): Promise<ProviderAuthRow[]> {
      const runtime = await getRuntime();
      const credentials: readonly { providerId: string; type: AuthMethodType }[] = await runtime
        .listCredentials({ signal: AbortSignal.timeout(CREDENTIALS_TIMEOUT_MS) })
        .catch(() => []);
      const stored = new Map(credentials.map((entry) => [entry.providerId, entry.type]));
      // models.json is the only place a user-defined provider lives;
      // `getRegisteredProviderIds()` covers extension-registered ones only.
      const customIds = modelsJsonProviderIds();

      const rows = await Promise.all(
        runtime.getProviders().map(async (provider): Promise<ProviderAuthRow> => {
          // Live checks, so the badge cannot show a stale snapshot from an
          // interrupted login/logout. A slow ambient provider degrades to its
          // cached status instead of blocking the whole list.
          const live = await runtime
            .checkAuth(provider.id, { signal: AbortSignal.timeout(CHECK_AUTH_TIMEOUT_MS) })
            .catch(() => null);
          const snapshot = runtime.getProviderAuthStatus(provider.id);
          const status = deriveProviderStatus({
            storedType: stored.get(provider.id),
            live: live ?? null,
            snapshot,
          });
          const methods = methodInfo(provider);
          const custom = customIds.has(provider.id);
          return {
            id: provider.id,
            name: provider.name,
            custom,
            // models.json cannot declare an OAuth method, so a custom id that
            // carries one is shadowing a built-in provider.
            overridesBuiltin: custom && !!provider.auth?.oauth,
            methods,
            modelCount: runtime.getModels(provider.id).length,
            health: status.health,
            ...(status.storedType ? { storedType: status.storedType } : {}),
            ...(status.source ? { source: status.source } : {}),
            ...(status.sourceLabel ? { sourceLabel: status.sourceLabel } : {}),
            ambientOnly: methods.every((method) => !method.interactive),
          };
        }),
      );

      return rows.sort(
        (a, b) => healthRank(a) - healthRank(b) || a.name.localeCompare(b.name),
      );
    },

    async listCredentials(): Promise<AuthCredentialInfo[]> {
      const runtime = await getRuntime();
      const credentials = await runtime.listCredentials({
        signal: AbortSignal.timeout(CREDENTIALS_TIMEOUT_MS),
      });
      return credentials.map((entry) => ({ providerId: entry.providerId, type: entry.type }));
    },

    async login(input): Promise<{ loginId: string }> {
      const runtime = await getRuntime();
      const provider = runtime.getProvider(input.providerId);
      if (!provider) throw new Error(`未知服务商：${input.providerId}`);
      if (active.has(input.loginId)) throw new Error('重复的登录请求');

      const method = input.type === 'oauth' ? provider.auth?.oauth : provider.auth?.apiKey;
      if (!method?.login) {
        throw new Error(
          `${provider.name} 不支持${input.type === 'oauth' ? '订阅' : 'API Key'}登录`,
        );
      }

      const controller = new AbortController();
      const bridge = new AuthInteractionBridge(input.loginId, input.providerId, emit);
      active.set(input.loginId, { providerId: input.providerId, controller, bridge });
      // Deliberately un-awaited: the caller needs the loginId so it can
      // subscribe before the first prompt arrives.
      void runLogin(runtime, input.loginId, input.providerId, input.type, controller, bridge);
      return { loginId: input.loginId };
    },

    async respond(input: AuthPromptAnswer): Promise<void> {
      // A prompt can disappear while the answer is in flight (the OAuth
      // callback superseded it); that is a normal race, not an error.
      active.get(input.loginId)?.bridge.respond(input.requestId, input.value);
    },

    async cancelPrompt(input: { loginId: string; requestId: string }): Promise<void> {
      active.get(input.loginId)?.bridge.cancelPrompt(input.requestId);
    },

    async cancelLogin(loginId: string): Promise<void> {
      const entry = active.get(loginId);
      if (!entry) return;
      entry.controller.abort();
      // Reject the prompt the flow is parked on; otherwise it would keep the
      // login alive even though the user cancelled.
      entry.bridge.dispose('cancelled');
    },

    async logout(providerId: string): Promise<void> {
      const runtime = await getRuntime();
      try {
        await runtime.logout(providerId, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
      } catch (error) {
        // Deletion happens before the snapshot sync; a sync failure still
        // leaves the user logged out, which is what they asked for.
        if (!(error instanceof CredentialSynchronizationError)) throw error;
      }
    },
  };
}
