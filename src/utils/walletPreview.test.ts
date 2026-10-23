import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countEarlierQueuedSessions,
  describeWalletPaidMethod,
  previewWalletCoverage,
} from './walletPreview.ts';
import type { PlayerBenefitWallet, Session, SessionRsvp } from '../types';

const wallet = (over: Partial<PlayerBenefitWallet> = {}): PlayerBenefitWallet => ({
  creditBalance: 0,
  freeSessionPasses: 0,
  waiveAllFees: false,
  ...over,
});

test('no benefits: the player pays the whole share', () => {
  const c = previewWalletCoverage({ gross: 30, wallet: wallet() });
  assert.equal(c.kind, 'none');
  assert.equal(c.youPay, 30);
});

test('a free pass covers the whole share', () => {
  const c = previewWalletCoverage({ gross: 30, wallet: wallet({ freeSessionPasses: 1 }) });
  assert.equal(c.kind, 'pass');
  assert.equal(c.youPay, 0);
});

test('a pass wins over credit, like the real finalize order', () => {
  const c = previewWalletCoverage({
    gross: 30,
    wallet: wallet({ freeSessionPasses: 1, creditBalance: 100 }),
  });
  assert.equal(c.kind, 'pass');
  assert.equal(c.creditUsed, 0);
});

test('a waiver beats everything and works even before a share exists', () => {
  const c = previewWalletCoverage({ gross: 0, wallet: wallet({ waiveAllFees: true }) });
  assert.equal(c.kind, 'waiver');
  assert.equal(c.youPay, 0);
});

test('credit larger than the share covers it fully', () => {
  const c = previewWalletCoverage({ gross: 30, wallet: wallet({ creditBalance: 50 }) });
  assert.equal(c.kind, 'credit_full');
  assert.equal(c.creditUsed, 30);
  assert.equal(c.youPay, 0);
});

test('credit smaller than the share leaves a remainder', () => {
  const c = previewWalletCoverage({ gross: 30, wallet: wallet({ creditBalance: 12.5 }) });
  assert.equal(c.kind, 'credit_partial');
  assert.equal(c.creditUsed, 12.5);
  assert.equal(c.youPay, 17.5);
});

test('one pass is spent on the earlier session, so this one is not covered by it', () => {
  const c = previewWalletCoverage({
    gross: 30,
    wallet: wallet({ freeSessionPasses: 1 }),
    earlierQueued: 1,
  });
  assert.equal(c.kind, 'none');
  assert.equal(c.youPay, 30);
});

test('two passes cover two earlier sessions and this one is still covered by the third', () => {
  const c = previewWalletCoverage({
    gross: 30,
    wallet: wallet({ freeSessionPasses: 3 }),
    earlierQueued: 2,
  });
  assert.equal(c.kind, 'pass');
});

test('credit is not promised when earlier sessions without a pass draw on it first', () => {
  const c = previewWalletCoverage({
    gross: 30,
    wallet: wallet({ creditBalance: 20 }),
    earlierQueued: 1,
  });
  assert.equal(c.kind, 'none');
  assert.equal(c.creditShared, true);
  assert.equal(c.youPay, 30);
});

test('a zero share is never "covered"', () => {
  const c = previewWalletCoverage({ gross: 0, wallet: wallet({ freeSessionPasses: 1 }) });
  assert.equal(c.kind, 'none');
});

const session = (id: string, date: string, over: Partial<Session> = {}): Session =>
  ({
    id,
    clubId: 'c1',
    sessionDate: date,
    startTime: '20:00',
    feeSplitFinalized: false,
    ...over,
  }) as Session;
const rsvp = (sessionId: string, over: Partial<SessionRsvp> = {}): SessionRsvp =>
  ({
    id: `r-${sessionId}`,
    clubId: 'c1',
    sessionId,
    playerId: 'p1',
    status: 'going',
    penaltyPercentApplied: 0,
    ...over,
  }) as SessionRsvp;

test('counts only earlier, open, chargeable sessions of the same club', () => {
  const sessions = [
    session('early', '2026-11-01'),
    session('now', '2026-11-08'),
    session('later', '2026-11-15'),
    session('done', '2026-10-25', { feeSplitFinalized: true }),
    session('other-club', '2026-10-30', { clubId: 'c2' }),
    session('cancelled', '2026-10-28'),
  ];
  const rsvps = [
    rsvp('early'),
    rsvp('later'),
    rsvp('done'),
    rsvp('other-club', { clubId: 'c2' }),
    rsvp('cancelled', { status: 'out' }),
  ];
  const n = countEarlierQueuedSessions({
    session: sessions[1],
    sessions,
    rsvps,
    playerId: 'p1',
  });
  assert.equal(n, 1);
});

test('a late cancel with a fee counts, one without does not', () => {
  const sessions = [
    session('a', '2026-11-01'),
    session('b', '2026-11-02'),
    session('now', '2026-11-08'),
  ];
  const rsvps = [
    rsvp('a', { status: 'late_out', penaltyPercentApplied: 50 }),
    rsvp('b', { status: 'late_out', penaltyPercentApplied: 0 }),
  ];
  assert.equal(
    countEarlierQueuedSessions({ session: sessions[2], sessions, rsvps, playerId: 'p1' }),
    1
  );
});

test('stored credit labels are shown in the club currency', () => {
  const fmt = (n: number) => `RM${n.toFixed(2)}`;
  assert.equal(describeWalletPaidMethod('Credit ($30.00)', fmt), 'Credit used (RM30.00)');
  assert.equal(describeWalletPaidMethod('Credit -$12.50', fmt), 'RM12.50 credit applied');
  assert.equal(describeWalletPaidMethod('Free Session Pass', fmt), 'Free Session Pass');
});

test('with a +1 guest a pass covers only the player and the guest share is still due', () => {
  const c = previewWalletCoverage({
    gross: 30,
    guestCount: 1,
    wallet: wallet({ freeSessionPasses: 1 }),
  });
  assert.equal(c.kind, 'pass_guest');
  assert.equal(c.youPay, 15);
  assert.equal(c.guestShare, 15);
});

test('credit meets the guest share after the pass, in full or in part', () => {
  const full = previewWalletCoverage({
    gross: 30,
    guestCount: 1,
    wallet: wallet({ freeSessionPasses: 1, creditBalance: 20 }),
  });
  assert.equal(full.kind, 'pass');
  assert.equal(full.youPay, 0);
  assert.equal(full.creditUsed, 15);
  const part = previewWalletCoverage({
    gross: 30,
    guestCount: 1,
    wallet: wallet({ freeSessionPasses: 1, creditBalance: 10 }),
  });
  assert.equal(part.kind, 'pass_guest');
  assert.equal(part.youPay, 5);
});

test('a VIP waiver still covers guests too', () => {
  const c = previewWalletCoverage({
    gross: 30,
    guestCount: 2,
    wallet: wallet({ waiveAllFees: true }),
  });
  assert.equal(c.youPay, 0);
});
