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

// ---------------------------------------------------------------------------
// Test Fixture Factories
// ---------------------------------------------------------------------------

function createMockPlayer(
  id: string,
  name: string,
  tag: string,
  overrides: Partial<Player> = {}
): Player {
  return {
    id,
    name,
    playerTag: tag,
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

function createMockRsvp(
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

function createMockSession(
  maxPlayers: number = 8,
  overrides: Partial<Session> = {}
): Session {
  return {
    id: 's1',
    clubId: 'club_1',
    title: 'Tuesday Badminton',
    venue: 'Sports Hall',
    courtNumbers: '1, 2',
    sessionDate: '2026-12-01',
    startTime: '19:00',
    endTime: '21:00',
    bookingStatus: 'booked',
    courtFee: 40,
    shuttlesUsed: 4,
    shuttleUnitCost: 2.5,
    shuttleFee: 10,
    maxPlayers,
    organizerName: 'Organizer',
    paymentInfo: 'PayNow 91234567',
    feeSplitFinalized: false,
    ownerId: 'user_owner',
    ...overrides,
  };
}

function createMockClub(
  id: string,
  ownerPlayerId: string,
  overrides: Partial<Club> = {}
): Club {
  return {
    id,
    name: 'Badminton Club',
    description: 'A great club',
    paymentInfo: 'PayNow 91234567',
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

// ---------------------------------------------------------------------------
// 1. Candidate Pool Filtering (filterEligibleDirectAddMembers)
// ---------------------------------------------------------------------------

test('filterEligibleDirectAddMembers: returns empty arrays on empty input', () => {
  const result = filterEligibleDirectAddMembers([], []);
  assert.deepEqual(result.eligible, []);
  assert.deepEqual(result.enrolled, []);
});

test('filterEligibleDirectAddMembers: all club members are eligible when no session RSVPs exist', () => {
  const p1 = createMockPlayer('p1', 'Alice', '#01');
  const p2 = createMockPlayer('p2', 'Bob', '#02');
  const result = filterEligibleDirectAddMembers([p1, p2], []);

  assert.equal(result.eligible.length, 2);
  assert.equal(result.enrolled.length, 0);
  assert.deepEqual(result.eligible.map((p) => p.id), ['p1', 'p2']);
});

test('filterEligibleDirectAddMembers: partitions members into enrolled vs eligible based on going status', () => {
  const p1 = createMockPlayer('p1', 'Alice', '#01');
  const p2 = createMockPlayer('p2', 'Bob', '#02');
  const p3 = createMockPlayer('p3', 'Charlie', '#03');
  const rsvpP1 = createMockRsvp('session_1', 'p1', 'going');

  const result = filterEligibleDirectAddMembers([p1, p2, p3], [rsvpP1]);

  assert.equal(result.enrolled.length, 1);
  assert.equal(result.enrolled[0].id, 'p1');
  assert.equal(result.eligible.length, 2);
  assert.deepEqual(result.eligible.map((p) => p.id), ['p2', 'p3']);
});

test('filterEligibleDirectAddMembers: members with cancelled status (out or late_out) remain eligible to be re-added', () => {
  const p1 = createMockPlayer('p1', 'Alice', '#01');
  const p2 = createMockPlayer('p2', 'Bob', '#02');
  const p3 = createMockPlayer('p3', 'Charlie', '#03');
  const rsvpP1 = createMockRsvp('session_1', 'p1', 'going');
  const rsvpP2 = createMockRsvp('session_1', 'p2', 'late_out', 0, { penaltyPercentApplied: 50 });
  const rsvpP3 = createMockRsvp('session_1', 'p3', 'out', 0);

  const result = filterEligibleDirectAddMembers([p1, p2, p3], [rsvpP1, rsvpP2, rsvpP3]);

  // Only p1 is currently taking up a spot ('going')
  assert.equal(result.enrolled.length, 1);
  assert.equal(result.enrolled[0].id, 'p1');
  // Both cancelled members are eligible to be restored/re-added
  assert.equal(result.eligible.length, 2);
  assert.deepEqual(result.eligible.map((p) => p.id), ['p2', 'p3']);
});

test('filterEligibleDirectAddMembers: preserves input ordering and reference equality', () => {
  const p1 = createMockPlayer('p1', 'Alice', '#01');
  const p2 = createMockPlayer('p2', 'Bob', '#02');
  const result = filterEligibleDirectAddMembers([p1, p2], []);

  assert.equal(result.eligible[0], p1);
  assert.equal(result.eligible[1], p2);
});

// ---------------------------------------------------------------------------
// 2. Search Filtering (searchMembers)
// ---------------------------------------------------------------------------

test('searchMembers: empty or whitespace-only query returns all members unchanged', () => {
  const members = [
    createMockPlayer('p1', 'Alice Wang', '#01'),
    createMockPlayer('p2', 'Bob Tan', '#02'),
  ];

  assert.deepEqual(searchMembers(members, ''), members);
  assert.deepEqual(searchMembers(members, '   '), members);
});

test('searchMembers: case-insensitive search by name substring', () => {
  const p1 = createMockPlayer('p1', 'Alice Wang', '#01');
  const p2 = createMockPlayer('p2', 'Bob Tan', '#02');
  const p3 = createMockPlayer('p3', 'Alicia Keys', '#03');
  const members = [p1, p2, p3];

  assert.deepEqual(searchMembers(members, 'alice'), [p1]);
  assert.deepEqual(searchMembers(members, 'ALICE'), [p1]);
  assert.deepEqual(searchMembers(members, 'ali'), [p1, p3]);
  assert.deepEqual(searchMembers(members, 'tan'), [p2]);
});

test('searchMembers: case-insensitive search by playerTag', () => {
  const p1 = createMockPlayer('p1', 'Alice Wang', '#ALPHA');
  const p2 = createMockPlayer('p2', 'Bob Tan', '#BETA');
  const members = [p1, p2];

  assert.deepEqual(searchMembers(members, '#alpha'), [p1]);
  assert.deepEqual(searchMembers(members, 'BETA'), [p2]);
  assert.deepEqual(searchMembers(members, '#'), [p1, p2]);
});

test('searchMembers: trims leading and trailing whitespace from query', () => {
  const p1 = createMockPlayer('p1', 'Alice Wang', '#01');
  const members = [p1];

  assert.deepEqual(searchMembers(members, '  Alice  '), [p1]);
});

test('searchMembers: returns empty array when no members match', () => {
  const members = [
    createMockPlayer('p1', 'Alice Wang', '#01'),
    createMockPlayer('p2', 'Bob Tan', '#02'),
  ];

  assert.deepEqual(searchMembers(members, 'Zachary'), []);
});

test('searchMembers: handles empty member array gracefully', () => {
  assert.deepEqual(searchMembers([], 'alice'), []);
});

// ---------------------------------------------------------------------------
// 3. Already-Enrolled Detection & Idempotency
// ---------------------------------------------------------------------------

test('isPlayerEnrolledInSession: detects when player is actively going', () => {
  const rsvps = [
    createMockRsvp('s1', 'p1', 'going'),
    createMockRsvp('s1', 'p2', 'late_out'),
  ];

  assert.equal(isPlayerEnrolledInSession(rsvps, 'p1'), true);
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p2'), false);
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p3'), false);
});

test('findExistingSessionRsvp: locates prior RSVP regardless of status', () => {
  const rsvps = [
    createMockRsvp('s1', 'p1', 'going'),
    createMockRsvp('s1', 'p2', 'late_out', 0, { penaltyPercentApplied: 50 }),
  ];

  const p1Rsvp = findExistingSessionRsvp(rsvps, 'p1');
  assert.ok(p1Rsvp);
  assert.equal(p1Rsvp?.status, 'going');

  const p2Rsvp = findExistingSessionRsvp(rsvps, 'p2');
  assert.ok(p2Rsvp);
  assert.equal(p2Rsvp?.status, 'late_out');
  assert.equal(p2Rsvp?.penaltyPercentApplied, 50);

  const p3Rsvp = findExistingSessionRsvp(rsvps, 'p3');
  assert.equal(p3Rsvp, undefined);
});

// ---------------------------------------------------------------------------
// 4. Capacity Calculation (checkDirectAddCapacity)
// ---------------------------------------------------------------------------

test('checkDirectAddCapacity: open spots available with 0 guests (party size 1)', () => {
  const session = createMockSession(8);
  const rsvps = [
    createMockRsvp('s1', 'p1', 'going'),
    createMockRsvp('s1', 'p2', 'going'),
  ]; // currentGoing = 2

  const result = checkDirectAddCapacity(session, rsvps, 0);

  assert.equal(result.ok, true);
  assert.equal(result.currentGoing, 2);
  assert.equal(result.partySize, 1);
  assert.equal(result.spotsOpen, 6);
  assert.equal(result.error, undefined);
  assert.equal(result.warning, undefined);
});

test('checkDirectAddCapacity: open spots available with guests', () => {
  const session = createMockSession(8);
  const rsvps = [
    createMockRsvp('s1', 'p1', 'going'),
    createMockRsvp('s1', 'p2', 'going'),
  ]; // currentGoing = 2, adding 1 player + 2 guests = party size 3 -> total 5 <= 8

  const result = checkDirectAddCapacity(session, rsvps, 2);

  assert.equal(result.ok, true);
  assert.equal(result.currentGoing, 2);
  assert.equal(result.partySize, 3);
  assert.equal(result.spotsOpen, 6);
});

test('checkDirectAddCapacity: exactly fills the session', () => {
  const session = createMockSession(3);
  const rsvps = [
    createMockRsvp('s1', 'p1', 'going'),
    createMockRsvp('s1', 'p2', 'going'),
  ]; // currentGoing = 2, adding party size 1 -> total 3 == maxPlayers 3

  const result = checkDirectAddCapacity(session, rsvps, 0);

  assert.equal(result.ok, true);
  assert.equal(result.spotsOpen, 1);
  assert.equal(result.currentGoing, 2);
});

test('checkDirectAddCapacity: rejects when capacity exceeded without override', () => {
  const session = createMockSession(2);
  const rsvps = [
    createMockRsvp('s1', 'p1', 'going'),
    createMockRsvp('s1', 'p2', 'going'),
  ]; // currentGoing = 2, maxPlayers = 2

  const result = checkDirectAddCapacity(session, rsvps, 0, false);

  assert.equal(result.ok, false);
  assert.equal(result.spotsOpen, 0);
  assert.equal(result.currentGoing, 2);
  assert.equal(result.partySize, 1);
  assert.equal(result.error, 'This session is full.');
  assert.equal(result.warning, undefined);
});

test('checkDirectAddCapacity: allows capacity overflow when manager override is true', () => {
  const session = createMockSession(2);
  const rsvps = [
    createMockRsvp('s1', 'p1', 'going'),
    createMockRsvp('s1', 'p2', 'going'),
  ]; // currentGoing = 2, maxPlayers = 2

  const result = checkDirectAddCapacity(session, rsvps, 0, true);

  assert.equal(result.ok, true);
  assert.equal(result.spotsOpen, 0);
  assert.equal(result.currentGoing, 2);
  assert.equal(result.partySize, 1);
  assert.equal(result.error, undefined);
  assert.equal(result.warning, 'Session capacity exceeded (manager override).');
});

test('checkDirectAddCapacity: clamps guest count to 0..4', () => {
  const session = createMockSession(10);
  const rsvps: SessionRsvp[] = [];

  // Negative guests clamped to 0 -> partySize 1
  const resNeg = checkDirectAddCapacity(session, rsvps, -3);
  assert.equal(resNeg.partySize, 1);

  // Over 4 guests clamped to 4 -> partySize 5
  const resOver = checkDirectAddCapacity(session, rsvps, 10);
  assert.equal(resOver.partySize, 5);
});

test('checkDirectAddCapacity: cancelled RSVPs (out and late_out) do not count towards headcount', () => {
  const session = createMockSession(4);
  const rsvps = [
    createMockRsvp('s1', 'p1', 'going'),
    createMockRsvp('s1', 'p2', 'out'),
    createMockRsvp('s1', 'p3', 'late_out', 0, { penaltyPercentApplied: 50 }),
  ];

  const result = checkDirectAddCapacity(session, rsvps, 0);

  // Only p1 is going, so currentGoing is 1, spotsOpen is 3
  assert.equal(result.ok, true);
  assert.equal(result.currentGoing, 1);
  assert.equal(result.spotsOpen, 3);
});

// ---------------------------------------------------------------------------
// 5. Role Authorization Helper (canDirectAddPlayer)
// ---------------------------------------------------------------------------

test('canDirectAddPlayer: site admin is always authorized', () => {
  const club = createMockClub('c1', 'p_owner');
  const actingPlayer = createMockPlayer('p_any', 'Admin User', '#00');

  assert.equal(canDirectAddPlayer('c1', actingPlayer, 'admin', [club]), true);
  assert.equal(canDirectAddPlayer('c1', null, 'admin', [club]), true);
  assert.equal(canDirectAddPlayer('unknown_club', actingPlayer, 'admin', [club]), true);
});

test('canDirectAddPlayer: club owner of the session club is authorized', () => {
  const club = createMockClub('c1', 'p_owner');
  const ownerPlayer = createMockPlayer('p_owner', 'Club Owner', '#01');

  assert.equal(canDirectAddPlayer('c1', ownerPlayer, 'club_owner', [club]), true);
});

test('canDirectAddPlayer: club owner via ownerPlayerId fallback is authorized', () => {
  const club = createMockClub('c1', 'p_owner', { clubOwnerPlayerId: undefined });
  const ownerPlayer = createMockPlayer('p_owner', 'Club Owner', '#01');

  assert.equal(canDirectAddPlayer('c1', ownerPlayer, 'club_owner', [club]), true);
});

test('canDirectAddPlayer: owner of a different club is rejected', () => {
  const club1 = createMockClub('c1', 'p_owner_1');
  const club2 = createMockClub('c2', 'p_owner_2');
  const ownerPlayer1 = createMockPlayer('p_owner_1', 'Club 1 Owner', '#01');

  // owner of club 1 trying to add player to session in club 2
  assert.equal(canDirectAddPlayer('c2', ownerPlayer1, 'club_owner', [club1, club2]), false);
});

test('canDirectAddPlayer: regular participant (user tier) is rejected', () => {
  const club = createMockClub('c1', 'p_owner');
  const regularPlayer = createMockPlayer('p_regular', 'Regular Player', '#02');

  assert.equal(canDirectAddPlayer('c1', regularPlayer, 'user', [club]), false);
});

test('canDirectAddPlayer: rejects when actingPlayer is null and tier is not admin', () => {
  const club = createMockClub('c1', 'p_owner');

  assert.equal(canDirectAddPlayer('c1', null, 'club_owner', [club]), false);
  assert.equal(canDirectAddPlayer('c1', null, 'user', [club]), false);
});

test('canDirectAddPlayer: rejects when sessionClubId is empty or not found for non-admin', () => {
  const club = createMockClub('c1', 'p_owner');
  const ownerPlayer = createMockPlayer('p_owner', 'Club Owner', '#01');

  assert.equal(canDirectAddPlayer('', ownerPlayer, 'club_owner', [club]), false);
  assert.equal(canDirectAddPlayer('c_nonexistent', ownerPlayer, 'club_owner', [club]), false);
});
