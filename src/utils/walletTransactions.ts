/**
 * Firestore transactions for the RSVP wallet ledger.
 *
 * Every transaction touches exactly ONE rsvp + ONE wallet document (plus an optional
 * read-only session check), so the rules' document-access budget stays tiny
 * (canManageClub needs at most admins/{uid}, clubs/{id}, players/{ownerPlayerId}: 3 lookups,
 * cached per transaction; the 20-lookup limit is never close).
 *
 * The pure apply function runs on what the transaction READ from the server, never on
 * React state, so two devices (or a stale local map) can neither lose credit nor spend a
 * free pass twice. runTransaction may re-run the callback; it is therefore side-effect free.
 */
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { PlayerBenefitWallet, SessionRsvp } from '../types';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  applyWalletUpdate,
  buildRsvpLedgerUpdate,
  clampMoney,
  EMPTY_WALLET,
  friendlyWriteError,
  normalizeWallet,
  rsvpFromDocData,
  walletDocIdFor,
  walletsEqual,
  type PairComputation,
  type WalletUpdate,
} from './walletLedger';

export interface RsvpWalletPairTask {
  rsvpId: string;
  clubId: string;
  playerId: string;
  /** Runs on the server-read rows; return null to skip the pair. */
  compute: (serverRsvp: SessionRsvp, serverWallet: PlayerBenefitWallet) => PairComputation | null;
  /** When set, the pair is skipped unless this session is still finalized on the server. */
  requireFinalizedSessionId?: string;
}

export type PairOutcome =
  | { status: 'updated'; rsvp: SessionRsvp; wallet: PlayerBenefitWallet }
  | { status: 'unchanged' | 'skipped' | 'missing' };

async function runWalletPairTransaction(
  task: RsvpWalletPairTask,
  uid: string
): Promise<PairOutcome> {
  const rsvpRef = doc(db, 'rsvps', task.rsvpId);
  const walletId = walletDocIdFor(task.clubId, task.playerId);
  const walletRef = doc(db, 'clubWallets', walletId);
  const sessionRef = task.requireFinalizedSessionId
    ? doc(db, 'sessions', task.requireFinalizedSessionId)
    : null;

  return runTransaction(db, async (tx): Promise<PairOutcome> => {
    // All reads first (Firestore requirement), then all writes
    const rsvpSnap = await tx.get(rsvpRef);
    const walletSnap = await tx.get(walletRef);
    const sessionSnap = sessionRef ? await tx.get(sessionRef) : null;

    if (!rsvpSnap.exists()) return { status: 'missing' };
    if (sessionSnap && (!sessionSnap.exists() || sessionSnap.data()?.feeSplitFinalized !== true)) {
      return { status: 'skipped' };
    }

    const serverRsvp = rsvpFromDocData(rsvpSnap.id, rsvpSnap.data() as Record<string, unknown>);
    const serverWallet = walletSnap.exists()
      ? normalizeWallet(walletSnap.data() as Partial<PlayerBenefitWallet>)
      : EMPTY_WALLET;

    const result = task.compute(serverRsvp, serverWallet);
    if (!result) return { status: 'skipped' };
    if (!result.rsvpChanged && !result.walletChanged) return { status: 'unchanged' };

    if (result.rsvpChanged) {
      tx.update(rsvpRef, {
        ...buildRsvpLedgerUpdate(result.rsvp),
        updatedAt: serverTimestamp(),
      });
    }
    if (result.walletChanged) {
      const walletFields = {
        creditBalance: clampMoney(result.wallet.creditBalance),
        freeSessionPasses: result.wallet.freeSessionPasses,
        waiveAllFees: result.wallet.waiveAllFees,
      };
      if (walletSnap.exists()) {
        // clubId / playerId / ownerId / createdAt stay untouched (the rules pin them)
        tx.update(walletRef, { ...walletFields, updatedAt: serverTimestamp() });
      } else {
        tx.set(walletRef, {
          clubId: task.clubId,
          playerId: task.playerId,
          ...walletFields,
          ownerId: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    return { status: 'updated', rsvp: result.rsvp, wallet: result.wallet };
  });
}

export interface PairBatchResult {
  total: number;
  failed: { rsvpId: string; message: string }[];
  outcomes: Map<string, PairOutcome>;
}

/**
 * Runs the pair tasks one transaction each, a few at a time (different players = different
 * documents, so they cannot conflict). Never throws: failures are returned so the caller
 * can roll back and tell the user, and re-running the same tasks converges (idempotent).
 */
export async function runRsvpWalletPairs(
  tasks: RsvpWalletPairTask[],
  uid: string,
  concurrency = 4
): Promise<PairBatchResult> {
  const result: PairBatchResult = { total: tasks.length, failed: [], outcomes: new Map() };
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      try {
        result.outcomes.set(task.rsvpId, await runWalletPairTransaction(task, uid));
      } catch (error) {
        let message = friendlyWriteError(error);
        // A refusal raised by our own compute() (no Firestore error code) already explains
        // itself; only real Firestore failures are logged and turned into friendly text.
        const hasFirestoreCode =
          typeof error === 'object' && error !== null && 'code' in error;
        if (hasFirestoreCode) {
          try {
            handleFirestoreError(error, OperationType.WRITE, `rsvps/${task.rsvpId}`);
          } catch (logged) {
            message = friendlyWriteError(logged);
          }
        }
        result.failed.push({ rsvpId: task.rsvpId, message });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker)
  );
  return result;
}

/**
 * Owner/admin wallet edit: reads the wallet inside the transaction and applies the delta /
 * clamp to the SERVER value. Returns the wallet as written.
 */
export async function updateClubWalletTransactional(params: {
  clubId: string;
  playerId: string;
  uid: string;
  update: WalletUpdate;
}): Promise<PlayerBenefitWallet> {
  const { clubId, playerId, uid, update } = params;
  const walletRef = doc(db, 'clubWallets', walletDocIdFor(clubId, playerId));
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(walletRef);
      const serverWallet = snap.exists()
        ? normalizeWallet(snap.data() as Partial<PlayerBenefitWallet>)
        : EMPTY_WALLET;
      const next = applyWalletUpdate(serverWallet, update);
      if (snap.exists()) {
        if (!walletsEqual(serverWallet, next)) {
          tx.update(walletRef, {
            creditBalance: next.creditBalance,
            freeSessionPasses: next.freeSessionPasses,
            waiveAllFees: next.waiveAllFees,
            updatedAt: serverTimestamp(),
          });
        }
      } else if (!walletsEqual(serverWallet, next)) {
        tx.set(walletRef, {
          clubId,
          playerId,
          creditBalance: next.creditBalance,
          freeSessionPasses: next.freeSessionPasses,
          waiveAllFees: next.waiveAllFees,
          ownerId: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      return next;
    });
  } catch (error) {
    return handleFirestoreError(error, OperationType.WRITE, `clubWallets/${walletRef.id}`);
  }
}
