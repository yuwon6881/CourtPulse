// Run with `npm run test:concurrency` (starts the Firestore emulator on :8081, needs Java 21+).
//
// Races the REAL ledger transaction code (src/utils/walletTransactionsCore.ts, the module the app's
// walletTransactions.ts delegates to) against the emulator, using several independent Firestore
// clients so the transactions genuinely conflict on the server. Authorisation is not under test here
// (tests/rules covers it); the rules file is wide open on purpose.
//
// `finalizeSession` / `reopenSession` below mirror handleFinalizeSessionShuttleAndSplit /
// handleReopenSessionSplit in src/App.tsx (server read -> split -> one transaction per pair with the
// stale-row guard -> session flag last). Keep them in step with the handlers.
import { initializeApp } from 'firebase/app';
import {
  collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { computeSessionSplitDetails } from '../../src/utils/badmintonLogic.ts';
import {
  computeRsvpWalletPair, rowNeedsLedgerWork, rsvpFromDocData, walletDocIdFor,
} from '../../src/utils/walletLedger.ts';
import { runRsvpWalletPairsOn, updateClubWalletOn } from '../../src/utils/walletTransactionsCore.ts';

const REPS = Number(process.env.CONCURRENCY_REPS || 25);
const PROJECT = 'courtpulse-concurrency-test';
let appCounter = 0;
const client = () => {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'x' }, `c${appCounter++}`);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8081);
  return db;
};
const admin = client();
const hostA = client();
const hostB = client();
const playerClient = client();

const CLUB = 'c1';
const club = { id: CLUB, noShowFeePercent: 100, clubOwnerPlayerId: 'p_owner', excludeOwnerFromBilling: false };
const ownerOpts = { clubOwnerPlayerId: club.clubOwnerPlayerId, excludeOwnerFromBilling: false };

const cents = (n) => Math.round(Number(n || 0) * 100);

async function clearAll() {
  await fetch(`http://127.0.0.1:8081/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

const rsvpRow = (sessionId, playerId, over = {}) => ({
  clubId: CLUB, sessionId, playerId, playerName: playerId, status: 'going', attendanceOutcome: 'present',
  penaltyPercentApplied: 0, feeShare: 0, paidStatus: 'unpaid', paidMethod: 'pending', ownerId: playerId,
  guestCount: 0, ...over,
});
const seedSession = (id, over = {}) => setDoc(doc(admin, 'sessions', id), {
  clubId: CLUB, bookingStatus: 'in_play', courtFee: 60, shuttleFee: 0, feeSplitFinalized: false, ...over,
});
const seedRsvp = (sessionId, playerId, over) => setDoc(doc(admin, 'rsvps', `rsvp_${sessionId}_${playerId}`), rsvpRow(sessionId, playerId, over));
const seedWallet = (playerId, w) => setDoc(doc(admin, 'clubWallets', walletDocIdFor(CLUB, playerId)), {
  clubId: CLUB, playerId, creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false, ownerId: 'u', ...w,
});
const readWallet = async (playerId) => (await getDoc(doc(admin, 'clubWallets', walletDocIdFor(CLUB, playerId)))).data();
const readRsvp = async (sessionId, playerId) => rsvpFromDocData(`rsvp_${sessionId}_${playerId}`, (await getDoc(doc(admin, 'rsvps', `rsvp_${sessionId}_${playerId}`))).data());
const readSession = async (id) => (await getDoc(doc(admin, 'sessions', id))).data();

/** Mirror of handleFinalizeSessionShuttleAndSplit's server path (finalizeSplit = true). */
async function finalizeSession(db, sessionId, { courtFee = 60, shuttleFee = 0 } = {}) {
  const fresh = await getDocs(query(collection(db, 'rsvps'), where('clubId', '==', CLUB), where('sessionId', '==', sessionId)));
  const sessionRows = fresh.docs.map((d) => rsvpFromDocData(d.id, d.data()));
  const rowById = new Map(sessionRows.map((r) => [r.id, r]));
  const split = computeSessionSplitDetails(courtFee, shuttleFee, sessionRows, club.noShowFeePercent, ownerOpts);
  const tasks = sessionRows.filter((r) => rowNeedsLedgerWork(r)).map((r) => ({
    rsvpId: r.id, clubId: r.clubId, playerId: r.playerId,
    compute: (serverRsvp, serverWallet) => {
      const read = rowById.get(r.id);
      if (read && (serverRsvp.status !== read.status || serverRsvp.attendanceOutcome !== read.attendanceOutcome
        || (serverRsvp.guestCount ?? 0) !== (read.guestCount ?? 0))) {
        throw new Error(`${serverRsvp.playerName} changed their RSVP just now. Finalize again to include it.`);
      }
      const calc = split.splits.get(r.id) || { feeShare: 0, penaltyPercentApplied: 0 };
      return computeRsvpWalletPair({
        serverRsvp, serverWallet, grossFeeShare: calc.feeShare, penaltyPercentApplied: calc.penaltyPercentApplied,
        finalizeSplit: true, ...ownerOpts,
      });
    },
  }));
  const batch = await runRsvpWalletPairsOn(db, tasks, 'host');
  if (batch.failed.length) return { ok: false, reason: batch.failed[0].message };
  await updateDoc(doc(db, 'sessions', sessionId), { bookingStatus: 'completed', courtFee, shuttleFee, feeSplitFinalized: true });
  return { ok: true };
}

/** Mirror of handleReopenSessionSplit's server path. */
async function reopenSession(db, sessionId) {
  const fresh = await getDocs(query(collection(db, 'rsvps'), where('clubId', '==', CLUB), where('sessionId', '==', sessionId)));
  const rows = fresh.docs.map((d) => rsvpFromDocData(d.id, d.data()));
  const tasks = rows.filter((r) => rowNeedsLedgerWork(r)).map((r) => ({
    rsvpId: r.id, clubId: r.clubId, playerId: r.playerId,
    compute: (serverRsvp, serverWallet) => computeRsvpWalletPair({
      serverRsvp, serverWallet, grossFeeShare: 0, finalizeSplit: false, ...ownerOpts,
    }),
  }));
  const batch = await runRsvpWalletPairsOn(db, tasks, 'host');
  if (batch.failed.length) return { ok: false, reason: batch.failed[0].message };
  await updateDoc(doc(db, 'sessions', sessionId), { bookingStatus: 'in_play', feeSplitFinalized: false });
  return { ok: true };
}

/** Mirror of the host's recalculate: finalize again on an already-finalized split. */
const recalculate = finalizeSession;

/** I1 + I2 for one player over the given sessions: wallet + consumed == granted. */
async function assertConserved(playerId, sessionIds, granted, label) {
  const w = await readWallet(playerId);
  let passRows = 0;
  let creditCents = 0;
  for (const sid of sessionIds) {
    const r = await readRsvp(sid, playerId);
    if (r.walletPassApplied) passRows += 1;
    creditCents += cents(r.walletCreditApplied);
    if (cents(r.feeShare) < 0 || cents(r.walletCreditApplied) < 0) throw new Error(`${label}: negative amount on ${sid}`);
  }
  if (w.freeSessionPasses < 0 || cents(w.creditBalance) < 0) throw new Error(`${label}: negative wallet ${JSON.stringify(w)}`);
  if (w.freeSessionPasses + passRows !== granted.passes) {
    throw new Error(`${label}: pass conservation broken: wallet ${w.freeSessionPasses} + rows ${passRows} != granted ${granted.passes}`);
  }
  if (cents(w.creditBalance) + creditCents !== cents(granted.credit)) {
    throw new Error(`${label}: credit conservation broken: wallet ${cents(w.creditBalance)}c + rows ${creditCents}c != granted ${cents(granted.credit)}c`);
  }
}

const stable = (r) => JSON.stringify({
  s: r.feeShare, g: r.grossFeeShare, c: r.walletCreditApplied, p: r.walletPassApplied, w: r.walletWaiverApplied,
  ps: r.paidStatus, pm: r.paidMethod,
});

let pass = 0, fail = 0;
async function t(name, fn) {
  const failures = [];
  for (let i = 0; i < REPS; i++) {
    await clearAll();
    try { await fn(i); } catch (e) { failures.push(`rep ${i}: ${e.message}`); if (failures.length >= 3) break; }
  }
  if (failures.length === 0) { pass++; console.log(`PASS (${REPS}x)`, name); }
  else { fail++; console.log('FAIL', name); failures.forEach((f) => console.log('     ', f)); }
}

// ---------------------------------------------------------------- 1. two hosts finalize the same session
await t('two hosts finalize the same session at once: every pass and credit cent is spent exactly once', async () => {
  await seedSession('s1');
  await seedRsvp('s1', 'p1', { guestCount: 1 });
  await seedRsvp('s1', 'p2');
  await seedRsvp('s1', 'p3');
  await seedWallet('p1', { freeSessionPasses: 1, creditBalance: 30 });
  await seedWallet('p2', { creditBalance: 12.34 });
  await seedWallet('p3', { freeSessionPasses: 2 });
  const [a, b] = await Promise.all([finalizeSession(hostA, 's1'), finalizeSession(hostB, 's1')]);
  if (!a.ok && !b.ok) throw new Error(`both finalizes failed: ${a.reason} / ${b.reason}`);
  await assertConserved('p1', ['s1'], { passes: 1, credit: 30 }, 'p1');
  await assertConserved('p2', ['s1'], { passes: 0, credit: 12.34 }, 'p2');
  await assertConserved('p3', ['s1'], { passes: 2, credit: 0 }, 'p3');
  // the double run must equal a single run
  const once = (await Promise.all(['p1', 'p2', 'p3'].map((p) => readRsvp('s1', p)))).map(stable);
  await clearAll();
  await seedSession('s1');
  await seedRsvp('s1', 'p1', { guestCount: 1 });
  await seedRsvp('s1', 'p2');
  await seedRsvp('s1', 'p3');
  await seedWallet('p1', { freeSessionPasses: 1, creditBalance: 30 });
  await seedWallet('p2', { creditBalance: 12.34 });
  await seedWallet('p3', { freeSessionPasses: 2 });
  await finalizeSession(hostA, 's1');
  const single = (await Promise.all(['p1', 'p2', 'p3'].map((p) => readRsvp('s1', p)))).map(stable);
  if (JSON.stringify(once) !== JSON.stringify(single)) throw new Error(`concurrent result differs from a single finalize:\n${once}\n${single}`);
});

// ---------------------------------------------------------------- 2. one pass, two sessions
await t('one pass, two sessions finalized concurrently: exactly one session gets the pass', async () => {
  await seedSession('s1');
  await seedSession('s2');
  for (const s of ['s1', 's2']) { await seedRsvp(s, 'p1'); await seedRsvp(s, 'p2'); }
  await seedWallet('p1', { freeSessionPasses: 1 });
  const [a, b] = await Promise.all([finalizeSession(hostA, 's1'), finalizeSession(hostB, 's2')]);
  if (!a.ok || !b.ok) throw new Error(`a finalize failed: ${a.reason ?? ''} ${b.reason ?? ''}`);
  const usedBy = [];
  for (const s of ['s1', 's2']) if ((await readRsvp(s, 'p1')).walletPassApplied) usedBy.push(s);
  if (usedBy.length !== 1) throw new Error(`pass used by ${usedBy.length} sessions: ${usedBy}`);
  await assertConserved('p1', ['s1', 's2'], { passes: 1, credit: 0 }, 'p1');
});

// ---------------------------------------------------------------- 3. top-up while finalizing
await t('host tops up credit while a finalize is in flight: no lost update (I2 holds)', async () => {
  await seedSession('s1');
  await seedRsvp('s1', 'p1');
  await seedRsvp('s1', 'p2');
  await seedWallet('p1', { creditBalance: 50 });
  const [fin] = await Promise.all([
    finalizeSession(hostA, 's1'),
    updateClubWalletOn(hostB, { clubId: CLUB, playerId: 'p1', uid: 'host', update: { creditDelta: 25 } }),
  ]);
  if (!fin.ok) throw new Error(`finalize failed: ${fin.reason}`);
  await assertConserved('p1', ['s1'], { passes: 0, credit: 75 }, 'p1');
});

// ---------------------------------------------------------------- 4. leave while finalizing
await t('player leaves while the host finalizes: refused as "changed their RSVP", or consistent (never a charged "out" row)', async () => {
  await seedSession('s1');
  await seedRsvp('s1', 'p1');
  await seedRsvp('s1', 'p2');
  await seedWallet('p1', { freeSessionPasses: 1, creditBalance: 20 });
  const [fin] = await Promise.all([
    finalizeSession(hostA, 's1'),
    updateDoc(doc(playerClient, 'rsvps', 'rsvp_s1_p1'), { status: 'out', penaltyPercentApplied: 0, guestCount: 0 }),
  ]);
  if (!fin.ok && !/changed their RSVP just now/.test(fin.reason)) throw new Error(`unexpected refusal: ${fin.reason}`);
  const row = await readRsvp('s1', 'p1');
  const session = await readSession('s1');
  await assertConserved('p1', ['s1'], { passes: 1, credit: 20 }, 'p1');
  if (row.status === 'out' && (row.walletPassApplied || cents(row.walletCreditApplied) > 0 || cents(row.feeShare) > 0)) {
    throw new Error(`half state: "out" row still holds a ledger charge (finalized=${session.feeSplitFinalized}, ${stable(row)})`);
  }
});

// ---------------------------------------------------------------- 5. Received races a recalculate
await t('a cash "Received" mark races with a recalculate: the payment survives', async () => {
  await seedSession('s1', { feeSplitFinalized: true, bookingStatus: 'completed' });
  await seedRsvp('s1', 'p1');
  await seedRsvp('s1', 'p2');
  await seedWallet('p1', {});
  await finalizeSession(hostA, 's1');
  const before = await readRsvp('s1', 'p1');
  const [, rec] = await Promise.all([
    updateDoc(doc(hostB, 'rsvps', 'rsvp_s1_p1'), { paidStatus: 'paid', paidMethod: 'cash' }),
    recalculate(hostA, 's1'),
  ]);
  if (!rec.ok) throw new Error(`recalculate failed: ${rec.reason}`);
  const after = await readRsvp('s1', 'p1');
  if (after.paidStatus !== 'paid' || after.paidMethod !== 'cash') {
    throw new Error(`payment was wiped: ${stable(before)} -> ${stable(after)}`);
  }
});

// ---------------------------------------------------------------- 6. reopen races finalize
await t('reopen races with finalize: ends fully finalized or fully open, wallets conserved, never half', async () => {
  await seedSession('s1');
  await seedRsvp('s1', 'p1', { guestCount: 1 });
  await seedRsvp('s1', 'p2');
  await seedWallet('p1', { freeSessionPasses: 1, creditBalance: 15 });
  await seedWallet('p2', { creditBalance: 40 });
  await finalizeSession(hostA, 's1');
  const [x, y] = await Promise.all([reopenSession(hostB, 's1'), finalizeSession(hostA, 's1')]);
  void x; void y;
  await assertConserved('p1', ['s1'], { passes: 1, credit: 15 }, 'p1');
  await assertConserved('p2', ['s1'], { passes: 0, credit: 40 }, 'p2');
  const session = await readSession('s1');
  const rows = await Promise.all(['p1', 'p2'].map((p) => readRsvp('s1', p)));
  const charged = rows.some((r) => r.walletPassApplied || cents(r.walletCreditApplied) > 0 || cents(r.grossFeeShare) > 0);
  if (!session.feeSplitFinalized && charged) {
    throw new Error(`half state: session is open but rows still hold charges (${rows.map(stable).join(' | ')})`);
  }
  if (session.feeSplitFinalized && !charged) {
    throw new Error('half state: session says finalized but no row carries a charge');
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
