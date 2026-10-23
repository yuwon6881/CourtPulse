// Prints the expected numbers for docs/QA_LIVE_CHECKLIST.md by running the REAL ledger functions.
// Run: npx tsx scripts/qa-live-numbers.ts
import type { PlayerBenefitWallet, SessionRsvp } from '../src/types.ts';
import {
  applyWalletsToFinalizedSessionRsvps, computeSessionSplitDetails, getRsvpAdjustment, makeClubWalletKey,
  restoreSessionRsvpsAndWalletsForReopen, settleRsvpAdjustment,
} from '../src/utils/badmintonLogic.ts';
import { computeManualWaiver } from '../src/utils/walletLedger.ts';

const CLUB = 'club';
const NO_SHOW_PCT = 100;
const COURT_FEE = 60;
const SHUTTLES = 4;
const SHUTTLE_COST = 3;
const OWNER = 'owner';
const ownerOpts = { clubOwnerPlayerId: OWNER, excludeOwnerFromBilling: false };

const row = (playerId: string, over: Partial<SessionRsvp> = {}): SessionRsvp => ({
  id: `rsvp_s_${playerId}`, clubId: CLUB, sessionId: 's', playerId, playerName: playerId, guestCount: 0,
  status: 'going', attendanceOutcome: 'present', penaltyPercentApplied: 0, feeShare: 0, paidStatus: 'unpaid',
  paidMethod: 'pending', ownerId: playerId, ...over,
} as SessionRsvp);

const w = (creditBalance = 0, freeSessionPasses = 0, waiveAllFees = false): PlayerBenefitWallet =>
  ({ creditBalance, freeSessionPasses, waiveAllFees });

type Wallets = Record<string, PlayerBenefitWallet>;
const key = (p: string) => makeClubWalletKey(CLUB, p);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function show(title: string, rows: SessionRsvp[], wallets: Wallets) {
  console.log(`\n### ${title}`);
  for (const r of rows) {
    const adj = getRsvpAdjustment(r);
    const wl = wallets[key(r.playerId)] || w();
    console.log(
      `${r.playerId.padEnd(6)} heads=${1 + (r.guestCount || 0)} gross=${(r.grossFeeShare ?? 0).toFixed(2)} pass=${r.walletPassApplied ? 'Y' : 'N'} ` +
        `credit=${(r.walletCreditApplied ?? 0).toFixed(2)} payable(feeShare)=${r.feeShare.toFixed(2)} paid=${r.paidStatus}/${r.paidMethod} ` +
        `adj=${adj.kind ?? 'none'}${adj.kind ? ' ' + adj.amount.toFixed(2) : ''} | wallet credit=${wl.creditBalance.toFixed(2)} passes=${wl.freeSessionPasses}`
    );
  }
}

function finalize(rows: SessionRsvp[], wallets: Wallets, shuttles = SHUTTLES) {
  const split = computeSessionSplitDetails(COURT_FEE, shuttles * SHUTTLE_COST, rows, NO_SHOW_PCT, ownerOpts);
  const res = applyWalletsToFinalizedSessionRsvps({
    sessionRsvps: rows, splits: split.splits, walletsMap: wallets, finalizeSplit: true, ...ownerOpts,
  });
  return { rows: res.updatedSessionRsvps, wallets: res.updatedWalletsMap as Wallets };
}

console.log(`Assumptions: court fee ${COURT_FEE.toFixed(2)}, ${SHUTTLES} shuttles x ${SHUTTLE_COST.toFixed(2)} = ${(SHUTTLES * SHUTTLE_COST).toFixed(2)}, no-show fee ${NO_SHOW_PCT}%`);

// Wallets: A 1 pass + 10.00 credit, B 5.00 credit, owner none
const startWallets: Wallets = { [key('A')]: w(10, 1), [key('B')]: w(5, 0), [key(OWNER)]: w() };
const baseRows = [row(OWNER, { playerName: 'Owner' }), row('A', { guestCount: 1 }), row('B')];

show('S0 before finalize (nothing billed)', baseRows, startWallets);

let st = finalize(clone(baseRows), clone(startWallets));
show('S1 after finalize (4 heads: owner 1, A 2, B 1; pool 72.00 -> 18.00 per head)', st.rows, st.wallets);

// S2 payments
let rows = st.rows.map((r) => {
  if (r.playerId === 'A') return { ...r, paidStatus: 'paid', paidMethod: 'cash' } as SessionRsvp;
  if (r.playerId === 'B') return { ...r, paidStatus: 'pending_approval', paidMethod: 'PayNow' } as SessionRsvp;
  return r;
});
show('S2 A paid cash (host Received), B reported PayNow (pending_approval)', rows, st.wallets);

const rejected = rows.map((r) => (r.playerId === 'B' ? ({ ...r, paidStatus: 'unpaid', paidMethod: 'pending' } as SessionRsvp) : r));
show('S2b host rejects B payment', rejected, st.wallets);
const confirmed = rows.map((r) => (r.playerId === 'B' ? ({ ...r, paidStatus: 'paid', paidMethod: 'PayNow' } as SessionRsvp) : r));
show('S2c host confirms B payment', confirmed, st.wallets);

// S3 recalc with 5 shuttles (cash/PayNow-paid rows keep their payment; share change shows as adjustment)
const recalc = finalize(clone(confirmed), clone(st.wallets), 5);
show('S3 recalculate with 5 shuttles (pool 75.00 -> 18.75 per head), A cash-paid, B PayNow-paid', recalc.rows, recalc.wallets);
const recalcRows = recalc.rows;
const aRow = recalcRows.find((r) => r.playerId === 'A')!;
const settledA = settleRsvpAdjustment(aRow);
console.log(`A adjustment after recalc: ${JSON.stringify(getRsvpAdjustment(aRow))}; after host settles: ${JSON.stringify(getRsvpAdjustment(settledA))}`);

// S3b host collects A's and B's 0.75, then sets shuttles back to 4 and recalculates
const settledAll = recalc.rows.map((r) => (r.playerId === 'A' || r.playerId === 'B' ? settleRsvpAdjustment(r) : r));
const back = finalize(clone(settledAll), clone(recalc.wallets), 4);
show('S3b 0.75 collected from A and B, then shuttles back to 4 and recalculate', back.rows, back.wallets);

// S4 waive owner row (after finalize at 4 shuttles)
const waiver = computeManualWaiver({ serverRsvp: st.rows.find((r) => r.playerId === 'B')!, serverWallet: st.wallets[key('B')] });
console.log(`\n### S4 host waives B (credit returned): row paid=${waiver.rsvp.paidStatus}/${waiver.rsvp.paidMethod} feeShare=${waiver.rsvp.feeShare.toFixed(2)} credit applied=${(waiver.rsvp.walletCreditApplied ?? 0).toFixed(2)} | B wallet credit=${waiver.wallet.creditBalance.toFixed(2)}`);

// S5 reopen from S1 state (nothing paid)
const reopened = restoreSessionRsvpsAndWalletsForReopen({ sessionRsvps: st.rows, walletsMap: st.wallets });
show('S5 reopen straight after S1 (nothing paid): everything back', reopened.restoredSessionRsvps, reopened.restoredWalletsMap as Wallets);
const reopenedPaid = restoreSessionRsvpsAndWalletsForReopen({ sessionRsvps: rows, walletsMap: st.wallets });
show('S5b reopen after S2 (A cash paid, B pending): paid rows keep their payment', reopenedPaid.restoredSessionRsvps, reopenedPaid.restoredWalletsMap as Wallets);

// S6 cancel in time: B leaves free before finalize -> not on the roster; heads 3 -> 24.00 each
const afterCancel = [row(OWNER, { playerName: 'Owner' }), row('A', { guestCount: 1 }), row('B', { status: 'out' })];
const c1 = finalize(clone(afterCancel), clone(startWallets));
show('S6 B cancelled in time before finalize (3 heads: pool 72.00 -> 24.00 per head)', c1.rows, c1.wallets);

// S6b late cancel at 50%: B late_out with 50% penalty weight
const lateCancel = [row(OWNER, { playerName: 'Owner' }), row('A', { guestCount: 1 }), row('B', { status: 'late_out', penaltyPercentApplied: 50 })];
const c2 = finalize(clone(lateCancel), clone(startWallets));
show('S6b B cancelled late (50% fee weight) before finalize', c2.rows, c2.wallets);

// S7 cancel after finalize into a finalized split (host edits): B marked out after finalize then recalculated
const cancelAfter = clone(st.rows).map((r) => (r.playerId === 'B' ? ({ ...r, status: 'out' } as SessionRsvp) : r));
const c3 = finalize(cancelAfter, clone(st.wallets));
show('S7 B set to out after finalize, host recalculates (credit comes back)', c3.rows, c3.wallets);
