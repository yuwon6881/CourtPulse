import type { PlayerBenefitWallet, Session, SessionRsvp } from '../types';
import { getSessionStartTimestampMs, splitPartyShareForPass } from './badmintonLogic';

/**
 * What a player's club wallet will do to their share once the host finalizes the split. This
 * mirrors the order applyWalletToSingleRsvp uses (waiver, then one free pass, then credit) so
 * the screen can say so BEFORE the money is settled. Nothing here writes anything.
 */
export type WalletCoverageKind =
  | 'none'
  | 'waiver'
  | 'pass'
  /** A pass covers the player's seat but a guest's share is still payable. */
  | 'pass_guest'
  | 'credit_full'
  | 'credit_partial';

export interface WalletCoverage {
  kind: WalletCoverageKind;
  /** The share before any benefit. */
  gross: number;
  /** What the player still owes after the benefit. */
  youPay: number;
  creditUsed: number;
  /** Credit exists but earlier sessions get first call on it, so no amount can be promised. */
  creditShared: boolean;
  /** The guests' part of the share, which a pass never covers. */
  guestShare: number;
}

export function previewWalletCoverage(input: {
  gross: number;
  wallet: PlayerBenefitWallet;
  /** The player's other open sessions in this club that start earlier and are billed first. */
  earlierQueued?: number;
  guestCount?: number;
}): WalletCoverage {
  const gross = Math.max(0, Number((Number(input.gross) || 0).toFixed(2)));
  const earlier = Math.max(0, Math.floor(input.earlierQueued ?? 0));
  const passes = Math.max(0, Math.floor(input.wallet.freeSessionPasses || 0));
  const credit = Math.max(0, Number((input.wallet.creditBalance || 0).toFixed(2)));
  const none = (creditShared = false): WalletCoverage => ({
    kind: 'none',
    gross,
    youPay: gross,
    creditUsed: 0,
    creditShared,
    guestShare: 0,
  });

  if (input.wallet.waiveAllFees) {
    return {
      kind: 'waiver',
      gross,
      youPay: 0,
      creditUsed: 0,
      creditShared: false,
      guestShare: 0,
    };
  }
  if (gross <= 0) return none();

  // Each earlier session takes one pass first; any beyond the pass count draw on credit.
  // A pass covers the player's own seat only; guests' share stays payable (credit may meet it).
  const passCovers = passes - earlier > 0;
  const guestShare = passCovers
    ? splitPartyShareForPass(gross, input.guestCount ?? 0).guestShare
    : 0;
  const payable = passCovers ? guestShare : gross;
  if (passCovers && payable <= 0) {
    return { kind: 'pass', gross, youPay: 0, creditUsed: 0, creditShared: false, guestShare: 0 };
  }
  if (credit <= 0) {
    return passCovers
      ? { kind: 'pass_guest', gross, youPay: payable, creditUsed: 0, creditShared: false, guestShare }
      : none();
  }
  if (!passCovers && earlier - passes > 0) return none(true);

  if (credit >= payable) {
    return {
      kind: passCovers ? 'pass' : 'credit_full',
      gross,
      youPay: 0,
      creditUsed: payable,
      creditShared: false,
      guestShare,
    };
  }
  return {
    kind: passCovers ? 'pass_guest' : 'credit_partial',
    gross,
    youPay: Number((payable - credit).toFixed(2)),
    creditUsed: credit,
    creditShared: false,
    guestShare,
  };
}

/**
 * The player's other open sessions in the same club that are billed before this one.
 * Open = not finalized yet and the player is on the hook (going, or a late cancel with a fee).
 * Order is by start time, which is the order a host normally finalizes in.
 */
export function listEarlierQueuedSessions(input: {
  session: Session;
  sessions: Session[];
  rsvps: SessionRsvp[];
  playerId: string;
  timeZone?: string;
}): Session[] {
  const { session, sessions, rsvps, playerId, timeZone } = input;
  const startOf = (s: Session) => getSessionStartTimestampMs(s, timeZone);
  const thisStart = startOf(session);
  if (thisStart === null) return [];
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const earlier = new Map<string, { session: Session; start: number }>();
  for (const r of rsvps) {
    if (r.playerId !== playerId || r.sessionId === session.id) continue;
    const chargeable =
      r.status === 'going' || (r.status === 'late_out' && r.penaltyPercentApplied > 0);
    if (!chargeable) continue;
    const other = sessionById.get(r.sessionId);
    if (!other || other.clubId !== session.clubId || other.feeSplitFinalized) continue;
    const otherStart = startOf(other);
    if (otherStart !== null && otherStart < thisStart) {
      earlier.set(other.id, { session: other, start: otherStart });
    }
  }
  return [...earlier.values()].sort((a, b) => a.start - b.start).map((e) => e.session);
}

export function countEarlierQueuedSessions(input: {
  session: Session;
  sessions: Session[];
  rsvps: SessionRsvp[];
  playerId: string;
  timeZone?: string;
}): number {
  return listEarlierQueuedSessions(input).length;
}

/**
 * Stored paidMethod labels such as "Credit ($12.50)" were written with a hard-coded dollar
 * sign. The stored text must not change (it is parsed back), but it is shown in the club's own
 * currency.
 */
export function describeWalletPaidMethod(
  paidMethod: string,
  formatMoney: (amount: number) => string
): string {
  const full = /^Credit \(\$(\d+(?:\.\d+)?)\)$/.exec(paidMethod || '');
  if (full) return `Credit used (${formatMoney(Number(full[1]))})`;
  const partial = /^Credit -\$(\d+(?:\.\d+)?)$/.exec(paidMethod || '');
  if (partial) return `${formatMoney(Number(partial[1]))} credit applied`;
  return paidMethod;
}
