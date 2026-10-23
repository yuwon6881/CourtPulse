import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaymentTiming } from './paymentTiming.ts';

test('only an explicit "before" collects before the match', () => {
  assert.equal(normalizePaymentTiming('before'), 'before');
  assert.equal(normalizePaymentTiming('after'), 'after');
  assert.equal(normalizePaymentTiming(undefined), 'after');
  assert.equal(normalizePaymentTiming('anything else'), 'after');
});
