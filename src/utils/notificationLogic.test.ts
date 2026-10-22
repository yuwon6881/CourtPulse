import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClubAndSessionNotifications } from './notificationLogic';
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
