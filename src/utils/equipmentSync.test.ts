import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldMarkStoreDirty } from './equipmentSync.ts';

test('the cached store loaded at mount is not an unsaved edit before the cloud answers', () => {
  assert.equal(shouldMarkStoreDirty('{"empty":1}', null, '{"empty":1}'), false);
});

test('an edit made before the cloud answers is dirty', () => {
  assert.equal(shouldMarkStoreDirty('{"edited":1}', null, '{"empty":1}'), true);
});

test('after the cloud answered, any difference from the synced state is dirty', () => {
  assert.equal(shouldMarkStoreDirty('{"b":1}', '{"a":1}', '{"b":1}'), true);
  assert.equal(shouldMarkStoreDirty('{"a":1}', '{"a":1}', '{"b":1}'), false);
});

test('a store too large to serialize is never marked dirty', () => {
  assert.equal(shouldMarkStoreDirty(null, null, null), false);
});
