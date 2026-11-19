import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_NAV_RESTORE_AGE_MS,
  clearPersistedNavigationState,
  getMobileNavIndicatorIndex,
  loadPersistedNavigationState,
  makeNavStateStorageKey,
  savePersistedNavigationState,
} from './navigationPersistence';

function makeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

test('getMobileNavIndicatorIndex maps tabs accurately for 3-tab and 4-tab layouts', () => {
  assert.equal(getMobileNavIndicatorIndex('sessions', false), 0);
  assert.equal(getMobileNavIndicatorIndex('rsvp', false), 0);
  assert.equal(getMobileNavIndicatorIndex('leaderboard', false), 1);
  assert.equal(getMobileNavIndicatorIndex('clubs', false), 2);
  assert.equal(getMobileNavIndicatorIndex('users', false), -1);
  assert.equal(getMobileNavIndicatorIndex('users', true), 3);
  assert.equal(getMobileNavIndicatorIndex('profile', true), -1);
  assert.equal(getMobileNavIndicatorIndex('gear', true), -1);
  assert.equal(getMobileNavIndicatorIndex('settings', true), -1);
});

test('save and load persisted navigation & log-match draft across reloads', () => {
  const storage = makeStorage();
  const now = 1_700_000_000_000;

  savePersistedNavigationState(
    'uid_owner_1',
    {
      activeTab: 'rsvp',
      activeClubId: 'club_1',
      selectedSessionId: 'sess_42',
      sessionSubTab: 'matches',
      showLogMatchDrawer: true,
      matchDraft: {
        sessionId: 'sess_42',
        matchFormat: 'singles',
        teamA1Id: 'p1',
        teamA2Id: '',
        teamB1Id: 'p2',
        teamB2Id: '',
        matchTargetPoints: 15,
        finalScoreA: '15',
        finalScoreB: '11',
      },
    },
    now,
    storage
  );

  // Restoring 20 minutes later (after turning phone back on) succeeds
  const restored = loadPersistedNavigationState(
    'uid_owner_1',
    now + 20 * 60 * 1000,
    storage
  );
  assert.ok(restored);
  assert.equal(restored.activeTab, 'rsvp');
  assert.equal(restored.activeClubId, 'club_1');
  assert.equal(restored.selectedSessionId, 'sess_42');
  assert.equal(restored.sessionSubTab, 'matches');
  assert.equal(restored.showLogMatchDrawer, true);
  assert.deepEqual(restored.matchDraft, {
    sessionId: 'sess_42',
    matchFormat: 'singles',
    teamA1Id: 'p1',
    teamA2Id: '',
    teamB1Id: 'p2',
    teamB2Id: '',
    matchTargetPoints: 15,
    finalScoreA: '15',
    finalScoreB: '11',
  });

  // Different account cannot read another account's saved state
  assert.equal(loadPersistedNavigationState('uid_other', now, storage), null);
});

test('expired navigation state is discarded cleanly', () => {
  const storage = makeStorage();
  const now = 1_700_000_000_000;

  savePersistedNavigationState(
    'uid_1',
    {
      activeTab: 'rsvp',
      activeClubId: 'club_1',
      selectedSessionId: 'sess_1',
      sessionSubTab: 'matches',
      showLogMatchDrawer: true,
    },
    now,
    storage
  );

  const expired = loadPersistedNavigationState(
    'uid_1',
    now + MAX_NAV_RESTORE_AGE_MS + 1,
    storage
  );
  assert.equal(expired, null);
  assert.equal(storage.getItem(makeNavStateStorageKey('uid_1')), null);
});

test('corrupt JSON or invalid fields fall back safely without throwing', () => {
  const storage = makeStorage({
    [makeNavStateStorageKey('uid_bad')]: '{not-valid-json',
  });
  assert.equal(loadPersistedNavigationState('uid_bad', Date.now(), storage), null);

  clearPersistedNavigationState('uid_bad', storage);
  assert.equal(storage.getItem(makeNavStateStorageKey('uid_bad')), null);
});
