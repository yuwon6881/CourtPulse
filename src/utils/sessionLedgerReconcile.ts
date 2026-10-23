/**
 * Brings a session's RSVP rows back in line with the session's CURRENT finalized/open state.
 *
 * Finalizing and reopening both write the players' rows first (one transaction per row) and the
 * session flag last. When two hosts act on the same session at the same moment the writes can
 * interleave so the final flag belongs to one action and the rows to the other: a session that
 * says "finalized" with every row uncharged, or one that is open while rows still hold charges.
 * Wallets stay conserved either way (each row write is atomic) but the roster would be wrong.
 *
 * Each action calls this AFTER its own session write. The last session write decides the target
 * state, and every row write of either action finished before it, so the reconcile that runs after
 * the last session write always sees the final truth and repairs the rows to match it. The row
 * computations are idempotent, so reconciling an already consistent session changes nothing.
 */
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import {
  computeSessionSplitDetails,
  getRsvpWalletLedger,
  isCashOrPendingRsvp,
} from './badmintonLogic';
import { computeRsvpWalletPair, rowNeedsLedgerWork, rsvpFromDocData } from './walletLedger';
import type { PairBatchResult, RsvpWalletPairTask } from './walletTransactionsCore';
import type { SessionRsvp } from '../types';

export interface ReconcileClub {
  noShowFeePercent: number;
  clubOwnerPlayerId?: string;
  excludeOwnerFromBilling?: boolean;
}

export type ReconcileResult =
  | { ok: true; repaired: boolean }
  | { ok: false; reason: string };

const MAX_PASSES = 4;
const CENT = 0.005;

/** A row of an OPEN session must carry no wallet benefit and no share, unless it holds real money. */
export function rowIsStillBilledWhileOpen(row: SessionRsvp): boolean {
  if (isCashOrPendingRsvp(row)) return false;
  const ledger = getRsvpWalletLedger(row);
  return (
    ledger.grossFeeShare > CENT ||
    ledger.walletCreditApplied > CENT ||
    ledger.walletPassApplied ||
    ledger.walletWaiverApplied ||
    row.feeShare > CENT
  );
}

export async function reconcileSessionLedger(params: {
  database: Firestore;
  sessionId: string;
  clubId: string;
  club: ReconcileClub;
  runPairs: (tasks: RsvpWalletPairTask[]) => Promise<PairBatchResult>;
}): Promise<ReconcileResult> {
  const { database, sessionId, clubId, club, runPairs } = params;
  const ownerOpts = {
    clubOwnerPlayerId: club.clubOwnerPlayerId,
    excludeOwnerFromBilling: Boolean(club.excludeOwnerFromBilling),
  };
  let repaired = false;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let sessionSnap;
    let rowsSnap;
    try {
      sessionSnap = await getDocFromServer(doc(database, 'sessions', sessionId));
      rowsSnap = await getDocsFromServer(
        query(
          collection(database, 'rsvps'),
          where('clubId', '==', clubId),
          where('sessionId', '==', sessionId)
        )
      );
    } catch {
      return { ok: false, reason: 'Could not read the session back to check it.' };
    }
    if (!sessionSnap.exists()) return { ok: true, repaired };
    const session = sessionSnap.data() as Record<string, unknown>;
    const finalized = session.feeSplitFinalized === true;
    const rows = rowsSnap.docs.map((d) =>
      rsvpFromDocData(d.id, d.data() as Record<string, unknown>)
    );
    const rowById = new Map(rows.map((r) => [r.id, r]));

    let tasks: RsvpWalletPairTask[];
    if (finalized) {
      const split = computeSessionSplitDetails(
        Number(session.courtFee) || 0,
        Number(session.shuttleFee) || 0,
        rows,
        club.noShowFeePercent,
        ownerOpts
      );
      tasks = rows
        .filter((r) => {
          if (!rowNeedsLedgerWork(r)) return false;
          const want = split.splits.get(r.id)?.feeShare ?? 0;
          return Math.abs(getRsvpWalletLedger(r).grossFeeShare - want) > CENT;
        })
        .map((r) => ({
          rsvpId: r.id,
          clubId: r.clubId,
          playerId: r.playerId,
          compute: (serverRsvp, serverWallet) => {
            const read = rowById.get(r.id);
            // The row changed since it was read: skip it, the next pass reads it again
            if (
              read &&
              (serverRsvp.status !== read.status ||
                serverRsvp.attendanceOutcome !== read.attendanceOutcome ||
                (serverRsvp.guestCount ?? 0) !== (read.guestCount ?? 0))
            ) {
              return null;
            }
            const calc = split.splits.get(r.id) || { feeShare: 0, penaltyPercentApplied: 0 };
            return computeRsvpWalletPair({
              serverRsvp,
              serverWallet,
              grossFeeShare: calc.feeShare,
              penaltyPercentApplied: calc.penaltyPercentApplied,
              finalizeSplit: true,
              ...ownerOpts,
            });
          },
        }));
    } else {
      tasks = rows
        .filter((r) => rowIsStillBilledWhileOpen(r))
        .map((r) => ({
          rsvpId: r.id,
          clubId: r.clubId,
          playerId: r.playerId,
          compute: (serverRsvp, serverWallet) =>
            computeRsvpWalletPair({
              serverRsvp,
              serverWallet,
              grossFeeShare: 0,
              finalizeSplit: false,
              ...ownerOpts,
            }),
        }));
    }

    if (tasks.length === 0) return { ok: true, repaired };
    const batch = await runPairs(tasks);
    if (batch.failed.length > 0) {
      return { ok: false, reason: batch.failed[0].message };
    }
    repaired = true;
  }
  return { ok: false, reason: 'The fee split did not settle after several attempts.' };
}
