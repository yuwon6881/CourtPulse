/**
 * Pure helpers for the per-RSVP wallet ledger. Nothing here touches Firebase, so the exact
 * same functions run inside a Firestore transaction (on SERVER-read documents) and in unit
 * tests (against an in-memory "server").
 */
import type { PlayerBenefitWallet, SessionRsvp } from '../types';
import {
  applyWalletToSingleRsvp,
  getRsvpWalletLedger,
  MAX_STORED_FEE_AMOUNT,
} from './badmintonLogic';

export const EMPTY_WALLET: PlayerBenefitWallet = {
  creditBalance: 0,
  freeSessionPasses: 0,
  waiveAllFees: false,
};

/** An owner/admin wallet edit. `*Delta` fields are applied to the server value. */
export type WalletUpdate = Partial<PlayerBenefitWallet> & {
  creditDelta?: number;
  passDelta?: number;
};

export type ActionResult = { ok: true } | { ok: false; reason: string };

export const GENERIC_SAVE_ERROR = 'Could not save. Refresh and try again.';

/** Turns any thrown value into a message safe to show: raw JSON error dumps become generic. */
export function friendlyWriteError(err: unknown): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const trimmed = message.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return GENERIC_SAVE_ERROR;
  }
  return trimmed;
}

export function clampMoney(value: number, max = MAX_STORED_FEE_AMOUNT): number {
  const num = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Number(Math.min(max, Math.max(0, num)).toFixed(2));
}

export function normalizeWallet(
  wallet: Partial<PlayerBenefitWallet> | null | undefined
): PlayerBenefitWallet {
  return {
    creditBalance: clampMoney(Number(wallet?.creditBalance) || 0),
    freeSessionPasses: Math.min(
      1000,
      Math.max(0, Math.floor(Number(wallet?.freeSessionPasses) || 0))
    ),
    waiveAllFees: Boolean(wallet?.waiveAllFees),
  };
}

export function walletsEqual(a: PlayerBenefitWallet, b: PlayerBenefitWallet): boolean {
  return (
    Math.abs(a.creditBalance - b.creditBalance) < 0.005 &&
    a.freeSessionPasses === b.freeSessionPasses &&
    a.waiveAllFees === b.waiveAllFees
  );
}

/** Wallet document id; mirrors firestore.rules (`wallet_<clubId>_<playerId>`). */
export function walletDocIdFor(clubId: string, playerId: string): string {
  return `wallet_${clubId}_${playerId}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
}

/** Applies an owner/admin edit to the wallet value read from the SERVER. */
export function applyWalletUpdate(
  serverWallet: PlayerBenefitWallet,
  update: WalletUpdate
): PlayerBenefitWallet {
  const base = normalizeWallet(serverWallet);
  let credit = base.creditBalance;
  if (update.creditBalance !== undefined) credit = Number(update.creditBalance) || 0;
  if (update.creditDelta !== undefined) credit += Number(update.creditDelta) || 0;
  let passes = base.freeSessionPasses;
  if (update.freeSessionPasses !== undefined) passes = Number(update.freeSessionPasses) || 0;
  if (update.passDelta !== undefined) passes += Number(update.passDelta) || 0;
  return normalizeWallet({
    creditBalance: credit,
    freeSessionPasses: passes,
    waiveAllFees:
      update.waiveAllFees !== undefined ? Boolean(update.waiveAllFees) : base.waiveAllFees,
  });
}

/** Normalises a raw Firestore rsvp document into the SessionRsvp shape. */
export function rsvpFromDocData(id: string, data: Record<string, unknown>): SessionRsvp {
  const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);
  return {
    id,
    clubId: str(data.clubId, ''),
    sessionId: str(data.sessionId, ''),
    playerId: str(data.playerId, ''),
    playerName: str(data.playerName, 'Player'),
    guestCount: num(data.guestCount),
    guestNames: typeof data.guestNames === 'string' ? data.guestNames : undefined,
    status: str(data.status, 'going') as SessionRsvp['status'],
    attendanceOutcome: str(data.attendanceOutcome, 'present') as SessionRsvp['attendanceOutcome'],
    penaltyPercentApplied: num(data.penaltyPercentApplied),
    feeShare: num(data.feeShare),
    grossFeeShare: typeof data.grossFeeShare === 'number' ? data.grossFeeShare : undefined,
    walletCreditApplied:
      typeof data.walletCreditApplied === 'number' ? data.walletCreditApplied : undefined,
    walletPassApplied:
      typeof data.walletPassApplied === 'boolean' ? data.walletPassApplied : undefined,
    walletWaiverApplied:
      typeof data.walletWaiverApplied === 'boolean' ? data.walletWaiverApplied : undefined,
    paidStatus: str(data.paidStatus, 'unpaid') as SessionRsvp['paidStatus'],
    paidMethod: str(data.paidMethod, 'pending'),
    ownerId: str(data.ownerId, ''),
  };
}

/**
 * The rsvp fields a manager write may change in a ledger transaction. Every value is
 * clamped to the rules' caps so a bad number can never make the whole write fail.
 */
export function buildRsvpLedgerUpdate(rsvp: SessionRsvp): Record<string, unknown> {
  const ledger = getRsvpWalletLedger(rsvp);
  return {
    attendanceOutcome: rsvp.attendanceOutcome,
    penaltyPercentApplied: Math.min(100, Math.max(0, Number(rsvp.penaltyPercentApplied) || 0)),
    feeShare: clampMoney(rsvp.feeShare),
    grossFeeShare: clampMoney(ledger.grossFeeShare),
    walletCreditApplied: clampMoney(ledger.walletCreditApplied),
    walletPassApplied: Boolean(ledger.walletPassApplied),
    walletWaiverApplied: Boolean(ledger.walletWaiverApplied),
    paidStatus: rsvp.paidStatus,
    paidMethod: String(rsvp.paidMethod || 'pending').slice(0, 40),
  };
}

export function rsvpLedgerChanged(before: SessionRsvp, after: SessionRsvp): boolean {
  const a = buildRsvpLedgerUpdate(before);
  const b = buildRsvpLedgerUpdate(after);
  return (Object.keys(b) as string[]).some((key) => a[key] !== b[key]);
}

/**
 * False only for rows that provably carry no money and cannot gain any share (out / zero
 * penalty late-out with an all-zero, unpaid ledger); they need no ledger transaction.
 */
export function rowNeedsLedgerWork(row: SessionRsvp): boolean {
  const ledger = getRsvpWalletLedger(row);
  if (
    row.feeShare > 0 ||
    ledger.grossFeeShare > 0 ||
    ledger.walletCreditApplied > 0 ||
    ledger.walletPassApplied ||
    ledger.walletWaiverApplied ||
    row.paidStatus !== 'unpaid'
  ) {
    return true;
  }
  return row.status === 'going' || (row.status === 'late_out' && row.penaltyPercentApplied > 0);
}

export interface PairComputation {
  rsvp: SessionRsvp;
  wallet: PlayerBenefitWallet;
  rsvpChanged: boolean;
  walletChanged: boolean;
}

/**
 * One RSVP + wallet pair, computed on the documents as the SERVER holds them.
 * `mutate` lets the caller edit the server row first (e.g. the attendance change).
 */
export function computeRsvpWalletPair(input: {
  serverRsvp: SessionRsvp;
  serverWallet: PlayerBenefitWallet;
  mutate?: (rsvp: SessionRsvp) => SessionRsvp;
  /** When omitted the row's own recorded gross share is kept (wallet top-up path). */
  grossFeeShare?: number;
  penaltyPercentApplied?: number;
  finalizeSplit: boolean;
  clubOwnerPlayerId?: string;
  excludeOwnerFromBilling?: boolean;
}): PairComputation {
  const baseRsvp = input.mutate ? input.mutate(input.serverRsvp) : input.serverRsvp;
  const wallet = normalizeWallet(input.serverWallet);
  const { updatedRsvp, updatedWallet } = applyWalletToSingleRsvp({
    rsvp: baseRsvp,
    grossFeeShare:
      input.grossFeeShare !== undefined
        ? input.grossFeeShare
        : getRsvpWalletLedger(baseRsvp).grossFeeShare,
    penaltyPercentApplied:
      input.penaltyPercentApplied !== undefined
        ? input.penaltyPercentApplied
        : baseRsvp.penaltyPercentApplied,
    wallet,
    finalizeSplit: input.finalizeSplit,
    clubOwnerPlayerId: input.clubOwnerPlayerId,
    excludeOwnerFromBilling: input.excludeOwnerFromBilling,
  });
  const nextWallet = normalizeWallet(updatedWallet);
  return {
    rsvp: updatedRsvp,
    wallet: nextWallet,
    rsvpChanged: rsvpLedgerChanged(input.serverRsvp, updatedRsvp),
    walletChanged: !walletsEqual(wallet, nextWallet),
  };
}
