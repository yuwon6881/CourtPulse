import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignPlayerToMatchSlot,
  buildCloneSessionDraft,
  buildPaymentReference,
  buildSessionPaymentReference,
  canDeleteSessionWithPermission,
  computeEndTimeFromDuration,
  computeNextWeekDate,
  computeSessionCollectionSummary,
  computeSessionMatchCounts,
  filterPastSessions,
  getDurationMinutes,
  getOwnerPastUnfinalizedSessions,
  isClubMatchHistoryAndStandingsEnabled,
  pickBalancedMatchLineup,
  resolveClonedSessionInput,
} from './sessionFlowHelpers';
import type { BadmintonMatch, Club, RankedPlayer, Session, SessionRsvp } from '../types';

const baseClub: Club = {
  id: 'club-1',
  name: 'Bintang Prime',
  description: 'Test badminton club',
  visibility: 'public',
  clubOwnerPlayerId: 'owner-1',
  clubOwnerName: 'Alex Tan',
  excludeOwnerFromBilling: false,
  freeCancelHours: 24,
  lockCancelHours: 2,
  lateCancelFeePercent: 50,
  noShowFeePercent: 100,
  paymentInfo: 'PayNow',
  ownerId: 'uid-owner',
};

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  clubId: 'club-1',
  title: 'Evening Rotation',
  venue: 'Bintang Hall',
  courtNumbers: 'Court 1, Court 2',
  sessionDate: '2026-10-15',
  startTime: '20:00',
  endTime: '22:00',
  bookingStatus: 'completed',
  courtFee: 60,
  shuttlesUsed: 4,
  shuttleUnitCost: 3,
  shuttleFee: 12,
  maxPlayers: 8,
  organizerName: 'Alex Tan',
  paymentInfo: 'PayNow',
  feeSplitFinalized: true,
  ownerId: 'uid-owner',
  ...overrides,
});

const makeRsvp = (overrides: Partial<SessionRsvp>): SessionRsvp => ({
  id: 'rsvp-1',
  clubId: 'club-1',
  sessionId: 'sess-1',
  playerId: 'p1',
  playerName: 'Player 1',
  status: 'going',
  attendanceOutcome: 'present',
  penaltyPercentApplied: 100,
  feeShare: 18,
  paidStatus: 'unpaid',
  paidMethod: 'pending',
  ownerId: 'uid-1',
  ...overrides,
});

const makePlayer = (id: string, name: string, ratingScore: number): RankedPlayer => ({
  id,
  name,
  playerTag: `#${id}`,
  joinedClubIdsCsv: 'club-1',
  wins: 0,
  losses: 0,
  gamesPlayed: 0,
  pointsScored: 0,
  pointsConceded: 0,
  singlesWins: 0,
  singlesLosses: 0,
  doublesWins: 0,
  doublesLosses: 0,
  ratingScore,
  ownerId: `uid-${id}`,
  winRate: 0,
  pointDiff: 0,
  avgPointDiff: 0,
  pointsShare: 0,
  tier: 'B',
  tierTitle: 'Regular',
  rank: 1,
  recentForm: [],
});

describe('computeSessionCollectionSummary', () => {
  it('counts paid, pending, and unpaid rows accurately and respects owner exclusion', () => {
    const club = { ...baseClub, excludeOwnerFromBilling: true };
    const session = makeSession({ feeSplitFinalized: true });
    const rsvps: SessionRsvp[] = [
      makeRsvp({ id: 'r-owner', playerId: 'owner-1', feeShare: 0, paidStatus: 'paid' }),
      makeRsvp({ id: 'r1', playerId: 'p1', feeShare: 15, paidStatus: 'paid' }),
      makeRsvp({ id: 'r2', playerId: 'p2', feeShare: 15, paidStatus: 'pending_approval' }),
      makeRsvp({ id: 'r3', playerId: 'p3', feeShare: 15, paidStatus: 'unpaid' }),
      makeRsvp({ id: 'r4', playerId: 'p4', status: 'out', penaltyPercentApplied: 0, feeShare: 0 }),
    ];

    const summary = computeSessionCollectionSummary(session, rsvps, club);
    assert.equal(summary.totalBillable, 3);
    assert.equal(summary.paidCount, 1);
    assert.equal(summary.pendingCount, 1);
    assert.equal(summary.unpaidCount, 1);
    assert.deepEqual(summary.pendingRsvpIds, ['r2']);
    assert.equal(summary.unpaidAmount, 30);
    assert.equal(summary.collectionPercent, 33);
    assert.equal(summary.isAllSettled, false);
  });

  it('returns unfinalized zeros when feeSplitFinalized is false', () => {
    const session = makeSession({ feeSplitFinalized: false });
    const rsvps = [makeRsvp({ id: 'r1', playerId: 'p1', feeShare: 0, paidStatus: 'unpaid' })];
    const summary = computeSessionCollectionSummary(session, rsvps, baseClub);
    assert.equal(summary.totalBillable, 1);
    assert.equal(summary.paidCount, 0);
    assert.equal(summary.unpaidCount, 0);
    assert.equal(summary.isAllSettled, false);
  });
});

describe('buildPaymentReference & buildSessionPaymentReference', () => {
  it('formats short clean references within 32 characters', () => {
    assert.equal(buildPaymentReference('Kevin Lee', 'Oct 8'), 'Kevin Lee - Oct 8');
    const longRef = buildPaymentReference('Alexander Maximilian Tan', 'Bintang Prime Club');
    assert.ok(longRef.length <= 32);
    assert.ok(longRef.startsWith('Alexander'));

    const sessRef = buildSessionPaymentReference('Kevin Lee', makeSession({ sessionDate: '2026-10-08' }));
    assert.equal(sessRef, 'Kevin Lee - Oct 08');
  });
});

describe('assignPlayerToMatchSlot', () => {
  it('auto-swaps players when picking someone already in another active slot', () => {
    const slots = {
      teamA1Id: 'p1',
      teamA2Id: 'p2',
      teamB1Id: 'p3',
      teamB2Id: 'p4',
    };
    const next = assignPlayerToMatchSlot(slots, 'teamA1Id', 'p3', 'doubles');
    assert.deepEqual(next, {
      teamA1Id: 'p3',
      teamA2Id: 'p2',
      teamB1Id: 'p1',
      teamB2Id: 'p4',
    });
  });

  it('only swaps active slots in singles mode', () => {
    const slots = {
      teamA1Id: 'p1',
      teamA2Id: 'p2',
      teamB1Id: 'p3',
      teamB2Id: 'p4',
    };
    const next = assignPlayerToMatchSlot(slots, 'teamA1Id', 'p3', 'singles');
    assert.equal(next.teamA1Id, 'p3');
    assert.equal(next.teamB1Id, 'p1');
  });
});

describe('pickBalancedMatchLineup & computeSessionMatchCounts', () => {
  it('prioritizes least-played players and balances doubles team ratings', () => {
    const players = [
      makePlayer('p1', 'Top', 1500),
      makePlayer('p2', 'High', 1400),
      makePlayer('p3', 'Mid', 1200),
      makePlayer('p4', 'Low', 1100),
      makePlayer('p5', 'Busy', 1600),
    ];

    const matches: BadmintonMatch[] = [
      {
        id: 'm1',
        clubId: 'club-1',
        sessionId: 'sess-1',
        matchFormat: 'singles',
        teamAPlayer1Id: 'p5',
        teamAPlayer1Name: 'Busy',
        teamAPlayer2Id: '',
        teamAPlayer2Name: '',
        teamBPlayer1Id: 'p1',
        teamBPlayer1Name: 'Top',
        teamBPlayer2Id: '',
        teamBPlayer2Name: '',
        scoreTeamA: 21,
        scoreTeamB: 15,
        setScoresText: '21-15',
        winnerSide: 'A',
        ownerId: 'uid-owner',
      },
      {
        id: 'm2',
        clubId: 'club-1',
        sessionId: 'sess-1',
        matchFormat: 'singles',
        teamAPlayer1Id: 'p5',
        teamAPlayer1Name: 'Busy',
        teamAPlayer2Id: '',
        teamAPlayer2Name: '',
        teamBPlayer1Id: 'p2',
        teamBPlayer1Name: 'High',
        teamBPlayer2Id: '',
        teamBPlayer2Name: '',
        scoreTeamA: 21,
        scoreTeamB: 18,
        setScoresText: '21-18',
        winnerSide: 'A',
        ownerId: 'uid-owner',
      },
    ];

    const counts = computeSessionMatchCounts(matches);
    assert.equal(counts.get('p5'), 2);
    assert.equal(counts.get('p1'), 1);
    assert.equal(counts.get('p3'), undefined);

    const lineup = pickBalancedMatchLineup(players, counts, 'doubles');
    assert.ok(lineup);
    const chosenIds = new Set([
      lineup.teamA1Id,
      lineup.teamA2Id,
      lineup.teamB1Id,
      lineup.teamB2Id,
    ]);
    // p5 played 2 games and should sit out
    assert.equal(chosenIds.has('p5'), false);
    assert.equal(chosenIds.size, 4);

    // Best balanced pairing for [1500, 1400, 1200, 1100] is (1500+1100=2600) vs (1400+1200=2600)
    const ratingOf = (id: string) => players.find((p) => p.id === id)!.ratingScore;
    const sumA = ratingOf(lineup.teamA1Id) + ratingOf(lineup.teamA2Id);
    const sumB = ratingOf(lineup.teamB1Id) + ratingOf(lineup.teamB2Id);
    assert.equal(Math.abs(sumA - sumB), 0);
  });
});

describe('duration helpers', () => {
  it('computes end time cleanly and caps at 23:30', () => {
    assert.equal(computeEndTimeFromDuration('19:00', 120), '21:00');
    assert.equal(computeEndTimeFromDuration('19:30', 90), '21:00');
    assert.equal(computeEndTimeFromDuration('22:00', 180), '23:30');
    assert.equal(getDurationMinutes('18:00', '20:00'), 120);
    assert.equal(getDurationMinutes('20:00', '19:00'), null);
  });
});

describe('filterPastSessions', () => {
  it('filters by query and needs_action for admin vs member', () => {
    const sUnfinalized = makeSession({ id: 's1', title: 'Sat Sparring', feeSplitFinalized: false });
    const sUnpaid = makeSession({ id: 's2', title: 'Thu Rotation', feeSplitFinalized: true });
    const sSettled = makeSession({ id: 's3', title: 'Sun Doubles', feeSplitFinalized: true });

    const rsvpsBySessionId = new Map<string, SessionRsvp[]>([
      ['s1', [makeRsvp({ id: 'r1', sessionId: 's1', playerId: 'p1', feeShare: 0, paidStatus: 'unpaid' })]],
      ['s2', [makeRsvp({ id: 'r2', sessionId: 's2', playerId: 'p1', feeShare: 14, paidStatus: 'unpaid' })]],
      ['s3', [makeRsvp({ id: 'r3', sessionId: 's3', playerId: 'p1', feeShare: 14, paidStatus: 'paid' })]],
    ]);
    const clubById = new Map<string, Club>([[baseClub.id, baseClub]]);

    // Admin sees both unfinalized and unpaid finalized under needs_action
    const adminAction = filterPastSessions([sUnfinalized, sUnpaid, sSettled], {
      query: '',
      filter: 'needs_action',
      activePlayerId: 'owner-1',
      rsvpsBySessionId,
      clubById,
      canManageClub: () => true,
      fallbackClub: baseClub,
    });
    assert.deepEqual(adminAction.map((s) => s.id), ['s1', 's2']);

    // Normal member sees only their unpaid finalized bill under needs_action
    const memberAction = filterPastSessions([sUnfinalized, sUnpaid, sSettled], {
      query: '',
      filter: 'needs_action',
      activePlayerId: 'p1',
      rsvpsBySessionId,
      clubById,
      canManageClub: () => false,
      fallbackClub: baseClub,
    });
    assert.deepEqual(memberAction.map((s) => s.id), ['s2']);

    // Search query matches title
    const searchRes = filterPastSessions([sUnfinalized, sUnpaid, sSettled], {
      query: 'sparring',
      filter: 'all',
      activePlayerId: 'p1',
      rsvpsBySessionId,
      clubById,
      canManageClub: () => false,
      fallbackClub: baseClub,
    });
    assert.deepEqual(searchRes.map((s) => s.id), ['s1']);
  });
});

describe('getOwnerPastUnfinalizedSessions', () => {
  const clubOwned: Club = {
    ...baseClub,
    id: 'club-owned',
    clubOwnerPlayerId: 'owner-1',
    timezone: 'Asia/Singapore',
  };
  const clubOther: Club = {
    ...baseClub,
    id: 'club-other',
    clubOwnerPlayerId: 'owner-2',
    timezone: 'Asia/Singapore',
  };

  // Reference instant: 2026-10-16 12:00 Asia/Singapore (UTC+8)
  const nowMs = Date.parse('2026-10-16T04:00:00Z');

  const pastUnfinalizedOlder = makeSession({
    id: 'past-older',
    clubId: 'club-owned',
    sessionDate: '2026-10-10',
    startTime: '18:00',
    endTime: '20:00',
    bookingStatus: 'booked',
    feeSplitFinalized: false,
  });
  const pastUnfinalizedNewer = makeSession({
    id: 'past-newer',
    clubId: 'club-owned',
    sessionDate: '2026-10-15',
    startTime: '18:00',
    endTime: '20:00',
    bookingStatus: 'booked',
    feeSplitFinalized: false,
  });
  const pastFinalized = makeSession({
    id: 'past-finalized',
    clubId: 'club-owned',
    sessionDate: '2026-10-14',
    startTime: '18:00',
    endTime: '20:00',
    bookingStatus: 'completed',
    feeSplitFinalized: true,
  });
  const upcomingUnfinalized = makeSession({
    id: 'future-open',
    clubId: 'club-owned',
    sessionDate: '2026-10-20',
    startTime: '18:00',
    endTime: '20:00',
    bookingStatus: 'booked',
    feeSplitFinalized: false,
  });
  const otherClubPastUnfinalized = makeSession({
    id: 'other-past',
    clubId: 'club-other',
    sessionDate: '2026-10-12',
    startTime: '18:00',
    endTime: '20:00',
    bookingStatus: 'booked',
    feeSplitFinalized: false,
  });

  const allSessions = [
    pastUnfinalizedOlder,
    pastFinalized,
    upcomingUnfinalized,
    otherClubPastUnfinalized,
    pastUnfinalizedNewer,
  ];

  it('returns only past unfinalized sessions for clubs owned by the active player, newest first', () => {
    const result = getOwnerPastUnfinalizedSessions({
      sessions: allSessions,
      clubs: [clubOwned, clubOther],
      activePlayerId: 'owner-1',
      permissionTier: 'club_owner',
      nowMs,
    });
    assert.deepEqual(
      result.map((s) => s.id),
      ['past-newer', 'past-older']
    );
  });

  it('also prompts an admin who owns the club, but only for clubs they own', () => {
    const result = getOwnerPastUnfinalizedSessions({
      sessions: allSessions,
      clubs: [clubOwned, clubOther],
      activePlayerId: 'owner-1',
      permissionTier: 'admin',
      nowMs,
    });
    assert.deepEqual(
      result.map((s) => s.id),
      ['past-newer', 'past-older']
    );
  });

  it('returns empty for regular users or when no player is active', () => {
    assert.deepEqual(
      getOwnerPastUnfinalizedSessions({
        sessions: allSessions,
        clubs: [clubOwned, clubOther],
        activePlayerId: 'owner-1',
        permissionTier: 'user',
        nowMs,
      }),
      []
    );
    assert.deepEqual(
      getOwnerPastUnfinalizedSessions({
        sessions: allSessions,
        clubs: [clubOwned, clubOther],
        activePlayerId: null,
        permissionTier: 'club_owner',
        nowMs,
      }),
      []
    );
  });
});

describe('canDeleteSessionWithPermission', () => {
  const nowMs = Date.parse('2026-10-16T04:00:00Z');
  const completedSession = makeSession({
    sessionDate: '2026-10-15',
    startTime: '18:00',
    endTime: '20:00',
    bookingStatus: 'completed',
    feeSplitFinalized: true,
  });
  const pastUnfinalizedSession = makeSession({
    sessionDate: '2026-10-15',
    startTime: '18:00',
    endTime: '20:00',
    bookingStatus: 'booked',
    feeSplitFinalized: false,
  });
  const upcomingSession = makeSession({
    sessionDate: '2026-10-20',
    startTime: '18:00',
    endTime: '20:00',
    bookingStatus: 'booked',
    feeSplitFinalized: false,
  });

  it('allows only Site Admin to remove completed or past sessions from history', () => {
    assert.equal(
      canDeleteSessionWithPermission({
        session: completedSession,
        permissionTier: 'admin',
        canManageClub: true,
        clubTimeZone: 'Asia/Singapore',
        nowMs,
      }),
      true
    );
    assert.equal(
      canDeleteSessionWithPermission({
        session: completedSession,
        permissionTier: 'club_owner',
        canManageClub: true,
        clubTimeZone: 'Asia/Singapore',
        nowMs,
      }),
      false
    );
    assert.equal(
      canDeleteSessionWithPermission({
        session: pastUnfinalizedSession,
        permissionTier: 'club_owner',
        canManageClub: true,
        clubTimeZone: 'Asia/Singapore',
        nowMs,
      }),
      false
    );
    assert.equal(
      canDeleteSessionWithPermission({
        session: pastUnfinalizedSession,
        permissionTier: 'admin',
        canManageClub: true,
        clubTimeZone: 'Asia/Singapore',
        nowMs,
      }),
      true
    );
  });

  it('still allows club owners and admins to delete upcoming unfinalized sessions', () => {
    assert.equal(
      canDeleteSessionWithPermission({
        session: upcomingSession,
        permissionTier: 'club_owner',
        canManageClub: true,
        clubTimeZone: 'Asia/Singapore',
        nowMs,
      }),
      true
    );
    assert.equal(
      canDeleteSessionWithPermission({
        session: upcomingSession,
        permissionTier: 'user',
        canManageClub: false,
        clubTimeZone: 'Asia/Singapore',
        nowMs,
      }),
      false
    );
  });
});

describe('session cloning (+7d) helpers', () => {
  it('computes +7 calendar days across month and year boundaries', () => {
    assert.equal(computeNextWeekDate('2026-12-28'), '2027-01-04');
    assert.equal(computeNextWeekDate('2026-02-24'), '2026-03-03');
    assert.equal(computeNextWeekDate('not-a-date'), null);
  });

  it('builds an editable clone draft defaulted to pending and blank courts', () => {
    const source = makeSession({
      sessionDate: '2026-10-15',
      bookingStatus: 'booked',
      courtNumbers: 'Courts 3 & 4',
      courtFee: 84,
      maxPlayers: 12,
      paymentTiming: 'before',
    });
    const draft = buildCloneSessionDraft(source);
    assert.equal(draft.sessionDate, '2026-10-22');
    assert.equal(draft.bookingStatus, 'pending');
    assert.equal(draft.courtNumbers, '');
    assert.equal(draft.courtFee, 84);
    assert.equal(draft.maxPlayers, 12);
    assert.equal(draft.paymentTiming, 'before');
  });

  it('resolves cloned session payload with user overrides for uncertain fields', () => {
    const source = makeSession({
      sessionDate: '2026-10-15',
      bookingStatus: 'booked',
      courtNumbers: 'Courts 1 & 2',
      courtFee: 60,
      maxPlayers: 8,
    });

    const defaultCloned = resolveClonedSessionInput(source);
    assert.ok(defaultCloned);
    assert.equal(defaultCloned.sessionDate, '2026-10-22');
    assert.equal(defaultCloned.bookingStatus, 'pending');
    assert.equal(defaultCloned.courtNumbers, 'TBD');
    assert.equal(defaultCloned.feeSplitFinalized, false);

    const editedCloned = resolveClonedSessionInput(source, {
      bookingStatus: 'booked',
      courtNumbers: 'Court 5 & 6',
      courtFee: 90,
      maxPlayers: 12,
      sessionDate: '2026-10-23',
      startTime: '19:30',
      endTime: '21:30',
      paymentTiming: 'before',
    });
    assert.ok(editedCloned);
    assert.equal(editedCloned.sessionDate, '2026-10-23');
    assert.equal(editedCloned.bookingStatus, 'booked');
    assert.equal(editedCloned.courtNumbers, 'Court 5 & 6');
    assert.equal(editedCloned.courtFee, 90);
    assert.equal(editedCloned.maxPlayers, 12);
    assert.equal(editedCloned.startTime, '19:30');
    assert.equal(editedCloned.endTime, '21:30');
    assert.equal(editedCloned.paymentTiming, 'before');
  });
});

describe('isClubMatchHistoryAndStandingsEnabled', () => {
  it('defaults to enabled when omitted and disables only when explicitly false', () => {
    assert.equal(isClubMatchHistoryAndStandingsEnabled(undefined), true);
    assert.equal(isClubMatchHistoryAndStandingsEnabled(null), true);
    assert.equal(isClubMatchHistoryAndStandingsEnabled({}), true);
    assert.equal(
      isClubMatchHistoryAndStandingsEnabled({ enableMatchHistoryAndStandings: true }),
      true
    );
    assert.equal(
      isClubMatchHistoryAndStandingsEnabled({ enableMatchHistoryAndStandings: false }),
      false
    );
  });
});

