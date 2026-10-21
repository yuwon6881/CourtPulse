import { useEffect, useRef, useState } from 'react';
import {
  EMPTY_EQUIPMENT_STORE,
  type EquipmentStoreState,
  loadEquipmentStoreState,
  writeEquipmentStoreState,
} from '../utils/equipmentStorage';
import { saveCloudLocker, serializeForCloud, subscribeCloudLocker } from '../utils/equipmentCloud';
import { backoffDelayMs } from '../utils/friendlyErrors';

export type EquipmentSyncStatus = 'device' | 'loading' | 'saving' | 'synced' | 'error';

/**
 * Owns the gear locker state. Signed out, it lives in this browser only, like the rest of
 * CourtPulse's local mode. Signed in, the account's Firestore document is the source of truth;
 * a new account is seeded the same way the club data is.
 */
export function useEquipmentStore(cloudOwnerId: string | null, seed: EquipmentStoreState) {
  const [store, setStore] = useState<EquipmentStoreState>(() =>
    loadEquipmentStoreState(seed, undefined, cloudOwnerId)
  );
  const [status, setStatus] = useState<EquipmentSyncStatus>(cloudOwnerId ? 'loading' : 'device');
  const [syncError, setSyncError] = useState('');

  const lastSyncedJsonRef = useRef<string | null>(null);
  const docExistsRef = useRef(false);
  const savingRef = useRef(false);
  const seedRef = useRef(seed);
  // The owner whose data this hook currently holds; guards writes against an account switch.
  const ownerRef = useRef<string | null>(cloudOwnerId);
  const storeRef = useRef<EquipmentStoreState>(store);
  const statusRef = useRef<EquipmentSyncStatus>(status);
  // Unsaved local changes exist. Cleared only by a successful write of the latest state.
  const dirtyRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const evaluateRef = useRef<() => void>(() => {});
  statusRef.current = status;

  const clearRetryTimer = () => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  // Writes are chained rather than debounced, so leaving the tab never drops a change. A failed
  // write is retried on a timer (2s, 4s ... 60s) instead of on every status change.
  const flush = async (): Promise<void> => {
    if (savingRef.current || retryTimerRef.current !== null) return;
    const owner = ownerRef.current;
    if (!owner || !dirtyRef.current) return;
    const json = serializeForCloud(storeRef.current);
    if (json === null) return;
    if (json === lastSyncedJsonRef.current) {
      dirtyRef.current = false;
      return;
    }

    savingRef.current = true;
    setStatus('saving');
    try {
      await saveCloudLocker(owner, json, !docExistsRef.current);
      if (ownerRef.current !== owner) return; // account changed mid-flight; drop the result
      docExistsRef.current = true;
      lastSyncedJsonRef.current = json;
      attemptRef.current = 0;
      setSyncError('');
      setStatus('synced');
      savingRef.current = false;
      // More edits may have landed while this write was in flight.
      dirtyRef.current = false;
      evaluateRef.current();
    } catch {
      if (ownerRef.current !== owner) return;
      attemptRef.current += 1;
      const delay = backoffDelayMs(attemptRef.current);
      setSyncError(
        'Your latest gear change was not saved to your account. CourtPulse will keep retrying.'
      );
      savingRef.current = false;
      setStatus('synced');
      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        evaluateRef.current();
      }, delay);
    }
  };

  // Compares the current store with what the cloud last accepted and starts a write if needed.
  const evaluate = () => {
    if (!ownerRef.current) return;
    if (statusRef.current === 'loading' || statusRef.current === 'error') return;
    const json = serializeForCloud(storeRef.current);
    if (json === null) {
      setSyncError('Gear history is too large to save to your account. Clear old logs to continue syncing.');
      return;
    }
    if (json === lastSyncedJsonRef.current) {
      dirtyRef.current = false;
      return;
    }
    dirtyRef.current = true;
    void flush();
  };
  evaluateRef.current = evaluate;

  useEffect(() => {
    ownerRef.current = cloudOwnerId;
    lastSyncedJsonRef.current = null;
    docExistsRef.current = false;
    dirtyRef.current = false;
    savingRef.current = false;
    attemptRef.current = 0;
    clearRetryTimer();
    setSyncError('');

    if (!cloudOwnerId) {
      setStore(loadEquipmentStoreState(seedRef.current, undefined, null));
      setStatus('device');
      return;
    }

    setStore(loadEquipmentStoreState(seedRef.current, undefined, cloudOwnerId));
    setStatus('loading');
    const unsubscribe = subscribeCloudLocker(
      cloudOwnerId,
      (snapshot) => {
        if (ownerRef.current !== cloudOwnerId) return;
        // Our own writes echo back; while one is in flight (or unsaved edits wait for a retry)
        // the local state is newer than the snapshot.
        if (savingRef.current) return;
        if (snapshot.status === 'unreadable') {
          setSyncError('Saved gear in your account could not be read, so editing is paused.');
          setStatus('error');
          return;
        }
        if (snapshot.status === 'missing') {
          docExistsRef.current = false;
          if (!dirtyRef.current) {
            setStore(loadEquipmentStoreState(seedRef.current, undefined, cloudOwnerId));
          }
        } else {
          docExistsRef.current = true;
          if (!dirtyRef.current && snapshot.stateJson !== lastSyncedJsonRef.current) {
            lastSyncedJsonRef.current = snapshot.stateJson;
            setStore(snapshot.state);
            writeEquipmentStoreState(snapshot.state, undefined, cloudOwnerId);
          }
        }
        setStatus('synced');
      },
      (message) => {
        setSyncError(message);
        setStatus('error');
      }
    );
    return () => {
      unsubscribe();
      clearRetryTimer();
    };
  }, [cloudOwnerId]);

  // Local persistence and change detection follow the store only; status changes never write.
  useEffect(() => {
    storeRef.current = store;
    writeEquipmentStoreState(store, undefined, ownerRef.current);
    evaluate();
  }, [store]);

  // The first server answer (or recovery from a load error) is the moment a brand-new account's
  // seed gets saved.
  useEffect(() => {
    if (status === 'synced') evaluate();
  }, [status]);

  /** Manual retry after a failed save: clears the backoff and tries right away. */
  const retrySync = () => {
    clearRetryTimer();
    attemptRef.current = 0;
    evaluate();
  };

  return { store, setStore, status, syncError, retrySync };
}
