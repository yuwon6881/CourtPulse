import {
  BadmintonMatch,
  BookingStatus,
  CloneSessionOverrides,
  Club,
  MatchFormat,
  ParsedQuickSession,
  PaymentTiming,
  PermissionTier,
  RankedPlayer,
  Session,
  SessionRsvp,
} from '../types';
import {
  getRsvpGuestCount,
  getSessionDateDisplay,
  getSessionEndTimestampMs,
  isSessionCompletedOrPast,
} from './badmintonLogic';
import { normalizePaymentTiming } from './paymentTiming';
import { resolveClubTimeZone } from './clubTime';

export interface SessionCollectionSummary {
  totalBillable: number;
  paidCount: number;
  pendingCount: number;
  unpaidCount: number;
  pendingRsvpIds: string[];
  unpaidAmount: number;
  collectionPercent: number;
  isAllSettled: boolean;
}

/**
 * Summarizes payment settlement progress for a session's chargeable roster.
 * Mirrors TapRsvpPortal billing rules (excludes club owner when excludeOwnerFromBilling
 * is enabled and they brought 0 guests).
 */
export function computeSessionCollectionSummary(
  session: Session,
  sessionRsvps: SessionRsvp[],
  club?: Pick<Club, 'clubOwnerPlayerId' | 'excludeOwnerFromBilling'> | null
): SessionCollectionSummary {
  const chargeable = sessionRsvps.filter((r) => {
    if (r.status !== 'going' && !(r.status === 'late_out' && r.penaltyPercentApplied > 0)) {
      return false;
    }
    const isOwnerRow =
      Boolean(club?.clubOwnerPlayerId) && r.playerId === club?.clubOwnerPlayerId;
    const isOwnerExcluded =
      isOwnerRow &&
      Boolean(club?.excludeOwnerFromBilling) &&
      getRsvpGuestCount(r) === 0;
    return !isOwnerExcluded;
  });

  if (!session.feeSplitFinalized) {
    return {
      totalBillable: chargeable.length,
      paidCount: 0,
      pendingCount: 0,
      unpaidCount: 0,
      pendingRsvpIds: [],
      unpaidAmount: 0,
      collectionPercent: 0,
      isAllSettled: false,
    };
  }

  let paidCount = 0;
  let pendingCount = 0;
  let unpaidCount = 0;
  let unpaidAmount = 0;
  const pendingRsvpIds: string[] = [];

  for (const r of chargeable) {
    if (r.paidStatus === 'paid' || r.feeShare <= 0) {
      paidCount += 1;
    } else if (r.paidStatus === 'pending_approval') {
      pendingCount += 1;
      pendingRsvpIds.push(r.id);
      unpaidAmount += r.feeShare;
    } else {
      unpaidCount += 1;
      unpaidAmount += r.feeShare;
    }
  }

  const totalBillable = chargeable.length;
  const collectionPercent =
    totalBillable === 0 ? 100 : Math.round((paidCount / totalBillable) * 100);

  return {
    totalBillable,
    paidCount,
    pendingCount,
    unpaidCount,
    pendingRsvpIds,
    unpaidAmount: Number(unpaidAmount.toFixed(2)),
    collectionPercent,
    isAllSettled: totalBillable > 0 && pendingCount === 0 && unpaidCount === 0,
  };
}

/**
 * Builds a concise bank/PayNow transfer reference string (<= 32 chars)
 * so club owners can match incoming transfers instantly.
 */
export function buildPaymentReference(
  playerName: string,
  contextLabel?: string
): string {
  const cleanName = playerName.trim().replace(/\s+/g, ' ');
  const cleanContext = (contextLabel || '').trim().replace(/\s+/g, ' ');
  if (!cleanName && !cleanContext) return 'CourtPulse';
  if (!cleanContext) return cleanName.slice(0, 32);
  const combined = `${cleanName} - ${cleanContext}`;
  if (combined.length <= 32) return combined;
  const firstWord = cleanName.split(' ')[0] || cleanName;
  const compact = `${firstWord} - ${cleanContext}`;
  return compact.slice(0, 32).trim();
}

export function buildSessionPaymentReference(
  playerName: string,
  session: Pick<Session, 'sessionDate' | 'title'>
): string {
  const dateInfo = getSessionDateDisplay(session.sessionDate);
  const shortDate =
    dateInfo.monthShort && dateInfo.dayNum
      ? `${dateInfo.monthShort} ${dateInfo.dayNum}`
      : session.sessionDate;
  return buildPaymentReference(playerName, shortDate);
}

/**
 * Counts how many matches each player has played in a given session.
 */
export function computeSessionMatchCounts(
  sessionMatches: BadmintonMatch[]
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id?: string | null) => {
    if (!id) return;
    counts.set(id, (counts.get(id) || 0) + 1);
  };
  for (const m of sessionMatches) {
    bump(m.teamAPlayer1Id);
    bump(m.teamAPlayer2Id);
    bump(m.teamBPlayer1Id);
    bump(m.teamBPlayer2Id);
  }
  return counts;
}

export interface MatchSlots {
  teamA1Id: string;
  teamA2Id: string;
  teamB1Id: string;
  teamB2Id: string;
}

export type MatchSlotKey = keyof MatchSlots;

/**
 * Assigns a player to a match slot. If that player already occupies another active slot,
 * swaps the two slots instead of creating an invalid duplicate lineup.
 */
export function assignPlayerToMatchSlot(
  slots: MatchSlots,
  targetSlot: MatchSlotKey,
  nextPlayerId: string,
  format: MatchFormat
): MatchSlots {
  const activeKeys: MatchSlotKey[] =
    format === 'doubles'
      ? ['teamA1Id', 'teamA2Id', 'teamB1Id', 'teamB2Id']
      : ['teamA1Id', 'teamB1Id'];

  const updated: MatchSlots = { ...slots };
  const previousAtTarget = slots[targetSlot];

  const existingSlot = activeKeys.find(
    (k) => k !== targetSlot && slots[k] === nextPlayerId
  );

  updated[targetSlot] = nextPlayerId;
  if (existingSlot && previousAtTarget) {
    updated[existingSlot] = previousAtTarget;
  }

  return updated;
}

/**
 * Picks a fair lineup for the next court game:
 * 1) Prioritizes players with the fewest matches played in this session.
 * 2) For doubles, chooses the pairing of those 4 players with the smallest
 *    rating-sum difference between Side A and Side B.
 */
export function pickBalancedMatchLineup(
  players: RankedPlayer[],
  matchCounts: Map<string, number>,
  format: MatchFormat
): MatchSlots | null {
  const needed = format === 'doubles' ? 4 : 2;
  if (players.length < needed) return null;

  const sorted = [...players].sort((a, b) => {
    const countDiff = (matchCounts.get(a.id) || 0) - (matchCounts.get(b.id) || 0);
    if (countDiff !== 0) return countDiff;
    return b.ratingScore - a.ratingScore;
  });

  const picked = sorted.slice(0, needed);

  if (format === 'singles') {
    return {
      teamA1Id: picked[0].id,
      teamA2Id: '',
      teamB1Id: picked[1].id,
      teamB2Id: '',
    };
  }

  const [p0, p1, p2, p3] = picked;
  const pairings: Array<[RankedPlayer, RankedPlayer, RankedPlayer, RankedPlayer]> = [
    [p0, p3, p1, p2],
    [p0, p2, p1, p3],
    [p0, p1, p2, p3],
  ];

  let best = pairings[0];
  let bestDiff = Infinity;
  for (const candidate of pairings) {
    const diff = Math.abs(
      candidate[0].ratingScore +
        candidate[1].ratingScore -
        (candidate[2].ratingScore + candidate[3].ratingScore)
    );
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }

  return {
    teamA1Id: best[0].id,
    teamA2Id: best[1].id,
    teamB1Id: best[2].id,
    teamB2Id: best[3].id,
  };
}

/**
 * Computes an "HH:MM" end time by adding durationMinutes to startTime,
 * clamped to 23:30 so the StyledTimePicker stays on the same calendar day.
 */
export function computeEndTimeFromDuration(
  startTime: string,
  durationMinutes: number
): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (!match) return startTime;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return startTime;
  const total = Math.min(23 * 60 + 30, Math.max(0, h * 60 + m + durationMinutes));
  const outH = Math.floor(total / 60);
  const outM = total % 60;
  return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;
}

/**
 * Returns session duration in minutes between startTime and endTime ("HH:MM"),
 * or null if invalid / non-positive.
 */
export function getDurationMinutes(startTime: string, endTime: string): number | null {
  const sm = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  const em = /^(\d{1,2}):(\d{2})$/.exec(endTime.trim());
  if (!sm || !em) return null;
  const s = parseInt(sm[1], 10) * 60 + parseInt(sm[2], 10);
  const e = parseInt(em[1], 10) * 60 + parseInt(em[2], 10);
  return e > s ? e - s : null;
}

export type HistoryFilterMode = 'all' | 'played' | 'needs_action' | 'finalized';

export interface HistoryFilterContext {
  query: string;
  filter: HistoryFilterMode;
  activePlayerId: string | null;
  rsvpsBySessionId: Map<string, SessionRsvp[]>;
  clubById: Map<string, Club>;
  canManageClub: (club: Club) => boolean;
  fallbackClub: Club;
}

export function doesPastSessionNeedAction(
  session: Session,
  ctx: Pick<
    HistoryFilterContext,
    'activePlayerId' | 'rsvpsBySessionId' | 'clubById' | 'canManageClub' | 'fallbackClub'
  >
): boolean {
  const club = ctx.clubById.get(session.clubId) || ctx.fallbackClub;
  const sessionRsvps = ctx.rsvpsBySessionId.get(session.id) || [];
  const isManager = ctx.canManageClub(club);

  if (isManager) {
    if (!session.feeSplitFinalized) return true;
    const summary = computeSessionCollectionSummary(session, sessionRsvps, club);
    return summary.pendingCount > 0 || summary.unpaidCount > 0;
  }

  if (!ctx.activePlayerId || !session.feeSplitFinalized) return false;
  const myRsvp = sessionRsvps.find((r) => r.playerId === ctx.activePlayerId);
  if (!myRsvp) return false;
  return (
    myRsvp.feeShare > 0 &&
    (myRsvp.paidStatus === 'unpaid' || myRsvp.paidStatus === 'pending_approval')
  );
}

export function filterPastSessions(
  pastSessions: Session[],
  ctx: HistoryFilterContext
): Session[] {
  const q = ctx.query.trim().toLowerCase();
  return pastSessions.filter((session) => {
    const club = ctx.clubById.get(session.clubId) || ctx.fallbackClub;
    const sessionRsvps = ctx.rsvpsBySessionId.get(session.id) || [];

    if (q) {
      const dateDisplay = getSessionDateDisplay(session.sessionDate);
      const hay = `${session.title} ${session.venue} ${session.courtNumbers} ${club.name} ${session.sessionDate} ${dateDisplay.fullLabel}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (ctx.filter === 'played') {
      if (!ctx.activePlayerId) return false;
      const myRsvp = sessionRsvps.find((r) => r.playerId === ctx.activePlayerId);
      return myRsvp?.status === 'going' || myRsvp?.status === 'late_out';
    }

    if (ctx.filter === 'needs_action') {
      return doesPastSessionNeedAction(session, ctx);
    }

    if (ctx.filter === 'finalized') {
      return session.feeSplitFinalized;
    }

    return true;
  });
}

/**
 * Returns past sessions belonging to clubs owned by `activePlayerId` whose time has
 * already passed (`isSessionCompletedOrPast`) and whose fee split is not yet finalized.
 * Sorted most recently ended first.
 */
export function getOwnerPastUnfinalizedSessions(params: {
  sessions: Session[];
  clubs: Club[];
  activePlayerId: string | null;
  permissionTier: PermissionTier;
  nowMs?: number;
}): Session[] {
  const { sessions, clubs, activePlayerId, permissionTier } = params;
  const nowMs = params.nowMs ?? Date.now();
  if (!activePlayerId || permissionTier === 'user') return [];

  const ownedClubById = new Map<string, Club>();
  for (const club of clubs) {
    const ownerId = club.clubOwnerPlayerId || club.ownerPlayerId || '';
    if (ownerId && ownerId === activePlayerId) {
      ownedClubById.set(club.id, club);
    }
  }
  if (ownedClubById.size === 0) return [];

  return sessions
    .filter((session) => {
      if (session.feeSplitFinalized) return false;
      const club = ownedClubById.get(session.clubId);
      if (!club) return false;
      const zone = resolveClubTimeZone(club.timezone);
      return isSessionCompletedOrPast(session, nowMs, zone);
    })
    .sort((a, b) => {
      const zoneA = resolveClubTimeZone(ownedClubById.get(a.clubId)?.timezone);
      const zoneB = resolveClubTimeZone(ownedClubById.get(b.clubId)?.timezone);
      const endA = getSessionEndTimestampMs(a, zoneA);
      const endB = getSessionEndTimestampMs(b, zoneB);
      if (endA !== null && endB !== null && endA !== endB) return endB - endA;
      return b.sessionDate.localeCompare(a.sessionDate);
    });
}

/**
 * Completed or past sessions in history can only be removed by a Site Admin.
 * Upcoming unfinalized sessions can still be deleted by their club manager (owner or admin).
 */
export function canDeleteSessionWithPermission(params: {
  session: Pick<
    Session,
    'bookingStatus' | 'feeSplitFinalized' | 'sessionDate' | 'startTime' | 'endTime'
  >;
  permissionTier: PermissionTier;
  canManageClub: boolean;
  clubTimeZone?: string;
  nowMs?: number;
}): boolean {
  const { session, permissionTier, canManageClub, clubTimeZone } = params;
  const nowMs = params.nowMs ?? Date.now();
  const isCompletedOrPast =
    session.bookingStatus === 'completed' ||
    session.feeSplitFinalized ||
    isSessionCompletedOrPast(session, nowMs, resolveClubTimeZone(clubTimeZone));
  if (isCompletedOrPast) {
    return permissionTier === 'admin';
  }
  return canManageClub;
}

/**
 * Whether session match history logging and the Standings leaderboard are active for a club.
 * Older clubs without the field default to active (`true`).
 */
export function isClubMatchHistoryAndStandingsEnabled(
  club?: Pick<Club, 'enableMatchHistoryAndStandings'> | null
): boolean {
  return club?.enableMatchHistoryAndStandings !== false;
}

/**
 * Adds 7 calendar days to an ISO `YYYY-MM-DD` date in UTC so the device timezone
 * can never shift the calendar day. Returns null when the input date is unreadable.
 */
export function computeNextWeekDate(sessionDate: string): string | null {
  const dateParts = sessionDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateParts) return null;
  const year = Number(dateParts[1]);
  const month = Number(dateParts[2]);
  const day = Number(dateParts[3]);
  const next = new Date(Date.UTC(year, month - 1, day + 7));
  if (Number.isNaN(next.getTime())) return null;
  return next.toISOString().slice(0, 10);
}

/**
 * Builds initial form state for the "+7d" clone session modal, defaulting bookingStatus
 * to `pending` (not yet booked) and clearing courtNumbers so uncertain fields can be filled in.
 */
export function buildCloneSessionDraft(
  source: Session,
  fallbackDate: string = source.sessionDate
): ParsedQuickSession & { paymentTiming: PaymentTiming } {
  const nextDate = computeNextWeekDate(source.sessionDate) || fallbackDate;
  return {
    title: source.title,
    venue: source.venue,
    courtNumbers: '',
    sessionDate: nextDate,
    startTime: source.startTime,
    endTime: source.endTime,
    courtFee: source.courtFee,
    courtFeeFromText: true,
    maxPlayers: source.maxPlayers,
    bookingStatus: 'pending',
    paymentTiming: normalizePaymentTiming(source.paymentTiming),
  };
}

/**
 * Merges optional user overrides from the "+7d" clone modal onto the cloned session payload.
 * Returns null when neither the override nor source has a valid date.
 */
export function resolveClonedSessionInput(
  source: Session,
  overrides?: CloneSessionOverrides
): Omit<Session, 'id' | 'ownerId'> | null {
  const computedNextDate = computeNextWeekDate(source.sessionDate);
  const overrideDate = overrides?.sessionDate?.trim();
  const nextDate = overrideDate || computedNextDate;
  if (!nextDate) return null;

  const nextStatus: BookingStatus = overrides?.bookingStatus ?? 'pending';
  const rawCourts = overrides?.courtNumbers?.trim() || '';
  const courtNumbers =
    nextStatus === 'pending'
      ? 'TBD'
      : rawCourts || (source.courtNumbers && source.courtNumbers !== 'TBD' ? source.courtNumbers : 'Court 1');

  return {
    clubId: source.clubId,
    title: overrides?.title?.trim() || source.title,
    venue: overrides?.venue?.trim() || source.venue,
    courtNumbers,
    sessionDate: nextDate,
    startTime: overrides?.startTime?.trim() || source.startTime,
    endTime: overrides?.endTime?.trim() || source.endTime,
    bookingStatus: nextStatus,
    courtFee:
      overrides?.courtFee !== undefined && Number.isFinite(overrides.courtFee)
        ? Math.max(0, overrides.courtFee)
        : source.courtFee,
    shuttlesUsed: 0,
    shuttleUnitCost: source.shuttleUnitCost || 3.0,
    shuttleFee: 0,
    maxPlayers:
      overrides?.maxPlayers !== undefined && Number.isFinite(overrides.maxPlayers)
        ? Math.max(2, Math.min(64, Math.round(overrides.maxPlayers)))
        : source.maxPlayers,
    organizerName: source.organizerName,
    paymentInfo: source.paymentInfo,
    feeSplitFinalized: false,
    paymentTiming: normalizePaymentTiming(
      overrides?.paymentTiming ?? source.paymentTiming
    ),
  };
}

