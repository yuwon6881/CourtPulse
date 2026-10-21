import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateMatchStatDeltas,
  applyStatDelta,
  applyWalletToSingleRsvp,
  applyWalletsToFinalizedSessionRsvps,
  computePlayerLeaderboardAndTiers,
  computeRating,
  getMatchStatDelta,
  computeWeightedSessionSplits,
  evaluateTapOutWindow,
  getRsvpAdjustment,
  makeClubWalletKey,
  recalculatePlayerStatsFromMatches,
  restoreSessionRsvpsAndWalletsForReopen,
  settlePlayerExistingUnpaidRsvpsWithWallet,
  sortMatchesChronologically,
  validateBadmintonMatchScores,
} from './badmintonLogic.ts';
import type {
  BadmintonMatch,
  Club,
  Player,
  PlayerBenefitWallet,
  Session,
  SessionRsvp,
} from '../types.ts';

function makeRsvp(overrides: Partial<SessionRsvp> & { id: string; playerId: string }): SessionRsvp {
  return {
    id: overrides.id,
    clubId: overrides.clubId ?? 'club_1',
    sessionId: overrides.sessionId ?? 'sess_1',
    playerId: overrides.playerId,
    playerName: overrides.playerName ?? overrides.playerId,
    guestCount: overrides.guestCount ?? 0,
    status: overrides.status ?? 'going',
    attendanceOutcome: overrides.attendanceOutcome ?? 'present',
    penaltyPercentApplied: overrides.penaltyPercentApplied ?? 0,
    feeShare: overrides.feeShare ?? 0,
    grossFeeShare: overrides.grossFeeShare ?? 0,
    walletCreditApplied: overrides.walletCreditApplied ?? 0,
    walletPassApplied: overrides.walletPassApplied ?? false,
    walletWaiverApplied: overrides.walletWaiverApplied ?? false,
    paidStatus: overrides.paidStatus ?? 'unpaid',
    paidMethod: overrides.paidMethod ?? 'pending',
    ownerId: overrides.ownerId ?? 'owner_1',
  };
}

test('computeWeightedSessionSplits uses largest-remainder cents so shares sum to exact total', () => {
  // $50 / 3 -> [16.67, 16.67, 16.66], sum === 50.00
  const rsvps3 = [
    makeRsvp({ id: 'r1', playerId: 'p1' }),
    makeRsvp({ id: 'r2', playerId: 'p2' }),
    makeRsvp({ id: 'r3', playerId: 'p3' }),
  ];
  const split50 = computeWeightedSessionSplits(50, 0, rsvps3, 100);
  const shares50 = rsvps3.map((r) => split50.get(r.id)!.feeShare);
  assert.deepEqual(shares50, [16.67, 16.67, 16.66]);
  assert.equal(Number(shares50.reduce((a, b) => a + b, 0).toFixed(2)), 50.0);

  // $100 / 6 -> sum === 100.00
  const rsvps6 = Array.from({ length: 6 }, (_, i) =>
    makeRsvp({ id: `r${i + 1}`, playerId: `p${i + 1}` })
  );
  const split100 = computeWeightedSessionSplits(80, 20, rsvps6, 100);
  const sum100 = Number(
    rsvps6.reduce((acc, r) => acc + split100.get(r.id)!.feeShare, 0).toFixed(2)
  );
  assert.equal(sum100, 100.0);

  // $78 / 7 -> sum === 78.00
  const rsvps7 = Array.from({ length: 7 }, (_, i) =>
    makeRsvp({ id: `r${i + 1}`, playerId: `p${i + 1}` })
  );
  const split78 = computeWeightedSessionSplits(60, 18, rsvps7, 100);
  const sum78 = Number(
    rsvps7.reduce((acc, r) => acc + split78.get(r.id)!.feeShare, 0).toFixed(2)
  );
  assert.equal(sum78, 78.0);

  // Mixed weights: 100% present + 50% late_out + 50% late_out
  const mixedRsvps = [
    makeRsvp({ id: 'r1', playerId: 'p1', status: 'going', attendanceOutcome: 'present' }),
    makeRsvp({ id: 'r2', playerId: 'p2', status: 'late_out', penaltyPercentApplied: 50 }),
    makeRsvp({ id: 'r3', playerId: 'p3', status: 'late_out', penaltyPercentApplied: 50 }),
  ];
  const splitMixed = computeWeightedSessionSplits(40, 10, mixedRsvps, 100);
  assert.equal(splitMixed.get('r1')!.feeShare, 30); // $20 court + $10 shuttle
  assert.equal(splitMixed.get('r2')!.feeShare, 10); // $10 court + $0 shuttle
  assert.equal(splitMixed.get('r3')!.feeShare, 10);
  assert.equal(
    Number(mixedRsvps.reduce((a, r) => a + splitMixed.get(r.id)!.feeShare, 0).toFixed(2)),
    50.0
  );

  // Guest party sizes: 2x (player + 1 guest) + 1x + 1x = 4 spots for $50
  const guestRsvps = [
    makeRsvp({ id: 'r1', playerId: 'p1', guestCount: 1 }),
    makeRsvp({ id: 'r2', playerId: 'p2', guestCount: 0 }),
    makeRsvp({ id: 'r3', playerId: 'p3', guestCount: 0 }),
  ];
  const splitGuests = computeWeightedSessionSplits(40, 10, guestRsvps, 100);
  assert.equal(splitGuests.get('r1')!.feeShare, 25.0);
  assert.equal(splitGuests.get('r2')!.feeShare, 12.5);
  assert.equal(splitGuests.get('r3')!.feeShare, 12.5);

  // excludeOwnerFromBilling: owner with 0 guests pays $0; owner with +1 guest pays 1 guest spot
  const ownerNoGuest = computeWeightedSessionSplits(40, 0, rsvps3, 100, {
    clubOwnerPlayerId: 'p1',
    excludeOwnerFromBilling: true,
  });
  assert.equal(ownerNoGuest.get('r1')!.feeShare, 0);
  assert.equal(ownerNoGuest.get('r2')!.feeShare, 20);
  assert.equal(ownerNoGuest.get('r3')!.feeShare, 20);

  const ownerWithGuest = computeWeightedSessionSplits(30, 0, guestRsvps, 100, {
    clubOwnerPlayerId: 'p1',
    excludeOwnerFromBilling: true,
  });
  // p1 has 1 guest (1 billable spot), p2 has 1 spot, p3 has 1 spot -> $10 each
  assert.equal(ownerWithGuest.get('r1')!.feeShare, 10);
  assert.equal(ownerWithGuest.get('r2')!.feeShare, 10);
  assert.equal(ownerWithGuest.get('r3')!.feeShare, 10);

  // 0 present headcount -> all $0
  const outRsvps = [makeRsvp({ id: 'r1', playerId: 'p1', status: 'out' })];
  const splitZero = computeWeightedSessionSplits(50, 10, outRsvps, 100);
  assert.equal(splitZero.get('r1')!.feeShare, 0);
});

test('P1-1e 12-case wallet / fee-split / re-finalize / reopen / top-up matrix', () => {
  const baseRsvp = makeRsvp({ id: 'rsvp_sess_1_p1', playerId: 'p1', clubId: 'club_1', sessionId: 'sess_1' });

  // Case 1: Waiver ON, $15 share -> feeShare 0, paid, walletWaiverApplied true, wallet unchanged
  const c1 = applyWalletToSingleRsvp({
    rsvp: baseRsvp,
    grossFeeShare: 15,
    penaltyPercentApplied: 100,
    wallet: { creditBalance: 20, freeSessionPasses: 2, waiveAllFees: true },
    finalizeSplit: true,
  });
  assert.equal(c1.updatedRsvp.feeShare, 0);
  assert.equal(c1.updatedRsvp.paidStatus, 'paid');
  assert.equal(c1.updatedRsvp.walletWaiverApplied, true);
  assert.equal(c1.updatedWallet.creditBalance, 20);
  assert.equal(c1.updatedWallet.freeSessionPasses, 2);

  // Case 2: 2 free passes, $15 share -> feeShare 0, paid, walletPassApplied true, freeSessionPasses -> 1
  const c2 = applyWalletToSingleRsvp({
    rsvp: baseRsvp,
    grossFeeShare: 15,
    penaltyPercentApplied: 100,
    wallet: { creditBalance: 20, freeSessionPasses: 2, waiveAllFees: false },
    finalizeSplit: true,
  });
  assert.equal(c2.updatedRsvp.feeShare, 0);
  assert.equal(c2.updatedRsvp.paidStatus, 'paid');
  assert.equal(c2.updatedRsvp.walletPassApplied, true);
  assert.equal(c2.updatedWallet.freeSessionPasses, 1);
  assert.equal(c2.updatedWallet.creditBalance, 20);

  // Case 3: $20 credit, $15 share -> feeShare 0, paid, walletCreditApplied 15, creditBalance -> 5
  const c3 = applyWalletToSingleRsvp({
    rsvp: baseRsvp,
    grossFeeShare: 15,
    penaltyPercentApplied: 100,
    wallet: { creditBalance: 20, freeSessionPasses: 0, waiveAllFees: false },
    finalizeSplit: true,
  });
  assert.equal(c3.updatedRsvp.feeShare, 0);
  assert.equal(c3.updatedRsvp.paidStatus, 'paid');
  assert.equal(c3.updatedRsvp.walletCreditApplied, 15);
  assert.equal(c3.updatedWallet.creditBalance, 5);

  // Case 4: $10 credit, $15 share -> feeShare 5, unpaid, walletCreditApplied 10, creditBalance -> 0
  const c4 = applyWalletToSingleRsvp({
    rsvp: baseRsvp,
    grossFeeShare: 15,
    penaltyPercentApplied: 100,
    wallet: { creditBalance: 10, freeSessionPasses: 0, waiveAllFees: false },
    finalizeSplit: true,
  });
  assert.equal(c4.updatedRsvp.feeShare, 5);
  assert.equal(c4.updatedRsvp.paidStatus, 'unpaid');
  assert.equal(c4.updatedRsvp.walletCreditApplied, 10);
  assert.equal(c4.updatedWallet.creditBalance, 0);

  // Case 5: Empty wallet, $15 share -> feeShare 15, unpaid, pending
  const c5 = applyWalletToSingleRsvp({
    rsvp: baseRsvp,
    grossFeeShare: 15,
    penaltyPercentApplied: 100,
    wallet: { creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false },
    finalizeSplit: true,
  });
  assert.equal(c5.updatedRsvp.feeShare, 15);
  assert.equal(c5.updatedRsvp.paidStatus, 'unpaid');
  assert.equal(c5.updatedRsvp.paidMethod, 'pending');

  // Case 6: Re-finalize same session (Case 2 -> shuttle count edited so share is $18)
  // Pass is refunded then re-applied: freeSessionPasses stays 1, not 0
  const c6 = applyWalletToSingleRsvp({
    rsvp: c2.updatedRsvp,
    grossFeeShare: 18,
    penaltyPercentApplied: 100,
    wallet: c2.updatedWallet,
    finalizeSplit: true,
  });
  assert.equal(c6.updatedRsvp.feeShare, 0);
  assert.equal(c6.updatedRsvp.walletPassApplied, true);
  assert.equal(c6.updatedWallet.freeSessionPasses, 1);

  // Case 7: Re-finalize same session (Case 3 -> share becomes $12)
  // $15 refunded then $12 taken: creditBalance is 8, walletCreditApplied 12, feeShare 0, paid
  const c7 = applyWalletToSingleRsvp({
    rsvp: c3.updatedRsvp,
    grossFeeShare: 12,
    penaltyPercentApplied: 100,
    wallet: c3.updatedWallet,
    finalizeSplit: true,
  });
  assert.equal(c7.updatedWallet.creditBalance, 8);
  assert.equal(c7.updatedRsvp.walletCreditApplied, 12);
  assert.equal(c7.updatedRsvp.feeShare, 0);
  assert.equal(c7.updatedRsvp.paidStatus, 'paid');

  // Case 8: Re-finalize same session (Case 4 -> share becomes $8)
  // $10 refunded then $8 taken: creditBalance is 2, walletCreditApplied 8, feeShare 0, paid
  const c8 = applyWalletToSingleRsvp({
    rsvp: c4.updatedRsvp,
    grossFeeShare: 8,
    penaltyPercentApplied: 100,
    wallet: c4.updatedWallet,
    finalizeSplit: true,
  });
  assert.equal(c8.updatedWallet.creditBalance, 2);
  assert.equal(c8.updatedRsvp.walletCreditApplied, 8);
  assert.equal(c8.updatedRsvp.feeShare, 0);
  assert.equal(c8.updatedRsvp.paidStatus, 'paid');

  // Case 9: Reopen finalized session -> all walletCreditApplied / walletPassApplied refunded, RSVP ledger zeroed
  const walletKey = makeClubWalletKey('club_1', 'p1');
  const c9 = restoreSessionRsvpsAndWalletsForReopen({
    sessionRsvps: [c3.updatedRsvp],
    walletsMap: { [walletKey]: c3.updatedWallet },
  });
  assert.equal(c9.restoredWalletsMap[walletKey].creditBalance, 20);
  assert.equal(c9.restoredSessionRsvps[0].feeShare, 0);
  assert.equal(c9.restoredSessionRsvps[0].walletCreditApplied, 0);
  assert.equal(c9.restoredSessionRsvps[0].paidStatus, 'unpaid');

  // Case 10: Post-session wallet top-up after partial credit (Case 4 then owner sets credit to $10)
  // $10 prior credit refunded -> $20 available -> $15 applied -> feeShare 0, paid, walletCreditApplied 15, creditBalance 5
  const completedSession: Session = {
    id: 'sess_1',
    clubId: 'club_1',
    title: 'Night Smash',
    venue: 'Hall A',
    courtNumbers: 'Court 1',
    sessionDate: '2026-10-10',
    startTime: '20:00',
    endTime: '22:00',
    bookingStatus: 'completed',
    courtFee: 15,
    shuttlesUsed: 0,
    shuttleUnitCost: 3,
    shuttleFee: 0,
    maxPlayers: 8,
    organizerName: 'Host',
    paymentInfo: 'PayNow',
    feeSplitFinalized: true,
    ownerId: 'owner_1',
  };
  const c10 = settlePlayerExistingUnpaidRsvpsWithWallet({
    playerId: 'p1',
    clubId: 'club_1',
    wallet: { creditBalance: 10, freeSessionPasses: 0, waiveAllFees: false },
    rsvps: [c4.updatedRsvp],
    sessions: [completedSession],
  });
  assert.equal(c10.updatedRsvps[0].feeShare, 0);
  assert.equal(c10.updatedRsvps[0].paidStatus, 'paid');
  assert.equal(c10.updatedRsvps[0].walletCreditApplied, 15);
  assert.equal(c10.remainingWallet.creditBalance, 5);

  // Case 11: Cash-paid row untouched on re-finalize when share unchanged
  const cashPaidRsvp = makeRsvp({
    id: 'rsvp_cash',
    playerId: 'p2',
    feeShare: 15,
    grossFeeShare: 15,
    paidStatus: 'paid',
    paidMethod: 'Approved',
  });
  const c11 = applyWalletToSingleRsvp({
    rsvp: cashPaidRsvp,
    grossFeeShare: 15,
    penaltyPercentApplied: 100,
    wallet: { creditBalance: 50, freeSessionPasses: 2, waiveAllFees: false },
    finalizeSplit: true,
  });
  assert.equal(c11.updatedRsvp.paidStatus, 'paid');
  assert.equal(c11.updatedRsvp.paidMethod, 'Approved');
  assert.equal(c11.updatedWallet.creditBalance, 50);
  assert.equal(c11.updatedWallet.freeSessionPasses, 2);

  // Case 12: Cash-paid row when share changes on re-finalize -> stays paid (real money is never
  // wiped); cash collected (feeShare) is kept and the difference is reported as an adjustment
  const c12 = applyWalletToSingleRsvp({
    rsvp: cashPaidRsvp,
    grossFeeShare: 18,
    penaltyPercentApplied: 100,
    wallet: { creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false },
    finalizeSplit: true,
  });
  assert.equal(c12.updatedRsvp.paidStatus, 'paid');
  assert.equal(c12.updatedRsvp.paidMethod, 'Approved');
  assert.equal(c12.updatedRsvp.feeShare, 15);
  assert.equal(c12.updatedRsvp.grossFeeShare, 18);
  const c12Adj = getRsvpAdjustment(c12.updatedRsvp);
  assert.equal(c12Adj.kind, 'due');
  assert.equal(c12Adj.amount, 3);

  // Verify applyWalletsToFinalizedSessionRsvps integrates splits + wallets
  const batchRes = applyWalletsToFinalizedSessionRsvps({
    sessionRsvps: [baseRsvp],
    splits: new Map([['rsvp_sess_1_p1', { feeShare: 15, penaltyPercentApplied: 100 }]]),
    walletsMap: { [walletKey]: { creditBalance: 20, freeSessionPasses: 0, waiveAllFees: false } },
    finalizeSplit: true,
  });
  assert.equal(batchRes.updatedSessionRsvps[0].feeShare, 0);
  assert.equal(batchRes.updatedWalletsMap[walletKey].creditBalance, 5);
});

test('evaluateTapOutWindow enforces lock and penalty windows by clock time', () => {
  const club: Club = {
    id: 'club_1',
    name: 'Test Club',
    description: 'Desc',
    paymentInfo: 'PayNow',
    freeCancelHours: 24,
    lockCancelHours: 4,
    lateCancelFeePercent: 50,
    noShowFeePercent: 100,
    ownerId: 'owner_1',
  };
  const session: Session = {
    id: 'sess_1',
    clubId: 'club_1',
    title: 'Evening Play',
    venue: 'Hall',
    courtNumbers: 'Court 1',
    sessionDate: '2026-10-20',
    startTime: '20:00',
    endTime: '22:00',
    bookingStatus: 'booked',
    courtFee: 60,
    shuttlesUsed: 0,
    shuttleUnitCost: 3,
    shuttleFee: 0,
    maxPlayers: 8,
    organizerName: 'Host',
    paymentInfo: 'PayNow',
    feeSplitFinalized: false,
    ownerId: 'owner_1',
  };

  // 20:00 in the default club zone (Asia/Singapore) = 12:00Z; managers store it as startsAt.
  const startMs = Date.UTC(2026, 9, 20, 12, 0, 0, 0);
  session.startsAt = new Date(startMs);
  session.lateCancelUntil = new Date(startMs - 4 * 3600 * 1000); // lockCancelHours 4
  session.freeCancelUntil = new Date(startMs - 24 * 3600 * 1000); // freeCancelHours 24

  // 30h before start -> free tap-out
  const freeEval = evaluateTapOutWindow(session, club, startMs - 30 * 3600 * 1000);
  assert.equal(freeEval.canTapOut, true);
  assert.equal(freeEval.isPenaltyWindow, false);
  assert.equal(freeEval.penaltyPercent, 0);

  // 12h before start -> penalty window (50%)
  const lateEval = evaluateTapOutWindow(session, club, startMs - 12 * 3600 * 1000);
  assert.equal(lateEval.canTapOut, true);
  assert.equal(lateEval.isPenaltyWindow, true);
  assert.equal(lateEval.penaltyPercent, 50);

  // 2h before start (inside 4h lockCancelHours) -> locked
  const lockedEval = evaluateTapOutWindow(session, club, startMs - 2 * 3600 * 1000);
  assert.equal(lockedEval.canTapOut, false);

  // After start -> locked
  const pastEval = evaluateTapOutWindow(session, club, startMs + 1800 * 1000);
  assert.equal(pastEval.canTapOut, false);

  // Unparseable date -> locked
  const badDateEval = evaluateTapOutWindow(
    { ...session, sessionDate: 'invalid-date', startsAt: null },
    club,
    startMs
  );
  assert.equal(badDateEval.canTapOut, false);
});

test('validateBadmintonMatchScores enforces BWF scoring rules', () => {
  assert.equal(validateBadmintonMatchScores(21, 19, 21), null);
  assert.equal(validateBadmintonMatchScores(19, 21, 21), null);
  assert.equal(validateBadmintonMatchScores(22, 20, 21), null);
  assert.equal(validateBadmintonMatchScores(30, 29, 21), null);
  assert.equal(validateBadmintonMatchScores(30, 28, 21), null);

  assert.notEqual(validateBadmintonMatchScores(20, 19, 21), null);
  assert.notEqual(validateBadmintonMatchScores(21, 20, 21), null);
  assert.notEqual(validateBadmintonMatchScores(31, 29, 21), null);
  assert.notEqual(validateBadmintonMatchScores(11, 0, 21), null);
  assert.notEqual(validateBadmintonMatchScores(25, 20, 21), null);
  assert.notEqual(validateBadmintonMatchScores(30, 20, 21), null);

  // Custom 11-point game target
  assert.equal(validateBadmintonMatchScores(11, 9, 11), null);
  assert.notEqual(validateBadmintonMatchScores(11, 10, 11), null);
});

test('sortMatchesChronologically and leaderboard/stat calculations are order-independent', () => {
  const players: Player[] = [
    {
      id: 'p1',
      name: 'Alice',
      playerTag: '#AL01',
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
      ownerId: 'u1',
    },
    {
      id: 'p2',
      name: 'Bob',
      playerTag: '#BO02',
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
      ownerId: 'u2',
    },
  ];

  const m1: BadmintonMatch = {
    id: 'match_1000',
    clubId: 'club_1',
    sessionId: 'sess_1',
    matchFormat: 'singles',
    teamAPlayer1Id: 'p1',
    teamAPlayer1Name: 'Alice',
    teamAPlayer2Id: 'NONE',
    teamAPlayer2Name: 'None',
    teamBPlayer1Id: 'p2',
    teamBPlayer1Name: 'Bob',
    teamBPlayer2Id: 'NONE',
    teamBPlayer2Name: 'None',
    scoreTeamA: 21,
    scoreTeamB: 15,
    setScoresText: '21-15',
    winnerSide: 'A',
    ownerId: 'u1',
    createdAt: '2026-10-01T20:10:00.000Z',
  };
  const m2: BadmintonMatch = {
    ...m1,
    id: 'match_2000',
    scoreTeamA: 18,
    scoreTeamB: 21,
    setScoresText: '18-21',
    winnerSide: 'B',
    createdAt: '2026-10-01T20:40:00.000Z',
  };

  const forward = computePlayerLeaderboardAndTiers(players, [m1, m2]);
  const reverse = computePlayerLeaderboardAndTiers(players, [m2, m1]);

  const aliceForward = forward.find((p) => p.id === 'p1')!;
  const aliceReverse = reverse.find((p) => p.id === 'p1')!;
  assert.deepEqual(aliceForward.recentForm, ['W', 'L']);
  assert.deepEqual(aliceReverse.recentForm, ['W', 'L']);
  assert.equal(aliceForward.ratingScore, aliceReverse.ratingScore);

  const recalc = recalculatePlayerStatsFromMatches(players, [m2, m1]);
  const aliceRecalc = recalc.find((p) => p.id === 'p1')!;
  assert.equal(aliceRecalc.ratingScore, aliceForward.ratingScore);
  assert.equal(aliceRecalc.gamesPlayed, 2);

  const sorted = sortMatchesChronologically([m2, m1]);
  assert.deepEqual(
    sorted.map((m) => m.id),
    ['match_1000', 'match_2000']
  );
});

function makeMatch(
  overrides: Partial<BadmintonMatch> & { id: string }
): BadmintonMatch {
  return {
    clubId: 'club_1',
    sessionId: 'sess_1',
    matchFormat: 'singles',
    teamAPlayer1Id: 'p1',
    teamAPlayer1Name: 'Alice',
    teamAPlayer2Id: 'NONE',
    teamAPlayer2Name: 'None',
    teamBPlayer1Id: 'p2',
    teamBPlayer1Name: 'Bob',
    teamBPlayer2Id: 'NONE',
    teamBPlayer2Name: 'None',
    scoreTeamA: 21,
    scoreTeamB: 15,
    setScoresText: '21-15',
    winnerSide: 'A',
    ownerId: 'u1',
    ...overrides,
  };
}

function makeSession(id: string, sessionDate: string): Session {
  return { id, sessionDate, startTime: '20:00' } as unknown as Session;
}

test('validateBadmintonMatchScores handles every target preset and edge', () => {
  // 21 (BWF): cap at 30
  assert.equal(validateBadmintonMatchScores(22, 20, 21), null);
  assert.equal(validateBadmintonMatchScores(30, 29, 21), null);
  assert.notEqual(validateBadmintonMatchScores(31, 29, 21), null);
  assert.notEqual(validateBadmintonMatchScores(21, 21, 21), null, 'tie rejected');
  assert.notEqual(validateBadmintonMatchScores(0, 0, 21), null);

  // 11-point game: win by 2, and long deuces are fine up to the 30 cap
  assert.equal(validateBadmintonMatchScores(11, 0, 11), null);
  assert.equal(validateBadmintonMatchScores(11, 9, 11), null);
  assert.equal(validateBadmintonMatchScores(12, 10, 11), null);
  assert.equal(validateBadmintonMatchScores(25, 23, 11), null);
  assert.equal(validateBadmintonMatchScores(30, 29, 11), null);
  assert.notEqual(validateBadmintonMatchScores(11, 10, 11), null);
  assert.notEqual(validateBadmintonMatchScores(10, 8, 11), null);
  assert.notEqual(validateBadmintonMatchScores(31, 29, 11), null);

  // 15-point game
  assert.equal(validateBadmintonMatchScores(15, 13, 15), null);
  assert.equal(validateBadmintonMatchScores(17, 15, 15), null);
  assert.notEqual(validateBadmintonMatchScores(15, 14, 15), null);
  assert.notEqual(validateBadmintonMatchScores(14, 5, 15), null);

  // 30-point game: cap is target + 9
  assert.equal(validateBadmintonMatchScores(30, 28, 30), null);
  assert.equal(validateBadmintonMatchScores(31, 29, 30), null);
  assert.equal(validateBadmintonMatchScores(39, 38, 30), null);
  assert.notEqual(validateBadmintonMatchScores(30, 29, 30), null);
  assert.notEqual(validateBadmintonMatchScores(40, 38, 30), null);
  assert.notEqual(validateBadmintonMatchScores(29, 10, 30), null);

  // Targets are clamped to 11..30
  assert.equal(validateBadmintonMatchScores(11, 5, 3), null);
  assert.equal(validateBadmintonMatchScores(30, 28, 99), null);

  // Numeric strings (form input) are coerced; garbage is rejected
  assert.equal(
    validateBadmintonMatchScores('21' as unknown as number, '19' as unknown as number, 21),
    null
  );
  assert.notEqual(
    validateBadmintonMatchScores('abc' as unknown as number, 12, 21),
    null
  );
  assert.notEqual(validateBadmintonMatchScores(21.5, 10, 21), null);
  assert.notEqual(validateBadmintonMatchScores(-1, 21, 21), null);
});

test('sortMatchesChronologically is a total order with missing sessions and pending createdAt', () => {
  const sessions = [
    makeSession('s_early', '2026-10-01'),
    makeSession('s_late', '2026-10-08'),
  ];
  // m_unknown has no matching session: it is placed by its own createdAt (a date in between)
  const mEarly = makeMatch({
    id: 'm_early',
    sessionId: 's_early',
    createdAt: '2026-10-09T00:00:00.000Z', // written late, played early
  });
  const mLate = makeMatch({
    id: 'm_late',
    sessionId: 's_late',
    createdAt: '2026-10-02T00:00:00.000Z',
  });
  const mUnknown = makeMatch({
    id: 'm_unknown',
    sessionId: 's_gone',
    createdAt: '2026-10-05T00:00:00.000Z',
  });
  const mPending = makeMatch({
    id: 'm_pending',
    sessionId: 's_gone',
    createdAt: null,
  });

  const all = [mPending, mLate, mUnknown, mEarly];
  const expected = ['m_early', 'm_unknown', 'm_late', 'm_pending'];
  assert.deepEqual(
    sortMatchesChronologically(all, sessions).map((m) => m.id),
    expected
  );

  // Every permutation sorts identically (the comparator is a total order)
  const permutations = (items: BadmintonMatch[]): BadmintonMatch[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, i) =>
          permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(
            (rest) => [item, ...rest]
          )
        );
  for (const perm of permutations(all)) {
    assert.deepEqual(
      sortMatchesChronologically(perm, sessions).map((m) => m.id),
      expected
    );
  }

  // No sessions at all: createdAt, then the id's timestamp, decide
  assert.deepEqual(
    sortMatchesChronologically([mPending, mLate, mUnknown, mEarly]).map((m) => m.id),
    ['m_late', 'm_unknown', 'm_early', 'm_pending']
  );
});

test('sortMatchesChronologically orders within a session by createdAt, pending newest, ties by id', () => {
  const sessions = [makeSession('s1', '2026-10-01')];
  const a = makeMatch({ id: 'match_b', createdAt: '2026-10-01T20:10:00.000Z' });
  const b = makeMatch({ id: 'match_a', createdAt: '2026-10-01T20:10:00.000Z' });
  const c = makeMatch({ id: 'match_c', createdAt: '2026-10-01T20:30:00.000Z' });
  const pending = makeMatch({ id: 'match_0', createdAt: null });
  // Ids with no digits and no createdAt fall back to 0 (oldest) without throwing
  const legacy = makeMatch({ id: 'legacy' });

  assert.deepEqual(
    sortMatchesChronologically([pending, c, a, legacy, b], sessions).map((m) => m.id),
    ['legacy', 'match_a', 'match_b', 'match_c', 'match_0']
  );
});

test('computeRating is the single formula, bounded, and clamps lopsided results', () => {
  assert.equal(
    computeRating({ wins: 0, losses: 0, pointsScored: 0, pointsConceded: 0 }),
    1200
  );

  // Matches the leaderboard's rating for the same record
  const players: Player[] = ['p1', 'p2'].map((id) => ({
    id,
    name: id,
    playerTag: `#${id}`,
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
    ownerId: 'u',
  }));
  const ranked = computePlayerLeaderboardAndTiers(players, [
    makeMatch({ id: 'match_1', createdAt: '2026-10-01T20:00:00.000Z' }),
  ]);
  const p1 = ranked.find((p) => p.id === 'p1')!;
  assert.equal(
    p1.ratingScore,
    computeRating({ wins: 1, losses: 0, pointsScored: 21, pointsConceded: 15 })
  );

  // A single 500-0 result cannot run away
  const huge = computeRating({ wins: 1, losses: 0, pointsScored: 500, pointsConceded: 0 });
  assert.ok(huge < 1700, `got ${huge}`);
  // Even a 0-40 record stays above the 900 floor, and nothing leaves the rules' 0..10000 range
  const bad = computeRating({ wins: 0, losses: 40, pointsScored: 0, pointsConceded: 800 });
  assert.equal(bad, 1035);
  // A truly terrible lopsided record bottoms out at the 900 floor
  assert.equal(
    computeRating({ wins: 0, losses: 40, pointsScored: 0, pointsConceded: 1600 }),
    965
  );
  assert.ok(bad >= 900);
  assert.ok(
    computeRating({ wins: 1e9, losses: 0, pointsScored: 1e12, pointsConceded: 0 }) <= 10000
  );
});

test('getMatchStatDelta / aggregateMatchStatDeltas move counters by exactly one match', () => {
  const doubles = makeMatch({
    id: 'match_d',
    matchFormat: 'doubles',
    teamAPlayer2Id: 'p3',
    teamAPlayer2Name: 'Cara',
    teamBPlayer2Id: 'p4',
    teamBPlayer2Name: 'Dan',
    scoreTeamA: 18,
    scoreTeamB: 21,
    winnerSide: 'B',
  });
  const winner = getMatchStatDelta(doubles, 'p4', 1)!;
  assert.deepEqual(winner, {
    wins: 1,
    losses: 0,
    gamesPlayed: 1,
    pointsScored: 21,
    pointsConceded: 18,
    singlesWins: 0,
    singlesLosses: 0,
    doublesWins: 1,
    doublesLosses: 0,
  });
  const loserUndo = getMatchStatDelta(doubles, 'p1', -1)!;
  assert.equal(loserUndo.gamesPlayed, -1);
  assert.equal(loserUndo.losses, -1);
  assert.equal(loserUndo.doublesLosses, -1);
  assert.equal(loserUndo.pointsScored, -18);
  assert.equal(loserUndo.pointsConceded, -21);
  assert.equal(getMatchStatDelta(doubles, 'p9', 1), null);

  // Singles placeholders ('NONE') never become participants
  const singles = makeMatch({ id: 'match_s' });
  const singlesDeltas = aggregateMatchStatDeltas([singles], 1);
  assert.deepEqual([...singlesDeltas.keys()].sort(), ['p1', 'p2']);
  assert.equal(singlesDeltas.get('p1')!.singlesWins, 1);
  assert.equal(singlesDeltas.get('p2')!.singlesLosses, 1);

  // Two matches in one delete-session batch are summed into one update per player
  const both = aggregateMatchStatDeltas([singles, doubles], -1);
  const p1Total = both.get('p1')!;
  assert.equal(p1Total.gamesPlayed, -2);
  assert.equal(p1Total.wins, -1);
  assert.equal(p1Total.losses, -1);
  assert.equal(p1Total.pointsScored, -(21 + 18));
  // Aggregating must not mutate the single-match delta objects
  assert.equal(aggregateMatchStatDeltas([singles], -1).get('p1')!.gamesPlayed, -1);
});

test('applyStatDelta applies on top of stored counters (drift-proof) and refreshes the rating', () => {
  const stored: Player = {
    id: 'p1',
    name: 'Alice',
    playerTag: '#AL01',
    joinedClubIdsCsv: 'club_1',
    // Lifetime record that the locally loaded match window knows nothing about
    wins: 30,
    losses: 10,
    gamesPlayed: 40,
    pointsScored: 800,
    pointsConceded: 650,
    singlesWins: 10,
    singlesLosses: 4,
    doublesWins: 20,
    doublesLosses: 6,
    ratingScore: 1200,
    ownerId: 'u1',
  };
  const match = makeMatch({ id: 'match_x', scoreTeamA: 21, scoreTeamB: 12 });

  const recorded = applyStatDelta(stored, getMatchStatDelta(match, 'p1', 1)!);
  assert.equal(recorded.gamesPlayed, 41);
  assert.equal(recorded.wins + recorded.losses, 41);
  assert.equal(recorded.wins, 31);
  assert.equal(recorded.singlesWins, 11);
  assert.equal(recorded.pointsScored, 821);
  assert.equal(recorded.ratingScore, computeRating(recorded));

  // Undo returns the record exactly
  const undone = applyStatDelta(recorded, getMatchStatDelta(match, 'p1', -1)!);
  assert.deepEqual({ ...undone, ratingScore: 0 }, { ...stored, ratingScore: 0 });

  // Never goes below zero locally
  const fresh: Player = { ...stored, wins: 0, losses: 0, gamesPlayed: 0, pointsScored: 0,
    pointsConceded: 0, singlesWins: 0, singlesLosses: 0, doublesWins: 0, doublesLosses: 0 };
  const floored = applyStatDelta(fresh, getMatchStatDelta(match, 'p1', -1)!);
  assert.equal(floored.gamesPlayed, 0);
  assert.equal(floored.wins, 0);
});

test('recentForm uses the same ordering as the profile when sessions are provided', () => {
  const sessions = [
    makeSession('s_old', '2026-09-01'),
    makeSession('s_new', '2026-10-01'),
  ];
  const players: Player[] = ['p1', 'p2'].map((id) => ({
    id,
    name: id,
    playerTag: `#${id}`,
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
    ownerId: 'u',
  }));
  // p1 won in the old session but the doc was written later than the new-session loss
  const oldWin = makeMatch({
    id: 'match_1',
    sessionId: 's_old',
    createdAt: '2026-10-05T00:00:00.000Z',
  });
  const newLoss = makeMatch({
    id: 'match_2',
    sessionId: 's_new',
    scoreTeamA: 15,
    scoreTeamB: 21,
    winnerSide: 'B',
    createdAt: '2026-10-02T00:00:00.000Z',
  });
  const ranked = computePlayerLeaderboardAndTiers(players, [newLoss, oldWin], sessions);
  assert.deepEqual(ranked.find((p) => p.id === 'p1')!.recentForm, ['W', 'L']);
});
