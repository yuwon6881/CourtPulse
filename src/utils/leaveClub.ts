import type { Session, SessionRsvp } from '../types';
import { getRsvpAdjustment } from './badmintonLogic.ts';

/**
 * Why a member cannot leave a club on their own yet, or null when they can. Covers money and
 * roster spots that would be stranded: once they leave they can no longer see the club's
 * sessions, so nothing they still owe (or are owed) could be settled from their side.
 *
 * `withdrawableRsvpIds` are the open RSVPs that are deleted together with the membership, so
 * they never block. Unpaid / pending-approval shares are checked separately by the caller.
 */
export function findLeaveClubBlocker(params: {
  playerId: string;
  clubId: string;
  rsvps: SessionRsvp[];
  sessions: Session[];
  withdrawableRsvpIds: ReadonlySet<string>;
  formatMoney: (amount: number) => string;
}): string | null {
  const { playerId, clubId, rsvps, sessions, withdrawableRsvpIds, formatMoney } = params;
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const mine = rsvps.filter((r) => r.playerId === playerId && r.clubId === clubId);

  // Still on the roster of a session that has not been settled: a booking past the free-cancel
  // window, a late cancel, a game in play or one the host has not finalized yet.
  const stillOnRoster = mine.filter(
    (r) =>
      (r.status === 'going' || r.status === 'late_out') &&
      !withdrawableRsvpIds.has(r.id) &&
      sessionById.get(r.sessionId) !== undefined &&
      !sessionById.get(r.sessionId)!.feeSplitFinalized
  );
  if (stillOnRoster.length > 0) {
    const titles = stillOnRoster
      .map((r) => sessionById.get(r.sessionId)?.title)
      .filter((t): t is string => Boolean(t));
    const named =
      titles.length > 0 ? `"${titles.slice(0, 2).join('", "')}"` : 'an unsettled session';
    const more = titles.length > 2 ? ` and ${titles.length - 2} more` : '';
    return `You are still on the roster for ${named}${more}, and it is too late to withdraw for free. Leave the club once the fees for ${
      stillOnRoster.length === 1 ? 'it are' : 'them are'
    } settled, or ask the club owner to remove you from the roster.`;
  }

  // A share recalculated after it was paid leaves money owed either way (extra due, or a refund);
  // it is not an "unpaid" debt, so the fee check does not see it.
  for (const r of mine) {
    const adjustment = getRsvpAdjustment(r);
    if (adjustment.kind === null) continue;
    const title = sessionById.get(r.sessionId)?.title ?? 'a session';
    return adjustment.kind === 'due'
      ? `Your share for "${title}" changed after you paid, and ${formatMoney(adjustment.amount)} more is due. Settle it with the club owner before leaving.`
      : `The club owner still owes you a ${formatMoney(adjustment.amount)} refund for "${title}". Ask them to settle it before you leave.`;
  }
  return null;
}
