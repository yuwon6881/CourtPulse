/**
 * Firestore transactions for the RSVP wallet ledger, bound to the app's database.
 *
 * The transaction logic itself lives in `walletTransactionsCore.ts` (parameterised on the
 * Firestore instance so it can be raced against the emulator in `tests/concurrency`); this
 * module only supplies the app's `db` and its error reporting.
 */
import type { PlayerBenefitWallet } from '../types';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { friendlyWriteError, walletDocIdFor, type WalletUpdate } from './walletLedger';
import {
  runRsvpWalletPairsOn,
  updateClubWalletOn,
  type PairBatchResult,
  type RsvpWalletPairTask,
} from './walletTransactionsCore';

export type { PairBatchResult, PairOutcome, RsvpWalletPairTask } from './walletTransactionsCore';

const reportFirestoreFailure = (error: unknown, path: string): string | undefined => {
  try {
    handleFirestoreError(error, OperationType.WRITE, path);
  } catch (logged) {
    return friendlyWriteError(logged);
  }
  return undefined;
};

/**
 * Runs the pair tasks one transaction each, a few at a time. Never throws: failures are
 * returned so the caller can roll back and tell the user.
 */
export function runRsvpWalletPairs(
  tasks: RsvpWalletPairTask[],
  uid: string,
  concurrency = 4
): Promise<PairBatchResult> {
  return runRsvpWalletPairsOn(db, tasks, uid, concurrency, reportFirestoreFailure);
}

/** Owner/admin wallet edit applied to the SERVER value. Returns the wallet as written. */
export async function updateClubWalletTransactional(params: {
  clubId: string;
  playerId: string;
  uid: string;
  update: WalletUpdate;
}): Promise<PlayerBenefitWallet> {
  try {
    return await updateClubWalletOn(db, params);
  } catch (error) {
    return handleFirestoreError(
      error,
      OperationType.WRITE,
      `clubWallets/${walletDocIdFor(params.clubId, params.playerId)}`
    );
  }
}
