import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShareableClubAndSessionUrl,
  getShortInviteCodeFromParams,
  parseSharedSessionFromUrlParams,
} from './badmintonLogic.ts';
import {
  buildShortInviteDocFields,
  buildShortInviteUrl,
  generateShortInviteCode,
  parseShortInviteDoc,
} from './shortInviteCodec.ts';
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
  assert.equal(parsed.clubId, 'c1');
  assert.equal(parsed.sessionId, 's1');
  assert.equal(parsed.hydratedSession?.title, 'Weekly');
  assert.equal(parsed.hydratedSession?.sessionDate, '2026-10-28');
  assert.equal(parsed.hydratedSession?.startTime, '20:00');
  assert.equal(parsed.hydratedSession?.endTime, '22:00');
  assert.equal(parsed.hydratedSession?.venue, 'Hall');
  assert.equal(parsed.hydratedSession?.courtNumbers, 'Court 1');
  assert.equal(parsed.hydratedSession?.courtFee, 60);
  assert.equal(parsed.hydratedSession?.maxPlayers, 7);
  assert.equal(parsed.hydratedSession?.organizerName, 'Host');
  assert.equal(parsed.hydratedSession?.bookingStatus, 'booked');
});

test('compact invite URL is substantially shorter than the legacy verbose query string', () => {
  const richSession = {
    ...session,
    id: 'sess_1760981234567_xyz99',
    clubId: 'club_1760981234567_abc12',
    title: 'Weekly Badminton Session 🏸',
    venue: 'TT Sports Center — Hall B',
    courtNumbers: 'Court 1 & 2',
    courtFee: 42.4,
    startsAt: new Date(1794650400000),
  } as Session;
  const compactUrl = withWindow(() =>
    buildShareableClubAndSessionUrl(richSession.clubId, richSession, club)
  );
  const legacyParams = new URLSearchParams({
    club: richSession.clubId,
    session: richSession.id,
    title: richSession.title,
    date: richSession.sessionDate,
    start: richSession.startTime,
    end: richSession.endTime,
    venue: richSession.venue,
    courts: richSession.courtNumbers,
    fee: String(richSession.courtFee),
    max: String(richSession.maxPlayers),
    org: richSession.organizerName,
    status: richSession.bookingStatus,
    startsAt: String(1794650400000),
    cname: club.name,
    cur: club.currency,
    free: String(club.freeCancelHours),
    lock: String(club.lockCancelHours),
    late: String(club.lateCancelFeePercent),
    noshow: String(club.noShowFeePercent),
  });
  const legacyUrl = `https://app.test/?${legacyParams.toString()}`;
  assert.ok(
    compactUrl.length < legacyUrl.length * 0.8,
    `expected compact URL (${compactUrl.length} chars) to be much shorter than legacy (${legacyUrl.length} chars)`
  );
  const parsed = parseSharedSessionFromUrlParams(new URL(compactUrl).searchParams);
  assert.equal(parsed.hydratedSession?.title, 'Weekly Badminton Session 🏸');
  assert.equal(parsed.hydratedSession?.venue, 'TT Sports Center — Hall B');
  assert.equal(parsed.hydratedSession?.courtFee, 42.4);
  assert.equal(parsed.hydratedSession?.startsAt instanceof Date, true);
  assert.equal((parsed.hydratedSession?.startsAt as Date).getTime(), 1794650400000);
});

test('club-only invite uses minimal ?c= parameter and parses cleanly', () => {
  const url = withWindow(() => buildShareableClubAndSessionUrl('club_abc'));
  assert.equal(url, 'https://app.test/?c=club_abc');
  const parsed = parseSharedSessionFromUrlParams(new URL(url).searchParams);
  assert.equal(parsed.clubId, 'club_abc');
  assert.equal(parsed.sessionId, null);
  assert.equal(parsed.hydratedSession, null);
  assert.equal(parsed.hydratedClubTerms, null);
});

test('links without club terms (older links) yield no terms instead of defaults', () => {
  const url = withWindow(() => buildShareableClubAndSessionUrl('c1', session));
  const parsed = parseSharedSessionFromUrlParams(new URL(url).searchParams);
  assert.equal(parsed.hydratedClubTerms, null);
  assert.ok(parsed.hydratedSession);
});

test('legacy verbose invite URLs remain 100% backward compatible', () => {
  const params = new URLSearchParams(
    'club=c1&session=s1&title=Legacy+Match&date=2026-11-14&start=18:00&end=20:00&venue=Old+Hall&courts=Court+3&fee=55&max=8&org=Alex&status=booked&cname=Rookies&cur=MYR&free=48&lock=4&late=50&noshow=100'
  );
  const parsed = parseSharedSessionFromUrlParams(params);
  assert.equal(parsed.clubId, 'c1');
  assert.equal(parsed.sessionId, 's1');
  assert.equal(parsed.hydratedSession?.title, 'Legacy Match');
  assert.equal(parsed.hydratedSession?.venue, 'Old Hall');
  assert.equal(parsed.hydratedClubTerms?.name, 'Rookies');
  assert.equal(parsed.hydratedClubTerms?.freeCancelHours, 48);
});

test('partial or invalid terms are ignored', () => {
  const params = new URLSearchParams('club=c1&session=s1&title=T&free=48&lock=abc&late=50&noshow=100');
  assert.equal(parseSharedSessionFromUrlParams(params).hydratedClubTerms, null);
});

test('short invite code URL (?i=xxxxxxx) generates ultra-short links and round-trips Firestore doc payload', () => {
  const code = generateShortInviteCode();
  assert.match(code, /^[a-zA-Z0-9]{7}$/);

  const shortUrl = withWindow(() => buildShortInviteUrl(code));
  assert.equal(shortUrl, `https://app.test/?i=${code}`);
  assert.equal(
    getShortInviteCodeFromParams(new URL(shortUrl).searchParams),
    code
  );
  assert.equal(getShortInviteCodeFromParams(new URLSearchParams('i=bad!')), null);

  const sessionWithStartsAt = {
    ...session,
    startsAt: new Date(1794650400000),
  } as Session;
  const docFields = buildShortInviteDocFields('c1', sessionWithStartsAt, club);
  const parsed = parseShortInviteDoc(docFields as unknown as Record<string, unknown>);
  assert.ok(parsed);
  assert.equal(parsed.clubId, 'c1');
  assert.equal(parsed.sessionId, 's1');
  assert.equal(parsed.hydratedSession?.title, 'Weekly');
  assert.equal(parsed.hydratedSession?.venue, 'Hall');
  assert.equal((parsed.hydratedSession?.startsAt as Date).getTime(), 1794650400000);
  assert.deepEqual(parsed.hydratedClubTerms, {
    name: 'Rookies',
    currency: 'MYR',
    freeCancelHours: 48,
    lockCancelHours: 4,
    lateCancelFeePercent: 50,
    noShowFeePercent: 100,
  });

  // Club-only short invite round-trip
  const clubOnlyFields = buildShortInviteDocFields('c1');
  const parsedClubOnly = parseShortInviteDoc(
    clubOnlyFields as unknown as Record<string, unknown>
  );
  assert.deepEqual(parsedClubOnly, {
    clubId: 'c1',
    sessionId: null,
    hydratedSession: null,
    hydratedClubTerms: null,
  });
});
