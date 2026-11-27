import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BadmintonMatch, Club, RankedPlayer, Session, SessionRsvp } from '../types';
import {
  buildSessionMatchResultsSnippet,
  buildSessionSettlementSnippet,
  computeSessionPlayerRecords,
  filterSessionRosterRows,
  filterUpcomingSessions,
  getSessionProximityBadge,
  pickRotateNextLineup,
} from './sessionQoLHelpers';

const baseClub: Club = {
  id: 'club-1',
  name: 'Bintang Prime',
  description: 'Badminton Club',
  visibility: 'public',
  clubOwnerPlayerId: 'owner-1',
  clubOwnerName: 'Alex Tan',
  excludeOwnerFromBilling: true,
  freeCancelHours: 24,
  lockCancelHours: 2,
  lateCancelFeePercent: 50,
  noShowFeePercent: 100,
  paymentInfo: 'PayNow +65 9123 4567',
  timezone: 'Asia/Singapore',
  currency: 'SGD',
  ownerId: 'uid-owner',
};

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess-1',
  clubId: 'club-1',
  title: 'Thursday Rotation',
  venue: 'OCBC Arena',
  courtNumbers: 'Courts 1 & 2',
  sessionDate: '2026-10-15',
  startTime: '20:00',
  endTime: '22:00',
  bookingStatus: 'booked',
  courtFee: 80,
  shuttlesUsed: 4,
  shuttleUnitCost: 3,
  shuttleFee: 12,
  maxPlayers: 8,
  organizerName: 'Alex Tan',
  paymentInfo: 'PayNow',
  feeSplitFinalized: false,
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
  tierTitle: 'Rally Tactician',
  rank: 1,
  recentForm: [],
});

describe('getSessionProximityBadge', () => {
  it('returns In Play while current time is between start and end in the club zone', () => {
    // 2026-10-15 20:30 SGT = 12:30 UTC
    const nowMs = Date.UTC(2026, 9, 15, 12, 30, 0);
    const badge = getSessionProximityBadge(makeSession(), nowMs, 'Asia/Singapore');
    assert.deepEqual(badge, { kind: 'live', label: 'In Play' });
  });

  it('returns minute countdown within 60 minutes of start', () => {
    // 2026-10-15 19:25 SGT = 11:25 UTC (35m before 20:00 SGT)
    const nowMs = Date.UTC(2026, 9, 15, 11, 25, 0);
    const badge = getSessionProximityBadge(makeSession(), nowMs, 'Asia/Singapore');
    assert.deepEqual(badge, { kind: 'soon', label: 'In 35m' });
  });

  it('returns Today with hour countdown on the same club calendar day', () => {
    // 2026-10-15 15:30 SGT = 07:30 UTC (4h 30m before 20:00 SGT)
    const nowMs = Date.UTC(2026, 9, 15, 7, 30, 0);
    const badge = getSessionProximityBadge(makeSession(), nowMs, 'Asia/Singapore');
    assert.deepEqual(badge, { kind: 'today', label: 'Today · in 4h 30m' });
  });

  it('uses club timezone boundaries rather than UTC day boundaries for Tomorrow', () => {
    // 2026-10-14 23:30 SGT = 2026-10-14 15:30 UTC; session is 2026-10-15 20:00 SGT -> Tomorrow in SGT
    const nowMs = Date.UTC(2026, 9, 14, 15, 30, 0);
    const badge = getSessionProximityBadge(makeSession(), nowMs, 'Asia/Singapore');
    assert.deepEqual(badge, { kind: 'tomorrow', label: 'Tomorrow' });
  });

  it('returns In N days up to 7 days and null past 7 days or when completed', () => {
    const threeDaysBefore = Date.UTC(2026, 9, 12, 2, 0, 0);
    assert.deepEqual(getSessionProximityBadge(makeSession(), threeDaysBefore, 'Asia/Singapore'), {
      kind: 'upcoming',
      label: 'In 3 days',
    });

    const tenDaysBefore = Date.UTC(2026, 9, 5, 2, 0, 0);
    assert.equal(getSessionProximityBadge(makeSession(), tenDaysBefore, 'Asia/Singapore'), null);

    const duringCompleted = Date.UTC(2026, 9, 15, 12, 30, 0);
    assert.equal(
      getSessionProximityBadge(
        makeSession({ bookingStatus: 'completed' }),
        duringCompleted,
        'Asia/Singapore'
      ),
      null
    );
  });
});

describe('filterUpcomingSessions & filterSessionRosterRows', () => {
  it('filters upcoming sessions by search query, joinedOnly, and spotsOpenOnly', () => {
    const s1 = makeSession({ id: 's1', title: 'Alpha Night', venue: 'Arena A', maxPlayers: 4 });
    const s2 = makeSession({ id: 's2', title: 'Beta Smash', venue: 'Hub B', maxPlayers: 2 });
    const rsvpsBySessionId = new Map<string, SessionRsvp[]>([
      ['s1', [makeRsvp({ id: 'r1', sessionId: 's1', playerId: 'me', status: 'going' })]],
      [
        's2',
        [
          makeRsvp({ id: 'r2', sessionId: 's2', playerId: 'p2', status: 'going', guestCount: 1 }),
        ],
      ],
    ]);
    const clubById = new Map([[baseClub.id, baseClub]]);

    assert.deepEqual(
      filterUpcomingSessions([s1, s2], {
        query: 'beta',
        joinedOnly: false,
        spotsOpenOnly: false,
        activePlayerId: 'me',
        rsvpsBySessionId,
        clubById,
        fallbackClub: baseClub,
      }).map((s) => s.id),
      ['s2']
    );

    assert.deepEqual(
      filterUpcomingSessions([s1, s2], {
        query: '',
        joinedOnly: false,
        spotsOpenOnly: true,
        activePlayerId: 'me',
        rsvpsBySessionId,
        clubById,
        fallbackClub: baseClub,
      }).map((s) => s.id),
      ['s1']
    );

    assert.deepEqual(
      filterUpcomingSessions([s1, s2], {
        query: '',
        joinedOnly: true,
        spotsOpenOnly: false,
        activePlayerId: 'me',
        rsvpsBySessionId,
        clubById,
        fallbackClub: baseClub,
      }).map((s) => s.id),
      ['s1']
    );
  });

  it('filters roster rows case-insensitively by player name', () => {
    const rows = [
      makeRsvp({ id: 'r1', playerName: 'Alice Tan' }),
      makeRsvp({ id: 'r2', playerName: 'Bob Lim' }),
    ];
    assert.deepEqual(
      filterSessionRosterRows(rows, '  alice ').map((r) => r.id),
      ['r1']
    );
  });
});

describe('buildSessionSettlementSnippet', () => {
  it('lists unpaid & awaiting verification members accurately and respects owner exclusion', () => {
    const session = makeSession({ bookingStatus: 'completed', feeSplitFinalized: true });
    const rsvps: SessionRsvp[] = [
      makeRsvp({ id: 'r-owner', playerId: 'owner-1', playerName: 'Alex Tan', feeShare: 0, paidStatus: 'paid' }),
      makeRsvp({ id: 'r1', playerId: 'p1', playerName: 'Kevin', feeShare: 18, paidStatus: 'paid' }),
      makeRsvp({
        id: 'r2',
        playerId: 'p2',
        playerName: 'Chloe',
        feeShare: 36,
        guestCount: 1,
        paidStatus: 'unpaid',
      }),
      makeRsvp({
        id: 'r3',
        playerId: 'p3',
        playerName: 'Sam',
        feeShare: 9,
        status: 'late_out',
        penaltyPercentApplied: 50,
        paidStatus: 'pending_approval',
      }),
    ];

    const snippet = buildSessionSettlementSnippet({
      club: baseClub,
      session,
      rsvps,
      paymentDetails: {
        recipientName: 'Alex Tan',
        phoneNumber: '+65 9123 4567',
        bankName: 'DBS',
        bankAccountNumber: '018-902341-2',
        paymentNotes: 'Include name and session date',
      },
      shareUrl: 'https://courtpulse.test/?i=abc',
      formatCurrency: (n) => `$${n.toFixed(2)}`,
    });

    assert.match(snippet, /Total Pool: \$92\.00/);
    assert.match(snippet, /Settled: 1\/3 · \$45\.00 remaining/);
    assert.match(snippet, /Payment Due \(1\):/);
    assert.match(snippet, /- Chloe \(\+1 guest\): \$36\.00/);
    assert.match(snippet, /Awaiting Verification \(1\):/);
    assert.match(snippet, /- Sam \(Late Out\): \$9\.00/);
    assert.doesNotMatch(snippet, /Kevin/);
    assert.match(snippet, /Pay to: Alex Tan/);
    assert.match(snippet, /https:\/\/courtpulse\.test\/\?i=abc/);
  });
});

describe('computeSessionPlayerRecords, pickRotateNextLineup, buildSessionMatchResultsSnippet', () => {
  const players = [
    makePlayer('p1', 'Alice', 1300),
    makePlayer('p2', 'Bob', 1280),
    makePlayer('p3', 'Charlie', 1250),
    makePlayer('p4', 'Dave', 1240),
    makePlayer('p5', 'Eve', 1260),
    makePlayer('p6', 'Frank', 1220),
  ];

  const match1: BadmintonMatch = {
    id: 'm1',
    clubId: 'club-1',
    sessionId: 'sess-1',
    matchFormat: 'doubles',
    teamAPlayer1Id: 'p1',
    teamAPlayer1Name: 'Alice',
    teamAPlayer2Id: 'p2',
    teamAPlayer2Name: 'Bob',
    teamBPlayer1Id: 'p3',
    teamBPlayer1Name: 'Charlie',
    teamBPlayer2Id: 'p4',
    teamBPlayer2Name: 'Dave',
    scoreTeamA: 21,
    scoreTeamB: 16,
    setScoresText: '21-16',
    winnerSide: 'A',
    ownerId: 'uid-owner',
  };

  it('computes per-session player W-L and point diff', () => {
    const records = computeSessionPlayerRecords([match1], players);
    const alice = records.find((r) => r.playerId === 'p1');
    const charlie = records.find((r) => r.playerId === 'p3');
    const eve = records.find((r) => r.playerId === 'p5');
    assert.deepEqual(alice, {
      playerId: 'p1',
      name: 'Alice',
      wins: 1,
      losses: 0,
      games: 1,
      pointDiff: 5,
    });
    assert.deepEqual(charlie, {
      playerId: 'p3',
      name: 'Charlie',
      wins: 0,
      losses: 1,
      games: 1,
      pointDiff: -5,
    });
    assert.equal(eve?.games, 0);
  });

  it('keeps winners on Side A and rotates resting players onto Side B', () => {
    const counts = new Map([
      ['p1', 1],
      ['p2', 1],
      ['p3', 1],
      ['p4', 1],
      ['p5', 0],
      ['p6', 0],
    ]);
    const next = pickRotateNextLineup(players, counts, match1, 'doubles');
    assert.deepEqual(next, {
      teamA1Id: 'p1',
      teamA2Id: 'p2',
      teamB1Id: 'p5',
      teamB2Id: 'p6',
    });
  });

  it('formats session match results in chronological order (#1 first)', () => {
    const match2: BadmintonMatch = {
      ...match1,
      id: 'm2',
      teamBPlayer1Id: 'p5',
      teamBPlayer1Name: 'Eve',
      teamBPlayer2Id: 'p6',
      teamBPlayer2Name: 'Frank',
      scoreTeamA: 18,
      scoreTeamB: 21,
      winnerSide: 'B',
    };
    // Input is newest-first as returned by sortMatchesNewestFirst
    const snippet = buildSessionMatchResultsSnippet({
      club: baseClub,
      session: makeSession(),
      matches: [match2, match1],
    });
    assert.match(snippet, /Match Results \(2\)/);
    assert.match(snippet, /#1 \(Doubles\) Alice & Bob def\. Charlie & Dave · 21–16/);
    assert.match(snippet, /#2 \(Doubles\) Eve & Frank def\. Alice & Bob · 21–18/);
  });
});
