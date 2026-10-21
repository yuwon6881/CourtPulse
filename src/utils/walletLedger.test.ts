import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSessionFeeInputs,
  computeSessionSplitDetails,
  getRsvpAdjustment,
  isCashOrPendingRsvp,
  isCoveredRsvp,
  settleRsvpAdjustment,
} from './badmintonLogic.ts';
import {
  applyWalletUpdate,
  buildRsvpLedgerUpdate,
  computeRsvpWalletPair,
  friendlyWriteError,
  rowNeedsLedgerWork,
  walletDocIdFor,
} from './walletLedger.ts';
import type { AttendanceOutcome, PlayerBenefitWallet, SessionRsvp } from '../types.ts';

/**
 * In-memory stand-in for Firestore that runs the REAL per-pair compute + write payload the
 * transactions use (computeRsvpWalletPair / buildRsvpLedgerUpdate), so these tests follow the
 * actual call sequence: finalize -> cash-pay -> recalc -> attendance edit -> reopen.
 */
class FakeServer {
  rsvps = new Map<string, SessionRsvp>();
  wallets = new Map<string, PlayerBenefitWallet>();
  sessionFinalized = false;
  constructor(
    public courtFee: number,
    public shuttleFee: number,
    public noShowFeePercent = 100,
    public owner: { clubOwnerPlayerId?: string; excludeOwnerFromBilling?: boolean } = {}
  ) {}

  addPlayer(id: string, wallet?: Partial<PlayerBenefitWallet>, over: Partial<SessionRsvp> = {}) {
    this.rsvps.set(`r_${id}`, {
      id: `r_${id}`,
      clubId: 'club_1',
      sessionId: 'sess_1',
      playerId: id,
      playerName: id,
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
      ownerId: 'owner_1',
      ...over,
    });
    if (wallet) {
      this.wallets.set(walletDocIdFor('club_1', id), {
        creditBalance: 0,
        freeSessionPasses: 0,
        waiveAllFees: false,
        ...wallet,
      });
    }
  }

  wallet(id: string): PlayerBenefitWallet {
    return (
      this.wallets.get(walletDocIdFor('club_1', id)) || {
        creditBalance: 0,
        freeSessionPasses: 0,
        waiveAllFees: false,
      }
    );
  }
  row(id: string): SessionRsvp {
    return this.rsvps.get(`r_${id}`)!;
  }

  /** One RSVP+wallet transaction, computed on the "server" documents. */
  private pairTx(
    rsvpId: string,
    compute: (r: SessionRsvp, w: PlayerBenefitWallet) => ReturnType<typeof computeRsvpWalletPair>
  ) {
    const serverRsvp = this.rsvps.get(rsvpId)!;
    const key = walletDocIdFor(serverRsvp.clubId, serverRsvp.playerId);
    const serverWallet = this.wallets.get(key) || {
      creditBalance: 0,
      freeSessionPasses: 0,
      waiveAllFees: false,
    };
    const result = compute(serverRsvp, serverWallet);
    if (result.rsvpChanged) {
      this.rsvps.set(rsvpId, { ...serverRsvp, ...(buildRsvpLedgerUpdate(result.rsvp) as object) } as SessionRsvp);
    }
    if (result.walletChanged) this.wallets.set(key, result.wallet);
  }

  finalize(finalizeSplit = true, court = this.courtFee, shuttle = this.shuttleFee) {
    this.courtFee = court;
    this.shuttleFee = shuttle;
    const rows = Array.from(this.rsvps.values());
    const splits = computeSessionSplitDetails(court, shuttle, rows, this.noShowFeePercent, this.owner).splits;
    for (const r of rows.filter(rowNeedsLedgerWork)) {
      const calc = splits.get(r.id) || { feeShare: 0, penaltyPercentApplied: 0 };
      this.pairTx(r.id, (srv, wal) =>
        computeRsvpWalletPair({
          serverRsvp: srv,
          serverWallet: wal,
          grossFeeShare: calc.feeShare,
          penaltyPercentApplied: calc.penaltyPercentApplied,
          finalizeSplit,
          ...this.owner,
        })
      );
    }
    this.sessionFinalized = finalizeSplit;
  }

  /** Attendance edit on a finalized session: patched row feeds the splits, every row re-applied. */
  editAttendance(playerId: string, outcome: AttendanceOutcome) {
    const targetId = `r_${playerId}`;
    const patch = (r: SessionRsvp): SessionRsvp =>
      r.id === targetId
        ? { ...r, attendanceOutcome: outcome, penaltyPercentApplied: outcome === 'no_show' ? this.noShowFeePercent : 100 }
        : r;
    const rows = Array.from(this.rsvps.values()).map(patch);
    const splits = computeSessionSplitDetails(this.courtFee, this.shuttleFee, rows, this.noShowFeePercent, this.owner).splits;
    for (const r of rows.filter((x) => x.id === targetId || rowNeedsLedgerWork(x))) {
      const calc = splits.get(r.id) || { feeShare: 0, penaltyPercentApplied: 0 };
      this.pairTx(r.id, (srv, wal) =>
        computeRsvpWalletPair({
          serverRsvp: srv,
          serverWallet: wal,
          mutate: r.id === targetId ? patch : undefined,
          grossFeeShare: calc.feeShare,
          penaltyPercentApplied: calc.penaltyPercentApplied,
          finalizeSplit: true,
          ...this.owner,
        })
      );
    }
  }

  reopen() {
    for (const r of Array.from(this.rsvps.values()).filter(rowNeedsLedgerWork)) {
      this.pairTx(r.id, (srv, wal) =>
        computeRsvpWalletPair({
          serverRsvp: srv,
          serverWallet: wal,
          grossFeeShare: 0,
          finalizeSplit: false,
          ...this.owner,
        })
      );
    }
    this.sessionFinalized = false;
  }

  /** Owner marks the row received in cash: only paidStatus/paidMethod change. */
  cashPay(playerId: string, method = 'Cash') {
    const r = this.row(playerId);
    this.rsvps.set(r.id, { ...r, paidStatus: 'paid', paidMethod: method });
  }
  /** Player says they paid (rules allow only these two fields on unpaid/pending rows). */
  reportPaid(playerId: string) {
    const r = this.row(playerId);
    this.rsvps.set(r.id, { ...r, paidStatus: 'pending_approval', paidMethod: 'PayNow' });
  }

  walletTotal(playerId: string): number {
    const w = this.wallet(playerId);
    return Number((w.creditBalance + (this.row(playerId).walletCreditApplied || 0)).toFixed(2));
  }
}

function threePlayers(court = 30, noShow = 100): FakeServer {
  const s = new FakeServer(court, 0, noShow);
  s.addPlayer('p1');
  s.addPlayer('p2');
  s.addPlayer('p3');
  return s;
}

test('cash-paid row survives finalize -> cash-pay -> recalc twice -> attendance edit -> reopen', () => {
  const s = threePlayers(30, 50);
  s.finalize();
  assert.equal(s.row('p1').feeShare, 10);
  s.cashPay('p1');

  // Recalculate twice with the same inputs: nothing changes, nothing is wiped
  s.finalize();
  s.finalize();
  assert.equal(s.row('p1').paidStatus, 'paid');
  assert.equal(s.row('p1').paidMethod, 'Cash');
  assert.equal(s.row('p1').feeShare, 10);
  assert.equal(getRsvpAdjustment(s.row('p1')).kind, null);

  // p3 becomes a 50% no-show: shares 12 / 12 / 6, so p1 (paid 10) owes 2 more
  s.editAttendance('p3', 'no_show');
  assert.equal(s.row('p1').paidStatus, 'paid');
  assert.equal(s.row('p1').paidMethod, 'Cash');
  assert.equal(s.row('p1').feeShare, 10, 'cash collected is kept');
  assert.equal(s.row('p1').grossFeeShare, 12);
  assert.deepEqual(
    { kind: getRsvpAdjustment(s.row('p1')).kind, amount: getRsvpAdjustment(s.row('p1')).amount },
    { kind: 'due', amount: 2 }
  );
  // unpaid rows were simply recomputed
  assert.equal(s.row('p2').feeShare, 12);
  assert.equal(s.row('p3').feeShare, 6);

  // Reopen leaves the cash-paid row alone and zeroes the unpaid ones
  s.reopen();
  assert.equal(s.row('p1').paidStatus, 'paid');
  assert.equal(s.row('p1').feeShare, 10);
  assert.equal(s.row('p2').feeShare, 0);

  // Re-finalize with p3 present again: p1's share is 10 again, adjustment disappears
  s.editAttendance('p3', 'present');
  s.finalize();
  assert.equal(s.row('p1').paidStatus, 'paid');
  assert.equal(s.row('p1').feeShare, 10);
  assert.equal(getRsvpAdjustment(s.row('p1')).kind, null);
});

test('pending_approval (player says they paid) is never wiped by recalc, edit or reopen', () => {
  const s = threePlayers(30, 100);
  s.finalize();
  s.reportPaid('p2');
  s.finalize();
  s.editAttendance('p3', 'excused'); // p3 owes nothing, p1/p2 shares rise to 15
  assert.equal(s.row('p2').paidStatus, 'pending_approval');
  assert.equal(s.row('p2').paidMethod, 'PayNow');
  assert.equal(s.row('p2').feeShare, 10);
  const adj = getRsvpAdjustment(s.row('p2'));
  assert.deepEqual({ kind: adj.kind, amount: adj.amount }, { kind: 'due', amount: 5 });
  s.reopen();
  assert.equal(s.row('p2').paidStatus, 'pending_approval');
  assert.equal(isCashOrPendingRsvp(s.row('p2')), true);
});

test('partial credit then cash-paid is preserved and credit is conserved', () => {
  const s = new FakeServer(30, 0);
  s.addPlayer('p1', { creditBalance: 4 });
  s.addPlayer('p2');
  s.addPlayer('p3');
  s.finalize();
  assert.equal(s.row('p1').feeShare, 6);
  assert.equal(s.row('p1').walletCreditApplied, 4);
  assert.equal(s.row('p1').paidStatus, 'unpaid');
  assert.equal(s.wallet('p1').creditBalance, 0);

  s.cashPay('p1'); // paid the remaining 6 in cash; the row still carries walletCreditApplied 4
  s.finalize();
  s.finalize();
  assert.equal(s.row('p1').paidStatus, 'paid');
  assert.equal(s.row('p1').paidMethod, 'Cash');
  assert.equal(s.row('p1').feeShare, 6);
  assert.equal(s.row('p1').walletCreditApplied, 4);
  assert.equal(s.wallet('p1').creditBalance, 0, 'credit is neither refunded nor spent twice');
  assert.equal(getRsvpAdjustment(s.row('p1')).kind, null);

  s.reopen();
  assert.equal(s.row('p1').paidStatus, 'paid');
  assert.equal(s.row('p1').feeShare, 6);
  assert.equal(s.wallet('p1').creditBalance, 0);
});

test('credit is conserved across repeated recalcs and share changes', () => {
  const s = new FakeServer(30, 0);
  s.addPlayer('p1');
  s.addPlayer('p2', { creditBalance: 7 });
  s.addPlayer('p3');
  s.finalize();
  assert.equal(s.row('p2').walletCreditApplied, 7);
  assert.equal(s.row('p2').feeShare, 3);
  for (let i = 0; i < 3; i += 1) s.finalize();
  assert.equal(s.walletTotal('p2'), 7);
  assert.equal(s.row('p2').walletCreditApplied, 7);

  s.finalize(true, 15); // share drops to 5: only 5 credit is consumed, 2 returned
  assert.equal(s.row('p2').feeShare, 0);
  assert.equal(s.row('p2').paidStatus, 'paid');
  assert.equal(s.row('p2').walletCreditApplied, 5);
  assert.equal(s.walletTotal('p2'), 7);

  s.finalize(true, 60); // share rises to 20: all 7 credit consumed, 13 payable
  assert.equal(s.row('p2').feeShare, 13);
  assert.equal(s.walletTotal('p2'), 7);

  s.reopen();
  assert.equal(s.wallet('p2').creditBalance, 7);
  assert.equal(s.row('p2').walletCreditApplied, 0);
});

test('a free pass is restored when the share drops to 0 and consumed once only', () => {
  const s = new FakeServer(30, 0);
  s.addPlayer('p1');
  s.addPlayer('p2', { freeSessionPasses: 1 });
  s.addPlayer('p3');
  s.finalize();
  s.finalize();
  assert.equal(s.row('p2').walletPassApplied, true);
  assert.equal(s.row('p2').paidStatus, 'paid');
  assert.equal(s.wallet('p2').freeSessionPasses, 0);

  s.editAttendance('p2', 'excused'); // share becomes 0
  assert.equal(s.row('p2').walletPassApplied, false);
  assert.equal(s.row('p2').paidStatus, 'unpaid');
  assert.equal(s.row('p2').feeShare, 0);
  assert.equal(s.wallet('p2').freeSessionPasses, 1, 'pass is back in the wallet');

  s.editAttendance('p2', 'present');
  assert.equal(s.row('p2').walletPassApplied, true);
  assert.equal(s.wallet('p2').freeSessionPasses, 0);
});

test('adjustment: paid 10 and new share 12 -> 2 due; new share 8 -> refund 2; settling clears it', () => {
  const base: SessionRsvp = {
    id: 'r_p1',
    clubId: 'club_1',
    sessionId: 'sess_1',
    playerId: 'p1',
    playerName: 'p1',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 10,
    grossFeeShare: 10,
    walletCreditApplied: 0,
    walletPassApplied: false,
    walletWaiverApplied: false,
    paidStatus: 'paid',
    paidMethod: 'Cash',
    ownerId: 'owner_1',
  };
  const wallet = { creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false };
  const up = computeRsvpWalletPair({
    serverRsvp: base,
    serverWallet: wallet,
    grossFeeShare: 12,
    penaltyPercentApplied: 100,
    finalizeSplit: true,
  });
  assert.equal(up.rsvp.paidStatus, 'paid');
  assert.equal(up.rsvp.feeShare, 10);
  const due = getRsvpAdjustment(up.rsvp);
  assert.deepEqual({ kind: due.kind, amount: due.amount }, { kind: 'due', amount: 2 });

  const down = computeRsvpWalletPair({
    serverRsvp: base,
    serverWallet: wallet,
    grossFeeShare: 8,
    penaltyPercentApplied: 100,
    finalizeSplit: true,
  });
  const refund = getRsvpAdjustment(down.rsvp);
  assert.deepEqual({ kind: refund.kind, amount: refund.amount }, { kind: 'refund', amount: 2 });

  assert.equal(getRsvpAdjustment(settleRsvpAdjustment(up.rsvp)).kind, null);
  assert.equal(settleRsvpAdjustment(up.rsvp).feeShare, 12);
  assert.equal(getRsvpAdjustment(settleRsvpAdjustment(down.rsvp)).kind, null);
  assert.equal(settleRsvpAdjustment(down.rsvp).feeShare, 8);
});

test('a manual organiser waiver ("Fee Waived") survives recalcs and reopen untouched', () => {
  const s = threePlayers(30, 100);
  s.finalize();
  s.cashPay('p3', 'Fee Waived');
  s.editAttendance('p2', 'excused'); // shares change for everybody else
  s.finalize();
  s.reopen();
  assert.equal(s.row('p3').paidStatus, 'paid');
  assert.equal(s.row('p3').paidMethod, 'Fee Waived');
  assert.equal(s.row('p3').feeShare, 10);
  assert.equal(getRsvpAdjustment(s.row('p3')).kind, null);
  assert.equal(isCoveredRsvp(s.row('p3')), true);
  assert.equal(isCashOrPendingRsvp(s.row('p3')), false);
});

test('owner excluded: guests are still billed, and a stale paid status is not left when not finalizing', () => {
  const s = new FakeServer(40, 0, 100, { clubOwnerPlayerId: 'p1', excludeOwnerFromBilling: true });
  s.addPlayer('p1', undefined, { guestCount: 1 });
  s.addPlayer('p2');
  s.finalize();
  // owner's own spot is free; their guest is one billable spot: 40 / 2 spots
  assert.equal(s.row('p1').grossFeeShare, 20);
  assert.equal(s.row('p1').feeShare, 20);
  assert.equal(s.row('p1').paidMethod, 'Owner Excluded');
  assert.equal(s.row('p2').feeShare, 20);

  s.reopen();
  assert.equal(s.row('p1').paidStatus, 'unpaid');
  assert.equal(s.row('p1').paidMethod, 'pending');
  assert.equal(s.row('p1').feeShare, 0);
});

test('unallocated cents are reported when nobody is billable', () => {
  const out = [
    { ...threePlayers().row('p1'), status: 'out' as const },
  ].map((r) => ({ ...r }));
  const details = computeSessionSplitDetails(40, 10, out, 100);
  assert.equal(details.hasUnallocated, true);
  assert.equal(details.unallocatedCourtCents, 4000);
  assert.equal(details.unallocatedShuttleCents, 1000);
  assert.equal(details.unallocatedCents, 5000);
  assert.equal(details.unallocatedAmount, 50);

  const fine = computeSessionSplitDetails(40, 10, Array.from(threePlayers().rsvps.values()), 100);
  assert.equal(fine.hasUnallocated, false);
  assert.equal(fine.unallocatedCents, 0);

  // Only a 0%-weighted no-show: shuttle (present players only) and court both unallocated
  const noShowOnly = [{ ...threePlayers().row('p1'), attendanceOutcome: 'no_show' as const }];
  const zeroWeight = computeSessionSplitDetails(40, 10, noShowOnly, 0);
  assert.equal(zeroWeight.unallocatedCents, 5000);
});

test('shuttle and court inputs are clamped to the stored caps and blocked when unrepresentable', () => {
  const huge = checkSessionFeeInputs(60, 1000, 1000);
  assert.equal(huge.ok, false);
  assert.equal(huge.shuttleFee, 1_000_000);
  assert.match(huge.error || '', /100,000/);

  assert.equal(checkSessionFeeInputs(0, 1000, 100).ok, true); // exactly 100000
  assert.equal(checkSessionFeeInputs(1, 1000, 100).ok, false); // 100001 total
  const clamped = checkSessionFeeInputs(500000, 0, 0);
  assert.equal(clamped.ok, true);
  assert.equal(clamped.courtFee, 100000);
  assert.ok(clamped.notice);
  const negative = checkSessionFeeInputs(-5, -1, -2);
  assert.equal(negative.ok, true);
  assert.equal(negative.courtFee, 0);
  assert.equal(negative.shuttleFee, 0);
  assert.equal(checkSessionFeeInputs(20, 6, 3).shuttleFee, 18);
});

test('wallet edits apply deltas and clamps to the server value', () => {
  const server: PlayerBenefitWallet = { creditBalance: 12.5, freeSessionPasses: 2, waiveAllFees: false };
  assert.equal(applyWalletUpdate(server, { creditDelta: 10 }).creditBalance, 22.5);
  assert.equal(applyWalletUpdate(server, { creditDelta: -50 }).creditBalance, 0);
  assert.equal(applyWalletUpdate(server, { passDelta: -5 }).freeSessionPasses, 0);
  assert.equal(applyWalletUpdate(server, { passDelta: 3 }).freeSessionPasses, 5);
  assert.equal(applyWalletUpdate(server, { creditDelta: 1_000_000 }).creditBalance, 100000);
  assert.equal(applyWalletUpdate(server, { waiveAllFees: true }).waiveAllFees, true);
  assert.equal(applyWalletUpdate(server, { creditBalance: 3 }).creditBalance, 3);
});

test('friendlyWriteError never shows raw JSON dumps', () => {
  assert.equal(friendlyWriteError(new Error('{"error":"Missing or insufficient permissions."}')), 'Could not save. Refresh and try again.');
  assert.equal(friendlyWriteError(new Error('You are offline.')), 'You are offline.');
  assert.equal(friendlyWriteError(undefined), 'Could not save. Refresh and try again.');
});
