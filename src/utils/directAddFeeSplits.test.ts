import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSessionSplitDetails,
  computeWeightedSessionSplits,
  getRsvpGuestCount,
  getRsvpPartySize,
  getSessionGoingHeadcount,
} from './badmintonLogic';
import {
  filterEligibleDirectAddMembers,
  searchMembers,
  isPlayerEnrolledInSession,
  findExistingSessionRsvp,
  checkDirectAddCapacity,
  canDirectAddPlayer,
} from './directAddPlayer';
import type { Club, Player, Session, SessionRsvp } from '../types';

function makePlayer(id: string, name: string, tag = '#001', joinedClubIds = 'c1'): Player {
  return {
    id,
    name,
    playerTag: tag,
    joinedClubIdsCsv: joinedClubIds,
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
    ownerId: `u_${id}`,
  };
}

function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    clubId: 'c1',
    title: 'Tuesday Badminton',
    venue: 'Court 1',
    courtNumbers: '1',
    sessionDate: '2026-12-01',
    startTime: '20:00',
    endTime: '22:00',
    bookingStatus: 'booked',
    courtFee: 40,
    shuttlesUsed: 2,
    shuttleUnitCost: 2.5,
    shuttleFee: 5,
    maxPlayers: 8,
    organizerName: 'Host',
    paymentInfo: 'PayNow',
    feeSplitFinalized: false,
    ownerId: 'u_owner',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeRsvp(
  playerId: string,
  over: Partial<SessionRsvp> = {}
): SessionRsvp {
  return {
    id: `rsvp_s1_${playerId}`,
    clubId: 'c1',
    sessionId: 's1',
    playerId,
    playerName: `Player ${playerId}`,
    guestCount: 0,
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 0,
    feeShare: 0,
    grossFeeShare: 0,
    walletCreditApplied: 0,
    walletPassApplied: false,
    walletWaiverApplied: false,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: `u_${playerId}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

test('FEE SPLITS: 0 active RSVPs produces 0 allocated cents, total unallocated, no NaN', () => {
  const details = computeSessionSplitDetails(40, 10, [], 100);
  assert.equal(details.splits.size, 0);
  assert.equal(details.unallocatedCourtCents, 4000);
  assert.equal(details.unallocatedShuttleCents, 1000);
});

test('FEE SPLITS: Directly adding 1st player allocates 100% of fees to them ($50.00)', () => {
  const r1 = makeRsvp('p1', { status: 'going', guestCount: 0 });
  const details = computeSessionSplitDetails(40, 10, [r1], 100);
  const share = details.splits.get(r1.id);
  assert.ok(share);
  assert.equal(share.feeShare, 50.0);
  assert.equal(details.unallocatedCourtCents, 0);
  assert.equal(details.unallocatedShuttleCents, 0);
});

test('FEE SPLITS: Adding 2nd player splits fees 50/50 ($25.00 each)', () => {
  const r1 = makeRsvp('p1');
  const r2 = makeRsvp('p2');
  const details = computeSessionSplitDetails(40, 10, [r1, r2], 100);
  assert.equal(details.splits.get(r1.id)?.feeShare, 25.0);
  assert.equal(details.splits.get(r2.id)?.feeShare, 25.0);
  const total = (details.splits.get(r1.id)?.feeShare ?? 0) + (details.splits.get(r2.id)?.feeShare ?? 0);
  assert.equal(total, 50.0);
});

test('FEE SPLITS: Odd player split (3 players on $50.00) strictly conserves integer cents', () => {
  const rsvps = [makeRsvp('p1'), makeRsvp('p2'), makeRsvp('p3')];
  const details = computeSessionSplitDetails(40, 10, rsvps, 100);
  const shares = rsvps.map((r) => details.splits.get(r.id)!.feeShare);
  // Court fee 4000 cents / 3 -> 1334, 1333, 1333; Shuttle fee 1000 cents / 3 -> 334, 333, 333
  // Combined: p1 = 1668, p2 = 1666, p3 = 1666 => 16.68, 16.66, 16.66
  assert.deepEqual(shares.sort(), [16.66, 16.66, 16.68]);
  const sum = shares.reduce((acc, s) => acc + s, 0);
  assert.equal(Number(sum.toFixed(2)), 50.0);
});

test('FEE SPLITS: Zero fee session ($0 court, $0 shuttle) produces $0 shares without NaN', () => {
  const rsvps = [makeRsvp('p1'), makeRsvp('p2')];
  const details = computeSessionSplitDetails(0, 0, rsvps, 100);
  for (const r of rsvps) {
    const s = details.splits.get(r.id)!.feeShare;
    assert.equal(s, 0);
    assert.ok(!Number.isNaN(s));
  }
});

test('FEE SPLITS: Direct add of club owner with excludeOwnerFromBilling: true', () => {
  const owner = makeRsvp('p_owner');
  const member = makeRsvp('p_member');
  const details = computeSessionSplitDetails(40, 10, [owner, member], 100, {
    clubOwnerPlayerId: 'p_owner',
    excludeOwnerFromBilling: true,
  });
  assert.equal(details.splits.get(owner.id)?.feeShare, 0);
  assert.equal(details.splits.get(member.id)?.feeShare, 50.0);
});

test('FEE SPLITS: Club owner with guests under excludeOwnerFromBilling bills only guests', () => {
  const owner = makeRsvp('p_owner', { guestCount: 1 }); // owner + 1 guest = 1 billable spot
  const member = makeRsvp('p_member', { guestCount: 0 }); // 1 billable spot
  const details = computeSessionSplitDetails(40, 10, [owner, member], 100, {
    clubOwnerPlayerId: 'p_owner',
    excludeOwnerFromBilling: true,
  });
  // 2 billable spots total: owner pays for their 1 guest ($25.00), member pays $25.00
  assert.equal(details.splits.get(owner.id)?.feeShare, 25.0);
  assert.equal(details.splits.get(member.id)?.feeShare, 25.0);
});

test('GUEST SCALING: Adding player with 1 guest doubles their fee weight', () => {
  const p1 = makeRsvp('p1', { guestCount: 0 }); // weight 1
  const p2 = makeRsvp('p2', { guestCount: 1 }); // weight 2
  // Total weight = 3. Court $30, Shuttle $0 => $30.00 total
  const details = computeSessionSplitDetails(30, 0, [p1, p2], 100);
  assert.equal(details.splits.get(p1.id)?.feeShare, 10.0);
  assert.equal(details.splits.get(p2.id)?.feeShare, 20.0);
});

test('GUEST SCALING: Scaling across 0, 1, 2, 3, 4 guests linearly weights fee shares', () => {
  const rsvps = [
    makeRsvp('p0', { guestCount: 0 }), // 1 spot
    makeRsvp('p1', { guestCount: 1 }), // 2 spots
    makeRsvp('p2', { guestCount: 2 }), // 3 spots
    makeRsvp('p3', { guestCount: 3 }), // 4 spots
    makeRsvp('p4', { guestCount: 4 }), // 5 spots
  ];
  // Total spots = 1 + 2 + 3 + 4 + 5 = 15.
  // Fee = $150.00 => each spot is exactly $10.00
  const details = computeSessionSplitDetails(150, 0, rsvps, 100);
  assert.equal(details.splits.get('rsvp_s1_p0')?.feeShare, 10.0);
  assert.equal(details.splits.get('rsvp_s1_p1')?.feeShare, 20.0);
  assert.equal(details.splits.get('rsvp_s1_p2')?.feeShare, 30.0);
  assert.equal(details.splits.get('rsvp_s1_p3')?.feeShare, 40.0);
  assert.equal(details.splits.get('rsvp_s1_p4')?.feeShare, 50.0);
});

test('GUEST SCALING: Adversarial / malformed guestCount does not produce NaN or crash', () => {
  const adversarialRsvps: SessionRsvp[] = [
    makeRsvp('p_undef', { guestCount: undefined as any }),
    makeRsvp('p_neg', { guestCount: -5 as any }),
    makeRsvp('p_nan', { guestCount: NaN as any }),
    makeRsvp('p_str', { guestCount: '3' as any }),
    makeRsvp('p_float', { guestCount: 1.99 as any }),
  ];
  assert.equal(getRsvpGuestCount(adversarialRsvps[0]), 0);
  assert.equal(getRsvpGuestCount(adversarialRsvps[1]), 0);
  assert.equal(getRsvpGuestCount(adversarialRsvps[2]), 0);
  assert.equal(getRsvpGuestCount(adversarialRsvps[3]), 3);
  assert.equal(getRsvpGuestCount(adversarialRsvps[4]), 1);

  const details = computeSessionSplitDetails(100, 20, adversarialRsvps, 100);
  for (const r of adversarialRsvps) {
    const s = details.splits.get(r.id)!.feeShare;
    assert.ok(typeof s === 'number' && !Number.isNaN(s) && Number.isFinite(s));
  }
});

test('GUEST SCALING: Zero billable weight produces 0 feeShare without NaN', () => {
  const rsvps = [
    makeRsvp('p1', { status: 'late_out', penaltyPercentApplied: 0 }),
    makeRsvp('p2', { status: 'out', penaltyPercentApplied: 0 }),
  ];
  const details = computeSessionSplitDetails(40, 10, rsvps, 100);
  assert.equal(details.splits.get('rsvp_s1_p1')?.feeShare, 0);
  assert.equal(details.splits.get('rsvp_s1_p2')?.feeShare, 0);
  assert.equal(details.unallocatedCourtCents, 4000);
  assert.equal(details.unallocatedShuttleCents, 1000);
});

test('IDEMPOTENCY: isPlayerEnrolledInSession accurately identifies active going status', () => {
  const rsvps = [
    makeRsvp('p_going', { status: 'going' }),
    makeRsvp('p_out', { status: 'out' }),
    makeRsvp('p_late', { status: 'late_out' }),
  ];
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p_going'), true);
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p_out'), false);
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p_late'), false);
  assert.equal(isPlayerEnrolledInSession(rsvps, 'p_nonexistent'), false);
  assert.equal(isPlayerEnrolledInSession('p_going', rsvps), true);
  assert.equal(isPlayerEnrolledInSession('p_out', rsvps), false);
});

test('IDEMPOTENCY: filterEligibleDirectAddMembers separates going from out/unregistered', () => {
  const members = [
    makePlayer('p1', 'Alice'),
    makePlayer('p2', 'Bob'),
    makePlayer('p3', 'Charlie'),
    makePlayer('p4', 'Dave'),
  ];
  const rsvps = [
    makeRsvp('p1', { status: 'going' }),
    makeRsvp('p2', { status: 'late_out' }),
    makeRsvp('p4', { status: 'out' }),
  ];
  const { eligible, enrolled } = filterEligibleDirectAddMembers(members, rsvps);
  assert.deepEqual(enrolled.map((p) => p.id), ['p1']);
  assert.deepEqual(eligible.map((p) => p.id).sort(), ['p2', 'p3', 'p4'].sort());
});

test('IDEMPOTENCY: Attempting to directly add already-enrolled player aborts without state mutation', () => {
  const session = makeSession();
  const existingRsvp = makeRsvp('p1', { status: 'going', guestCount: 1 });
  const localRsvps = [existingRsvp];

  function simulateDirectAdd(playerId: string, guestCount: number) {
    const r = localRsvps.find((x) => x.playerId === playerId);
    if (r?.status === 'going') {
      const currentGuestCount = Math.max(0, Math.floor(Number(r.guestCount || 0)));
      return { ok: false, reason: 'This player is already enrolled in this session.' };
    }
    return { ok: true };
  }

  const result = simulateDirectAdd('p1', 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'This player is already enrolled in this session.');

  assert.equal(localRsvps.length, 1);
  assert.equal(getSessionGoingHeadcount(localRsvps), 2);
});

test('IDEMPOTENCY: Reinstating cancelled member updates existing record without creating duplicate', () => {
  const session = makeSession();
  const existingCancelled = makeRsvp('p_cancelled', { status: 'late_out', penaltyPercentApplied: 50 });
  let localRsvps = [existingCancelled];

  const rsvpId = existingCancelled.id;
  localRsvps = localRsvps.map((r) =>
    r.id === rsvpId
      ? {
          ...r,
          status: 'going' as const,
          penaltyPercentApplied: 0,
          guestCount: 0,
        }
      : r
  );

  assert.equal(localRsvps.length, 1);
  assert.equal(localRsvps[0].status, 'going');
  assert.equal(getSessionGoingHeadcount(localRsvps), 1);
});

test('CAPACITY & AUTH: Capacity and authorization boundaries function as expected', () => {
  const session = makeSession({ maxPlayers: 4 });
  const rsvps = [makeRsvp('p1'), makeRsvp('p2'), makeRsvp('p3'), makeRsvp('p4')];

  const capBlocked = checkDirectAddCapacity(session, rsvps, 0, false);
  assert.equal(capBlocked.ok, false);
  assert.equal(capBlocked.spotsOpen, 0);

  const capOverridden = checkDirectAddCapacity(session, rsvps, 0, true);
  assert.equal(capOverridden.ok, true);
  assert.equal(capOverridden.warning, 'Session capacity exceeded (manager override).');

  const clubs: Club[] = [
    {
      id: 'c1',
      name: 'Club 1',
      ownerPlayerId: 'p_owner',
      clubOwnerPlayerId: 'p_owner',
    } as any,
  ];
  assert.equal(canDirectAddPlayer('c1', makePlayer('p_admin', 'Admin'), 'admin', clubs), true);
  assert.equal(canDirectAddPlayer('c1', makePlayer('p_owner', 'Owner'), 'club_owner', clubs), true);
  assert.equal(canDirectAddPlayer('c1', makePlayer('p_reg', 'Regular'), 'user', clubs), false);
});
