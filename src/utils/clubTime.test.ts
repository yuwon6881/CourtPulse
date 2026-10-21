import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CLUB_TIMEZONE,
  formatClubInstant,
  formatInClubZone,
  getTimeZoneShortLabel,
  isValidTimeZone,
  resolveClubTimeZone,
  toEpochMs,
  zonedWallTimeToUtcMs,
} from './clubTime.ts';

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

test('default club timezone is Asia/Singapore and is valid', () => {
  assert.equal(DEFAULT_CLUB_TIMEZONE, 'Asia/Singapore');
  assert.equal(isValidTimeZone(DEFAULT_CLUB_TIMEZONE), true);
});

test('isValidTimeZone / resolveClubTimeZone', () => {
  assert.equal(isValidTimeZone('Europe/London'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  for (const bad of ['', '   ', 'Mars/Olympus', 'not a zone', undefined, null, 42, 'x'.repeat(65)]) {
    assert.equal(isValidTimeZone(bad), false, String(bad));
  }
  assert.equal(resolveClubTimeZone('Asia/Tokyo'), 'Asia/Tokyo');
  assert.equal(resolveClubTimeZone('Mars/Olympus'), DEFAULT_CLUB_TIMEZONE);
  assert.equal(resolveClubTimeZone(undefined), DEFAULT_CLUB_TIMEZONE);
});

test('Asia/Singapore has no DST: 20:00 is always 12:00Z', () => {
  assert.equal(iso(zonedWallTimeToUtcMs('2026-10-20', 20 * 60, 'Asia/Singapore')), '2026-10-20T12:00:00.000Z');
  assert.equal(iso(zonedWallTimeToUtcMs('2026-01-05', 7 * 60 + 30, 'Asia/Singapore')), '2026-01-04T23:30:00.000Z');
  assert.equal(iso(zonedWallTimeToUtcMs('2026-06-15', 0, 'Asia/Singapore')), '2026-06-14T16:00:00.000Z');
});

test('America/New_York: ordinary EDT and EST days', () => {
  assert.equal(iso(zonedWallTimeToUtcMs('2026-07-01', 19 * 60, 'America/New_York')), '2026-07-01T23:00:00.000Z');
  assert.equal(iso(zonedWallTimeToUtcMs('2026-12-01', 19 * 60, 'America/New_York')), '2026-12-02T00:00:00.000Z');
});

test('America/New_York spring-forward gap (2026-03-08): 02:30 does not exist and shifts forward to 03:30 EDT', () => {
  // Before the jump: 01:30 EST = 06:30Z. After: 03:00 EDT = 07:00Z.
  assert.equal(iso(zonedWallTimeToUtcMs('2026-03-08', 90, 'America/New_York')), '2026-03-08T06:30:00.000Z');
  assert.equal(iso(zonedWallTimeToUtcMs('2026-03-08', 3 * 60, 'America/New_York')), '2026-03-08T07:00:00.000Z');
  // In the gap: interpreted with the pre-transition offset (EST) => 07:30Z = 03:30 EDT.
  assert.equal(iso(zonedWallTimeToUtcMs('2026-03-08', 2 * 60 + 30, 'America/New_York')), '2026-03-08T07:30:00.000Z');
  assert.equal(iso(zonedWallTimeToUtcMs('2026-03-08', 2 * 60, 'America/New_York')), '2026-03-08T07:00:00.000Z');
});

test('America/New_York fall-back overlap (2026-11-01): 01:30 happens twice and resolves to the earlier instant', () => {
  // First 01:30 is EDT (05:30Z); second is EST (06:30Z). We take the first.
  assert.equal(iso(zonedWallTimeToUtcMs('2026-11-01', 90, 'America/New_York')), '2026-11-01T05:30:00.000Z');
  assert.equal(iso(zonedWallTimeToUtcMs('2026-11-01', 60, 'America/New_York')), '2026-11-01T05:00:00.000Z');
  // 02:00 is unambiguous EST again.
  assert.equal(iso(zonedWallTimeToUtcMs('2026-11-01', 120, 'America/New_York')), '2026-11-01T07:00:00.000Z');
  // Evening of the transition day is plain EST.
  assert.equal(iso(zonedWallTimeToUtcMs('2026-11-01', 20 * 60, 'America/New_York')), '2026-11-02T01:00:00.000Z');
});

test('Europe/London: GMT in winter, BST in summer, and the 2026-03-29 gap', () => {
  assert.equal(iso(zonedWallTimeToUtcMs('2026-01-15', 19 * 60, 'Europe/London')), '2026-01-15T19:00:00.000Z');
  assert.equal(iso(zonedWallTimeToUtcMs('2026-07-15', 19 * 60, 'Europe/London')), '2026-07-15T18:00:00.000Z');
  // 01:30 on 2026-03-29 does not exist in London (01:00 GMT jumps to 02:00 BST) -> 02:30 BST = 01:30Z
  assert.equal(iso(zonedWallTimeToUtcMs('2026-03-29', 90, 'Europe/London')), '2026-03-29T01:30:00.000Z');
  // 2026-10-25 01:30 occurs twice; earlier = BST = 00:30Z
  assert.equal(iso(zonedWallTimeToUtcMs('2026-10-25', 90, 'Europe/London')), '2026-10-25T00:30:00.000Z');
});

test('Australia/Sydney: southern-hemisphere DST (AEDT +11 / AEST +10)', () => {
  assert.equal(iso(zonedWallTimeToUtcMs('2026-01-10', 19 * 60, 'Australia/Sydney')), '2026-01-10T08:00:00.000Z');
  assert.equal(iso(zonedWallTimeToUtcMs('2026-07-10', 19 * 60, 'Australia/Sydney')), '2026-07-10T09:00:00.000Z');
  // DST starts 2026-10-04 at 02:00 AEST -> 03:00 AEDT. 02:30 is in the gap -> 03:30 AEDT = 16:30Z (Oct 3)
  assert.equal(iso(zonedWallTimeToUtcMs('2026-10-04', 2 * 60 + 30, 'Australia/Sydney')), '2026-10-03T16:30:00.000Z');
  // DST ends 2026-04-05 at 03:00 AEDT -> 02:00 AEST. 02:30 occurs twice; earlier = AEDT = 15:30Z (Apr 4)
  assert.equal(iso(zonedWallTimeToUtcMs('2026-04-05', 2 * 60 + 30, 'Australia/Sydney')), '2026-04-04T15:30:00.000Z');
});

test('midnight and midnight-crossing minute counts roll into the next day', () => {
  assert.equal(iso(zonedWallTimeToUtcMs('2026-10-20', 0, 'Asia/Singapore')), '2026-10-19T16:00:00.000Z');
  // 24:00 == next day's 00:00
  assert.equal(
    zonedWallTimeToUtcMs('2026-10-20', 1440, 'Asia/Singapore'),
    zonedWallTimeToUtcMs('2026-10-21', 0, 'Asia/Singapore')
  );
  // 23:00 + 2h end = 25:00 -> 01:00 next day
  assert.equal(iso(zonedWallTimeToUtcMs('2026-10-20', 25 * 60, 'Asia/Singapore')), '2026-10-20T17:00:00.000Z');
  // month / year rollover
  assert.equal(
    zonedWallTimeToUtcMs('2026-12-31', 25 * 60, 'Asia/Singapore'),
    zonedWallTimeToUtcMs('2027-01-01', 60, 'Asia/Singapore')
  );
  // Across a DST change: 23:00 on the 7th + 3h in New York = 02:00 on the 8th (gap) -> 03:00 EDT
  assert.equal(iso(zonedWallTimeToUtcMs('2026-03-07', 26 * 60, 'America/New_York')), '2026-03-08T07:00:00.000Z');
});

test('UTC and extreme offsets', () => {
  assert.equal(iso(zonedWallTimeToUtcMs('2026-10-20', 20 * 60, 'UTC')), '2026-10-20T20:00:00.000Z');
  assert.equal(iso(zonedWallTimeToUtcMs('2026-10-20', 20 * 60, 'Pacific/Kiritimati')), '2026-10-20T06:00:00.000Z');
  assert.equal(iso(zonedWallTimeToUtcMs('2026-10-20', 20 * 60, 'Asia/Kolkata')), '2026-10-20T14:30:00.000Z');
});

test('invalid inputs return null', () => {
  assert.equal(zonedWallTimeToUtcMs('2026-10-20', 600, 'Mars/Olympus'), null);
  assert.equal(zonedWallTimeToUtcMs('2026-10-20', 600, ''), null);
  assert.equal(zonedWallTimeToUtcMs('soon', 600, 'UTC'), null);
  assert.equal(zonedWallTimeToUtcMs('2026-02-31', 600, 'UTC'), null);
  assert.equal(zonedWallTimeToUtcMs('2026-13-01', 600, 'UTC'), null);
  assert.equal(zonedWallTimeToUtcMs('2026-10-20', Number.NaN, 'UTC'), null);
  assert.equal(zonedWallTimeToUtcMs('2026-10-20', 10.5, 'UTC'), null);
});

test('formatting is pinned to the club zone, with a zone label', () => {
  const ms = Date.UTC(2026, 9, 22, 12, 0); // Thu 22 Oct 2026 12:00Z = 20:00 SGT
  assert.equal(formatClubInstant(ms, 'Asia/Singapore'), 'Thu 22 Oct, 8:00 PM SGT');
  assert.equal(formatClubInstant(ms, 'Asia/Singapore', false), 'Thu 22 Oct, 8:00 PM');
  assert.equal(formatClubInstant(ms, 'America/New_York'), 'Thu 22 Oct, 8:00 AM EDT');
  assert.equal(formatClubInstant(ms, 'Europe/London'), 'Thu 22 Oct, 1:00 PM BST');
  // Unknown zone falls back to the default zone rather than the device zone.
  assert.equal(formatClubInstant(ms, 'Mars/Olympus'), 'Thu 22 Oct, 8:00 PM SGT');
  assert.equal(formatClubInstant(Number.NaN, 'UTC'), '');
  assert.match(formatInClubZone(ms, 'Asia/Tokyo', { hour: '2-digit', minute: '2-digit', hour12: false }), /21:00/);
  assert.equal(getTimeZoneShortLabel('Asia/Kuala_Lumpur'), 'MYT');
  assert.equal(getTimeZoneShortLabel('Australia/Sydney', Date.UTC(2026, 0, 10)), 'AEDT');
});

test('toEpochMs reads Timestamps, Dates and numbers', () => {
  assert.equal(toEpochMs(1234), 1234);
  assert.equal(toEpochMs(new Date(5000)), 5000);
  assert.equal(toEpochMs({ toMillis: () => 777 }), 777);
  assert.equal(toEpochMs({ seconds: 2, nanoseconds: 500_000_000 }), 2500);
  assert.equal(toEpochMs(null), null);
  assert.equal(toEpochMs(undefined), null);
  assert.equal(toEpochMs('2026-10-20'), null);
  assert.equal(toEpochMs(new Date('nope')), null);
});

test('results do not depend on the process timezone', () => {
  // Assert fixed expectations; the suite is also run under TZ=Pacific/Kiritimati and TZ=America/Los_Angeles.
  assert.equal(iso(zonedWallTimeToUtcMs('2026-10-20', 20 * 60, 'Asia/Singapore')), '2026-10-20T12:00:00.000Z');
  assert.equal(formatClubInstant(Date.UTC(2026, 9, 22, 12, 0), 'Asia/Singapore'), 'Thu 22 Oct, 8:00 PM SGT');
});
