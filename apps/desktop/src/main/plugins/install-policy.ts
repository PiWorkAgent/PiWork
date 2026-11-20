/**
 * When a failed update should undo itself.
 *
 * Kept out of PluginSystem so the decision is testable without Electron: the
 * brittle part of "auto-rollback on a broken update" is not the file swap
 * (marketplace.rollback already exists) but deciding when to do it.
 *
 * The rules, and why:
 *   - Only on an UPDATE. A first install has nothing to go back to; a
 *     same-version reinstall was the user explicitly replacing a copy it did
 *     not trust, so restoring some unrelated older version would be wrong.
 *   - Only when activation failed. 'active' means the backend shook hands;
 *     a crash after that is the crash-restart path, not a bad package.
 *   - Only when the previous copy really is on disk. commitInstall keeps it
 *     (`.previous`) exactly when the version changed, so this should always
 *     hold for an update — checking it keeps a missing copy from producing a
 *     confusing "rollback failed" on top of the original failure.
 */
export function shouldAutoRollback(input: {
  /** Version installed before this update, null for a first install. */
  previousVersion: string | null;
  /** Version the update was installing. */
  attemptedVersion: string;
  /** Runtime state after activation was attempted. */
  state: string | undefined;
  /** Whether `.previous` actually holds the outgoing copy. */
  hasPreviousCopy: boolean;
}): boolean {
  const { previousVersion, attemptedVersion, state, hasPreviousCopy } = input;
  if (previousVersion === null || previousVersion === attemptedVersion) return false;
  if (!hasPreviousCopy) return false;
  return state === 'error' || state === 'crashed';
}
