import test from 'node:test';
import assert from 'node:assert/strict';
import type { Club, PermissionTier, Player, Session, SessionRsvp } from '../types.ts';
import {
  filterEligibleDirectAddMembers,
  searchMembers,
  isPlayerEnrolledInSession,
  findExistingSessionRsvp,
  checkDirectAddCapacity,
  canDirectAddPlayer,
} from './directAddPlayer.ts';
import { getSessionGoingHeadcount, getRsvpPartySize } from './badmintonLogic.ts';

// ---------------------------------------------------------------------------
// Adversarial Test Fixtures
// ---------------------------------------------------------------------------

function createPlayer(id: string, name: string, playerTag: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name,
    playerTag,
    joinedClubIdsCsv: 'club_1',
    wins: 0,
    losses: 0,
    gamesPlayed: 0,
    pointsScored: 0,
    pointsConceded: 0,
    singlesWins: 0,
    singlesLosses: 0,
    doublesWins: 0,
    doublesLosses: 0,
    ratingScore: 1200,
    ownerId: `user_${id}`,
    ...overrides,
  };
}

function createRsvp(
  sessionId: string,
  playerId: string,
  status: 'going' | 'out' | 'late_out' = 'going',
  guestCount: number = 0,
  overrides: Partial<SessionRsvp> = {}
): SessionRsvp {
  return {
    id: `rsvp_${sessionId}_${playerId}`,
    clubId: 'club_1',
    sessionId,
    playerId,
    playerName: `Player ${playerId}`,
    status,
    guestCount,
    attendanceOutcome: 'present',
    penaltyPercentApplied: 0,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: `user_${playerId}`,
    ...overrides,
  };
}

function createSession(maxPlayers: number = 8, overrides: Partial<Session> = {}): Session {
  return {
    id: 's_adv_1',
    clubId: 'club_1',
    title: 'Adversarial Session',
    venue: 'Arena 1',
    courtNumbers: '1',
    sessionDate: '2026-12-01',
    startTime: '18:00',
    endTime: '20:00',
    bookingStatus: 'booked',
    courtFee: 30,
    shuttlesUsed: 2,
    shuttleUnitCost: 2.5,
    shuttleFee: 5,
    maxPlayers,
    organizerName: 'Admin',
    paymentInfo: 'PayNow',
    feeSplitFinalized: false,
    ownerId: 'u_admin',
    ...overrides,
  };
}

function createClub(id: string, ownerPlayerId: string, overrides: Partial<Club> = {}): Club {
  return {
    id,
    name: `Club ${id}`,
    description: 'Test club',
    paymentInfo: 'PayNow 12345678',
    freeCancelHours: 24,
    lockCancelHours: 2,
    lateCancelFeePercent: 50,
    noShowFeePercent: 100,
    ownerId: `user_${ownerPlayerId}`,
    ownerPlayerId,
    clubOwnerPlayerId: ownerPlayerId,
    ...overrides,
  };
}

// ===========================================================================
// SECTION 1: Adversarial Capacity & Boundary Tests
// ===========================================================================

test('ADVERSARIAL CAPACITY: maxPlayers handles extreme and invalid values safely', () => {
  const rsvps: SessionRsvp[] = [];

  // maxPlayers = 0 -> normalizes to at least 1
  const sessionZero = createSession(0);
  const resZero = checkDirectAddCapacity(sessionZero, rsvps, 0);
  assert.equal(resZero.ok, true);
  assert.equal(resZero.spotsOpen, 1);

  // maxPlayers = -10 -> normalizes to 1
  const sessionNeg = createSession(-10);
  const resNeg = checkDirectAddCapacity(sessionNeg, rsvps, 0);
  assert.equal(resNeg.ok, true);
  assert.equal(resNeg.spotsOpen, 1);

  // maxPlayers = NaN / null / undefined cast
  const sessionNaN = createSession(NaN as any);
  const resNaN = checkDirectAddCapacity(sessionNaN, rsvps, 0);
  assert.equal(resNaN.ok, true);
  assert.equal(resNaN.spotsOpen, 1);

  // Float maxPlayers (e.g. 4.9 floors to 4)
  const sessionFloat = createSession(4.9);
  const rsvps4 = [
    createRsvp('s_adv_1', 'p1', 'going'),
    createRsvp('s_adv_1', 'p2', 'going'),
    createRsvp('s_adv_1', 'p3', 'going'),
    createRsvp('s_adv_1', 'p4', 'going'),
  ];
  const resFloat = checkDirectAddCapacity(sessionFloat, rsvps4, 0);
  assert.equal(resFloat.ok, false);
  assert.equal(resFloat.spotsOpen, 0);
});

test('ADVERSARIAL CAPACITY: guest count fuzzing (negative, extreme, non-integer, non-numeric)', () => {
  const session = createSession(10);
  const rsvps: SessionRsvp[] = [];

  // Negative guest counts clamped to 0 -> partySize 1
  assert.equal(checkDirectAddCapacity(session, rsvps, -1).partySize, 1);
  assert.equal(checkDirectAddCapacity(session, rsvps, -100).partySize, 1);
  assert.equal(checkDirectAddCapacity(session, rsvps, -Infinity).partySize, 1);

  // Exact 0..4 range
  assert.equal(checkDirectAddCapacity(session, rsvps, 0).partySize, 1);
  assert.equal(checkDirectAddCapacity(session, rsvps, 1).partySize, 2);
  assert.equal(checkDirectAddCapacity(session, rsvps, 2).partySize, 3);
  assert.equal(checkDirectAddCapacity(session, rsvps, 3).partySize, 4);
  assert.equal(checkDirectAddCapacity(session, rsvps, 4).partySize, 5);

  // Overflow guest counts clamped to 4 -> partySize 5
  assert.equal(checkDirectAddCapacity(session, rsvps, 5).partySize, 5);
  assert.equal(checkDirectAddCapacity(session, rsvps, 999).partySize, 5);
  assert.equal(checkDirectAddCapacity(session, rsvps, Infinity).partySize, 5);

  // Non-integer guest counts floored
  assert.equal(checkDirectAddCapacity(session, rsvps, 2.9).partySize, 3);
  assert.equal(checkDirectAddCapacity(session, rsvps, 0.5).partySize, 1);

  // Non-numeric types handled via Number coercion
  assert.equal(checkDirectAddCapacity(session, rsvps, '3' as any).partySize, 4);
  assert.equal(checkDirectAddCapacity(session, rsvps, 'garbage' as any).partySize, 1);
  assert.equal(checkDirectAddCapacity(session, rsvps, null as any).partySize, 1);
  assert.equal(checkDirectAddCapacity(session, rsvps, undefined as any).partySize, 1);
});

test('ADVERSARIAL CAPACITY: exact boundary transitions at maxPlayers capacity', () => {
  const session = createSession(4);
  const rsvps = [
    createRsvp('s_adv_1', 'p1', 'going'),
    createRsvp('s_adv_1', 'p2', 'going'),
    createRsvp('s_adv_1', 'p3', 'going'),
  ]; // currentGoing = 3, spotsOpen = 1

  // Adding 0 guests (partySize 1): 3 + 1 = 4 == maxPlayers 4 -> FITS EXACTLY
  const resExact = checkDirectAddCapacity(session, rsvps, 0, false);
  assert.equal(resExact.ok, true);
  assert.equal(resExact.spotsOpen, 1);
  assert.equal(resExact.partySize, 1);
  assert.equal(resExact.currentGoing, 3);

  // Adding 1 guest (partySize 2): 3 + 2 = 5 > maxPlayers 4 -> OVERFLOWS
  const resOver1 = checkDirectAddCapacity(session, rsvps, 1, false);
  assert.equal(resOver1.ok, false);
  assert.equal(resOver1.spotsOpen, 1);
  assert.equal(resOver1.partySize, 2);
  assert.equal(resOver1.error, 'This session is full.');

  // Adding 1 guest WITH override -> OK with warning
  const resOver1Allowed = checkDirectAddCapacity(session, rsvps, 1, true);
  assert.equal(resOver1Allowed.ok, true);
  assert.equal(resOver1Allowed.spotsOpen, 1);
  assert.equal(resOver1Allowed.partySize, 2);
  assert.equal(resOver1Allowed.warning, 'Session capacity exceeded (manager override).');
  assert.equal(resOver1Allowed.error, undefined);

  // Adding 4 guests (partySize 5): 3 + 5 = 8 > maxPlayers 4 -> OVERFLOWS
  const resOver4 = checkDirectAddCapacity(session, rsvps, 4, false);
  assert.equal(resOver4.ok, false);
  assert.equal(resOver4.partySize, 5);
});

test('ADVERSARIAL CAPACITY: spotsOpen never drops below 0 when session is already overloaded', () => {
  const session = createSession(4);
  const overloadedRsvps = [
    createRsvp('s_adv_1', 'p1', 'going', 2), // 3
    createRsvp('s_adv_1', 'p2', 'going', 2), // 3
  ]; // total going = 6 > maxPlayers 4

  const res = checkDirectAddCapacity(session, overloadedRsvps, 0, false);
  assert.equal(res.ok, false);
  assert.equal(res.currentGoing, 6);
  assert.equal(res.spotsOpen, 0); // must be 0, never negative
});

test('ADVERSARIAL CAPACITY: existing RSVP party replacement vs fresh addition', () => {
  const session = createSession(6);
  const p1Rsvp = createRsvp('s_adv_1', 'p1', 'going', 1); // partySize 2
  const p2Rsvp = createRsvp('s_adv_1', 'p2', 'going', 0); // partySize 1
  const rsvps = [p1Rsvp, p2Rsvp]; // currentGoing = 3

  // Upgrading p1 from 1 guest to 3 guests (partySize 4)
  // othersGoing = 3 - 2 = 1. Projected = 1 + 4 = 5 <= 6 -> FITS
  const resUpgrade = checkDirectAddCapacity(session, rsvps, 3, false, p1Rsvp);
  assert.equal(resUpgrade.ok, true);
  assert.equal(resUpgrade.currentGoing, 3);
  assert.equal(resUpgrade.partySize, 4);

  // If p1 had status 'out', their partySize should NOT be subtracted from othersGoing
  const p1OutRsvp = createRsvp('s_adv_1', 'p1', 'out', 1);
  // currentGoing with p1Out + p2 = 1
  const rsvpsWithOut = [p1OutRsvp, p2Rsvp];
  const resRestore = checkDirectAddCapacity(session, rsvpsWithOut, 2, false, p1OutRsvp);
  assert.equal(resRestore.ok, true);
  assert.equal(resRestore.currentGoing, 1);
  assert.equal(resRestore.partySize, 3); // 1 + 3 = 4 <= 6
});

test('ADVERSARIAL CAPACITY: multi-session RSVP segregation', () => {
  const session1 = createSession(4, { id: 'session_target' });
  const rsvps = [
    createRsvp('session_target', 'p1', 'going'),
    createRsvp('session_target', 'p2', 'going'),
    createRsvp('session_OTHER', 'p3', 'going'),
    createRsvp('session_OTHER', 'p4', 'going'),
    createRsvp('session_OTHER', 'p5', 'going'),
  ];

  // Target session only has 2 going players, despite 5 total in list
  const res = checkDirectAddCapacity(session1, rsvps, 0);
  assert.equal(res.ok, true);
  assert.equal(res.currentGoing, 2);
  assert.equal(res.spotsOpen, 2);
});

// ===========================================================================
// SECTION 2: Search Fuzzing & Stress Tests
// ===========================================================================

test('SEARCH FUZZING: whitespace variations (tabs, newlines, zero-width, extreme spaces)', () => {
  const p1 = createPlayer('p1', 'David Beckham', '#07');
  const p2 = createPlayer('p2', 'Lionel Messi', '#10');
  const members = [p1, p2];

  // Whitespace-only queries return all members untouched
  assert.deepEqual(searchMembers(members, ''), members);
  assert.deepEqual(searchMembers(members, ' '), members);
  assert.deepEqual(searchMembers(members, '     \t\t  '), members);
  assert.deepEqual(searchMembers(members, '\n\r\n'), members);

  // Query with heavy padding
  assert.deepEqual(searchMembers(members, '   beckham   '), [p1]);
  assert.deepEqual(searchMembers(members, '\tMESSI\n'), [p2]);

  // Query with null/undefined safety
  assert.deepEqual(searchMembers(members, null as any), members);
  assert.deepEqual(searchMembers(members, undefined as any), members);
});

test('SEARCH FUZZING: regex metacharacters, punctuation and injection safety', () => {
  const p1 = createPlayer('p1', 'Regex (Master) [Pro]', '#.*+?');
  const p2 = createPlayer('p2', 'Bob $100 & Co.', '#^special$');
  const p3 = createPlayer('p3', '<script>alert("xss")</script>', '#html');
  const members = [p1, p2, p3];

  // Naive RegExp compilation would crash on unescaped metacharacters:
  // (Master), [Pro], .*, +, ?, ^, $, etc.
  assert.doesNotThrow(() => searchMembers(members, '.*'));
  assert.doesNotThrow(() => searchMembers(members, '('));
  assert.doesNotThrow(() => searchMembers(members, '[Pro]'));
  assert.doesNotThrow(() => searchMembers(members, '+++'));
  assert.doesNotThrow(() => searchMembers(members, '\\'));
  assert.doesNotThrow(() => searchMembers(members, '$$$'));
  assert.doesNotThrow(() => searchMembers(members, '{2,4}'));
  assert.doesNotThrow(() => searchMembers(members, '?'));
  assert.doesNotThrow(() => searchMembers(members, '^special$'));

  // Exact matching verification
  assert.deepEqual(searchMembers(members, '[Pro]'), [p1]);
  assert.deepEqual(searchMembers(members, '#.*+?'), [p1]);
  assert.deepEqual(searchMembers(members, '$100'), [p2]);
  assert.deepEqual(searchMembers(members, '<script>'), [p3]);
  assert.deepEqual(searchMembers(members, 'alert("xss")'), [p3]);
});

test('SEARCH FUZZING: unicode, international scripts and emoji search', () => {
  const pZh = createPlayer('p_zh', '张伟 (Zhang Wei)', '#ZH01');
  const pJp = createPlayer('p_jp', '田中太郎', '#JP01');
  const pKr = createPlayer('p_kr', '김철수', '#KR01');
  const pFr = createPlayer('p_fr', 'Élodie Laurent', '#FR01');
  const pDe = createPlayer('p_de', 'Jürgen Müller', '#DE01');
  const pEmoji = createPlayer('p_em', '🏸 Smash King ⚡', '#🔥01');
  const members = [pZh, pJp, pKr, pFr, pDe, pEmoji];

  assert.deepEqual(searchMembers(members, '张伟'), [pZh]);
  assert.deepEqual(searchMembers(members, '田中'), [pJp]);
  assert.deepEqual(searchMembers(members, '김철수'), [pKr]);
  assert.deepEqual(searchMembers(members, 'élodie'), [pFr]);
  assert.deepEqual(searchMembers(members, 'ÉLODIE'), [pFr]);
  assert.deepEqual(searchMembers(members, 'müller'), [pDe]);
  assert.deepEqual(searchMembers(members, '🏸'), [pEmoji]);
  assert.deepEqual(searchMembers(members, '🔥'), [pEmoji]);
});

test('SEARCH FUZZING: partial tags, duplicate names and degenerate player objects', () => {
  const p1 = createPlayer('p1', 'John Doe', '#ALPHA');
  const p2 = createPlayer('p2', 'John Doe', '#BETA'); // same name, different tag & id
  const p3 = createPlayer('p3', 'Johnny Depp', '#GAMMA');
  const pDegen = createPlayer('p_bad', '' as any, '' as any);
  const pNullish = { id: 'p_null', name: undefined, playerTag: null } as any;

  const members = [p1, p2, p3, pDegen, pNullish];

  // Searching "John Doe" matches both p1 and p2
  assert.deepEqual(searchMembers(members, 'John Doe'), [p1, p2]);

  // Searching tag "#" matches all three valid tags
  assert.deepEqual(searchMembers(members, '#'), [p1, p2, p3]);

  // Searching "ALPHA" matches only p1
  assert.deepEqual(searchMembers(members, 'ALPHA'), [p1]);

  // Degenerate/nullish player properties do not crash search
  assert.doesNotThrow(() => searchMembers(members, 'anything'));
});

test('SEARCH STRESS: 5,000 members searched within tight timing bounds', () => {
  const largePool: Player[] = [];
  for (let i = 0; i < 5000; i++) {
    largePool.push(createPlayer(`p_${i}`, `Player ${i} Name`, `#TAG_${i}`));
  }

  const start = performance.now();
  const results = searchMembers(largePool, 'Player 499');
  const duration = performance.now() - start;

  assert.ok(results.length >= 10, 'Expected at least 10 matches for "Player 499"');
  assert.ok(duration < 50, `Expected search under 50ms, took ${duration.toFixed(2)}ms`);
});

// ===========================================================================
// SECTION 3: Idempotency, Deduplication & Race Condition Harness
// ===========================================================================

test('IDEMPOTENCY: filterEligibleDirectAddMembers is pure and leaves inputs unmutated', () => {
  const p1 = createPlayer('p1', 'Alice', '#01');
  const p2 = createPlayer('p2', 'Bob', '#02');
  const rsvpP1 = createRsvp('s1', 'p1', 'going');

  const members = [p1, p2];
  const rsvps = [rsvpP1];

  const membersSnapshot = JSON.stringify(members);
  const rsvpsSnapshot = JSON.stringify(rsvps);

  // Call 200 times sequentially
  let lastResult;
  for (let i = 0; i < 200; i++) {
    lastResult = filterEligibleDirectAddMembers(members, rsvps);
  }

  // Structure and membership must be identical
  assert.equal(lastResult?.eligible.length, 1);
  assert.equal(lastResult?.eligible[0].id, 'p2');
  assert.equal(lastResult?.enrolled.length, 1);
  assert.equal(lastResult?.enrolled[0].id, 'p1');

  // Input arrays and objects must be completely untouched
  assert.equal(JSON.stringify(members), membersSnapshot);
  assert.equal(JSON.stringify(rsvps), rsvpsSnapshot);
});

test('DEDUPLICATION: filterEligibleDirectAddMembers deduplicates duplicate member entries by ID', () => {
  const p1 = createPlayer('p1', 'Alice', '#01');
  const p1Clone = createPlayer('p1', 'Alice Clone', '#01');
  const p2 = createPlayer('p2', 'Bob', '#02');
  const p2Clone = createPlayer('p2', 'Bob Clone', '#02');

  // 4 items with 2 distinct IDs
  const clubMembersWithDups = [p1, p1Clone, p2, p2Clone];
  const rsvps = [createRsvp('s1', 'p1', 'going')];

  const result = filterEligibleDirectAddMembers(clubMembersWithDups, rsvps);

  // Exactly 1 enrolled (p1) and 1 eligible (p2)
  assert.equal(result.enrolled.length, 1);
  assert.equal(result.enrolled[0].id, 'p1');
  assert.equal(result.enrolled[0].name, 'Alice'); // first-seen wins

  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0].id, 'p2');
  assert.equal(result.eligible[0].name, 'Bob');
});

test('IDEMPOTENCY: isPlayerEnrolledInSession supports dual signatures and rejects invalid arguments', () => {
  const rsvps = [
    createRsvp('s1', 'p1', 'going'),
    createRsvp('s1', 'p2', 'late_out'),
    createRsvp('s2', 'p1', 'going'),
  ];

  // Signature 1: (sessionRsvps, playerId, sessionId)
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p1', 's1'), true);
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p1', 's2'), true);
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p1', 's3'), false);
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p2', 's1'), false);
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p_nonexistent', 's1'), false);

  // Signature 2: (playerId, sessionRsvps, sessionId)
  assert.equal(isPlayerEnrolledInSession('p1', rsvps, 's1'), true);
  assert.equal(isPlayerEnrolledInSession('p2', rsvps, 's1'), false);

  // Fuzzing with null/undefined/garbage types
  assert.equal(isPlayerEnrolledInSession(null, null), false);
  assert.equal(isPlayerEnrolledInSession(undefined, undefined), false);
  assert.equal(isPlayerEnrolledInSession('', []), false);
  assert.equal(isPlayerEnrolledInSession([], ''), false);
  assert.equal(isPlayerEnrolledInSession(123 as any, 456 as any), false);
  assert.equal(isPlayerEnrolledInSession({} as any, {} as any), false);
});

test('RACE HARNESS: sequential simulated addition prevents duplicate enrollment', () => {
  const session = createSession(8);
  const player = createPlayer('p_race', 'Charlie Race', '#99');
  const allClubMembers = [player];

  // Step 0: Initial state - player is eligible
  let currentRsvps: SessionRsvp[] = [];
  let filterRes = filterEligibleDirectAddMembers(allClubMembers, currentRsvps);
  assert.equal(filterRes.eligible.length, 1);
  assert.equal(filterRes.enrolled.length, 0);

  // Step 1: First add succeeds
  assert.equal(isPlayerEnrolledInSession(currentRsvps, player.id), false);
  const newRsvp = createRsvp(session.id, player.id, 'going', 0);
  currentRsvps = [...currentRsvps, newRsvp];

  // Step 2: Immediate re-evaluation - player is now enrolled
  filterRes = filterEligibleDirectAddMembers(allClubMembers, currentRsvps);
  assert.equal(filterRes.eligible.length, 0);
  assert.equal(filterRes.enrolled.length, 1);
  assert.equal(isPlayerEnrolledInSession(currentRsvps, player.id), true);

  // Step 3: Second simulated add attempt detects already-enrolled
  const existingRsvp = findExistingSessionRsvp(currentRsvps, player.id);
  assert.ok(existingRsvp);
  assert.equal(existingRsvp?.status, 'going');

  // Verify that calling checkDirectAddCapacity with existing going RSVP computes correctly
  const capRes = checkDirectAddCapacity(session, currentRsvps, 0, false, existingRsvp);
  assert.equal(capRes.ok, true);
  assert.equal(capRes.currentGoing, 1);
});

// ===========================================================================
// SECTION 4: Restoring Cancelled Players vs Already-Going Players
// ===========================================================================

test('STATE TRANSITIONS: late_out and out players are eligible to be re-added, while going players are enrolled', () => {
  const pGoing = createPlayer('p_going', 'Active Player', '#01');
  const pOut = createPlayer('p_out', 'Cancelled Early', '#02');
  const pLateOut = createPlayer('p_late', 'Cancelled Late', '#03');
  const pFresh = createPlayer('p_fresh', 'Never Signed Up', '#04');

  const rsvps = [
    createRsvp('s1', 'p_going', 'going', 0),
    createRsvp('s1', 'p_out', 'out', 0),
    createRsvp('s1', 'p_late', 'late_out', 0, { penaltyPercentApplied: 50 }),
  ];

  const clubMembers = [pGoing, pOut, pLateOut, pFresh];
  const { eligible, enrolled } = filterEligibleDirectAddMembers(clubMembers, rsvps);

  // Exactly 1 enrolled (p_going)
  assert.equal(enrolled.length, 1);
  assert.equal(enrolled[0].id, 'p_going');

  // 3 eligible: p_out, p_late, p_fresh
  assert.equal(eligible.length, 3);
  assert.deepEqual(eligible.map((p) => p.id), ['p_out', 'p_late', 'p_fresh']);

  // Verification of findExistingSessionRsvp across all states
  assert.equal(findExistingSessionRsvp(rsvps, 'p_going')?.status, 'going');
  assert.equal(findExistingSessionRsvp(rsvps, 'p_out')?.status, 'out');
  assert.equal(findExistingSessionRsvp(rsvps, 'p_late')?.status, 'late_out');
  assert.equal(findExistingSessionRsvp(rsvps, 'p_late')?.penaltyPercentApplied, 50);
  assert.equal(findExistingSessionRsvp(rsvps, 'p_fresh'), undefined);
});

test('STATE RESTORATION: simulated manager restoration of late_out row resets penalty and restores spot', () => {
  const session = createSession(4);
  const pLate = createPlayer('p_late', 'Late Canceller', '#03');
  const existingLateRsvp = createRsvp(session.id, pLate.id, 'late_out', 0, {
    penaltyPercentApplied: 50,
    attendanceOutcome: 'excused',
  });

  const rsvps = [existingLateRsvp];

  // Verify headcount before restoration: 0 going players
  assert.equal(getSessionGoingHeadcount(rsvps), 0);

  // Check capacity for restoring pLate with 0 guests
  const capCheck = checkDirectAddCapacity(session, rsvps, 0, false, existingLateRsvp);
  assert.equal(capCheck.ok, true);
  assert.equal(capCheck.currentGoing, 0);
  assert.equal(capCheck.partySize, 1);
  assert.equal(capCheck.spotsOpen, 4);

  // Simulate restored RSVP document state
  const restoredRsvp: SessionRsvp = {
    ...existingLateRsvp,
    status: 'going',
    penaltyPercentApplied: 0,
    attendanceOutcome: 'present',
    guestCount: 0,
  };

  const updatedRsvps = [restoredRsvp];
  assert.equal(getSessionGoingHeadcount(updatedRsvps), 1);
  assert.equal(isPlayerEnrolledInSession(updatedRsvps, pLate.id), true);
});

// ===========================================================================
// SECTION 5: Authorization Matrix (All Permutation Tiers & Mismatched Clubs)
// ===========================================================================

test('AUTH MATRIX: exhaustive combinatorial test across tiers, clubs, and acting players', () => {
  const club1 = createClub('club_1', 'owner_1');
  const club2 = createClub('club_2', 'owner_2');
  const allClubs = [club1, club2];

  const adminPlayer = createPlayer('p_adm', 'Admin User', '#00');
  const owner1Player = createPlayer('owner_1', 'Club 1 Owner', '#01');
  const owner2Player = createPlayer('owner_2', 'Club 2 Owner', '#02');
  const regularPlayer = createPlayer('p_reg', 'Regular Member', '#03');

  const tiers: (PermissionTier | null | undefined | string)[] = [
    'admin',
    'club_owner',
    'user',
    null,
    undefined,
    'anonymous',
  ];

  const clubIds = ['club_1', 'club_2', 'club_unknown', '', '   ', null, undefined];
  const actingPlayers = [adminPlayer, owner1Player, owner2Player, regularPlayer, null, undefined];

  let totalPermutations = 0;
  let adminPassCount = 0;
  let ownerPassCount = 0;
  let rejectionCount = 0;

  for (const tier of tiers) {
    for (const clubId of clubIds) {
      for (const player of actingPlayers) {
        totalPermutations++;
        const isAuthorized = canDirectAddPlayer(
          clubId as any,
          player,
          tier as any,
          allClubs
        );

        if (tier === 'admin') {
          // Admin is universally authorized
          assert.equal(isAuthorized, true, `Admin must always be authorized`);
          adminPassCount++;
        } else if (tier === 'club_owner') {
          // Club owner is authorized ONLY if clubId is valid AND matches player ID
          const isTargetClub1 = clubId === 'club_1' && player?.id === 'owner_1';
          const isTargetClub2 = clubId === 'club_2' && player?.id === 'owner_2';
          const expected = isTargetClub1 || isTargetClub2;

          assert.equal(
            isAuthorized,
            expected,
            `Club owner auth mismatch for club=${clubId}, player=${player?.id}`
          );

          if (expected) {
            ownerPassCount++;
          } else {
            rejectionCount++;
          }
        } else {
          // All other tiers ('user', null, undefined, 'anonymous') must ALWAYS be rejected
          assert.equal(
            isAuthorized,
            false,
            `Tier ${tier} must be rejected for club=${clubId}, player=${player?.id}`
          );
          rejectionCount++;
        }
      }
    }
  }

  // Permutation counts sanity check
  assert.equal(totalPermutations, 6 * 7 * 6); // 252 permutations
  assert.equal(adminPassCount, 7 * 6); // 42 admin passes
  assert.equal(ownerPassCount, 2); // exactly club_1 + owner_1, and club_2 + owner_2
  assert.equal(rejectionCount, 252 - 42 - 2); // 208 rejections
});

test('AUTH MATRIX: club ownerId vs clubOwnerPlayerId precedence', () => {
  // Case A: clubOwnerPlayerId set, ownerPlayerId set to different value
  const clubSplit = createClub('club_split', 'owner_legacy', {
    clubOwnerPlayerId: 'owner_primary',
  });

  const pPrimary = createPlayer('owner_primary', 'Primary Owner', '#01');
  const pLegacy = createPlayer('owner_legacy', 'Legacy Owner', '#02');

  // clubOwnerPlayerId wins over ownerPlayerId
  assert.equal(canDirectAddPlayer('club_split', pPrimary, 'club_owner', [clubSplit]), true);
  assert.equal(canDirectAddPlayer('club_split', pLegacy, 'club_owner', [clubSplit]), false);

  // Case B: clubOwnerPlayerId undefined -> falls back to ownerPlayerId
  const clubFallback = createClub('club_fallback', 'owner_legacy', {
    clubOwnerPlayerId: undefined,
  });
  assert.equal(canDirectAddPlayer('club_fallback', pLegacy, 'club_owner', [clubFallback]), true);

  // Case C: clubOwnerPlayerId is null -> falls back to ownerPlayerId
  const clubNull = createClub('club_null', 'owner_legacy', {
    clubOwnerPlayerId: null as any,
  });
  assert.equal(canDirectAddPlayer('club_null', pLegacy, 'club_owner', [clubNull]), true);
});
