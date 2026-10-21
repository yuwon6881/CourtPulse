import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWalletToSingleRsvp,
  applyWalletsToFinalizedSessionRsvps,
  computePlayerLeaderboardAndTiers,
  computeWeightedSessionSplits,
  evaluateTapOutWindow,
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

  // Case 12: Cash-paid row when share changes on re-finalize -> unpaid, Adjustment Due, feeShare 18
  const c12 = applyWalletToSingleRsvp({
    rsvp: cashPaidRsvp,
    grossFeeShare: 18,
    penaltyPercentApplied: 100,
    wallet: { creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false },
    finalizeSplit: true,
  });
  assert.equal(c12.updatedRsvp.paidStatus, 'unpaid');
  assert.equal(c12.updatedRsvp.paidMethod, 'Adjustment Due');
  assert.equal(c12.updatedRsvp.feeShare, 18);

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

  const startMs = new Date(2026, 9, 20, 20, 0, 0, 0).getTime();

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
    { ...session, sessionDate: 'invalid-date' },
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
