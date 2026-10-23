import test from 'node:test';
import assert from 'node:assert/strict';
import { FINALIZE_CLOCK_SKEW_MS, evaluateFinalizeReadiness } from './badmintonLogic.ts';
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

test('a booked session can be finalized once it has started, after the clock-skew margin', () => {
  const ready = START + FINALIZE_CLOCK_SKEW_MS;
  assert.equal(evaluateFinalizeReadiness(session(), ready).canFinalize, true);
  assert.equal(evaluateFinalizeReadiness(session({ bookingStatus: 'in_play' }), ready + 1).canFinalize, true);
});

test('the first minutes after the start are refused, with a message that says why', () => {
  const justStarted = evaluateFinalizeReadiness(session(), START + 1);
  assert.equal(justStarted.canFinalize, false);
  assert.match(justStarted.reason ?? '', /just started/i);
  assert.equal(evaluateFinalizeReadiness(session(), START + FINALIZE_CLOCK_SKEW_MS - 1).canFinalize, false);
});

test('a device clock up to the margin ahead of the server never beats the server rule', () => {
  // The rule allows request.time >= startsAt. If the client is `drift` ms ahead of the server and
  // the client says yes, the server time is now - drift, which must already be >= start.
  for (const drift of [0, 1_000, 30_000, FINALIZE_CLOCK_SKEW_MS]) {
    for (let t = START - 10_000; t <= START + 3 * FINALIZE_CLOCK_SKEW_MS; t += 5_000) {
      if (evaluateFinalizeReadiness(session(), t).canFinalize) {
        assert.ok(t - drift >= START, `client ${t} allowed but server would see ${t - drift} < ${START}`);
      }
    }
  }
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
  assert.equal(evaluateFinalizeReadiness(session(), ny + FINALIZE_CLOCK_SKEW_MS, 'America/New_York').canFinalize, true);
});
