import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getDoc,
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

// Local development / testing against the Firebase Emulator Suite:
// VITE_USE_FIREBASE_EMULATORS=true npm run dev
if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

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

export async function signInWithEmailPassword(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function registerWithEmailPassword(
  displayName: string,
  email: string,
  password: string
) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(cred.user, { displayName: displayName.trim() });
  await sendEmailVerification(cred.user);
  return cred.user;
}

export async function resendVerificationEmail() {
  if (auth.currentUser) {
    await sendEmailVerification(auth.currentUser);
  }
}

export async function sendPasswordReset(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

/** Reloads the current user so a freshly clicked verification link takes effect. */
export async function refreshCurrentUser() {
  if (!auth.currentUser) return null;
  await auth.currentUser.reload();
  // Force a new ID token so Firestore rules see email_verified == true
  await auth.currentUser.getIdToken(true);
  return auth.currentUser;
}

/** Turns Firebase Auth error codes into messages players can act on. */
export function describeAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/missing-password':
      return 'Enter your password.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password':
      return 'Choose a stronger password (at least 8 characters).';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled for CourtPulse yet.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    default:
      return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  }
}

/** True when the signed-in account is listed in /admins (the rules also accept the bootstrap admin emails). */
export async function fetchIsAdminAccount(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists();
  } catch {
    return false;
  }
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

