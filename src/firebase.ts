import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Blueprint validation constants & defensive sanitizers
export const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : `id_${Date.now()}`;
}

export function clampString(val: string, maxLength: number, fallback = 'N/A'): string {
  const trimmed = val.trim();
  if (!trimmed) return fallback.slice(0, maxLength);
  return trimmed.slice(0, maxLength);
}

export function clampNumber(val: number, min: number, max: number): number {
  if (Number.isNaN(val) || !Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

export async function signInWithGooglePopup() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser() {
  return signOut(auth);
}

export async function safeSetDoc(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  isCreate = true
) {
  const validDocId = sanitizeId(docId);
  const path = `${collectionName}/${validDocId}`;
  try {
    await setDoc(doc(db, collectionName, validDocId), {
      ...data,
      ...(isCreate ? { createdAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, isCreate ? OperationType.CREATE : OperationType.WRITE, path);
  }
}

export async function safeUpdateDoc(
  collectionName: string,
  docId: string,
  updates: Record<string, unknown>
) {
  const validDocId = sanitizeId(docId);
  const path = `${collectionName}/${validDocId}`;
  try {
    await updateDoc(doc(db, collectionName, validDocId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function safeDeleteDoc(collectionName: string, docId: string) {
  const validDocId = sanitizeId(docId);
  const path = `${collectionName}/${validDocId}`;
  try {
    await deleteDoc(doc(db, collectionName, validDocId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export type BatchWriteOperation =
  | {
      type: 'set';
      collectionName: string;
      docId: string;
      data: Record<string, unknown>;
      isCreate?: boolean;
    }
  | {
      type: 'update';
      collectionName: string;
      docId: string;
      updates: Record<string, unknown>;
    }
  | {
      type: 'delete';
      collectionName: string;
      docId: string;
    };

const MAX_OPS_PER_BATCH = 450;

export async function safeBatchWrite(operations: BatchWriteOperation[]) {
  if (operations.length === 0) return;

  for (let i = 0; i < operations.length; i += MAX_OPS_PER_BATCH) {
    const chunk = operations.slice(i, i + MAX_OPS_PER_BATCH);
    const batch = writeBatch(db);
    const firstOp = chunk[0];
    const summaryPath = `${firstOp.collectionName}/${sanitizeId(firstOp.docId)} (+${chunk.length - 1} ops)`;

    try {
      for (const op of chunk) {
        const validDocId = sanitizeId(op.docId);
        const ref = doc(db, op.collectionName, validDocId);
        if (op.type === 'set') {
          const isCreate = op.isCreate ?? true;
          batch.set(ref, {
            ...op.data,
            ...(isCreate ? { createdAt: serverTimestamp() } : {}),
            updatedAt: serverTimestamp(),
          });
        } else if (op.type === 'update') {
          batch.update(ref, {
            ...op.updates,
            updatedAt: serverTimestamp(),
          });
        } else if (op.type === 'delete') {
          batch.delete(ref);
        }
      }
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, summaryPath);
    }
  }
}

