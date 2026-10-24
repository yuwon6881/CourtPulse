/**
 * Decides whether a change of the gear store means "unsaved local edits".
 *
 * Until the cloud has answered, `lastSyncedJson` is null. The store at that moment is only what
 * this device had cached (`baselineJson`), not an edit, so it must not count as dirty; otherwise
 * the first snapshot is ignored and the stale or empty local copy overwrites the account's locker.
 */
export function shouldMarkStoreDirty(
  json: string | null,
  lastSyncedJson: string | null,
  baselineJson: string | null
): boolean {
  if (json === null || json === lastSyncedJson) return false;
  if (lastSyncedJson === null && json === baselineJson) return false;
  return true;
}
