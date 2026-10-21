import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateJoinWindow,
  evaluateTapOutWindow,
  getSessionEndTimestampMs,
  getSessionStartTimestampMs,
  isSessionCompletedOrPast,
  parseSessionTimeMinutes,
  parseSessionTimeTotalMinutes,
} from './badmintonLogic.ts';
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
const at = (h: number, m = 0, dayOffset = 0) =>
  new Date(2026, 9, 20 + dayOffset, h, m, 0, 0).getTime();

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
  assert.equal(evaluateJoinWindow(baseSession, start - 3600_000).canJoin, true);
  // in play (started 1 minute ago)
  const inPlay = evaluateJoinWindow({ ...baseSession, bookingStatus: 'in_play' }, start + 60_000);
  assert.equal(inPlay.canJoin, false);
  // still marked booked but the clock has passed the start: closed
  const started = evaluateJoinWindow(baseSession, start + 60_000);
  assert.equal(started.canJoin, false);
  assert.match(started.reason || '', /started/);
  // past (end time over) and completed
  assert.equal(evaluateJoinWindow(baseSession, at(23, 0)).canJoin, false);
  assert.equal(evaluateJoinWindow({ ...baseSession, bookingStatus: 'completed' }, start - 3600_000).canJoin, false);
  assert.equal(evaluateJoinWindow({ ...baseSession, feeSplitFinalized: true }, start - 3600_000).canJoin, false);
  // unreadable start: cannot prove it has not started
  assert.equal(evaluateJoinWindow({ ...baseSession, startTime: 'TBD' }, start - 3600_000).canJoin, false);
  assert.equal(evaluateJoinWindow({ ...baseSession, sessionDate: 'soon' }, start - 3600_000).canJoin, false);
});

test('tap-out window: unreadable start is locked, never a free cancellation', () => {
  const evalTbd = evaluateTapOutWindow({ ...baseSession, startTime: 'TBD' }, club, at(8, 0));
  assert.equal(evalTbd.canTapOut, false);
  const evalNoDate = evaluateTapOutWindow({ ...baseSession, sessionDate: '' }, club, at(8, 0));
  assert.equal(evalNoDate.canTapOut, false);
  // 7.30pm start now parses, so the window works normally (30h before = free)
  const parsed = evaluateTapOutWindow({ ...baseSession, startTime: '7.30pm' }, club, at(19, 30) - 30 * 3600_000);
  assert.equal(parsed.canTapOut, true);
  assert.equal(parsed.isPenaltyWindow, false);
  // freeCancelHours 0: always the late fee, never free
  const noFree = evaluateTapOutWindow(baseSession, { ...club, freeCancelHours: 0, lockCancelHours: 0 }, at(8, 0));
  assert.equal(noFree.canTapOut, true);
  assert.equal(noFree.isPenaltyWindow, true);
});
