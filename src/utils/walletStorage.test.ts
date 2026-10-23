import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER_WALLETS_STORAGE_KEY,
  loadPlayerWalletsMap,
  savePlayerWalletsMap,
} from './badmintonLogic.ts';

function withStorage(initial: Record<string, string>, run: (store: Map<string, string>) => void) {
  const store = new Map(Object.entries(initial));
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  try {
    run(store);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  }
}

test('local wallets round-trip through storage', () => {
  withStorage({}, () => {
    const wallets = { 'c1::p1': { creditBalance: 12.5, freeSessionPasses: 2, waiveAllFees: true } };
    assert.deepEqual(savePlayerWalletsMap(wallets), wallets);
    assert.deepEqual(loadPlayerWalletsMap(), wallets);
  });
});

test('damaged or hostile stored wallets are cleaned or ignored', () => {
  withStorage({ [PLAYER_WALLETS_STORAGE_KEY]: '{bad json' }, () => {
    assert.deepEqual(loadPlayerWalletsMap(), {});
  });
  withStorage({ [PLAYER_WALLETS_STORAGE_KEY]: '[1,2]' }, () => {
    assert.deepEqual(loadPlayerWalletsMap(), {});
  });
  withStorage(
    {
      [PLAYER_WALLETS_STORAGE_KEY]: JSON.stringify({
        a: { creditBalance: -5, freeSessionPasses: 2.9, waiveAllFees: 1 },
        b: null,
      }),
    },
    () => {
      assert.deepEqual(loadPlayerWalletsMap(), {
        a: { creditBalance: 0, freeSessionPasses: 2, waiveAllFees: true },
      });
    }
  );
});

test('without storage nothing throws', () => {
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { localStorage?: unknown }).localStorage;
  try {
    assert.deepEqual(loadPlayerWalletsMap(), {});
    assert.deepEqual(savePlayerWalletsMap({}), {});
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  }
});
