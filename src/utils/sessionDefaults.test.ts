import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateShuttlesFromHistory } from './sessionDefaults.ts';
import type { Session } from '../types';

const make = (over: Partial<Session>): Session =>
  ({
    id: 's',
    clubId: 'c1',
    sessionDate: '2026-01-01',
    startTime: '20:00',
    feeSplitFinalized: true,
    shuttlesUsed: 0,
    ...over,
  }) as Session;

test('a club with no finalized history estimates 0 shuttles', () => {
  assert.equal(estimateShuttlesFromHistory([], 'c1'), 0);
  assert.equal(
    estimateShuttlesFromHistory([make({ id: 'a', feeSplitFinalized: false, shuttlesUsed: 8 })], 'c1'),
    0
  );
});

test('averages the latest three finalized sessions of the same club', () => {
  const history = [
    make({ id: 'a', sessionDate: '2026-01-01', shuttlesUsed: 100 }),
    make({ id: 'b', sessionDate: '2026-02-01', shuttlesUsed: 4 }),
    make({ id: 'c', sessionDate: '2026-03-01', shuttlesUsed: 6 }),
    make({ id: 'd', sessionDate: '2026-04-01', shuttlesUsed: 5 }),
    make({ id: 'x', clubId: 'other', sessionDate: '2026-05-01', shuttlesUsed: 50 }),
  ];
  assert.equal(estimateShuttlesFromHistory(history, 'c1'), 5);
});

test('ignores the session being estimated and zero-shuttle sessions', () => {
  const history = [
    make({ id: 'a', sessionDate: '2026-01-01', shuttlesUsed: 7 }),
    make({ id: 'self', sessionDate: '2026-02-01', shuttlesUsed: 20 }),
    make({ id: 'z', sessionDate: '2026-03-01', shuttlesUsed: 0 }),
  ];
  assert.equal(estimateShuttlesFromHistory(history, 'c1', 'self'), 7);
});
