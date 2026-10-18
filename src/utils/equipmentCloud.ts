import { doc, onSnapshot } from 'firebase/firestore';
import {
  OperationType,
  db,
  handleFirestoreError,
  safeSetDoc,
  safeUpdateDoc,
} from '../firebase';
import {
  EQUIPMENT_STORE_VERSION,
  type EquipmentStoreState,
  parseEquipmentStoreState,
  serializeEquipmentStoreState,
} from './equipmentStorage';

const COLLECTION = 'gearLockers';
// Firestore caps documents at 1 MiB; the security rules allow 800 KB of state.
const MAX_STATE_JSON_LENGTH = 800_000;

export type CloudLockerSnapshot =
  | { status: 'missing' }
  | { status: 'ready'; state: EquipmentStoreState; stateJson: string }
  | { status: 'unreadable' };

/**
 * Watches the signed-in account's locker document. Each account owns exactly one document,
 * keyed by its uid, matching the ownerId scoping of every other CourtPulse collection.
 */
export function subscribeCloudLocker(
  ownerId: string,
  onChange: (snapshot: CloudLockerSnapshot) => void,
  onError: (message: string) => void
): () => void {
  return onSnapshot(
    doc(db, COLLECTION, ownerId),
    (snap) => {
      if (!snap.exists()) {
        onChange({ status: 'missing' });
        return;
      }
      const stateJson = snap.get('stateJson');
      const state = parseEquipmentStoreState(typeof stateJson === 'string' ? stateJson : null);
      onChange(
        state && typeof stateJson === 'string'
          ? { status: 'ready', state, stateJson }
          : { status: 'unreadable' }
      );
    },
    (err) => {
      onError('Gear could not be loaded from your account.');
      try {
        handleFirestoreError(err, OperationType.GET, `${COLLECTION}/${ownerId}`);
      } catch {
        // handleFirestoreError logs and rethrows; the caller already shows the message.
      }
    }
  );
}

/** Serializes state for the cloud document, compacting history if it would exceed the limit. */
export function serializeForCloud(state: EquipmentStoreState): string | null {
  const full = serializeEquipmentStoreState(state);
  if (full.length <= MAX_STATE_JSON_LENGTH) return full;
  const compact = serializeEquipmentStoreState(state, true);
  return compact.length <= MAX_STATE_JSON_LENGTH ? compact : null;
}

export async function saveCloudLocker(
  ownerId: string,
  stateJson: string,
  isCreate: boolean
): Promise<void> {
  const data = { stateJson, version: EQUIPMENT_STORE_VERSION };
  if (isCreate) {
    await safeSetDoc(COLLECTION, ownerId, { ...data, ownerId }, true);
  } else {
    await safeUpdateDoc(COLLECTION, ownerId, data);
  }
}
