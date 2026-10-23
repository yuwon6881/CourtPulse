import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppNotificationItem,
  NOTIFICATION_MAX_AGE_MS,
  evaluateClubAndSessionNotifications,
  formatRelativeTime,
  pruneNotificationFeed,
} from './notificationLogic';
import { Club, Player, Session, SessionRsvp } from '../types';

const club: Club = {
  id: 'club_1',
  name: 'Bintang Prime BC',
  description: 'Test club',
  freeCancelHours: 24,
  lockCancelHours: 4,
  lateCancelFeePercent: 50,
  noShowFeePercent: 100,
  paymentInfo: 'PayNow 91234567',
  clubOwnerPlayerId: 'player_owner',
  ownerId: 'uid_owner',
  timezone: 'Asia/Singapore',
  currency: 'SGD',
};

const ownerPlayer: Player = {
  id: 'player_owner',
  name: 'Alex Chen',
  playerTag: 'alex#101',
  joinedClubIdsCsv: 'club_1',
  wins: 0,
  losses: 0,
  gamesPlayed: 0,
  pointsScored: 0,
  pointsConceded: 0,
  singlesWins: 0,
  singlesLosses: 0,
  doublesWins: 0,
  doublesLosses: 0,
  ratingScore: 1200,
  ownerId: 'uid_owner',
};

const memberPlayer: Player = {
  id: 'player_member',
  name: 'Sarah Jenkins',
  playerTag: 'sarah#202',
  joinedClubIdsCsv: 'club_1',
  wins: 0,
  losses: 0,
  gamesPlayed: 0,
  pointsScored: 0,
  pointsConceded: 0,
  singlesWins: 0,
  singlesLosses: 0,
  doublesWins: 0,
  doublesLosses: 0,
  ratingScore: 1200,
  ownerId: 'uid_member',
};

const upcomingSession: Session = {
  id: 'sess_upcoming',
  clubId: 'club_1',
  title: 'Friday Night Smash',
  venue: 'OCBC Arena',
  courtNumbers: 'Court 1 & 2',
  sessionDate: '2099-12-31',
  startTime: '20:00',
  endTime: '22:00',
  bookingStatus: 'booked',
  courtFee: 40,
  shuttlesUsed: 0,
  shuttleUnitCost: 3,
  shuttleFee: 0,
  maxPlayers: 12,
  organizerName: 'Alex Chen',
  paymentInfo: 'PayNow',
  feeSplitFinalized: false,
  ownerId: 'uid_owner',
};

test('alerts member when joined club has a new upcoming session they have not joined yet', () => {
  const result = evaluateClubAndSessionNotifications({
    activePlayer: memberPlayer,
    clubs: [club],
    sessions: [upcomingSession],
    rsvps: [],
    activityEvents: [],
    prevSnapshot: null,
    notifiedKeys: new Set(),
    canManageClubById: () => false,
    nowMs: Date.parse('2026-10-22T00:00:00Z'),
  });

  assert.equal(result.pendingToQueue.length, 1);
  assert.equal(result.pendingToQueue[0].category, 'new_unjoined_session');
  assert.match(result.pendingToQueue[0].title, /Bintang Prime BC/);
  assert.match(result.pendingToQueue[0].body, /Friday Night Smash/);
  assert.match(result.pendingToQueue[0].body, /haven't joined yet/);
});

test('alerts member when joined session has fees calculated and finalized, and re-alerts if reopened and re-finalized', () => {
  const finalizedSession: Session = {
    ...upcomingSession,
    bookingStatus: 'completed',
    feeSplitFinalized: true,
    shuttleFee: 20,
  };
  const memberRsvp: SessionRsvp = {
    id: 'rsvp_1',
    clubId: 'club_1',
    sessionId: upcomingSession.id,
    playerId: memberPlayer.id,
    playerName: memberPlayer.name,
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 15,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'uid_member',
  };

  const firstEval = evaluateClubAndSessionNotifications({
    activePlayer: memberPlayer,
    clubs: [club],
    sessions: [finalizedSession],
    rsvps: [memberRsvp],
    activityEvents: [],
    prevSnapshot: null,
    notifiedKeys: new Set(),
    canManageClubById: () => false,
  });

  assert.equal(firstEval.pendingToQueue.length, 1);
  assert.equal(firstEval.pendingToQueue[0].category, 'fees_finalized');
  assert.match(firstEval.pendingToQueue[0].body, /15\.00/);
  assert.equal(firstEval.pendingToQueue[0].openPaymentOnClick, true);

  // Record key as notified
  const storedKeys = new Set(firstEval.notifiedKeys);
  storedKeys.add(firstEval.pendingToQueue[0].dedupKey);

  // Reopen split -> should clear the finalized key so re-finalizing alerts again
  const reopenedEval = evaluateClubAndSessionNotifications({
    activePlayer: memberPlayer,
    clubs: [club],
    sessions: [{ ...finalizedSession, bookingStatus: 'in_play', feeSplitFinalized: false }],
    rsvps: [memberRsvp],
    activityEvents: [],
    prevSnapshot: null,
    notifiedKeys: storedKeys,
    canManageClubById: () => false,
  });

  assert.equal(
    reopenedEval.notifiedKeys.has(firstEval.pendingToQueue[0].dedupKey),
    false
  );
});

test('alerts club owner with player name when a player joins, leaves, or presses the paid button', () => {
  const joinLeavePaidEvents = [
    {
      id: 'act_1',
      type: 'player_joined' as const,
      clubId: 'club_1',
      sessionId: upcomingSession.id,
      sessionTitle: upcomingSession.title,
      playerId: memberPlayer.id,
      playerName: 'Sarah Jenkins',
      guestCount: 1,
      createdAtMs: 1000,
    },
    {
      id: 'act_2',
      type: 'player_left' as const,
      clubId: 'club_1',
      sessionId: upcomingSession.id,
      sessionTitle: upcomingSession.title,
      playerId: memberPlayer.id,
      playerName: 'Sarah Jenkins',
      isLateOut: true,
      penaltyPercent: 50,
      createdAtMs: 2000,
    },
    {
      id: 'act_3',
      type: 'player_paid' as const,
      clubId: 'club_1',
      sessionId: upcomingSession.id,
      sessionTitle: upcomingSession.title,
      playerId: memberPlayer.id,
      playerName: 'Sarah Jenkins',
      amount: 15,
      paidMethod: 'Reported Paid',
      createdAtMs: 3000,
    },
  ];

  const ownerEval = evaluateClubAndSessionNotifications({
    activePlayer: ownerPlayer,
    clubs: [club],
    sessions: [{ ...upcomingSession, feeSplitFinalized: true, bookingStatus: 'completed' }],
    rsvps: [
      {
        id: 'rsvp_1',
        clubId: 'club_1',
        sessionId: upcomingSession.id,
        playerId: memberPlayer.id,
        playerName: 'Sarah Jenkins',
        status: 'going',
        attendanceOutcome: 'present',
        penaltyPercentApplied: 100,
        feeShare: 15,
        paidStatus: 'pending_approval',
        paidMethod: 'Reported Paid',
        ownerId: 'uid_member',
      },
    ],
    activityEvents: joinLeavePaidEvents,
    prevSnapshot: null,
    notifiedKeys: new Set(),
    canManageClubById: (id) => id === 'club_1',
  });

  const joinedAlert = ownerEval.pendingToQueue.find(
    (n) => n.category === 'owner_player_joined'
  );
  const leftAlert = ownerEval.pendingToQueue.find(
    (n) => n.category === 'owner_player_left'
  );
  const paidAlert = ownerEval.pendingToQueue.filter(
    (n) => n.category === 'owner_player_paid'
  );

  assert.ok(joinedAlert);
  assert.match(joinedAlert.title, /Sarah Jenkins Joined Session/);
  assert.match(joinedAlert.body, /Sarah Jenkins \(\+1 guest\)/);

  assert.ok(leftAlert);
  assert.match(leftAlert.title, /Sarah Jenkins Left Session/);
  assert.match(leftAlert.body, /50% fee applies/);

  // Paid alert should not be duplicated between activityEvents and pending_approval RSVP scan
  assert.equal(paidAlert.length, 1);
  assert.match(paidAlert[0].title, /Sarah Jenkins Pressed Paid/);
  assert.match(paidAlert[0].body, /Sarah Jenkins marked/);
});

test('does not alert a club owner about their own join, leave or payment', () => {
  const ownRsvp: SessionRsvp = {
    id: 'rsvp_owner',
    clubId: 'club_1',
    sessionId: upcomingSession.id,
    playerId: ownerPlayer.id,
    playerName: ownerPlayer.name,
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 15,
    paidStatus: 'pending_approval',
    paidMethod: 'Reported Paid',
    ownerId: 'uid_owner',
  };

  const result = evaluateClubAndSessionNotifications({
    activePlayer: ownerPlayer,
    clubs: [club],
    sessions: [upcomingSession],
    rsvps: [ownRsvp],
    activityEvents: [
      {
        id: 'act_self',
        type: 'player_joined',
        clubId: 'club_1',
        sessionId: upcomingSession.id,
        sessionTitle: upcomingSession.title,
        playerId: ownerPlayer.id,
        playerName: ownerPlayer.name,
        createdAtMs: 1000,
      },
    ],
    prevSnapshot: {},
    notifiedKeys: new Set(),
    canManageClubById: (id) => id === 'club_1',
  });

  assert.equal(
    result.pendingToQueue.filter((n) => n.category.startsWith('owner_')).length,
    0
  );
  // The baseline still records the RSVP so later changes by others are diffed correctly.
  assert.ok(result.nextSnapshot[ownRsvp.id]);
});

// ---------------------------------------------------------------------------------------------
// Repeated actions, guest changes, session full, and member alerts about host changes
// ---------------------------------------------------------------------------------------------

const rsvpAt = (
  status: SessionRsvp['status'],
  updatedAtMs: number,
  over: Partial<SessionRsvp> = {}
): SessionRsvp => ({
  id: 'rsvp_m',
  clubId: 'club_1',
  sessionId: upcomingSession.id,
  playerId: memberPlayer.id,
  playerName: 'Sarah Jenkins',
  guestCount: 0,
  status,
  attendanceOutcome: 'present',
  penaltyPercentApplied: 0,
  feeShare: 0,
  paidStatus: 'unpaid',
  paidMethod: 'pending',
  ownerId: 'uid_member',
  updatedAt: updatedAtMs,
  ...over,
});

// Replays what the app does: evaluate, remember the snapshot, drop alerts already shown
function makeReplay(viewer: Player, canManage: boolean, session: Session = upcomingSession) {
  let snapshot: ReturnType<typeof evaluateClubAndSessionNotifications>['nextSnapshot'] | null =
    null;
  let keys = new Set<string>();
  return (rsvps: SessionRsvp[], sessionOverride?: Session) => {
    const out = evaluateClubAndSessionNotifications({
      activePlayer: viewer,
      clubs: [club],
      sessions: [sessionOverride ?? session],
      rsvps,
      activityEvents: [],
      prevSnapshot: snapshot,
      notifiedKeys: keys,
      canManageClubById: () => canManage,
      nowMs: Date.parse('2026-10-22T00:00:00Z'),
    });
    snapshot = out.nextSnapshot;
    keys = new Set(out.notifiedKeys);
    const shown: string[] = [];
    out.pendingToQueue.forEach((p) => {
      // "new unjoined session" alerts are covered by their own tests above
      if (p.category === 'new_unjoined_session') return;
      if (keys.has(p.dedupKey)) return;
      keys.add(p.dedupKey);
      shown.push(`${p.category}: ${p.title}`);
    });
    return shown;
  };
}

test('owner is told about EVERY join and leave, not only the first of each', () => {
  const step = makeReplay(ownerPlayer, true);
  assert.deepEqual(step([]), []);
  assert.deepEqual(step([rsvpAt('going', 1000)]), ['owner_player_joined: Sarah Jenkins Joined Session']);
  assert.deepEqual(step([rsvpAt('out', 2000)]), ['owner_player_left: Sarah Jenkins Left Session']);
  assert.deepEqual(step([rsvpAt('going', 3000)]), ['owner_player_joined: Sarah Jenkins Joined Session']);
  assert.deepEqual(step([rsvpAt('out', 4000)]), ['owner_player_left: Sarah Jenkins Left Session']);
});

test('the same change seen twice (two tabs, or a re-render) is only announced once', () => {
  const step = makeReplay(ownerPlayer, true);
  step([]);
  assert.equal(step([rsvpAt('going', 1000)]).length, 1);
  assert.equal(step([rsvpAt('going', 1000)]).length, 0);
});

test('a guest being added or removed is not reported as a new join', () => {
  const step = makeReplay(ownerPlayer, true);
  step([]);
  step([rsvpAt('going', 1000)]);
  assert.deepEqual(step([rsvpAt('going', 2000, { guestCount: 1 })]), [
    'owner_guest_changed: Sarah Jenkins Added 1 Guest',
  ]);
  assert.deepEqual(step([rsvpAt('going', 3000, { guestCount: 0 })]), [
    'owner_guest_changed: Sarah Jenkins Removed 1 Guest',
  ]);
});

test('a late leave tells the owner about the fee, even when seen for the first time', () => {
  const step = makeReplay(ownerPlayer, true);
  step([]);
  const result = evaluateClubAndSessionNotifications({
    activePlayer: ownerPlayer,
    clubs: [club],
    sessions: [upcomingSession],
    rsvps: [rsvpAt('late_out', 1000, { penaltyPercentApplied: 50 })],
    activityEvents: [],
    prevSnapshot: {
      '__evaluated_club__:club_1': {
        status: 'going', guestCount: 0, paidStatus: 'unpaid', paidMethod: '', feeShare: 0,
        playerName: '', playerId: '', sessionId: '', clubId: 'club_1',
      },
    },
    notifiedKeys: new Set(),
    canManageClubById: () => true,
  });
  const left = result.pendingToQueue.find((p) => p.category === 'owner_player_left');
  assert.match(left?.body ?? '', /50% fee applies/);
});

test('owner is told when a session reaches its player limit', () => {
  const tiny = { ...upcomingSession, maxPlayers: 2 };
  const step = makeReplay(ownerPlayer, true, tiny);
  step([]);
  const joined = step([rsvpAt('going', 1000, { guestCount: 1 })]);
  assert.ok(joined.some((m) => m.startsWith('owner_session_full')), joined.join(' | '));
  // Still full on the next evaluation: no repeat
  assert.equal(step([rsvpAt('going', 1000, { guestCount: 1 })]).length, 0);
});

test('the owner is not told about their own join or about a session they filled themselves', () => {
  const tiny = { ...upcomingSession, maxPlayers: 1 };
  const step = makeReplay(ownerPlayer, true, tiny);
  step([]);
  const own = rsvpAt('going', 1000, { playerId: ownerPlayer.id, playerName: 'Alex Chen' });
  assert.deepEqual(step([own]), []);
});

test('member is told when the host confirms or rejects a reported payment', () => {
  const finalized = { ...upcomingSession, bookingStatus: 'completed' as const, feeSplitFinalized: true };
  const step = makeReplay(memberPlayer, false, finalized);
  step([rsvpAt('going', 1000, { feeShare: 15, paidStatus: 'pending_approval', paidMethod: 'PayNow' })]);
  const confirmed = step([rsvpAt('going', 2000, { feeShare: 15, paidStatus: 'paid', paidMethod: 'Received' })]);
  assert.deepEqual(confirmed.filter((m) => m.startsWith('member_payment')), [
    'member_payment_update: Payment Confirmed · Friday Night Smash',
  ]);

  const step2 = makeReplay(memberPlayer, false, finalized);
  step2([rsvpAt('going', 1000, { feeShare: 15, paidStatus: 'pending_approval', paidMethod: 'PayNow' })]);
  const rejected = step2([rsvpAt('going', 2000, { feeShare: 15, paidStatus: 'unpaid', paidMethod: 'Rejected' })]);
  assert.ok(rejected.some((m) => m.includes('Payment Not Received')), rejected.join(' | '));
});

test('finalizing a split that a pass or credit covers is one alert, not two', () => {
  const open = { ...upcomingSession, bookingStatus: 'in_play' as const };
  const finalized = { ...upcomingSession, bookingStatus: 'completed' as const, feeSplitFinalized: true };
  const step = makeReplay(memberPlayer, false, open);
  step([rsvpAt('going', 1000)]);
  const out = step([rsvpAt('going', 2000, { paidStatus: 'paid', paidMethod: 'Free Session Pass' })], finalized);
  assert.equal(out.filter((m) => m.startsWith('member_payment')).length, 0);
  assert.equal(out.filter((m) => m.startsWith('fees_finalized')).length, 1);
});

test('the host marking a finalized fee received or waived is announced', () => {
  const finalized = { ...upcomingSession, bookingStatus: 'completed' as const, feeSplitFinalized: true };
  const step = makeReplay(memberPlayer, false, finalized);
  step([rsvpAt('going', 1000, { feeShare: 15 })]);
  const out = step([rsvpAt('going', 2000, { feeShare: 0, paidStatus: 'paid', paidMethod: 'Fee Waived' })]);
  assert.ok(out.some((m) => m.includes('Fee Waived')), out.join(' | '));
});

test('member is told when the courts get booked or the time or venue changes', () => {
  const proposed = { ...upcomingSession, bookingStatus: 'pending' as const };
  const step = makeReplay(memberPlayer, false, proposed);
  step([rsvpAt('going', 1000)]);
  const booked = step([rsvpAt('going', 1000)], { ...proposed, bookingStatus: 'booked', courtNumbers: 'Court 3' });
  assert.ok(booked.some((m) => m.startsWith('member_session_update')), booked.join(' | '));
  const moved = step([rsvpAt('going', 1000)], {
    ...proposed, bookingStatus: 'booked', courtNumbers: 'Court 3', startTime: '19:00',
  });
  assert.ok(moved.some((m) => m.startsWith('member_session_update')), moved.join(' | '));
});

test('a session the member has not joined, or has left, does not send update alerts', () => {
  const proposed = { ...upcomingSession, bookingStatus: 'pending' as const };
  const step = makeReplay(memberPlayer, false, proposed);
  step([rsvpAt('out', 1000)]);
  const out = step([rsvpAt('out', 1000)], { ...proposed, bookingStatus: 'booked' });
  assert.equal(out.filter((m) => m.startsWith('member_session_update')).length, 0);
});

test('a member whose share changed after paying is told what is due or refundable', () => {
  const finalized = { ...upcomingSession, bookingStatus: 'completed' as const, feeSplitFinalized: true };
  const step = makeReplay(memberPlayer, false, finalized);
  const out = step([
    rsvpAt('going', 1000, {
      feeShare: 10, grossFeeShare: 15, paidStatus: 'paid', paidMethod: 'Received',
      walletCreditApplied: 0,
    }),
  ]);
  assert.ok(out.some((m) => m.startsWith('member_share_adjusted')), out.join(' | '));
});

test('the first evaluation never floods alerts about changes it cannot know about', () => {
  const finalized = { ...upcomingSession, bookingStatus: 'completed' as const, feeSplitFinalized: true };
  const step = makeReplay(memberPlayer, false, finalized);
  const out = step([rsvpAt('going', 1000, { feeShare: 15, paidStatus: 'paid', paidMethod: 'Received' })]);
  assert.equal(out.filter((m) => m.startsWith('member_payment') || m.startsWith('member_session')).length, 0);
});

test('a same-browser guest change is announced as a guest change, once per action', () => {
  const run = (keys: Set<string>, id: string, guestCount: number, previousGuestCount: number) =>
    evaluateClubAndSessionNotifications({
      activePlayer: ownerPlayer,
      clubs: [club],
      sessions: [upcomingSession],
      rsvps: [],
      activityEvents: [
        {
          id, type: 'guests_changed', clubId: 'club_1', sessionId: upcomingSession.id,
          sessionTitle: upcomingSession.title, playerId: memberPlayer.id, playerName: 'Sarah Jenkins',
          guestCount, previousGuestCount, createdAtMs: 1,
        },
      ],
      prevSnapshot: null,
      notifiedKeys: keys,
      canManageClubById: () => true,
    });
  const added = run(new Set(), 'act_a', 2, 1).pendingToQueue.find((p) => p.category === 'owner_guest_changed');
  assert.match(added?.title ?? '', /Added 1 Guest/);
  const removed = run(new Set(), 'act_b', 0, 1).pendingToQueue.find((p) => p.category === 'owner_guest_changed');
  assert.match(removed?.title ?? '', /Removed 1 Guest/);
  assert.notEqual(added?.dedupKey, removed?.dedupKey);
});

// ---------------------------------------------------------------------------------------------
// Feed housekeeping
// ---------------------------------------------------------------------------------------------

const NOW = Date.parse('2026-10-22T00:00:00Z');
const feedItem = (over: Partial<AppNotificationItem> = {}): AppNotificationItem => ({
  id: 'n1',
  dedupKey: 'k1',
  category: 'owner_player_joined',
  title: 't',
  body: 'b',
  clubId: 'club_1',
  sessionId: upcomingSession.id,
  createdAtMs: NOW - 60_000,
  read: false,
  ...over,
});
const pruneCtx = (over: Partial<Parameters<typeof pruneNotificationFeed>[1]> = {}) => ({
  sessions: [upcomingSession],
  rsvps: [] as SessionRsvp[],
  clubs: [club],
  activePlayerId: memberPlayer.id,
  nowMs: NOW,
  ...over,
});

test('recent alerts about an existing session are kept, as the very same array', () => {
  const items = [feedItem()];
  assert.equal(pruneNotificationFeed(items, pruneCtx()), items);
});

test('alerts older than the retention period are dropped', () => {
  const items = [
    feedItem({ id: 'old', createdAtMs: NOW - NOTIFICATION_MAX_AGE_MS - 1 }),
    feedItem({ id: 'new' }),
  ];
  assert.deepEqual(pruneNotificationFeed(items, pruneCtx()).map((i) => i.id), ['new']);
});

test('alerts about a session that no longer exists are dropped', () => {
  const items = [feedItem({ sessionId: 'deleted' }), feedItem({ id: 'kept' })];
  assert.deepEqual(pruneNotificationFeed(items, pruneCtx()).map((i) => i.id), ['kept']);
});

test('"you have not joined yet" alerts go away once you have an RSVP, or the session is over', () => {
  const unjoined = feedItem({ category: 'new_unjoined_session' });
  assert.equal(pruneNotificationFeed([unjoined], pruneCtx()).length, 1);
  assert.equal(
    pruneNotificationFeed([unjoined], pruneCtx({ rsvps: [rsvpAt('going', 1)] })).length,
    0
  );
  assert.equal(
    pruneNotificationFeed(
      [unjoined],
      pruneCtx({ sessions: [{ ...upcomingSession, feeSplitFinalized: true }] })
    ).length,
    0
  );
  assert.equal(
    pruneNotificationFeed(
      [unjoined],
      pruneCtx({ sessions: [{ ...upcomingSession, sessionDate: '2026-10-01' }] })
    ).length,
    0
  );
});

test('other alert types about an open session stay even after you join (they are history)', () => {
  const fees = feedItem({ category: 'fees_finalized' });
  assert.equal(pruneNotificationFeed([fees], pruneCtx({ rsvps: [rsvpAt('going', 1)] })).length, 1);
});

test('relative time reads naturally', () => {
  assert.equal(formatRelativeTime(NOW - 10_000, NOW), 'just now');
  assert.equal(formatRelativeTime(NOW - 5 * 60_000, NOW), '5m ago');
  assert.equal(formatRelativeTime(NOW - 3 * 3600_000, NOW), '3h ago');
  assert.equal(formatRelativeTime(NOW - 2 * 86400_000, NOW), '2d ago');
  assert.equal(formatRelativeTime(NOW + 5_000, NOW), 'just now');
});
