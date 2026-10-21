import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateJoinWindow,
  evaluateTapOutWindow,
  computeSessionInstants,
  getEnforcedSessionStartMs,
  getSessionEndTimestampMs,
  sessionInstantsDiffer,
  type SessionInstants,
  getSessionStartTimestampMs,
  isSessionCompletedOrPast,
  parseSessionTimeMinutes,
  parseSessionTimeTotalMinutes,
  WAITING_FOR_START_TIME_MESSAGE,
} from './badmintonLogic.ts';
import { toEpochMs as toMs, zonedWallTimeToUtcMs } from './clubTime.ts';
import type { Club, Session } from '../types.ts';

const hm = (h: number, m: number) => ({ hours: h, minutes: m });

test('parseSessionTimeMinutes reads the common human forms', () => {
  assert.deepEqual(parseSessionTimeMinutes('19:30'), hm(19, 30));
  assert.deepEqual(parseSessionTimeMinutes('19:30:00'), hm(19, 30));
  assert.deepEqual(parseSessionTimeMinutes('7.30pm'), hm(19, 30));
  assert.deepEqual(parseSessionTimeMinutes('7:30 PM'), hm(19, 30));
  assert.deepEqual(parseSessionTimeMinutes('7pm'), hm(19, 0));
  assert.deepEqual(parseSessionTimeMinutes('19h30'), hm(19, 30));
  assert.deepEqual(parseSessionTimeMinutes('1930'), hm(19, 30));
  assert.deepEqual(parseSessionTimeMinutes('12am'), hm(0, 0));
  assert.deepEqual(parseSessionTimeMinutes('12:15 pm'), hm(12, 15));
  assert.deepEqual(parseSessionTimeMinutes(' 08:05 '), hm(8, 5));
  // 24:00 is the end of the day
  assert.equal(parseSessionTimeTotalMinutes('24:00'), 1440);
  assert.deepEqual(parseSessionTimeMinutes('24:00'), hm(0, 0));
});

test('parseSessionTimeMinutes returns null for garbage instead of defaulting to 20:00', () => {
  for (const bad of ['', '   ', 'TBD', 'tonight', '25:00', '24:30', '13pm', '0pm', '7:75', '19:30:99', undefined]) {
    assert.equal(parseSessionTimeMinutes(bad as string | undefined), null, String(bad));
  }
});

const baseSession: Session = {
  id: 'sess_1',
  clubId: 'club_1',
  title: 'Night Smash',
  venue: 'Hall',
  courtNumbers: 'Court 1',
  sessionDate: '2026-10-20',
  startTime: '20:00',
  endTime: '22:00',
  bookingStatus: 'booked',
  courtFee: 60,
  shuttlesUsed: 0,
  shuttleUnitCost: 3,
  shuttleFee: 0,
  maxPlayers: 8,
  organizerName: 'Host',
  paymentInfo: 'PayNow',
  feeSplitFinalized: false,
  ownerId: 'owner_1',
};
const club: Club = {
  id: 'club_1',
  name: 'Club',
  description: 'd',
  paymentInfo: 'PayNow',
  freeCancelHours: 24,
  lockCancelHours: 4,
  lateCancelFeePercent: 50,
  noShowFeePercent: 100,
  ownerId: 'owner_1',
};
// Wall-clock time on the session day in the DEFAULT club zone (Asia/Singapore), as a UTC instant.
const at = (h: number, m = 0, dayOffset = 0) =>
  zonedWallTimeToUtcMs('2026-10-20', (24 * dayOffset + h) * 60 + m, 'Asia/Singapore') as number;
const HOUR = 3600_000;
// The instant the rules measure from; sessions written by managers carry it.
// (startsAt, lateCancelUntil, freeCancelUntil) exactly as a manager's client writes them.
const withStartsAt = (s: Session, tz = 'Asia/Singapore', c: Club = club): Session => {
  const i = computeSessionInstants(s, { ...c, timezone: tz }) as SessionInstants;
  return {
    ...s,
    startsAt: new Date(i.startsAtMs),
    lateCancelUntil: new Date(i.lateCancelUntilMs),
    freeCancelUntil: i.freeCancelUntilMs === null ? null : new Date(i.freeCancelUntilMs),
  };
};

test('start/end timestamps: unreadable start is null, missing end is start + 2h with rollover', () => {
  assert.equal(getSessionStartTimestampMs(baseSession), at(20, 0));
  assert.equal(getSessionStartTimestampMs({ ...baseSession, startTime: 'TBD' }), null);
  assert.equal(getSessionStartTimestampMs({ ...baseSession, startTime: '' }), null);
  assert.equal(getSessionStartTimestampMs({ ...baseSession, sessionDate: '2026-02-31' }), null);
  assert.equal(getSessionEndTimestampMs({ ...baseSession, startTime: 'TBD' }), null);

  assert.equal(getSessionEndTimestampMs(baseSession), at(22, 0));
  // Missing / invalid end: start + 2h, never clamped to 23:xx
  assert.equal(getSessionEndTimestampMs({ ...baseSession, endTime: '' }), at(22, 0));
  assert.equal(getSessionEndTimestampMs({ ...baseSession, endTime: 'later' }), at(22, 0));
  assert.equal(getSessionEndTimestampMs({ ...baseSession, startTime: '23:00', endTime: '' }), at(1, 0, 1));
  assert.equal(getSessionEndTimestampMs({ ...baseSession, startTime: '23:30', endTime: '' }), at(1, 30, 1));
  // End at or before start rolls to the next day
  assert.equal(getSessionEndTimestampMs({ ...baseSession, startTime: '23:00', endTime: '01:00' }), at(1, 0, 1));
  assert.equal(getSessionEndTimestampMs({ ...baseSession, startTime: '20:00', endTime: '20:00' }), at(20, 0, 1));
  assert.equal(getSessionEndTimestampMs({ ...baseSession, startTime: '20:00', endTime: '24:00' }), at(0, 0, 1));
});

test('a session that ends after midnight is still in play just after midnight', () => {
  const late = { ...baseSession, startTime: '23:30', endTime: '' };
  assert.equal(isSessionCompletedOrPast(late, at(0, 30, 1)), false);
  assert.equal(isSessionCompletedOrPast(late, at(1, 30, 1)), true);
});

test('join window: closed once started, when past/completed, and when the start time is unreadable', () => {
  const start = at(20, 0);
  const s = withStartsAt(baseSession);
  assert.equal(evaluateJoinWindow(s, start - 3600_000).canJoin, true);
  // in play (started 1 minute ago)
  const inPlay = evaluateJoinWindow({ ...s, bookingStatus: 'in_play' }, start + 60_000);
  assert.equal(inPlay.canJoin, false);
  // still marked booked but the clock has passed the start: closed
  const started = evaluateJoinWindow(s, start + 60_000);
  assert.equal(started.canJoin, false);
  assert.match(started.reason || '', /started/);
  // past (end time over) and completed
  assert.equal(evaluateJoinWindow(s, at(23, 0)).canJoin, false);
  assert.equal(evaluateJoinWindow({ ...s, bookingStatus: 'completed' }, start - 3600_000).canJoin, false);
  assert.equal(evaluateJoinWindow({ ...s, feeSplitFinalized: true }, start - 3600_000).canJoin, false);
  // unreadable start: cannot prove it has not started
  assert.equal(evaluateJoinWindow({ ...baseSession, startTime: 'TBD' }, start - 3600_000).canJoin, false);
  assert.equal(evaluateJoinWindow({ ...baseSession, sessionDate: 'soon' }, start - 3600_000).canJoin, false);
});

test('join window boundary: allowed iff now < startsAt (exact with margin 0), stricter by the safety margin', () => {
  const start = at(20, 0);
  const s = withStartsAt(baseSession);
  const exact = { safetyMarginMs: 0 };
  assert.equal(evaluateJoinWindow(s, start - 1, 'Asia/Singapore', exact).canJoin, true);
  assert.equal(evaluateJoinWindow(s, start, 'Asia/Singapore', exact).canJoin, false);
  // default margin 30 s: the UI stops offering Join 30 s early
  assert.equal(evaluateJoinWindow(s, start - 31_000).canJoin, true);
  assert.equal(evaluateJoinWindow(s, start - 30_000).canJoin, false);
  assert.equal(evaluateJoinWindow(s, start - 1_000).canJoin, false);
});

test('without a stored startsAt players are locked out with the waiting message, never guessed', () => {
  const start = at(20, 0);
  const noStartsAt = baseSession; // parseable start, but no startsAt
  const join = evaluateJoinWindow(noStartsAt, start - 40 * HOUR);
  assert.equal(join.canJoin, false);
  assert.equal(join.reason, WAITING_FOR_START_TIME_MESSAGE);
  const tap = evaluateTapOutWindow(noStartsAt, club, start - 40 * HOUR);
  assert.equal(tap.canTapOut, false);
  assert.equal(tap.phase, 'unavailable');
  assert.equal(tap.policySummary, WAITING_FOR_START_TIME_MESSAGE);
  assert.equal(tap.canFreeCancel, false);
  // local demo state (no rules) may opt out and use the club-zone wall-clock parse
  assert.equal(
    evaluateJoinWindow(noStartsAt, start - 40 * HOUR, 'Asia/Singapore', { requireStartsAt: false }).canJoin,
    true
  );
  // an unreadable start stays locked even then
  assert.equal(
    evaluateTapOutWindow({ ...baseSession, startTime: 'TBD' }, club, start - 40 * HOUR, 'Asia/Singapore', {
      requireStartsAt: false,
    }).canTapOut,
    false
  );
});

test('tap-out window: unreadable start is locked, never a free cancellation', () => {
  const evalTbd = evaluateTapOutWindow({ ...baseSession, startTime: 'TBD' }, club, at(8, 0));
  assert.equal(evalTbd.canTapOut, false);
  const evalNoDate = evaluateTapOutWindow({ ...baseSession, sessionDate: '' }, club, at(8, 0));
  assert.equal(evalNoDate.canTapOut, false);
  // 7.30pm start parses, so the window works normally (30h before = free)
  const s730 = withStartsAt({ ...baseSession, startTime: '7.30pm' });
  const parsed = evaluateTapOutWindow(s730, club, at(19, 30) - 30 * HOUR);
  assert.equal(parsed.canTapOut, true);
  assert.equal(parsed.isPenaltyWindow, false);
  // freeCancelHours 0: always the late fee, never free
  const noFreeClub = { ...club, freeCancelHours: 0, lockCancelHours: 0 };
  const noFree = evaluateTapOutWindow(
    withStartsAt(baseSession, 'Asia/Singapore', noFreeClub),
    noFreeClub,
    at(8, 0)
  );
  assert.equal(noFree.canTapOut, true);
  assert.equal(noFree.isPenaltyWindow, true);
  assert.equal(noFree.canFreeCancel, false);
});

test('cancel boundaries (free 24h, lock 4h, margin 0): free <= freeDeadline, late <= lockDeadline, then locked', () => {
  const s = withStartsAt(baseSession);
  const start = at(20, 0);
  const freeDeadline = start - 24 * HOUR;
  const lockDeadline = start - 4 * HOUR;
  const ev = (now: number) => evaluateTapOutWindow(s, club, now, 'Asia/Singapore', { safetyMarginMs: 0 });

  assert.equal(ev(freeDeadline - 1).phase, 'free');
  assert.equal(ev(freeDeadline).phase, 'free'); // inclusive
  assert.equal(ev(freeDeadline).penaltyPercent, 0);
  assert.equal(ev(freeDeadline).canFreeCancel, true);
  assert.equal(ev(freeDeadline + 1).phase, 'late'); // just past
  assert.equal(ev(freeDeadline + 1).canFreeCancel, false);
  assert.equal(ev(freeDeadline + 1).penaltyPercent, 50);
  assert.equal(ev(lockDeadline).phase, 'late'); // inclusive
  assert.equal(ev(lockDeadline).canTapOut, true);
  assert.equal(ev(lockDeadline + 1).phase, 'locked');
  assert.equal(ev(lockDeadline + 1).canTapOut, false);
  assert.equal(ev(start - 1).phase, 'locked');
  assert.equal(ev(start).phase, 'started');
  assert.equal(ev(start).canTapOut, false);
  assert.equal(ev(start + HOUR).canTapOut, false);

  const e = ev(freeDeadline - 1);
  assert.equal(e.freeDeadlineMs, freeDeadline);
  assert.equal(e.lockDeadlineMs, lockDeadline);
  assert.equal(e.startMs, start);
  assert.equal(e.timeZone, 'Asia/Singapore');
});

test('the UI switches to the stricter option 30 s before each boundary', () => {
  const s = withStartsAt(baseSession);
  const start = at(20, 0);
  const freeDeadline = start - 24 * HOUR;
  const lockDeadline = start - 4 * HOUR;
  const ev = (now: number) => evaluateTapOutWindow(s, club, now); // default margin 30 s
  assert.equal(ev(freeDeadline - 31_000).phase, 'free');
  assert.equal(ev(freeDeadline - 30_000).phase, 'free'); // exactly the deadline once +30 s
  assert.equal(ev(freeDeadline - 29_000).phase, 'late');
  assert.equal(ev(lockDeadline - 30_000).phase, 'late');
  assert.equal(ev(lockDeadline - 29_000).phase, 'locked');
});

test('freeCancelHours 0 means a free cancel never exists; lockCancelHours 0 means cancel until the start', () => {
  const start = at(20, 0);
  const noFree = { ...club, freeCancelHours: 0, lockCancelHours: 4 };
  const ev0 = (c: Club, now: number) =>
    evaluateTapOutWindow(withStartsAt(baseSession, 'Asia/Singapore', c), c, now, 'Asia/Singapore', {
      safetyMarginMs: 0,
    });
  assert.equal(ev0(noFree, start - 1000 * HOUR).phase, 'late');
  assert.equal(ev0(noFree, start - 1000 * HOUR).canFreeCancel, false);
  assert.equal(ev0(noFree, start - 1000 * HOUR).freeDeadlineMs, null);
  assert.equal(ev0(noFree, start - 4 * HOUR).phase, 'late');
  assert.equal(ev0(noFree, start - 4 * HOUR + 1).phase, 'locked');
  assert.equal(ev0(noFree, start - 4 * HOUR - 1).phase, 'late');

  const lock0 = { ...club, freeCancelHours: 24, lockCancelHours: 0 };
  assert.equal(ev0(lock0, start - 1).phase, 'late'); // late cancel right up to the start
  assert.equal(ev0(lock0, start - 1).canTapOut, true);
  assert.equal(ev0(lock0, start).phase, 'started');
  assert.equal(ev0(lock0, start - 24 * HOUR).phase, 'free');
  // with the safety margin the last 30 s are already locked
  const s0 = withStartsAt(baseSession, 'Asia/Singapore', lock0);
  assert.equal(evaluateTapOutWindow(s0, lock0, start - 29_000).phase, 'locked');
  assert.equal(evaluateTapOutWindow(s0, lock0, start - 31_000).phase, 'late');
});

test('free window never outlives the lock deadline (free 2h but lock 4h)', () => {
  const start = at(20, 0);
  const odd = { ...club, freeCancelHours: 2, lockCancelHours: 4 };
  const s = withStartsAt(baseSession, 'Asia/Singapore', odd);
  const ev0 = (now: number) => evaluateTapOutWindow(s, odd, now, 'Asia/Singapore', { safetyMarginMs: 0 });
  assert.equal(ev0(start - 5 * HOUR).phase, 'free');
  assert.equal(ev0(start - 3 * HOUR).phase, 'locked');
  assert.match(ev0(start - 5 * HOUR).policySummary, /Free cancel until Tue 20 Oct, 4:00 PM SGT/);
});

test('deadline labels are in the club zone, whatever zone the club uses', () => {
  const sg = evaluateTapOutWindow(withStartsAt(baseSession), club, at(8, 0) - 100 * HOUR);
  assert.equal(sg.policySummary, 'Free cancel until Mon 19 Oct, 8:00 PM SGT');

  const nyClub: Club = { ...club, timezone: 'America/New_York' };
  const nySession = withStartsAt(baseSession, 'America/New_York');
  const start = zonedWallTimeToUtcMs('2026-10-20', 20 * 60, 'America/New_York') as number;
  assert.equal(toMs(nySession.startsAt), start);
  const ny = evaluateTapOutWindow(nySession, nyClub, start - 100 * HOUR);
  assert.equal(ny.timeZone, 'America/New_York');
  assert.equal(ny.policySummary, 'Free cancel until Mon 19 Oct, 8:00 PM EDT');
  assert.equal(ny.freeDeadlineMs, start - 24 * HOUR);
});

test('DST day: deadlines are elapsed hours before the instant, labelled in the club zone', () => {
  // New York spring-forward: Sun 2026-03-08. A session at 20:00 EDT that evening (00:00Z Mar 9).
  const nyClub: Club = { ...club, timezone: 'America/New_York', freeCancelHours: 24, lockCancelHours: 4 };
  const dstSession = withStartsAt(
    { ...baseSession, sessionDate: '2026-03-08', startTime: '20:00', endTime: '22:00' },
    'America/New_York'
  );
  const start = Date.UTC(2026, 2, 9, 0, 0);
  assert.equal(toMs(dstSession.startsAt), start);
  const ev0 = (now: number) =>
    evaluateTapOutWindow(dstSession, nyClub, now, 'America/New_York', { safetyMarginMs: 0 });
  // 24 elapsed hours before is 00:00Z Mar 8 = 19:00 EST on Sat Mar 7 (the wall clock is 23 h apart)
  assert.equal(ev0(start - 24 * HOUR).phase, 'free');
  assert.equal(ev0(start - 24 * HOUR + 1).phase, 'late');
  assert.match(ev0(start - 25 * HOUR).policySummary, /Free cancel until Sat 7 Mar, 7:00 PM EST/);
  // 4 elapsed hours before is 20:00Z = 16:00 EDT
  assert.equal(ev0(start - 4 * HOUR).phase, 'late');
  assert.equal(ev0(start - 4 * HOUR + 1).phase, 'locked');
  assert.match(ev0(start - 5 * HOUR).policySummary, /Late cancel \(50% fee\) until Sun 8 Mar, 4:00 PM EDT/);
});

test('start/end/windows do not depend on the viewer device zone', () => {
  // Fixed expectations: Singapore 20:00 on 2026-10-20 is 12:00Z, no matter where the code runs.
  assert.equal(getSessionStartTimestampMs(baseSession), Date.UTC(2026, 9, 20, 12, 0));
  assert.equal(getSessionStartTimestampMs(baseSession, 'Asia/Singapore'), Date.UTC(2026, 9, 20, 12, 0));
  assert.equal(getSessionStartTimestampMs(baseSession, 'America/New_York'), Date.UTC(2026, 9, 21, 0, 0));
  assert.equal(getSessionStartTimestampMs(baseSession, 'Europe/London'), Date.UTC(2026, 9, 20, 19, 0));
  assert.equal(getSessionEndTimestampMs(baseSession, 'Asia/Singapore'), Date.UTC(2026, 9, 20, 14, 0));
  // End past midnight in the club zone
  assert.equal(
    getSessionEndTimestampMs({ ...baseSession, startTime: '23:00', endTime: '01:00' }, 'Asia/Singapore'),
    Date.UTC(2026, 9, 20, 17, 0)
  );
  // The same session is "past" at different real instants in different club zones
  const endSg = Date.UTC(2026, 9, 20, 14, 0);
  assert.equal(isSessionCompletedOrPast(baseSession, endSg, 'Asia/Singapore'), true);
  assert.equal(isSessionCompletedOrPast(baseSession, endSg, 'Europe/London'), false);
  // Windows follow the stored startsAt exactly
  const ev = evaluateTapOutWindow(withStartsAt(baseSession), club, Date.UTC(2026, 9, 20, 12, 0) - 30 * HOUR);
  assert.equal(ev.phase, 'free');
});

test('computeSessionInstants: startsAt, lateCancelUntil = start - lock, freeCancelUntil = start - free', () => {
  const sg = computeSessionInstants(baseSession, { ...club, timezone: 'Asia/Singapore' }) as SessionInstants;
  assert.equal(sg.startsAtMs, Date.UTC(2026, 9, 20, 12, 0));
  assert.equal(sg.lateCancelUntilMs, Date.UTC(2026, 9, 20, 8, 0)); // lock 4h
  assert.equal(sg.freeCancelUntilMs, Date.UTC(2026, 9, 19, 12, 0)); // free 24h
  // missing timezone = default zone
  assert.deepEqual(computeSessionInstants(baseSession, club), sg);
  // another zone moves all three together
  const ny = computeSessionInstants(baseSession, { ...club, timezone: 'America/New_York' }) as SessionInstants;
  assert.equal(ny.startsAtMs, Date.UTC(2026, 9, 21, 0, 0));
  assert.equal(ny.lateCancelUntilMs, Date.UTC(2026, 9, 20, 20, 0));
  assert.equal(ny.freeCancelUntilMs, Date.UTC(2026, 9, 20, 0, 0));
});

test('computeSessionInstants: freeCancelHours 0 omits freeCancelUntil; lockCancelHours 0 means lateCancelUntil = startsAt', () => {
  const noFree = computeSessionInstants(baseSession, { ...club, freeCancelHours: 0 }) as SessionInstants;
  assert.equal(noFree.freeCancelUntilMs, null);
  assert.equal(noFree.lateCancelUntilMs, noFree.startsAtMs - 4 * HOUR);
  const lock0 = computeSessionInstants(baseSession, { ...club, lockCancelHours: 0 }) as SessionInstants;
  assert.equal(lock0.lateCancelUntilMs, lock0.startsAtMs);
  // fractional hours are honoured
  const half = computeSessionInstants(baseSession, { ...club, freeCancelHours: 1.5 }) as SessionInstants;
  assert.equal(half.freeCancelUntilMs, half.startsAtMs - 90 * 60_000);
  // unreadable start: nothing to write
  assert.equal(computeSessionInstants({ ...baseSession, startTime: 'TBD' }, club), null);
  assert.equal(computeSessionInstants({ ...baseSession, sessionDate: '2026-02-31' }, club), null);
});

test('computeSessionInstants on a DST day: deadlines are elapsed hours, not wall-clock hours', () => {
  const nyClub = { ...club, timezone: 'America/New_York', freeCancelHours: 24, lockCancelHours: 4 };
  // Sun 2026-03-08 20:00 EDT (spring forward that morning) = 00:00Z Mar 9
  const i = computeSessionInstants(
    { sessionDate: '2026-03-08', startTime: '20:00' },
    nyClub
  ) as SessionInstants;
  assert.equal(i.startsAtMs, Date.UTC(2026, 2, 9, 0, 0));
  assert.equal(i.freeCancelUntilMs, Date.UTC(2026, 2, 8, 0, 0)); // 19:00 EST Sat Mar 7 (23 wall hours earlier)
  assert.equal(i.lateCancelUntilMs, Date.UTC(2026, 2, 8, 20, 0)); // 16:00 EDT
  // Fall back: Sun 2026-11-01 20:00 EST = 01:00Z Nov 2
  const f = computeSessionInstants({ sessionDate: '2026-11-01', startTime: '20:00' }, nyClub) as SessionInstants;
  assert.equal(f.startsAtMs, Date.UTC(2026, 10, 2, 1, 0));
  assert.equal(f.freeCancelUntilMs, Date.UTC(2026, 10, 1, 1, 0)); // 21:00 EDT Sat Oct 31 (25 wall hours earlier)
  assert.equal(f.lateCancelUntilMs, Date.UTC(2026, 10, 1, 21, 0));
  // Gap start time (02:30 on the spring-forward day) lands at 03:30 EDT
  const g = computeSessionInstants({ sessionDate: '2026-03-08', startTime: '02:30' }, nyClub) as SessionInstants;
  assert.equal(g.startsAtMs, Date.UTC(2026, 2, 8, 7, 30));
});

test('sessionInstantsDiffer spots missing and stale values', () => {
  const i = computeSessionInstants(baseSession, club) as SessionInstants;
  const full = withStartsAt(baseSession);
  assert.equal(sessionInstantsDiffer(full, i), false);
  assert.equal(sessionInstantsDiffer(baseSession, i), true);
  assert.equal(sessionInstantsDiffer({ ...full, lateCancelUntil: null }, i), true);
  assert.equal(sessionInstantsDiffer({ ...full, freeCancelUntil: null }, i), true);
  assert.equal(sessionInstantsDiffer({ ...full, startsAt: new Date(i.startsAtMs + 1) }, i), true);
  const noFree = computeSessionInstants(baseSession, { ...club, freeCancelHours: 0 }) as SessionInstants;
  assert.equal(sessionInstantsDiffer({ ...full, freeCancelUntil: null }, noFree), false);
  assert.equal(sessionInstantsDiffer(full, noFree), true); // a stale freeCancelUntil must be removed
});

test('the client windows use the STORED instants (the same numbers the rules compare)', () => {
  const start = at(20, 0);
  const full = withStartsAt(baseSession);
  const ev0 = (s: Session, c: Club, now: number) =>
    evaluateTapOutWindow(s, c, now, 'Asia/Singapore', { safetyMarginMs: 0 });
  // Club hours were changed after the session was written: the stored deadline still rules.
  const changedClub = { ...club, freeCancelHours: 48, lockCancelHours: 1 };
  assert.equal(ev0(full, changedClub, start - 30 * HOUR).phase, 'free'); // stored free = start-24h
  assert.equal(ev0(full, changedClub, start - 20 * HOUR).phase, 'late'); // (club now says 48h)
  assert.equal(ev0(full, changedClub, start - 2 * HOUR).phase, 'locked'); // stored late = start-4h
  // No stored lateCancelUntil: cancelling is unavailable (the rules lock it), joining still works
  const noLate: Session = { ...full, lateCancelUntil: null };
  assert.equal(ev0(noLate, club, start - 30 * HOUR).phase, 'unavailable');
  assert.equal(ev0(noLate, club, start - 30 * HOUR).canTapOut, false);
  assert.equal(evaluateJoinWindow(noLate, start - 30 * HOUR).canJoin, true);
  // No stored freeCancelUntil: never a free cancel, late cancel only
  const noFreeStored: Session = { ...full, freeCancelUntil: null };
  assert.equal(ev0(noFreeStored, club, start - 100 * HOUR).phase, 'late');
  assert.equal(ev0(noFreeStored, club, start - 100 * HOUR).canFreeCancel, false);
  // Local demo state (no rules) derives them from the club instead
  const local = evaluateTapOutWindow(baseSession, club, start - 30 * HOUR, 'Asia/Singapore', {
    requireStartsAt: false,
    safetyMarginMs: 0,
  });
  assert.equal(local.phase, 'free');
  assert.equal(local.freeDeadlineMs, start - 24 * HOUR);
  assert.equal(local.lockDeadlineMs, start - 4 * HOUR);
});

test('getEnforcedSessionStartMs prefers startsAt, accepts Timestamp-like values, and respects requireStartsAt', () => {
  const ms = Date.UTC(2026, 9, 20, 12, 0);
  assert.equal(getEnforcedSessionStartMs({ ...baseSession, startsAt: { toMillis: () => ms } }), ms);
  assert.equal(getEnforcedSessionStartMs({ ...baseSession, startsAt: ms }), ms);
  assert.equal(getEnforcedSessionStartMs({ ...baseSession, startsAt: null }), null);
  assert.equal(getEnforcedSessionStartMs(baseSession, 'Asia/Singapore', false), ms);
  assert.equal(getEnforcedSessionStartMs({ ...baseSession, startTime: 'TBD' }, 'Asia/Singapore', false), null);
  // startsAt wins over a stale date/time
  assert.equal(getEnforcedSessionStartMs({ ...baseSession, sessionDate: '2027-01-01', startsAt: ms }), ms);
});
