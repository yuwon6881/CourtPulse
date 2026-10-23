import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShareableClubAndSessionUrl,
  parseSharedSessionFromUrlParams,
} from './badmintonLogic.ts';
import type { Session } from '../types';

const session = {
  id: 's1',
  clubId: 'c1',
  title: 'Weekly',
  venue: 'Hall',
  courtNumbers: 'Court 1',
  sessionDate: '2026-10-28',
  startTime: '20:00',
  endTime: '22:00',
  bookingStatus: 'booked',
  courtFee: 60,
  maxPlayers: 7,
  organizerName: 'Host',
} as Session;

const club = {
  name: 'Rookies',
  currency: 'MYR',
  freeCancelHours: 48,
  lockCancelHours: 4,
  lateCancelFeePercent: 50,
  noShowFeePercent: 100,
};

function withWindow<T>(fn: () => T): T {
  const g = globalThis as unknown as { window?: unknown };
  const prev = g.window;
  g.window = { location: { origin: 'https://app.test', pathname: '/' } };
  try {
    return fn();
  } finally {
    g.window = prev;
  }
}

test('an invite link carries the club terms and parses them back', () => {
  const url = withWindow(() => buildShareableClubAndSessionUrl('c1', session, club));
  const parsed = parseSharedSessionFromUrlParams(new URL(url).searchParams);
  assert.deepEqual(parsed.hydratedClubTerms, {
    name: 'Rookies',
    currency: 'MYR',
    freeCancelHours: 48,
    lockCancelHours: 4,
    lateCancelFeePercent: 50,
    noShowFeePercent: 100,
  });
});

test('links without club terms (older links) yield no terms instead of defaults', () => {
  const url = withWindow(() => buildShareableClubAndSessionUrl('c1', session));
  const parsed = parseSharedSessionFromUrlParams(new URL(url).searchParams);
  assert.equal(parsed.hydratedClubTerms, null);
  assert.ok(parsed.hydratedSession);
});

test('partial or invalid terms are ignored', () => {
  const params = new URLSearchParams('club=c1&session=s1&title=T&free=48&lock=abc&late=50&noshow=100');
  assert.equal(parseSharedSessionFromUrlParams(params).hydratedClubTerms, null);
});
