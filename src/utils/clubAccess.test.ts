import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProfileMappingOp,
  chunkClubIds,
  classifyInviteLookup,
  clubIdsFromKey,
  clubIdsKey,
  createAttemptLedger,
  decideProfileMapping,
  isMissingIndex,
  isPermissionDenied,
  isServerConfirmed,
  mergeById,
  ownedClubIdsOf,
  parseClubIdCsv,
  parseJoinRequestData,
  sortJoinRequestsNewestFirst,
} from './clubAccess.ts';

test('parseClubIdCsv trims, drops blanks, dedupes and sorts', () => {
  assert.deepEqual(parseClubIdCsv(' club_b, club_a ,,club_b,'), ['club_a', 'club_b']);
  assert.deepEqual(parseClubIdCsv(''), []);
  assert.deepEqual(parseClubIdCsv(null), []);
  assert.deepEqual(parseClubIdCsv(undefined), []);
});

test('clubIdsKey is order independent and round-trips', () => {
  assert.equal(clubIdsKey(['b', 'a', 'a', ' ']), 'a,b');
  assert.deepEqual(clubIdsFromKey('a,b'), ['a', 'b']);
  assert.deepEqual(clubIdsFromKey(''), []);
});

test('chunkClubIds never produces an empty in-array and respects the 30 value limit', () => {
  assert.deepEqual(chunkClubIds([]), []);
  assert.deepEqual(chunkClubIds(['', '  ']), []);
  const ids = Array.from({ length: 65 }, (_, i) => `club_${i}`);
  const chunks = chunkClubIds(ids);
  assert.deepEqual(
    chunks.map((c) => c.length),
    [30, 30, 5]
  );
  assert.ok(chunks.every((c) => c.length > 0));
  assert.deepEqual(chunks.flat(), ids);
  // A caller cannot raise the limit beyond what Firestore accepts
  assert.equal(chunkClubIds(ids, 100)[0].length, 30);
  // Duplicates collapse before chunking
  assert.deepEqual(chunkClubIds(['a', 'a', 'b']), [['a', 'b']]);
});

test('mergeById lets later lists win and keeps first-seen order', () => {
  const directory = [
    { id: 'a', name: 'dir-a' },
    { id: 'b', name: 'dir-b' },
  ];
  const docs = [
    { id: 'b', name: 'doc-b' },
    { id: 'c', name: 'doc-c' },
  ];
  assert.deepEqual(mergeById(directory, docs), [
    { id: 'a', name: 'dir-a' },
    { id: 'b', name: 'doc-b' },
    { id: 'c', name: 'doc-c' },
  ]);
  assert.deepEqual(mergeById([], []), []);
});

test('error classifiers read the Firestore code', () => {
  assert.equal(isPermissionDenied({ code: 'permission-denied' }), true);
  assert.equal(isPermissionDenied({ code: 'firestore/permission-denied' }), true);
  assert.equal(isPermissionDenied({ code: 'unavailable' }), false);
  assert.equal(isPermissionDenied(new Error('x')), false);
  assert.equal(isMissingIndex({ code: 'failed-precondition' }), true);
  assert.equal(isMissingIndex({ code: 'permission-denied' }), false);
});

test('isServerConfirmed is true only for an acknowledged, non-cache snapshot', () => {
  // Sign-up sequence: optimistic local copy, then (maybe) cache, then the acknowledged doc
  assert.equal(isServerConfirmed({ hasPendingWrites: true, fromCache: false }), false);
  assert.equal(isServerConfirmed({ hasPendingWrites: true, fromCache: true }), false);
  assert.equal(isServerConfirmed({ hasPendingWrites: false, fromCache: true }), false);
  assert.equal(isServerConfirmed({ hasPendingWrites: false, fromCache: false }), true);
});

test('decideProfileMapping covers every state', () => {
  const own = { id: 'player_u1', authUid: 'u1' };
  assert.equal(decideProfileMapping({ uid: 'u1', ownPlayer: null, profile: null }), 'none');
  // A player that does not point back at the account is not ours to map
  assert.equal(
    decideProfileMapping({ uid: 'u1', ownPlayer: { id: 'p', authUid: 'other' }, profile: null }),
    'none'
  );
  assert.equal(
    decideProfileMapping({ uid: 'u1', ownPlayer: { id: 'p', authUid: '' }, profile: null }),
    'none'
  );
  assert.equal(decideProfileMapping({ uid: 'u1', ownPlayer: own, profile: null }), 'create');
  assert.equal(
    decideProfileMapping({ uid: 'u1', ownPlayer: own, profile: { playerId: 'player_u1' } }),
    'ready'
  );
  assert.equal(
    decideProfileMapping({ uid: 'u1', ownPlayer: own, profile: { playerId: 'player_old' } }),
    'replace'
  );
  assert.equal(decideProfileMapping({ uid: '', ownPlayer: own, profile: null }), 'none');
});

test('buildProfileMappingOp creates with set and relinks with update', () => {
  assert.deepEqual(
    buildProfileMappingOp({
      accountUid: 'claimant',
      playerId: 'player_9',
      writerUid: 'admin1',
      exists: false,
    }),
    {
      type: 'set',
      collectionName: 'profiles',
      docId: 'claimant',
      data: { playerId: 'player_9', ownerId: 'admin1' },
    }
  );
  assert.deepEqual(
    buildProfileMappingOp({
      accountUid: 'claimant',
      playerId: 'player_9',
      writerUid: 'admin1',
      exists: true,
    }),
    {
      type: 'update',
      collectionName: 'profiles',
      docId: 'claimant',
      updates: { playerId: 'player_9', ownerId: 'admin1' },
    }
  );
});

test('createAttemptLedger allows one attempt per key', () => {
  const ledger = createAttemptLedger();
  assert.equal(ledger.has('u1|p|0|0'), false);
  assert.equal(ledger.claim('u1|p|0|0'), true);
  assert.equal(ledger.claim('u1|p|0|0'), false);
  assert.equal(ledger.has('u1|p|0|0'), true);
  // A later heal round or retry is a new key
  assert.equal(ledger.claim('u1|p|0|1'), true);
  assert.equal(ledger.claim('u1|p|1|0'), true);
});

test('classifyInviteLookup never reveals a private club', () => {
  assert.equal(classifyInviteLookup({ exists: true }), 'found');
  assert.equal(classifyInviteLookup({ exists: false }), 'missing');
  assert.equal(classifyInviteLookup({ errorCode: 'permission-denied' }), 'private');
  assert.equal(classifyInviteLookup({ errorCode: 'unavailable' }), 'error');
  assert.equal(classifyInviteLookup({}), 'missing');
});

test('parseJoinRequestData reads server timestamps and falls back to now', () => {
  const fixed = new Date('2026-10-22T10:00:00.000Z');
  const withTs = parseJoinRequestData(
    'joinreq_c_p',
    {
      clubId: 'c',
      playerId: 'p',
      playerName: 'Pat',
      playerTag: 'pat#1',
      createdAt: { toDate: () => new Date('2026-10-01T00:00:00.000Z') },
    },
    () => fixed
  );
  assert.equal(withTs.requestedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(withTs.playerName, 'Pat');
  const pending = parseJoinRequestData('x', { clubId: 'c', playerId: 'p', createdAt: null }, () => fixed);
  assert.equal(pending.requestedAt, fixed.toISOString());
  assert.equal(pending.playerName, 'Player');
});

test('sortJoinRequestsNewestFirst does not mutate its input', () => {
  const rows = [
    { id: '1', clubId: 'c', playerId: 'p', playerName: 'a', playerTag: 't', requestedAt: '2026-01-01T00:00:00.000Z' },
    { id: '2', clubId: 'c', playerId: 'q', playerName: 'b', playerTag: 't', requestedAt: '2026-02-01T00:00:00.000Z' },
  ];
  assert.deepEqual(sortJoinRequestsNewestFirst(rows).map((r) => r.id), ['2', '1']);
  assert.deepEqual(rows.map((r) => r.id), ['1', '2']);
});

test('ownedClubIdsOf finds the clubs a player owns', () => {
  const clubs = [
    { id: 'c1', ownerPlayerId: 'p1' },
    { id: 'c2', clubOwnerPlayerId: 'p1' },
    { id: 'c3', ownerPlayerId: 'p2' },
  ];
  assert.deepEqual(ownedClubIdsOf('p1', clubs), ['c1', 'c2']);
  assert.deepEqual(ownedClubIdsOf('nobody', clubs), []);
  assert.deepEqual(ownedClubIdsOf(null, clubs), []);
});
