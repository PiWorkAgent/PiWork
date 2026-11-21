/**
 * Model-provider authentication.
 *
 * The Pi SDK owns the login flows, the credential store (`~/.pi/agent/auth.json`)
 * and the availability rules. These types are the slice the host UI needs:
 * which providers exist, how each can be authenticated, and the prompts/notices
 * a live login raises so the renderer can draw them.
 */

export type AuthMethodType = 'api_key' | 'oauth';

/** One way a provider can be authenticated. */
export interface AuthMethodInfo {
  type: AuthMethodType;
  /** Human label from the SDK (`oauth.loginLabel ?? oauth.name`, `apiKey.name`). */
  label: string;
  /** OAuth backed by a provider subscription (Claude Pro/Max, ChatGPT Plus…). */
  subscription: boolean;
  /** False for ambient-only methods: env vars / cloud credentials, no prompt. */
  interactive: boolean;
}

/**
 * `connected` = a credential is stored in auth.json.
 * `ambient`   = no stored credential, but env vars / cloud chain / models.json
 *               key already resolve, so the provider works.
 * `none`      = not usable until the user signs in.
 */
export type ProviderAuthHealth = 'connected' | 'ambient' | 'none';

/** One row in Settings → 模型 → 内置服务商. */
export interface ProviderAuthRow {
  id: string;
  name: string;
  /** The id comes from models.json (a custom provider, not a built-in one). */
  custom: boolean;
  /** A models.json entry shadows a built-in provider id. */
  overridesBuiltin: boolean;
  methods: AuthMethodInfo[];
  /** Models the SDK lists for this provider (authenticated or not). */
  modelCount: number;
  health: ProviderAuthHealth;
  /** Credential type, only when `health === 'connected'`. */
  storedType?: AuthMethodType;
  /** Raw SDK source: stored | runtime | environment | models_json_key | … */
  source?: string;
  /** What resolved the auth, e.g. "ANTHROPIC_API_KEY", "OAuth", "~/.aws/credentials". */
  sourceLabel?: string;
  /** No method supports interactive login (Bedrock / Vertex style). */
  ambientOnly: boolean;
}

export interface AuthCredentialInfo {
  providerId: string;
  type: AuthMethodType;
}

export interface AuthPromptOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * A question the SDK asks mid-login. `signal` is intentionally absent: the
 * renderer cancels through `auth.cancelPrompt`, and rendering an AbortSignal
 * over the wire is meaningless.
 */
export type AuthPromptSpec =
  | { type: 'text'; message: string; placeholder?: string }
  | { type: 'secret'; message: string; placeholder?: string }
  | { type: 'manual_code'; message: string; placeholder?: string }
  | { type: 'select'; message: string; options: readonly AuthPromptOption[] };

export interface AuthInfoLink {
  url: string;
  label?: string;
}

/** Mirrors the SDK's AuthEvent union; the host turns URLs into browser opens. */
export type AuthNotice =
  | { type: 'info'; message: string; links?: readonly AuthInfoLink[] }
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
      type: 'device_code';
      userCode: string;
      verificationUri: string;
      openBrowserOnConfirm?: boolean;
      copyCodeOnConfirm?: boolean;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: 'progress'; message: string };

/**
 * Pushed on `pi:auth:event` to the window that started the login (and, for
 * `changed`, to every window).
 */
export type AuthLoginEvent =
  | {
      type: 'prompt';
      loginId: string;
      providerId: string;
      requestId: string;
      prompt: AuthPromptSpec;
    }
  /**
   * A prompt stopped being answerable — answered, cancelled by the user, or
   * superseded (the OAuth callback won the race against manual code entry).
   * The dialog closes that step; the login itself may still be running.
   */
  | {
      type: 'prompt_closed';
      loginId: string;
      requestId: string;
      reason: 'answered' | 'cancelled' | 'superseded';
    }
  | { type: 'notice'; loginId: string; providerId: string; event: AuthNotice }
  | {
      type: 'settled';
      loginId: string;
      providerId: string;
      ok: boolean;
      cancelled?: boolean;
      error?: string;
      /**
       * The credential reached auth.json even though the call did not resolve
       * cleanly (abort after the write, or a post-write sync failure). Login
       * succeeded from the user's point of view.
       */
      credentialSaved?: boolean;
    }
  /** Result of the best-effort network catalog refresh that follows a login. */
  | { type: 'catalog'; loginId: string; providerId: string; ok: boolean; error?: string }
  /** Broadcast: another window changed this provider's credentials. */
  | { type: 'changed'; providerId: string };

export interface AuthLoginRequest {
  /** Renderer-generated UUID; scopes events and ownership to one dialog. */
  loginId: string;
  providerId: string;
  type: AuthMethodType;
}

export interface AuthPromptAnswer {
  loginId: string;
  requestId: string;
  value: string;
}
