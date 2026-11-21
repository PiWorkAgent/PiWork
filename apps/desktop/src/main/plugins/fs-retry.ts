/**
 * Directory renames/removals on Windows are routinely blocked for a moment by
 * antivirus, Explorer, the search indexer, or a plugin backend that has not
 * fully exited — the same EBUSY class the packaging pipeline already documents.
 * A single-shot `renameSync` there left a plugin half-swapped (old copy moved
 * aside, new one not in place) until restart.
 */

/** Codes Windows raises for "someone still has a handle on this". */
export function isTransientFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOTEMPTY';
}

/** Blocking sleep for the synchronous install path (already doing sync IO). */
function waitSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Retry a filesystem operation while the failure looks transient. */
export function retryFs<T>(operation: () => T, attempts = 6, baseDelayMs = 60): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return operation();
    } catch (err) {
      if (attempt >= attempts || !isTransientFsError(err)) throw err;
      waitSync(baseDelayMs * attempt);
    }
  }
}
