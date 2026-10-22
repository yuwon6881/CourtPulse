import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
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
import {
  friendlyAuthMessage,
  friendlyFirestoreMessage,
  getErrorCode,
} from './utils/friendlyErrors';

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
  // The message is for players: short and free of ids/emails. Diagnostics ride along on `info`.
  const friendly = new Error(friendlyFirestoreMessage(error)) as Error & {
    info?: FirestoreErrorInfo;
    code?: string;
  };
  friendly.info = errInfo;
  friendly.code = getErrorCode(error);
  throw friendly;
}

/** Friendly sentence for any caught error (Firestore, Auth, or plain Error). */
export function describeFirestoreFailure(error: unknown): string {
  if (getErrorCode(error)) return friendlyFirestoreMessage(error);
  if (
    error instanceof Error &&
    error.message &&
    !error.message.trim().startsWith('{') &&
    error.message.length <= 240
  ) {
    // Already a sentence written for players (from handleFirestoreError or our own guards).
    return error.message;
  }
  return friendlyFirestoreMessage(error);
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

/** Which credential the signed-in account can reauthenticate with. */
export function getReauthMethod(): 'password' | 'google' | 'unknown' {
  const providers = auth.currentUser?.providerData.map((p) => p.providerId) ?? [];
  if (providers.includes('password')) return 'password';
  if (providers.includes('google.com')) return 'google';
  return 'unknown';
}

/**
 * Proves the person at the keyboard owns the account (required by Firebase before deleting it).
 * Google accounts get a popup; email accounts must supply their password.
 */
export async function reauthenticateCurrentUser(password?: string): Promise<void> {
  const current = auth.currentUser;
  if (!current) throw Object.assign(new Error('Not signed in.'), { code: 'auth/user-not-found' });
  const method = getReauthMethod();
  if (method === 'google') {
    await reauthenticateWithPopup(current, googleProvider);
    return;
  }
  if (method === 'password') {
    if (!password) {
      throw Object.assign(new Error('Enter your password.'), { code: 'auth/missing-password' });
    }
    if (!current.email) {
      throw Object.assign(new Error('This account has no email address.'), {
        code: 'auth/invalid-email',
      });
    }
    await reauthenticateWithCredential(
      current,
      EmailAuthProvider.credential(current.email, password)
    );
    return;
  }
  throw new Error('This sign-in method cannot be confirmed here. Sign out, sign in again and retry.');
}

/** Deletes the Firebase Auth account itself (the last step of "delete my account"). */
export async function deleteCurrentAuthUser(): Promise<void> {
  if (auth.currentUser) await deleteUser(auth.currentUser);
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
  return friendlyAuthMessage(err);
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

/**
 * Rules may make at most 20 get()/exists() lookups per batch, and the rules for these
 * collections look up several documents per write, so they are committed a few at a time.
 */
const RULE_HEAVY_COLLECTIONS = new Set([
  'rsvps',
  'players',
  'matches',
  'clubWallets',
  'clubJoinRequests',
  'sessions',
]);
export const RULE_HEAVY_BATCH_SIZE = 4;

/**
 * Commits the operations in chunks, in order. Chunks are not atomic with each other: writes
 * that must succeed together belong in one chunk (pass chunkSize) or in a transaction.
 */
export async function safeBatchWrite(
  operations: BatchWriteOperation[],
  options: { chunkSize?: number } = {}
) {
  if (operations.length === 0) return;
  const ruleHeavy = operations.some((op) => RULE_HEAVY_COLLECTIONS.has(op.collectionName));
  const chunkSize = Math.max(
    1,
    Math.min(MAX_OPS_PER_BATCH, options.chunkSize ?? (ruleHeavy ? RULE_HEAVY_BATCH_SIZE : MAX_OPS_PER_BATCH))
  );

  for (let i = 0; i < operations.length; i += chunkSize) {
    const chunk = operations.slice(i, i + chunkSize);
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

