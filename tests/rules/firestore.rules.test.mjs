import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import fs from 'node:fs';

// Run with `npm run test:rules` (starts the Firestore emulator; needs Java 21+). Mirrors production: every denial
// below is something the live database must refuse, every `ok` is something the app really does.
const RULES = fs.readFileSync(
  process.env.RULES_PATH || new URL('../../firestore.rules', import.meta.url),
  'utf8'
);
const DB = 'ai-studio-test'; // named database is irrelevant for the emulator; default db is used
const ST = () => firebase.firestore.FieldValue.serverTimestamp();

const env = await initializeTestEnvironment({
  projectId: 'courtpulse-rules-test',
  firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
});

const ctx = (uid, email = `${uid}@x.com`) =>
  env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const unverified = (uid) => env.authenticatedContext(uid, { email: `${uid}@x.com`, email_verified: false }).firestore();

const club = (over = {}) => ({
  name: 'Club One', description: 'd', paymentInfo: 'PayNow 1', freeCancelHours: 24, lockCancelHours: 2,
  lateCancelFeePercent: 50, noShowFeePercent: 100, visibility: 'public', ownerPlayerId: 'p_owner',
  ownerId: 'u_admin', createdAt: new Date(), updatedAt: new Date(), ...over,
});
const player = (over = {}) => ({
  name: 'P', playerTag: '#1', joinedClubIdsCsv: 'c1', wins: 0, losses: 0, gamesPlayed: 0, pointsScored: 0,
  pointsConceded: 0, singlesWins: 0, singlesLosses: 0, doublesWins: 0, doublesLosses: 0, ratingScore: 1200,
  ownerId: 'u_admin', createdAt: new Date(), updatedAt: new Date(), ...over,
});
const session = (over = {}) => ({
  clubId: 'c1', title: 'T', venue: 'V', courtNumbers: '1', sessionDate: '2026-12-01', startTime: '20:00', endTime: '22:00',
  bookingStatus: 'booked', courtFee: 40, shuttlesUsed: 0, shuttleUnitCost: 0, shuttleFee: 0, maxPlayers: 8,
  organizerName: 'O', paymentInfo: 'PayNow 1', feeSplitFinalized: false, ownerId: 'u_owner',
  startsAt: new Date(Date.now() + 48 * 3600e3),
  freeCancelUntil: new Date(Date.now() + 24 * 3600e3),
  lateCancelUntil: new Date(Date.now() + 46 * 3600e3),
  createdAt: new Date(), updatedAt: new Date(), ...over,
});
const rsvp = (pid, over = {}) => ({
  clubId: 'c1', sessionId: 's1', playerId: pid, playerName: 'P', status: 'going', attendanceOutcome: 'present',
  penaltyPercentApplied: 0, feeShare: 0, paidStatus: 'unpaid', paidMethod: 'N/A', ownerId: 'u_x',
  createdAt: new Date(), updatedAt: new Date(), ...over,
});

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await db.doc('clubs/c1').set(club());
    await db.doc('players/p_owner').set(player({ authUid: 'u_owner', ownerId: 'u_owner' }));
    await db.doc('players/p_a').set(player({ authUid: 'u_a', ownerId: 'u_a' }));
    await db.doc('players/p_b').set(player({ authUid: 'u_b', ownerId: 'u_b' }));
    await db.doc('players/p_out').set(player({ authUid: 'u_out', ownerId: 'u_out', joinedClubIdsCsv: '' }));
    await db.doc('sessions/s1').set(session());
    for (const [u, p] of [['u_owner', 'p_owner'], ['u_a', 'p_a'], ['u_b', 'p_b'], ['u_out', 'p_out']]) {
      await db.doc('profiles/' + u).set({ playerId: p, ownerId: u, createdAt: new Date(), updatedAt: new Date() });
    }
  });
}

let pass = 0, fail = 0;
async function t(name, fn) {
  await seed();
  try { await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 20s')), 20000))]); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, '\n     ', String(e.message || e).split('\n')[0]); }
}
const ok = (p) => assertSucceeds(p);
const no = (p) => assertFails(p);

// ---- P0-1 gear locker
await t('P0-1 new user can read their own missing gearLocker doc', async () => {
  await ok(ctx('u_a').doc('gearLockers/u_a').get());
});
await t("P0-1 user cannot read someone else's locker", async () => {
  await no(ctx('u_a').doc('gearLockers/u_b').get());
});
await t('P0-1 user can create own locker', async () => {
  await ok(ctx('u_a').doc('gearLockers/u_a').set({ stateJson: '{}', version: 3, ownerId: 'u_a', createdAt: ST(), updatedAt: ST() }));
});

// ---- unverified
await t('unverified user cannot read clubs', async () => { await no(unverified('u_a').doc('clubs/c1').get()); });

// ---- P0-2 rsvp
await t('P0-2 player creates own RSVP with deterministic id', async () => {
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').set(rsvp('p_a', { ownerId: 'u_a', createdAt: ST(), updatedAt: ST() })));
});
await t('P0-2 player cannot create RSVP with arbitrary id', async () => {
  await no(ctx('u_a').doc('rsvps/spam1').set(rsvp('p_a', { ownerId: 'u_a', createdAt: ST(), updatedAt: ST() })));
});
await t("P0-2 player cannot create RSVP for another player", async () => {
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_b').set(rsvp('p_b', { ownerId: 'u_a', createdAt: ST(), updatedAt: ST() })));
});
await t('P0-2 going with non-zero penalty rejected', async () => {
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').set(rsvp('p_a', { ownerId: 'u_a', penaltyPercentApplied: 10, createdAt: ST(), updatedAt: ST() })));
});
await t('P0-2 player cannot create RSVP with wallet ledger fields', async () => {
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').set(rsvp('p_a', { ownerId: 'u_a', walletCreditApplied: 20, grossFeeShare: 20, createdAt: ST(), updatedAt: ST() })));
});
async function seedRsvp(pid, over = {}) {
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc(`rsvps/rsvp_s1_${pid}`).set(rsvp(pid, { ownerId: `u_${pid.slice(2)}`, ...over })));
}
await t('P0-2 late_out below club late-fee % rejected', async () => {
  await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'late_out', penaltyPercentApplied: 0, updatedAt: ST() }));
});
await t('P0-2 late_out at club late-fee % accepted', async () => {
  await seedRsvp('p_a');
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'late_out', penaltyPercentApplied: 50, updatedAt: ST() }));
});
await t('P0-2 player cannot edit feeShare', async () => {
  await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ feeShare: 0.01, updatedAt: ST() }));
});
await t('P0-2 player cannot edit attendanceOutcome', async () => {
  await seedRsvp('p_a', { attendanceOutcome: 'no_show' });
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ attendanceOutcome: 'present', updatedAt: ST() }));
});
await t('P0-2 player cannot touch wallet ledger fields', async () => {
  await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ walletCreditApplied: 5, updatedAt: ST() }));
});
await t('P0-2 player can delete own RSVP while open/unpaid/fee 0', async () => {
  await seedRsvp('p_a');
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').delete());
});
await t('P0-2 player cannot delete RSVP once fee assigned', async () => {
  await seedRsvp('p_a', { feeShare: 25 });
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').delete());
});
await t('P0-2 player cannot delete RSVP after session completed', async () => {
  await seedRsvp('p_a');
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('sessions/s1').update({ bookingStatus: 'completed', feeSplitFinalized: true }));
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').delete());
});
await t('P0-2 player cannot tap out after finalize', async () => {
  await seedRsvp('p_a');
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('sessions/s1').update({ feeSplitFinalized: true }));
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, updatedAt: ST() }));
});
await t('P0-2 player can report payment sent after finalize', async () => {
  await seedRsvp('p_a', { feeShare: 20 });
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('sessions/s1').update({ bookingStatus: 'completed', feeSplitFinalized: true }));
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ paidStatus: 'pending_approval', paidMethod: 'PayNow', updatedAt: ST() }));
});
await t('P0-2 player cannot mark self paid', async () => {
  await seedRsvp('p_a', { feeShare: 20 });
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ paidStatus: 'paid', updatedAt: ST() }));
});
await t('guests: player can set guestCount 2 on own open RSVP', async () => {
  await seedRsvp('p_a');
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ guestCount: 2, guestNames: 'A, B', updatedAt: ST() }));
});
await t('guests: guestCount 9 rejected', async () => {
  await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ guestCount: 9, updatedAt: ST() }));
});
await t('owner can write ledger fields on RSVP', async () => {
  await seedRsvp('p_a', { feeShare: 20 });
  await ok(ctx('u_owner').doc('rsvps/rsvp_s1_p_a').update({ grossFeeShare: 20, walletCreditApplied: 5, feeShare: 15, updatedAt: ST() }));
});

// ---- P0-3 self sign-up
const selfPlayer = (over = {}) => player({ authUid: 'u_new', ownerId: 'u_new', joinedClubIdsCsv: '', createdAt: ST(), updatedAt: ST(), ...over });
await t('P0-3 self sign-up fresh profile ok', async () => { await ok(ctx('u_new').doc('players/player_u_new').set(selfPlayer())); });
await t('P0-3 self sign-up with rating 5000 rejected', async () => { await no(ctx('u_new').doc('players/player_u_new').set(selfPlayer({ ratingScore: 5000 }))); });
await t('P0-3 self sign-up with points rejected', async () => { await no(ctx('u_new').doc('players/player_u_new').set(selfPlayer({ pointsScored: 300 }))); });
await t('P0-3 self sign-up joining public club ok', async () => { await ok(ctx('u_new').doc('players/player_u_new').set(selfPlayer({ joinedClubIdsCsv: 'c1' }))); });

// ---- wallets
const wallet = (over = {}) => ({ clubId: 'c1', playerId: 'p_a', creditBalance: 10, freeSessionPasses: 1, waiveAllFees: false, ownerId: 'u_owner', createdAt: ST(), updatedAt: ST(), ...over });
await t('wallet: owner creates wallet', async () => { await ok(ctx('u_owner').doc('clubWallets/wallet_c1_p_a').set(wallet())); });
await t('wallet: player cannot create own wallet', async () => { await no(ctx('u_a').doc('clubWallets/wallet_c1_p_a').set(wallet({ ownerId: 'u_a' }))); });
await t('wallet: wrong doc id rejected', async () => { await no(ctx('u_owner').doc('clubWallets/zzz').set(wallet())); });
async function seedWallet() { await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('clubWallets/wallet_c1_p_a').set({ ...wallet(), createdAt: new Date(), updatedAt: new Date() })); }
await t('wallet: player reads own wallet by id', async () => { await seedWallet(); await ok(ctx('u_a').doc('clubWallets/wallet_c1_p_a').get()); });
await t("wallet: other player cannot read it by id", async () => { await seedWallet(); await no(ctx('u_b').doc('clubWallets/wallet_c1_p_a').get()); });
await t('wallet: player lists own wallets where playerId==', async () => { await seedWallet(); await ok(ctx('u_a').collection('clubWallets').where('playerId', '==', 'p_a').get()); });
await t('wallet: owner lists where clubId==', async () => { await seedWallet(); await ok(ctx('u_owner').collection('clubWallets').where('clubId', '==', 'c1').get()); });
await t("wallet: owner lists where clubId in [c1]", async () => { await seedWallet(); await ok(ctx('u_owner').collection('clubWallets').where('clubId', 'in', ['c1']).get()); });
await t("wallet: other player cannot list someone else's wallets", async () => { await seedWallet(); await no(ctx('u_b').collection('clubWallets').where('playerId', '==', 'p_a').get()); });
await t('wallet: unfiltered list rejected for player', async () => { await seedWallet(); await no(ctx('u_a').collection('clubWallets').get()); });
await t('wallet: player cannot modify wallet', async () => { await seedWallet(); await no(ctx('u_a').doc('clubWallets/wallet_c1_p_a').update({ creditBalance: 999, updatedAt: ST() })); });
await t('wallet: owner can update wallet', async () => { await seedWallet(); await ok(ctx('u_owner').doc('clubWallets/wallet_c1_p_a').update({ creditBalance: 5, updatedAt: ST() })); });
await t('wallet: negative credit rejected', async () => { await seedWallet(); await no(ctx('u_owner').doc('clubWallets/wallet_c1_p_a').update({ creditBalance: -1, updatedAt: ST() })); });
await t('wallet: owner transaction rsvp+wallet atomically', async () => {
  await seedWallet(); await seedRsvp('p_a', { feeShare: 20 });
  const db = ctx('u_owner');
  await ok(db.runTransaction(async (tx) => {
    const w = db.doc('clubWallets/wallet_c1_p_a'); const r = db.doc('rsvps/rsvp_s1_p_a');
    await tx.get(w); await tx.get(r);
    tx.update(w, { creditBalance: 0, updatedAt: ST() });
    tx.update(r, { grossFeeShare: 20, walletCreditApplied: 10, feeShare: 10, updatedAt: ST() });
  }));
});

await t('wallet: owner transaction creates a missing wallet (tx.get on missing doc then set)', async () => {
  await seedRsvp('p_a', { feeShare: 20 });
  const db = ctx('u_owner');
  await ok(db.runTransaction(async (tx) => {
    const w = db.doc('clubWallets/wallet_c1_p_a'); const r = db.doc('rsvps/rsvp_s1_p_a');
    const ws = await tx.get(w); await tx.get(r);
    if (ws.exists) throw new Error('should not exist');
    tx.set(w, { clubId: 'c1', playerId: 'p_a', creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false, ownerId: 'u_owner', createdAt: ST(), updatedAt: ST() });
    tx.update(r, { grossFeeShare: 20, updatedAt: ST() });
  }));
});
await t('wallet: site admin (not club owner) can manage wallets', async () => {
  await ok(ctx('u_adm', 'yuwon6881@gmail.com').doc('clubWallets/wallet_c1_p_a').set(wallet({ ownerId: 'u_adm' })));
});
// ---- matches / stats
const matchDoc = (over = {}) => ({
  clubId: 'c1', sessionId: 's1', matchFormat: 'doubles', teamAPlayer1Id: 'p_owner', teamAPlayer1Name: 'O',
  teamAPlayer2Id: 'p_a', teamAPlayer2Name: 'A', teamBPlayer1Id: 'p_b', teamBPlayer1Name: 'B',
  teamBPlayer2Id: 'NONE', teamBPlayer2Name: 'None', scoreTeamA: 21, scoreTeamB: 15, setScoresText: '21-15',
  winnerSide: 'A', ownerId: 'u_owner', createdAt: ST(), updatedAt: ST(), ...over,
});
async function recordMatch(db, mid, m, ids) {
  const b = db.batch();
  b.set(db.doc(`matches/${mid}`), m);
  for (const [pid, w] of ids) {
    b.update(db.doc(`players/${pid}`), { wins: w ? 1 : 0, losses: w ? 0 : 1, gamesPlayed: 1, pointsScored: w ? 21 : 15, pointsConceded: w ? 15 : 21, doublesWins: w ? 1 : 0, doublesLosses: w ? 0 : 1, ratingScore: 1216, lastMatchId: mid, updatedAt: ST() });
  }
  return b.commit();
}
await t('match: owner records doubles-with-placeholder match + stats (3 players)', async () => {
  await ok(recordMatch(ctx('u_owner'), 'm1', matchDoc(), [['p_owner', true], ['p_a', true], ['p_b', false]]));
});
await t('match: tie rejected', async () => { await no(ctx('u_owner').doc('matches/m1').set(matchDoc({ scoreTeamB: 21 }))); });
await t('match: wrong winnerSide rejected', async () => { await no(ctx('u_owner').doc('matches/m1').set(matchDoc({ winnerSide: 'B' }))); });
await t('match: non-integer score rejected', async () => { await no(ctx('u_owner').doc('matches/m1').set(matchDoc({ scoreTeamA: 21.5 }))); });
await t('match: owner cannot rewrite stats of non-member', async () => {
  await no(recordMatch(ctx('u_owner'), 'm1', matchDoc({ teamBPlayer1Id: 'p_out', teamBPlayer1Name: 'X' }), [['p_out', true]]));
});
await t('match: player cannot record match', async () => { await no(ctx('u_a').doc('matches/m1').set(matchDoc({ ownerId: 'u_a' }))); });
await t('match: stats without a new match rejected', async () => {
  await no(ctx('u_owner').doc('players/p_a').update({ wins: 50, losses: 0, gamesPlayed: 50, lastMatchId: 'ghost', updatedAt: ST() }));
});
await t('match: stat jump of +2 games rejected', async () => {
  const db = ctx('u_owner'); const b = db.batch();
  b.set(db.doc('matches/m1'), matchDoc());
  b.update(db.doc('players/p_a'), { wins: 2, gamesPlayed: 2, lastMatchId: 'm1', updatedAt: ST() });
  await no(b.commit());
});
await t('match: delete match + rollback stats in one batch', async () => {
  await recordMatch(ctx('u_owner'), 'm1', matchDoc(), [['p_owner', true], ['p_a', true], ['p_b', false]]);
  const db = ctx('u_owner'); const b = db.batch();
  b.delete(db.doc('matches/m1'));
  for (const pid of ['p_owner', 'p_a', 'p_b']) b.update(db.doc(`players/${pid}`), { wins: 0, losses: 0, gamesPlayed: 0, pointsScored: 0, pointsConceded: 0, doublesWins: 0, doublesLosses: 0, ratingScore: 1200, lastMatchId: 'm1', updatedAt: ST() });
  await ok(b.commit());
});

// ---- increment() payloads (what the client really sends)
const INC = (n) => firebase.firestore.FieldValue.increment(n);
async function recordMatchInc(db, mid, m, ids) {
  const b = db.batch();
  b.set(db.doc('matches/' + mid), m);
  for (const [pid, w] of ids) {
    b.update(db.doc('players/' + pid), { gamesPlayed: INC(1), wins: INC(w ? 1 : 0), losses: INC(w ? 0 : 1), pointsScored: INC(w ? 21 : 15), pointsConceded: INC(w ? 15 : 21), doublesWins: INC(w ? 1 : 0), doublesLosses: INC(w ? 0 : 1), ratingScore: 1216, lastMatchId: mid, updatedAt: ST() });
  }
  return b.commit();
}
await t('increment: owner records a match with increment() deltas', async () => {
  await ok(recordMatchInc(ctx('u_owner'), 'm1', matchDoc(), [['p_owner', true], ['p_a', true], ['p_b', false]]));
});
await t('increment: +2 games via increment rejected', async () => {
  const db = ctx('u_owner'); const b = db.batch();
  b.set(db.doc('matches/m1'), matchDoc());
  b.update(db.doc('players/p_a'), { gamesPlayed: INC(2), wins: INC(2), lastMatchId: 'm1', updatedAt: ST() });
  await no(b.commit());
});
await t('increment: second match for the same players works (counters keep accumulating)', async () => {
  await ok(recordMatchInc(ctx('u_owner'), 'm1', matchDoc(), [['p_owner', true], ['p_a', true], ['p_b', false]]));
  await ok(recordMatchInc(ctx('u_owner'), 'm2', matchDoc(), [['p_owner', true], ['p_a', true], ['p_b', false]]));
});
await t('increment: delete match with negative increments', async () => {
  await recordMatchInc(ctx('u_owner'), 'm1', matchDoc(), [['p_owner', true], ['p_a', true], ['p_b', false]]);
  const db = ctx('u_owner'); const b = db.batch();
  b.delete(db.doc('matches/m1'));
  for (const [pid, w] of [['p_owner', true], ['p_a', true], ['p_b', false]]) {
    b.update(db.doc('players/' + pid), { gamesPlayed: INC(-1), wins: INC(w ? -1 : 0), losses: INC(w ? 0 : -1), pointsScored: INC(w ? -21 : -15), pointsConceded: INC(w ? -15 : -21), doublesWins: INC(w ? -1 : 0), doublesLosses: INC(w ? 0 : -1), ratingScore: 1200, lastMatchId: 'm1', updatedAt: ST() });
  }
  await ok(b.commit());
});
await t('increment: player who left the club can still have a deleted match rolled back', async () => {
  await recordMatchInc(ctx('u_owner'), 'm1', matchDoc(), [['p_owner', true], ['p_a', true], ['p_b', false]]);
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('players/p_a').update({ joinedClubIdsCsv: '' }));
  const db = ctx('u_owner'); const b = db.batch();
  b.delete(db.doc('matches/m1'));
  for (const [pid, w] of [['p_owner', true], ['p_a', true], ['p_b', false]]) {
    b.update(db.doc('players/' + pid), { gamesPlayed: INC(-1), wins: INC(w ? -1 : 0), losses: INC(w ? 0 : -1), pointsScored: INC(w ? -21 : -15), pointsConceded: INC(w ? -15 : -21), doublesWins: INC(w ? -1 : 0), doublesLosses: INC(w ? 0 : -1), lastMatchId: 'm1', updatedAt: ST() });
  }
  await ok(b.commit());
});

// ---- players / clubs
await t('player can join public club by appending', async () => {
  await ok(ctx('u_out').doc('players/p_out').update({ joinedClubIdsCsv: 'c1', actingClubId: 'c1', updatedAt: ST() }));
});
await t('player can leave club', async () => {
  await ok(ctx('u_a').doc('players/p_a').update({ joinedClubIdsCsv: '', actingClubId: 'c1', updatedAt: ST() }));
});
await t('club owner (player) cannot leave own club', async () => {
  await no(ctx('u_owner').doc('players/p_owner').update({ joinedClubIdsCsv: '', actingClubId: 'c1', updatedAt: ST() }));
});
await t('player cannot change authUid', async () => {
  await no(ctx('u_a').doc('players/p_a').update({ authUid: 'u_b', updatedAt: ST() }));
});
await t('club owner cannot rename or re-rate an account-linked member', async () => {
  await no(ctx('u_owner').doc('players/p_a').update({ name: 'Hacked', actingClubId: 'c1', updatedAt: ST() }));
  await no(ctx('u_owner').doc('players/p_a').update({ ratingScore: 2600, actingClubId: 'c1', updatedAt: ST() }));
});
await t('club owner can rename an unlinked member profile', async () => {
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('players/p_unl').set(player({ joinedClubIdsCsv: 'c1', ownerId: 'u_owner' })));
  await ok(ctx('u_owner').doc('players/p_unl').update({ name: 'Renamed', actingClubId: 'c1', updatedAt: ST() }));
});
await t('club owner can update club settings, not ownership', async () => {
  await ok(ctx('u_owner').doc('clubs/c1').update({ lateCancelFeePercent: 40, excludeOwnerFromBilling: true, updatedAt: ST() }));
  await no(ctx('u_owner').doc('clubs/c1').update({ ownerPlayerId: 'p_a', updatedAt: ST() }));
});
await t('non-owner cannot update club', async () => { await no(ctx('u_a').doc('clubs/c1').update({ lateCancelFeePercent: 0, updatedAt: ST() })); });
await t('bootstrap admin can delete player', async () => { await ok(ctx('u_adm', 'yuwon6881@gmail.com').doc('players/p_b').delete()); });
await t('player self-delete allowed once they have left all clubs', async () => { await ok(ctx('u_out').doc('players/p_out').delete()); });
await t('player self-delete denied while still in a club', async () => { await no(ctx('u_b').doc('players/p_b').delete()); });
await t('owner cannot enrol a linked player without a join request', async () => {
  await no(ctx('u_owner').doc('players/p_out').update({ joinedClubIdsCsv: 'c1', actingClubId: 'c1', updatedAt: ST() }));
});
await t('owner can enrol a linked player who filed a join request', async () => {
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('clubJoinRequests/joinreq_c1_p_out').set({ clubId: 'c1', playerId: 'p_out', playerName: 'X', playerTag: '#9', ownerId: 'u_out', createdAt: new Date(), updatedAt: new Date() }));
  await ok(ctx('u_owner').doc('players/p_out').update({ joinedClubIdsCsv: 'c1', actingClubId: 'c1', updatedAt: ST() }));
});
await t('owner can enrol an unlinked member profile', async () => {
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('players/p_unl').set(player({ joinedClubIdsCsv: '', ownerId: 'u_owner' })));
  await ok(ctx('u_owner').doc('players/p_unl').update({ joinedClubIdsCsv: 'c1', actingClubId: 'c1', updatedAt: ST() }));
});
await t('late_out cannot be walked back to going', async () => {
  await seedRsvp('p_a', { status: 'late_out', penaltyPercentApplied: 50 });
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'going', penaltyPercentApplied: 0, updatedAt: ST() }));
});
await t('late_out row cannot be deleted by the player', async () => {
  await seedRsvp('p_a', { status: 'late_out', penaltyPercentApplied: 50 });
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').delete());
});
await t('player cannot delete RSVP while session is in_play', async () => {
  await seedRsvp('p_a');
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('sessions/s1').update({ bookingStatus: 'in_play' }));
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').delete());
});
await t('manager cannot create an RSVP for a non-member', async () => {
  await no(ctx('u_owner').doc('rsvps/rsvp_s1_p_out').set(rsvp('p_out', { ownerId: 'u_owner', createdAt: ST(), updatedAt: ST() })));
});
await t('manager can create an RSVP for a member', async () => {
  await ok(ctx('u_owner').doc('rsvps/rsvp_s1_p_b').set(rsvp('p_b', { ownerId: 'u_owner', createdAt: ST(), updatedAt: ST() })));
});
await t('other player cannot delete a player', async () => { await no(ctx('u_a').doc('players/p_b').delete()); });


// ================= cancel window enforced by the database =================
const HOUR = 3600e3;
async function setSession(over) { await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('sessions/s1').update(over)); }
async function setClub(over) { await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('clubs/c1').update(over)); }
const startIn = (h, free = 24, lock = 2) => ({
  startsAt: new Date(Date.now() + h * HOUR),
  lateCancelUntil: new Date(Date.now() + (h - lock) * HOUR),
  ...(free > 0 ? { freeCancelUntil: new Date(Date.now() + (h - free) * HOUR) } : {}),
});
const noFree = () => ({ freeCancelUntil: firebase.firestore.FieldValue.delete() });
const goingDoc = (pid, uid, over = {}) => rsvp(pid, { ownerId: uid, createdAt: ST(), updatedAt: ST(), ...over });

// What the app really sends when a player joins: every optional guest + wallet-ledger field present
const fullAppRsvp = (pid, uid, over = {}) => ({
  clubId: 'c1', sessionId: 's1', playerId: pid, playerName: 'Test Player', guestCount: 1, guestNames: 'A Friend',
  status: 'going', attendanceOutcome: 'present', penaltyPercentApplied: 0, feeShare: 0, grossFeeShare: 0,
  walletCreditApplied: 0, walletPassApplied: false, walletWaiverApplied: false, paidStatus: 'unpaid',
  paidMethod: 'pending', ownerId: uid, createdAt: ST(), updatedAt: ST(), ...over,
});
await t('REGRESSION (found by browser E2E): a player joining with the app\'s FULL payload is accepted', async () => {
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').set(fullAppRsvp('p_a', 'u_a')));
});
await t('REGRESSION: full-payload join by a player who is NOT the club owner nor admin, in a club that has an owner', async () => {
  await ok(ctx('u_b').doc('rsvps/rsvp_s1_p_b').set(fullAppRsvp('p_b', 'u_b', { guestCount: 0 })));
});
await t('REGRESSION: manager adds a member RSVP with the full payload', async () => {
  await ok(ctx('u_owner').doc('rsvps/rsvp_s1_p_b').set(fullAppRsvp('p_b', 'u_owner')));
});
await t('REGRESSION: site admin adds a member RSVP with the full payload', async () => {
  await ok(ctx('u_adm', 'yuwon6881@gmail.com').doc('rsvps/rsvp_s1_p_a').set(fullAppRsvp('p_a', 'u_adm')));
});
await t('REGRESSION: a player cannot join with a non-zero ledger field or an outsider player id', async () => {
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').set(fullAppRsvp('p_a', 'u_a', { walletCreditApplied: 5 })));
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_b').set(fullAppRsvp('p_b', 'u_a')));
});
await t('window: join before start ok', async () => { await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').set(goingDoc('p_a', 'u_a'))); });
await t('window: join after start denied', async () => {
  await setSession(startIn(-1));
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').set(goingDoc('p_a', 'u_a')));
});
await t('window: join denied when session has no startsAt', async () => {
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('sessions/s1').update({ startsAt: firebase.firestore.FieldValue.delete() }));
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').set(goingDoc('p_a', 'u_a')));
});
await t('window: creating an already-cancelled RSVP is denied', async () => {
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').set(goingDoc('p_a', 'u_a', { status: 'out' })));
});
await t('window(free, 48h out): free out ok', async () => {
  await seedRsvp('p_a'); await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, updatedAt: ST() }));
});
await t('window(10h out, free=24 lock=2): free out denied', async () => {
  await setSession(startIn(10)); await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, updatedAt: ST() }));
});
await t('window(10h out): late_out at club % ok', async () => {
  await setSession(startIn(10)); await seedRsvp('p_a');
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'late_out', penaltyPercentApplied: 50, updatedAt: ST() }));
});
await t('window(10h out): deleting a going RSVP denied (that would be a free cancel)', async () => {
  await setSession(startIn(10)); await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').delete());
});
await t('window(10h out): guest decrease denied, increase ok', async () => {
  await setSession(startIn(10)); await seedRsvp('p_a', { guestCount: 2 });
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ guestCount: 1, updatedAt: ST() }));
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ guestCount: 3, updatedAt: ST() }));
});
await t('window(1h out, inside lock=2h): late_out denied', async () => {
  await setSession(startIn(1)); await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'late_out', penaltyPercentApplied: 50, updatedAt: ST() }));
});
await t('window(1h out): free out denied', async () => {
  await setSession(startIn(1)); await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, updatedAt: ST() }));
});
await t('window(after start): late_out and guest increase denied', async () => {
  await setSession(startIn(-1)); await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'late_out', penaltyPercentApplied: 50, updatedAt: ST() }));
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ guestCount: 1, updatedAt: ST() }));
});
await t('window: no freeCancelUntil (club freeCancelHours = 0) means no free cancel even 48h out', async () => {
  await setSession(noFree()); await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, updatedAt: ST() }));
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').delete());
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'late_out', penaltyPercentApplied: 50, updatedAt: ST() }));
});
await t('window: lateCancelUntil == startsAt (lock 0h) allows late_out until the start', async () => {
  await setSession(startIn(0.25, 24, 0)); await seedRsvp('p_a');
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'late_out', penaltyPercentApplied: 50, updatedAt: ST() }));
});
await t('window: deadline boundaries - free out 1.5h cutoff behaves', async () => {
  await setSession(startIn(1, 1.5, 0)); await seedRsvp('p_a');
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, updatedAt: ST() }));
  await setSession(startIn(2, 1.5, 0));
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, updatedAt: ST() }));
});
await t('window: free cancel that also clears guests (what the app writes) is allowed', async () => {
  await seedRsvp('p_a', { guestCount: 2 });
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, guestCount: 0, paidStatus: 'unpaid', paidMethod: 'N/A', playerName: 'P', updatedAt: ST() }));
});
await t('window: late cancel that also clears guests is allowed', async () => {
  await setSession(startIn(10)); await seedRsvp('p_a', { guestCount: 2 });
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'late_out', penaltyPercentApplied: 50, guestCount: 0, updatedAt: ST() }));
});
await t('window: a cancel cannot quietly change guests to a non-zero different number', async () => {
  await seedRsvp('p_a', { guestCount: 3 });
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, guestCount: 1, updatedAt: ST() }));
});
await t('window: rejoin (out -> going) before start ok; after late_out never', async () => {
  await seedRsvp('p_a', { status: 'out' });
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'going', penaltyPercentApplied: 0, updatedAt: ST() }));
});
await t('window: an already-out row can be deleted any time', async () => {
  await setSession(startIn(1)); await seedRsvp('p_a', { status: 'out' });
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').delete());
});
await t('window: managers are not bound by the player window', async () => {
  await setSession(startIn(-1)); await seedRsvp('p_a');
  await ok(ctx('u_owner').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, attendanceOutcome: 'no_show', updatedAt: ST() }));
});
await t('schema: club timezone accepted, empty timezone rejected', async () => {
  await ok(ctx('u_owner').doc('clubs/c1').update({ timezone: 'Asia/Singapore', updatedAt: ST() }));
  await no(ctx('u_owner').doc('clubs/c1').update({ timezone: '', updatedAt: ST() }));
});
await t('schema: manager can move a session start (startsAt update)', async () => {
  await ok(ctx('u_owner').doc('sessions/s1').update({ startsAt: firebase.firestore.Timestamp.fromMillis(Date.now() + 5 * HOUR), updatedAt: ST() }));
  await no(ctx('u_owner').doc('sessions/s1').update({ startsAt: 'tomorrow', updatedAt: ST() }));
});
await t('schema: player cannot write startsAt on a session', async () => {
  await no(ctx('u_a').doc('sessions/s1').update({ startsAt: new Date(Date.now() + 99 * HOUR), updatedAt: ST() }));
});

// ================= membership isolation =================
async function seedClub2() {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await db.doc('clubs/c2').set(club({ name: 'Club Two', ownerPlayerId: 'p_two', visibility: 'private', ownerId: 'u_two' }));
    await db.doc('players/p_two').set(player({ authUid: 'u_two', ownerId: 'u_two', joinedClubIdsCsv: 'c2' }));
    await db.doc('profiles/u_two').set({ playerId: 'p_two', ownerId: 'u_two', createdAt: new Date(), updatedAt: new Date() });
    await db.doc('sessions/s2').set(session({ clubId: 'c2', ownerId: 'u_two' }));
    await db.doc('rsvps/rsvp_s2_p_two').set(rsvp('p_two', { clubId: 'c2', sessionId: 's2', ownerId: 'u_two' }));
    await db.doc('rsvps/rsvp_s1_p_a').set(rsvp('p_a', { ownerId: 'u_a' }));
    await db.doc('matches/m_c2').set({ ...matchDoc({ clubId: 'c2', sessionId: 's2', ownerId: 'u_two' }), createdAt: new Date(), updatedAt: new Date() });
  });
}
await t('privacy: member reads own club sessions (get + list)', async () => {
  await seedClub2();
  await ok(ctx('u_a').doc('sessions/s1').get());
  await ok(ctx('u_a').collection('sessions').where('clubId', '==', 'c1').get());
});
await t("privacy: member cannot read another club's session (get)", async () => { await seedClub2(); await no(ctx('u_a').doc('sessions/s2').get()); });
await t("privacy: member cannot list another club's sessions", async () => { await seedClub2(); await no(ctx('u_a').collection('sessions').where('clubId', '==', 'c2').get()); });
await t('privacy: unfiltered session list denied for a member', async () => { await seedClub2(); await no(ctx('u_a').collection('sessions').get()); });
await t('privacy: non-member (no club) cannot read sessions', async () => { await seedClub2(); await no(ctx('u_out').doc('sessions/s1').get()); await no(ctx('u_out').collection('sessions').where('clubId', '==', 'c1').get()); });
await t('privacy: account without a profile mapping cannot read sessions', async () => { await seedClub2(); await no(ctx('u_nobody').doc('sessions/s1').get()); });
await t('privacy: rsvps and matches are member-only too', async () => {
  await seedClub2();
  await ok(ctx('u_a').collection('rsvps').where('clubId', '==', 'c1').get());
  await no(ctx('u_a').collection('rsvps').where('clubId', '==', 'c2').get());
  await no(ctx('u_out').collection('rsvps').where('clubId', '==', 'c1').get());
  await ok(ctx('u_a').collection('matches').where('clubId', '==', 'c1').get());
  await no(ctx('u_a').collection('matches').where('clubId', '==', 'c2').get());
});
await t("privacy: 'in' query over clubs the user belongs to passes; with a foreign club it is denied", async () => {
  await seedClub2();
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('players/p_a').update({ joinedClubIdsCsv: 'c1,c2' }));
  await ok(ctx('u_a').collection('sessions').where('clubId', 'in', ['c1', 'c2']).get());
  await no(ctx('u_b').collection('sessions').where('clubId', 'in', ['c1', 'c2']).get());
});
await t('privacy: unlinking the player (authUid changed) revokes access even with a stale mapping', async () => {
  await seedClub2();
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('players/p_a').update({ authUid: 'someone_else' }));
  await no(ctx('u_a').doc('sessions/s1').get());
});
await t('privacy: site admin reads everything', async () => {
  await seedClub2();
  const adm = ctx('u_adm', 'yuwon6881@gmail.com');
  await ok(adm.doc('sessions/s2').get());
  await ok(adm.collection('sessions').get());
  await ok(adm.collection('rsvps').get());
  await ok(adm.collection('clubs').get());
});
await t('privacy: private club doc hidden from non-members, visible to members; public club visible to all', async () => {
  await seedClub2();
  await no(ctx('u_a').doc('clubs/c2').get());
  await ok(ctx('u_two').doc('clubs/c2').get());
  await ok(ctx('u_a').doc('clubs/c1').get());
  await ok(ctx('u_out').doc('clubs/c1').get());
});
await t("privacy: directory query (visibility == 'public') works", async () => {
  await seedClub2();
  await ok(ctx('u_out').collection('clubs').where('visibility', '==', 'public').get());
});
await t('privacy: unfiltered clubs list denied for non-admin', async () => {
  await seedClub2();
  await no(ctx('u_out').collection('clubs').get());
});
await t("privacy: querying visibility == 'private' denied for non-admin", async () => {
  await seedClub2();
  await no(ctx('u_out').collection('clubs').where('visibility', '==', 'private').get());
});
const jr = (cid, pid, uid) => ({ clubId: cid, playerId: pid, playerName: 'X', playerTag: '#9', ownerId: uid, createdAt: new Date(), updatedAt: new Date() });
await t('privacy: join requests visible only to requester, club owner and admin', async () => {
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('clubJoinRequests/joinreq_c1_p_out').set(jr('c1', 'p_out', 'u_out')));
  await ok(ctx('u_out').collection('clubJoinRequests').where('playerId', '==', 'p_out').get());
  await ok(ctx('u_owner').collection('clubJoinRequests').where('clubId', '==', 'c1').get());
  await ok(ctx('u_owner').doc('clubJoinRequests/joinreq_c1_p_out').get());
  await no(ctx('u_b').doc('clubJoinRequests/joinreq_c1_p_out').get());
  await no(ctx('u_b').collection('clubJoinRequests').where('playerId', '==', 'p_out').get());
  await no(ctx('u_b').collection('clubJoinRequests').get());
});

// ================= profiles mapping =================
await t('profiles: self-signup batch creates player + mapping together', async () => {
  const db = ctx('u_new'); const b = db.batch();
  b.set(db.doc('players/player_u_new'), player({ authUid: 'u_new', ownerId: 'u_new', joinedClubIdsCsv: '', createdAt: ST(), updatedAt: ST() }));
  b.set(db.doc('profiles/u_new'), { playerId: 'player_u_new', ownerId: 'u_new', createdAt: ST(), updatedAt: ST() });
  await ok(b.commit());
});
await t("profiles: cannot map yourself to someone else's player", async () => {
  await no(ctx('u_new').doc('profiles/u_new').set({ playerId: 'p_a', ownerId: 'u_new', createdAt: ST(), updatedAt: ST() }));
});
await t("profiles: cannot create a mapping for another account", async () => {
  await no(ctx('u_new').doc('profiles/u_a').set({ playerId: 'p_a', ownerId: 'u_new', createdAt: ST(), updatedAt: ST() }));
});
await t('profiles: self-heal - account whose player already points at it can create its mapping', async () => {
  await env.withSecurityRulesDisabled(async (c) => { const d = c.firestore(); await d.doc('profiles/u_a').delete(); });
  await ok(ctx('u_a').doc('profiles/u_a').set({ playerId: 'p_a', ownerId: 'u_a', createdAt: ST(), updatedAt: ST() }));
});
await t('profiles: admin can create/update a mapping (claim approval); non-admin cannot update', async () => {
  const adm = ctx('u_adm', 'yuwon6881@gmail.com');
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('players/p_claim').set(player({ joinedClubIdsCsv: '', ownerId: 'u_adm' })));
  await ok(adm.doc('profiles/u_claimer').set({ playerId: 'p_claim', ownerId: 'u_adm', createdAt: ST(), updatedAt: ST() }));
  await ok(adm.doc('profiles/u_claimer').update({ playerId: 'p_a', updatedAt: ST() }));
  await no(ctx('u_a').doc('profiles/u_a').update({ playerId: 'p_b', updatedAt: ST() }));
});
await t('profiles: only the owner of the mapping (or admin) can read or delete it', async () => {
  await ok(ctx('u_a').doc('profiles/u_a').get());
  await no(ctx('u_a').doc('profiles/u_b').get());
  await no(ctx('u_a').doc('profiles/u_b').delete());
  await ok(ctx('u_a').doc('profiles/u_a').delete());
});

// ---- stats can only move by exactly one real game, for club members
await t('match: owner cannot record a match that includes a non-member', async () => {
  await no(ctx('u_owner').doc('matches/m9').set(matchDoc({ teamBPlayer1Id: 'p_out', teamBPlayer1Name: 'X' })));
});
await t('match: deleting a match cannot wipe more than that one game', async () => {
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('players/p_b').update({ gamesPlayed: 5, wins: 2, losses: 3, pointsScored: 90, pointsConceded: 100, doublesWins: 2, doublesLosses: 3 }));
  await recordMatchInc(ctx('u_owner'), 'm1', matchDoc(), [['p_owner', true], ['p_a', true], ['p_b', false]]);
  const db = ctx('u_owner'); const b = db.batch();
  b.delete(db.doc('matches/m1'));
  b.update(db.doc('players/p_b'), { gamesPlayed: 0, wins: 0, losses: 0, pointsScored: 0, pointsConceded: 0, doublesWins: 0, doublesLosses: 0, lastMatchId: 'm1', updatedAt: ST() });
  await no(b.commit());
});
await t('match: recorded points must be the real score of that side', async () => {
  const db = ctx('u_owner'); const b = db.batch();
  b.set(db.doc('matches/m1'), matchDoc());
  b.update(db.doc('players/p_b'), { gamesPlayed: INC(1), losses: INC(1), pointsScored: INC(39), pointsConceded: INC(0), doublesLosses: INC(1), lastMatchId: 'm1', updatedAt: ST() });
  await no(b.commit());
});
await t('match: absurd score rejected', async () => {
  await no(ctx('u_owner').doc('matches/m1').set(matchDoc({ scoreTeamA: 500, setScoresText: '500-15' })));
});
await t('match: a recorded match cannot change players or score', async () => {
  await recordMatchInc(ctx('u_owner'), 'm1', matchDoc(), [['p_owner', true], ['p_a', true], ['p_b', false]]);
  await no(ctx('u_owner').doc('matches/m1').update({ scoreTeamA: 30, scoreTeamB: 28, setScoresText: '30-28', updatedAt: ST() }));
  await ok(ctx('u_owner').doc('matches/m1').update({ setScoresText: '21-15 (fixed)', updatedAt: ST() }));
});
await t('delete: owner deleting an already-deleted RSVP or wallet is a no-op', async () => {
  await ok(ctx('u_owner').doc('rsvps/rsvp_s1_p_gone').delete());
  await ok(ctx('u_owner').doc('clubWallets/wallet_c1_p_gone').delete());
});
await t('rsvp: a signed-out visitor cannot probe RSVP ids', async () => {
  await no(env.unauthenticatedContext().firestore().doc('rsvps/rsvp_s1_p_nobody').get());
});
await t('rsvp: free cancel must drop guests', async () => {
  await seedRsvp('p_a', { guestCount: 2 });
  await no(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, updatedAt: ST() }));
  await ok(ctx('u_a').doc('rsvps/rsvp_s1_p_a').update({ status: 'out', penaltyPercentApplied: 0, guestCount: 0, updatedAt: ST() }));
});

await t('match: a full four-player doubles match records and deletes within the rules budget', async () => {
  await env.withSecurityRulesDisabled(async (c) => c.firestore().doc('players/p_c').set(player({ authUid: 'u_c', ownerId: 'u_c' })));
  const four = matchDoc({ teamBPlayer2Id: 'p_c', teamBPlayer2Name: 'C' });
  const sides = [['p_owner', true], ['p_a', true], ['p_b', false], ['p_c', false]];
  await ok(recordMatchInc(ctx('u_owner'), 'm4', four, sides));
  const db = ctx('u_owner'); const b = db.batch();
  b.delete(db.doc('matches/m4'));
  for (const [pid, w] of sides) {
    b.update(db.doc('players/' + pid), { gamesPlayed: INC(-1), wins: INC(w ? -1 : 0), losses: INC(w ? 0 : -1), pointsScored: INC(w ? -21 : -15), pointsConceded: INC(w ? -15 : -21), doublesWins: INC(w ? -1 : 0), doublesLosses: INC(w ? 0 : -1), ratingScore: 1200, lastMatchId: 'm4', updatedAt: ST() });
  }
  await ok(b.commit());
});

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
