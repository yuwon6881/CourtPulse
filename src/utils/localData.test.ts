import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEV_SESSION_STORAGE_KEY,
  clearAllCourtPulseLocalData,
  purgeDevLeftoversOutsideDev,
  selectCourtPulseKeys,
} from './localData.ts';
import {
  CLUB_BILLING_RULES_STORAGE_KEY,
  CLUB_PAYMENT_DETAILS_STORAGE_KEY,
  LOCAL_STATE_STORAGE_KEY,
  PLAYER_WALLETS_STORAGE_KEY,
  RSVP_GUESTS_STORAGE_KEY,
} from './badmintonLogic.ts';

function makeStorage(initial: Record<string, string>): Storage {
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

test('selectCourtPulseKeys matches data keys and every gear locker, nothing else', () => {
  const picked = selectCourtPulseKeys([
    LOCAL_STATE_STORAGE_KEY,
    DEV_SESSION_STORAGE_KEY,
    CLUB_PAYMENT_DETAILS_STORAGE_KEY,
    'court_gear_locker_v3_abc123',
    'court_gear_locker_v3_local',
    'unrelated_key',
    'court_gear_locker_v2_old',
  ]);
  assert.deepEqual(picked.sort(), [
    CLUB_PAYMENT_DETAILS_STORAGE_KEY,
    DEV_SESSION_STORAGE_KEY,
    LOCAL_STATE_STORAGE_KEY,
    'court_gear_locker_v3_abc123',
    'court_gear_locker_v3_local',
  ].sort());
});

test('clearAllCourtPulseLocalData removes club data and gear but keeps unrelated keys', () => {
  const storage = makeStorage({
    [LOCAL_STATE_STORAGE_KEY]: '{}',
    [CLUB_BILLING_RULES_STORAGE_KEY]: '{}',
    [RSVP_GUESTS_STORAGE_KEY]: '{}',
    [PLAYER_WALLETS_STORAGE_KEY]: '{}',
    court_gear_locker_v3_uidA: '{}',
    theme: 'dark',
  });
  clearAllCourtPulseLocalData(storage);
  assert.equal(storage.length, 1);
  assert.equal(storage.getItem('theme'), 'dark');
});

test('purgeDevLeftoversOutsideDev only acts when not in dev', () => {
  const storage = makeStorage({
    [LOCAL_STATE_STORAGE_KEY]: '{}',
    [DEV_SESSION_STORAGE_KEY]: '{}',
  });
  purgeDevLeftoversOutsideDev(true, storage);
  assert.equal(storage.length, 2);
  purgeDevLeftoversOutsideDev(false, storage);
  assert.equal(storage.length, 0);
});
