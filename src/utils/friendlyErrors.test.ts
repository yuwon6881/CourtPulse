import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backoffDelayMs,
  chunkArray,
  friendlyAuthMessage,
  friendlyFirestoreMessage,
  getErrorCode,
} from './friendlyErrors.ts';

test('friendlyFirestoreMessage maps known codes to short sentences', () => {
  assert.equal(
    friendlyFirestoreMessage({ code: 'permission-denied' }),
    "You don't have permission to do that. Refresh and try again."
  );
  assert.equal(
    friendlyFirestoreMessage({ code: 'firestore/unavailable' }),
    "You appear to be offline. Try again when you're connected."
  );
  for (const code of ['already-exists', 'not-found', 'failed-precondition', 'resource-exhausted']) {
    const msg = friendlyFirestoreMessage({ code });
    assert.ok(msg.length > 10 && msg.length < 140, code);
    assert.ok(!msg.includes('{'), code);
  }
});

test('friendlyFirestoreMessage falls back to a generic sentence and never leaks raw text', () => {
  const msg = friendlyFirestoreMessage(new Error('uid abc123 user@example.com secret path'));
  assert.equal(msg, 'Something went wrong. Please try again.');
  assert.ok(!msg.includes('@'));
});

test('friendlyAuthMessage covers the launch-blocking sign-in codes', () => {
  for (const code of [
    'auth/unauthorized-domain',
    'auth/popup-blocked',
    'auth/account-exists-with-different-credential',
    'auth/network-request-failed',
  ]) {
    assert.ok(friendlyAuthMessage({ code }).length > 10, code);
  }
  assert.equal(friendlyAuthMessage({ code: 'auth/popup-closed-by-user' }), '');
  assert.equal(friendlyAuthMessage({ code: 'auth/wrong-password' }), 'Incorrect email or password.');
});

test('getErrorCode tolerates non-objects', () => {
  assert.equal(getErrorCode(null), '');
  assert.equal(getErrorCode('x'), '');
  assert.equal(getErrorCode({ code: 'firestore/not-found' }), 'not-found');
});

test('chunkArray splits into bounded chunks and never yields an empty chunk', () => {
  assert.deepEqual(chunkArray([], 30), []);
  assert.deepEqual(chunkArray([1, 2, 3], 2), [[1, 2], [3]]);
  const big = Array.from({ length: 65 }, (_, i) => i);
  const chunks = chunkArray(big, 30);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c) => c.length > 0 && c.length <= 30));
  assert.equal(chunks.flat().length, 65);
});

test('backoffDelayMs doubles from 2s and caps at 60s', () => {
  assert.equal(backoffDelayMs(1), 2000);
  assert.equal(backoffDelayMs(2), 4000);
  assert.equal(backoffDelayMs(3), 8000);
  assert.equal(backoffDelayMs(5), 32000);
  assert.equal(backoffDelayMs(6), 60000);
  assert.equal(backoffDelayMs(20), 60000);
  assert.equal(backoffDelayMs(0), 2000);
});
