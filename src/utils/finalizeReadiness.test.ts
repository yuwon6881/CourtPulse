import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFinalizeReadiness } from './badmintonLogic.ts';
import type { Session } from '../types';

const session = (over: Partial<Session> = {}): Session =>
  ({
    id: 's1',
    clubId: 'c1',
    sessionDate: '2026-10-24',
    startTime: '18:00',
    bookingStatus: 'booked',
    feeSplitFinalized: false,
    ...over,
  }) as Session;

// 2026-10-24 18:00 in Asia/Singapore (UTC+8) = 10:00 UTC
const START = Date.UTC(2026, 9, 24, 10, 0, 0);

test('an unbooked (proposed) session cannot be finalized, even after its start time', () => {
  const r = evaluateFinalizeReadiness(session({ bookingStatus: 'pending' }), START + 3600_000);
  assert.equal(r.canFinalize, false);
  assert.match(r.reason ?? '', /not booked/i);
});

test('a booked session cannot be finalized before it starts', () => {
  const r = evaluateFinalizeReadiness(session(), START - 60_000);
  assert.equal(r.canFinalize, false);
  assert.match(r.reason ?? '', /not started/i);
});

test('a booked session can be finalized once it has started', () => {
  assert.equal(evaluateFinalizeReadiness(session(), START).canFinalize, true);
  assert.equal(evaluateFinalizeReadiness(session({ bookingStatus: 'in_play' }), START + 1).canFinalize, true);
});

test('recalculating an already finalized split is always allowed', () => {
  const r = evaluateFinalizeReadiness(
    session({ feeSplitFinalized: true, bookingStatus: 'completed' }),
    START - 86_400_000
  );
  assert.equal(r.canFinalize, true);
});

test('an unreadable start time does not block a booked session', () => {
  assert.equal(
    evaluateFinalizeReadiness(session({ startTime: 'soon' }), START - 86_400_000).canFinalize,
    true
  );
});

test('the club timezone decides the start, not the device', () => {
  // 18:00 in New York (UTC-4 in late October) is 22:00 UTC
  const ny = Date.UTC(2026, 9, 24, 22, 0, 0);
  assert.equal(evaluateFinalizeReadiness(session(), ny - 60_000, 'America/New_York').canFinalize, false);
  assert.equal(evaluateFinalizeReadiness(session(), ny, 'America/New_York').canFinalize, true);
});
