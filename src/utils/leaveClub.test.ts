import test from 'node:test';
import assert from 'node:assert/strict';
import { findLeaveClubBlocker } from './leaveClub.ts';
import type { Session, SessionRsvp } from '../types';

const session = (over: Partial<Session> = {}): Session =>
  ({ id: 's1', clubId: 'c1', title: 'Weekly', feeSplitFinalized: false, ...over }) as Session;
const rsvp = (over: Partial<SessionRsvp> = {}): SessionRsvp =>
  ({
    id: 'r1',
    clubId: 'c1',
    sessionId: 's1',
    playerId: 'p1',
    status: 'going',
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: '',
    ...over,
  }) as SessionRsvp;

const check = (
  rsvps: SessionRsvp[],
  sessions: Session[],
  withdrawable: string[] = []
) =>
  findLeaveClubBlocker({
    playerId: 'p1',
    clubId: 'c1',
    rsvps,
    sessions,
    withdrawableRsvpIds: new Set(withdrawable),
    formatMoney: (n) => `$${n.toFixed(2)}`,
  });

test('can leave with no RSVPs', () => {
  assert.equal(check([], [session()]), null);
});

test('an open RSVP that is withdrawn with the membership does not block', () => {
  assert.equal(check([rsvp()], [session()], ['r1']), null);
});

test('going past the free window (not withdrawable) blocks, naming the session', () => {
  const msg = check([rsvp()], [session()]);
  assert.match(msg ?? '', /still on the roster for "Weekly"/);
});

test('a late cancel on an unsettled session blocks', () => {
  assert.ok(check([rsvp({ status: 'late_out' })], [session()]));
});

test('an already cancelled (out) row does not block', () => {
  assert.equal(check([rsvp({ status: 'out' })], [session()]), null);
});

test('going on a finalized session with nothing adjusting does not block', () => {
  assert.equal(
    check(
      [rsvp({ paidStatus: 'paid', paidMethod: 'PayNow', feeShare: 10, grossFeeShare: 10 })],
      [session({ feeSplitFinalized: true })]
    ),
    null
  );
});

test('RSVPs of other players or clubs are ignored', () => {
  assert.equal(
    check([rsvp({ playerId: 'p2' }), rsvp({ id: 'r2', clubId: 'c2' })], [session()]),
    null
  );
});

test('a paid share that was later raised blocks as extra due', () => {
  const msg = check(
    [rsvp({ paidStatus: 'paid', paidMethod: 'PayNow', feeShare: 10, grossFeeShare: 15 })],
    [session({ feeSplitFinalized: true })]
  );
  assert.match(msg ?? '', /\$5\.00 more is due/);
});

test('a paid share that was later lowered blocks as refund owed', () => {
  const msg = check(
    [rsvp({ paidStatus: 'paid', paidMethod: 'PayNow', feeShare: 10, grossFeeShare: 6 })],
    [session({ feeSplitFinalized: true })]
  );
  assert.match(msg ?? '', /owes you a \$4\.00 refund/);
});
