import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countCourts,
  deriveHistoricalCourtRate,
  describeCourtRate,
  evaluateCourtBookingAdvice,
  plannedCourtCount,
} from './courtAdvice.ts';
import {
  buildSessionDefaultsFromHistory,
  nextDateForWeekday,
  suggestCourtFeeFromHistory,
} from './sessionDefaults.ts';
import { parseQuickSessionInput } from './badmintonLogic.ts';
import type { Club, Session, SessionRsvp } from '../types.ts';

const club: Club = {
  id: 'club_a',
  name: 'Club A',
  description: '',
  paymentInfo: '',
  freeCancelHours: 24,
  lockCancelHours: 2,
  lateCancelFeePercent: 50,
  noShowFeePercent: 100,
  ownerId: 'owner',
  clubOwnerPlayerId: 'p_owner',
};

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 's_1',
  clubId: 'club_a',
  title: 'Thursday Night',
  venue: 'Hall One',
  courtNumbers: 'TBD',
  sessionDate: '2026-10-22',
  startTime: '20:00',
  endTime: '22:00',
  bookingStatus: 'pending',
  courtFee: 0,
  shuttlesUsed: 0,
  shuttleUnitCost: 3,
  shuttleFee: 0,
  maxPlayers: 8,
  organizerName: 'Org',
  paymentInfo: '',
  feeSplitFinalized: false,
  ownerId: 'owner',
  ...overrides,
});

const going = (count: number, ids: string[] = []): SessionRsvp[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `r_${i}`,
    sessionId: 's_1',
    playerId: ids[i] ?? `p_${i}`,
    playerName: `Player ${i}`,
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 0,
    feeShare: 0,
    paidStatus: 'unpaid',
  }) as SessionRsvp);

test('countCourts reads explicit counts, lists and ranges, and stays unknown for TBD', () => {
  assert.equal(countCourts('2 courts'), 2);
  assert.equal(countCourts('1 court'), 1);
  assert.equal(countCourts('Court 3, Court 4'), 2);
  assert.equal(countCourts('Court 3 & 4'), 2);
  assert.equal(countCourts('Courts 1-3'), 3);
  assert.equal(countCourts('Court 1, Court 2 (TBD)'), 2);
  assert.equal(countCourts('TBD'), null);
  assert.equal(countCourts(''), null);
});

test('plannedCourtCount falls back to capacity only when the label is unknown', () => {
  assert.deepEqual(plannedCourtCount({ courtNumbers: 'TBD', maxPlayers: 12 }), {
    courts: 2,
    estimated: true,
  });
  assert.deepEqual(plannedCourtCount({ courtNumbers: '3 courts', maxPlayers: 12 }), {
    courts: 3,
    estimated: false,
  });
});

test('advice follows the fee being edited instead of a stale value', () => {
  const rsvps = going(8);
  const at72 = evaluateCourtBookingAdvice(
    makeSession({ courtFee: 72, courtNumbers: '2 courts' }),
    rsvps,
    club
  );
  const at100 = evaluateCourtBookingAdvice(
    makeSession({ courtFee: 100, courtNumbers: '2 courts' }),
    rsvps,
    club
  );
  assert.equal(at72.recommendedCourts, 2);
  assert.equal(at72.totalCost, 72);
  assert.equal(at72.costPerPlayer, 9);
  assert.equal(at100.totalCost, 100);
  assert.equal(at100.costPerPlayer, 12.5);
});

test('fee scales per court: a 1-court fee prices a 2-court recommendation at double', () => {
  const advice = evaluateCourtBookingAdvice(
    makeSession({ courtFee: 40, courtNumbers: '1 court' }),
    going(10),
    club
  );
  assert.equal(advice.costPerCourt, 40);
  assert.equal(advice.recommendedCourts, 2);
  assert.equal(advice.totalCost, 80);
  assert.equal(advice.costPerPlayer, 8);
});

test('unknown fee and no history leaves cost unknown rather than inventing one', () => {
  const advice = evaluateCourtBookingAdvice(makeSession(), going(6), club);
  assert.equal(advice.rate, null);
  assert.equal(advice.totalCost, null);
  assert.equal(advice.costPerPlayer, null);
  assert.equal(advice.recommendedCourts, 1);
  assert.equal(describeCourtRate(advice.rate), 'Enter a court fee to estimate costs.');
});

test('unpriced session borrows the median court-hour rate from same-venue history', () => {
  const history = [
    makeSession({ id: 'h1', bookingStatus: 'completed', courtFee: 80, courtNumbers: '2 courts', sessionDate: '2026-10-01' }),
    makeSession({ id: 'h2', bookingStatus: 'completed', courtFee: 40, courtNumbers: 'Court 5', sessionDate: '2026-10-08' }),
    makeSession({ id: 'h3', bookingStatus: 'booked', courtFee: 60, courtNumbers: 'Court 1', endTime: '23:00', sessionDate: '2026-10-15' }),
    makeSession({ id: 'other', venue: 'Elsewhere', bookingStatus: 'completed', courtFee: 500, courtNumbers: '1 court' }),
    makeSession({ id: 'tbd', bookingStatus: 'completed', courtFee: 999, courtNumbers: 'TBD' }),
  ];
  const rate = deriveHistoricalCourtRate(history, { clubId: 'club_a', venue: ' hall one ' });
  assert.ok(rate);
  assert.equal(rate.source, 'venue_history');
  assert.equal(rate.sampleSize, 3);
  assert.equal(rate.perCourtHour, 20);

  const advice = evaluateCourtBookingAdvice(makeSession(), going(8), club, { history });
  assert.equal(advice.costPerCourt, 40);
  assert.equal(advice.totalCost, 80);
});

test('excluded club owner is not billed in the per-player estimate', () => {
  const advice = evaluateCourtBookingAdvice(
    makeSession({ courtFee: 36, courtNumbers: '1 court' }),
    going(4, ['p_owner']),
    { ...club, excludeOwnerFromBilling: true }
  );
  assert.equal(advice.ownerExcluded, true);
  assert.equal(advice.billableCount, 3);
  assert.equal(advice.costPerPlayer, 12);
});

test('borderline roster reports the players still needed to fill every court', () => {
  const advice = evaluateCourtBookingAdvice(
    makeSession({ courtFee: 72, courtNumbers: '2 courts' }),
    going(7),
    club
  );
  assert.equal(advice.recommendedCourts, 2);
  assert.equal(advice.status, 'borderline');
  assert.equal(advice.playersShort, 1);
});

test('history defaults take the latest club session and its weekday', () => {
  const history = [
    makeSession({ id: 'old', sessionDate: '2026-09-01', venue: 'Old Hall' }),
    makeSession({ id: 'new', sessionDate: '2026-10-15', venue: 'Hall One', maxPlayers: 12, startTime: '19:00', endTime: '21:30', shuttleUnitCost: 3.5 }),
    makeSession({ id: 'x', clubId: 'club_b', sessionDate: '2026-12-01' }),
  ];
  // 2026-10-19 is a Monday; the latest session (2026-10-15) was a Thursday.
  const defaults = buildSessionDefaultsFromHistory(history, 'club_a', new Date(2026, 9, 19, 9));
  assert.ok(defaults);
  assert.equal(defaults.venue, 'Hall One');
  assert.equal(defaults.maxPlayers, 12);
  assert.equal(defaults.startTime, '19:00');
  assert.equal(defaults.endTime, '21:30');
  assert.equal(defaults.shuttleUnitCost, 3.5);
  assert.equal(defaults.sessionDate, '2026-10-22');
  assert.equal(buildSessionDefaultsFromHistory(history, 'club_none'), null);
});

test('history defaults never land on an already-scheduled future session', () => {
  const history = [makeSession({ id: 'next', sessionDate: '2026-10-24' })];
  const defaults = buildSessionDefaultsFromHistory(history, 'club_a', new Date(2026, 9, 19, 9));
  assert.equal(defaults?.sessionDate, '2026-10-31');
});

test('suggested fee recomputes for the new shape from the club rate', () => {
  const history = [
    makeSession({ id: 'h', bookingStatus: 'completed', courtFee: 72, courtNumbers: '2 courts' }),
  ];
  const twoHours = suggestCourtFeeFromHistory(history, {
    clubId: 'club_a', venue: 'Hall One', courtNumbers: '', maxPlayers: 12, startTime: '20:00', endTime: '22:00',
  });
  const threeCourts = suggestCourtFeeFromHistory(history, {
    clubId: 'club_a', venue: 'Hall One', courtNumbers: '', maxPlayers: 18, startTime: '20:00', endTime: '22:00',
  });
  const threeHours = suggestCourtFeeFromHistory(history, {
    clubId: 'club_a', venue: 'Hall One', courtNumbers: '', maxPlayers: 12, startTime: '19:00', endTime: '22:00',
  });
  assert.equal(twoHours?.courtFee, 72);
  assert.equal(threeCourts?.courtFee, 108);
  assert.equal(threeHours?.courtFee, 108);
});

test('nextDateForWeekday resolves relative to today', () => {
  const monday = new Date(2026, 9, 19, 9);
  assert.equal(nextDateForWeekday(4, monday), '2026-10-22');
  assert.equal(nextDateForWeekday(1, monday), '2026-10-26');
  assert.equal(nextDateForWeekday(1, monday, true), '2026-10-19');
});

test('quick parser keeps history defaults for anything the text omits', () => {
  const today = new Date(2026, 9, 19, 9);
  const defaults = {
    title: 'Thursday Night',
    venue: 'Hall One',
    sessionDate: '2026-10-22',
    startTime: '20:00',
    endTime: '22:00',
    maxPlayers: 12,
    courtFee: 72,
  };
  const empty = parseQuickSessionInput('', defaults, today);
  assert.equal(empty.venue, 'Hall One');
  assert.equal(empty.title, 'Thursday Night');
  assert.equal(empty.courtFee, 72);
  assert.equal(empty.courtFeeFromText, false);
  assert.equal(empty.maxPlayers, 12);

  const typed = parseQuickSessionInput('Sat 7pm-9pm, $90 court', defaults, today);
  assert.equal(typed.sessionDate, '2026-10-24');
  assert.equal(typed.startTime, '19:00');
  assert.equal(typed.endTime, '21:00');
  assert.equal(typed.courtFee, 90);
  assert.equal(typed.courtFeeFromText, true);
  assert.equal(typed.venue, 'Hall One');
});
