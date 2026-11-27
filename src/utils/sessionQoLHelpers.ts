import type {
  BadmintonMatch,
  Club,
  ClubPaymentDetails,
  MatchFormat,
  RankedPlayer,
  Session,
  SessionRsvp,
} from '../types';
import {
  formatMatchSideLabel,
  getRsvpGuestCount,
  getSessionDateDisplay,
  getSessionEndTimestampMs,
  getSessionGoingHeadcount,
  getSessionStartTimestampMs,
} from './badmintonLogic';
import { resolveClubTimeZone } from './clubTime';
import {
  computeSessionCollectionSummary,
  pickBalancedMatchLineup,
  type MatchSlots,
} from './sessionFlowHelpers';

export interface SessionProximityBadge {
  kind: 'live' | 'soon' | 'today' | 'tomorrow' | 'upcoming';
  label: string;
}

const clubCalendarCache = new Map<string, Intl.DateTimeFormat>();

function getClubCalendarFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = clubCalendarCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    clubCalendarCache.set(timeZone, fmt);
  }
  return fmt;
}

function getClubYmd(ms: number, timeZone: string): { year: number; month: number; day: number } | null {
  if (!Number.isFinite(ms)) return null;
  const parts = getClubCalendarFormatter(timeZone).formatToParts(new Date(ms));
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

function parseIsoYmd(dateIso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((dateIso || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Computes an honest, club-timezone-pinned proximity pill for an open or live session.
 * Returns null for completed sessions, ended sessions, unreadable schedules, or sessions
 * more than 7 days away.
 */
export function getSessionProximityBadge(
  session: Pick<Session, 'bookingStatus' | 'sessionDate' | 'startTime' | 'endTime' | 'startsAt'>,
  nowMs: number = Date.now(),
  timeZone?: string
): SessionProximityBadge | null {
  if (session.bookingStatus === 'completed') return null;
  const zone = resolveClubTimeZone(timeZone);
  const startMs = getSessionStartTimestampMs(session, zone);
  const endMs = getSessionEndTimestampMs(session, zone);
  if (startMs === null || endMs === null) return null;
  if (nowMs >= endMs) return null;

  if (nowMs >= startMs) {
    return { kind: 'live', label: 'In Play' };
  }

  const diffMs = startMs - nowMs;
  if (diffMs <= 60 * 60 * 1000) {
    const mins = Math.max(1, Math.ceil(diffMs / 60_000));
    return {
      kind: 'soon',
      label: mins <= 1 ? 'Starting now' : `In ${mins}m`,
    };
  }

  const nowYmd = getClubYmd(nowMs, zone);
  const sessYmd = getClubYmd(startMs, zone) ?? parseIsoYmd(session.sessionDate);
  if (!nowYmd || !sessYmd) return null;

  const nowUtcDay = Date.UTC(nowYmd.year, nowYmd.month - 1, nowYmd.day);
  const sessUtcDay = Date.UTC(sessYmd.year, sessYmd.month - 1, sessYmd.day);
  const dayDiff = Math.round((sessUtcDay - nowUtcDay) / 86_400_000);

  if (dayDiff === 0) {
    const hours = Math.floor(diffMs / 3_600_000);
    const mins = Math.floor((diffMs % 3_600_000) / 60_000);
    const label =
      hours > 0
        ? mins >= 15
          ? `Today · in ${hours}h ${mins}m`
          : `Today · in ${hours}h`
        : `Today · in ${Math.max(1, mins)}m`;
    return { kind: 'today', label };
  }

  if (dayDiff === 1) {
    return { kind: 'tomorrow', label: 'Tomorrow' };
  }

  if (dayDiff >= 2 && dayDiff <= 7) {
    return { kind: 'upcoming', label: `In ${dayDiff} days` };
  }

  return null;
}

export interface UpcomingFilterContext {
  query: string;
  joinedOnly: boolean;
  spotsOpenOnly: boolean;
  activePlayerId: string | null;
  rsvpsBySessionId: Map<string, SessionRsvp[]>;
  clubById: Map<string, Club>;
  fallbackClub: Club;
}

export function filterUpcomingSessions(
  futureSessions: Session[],
  ctx: UpcomingFilterContext
): Session[] {
  const q = ctx.query.trim().toLowerCase();
  return futureSessions.filter((session) => {
    const sessionRsvps = ctx.rsvpsBySessionId.get(session.id) || [];
    if (ctx.joinedOnly) {
      if (!ctx.activePlayerId) return false;
      const myRsvp = sessionRsvps.find((r) => r.playerId === ctx.activePlayerId);
      if (myRsvp?.status !== 'going') return false;
    }

    if (ctx.spotsOpenOnly) {
      const headcount = getSessionGoingHeadcount(sessionRsvps);
      if (session.maxPlayers - headcount <= 0) return false;
    }

    if (q) {
      const club = ctx.clubById.get(session.clubId) || ctx.fallbackClub;
      const dateDisplay = getSessionDateDisplay(session.sessionDate);
      const hay = `${session.title} ${session.venue} ${session.courtNumbers} ${club.name} ${session.sessionDate} ${dateDisplay.fullLabel}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}

export function filterSessionRosterRows(
  rows: SessionRsvp[],
  query: string
): SessionRsvp[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.playerName.toLowerCase().includes(q));
}

export interface BuildSettlementSnippetParams {
  club: Club;
  session: Session;
  rsvps: SessionRsvp[];
  paymentDetails: ClubPaymentDetails;
  shareUrl?: string;
  formatCurrency: (amount: number) => string;
}

/**
 * Formats a concise, organizer-only WhatsApp/Telegram settlement reminder for a finalized session.
 * Excludes owner-exempt rows and hides zero-share settled rows from the unpaid reminder list.
 */
export function buildSessionSettlementSnippet(
  params: BuildSettlementSnippetParams
): string {
  const { club, session, rsvps, paymentDetails, shareUrl, formatCurrency } = params;
  const dateDisplay = getSessionDateDisplay(session.sessionDate);
  const summary = computeSessionCollectionSummary(session, rsvps, club);
  const totalPool = Number((session.courtFee + session.shuttleFee).toFixed(2));

  const chargeable = rsvps.filter((r) => {
    if (r.status !== 'going' && !(r.status === 'late_out' && r.penaltyPercentApplied > 0)) {
      return false;
    }
    const isOwner = Boolean(club.clubOwnerPlayerId) && r.playerId === club.clubOwnerPlayerId;
    const isOwnerExcluded =
      isOwner && Boolean(club.excludeOwnerFromBilling) && getRsvpGuestCount(r) === 0;
    return !isOwnerExcluded;
  });

  const formatRowLine = (r: SessionRsvp): string => {
    const guests = getRsvpGuestCount(r);
    const tags: string[] = [];
    if (guests > 0) tags.push(`+${guests} ${guests === 1 ? 'guest' : 'guests'}`);
    if (r.status === 'late_out') tags.push('Late Out');
    else if (r.attendanceOutcome === 'no_show') tags.push('No-Show');
    const suffix = tags.length > 0 ? ` (${tags.join(', ')})` : '';
    return `- ${r.playerName}${suffix}: ${formatCurrency(r.feeShare)}`;
  };

  const unpaidRows = chargeable.filter((r) => r.paidStatus === 'unpaid' && r.feeShare > 0);
  const pendingRows = chargeable.filter(
    (r) => r.paidStatus === 'pending_approval' && r.feeShare > 0
  );

  const lines: string[] = [
    `[${club.name}] ${session.title} — Final Split`,
    `${dateDisplay.fullLabel} · ${session.startTime}–${session.endTime}`,
    `${session.venue}${session.courtNumbers ? ` (${session.courtNumbers})` : ''}`,
    `Total Pool: ${formatCurrency(totalPool)} (Court ${formatCurrency(session.courtFee)} + ${session.shuttlesUsed} shuttles ${formatCurrency(session.shuttleFee)})`,
    `Settled: ${summary.paidCount}/${summary.totalBillable}${
      summary.unpaidAmount > 0 ? ` · ${formatCurrency(summary.unpaidAmount)} remaining` : ''
    }`,
  ];

  if (unpaidRows.length > 0) {
    lines.push('', `Payment Due (${unpaidRows.length}):`);
    for (const r of unpaidRows) {
      lines.push(formatRowLine(r));
    }
  }

  if (pendingRows.length > 0) {
    lines.push('', `Awaiting Verification (${pendingRows.length}):`);
    for (const r of pendingRows) {
      lines.push(formatRowLine(r));
    }
  }

  if (unpaidRows.length === 0 && pendingRows.length === 0) {
    lines.push('', 'All participant shares are settled.');
  } else {
    const payMethods: string[] = [];
    if (paymentDetails.phoneNumber?.trim()) {
      payMethods.push(`PayNow/Mobile: ${paymentDetails.phoneNumber.trim()}`);
    }
    if (paymentDetails.bankAccountNumber?.trim()) {
      const bankPrefix = paymentDetails.bankName?.trim()
        ? `${paymentDetails.bankName.trim()} `
        : '';
      payMethods.push(`Bank: ${bankPrefix}${paymentDetails.bankAccountNumber.trim()}`);
    }
    lines.push(
      '',
      `Pay to: ${paymentDetails.recipientName || club.clubOwnerName || 'Club Owner'}${
        payMethods.length > 0 ? ` · ${payMethods.join(' | ')}` : ''
      }`
    );
    if (paymentDetails.paymentNotes?.trim()) {
      lines.push(`Note: ${paymentDetails.paymentNotes.trim()}`);
    }
  }

  if (shareUrl) {
    lines.push('', `View Session & Mark Paid:`, shareUrl);
  }

  return lines.join('\n');
}

export interface SessionPlayerRecord {
  playerId: string;
  name: string;
  wins: number;
  losses: number;
  games: number;
  pointDiff: number;
}

/**
 * Computes per-player wins, losses, games played, and point differential within one session.
 */
export function computeSessionPlayerRecords(
  sessionMatches: BadmintonMatch[],
  participants: Pick<RankedPlayer, 'id' | 'name'>[]
): SessionPlayerRecord[] {
  const map = new Map<string, SessionPlayerRecord>();
  for (const p of participants) {
    map.set(p.id, {
      playerId: p.id,
      name: p.name,
      wins: 0,
      losses: 0,
      games: 0,
      pointDiff: 0,
    });
  }

  const recordPlayer = (
    id: string,
    fallbackName: string,
    won: boolean,
    diff: number
  ) => {
    if (!id || id === 'NONE') return;
    let entry = map.get(id);
    if (!entry) {
      entry = {
        playerId: id,
        name: fallbackName,
        wins: 0,
        losses: 0,
        games: 0,
        pointDiff: 0,
      };
      map.set(id, entry);
    }
    entry.games += 1;
    if (won) entry.wins += 1;
    else entry.losses += 1;
    entry.pointDiff += diff;
  };

  for (const m of sessionMatches) {
    const aWon = m.winnerSide === 'A';
    const diffA = m.scoreTeamA - m.scoreTeamB;
    recordPlayer(m.teamAPlayer1Id, m.teamAPlayer1Name, aWon, diffA);
    if (m.matchFormat === 'doubles') {
      recordPlayer(m.teamAPlayer2Id, m.teamAPlayer2Name, aWon, diffA);
    }
    recordPlayer(m.teamBPlayer1Id, m.teamBPlayer1Name, !aWon, -diffA);
    if (m.matchFormat === 'doubles') {
      recordPlayer(m.teamBPlayer2Id, m.teamBPlayer2Name, !aWon, -diffA);
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if ((b.games > 0) !== (a.games > 0)) return b.games > 0 ? 1 : -1;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    if (a.games !== b.games) return a.games - b.games;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Keeps the winning side from `lastMatch` on Side A (when available in `players`) and rotates
 * in the least-played waiting players on Side B so rotation stays fair across the session.
 */
export function pickRotateNextLineup(
  players: RankedPlayer[],
  matchCounts: Map<string, number>,
  lastMatch: BadmintonMatch | null | undefined,
  format: MatchFormat
): MatchSlots | null {
  const needed = format === 'doubles' ? 4 : 2;
  if (players.length < needed) return null;
  if (!lastMatch) {
    return pickBalancedMatchLineup(players, matchCounts, format);
  }

  const availableById = new Map(players.map((p) => [p.id, p]));
  const lastWinners = (
    lastMatch.winnerSide === 'A'
      ? [lastMatch.teamAPlayer1Id, lastMatch.teamAPlayer2Id]
      : [lastMatch.teamBPlayer1Id, lastMatch.teamBPlayer2Id]
  ).filter((id): id is string => Boolean(id && id !== 'NONE' && availableById.has(id)));

  const neededKeepers = format === 'doubles' ? 2 : 1;
  if (lastWinners.length < neededKeepers) {
    return pickBalancedMatchLineup(players, matchCounts, format);
  }

  const keepers = lastWinners.slice(0, neededKeepers);
  const keeperSet = new Set(keepers);
  const lastMatchIds = new Set(
    [
      lastMatch.teamAPlayer1Id,
      lastMatch.teamAPlayer2Id,
      lastMatch.teamBPlayer1Id,
      lastMatch.teamBPlayer2Id,
    ].filter((id) => Boolean(id && id !== 'NONE'))
  );

  // Prefer players who sat out the last match, then fewest total matches today
  const challengers = players
    .filter((p) => !keeperSet.has(p.id))
    .sort((a, b) => {
      const aWasInLast = lastMatchIds.has(a.id) ? 1 : 0;
      const bWasInLast = lastMatchIds.has(b.id) ? 1 : 0;
      if (aWasInLast !== bWasInLast) return aWasInLast - bWasInLast;
      const countDiff = (matchCounts.get(a.id) || 0) - (matchCounts.get(b.id) || 0);
      if (countDiff !== 0) return countDiff;
      return b.ratingScore - a.ratingScore;
    });

  if (challengers.length < neededKeepers) {
    return pickBalancedMatchLineup(players, matchCounts, format);
  }

  if (format === 'singles') {
    return {
      teamA1Id: keepers[0],
      teamA2Id: '',
      teamB1Id: challengers[0].id,
      teamB2Id: '',
    };
  }

  return {
    teamA1Id: keepers[0],
    teamA2Id: keepers[1],
    teamB1Id: challengers[0].id,
    teamB2Id: challengers[1].id,
  };
}

/**
 * Formats recorded session matches into a shareable group chat scoreboard summary.
 */
export function buildSessionMatchResultsSnippet(params: {
  club: Club;
  session: Session;
  matches: BadmintonMatch[];
}): string {
  const { club, session, matches } = params;
  const dateDisplay = getSessionDateDisplay(session.sessionDate);
  const ordered = [...matches].reverse(); // oldest match (#1) to newest (#N)

  const lines: string[] = [
    `[${club.name}] ${session.title} — Match Results (${matches.length})`,
    `${dateDisplay.fullLabel} · ${session.venue}`,
    '',
  ];

  ordered.forEach((m, idx) => {
    const sideA = formatMatchSideLabel(m, 'A');
    const sideB = formatMatchSideLabel(m, 'B');
    const formatTag = m.matchFormat === 'doubles' ? 'Doubles' : 'Singles';
    if (m.winnerSide === 'A') {
      lines.push(`#${idx + 1} (${formatTag}) ${sideA} def. ${sideB} · ${m.scoreTeamA}–${m.scoreTeamB}`);
    } else {
      lines.push(`#${idx + 1} (${formatTag}) ${sideB} def. ${sideA} · ${m.scoreTeamB}–${m.scoreTeamA}`);
    }
  });

  return lines.join('\n');
}
