import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PENDING_REFERRAL_STORAGE_KEY,
  PENDING_REFERRAL_TTL_MS,
  buildReferralUrl,
  clearPendingReferral,
  generateReferralCode,
  isValidReferralCode,
  loadPendingReferral,
  parseReferralFromParams,
  savePendingReferral,
} from './referral.ts';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

test('generated codes satisfy the same pattern the rules enforce', () => {
  for (let i = 0; i < 50; i++) assert.ok(isValidReferralCode(generateReferralCode()));
});

test('generated codes use the supplied random source and differ between calls', () => {
  assert.equal(generateReferralCode((b) => void b.fill(0)), 'a'.repeat(16));
  assert.notEqual(generateReferralCode(), generateReferralCode());
});

test('code validation rejects short, long and non-alphanumeric values', () => {
  assert.equal(isValidReferralCode('abc'), false);
  assert.equal(isValidReferralCode('A'.repeat(16)), false);
  assert.equal(isValidReferralCode('a'.repeat(33)), false);
  assert.equal(isValidReferralCode('abcd efgh ijkl mnop'), false);
  assert.equal(isValidReferralCode(undefined), false);
});

test('referral URL keeps the invite params and adds ref', () => {
  const url = buildReferralUrl('https://app.test/?club=c1', 'abcdefghijkl1234');
  const params = new URL(url).searchParams;
  assert.equal(params.get('club'), 'c1');
  assert.equal(params.get('ref'), 'abcdefghijkl1234');
});

test('parse needs a well-formed club and code', () => {
  assert.deepEqual(
    parseReferralFromParams(new URLSearchParams('club=c1&ref=abcdefghijkl1234')),
    { clubId: 'c1', code: 'abcdefghijkl1234' }
  );
  assert.equal(parseReferralFromParams(new URLSearchParams('club=c1')), null);
  assert.equal(parseReferralFromParams(new URLSearchParams('ref=abcdefghijkl1234')), null);
  assert.equal(parseReferralFromParams(new URLSearchParams('club=c1&ref=short')), null);
  assert.equal(
    parseReferralFromParams(new URLSearchParams('club=../x&ref=abcdefghijkl1234')),
    null
  );
});

test('a pending referral survives a reload, then expires', () => {
  const store = memoryStorage();
  const ref = { clubId: 'c1', code: 'abcdefghijkl1234' };
  savePendingReferral(ref, 1_000, store);
  assert.deepEqual(loadPendingReferral(1_000 + 60_000, store), ref);
  assert.equal(loadPendingReferral(1_000 + PENDING_REFERRAL_TTL_MS + 1, store), null);
  assert.equal(store.data.has(PENDING_REFERRAL_STORAGE_KEY), false, 'expired entry is removed');
});

test('a tampered or malformed pending entry is dropped', () => {
  const store = memoryStorage();
  store.setItem(
    PENDING_REFERRAL_STORAGE_KEY,
    JSON.stringify({ clubId: 'c1', code: 'x', savedAt: 5 })
  );
  assert.equal(loadPendingReferral(5, store), null);
  store.setItem(PENDING_REFERRAL_STORAGE_KEY, '{not json');
  assert.equal(loadPendingReferral(5, store), null);
});

test('clear removes the pending referral', () => {
  const store = memoryStorage();
  savePendingReferral({ clubId: 'c1', code: 'abcdefghijkl1234' }, 1, store);
  clearPendingReferral(store);
  assert.equal(loadPendingReferral(2, store), null);
});
