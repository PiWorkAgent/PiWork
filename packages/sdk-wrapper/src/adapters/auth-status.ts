import type { AuthMethodType, ProviderAuthHealth } from '@pi/types';

/**
 * Inputs to a provider's connection badge.
 *
 * Every field is deliberately live data where it can be: the SDK's own
 * `getProviderAuthStatus()` reads a cached snapshot, which goes stale after a
 * cancelled login/logout (and reports `configured:false` before the first
 * availability pass finishes). `listCredentials()` and `checkAuth()` read the
 * store and the environment on every call, so they win when they disagree.
 */
export interface ProviderStatusInput {
  /** From a live `listCredentials()` — the authoritative "stored credential" set. */
  storedType?: AuthMethodType;
  /** From a live `checkAuth()`; null means the check threw. */
  live?: { type: AuthMethodType; source?: string } | null;
  /** The SDK's cached status; used for sources the live checks cannot name. */
  snapshot: { configured: boolean; source?: string; label?: string };
}

export interface ProviderStatusResult {
  health: ProviderAuthHealth;
  storedType?: AuthMethodType;
  source?: string;
  sourceLabel?: string;
}

/**
 * Map the three credential sources onto one badge:
 *
 *  - a stored auth.json credential → `connected`;
 *  - otherwise anything that resolves live (env var, cloud chain) → `ambient`;
 *  - otherwise a models.json `apiKey` (literal or `!command`) → `ambient`;
 *  - otherwise `none`.
 *
 * The one trap this function exists for: `snapshot.source === 'stored'` must
 * NOT be trusted without a credential in the live store — that is exactly the
 * stale state left behind by a logout whose snapshot sync failed.
 */
export function deriveProviderStatus(input: ProviderStatusInput): ProviderStatusResult {
  const { storedType, live, snapshot } = input;

  if (storedType) {
    return {
      health: 'connected',
      storedType,
      source: 'stored',
      sourceLabel: live?.source ?? snapshot.label ?? (storedType === 'oauth' ? 'OAuth' : undefined),
    };
  }

  if (live) {
    return {
      health: 'ambient',
      source: snapshot.source && snapshot.source !== 'stored' ? snapshot.source : 'environment',
      sourceLabel: live.source ?? snapshot.label,
    };
  }

  // `configured` from a models.json key/command (or an extension-provided
  // fallback). Runtime overrides also land here but never survive a restart,
  // so treating them as ambient is accurate enough for the badge.
  if (snapshot.configured && snapshot.source !== 'stored' && snapshot.source !== 'runtime') {
    return {
      health: 'ambient',
      source: snapshot.source,
      sourceLabel: snapshot.label,
    };
  }

  return { health: 'none', source: snapshot.source, sourceLabel: snapshot.label };
}
