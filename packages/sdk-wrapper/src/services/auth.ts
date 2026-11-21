import type {
  AuthCredentialInfo,
  AuthLoginRequest,
  AuthPromptAnswer,
  ProviderAuthRow,
} from '@pi/types';

/**
 * Provider sign-in, backed by the Pi SDK's `ModelRuntime`.
 *
 * The flows themselves belong to the SDK (OAuth callback servers, device
 * codes, API-key validation, `auth.json` writes). This service exposes them to
 * the renderer and streams the prompts/notices a flow raises as
 * `AuthLoginEvent`s on `pi:auth:event`.
 */
export interface AuthService {
  /** Every provider the runtime knows — built-in and models.json-defined. */
  listProviders(): Promise<ProviderAuthRow[]>;
  /** Stored credentials only (auth.json), for `已连接` accounting. */
  listCredentials(): Promise<AuthCredentialInfo[]>;
  /**
   * Start a login. Resolves as soon as the flow is registered — not when it
   * finishes; progress arrives as events keyed by `input.loginId`.
   */
  login(input: AuthLoginRequest): Promise<{ loginId: string }>;
  /** Answer the prompt identified by `input.requestId`. */
  respond(input: AuthPromptAnswer): Promise<void>;
  /** Dismiss one prompt (e.g. the user closed the code field). */
  cancelPrompt(input: { loginId: string; requestId: string }): Promise<void>;
  /** Abort the whole flow. The credential written so far, if any, stays. */
  cancelLogin(loginId: string): Promise<void>;
  /**
   * Remove the stored credential. Environment variables and models.json keys
   * are untouched (the SDK defines logout that way), so the provider can stay
   * `ambient` after a logout.
   */
  logout(providerId: string): Promise<void>;
}
