import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PASS_GUEST_DUE_METHOD,
  applyWalletToSingleRsvp,
  getRsvpAdjustment,
  isCashOrPendingRsvp,
  isCoveredRsvp,
  restoreSessionRsvpsAndWalletsForReopen,
  splitPartyShareForPass,
} from './badmintonLogic.ts';
import type { PlayerBenefitWallet, SessionRsvp } from '../types.ts';

const rsvp = (over: Partial<SessionRsvp> = {}): SessionRsvp =>
  ({
    id: 'r1',
    clubId: 'c1',
    sessionId: 's1',
    playerId: 'p1',
    playerName: 'P1',
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
    ownerId: 'o1',
    ...over,
  }) as SessionRsvp;
const wallet = (over: Partial<PlayerBenefitWallet> = {}): PlayerBenefitWallet => ({
  creditBalance: 0,
  freeSessionPasses: 0,
  waiveAllFees: false,
  ...over,
});
const finalize = (r: SessionRsvp, w: PlayerBenefitWallet, gross: number) =>
  applyWalletToSingleRsvp({
    rsvp: r,
    grossFeeShare: gross,
    penaltyPercentApplied: 0,
    wallet: w,
    finalizeSplit: true,
  });

test('party share splits evenly per head', () => {
  assert.deepEqual(splitPartyShareForPass(30, 0), { playerShare: 30, guestShare: 0 });
  assert.deepEqual(splitPartyShareForPass(30, 1), { playerShare: 15, guestShare: 15 });
  assert.deepEqual(splitPartyShareForPass(30, 2), { playerShare: 10, guestShare: 20 });
});

test('a pass covers a player with no guests completely, as before', () => {
  const { updatedRsvp, updatedWallet } = finalize(rsvp(), wallet({ freeSessionPasses: 1 }), 15);
  assert.equal(updatedRsvp.feeShare, 0);
  assert.equal(updatedRsvp.paidStatus, 'paid');
  assert.equal(updatedRsvp.walletPassApplied, true);
  assert.equal(updatedWallet.freeSessionPasses, 0);
});

test('with a +1 guest the pass covers only the player and the guest share stays unpaid', () => {
  const { updatedRsvp, updatedWallet } = finalize(
    rsvp({ guestCount: 1 }),
    wallet({ freeSessionPasses: 1 }),
    30
  );
  assert.equal(updatedRsvp.feeShare, 15);
  assert.equal(updatedRsvp.grossFeeShare, 30);
  assert.equal(updatedRsvp.paidStatus, 'unpaid');
  assert.equal(updatedRsvp.paidMethod, PASS_GUEST_DUE_METHOD);
  assert.equal(updatedRsvp.walletPassApplied, true);
  assert.equal(updatedWallet.freeSessionPasses, 0);
});

test('credit then meets the guest share after the pass covers the player', () => {
  const full = finalize(
    rsvp({ guestCount: 1 }),
    wallet({ freeSessionPasses: 1, creditBalance: 20 }),
    30
  );
  assert.equal(full.updatedRsvp.feeShare, 0);
  assert.equal(full.updatedRsvp.paidStatus, 'paid');
  assert.equal(full.updatedRsvp.walletPassApplied, true);
  assert.equal(full.updatedRsvp.walletCreditApplied, 15);
  assert.equal(full.updatedWallet.creditBalance, 5);
  assert.equal(full.updatedWallet.freeSessionPasses, 0);

  const partial = finalize(
    rsvp({ guestCount: 1 }),
    wallet({ freeSessionPasses: 1, creditBalance: 10 }),
    30
  );
  assert.equal(partial.updatedRsvp.feeShare, 5);
  assert.equal(partial.updatedRsvp.paidStatus, 'unpaid');
  assert.equal(partial.updatedRsvp.walletCreditApplied, 10);
  assert.equal(partial.updatedWallet.creditBalance, 0);
});

test('recalculating is idempotent: the pass and credit are spent once', () => {
  const w = wallet({ freeSessionPasses: 1, creditBalance: 4 });
  const first = finalize(rsvp({ guestCount: 1 }), w, 30);
  const second = finalize(first.updatedRsvp, first.updatedWallet, 30);
  assert.deepEqual(second.updatedWallet, first.updatedWallet);
  assert.equal(second.updatedRsvp.feeShare, first.updatedRsvp.feeShare);
});

test('the guest share paid in cash is real money and survives a recalculation', () => {
  const first = finalize(rsvp({ guestCount: 1 }), wallet({ freeSessionPasses: 1 }), 30);
  const paid: SessionRsvp = { ...first.updatedRsvp, paidStatus: 'paid', paidMethod: 'Received' };
  assert.equal(isCashOrPendingRsvp(paid), true);
  assert.equal(isCoveredRsvp(paid), false);
  assert.equal(getRsvpAdjustment(paid).kind, null);

  // The share rises (fewer players): the cash row is kept, and the guest share difference shows
  const again = finalize(paid, first.updatedWallet, 40);
  assert.equal(again.updatedRsvp.paidStatus, 'paid');
  assert.equal(again.updatedRsvp.feeShare, 15);
  assert.equal(again.updatedRsvp.walletPassApplied, true);
  assert.equal(again.updatedWallet.freeSessionPasses, 0);
  const adj = getRsvpAdjustment(again.updatedRsvp);
  assert.equal(adj.kind, 'due');
  assert.equal(adj.amount, 5);
});

test('removing the guest after paying shows a refund, and the pass is not lost', () => {
  const first = finalize(rsvp({ guestCount: 1 }), wallet({ freeSessionPasses: 1 }), 30);
  const paid: SessionRsvp = { ...first.updatedRsvp, paidStatus: 'paid', paidMethod: 'Received' };
  const noGuest = finalize({ ...paid, guestCount: 0 }, first.updatedWallet, 15);
  assert.equal(noGuest.updatedRsvp.walletPassApplied, true);
  const adj = getRsvpAdjustment(noGuest.updatedRsvp);
  assert.equal(adj.kind, 'refund');
  assert.equal(adj.amount, 15);
});

test('reopening an unpaid pass+guest row returns the pass', () => {
  const first = finalize(rsvp({ guestCount: 1 }), wallet({ freeSessionPasses: 1 }), 30);
  const { restoredSessionRsvps, restoredWalletsMap } = restoreSessionRsvpsAndWalletsForReopen({
    sessionRsvps: [first.updatedRsvp],
    walletsMap: { 'c1::p1': first.updatedWallet },
  });
  assert.equal(restoredWalletsMap['c1::p1'].freeSessionPasses, 1);
  assert.equal(restoredSessionRsvps[0].walletPassApplied, false);
  assert.equal(restoredSessionRsvps[0].feeShare, 0);
});

test('a VIP waiver is unchanged and still covers the whole party', () => {
  const { updatedRsvp } = finalize(rsvp({ guestCount: 1 }), wallet({ waiveAllFees: true }), 30);
  assert.equal(updatedRsvp.feeShare, 0);
  assert.equal(updatedRsvp.walletWaiverApplied, true);
});
