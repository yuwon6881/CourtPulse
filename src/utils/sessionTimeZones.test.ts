import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSessionInstants,
  evaluateFinalizeReadiness,
  FINALIZE_CLOCK_SKEW_MS,
  evaluateJoinWindow,
  evaluateTapOutWindow,
  getSessionEndTimestampMs,
  getSessionStartTimestampMs,
  type SessionInstants,
} from './badmintonLogic.ts';
import type { Club, Session } from '../types.ts';

// Expected instants below are written as literal UTC times from the zones' published offsets
// (never derived with the code under test), so a wrong zone conversion fails here. They also make
// the suite independent of the device zone: run it with TZ=Pacific/Kiritimati and
// TZ=America/Los_Angeles and it must give identical results.
//
// 2026 clock changes: Europe/London ends BST 25 Oct (01:00 UTC), America/New_York ends EDT 1 Nov
// (06:00 UTC), Australia/Sydney starts AEDT 4 Oct (16:00 UTC on 3 Oct), Pacific/Auckland starts
// NZDT 27 Sep (14:00 UTC on 26 Sep).

const HOUR = 3600_000;
const utc = (iso: string): number => Date.parse(iso);

interface Case {
  label: string;
  zone: string;
  date: string;
  start: string;
  end: string;
  startsAt: string;
  endsAt: string;
}

const CASES: Case[] = [
  // Asia/Singapore: UTC+8 all year
  { label: 'SG evening', zone: 'Asia/Singapore', date: '2026-10-24', start: '20:00', end: '22:00', startsAt: '2026-10-24T12:00:00Z', endsAt: '2026-10-24T14:00:00Z' },
  { label: 'SG 00:00 start', zone: 'Asia/Singapore', date: '2026-10-25', start: '00:00', end: '02:00', startsAt: '2026-10-24T16:00:00Z', endsAt: '2026-10-24T18:00:00Z' },
  { label: 'SG 23:30 no end', zone: 'Asia/Singapore', date: '2026-10-25', start: '23:30', end: '', startsAt: '2026-10-25T15:30:00Z', endsAt: '2026-10-25T17:30:00Z' },
  { label: 'SG end == start rolls', zone: 'Asia/Singapore', date: '2026-10-24', start: '20:00', end: '20:00', startsAt: '2026-10-24T12:00:00Z', endsAt: '2026-10-25T12:00:00Z' },
  // Europe/London
  { label: 'London before change (BST)', zone: 'Europe/London', date: '2026-10-24', start: '20:00', end: '22:00', startsAt: '2026-10-24T19:00:00Z', endsAt: '2026-10-24T21:00:00Z' },
  { label: 'London change day (GMT)', zone: 'Europe/London', date: '2026-10-25', start: '20:00', end: '22:00', startsAt: '2026-10-25T20:00:00Z', endsAt: '2026-10-25T22:00:00Z' },
  { label: 'London change day 00:00', zone: 'Europe/London', date: '2026-10-25', start: '00:00', end: '02:00', startsAt: '2026-10-24T23:00:00Z', endsAt: '2026-10-25T02:00:00Z' },
  { label: 'London change day 23:30 no end', zone: 'Europe/London', date: '2026-10-25', start: '23:30', end: '', startsAt: '2026-10-25T23:30:00Z', endsAt: '2026-10-26T01:30:00Z' },
  { label: 'London rolls over the change (25h)', zone: 'Europe/London', date: '2026-10-24', start: '20:00', end: '20:00', startsAt: '2026-10-24T19:00:00Z', endsAt: '2026-10-25T20:00:00Z' },
  // America/New_York
  { label: 'NY before change (EDT)', zone: 'America/New_York', date: '2026-10-31', start: '20:00', end: '22:00', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-01T02:00:00Z' },
  { label: 'NY change day (EST)', zone: 'America/New_York', date: '2026-11-01', start: '20:00', end: '22:00', startsAt: '2026-11-02T01:00:00Z', endsAt: '2026-11-02T03:00:00Z' },
  { label: 'NY change day 00:00', zone: 'America/New_York', date: '2026-11-01', start: '00:00', end: '02:00', startsAt: '2026-11-01T04:00:00Z', endsAt: '2026-11-01T07:00:00Z' },
  { label: 'NY change day 23:30 no end', zone: 'America/New_York', date: '2026-11-01', start: '23:30', end: '', startsAt: '2026-11-02T04:30:00Z', endsAt: '2026-11-02T06:30:00Z' },
  { label: 'NY rolls over the change (25h)', zone: 'America/New_York', date: '2026-10-31', start: '20:00', end: '20:00', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-02T01:00:00Z' },
  // Australia/Sydney (spring forward)
  { label: 'Sydney before change (AEST)', zone: 'Australia/Sydney', date: '2026-10-03', start: '20:00', end: '22:00', startsAt: '2026-10-03T10:00:00Z', endsAt: '2026-10-03T12:00:00Z' },
  { label: 'Sydney change day (AEDT)', zone: 'Australia/Sydney', date: '2026-10-04', start: '20:00', end: '22:00', startsAt: '2026-10-04T09:00:00Z', endsAt: '2026-10-04T11:00:00Z' },
  { label: 'Sydney change day 00:00', zone: 'Australia/Sydney', date: '2026-10-04', start: '00:00', end: '04:00', startsAt: '2026-10-03T14:00:00Z', endsAt: '2026-10-03T17:00:00Z' },
  { label: 'Sydney change day 23:30 no end', zone: 'Australia/Sydney', date: '2026-10-04', start: '23:30', end: '', startsAt: '2026-10-04T12:30:00Z', endsAt: '2026-10-04T14:30:00Z' },
  { label: 'Sydney rolls over the change (23h)', zone: 'Australia/Sydney', date: '2026-10-03', start: '20:00', end: '20:00', startsAt: '2026-10-03T10:00:00Z', endsAt: '2026-10-04T09:00:00Z' },
  // Pacific/Auckland (spring forward)
  { label: 'Auckland before change (NZST)', zone: 'Pacific/Auckland', date: '2026-09-26', start: '20:00', end: '22:00', startsAt: '2026-09-26T08:00:00Z', endsAt: '2026-09-26T10:00:00Z' },
  { label: 'Auckland change day (NZDT)', zone: 'Pacific/Auckland', date: '2026-09-27', start: '20:00', end: '22:00', startsAt: '2026-09-27T07:00:00Z', endsAt: '2026-09-27T09:00:00Z' },
  { label: 'Auckland change day 00:00', zone: 'Pacific/Auckland', date: '2026-09-27', start: '00:00', end: '04:00', startsAt: '2026-09-26T12:00:00Z', endsAt: '2026-09-26T15:00:00Z' },
  { label: 'Auckland change day 23:30 no end', zone: 'Pacific/Auckland', date: '2026-09-27', start: '23:30', end: '', startsAt: '2026-09-27T10:30:00Z', endsAt: '2026-09-27T12:30:00Z' },
  { label: 'Auckland rolls over the change (23h)', zone: 'Pacific/Auckland', date: '2026-09-26', start: '20:00', end: '20:00', startsAt: '2026-09-26T08:00:00Z', endsAt: '2026-09-27T07:00:00Z' },
];

const sessionFor = (c: Case): Session => ({
  id: 'sess_tz',
  clubId: 'club_tz',
  title: 'Night Smash',
  venue: 'Hall',
  courtNumbers: 'Court 1',
  sessionDate: c.date,
  startTime: c.start,
  endTime: c.end,
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
});

const clubFor = (zone: string, freeCancelHours = 24, lockCancelHours = 4): Club => ({
  id: 'club_tz',
  name: 'Club',
  description: 'd',
  paymentInfo: 'PayNow',
  freeCancelHours,
  lockCancelHours,
  lateCancelFeePercent: 50,
  noShowFeePercent: 100,
  ownerId: 'owner_1',
  timezone: zone,
});

/** The session exactly as a manager's client stores it: startsAt + both deadlines. */
const stored = (c: Case, club: Club): Session => {
  const i = computeSessionInstants(sessionFor(c), club) as SessionInstants;
  return {
    ...sessionFor(c),
    startsAt: new Date(i.startsAtMs),
    lateCancelUntil: new Date(i.lateCancelUntilMs),
    freeCancelUntil: i.freeCancelUntilMs === null ? null : new Date(i.freeCancelUntilMs),
  };
};

const EXACT = { safetyMarginMs: 0 };

for (const c of CASES) {
  test(`derivation: ${c.label} (${c.zone})`, () => {
    const club = clubFor(c.zone);
    const s = sessionFor(c);
    const startMs = utc(c.startsAt);
    assert.equal(getSessionStartTimestampMs(s, c.zone), startMs);
    assert.equal(getSessionEndTimestampMs(s, c.zone), utc(c.endsAt));
    const i = computeSessionInstants(s, club) as SessionInstants;
    assert.equal(i.startsAtMs, startMs);
    // Hours are elapsed hours, so a clock change inside the window shifts the wall-clock time.
    assert.equal(i.freeCancelUntilMs, startMs - 24 * HOUR);
    assert.equal(i.lateCancelUntilMs, startMs - 4 * HOUR);
  });

  test(`boundaries: ${c.label} (${c.zone})`, () => {
    const club = clubFor(c.zone);
    const s = stored(c, club);
    const start = utc(c.startsAt);
    const freeDeadline = start - 24 * HOUR;
    const lockDeadline = start - 4 * HOUR;
    const join = (now: number, opts = EXACT) => evaluateJoinWindow(s, now, c.zone, opts).canJoin;
    const tap = (now: number) => evaluateTapOutWindow(s, club, now, c.zone, EXACT);

    // Joining: allowed iff now < startsAt; the default 30 s margin closes it slightly earlier.
    assert.equal(join(start - 1), true, 'join 1 ms before start');
    assert.equal(join(start), false, 'join exactly at start');
    assert.equal(join(start + 1), false, 'join 1 ms after start');
    assert.equal(join(start - 30_001, {} as typeof EXACT), true, 'join just outside the safety margin');
    assert.equal(join(start - 30_000, {} as typeof EXACT), false, 'join exactly on the safety margin');
    assert.equal(join(start - 29_999, {} as typeof EXACT), false, 'join just inside the safety margin');

    // Cancelling: free through freeDeadline (inclusive), late through lockDeadline, locked, closed.
    assert.equal(tap(freeDeadline - 1).phase, 'free');
    assert.equal(tap(freeDeadline).phase, 'free');
    assert.equal(tap(freeDeadline + 1).phase, 'late');
    assert.equal(tap(lockDeadline).phase, 'late');
    assert.equal(tap(lockDeadline + 1).phase, 'locked');
    assert.equal(tap(start - 1).phase, 'locked');
    assert.equal(tap(start).phase, 'started');
    assert.equal(tap(start + 1).canTapOut, false);
    assert.equal(tap(freeDeadline).freeDeadlineMs, freeDeadline);
    assert.equal(tap(freeDeadline).lockDeadlineMs, lockDeadline);

    // Finalizing: refused before the start and for the clock-skew margin after it, allowed from
    // start + margin on (so a host clock that runs ahead never beats the server's rule).
    const fin = (now: number) => evaluateFinalizeReadiness(s, now, c.zone).canFinalize;
    assert.equal(fin(start - 1), false);
    assert.equal(fin(start), false);
    assert.equal(fin(start + FINALIZE_CLOCK_SKEW_MS - 1), false);
    assert.equal(fin(start + FINALIZE_CLOCK_SKEW_MS), true);
    assert.equal(evaluateFinalizeReadiness({ ...s, bookingStatus: 'pending' }, start + HOUR, c.zone).canFinalize, false);
  });

  test(`zero-hour windows: ${c.label} (${c.zone})`, () => {
    const noFree = clubFor(c.zone, 0, 4);
    const s0 = stored(c, noFree);
    const start = utc(c.startsAt);
    // freeCancelHours = 0: no free window at all, even a week before.
    assert.equal(s0.freeCancelUntil ?? null, null);
    const early = evaluateTapOutWindow(s0, noFree, start - 7 * 24 * HOUR, c.zone, EXACT);
    assert.equal(early.canFreeCancel, false);
    assert.equal(early.phase, 'late');
    assert.equal(early.penaltyPercent, 50);

    // lockCancelHours = 0: late cancel stays open right up to the start, then closes.
    const noLock = clubFor(c.zone, 24, 0);
    const s1 = stored(c, noLock);
    const tap = (now: number) => evaluateTapOutWindow(s1, noLock, now, c.zone, EXACT);
    assert.equal(utc(c.startsAt), (computeSessionInstants(sessionFor(c), noLock) as SessionInstants).lateCancelUntilMs);
    assert.equal(tap(start - 1).phase, 'late');
    assert.equal(tap(start - 1).canTapOut, true);
    assert.equal(tap(start).canTapOut, false);
    assert.equal(tap(start).phase, 'started');

    // Both zero: only the late window, until the start.
    const none = clubFor(c.zone, 0, 0);
    const s2 = stored(c, none);
    const t2 = (now: number) => evaluateTapOutWindow(s2, none, now, c.zone, EXACT);
    assert.equal(t2(start - 1).phase, 'late');
    assert.equal(t2(start).canTapOut, false);
  });
}

test('the same wall-clock session is a different instant in each club zone', () => {
  const base = CASES[0];
  const instants = new Set(
    ['Asia/Singapore', 'America/New_York', 'Europe/London', 'Australia/Sydney', 'Pacific/Auckland'].map((zone) =>
      getSessionStartTimestampMs(sessionFor({ ...base, date: '2026-11-15' }), zone)
    )
  );
  assert.equal(instants.size, 5);
});

test('an unknown or missing club zone falls back to Asia/Singapore, not the device zone', () => {
  const s = sessionFor(CASES[0]);
  const sg = utc('2026-10-24T12:00:00Z');
  assert.equal(getSessionStartTimestampMs(s, 'Not/AZone'), sg);
  assert.equal(getSessionStartTimestampMs(s), sg);
  const i = computeSessionInstants(s, { ...clubFor('Not/AZone') }) as SessionInstants;
  assert.equal(i.startsAtMs, sg);
});
