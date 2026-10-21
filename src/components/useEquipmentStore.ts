import { useEffect, useRef, useState } from 'react';
import {
  EMPTY_EQUIPMENT_STORE,
  type EquipmentStoreState,
  loadEquipmentStoreState,
  writeEquipmentStoreState,
} from '../utils/equipmentStorage';
import { saveCloudLocker, serializeForCloud, subscribeCloudLocker } from '../utils/equipmentCloud';

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
  const pendingJsonRef = useRef<string | null>(null);
  const seedRef = useRef(seed);

  useEffect(() => {
    lastSyncedJsonRef.current = null;
    docExistsRef.current = false;
    pendingJsonRef.current = null;
    setSyncError('');

    if (!cloudOwnerId) {
      setStore(loadEquipmentStoreState(seedRef.current, undefined, null));
      setStatus('device');
      return;
    }

    setStore(loadEquipmentStoreState(seedRef.current, undefined, cloudOwnerId));
    setStatus('loading');
    return subscribeCloudLocker(
      cloudOwnerId,
      (snapshot) => {
        // Our own writes echo back; while one is in flight the local state is newer.
        if (savingRef.current) return;
        if (snapshot.status === 'unreadable') {
          setSyncError('Saved gear in your account could not be read, so editing is paused.');
          setStatus('error');
          return;
        }
        if (snapshot.status === 'missing') {
          docExistsRef.current = false;
          setStore(loadEquipmentStoreState(seedRef.current, undefined, cloudOwnerId));
        } else {
          docExistsRef.current = true;
          if (snapshot.stateJson !== lastSyncedJsonRef.current) {
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
  }, [cloudOwnerId]);

  useEffect(() => {
    writeEquipmentStoreState(store, undefined, cloudOwnerId);
    if (!cloudOwnerId) {
      return;
    }
    if (status === 'loading' || status === 'error') return;

    const json = serializeForCloud(store);
    if (json === null) {
      setSyncError('Gear history is too large to save to your account. Clear old logs to continue syncing.');
      return;
    }
    if (json === lastSyncedJsonRef.current) return;
    lastSyncedJsonRef.current = json;

    if (savingRef.current) {
      pendingJsonRef.current = json;
      return;
    }

    // Writes are chained rather than debounced, so leaving the tab never drops a change.
    const ownerId = cloudOwnerId;
    const run = async (nextJson: string): Promise<void> => {
      try {
        await saveCloudLocker(ownerId, nextJson, !docExistsRef.current);
        docExistsRef.current = true;
        setSyncError('');
      } catch {
        lastSyncedJsonRef.current = null;
        setSyncError('Your latest gear change was not saved to your account. It will retry on the next change.');
      }
      const pending = pendingJsonRef.current;
      pendingJsonRef.current = null;
      if (pending) return run(pending);
      savingRef.current = false;
      setStatus('synced');
    };
    savingRef.current = true;
    setStatus('saving');
    void run(json);
  }, [cloudOwnerId, store, status]);

  return { store, setStore, status, syncError };
}
