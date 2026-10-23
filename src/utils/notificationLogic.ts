import { Club, Player, Session, SessionRsvp } from '../types';
import {
  formatClubCurrency,
  getRsvpAdjustment,
  getRsvpGuestCount,
  getRsvpPartySize,
  hasPlayerJoinedClub,
  isSessionCompletedOrPast,
} from './badmintonLogic';
import { resolveClubTimeZone, toEpochMs } from './clubTime';

export type NotificationCategory =
  | 'new_unjoined_session'
  | 'fees_finalized'
  | 'owner_player_joined'
  | 'owner_player_left'
  | 'owner_player_paid'
  | 'owner_guest_changed'
  | 'owner_session_full'
  | 'member_payment_update'
  | 'member_session_update'
  | 'member_share_adjusted';

export interface AppNotificationItem {
  id: string;
  dedupKey: string;
  category: NotificationCategory;
  title: string;
  body: string;
  playerName?: string;
  clubId: string;
  sessionId: string;
  createdAtMs: number;
  read: boolean;
  openPaymentOnClick?: boolean;
}

export interface ClubActivityNotificationEvent {
  id: string;
  type: 'player_joined' | 'player_left' | 'player_paid' | 'guests_changed';
  clubId: string;
  sessionId: string;
  sessionTitle: string;
  playerId: string;
  playerName: string;
  actorPlayerId?: string;
  guestCount?: number;
  /** For 'guests_changed': how many guests there were before the change. */
  previousGuestCount?: number;
  isLateOut?: boolean;
  penaltyPercent?: number;
  amount?: number;
  paidMethod?: string;
  createdAtMs: number;
}

export interface RsvpSnapshotEntry {
  status: SessionRsvp['status'];
  guestCount: number;
  paidStatus: SessionRsvp['paidStatus'];
  paidMethod: string;
  feeShare: number;
  playerName: string;
  playerId: string;
  sessionId: string;
  clubId: string;
  // Session entries (key `__session__:<id>`) remember what a member last saw of the session
  sessionFinalized?: boolean;
  bookingStatus?: Session['bookingStatus'];
  sessionDate?: string;
  startTime?: string;
  endTime?: string;
  venue?: string;
  courtNumbers?: string;
}

const EVALUATED_CLUB_PREFIX = '__evaluated_club__:';
const MINE_PREFIX = '__mine__:';
const SESSION_PREFIX = '__session__:';
const isSpecialSnapshotKey = (key: string) =>
  key.startsWith(EVALUATED_CLUB_PREFIX) ||
  key.startsWith(MINE_PREFIX) ||
  key.startsWith(SESSION_PREFIX);

export interface EvaluateNotificationsInput {
  activePlayer: Player;
  clubs: Club[];
  sessions: Session[];
  rsvps: SessionRsvp[];
  activityEvents: ClubActivityNotificationEvent[];
  prevSnapshot: Record<string, RsvpSnapshotEntry> | null;
  notifiedKeys: Set<string>;
  canManageClubById: (clubId: string) => boolean;
  nowMs?: number;
  prevEvaluatedClubIds?: Set<string> | readonly string[];
}

export interface EvaluateNotificationsOutput {
  pendingToQueue: Omit<AppNotificationItem, 'id' | 'createdAtMs' | 'read'>[];
  nextSnapshot: Record<string, RsvpSnapshotEntry>;
  notifiedKeys: Set<string>;
  keysMutated: boolean;
}

/**
 * Pure evaluator for member & club owner notifications:
 * 1. Member alert: Joined club has a new upcoming session that the user hasn't joined yet
 * 2. Member alert: Joined session has its fees calculated and finalized
 * 3. Club Owner alert: Player joined a session (includes playerName)
 * 4. Club Owner alert: Player left a session (includes playerName)
 * 5. Club Owner alert: Player pressed the Paid button (includes playerName)
 */
export function evaluateClubAndSessionNotifications(
  input: EvaluateNotificationsInput
): EvaluateNotificationsOutput {
  const {
    activePlayer,
    clubs,
    sessions,
    rsvps,
    activityEvents,
    prevSnapshot,
    canManageClubById,
    nowMs = Date.now(),
  } = input;

  const keys = new Set<string>(input.notifiedKeys);
  let keysMutated = false;

  // Identifies ONE occurrence of a change (this join, this leave), so the same player joining
  // and leaving the same session again later is a new alert. The server's updatedAt is the same
  // on every tab and device; without it the time of detection is the best available stamp.
  const stampFor = (r: SessionRsvp): string =>
    String(toEpochMs(r.updatedAt) ?? nowMs);

  const removeKeysByPrefix = (prefix: string) => {
    Array.from(keys).forEach((k) => {
      if (k.startsWith(prefix)) {
        keys.delete(k);
        keysMutated = true;
      }
    });
  };

  const clubById = new Map<string, Club>();
  clubs.forEach((c) => clubById.set(c.id, c));

  const sessionById = new Map<string, Session>();
  sessions.forEach((s) => sessionById.set(s.id, s));

  const rsvpsBySessionId = new Map<string, SessionRsvp[]>();
  rsvps.forEach((r) => {
    const list = rsvpsBySessionId.get(r.sessionId) || [];
    list.push(r);
    rsvpsBySessionId.set(r.sessionId, list);
  });

  const pendingToQueue: Omit<
    AppNotificationItem,
    'id' | 'createdAtMs' | 'read'
  >[] = [];

  // -------------------------------------------------------------------------
  // 1. MEMBER ALERTS:
  //    (a) New session in a joined club that the user hasn't joined yet
  //    (b) Session the user joined has fees calculated and finalized
  // -------------------------------------------------------------------------
  sessions.forEach((session) => {
    const club = clubById.get(session.clubId);
    if (!club) return;

    const isMember =
      hasPlayerJoinedClub(activePlayer, club.id) ||
      club.clubOwnerPlayerId === activePlayer.id;
    if (!isMember) return;

    const sessionRsvps = rsvpsBySessionId.get(session.id) || [];
    const myRsvp = sessionRsvps.find((r) => r.playerId === activePlayer.id);
    const clubZone = resolveClubTimeZone(club.timezone);
    const isEnded = isSessionCompletedOrPast(session, nowMs, clubZone);

    // If a session's fee split was reopened (not finalized), clear prior finalized keys
    // so the user will be alerted again when it is re-finalized.
    if (!session.feeSplitFinalized) {
      removeKeysByPrefix(`member_fees_finalized:${session.id}:`);
    }

    // (a) Unjoined upcoming session in joined club
    if (
      !session.feeSplitFinalized &&
      session.bookingStatus !== 'completed' &&
      !isEnded &&
      !myRsvp
    ) {
      pendingToQueue.push({
        dedupKey: `member_new_unjoined_session:${session.id}`,
        category: 'new_unjoined_session',
        title: `New Session · ${club.name}`,
        body: `${session.title} on ${session.sessionDate} (${session.startTime}–${session.endTime} at ${session.venue}) — You haven't joined yet.`,
        clubId: club.id,
        sessionId: session.id,
        openPaymentOnClick: false,
      });
    }

    // (b) Joined session has fees calculated & finalized
    if (
      session.feeSplitFinalized &&
      myRsvp &&
      (myRsvp.status === 'going' ||
        (myRsvp.status === 'late_out' && myRsvp.feeShare > 0))
    ) {
      const formattedShare = formatClubCurrency(myRsvp.feeShare, club);
      const shareSummary =
        myRsvp.feeShare > 0 && myRsvp.paidStatus === 'unpaid'
          ? `Your finalized fee share is ${formattedShare}. Tap to view & settle.`
          : myRsvp.paidStatus === 'paid'
          ? `Your share (${formattedShare}) is settled (${myRsvp.paidMethod}).`
          : `Final fee split is ready (${formattedShare}).`;

      pendingToQueue.push({
        dedupKey: `member_fees_finalized:${session.id}:${myRsvp.feeShare.toFixed(2)}`,
        category: 'fees_finalized',
        title: `Session Fees Finalized · ${session.title}`,
        body: `${club.name}: Fees for ${session.title} (${session.sessionDate}) are calculated and finalized. ${shareSummary}`,
        clubId: club.id,
        sessionId: session.id,
        openPaymentOnClick: myRsvp.feeShare > 0 && myRsvp.paidStatus === 'unpaid',
      });
    }
  });

  // -------------------------------------------------------------------------
  // 2. CLUB OWNER ALERTS:
  //    Alert the club owner whenever:
  //    - A player has joined a session (displaying player name)
  //    - A player has left a session (displaying player name)
  //    - Any user has pressed the Paid button (displaying player name)
  // -------------------------------------------------------------------------
  const isOwnerOrManagerOfClub = (clubId: string): boolean => {
    const club = clubById.get(clubId);
    if (!club) return false;
    return (
      club.clubOwnerPlayerId === activePlayer.id || canManageClubById(clubId)
    );
  };

  // 2A. Explicit activity events recorded from user actions
  const queuedInThisPass = new Set<string>();

  activityEvents.forEach((ev) => {
    if (!isOwnerOrManagerOfClub(ev.clubId)) return;
    const evProcessedKey = `act_ev:${ev.id}`;
    if (keys.has(evProcessedKey)) return;
    keys.add(evProcessedKey);
    keysMutated = true;
    // Never alert someone about their own action.
    if (ev.playerId === activePlayer.id) return;
    if (ev.actorPlayerId && ev.actorPlayerId === activePlayer.id) return;

    const club = clubById.get(ev.clubId);
    const clubName = club?.name || 'Club';

    if (ev.type === 'player_joined') {
      const guestCount = ev.guestCount || 0;
      const guestSuffix =
        guestCount > 0
          ? ` (+${guestCount} guest${guestCount > 1 ? 's' : ''})`
          : '';
      queuedInThisPass.add(`join:${ev.sessionId}:${ev.playerId}`);
      pendingToQueue.push({
        dedupKey: `owner_ev_joined:${ev.id}`,
        category: 'owner_player_joined',
        title: `${ev.playerName} Joined Session`,
        body: `${ev.playerName}${guestSuffix} joined "${ev.sessionTitle}" (${clubName}).`,
        playerName: ev.playerName,
        clubId: ev.clubId,
        sessionId: ev.sessionId,
      });
    } else if (ev.type === 'guests_changed') {
      const now = ev.guestCount || 0;
      const before = ev.previousGuestCount ?? 0;
      if (now === before) return;
      const added = now > before;
      const delta = Math.abs(now - before);
      queuedInThisPass.add(`join:${ev.sessionId}:${ev.playerId}`);
      pendingToQueue.push({
        dedupKey: `owner_ev_guests:${ev.id}`,
        category: 'owner_guest_changed',
        title: `${ev.playerName} ${added ? 'Added' : 'Removed'} ${delta} Guest${delta > 1 ? 's' : ''}`,
        body: `${ev.playerName} ${added ? 'added' : 'removed'} ${delta} guest${delta > 1 ? 's' : ''} for "${ev.sessionTitle}" (${clubName}). Now bringing ${now}.`,
        playerName: ev.playerName,
        clubId: ev.clubId,
        sessionId: ev.sessionId,
      });
    } else if (ev.type === 'player_left') {
      const lateNote = ev.isLateOut
        ? ` (Late withdrawal · ${ev.penaltyPercent ?? 0}% fee applies)`
        : '';
      queuedInThisPass.add(`leave:${ev.sessionId}:${ev.playerId}`);
      pendingToQueue.push({
        dedupKey: `owner_ev_left:${ev.id}`,
        category: 'owner_player_left',
        title: `${ev.playerName} Left Session`,
        body: `${ev.playerName} left "${ev.sessionTitle}" (${clubName})${lateNote}.`,
        playerName: ev.playerName,
        clubId: ev.clubId,
        sessionId: ev.sessionId,
      });
    } else if (ev.type === 'player_paid') {
      const amt = ev.amount || 0;
      const formattedAmt = club
        ? formatClubCurrency(amt, club)
        : `$${amt.toFixed(2)}`;
      queuedInThisPass.add(`paid:${ev.sessionId}:${ev.playerId}`);
      keys.add(
        `owner_pending_paid:${ev.sessionId}:${ev.playerId}:${amt.toFixed(2)}`
      );
      pendingToQueue.push({
        dedupKey: `owner_ev_paid:${ev.id}`,
        category: 'owner_player_paid',
        title: `${ev.playerName} Pressed Paid (${formattedAmt})`,
        body: `${ev.playerName} marked ${formattedAmt} as paid (${ev.paidMethod || 'Reported Paid'}) for "${ev.sessionTitle}" (${clubName}). Tap to verify receipt.`,
        playerName: ev.playerName,
        clubId: ev.clubId,
        sessionId: ev.sessionId,
      });
    }
  });

  // 2B. Live Firestore Snapshot Diffing on `rsvps` + Pending Approval scan for Owned Clubs
  const prevEvaluatedClubIds = new Set<string>();
  if (input.prevEvaluatedClubIds) {
    input.prevEvaluatedClubIds.forEach((id) => prevEvaluatedClubIds.add(id));
  }
  if (prevSnapshot) {
    for (const [key, entry] of Object.entries(prevSnapshot)) {
      if (key.startsWith(EVALUATED_CLUB_PREFIX)) {
        prevEvaluatedClubIds.add(key.slice(EVALUATED_CLUB_PREFIX.length));
      } else if (!isSpecialSnapshotKey(key) && entry?.clubId) {
        prevEvaluatedClubIds.add(entry.clubId);
      }
    }
  }

  const nextSnapshot: Record<string, RsvpSnapshotEntry> = {};

  clubs.forEach((c) => {
    if (isOwnerOrManagerOfClub(c.id)) {
      nextSnapshot[`${EVALUATED_CLUB_PREFIX}${c.id}`] = {
        status: 'going',
        guestCount: 0,
        paidStatus: 'unpaid',
        paidMethod: '',
        feeShare: 0,
        playerName: '',
        playerId: '',
        sessionId: '',
        clubId: c.id,
      };
    }
  });

  // Sessions where somebody else's RSVP changed in this pass (for the "session is full" alert)
  const sessionsChangedByOthers = new Set<string>();

  rsvps.forEach((r) => {
    // Own rows are remembered separately so payment changes made by the host can be told to the
    // member; they never feed the owner-side join/leave diff below.
    if (r.playerId === activePlayer.id) {
      nextSnapshot[`${MINE_PREFIX}${r.id}`] = {
        status: r.status,
        guestCount: getRsvpGuestCount(r),
        paidStatus: r.paidStatus,
        paidMethod: r.paidMethod,
        feeShare: r.feeShare,
        playerName: r.playerName,
        playerId: r.playerId,
        sessionId: r.sessionId,
        clubId: r.clubId,
      };
    }
    if (!isOwnerOrManagerOfClub(r.clubId)) return;
    const guestCount = getRsvpGuestCount(r);
    const isOwnAction = r.playerId === activePlayer.id;
    nextSnapshot[r.id] = {
      status: r.status,
      guestCount,
      paidStatus: r.paidStatus,
      paidMethod: r.paidMethod,
      feeShare: r.feeShare,
      playerName: r.playerName,
      playerId: r.playerId,
      sessionId: r.sessionId,
      clubId: r.clubId,
    };

    const sess = sessionById.get(r.sessionId);
    const club = clubById.get(r.clubId);
    const sessionTitle = sess?.title || 'Club Session';
    const clubName = club?.name || 'Club';

    // Clear pending paid key if an RSVP is no longer in pending_approval (e.g. rejected back to unpaid)
    if (r.paidStatus !== 'pending_approval') {
      removeKeysByPrefix(`owner_pending_paid:${r.sessionId}:${r.playerId}:`);
    }

    // Anytime an RSVP is in 'pending_approval' (user pressed the Paid button):
    if (
      !isOwnAction &&
      r.paidStatus === 'pending_approval' &&
      r.feeShare > 0 &&
      !queuedInThisPass.has(`paid:${r.sessionId}:${r.playerId}`)
    ) {
      const formattedAmt = club
        ? formatClubCurrency(r.feeShare, club)
        : `$${r.feeShare.toFixed(2)}`;
      pendingToQueue.push({
        dedupKey: `owner_pending_paid:${r.sessionId}:${r.playerId}:${r.feeShare.toFixed(2)}`,
        category: 'owner_player_paid',
        title: `${r.playerName} Pressed Paid (${formattedAmt})`,
        body: `${r.playerName} marked ${formattedAmt} as paid (${r.paidMethod || 'Reported Paid'}) for "${sessionTitle}" (${clubName}). Tap to verify receipt.`,
        playerName: r.playerName,
        clubId: r.clubId,
        sessionId: r.sessionId,
      });
    }

    // Compare against previous snapshot for real-time remote changes
    if (prevSnapshot && !isOwnAction) {
      const prev = prevSnapshot[r.id];
      const stamp = stampFor(r);
      const guestSuffix =
        guestCount > 0 ? ` (+${guestCount} guest${guestCount > 1 ? 's' : ''})` : '';
      const lateNote =
        r.status === 'late_out'
          ? ` (Late withdrawal · ${r.penaltyPercentApplied}% fee applies)`
          : '';
      const queueJoined = () => {
        sessionsChangedByOthers.add(r.sessionId);
        pendingToQueue.push({
          dedupKey: `owner_snap_joined:${r.id}:${guestCount}:${stamp}`,
          category: 'owner_player_joined',
          title: `${r.playerName} Joined Session`,
          body: `${r.playerName}${guestSuffix} joined "${sessionTitle}" (${clubName}).`,
          playerName: r.playerName,
          clubId: r.clubId,
          sessionId: r.sessionId,
        });
      };
      const queueLeft = () => {
        sessionsChangedByOthers.add(r.sessionId);
        pendingToQueue.push({
          dedupKey: `owner_snap_left:${r.id}:${r.status}:${stamp}`,
          category: 'owner_player_left',
          title: `${r.playerName} Left Session`,
          body: `${r.playerName} left "${sessionTitle}" (${clubName})${lateNote}.`,
          playerName: r.playerName,
          clubId: r.clubId,
          sessionId: r.sessionId,
        });
      };

      if (!prev) {
        if (prevEvaluatedClubIds.has(r.clubId)) {
          if (
            r.status === 'going' &&
            !queuedInThisPass.has(`join:${r.sessionId}:${r.playerId}`)
          ) {
            queueJoined();
          } else if (
            (r.status === 'out' || r.status === 'late_out') &&
            !queuedInThisPass.has(`leave:${r.sessionId}:${r.playerId}`)
          ) {
            queueLeft();
          }
        }
      } else if (
        prev.status !== 'going' &&
        r.status === 'going' &&
        !queuedInThisPass.has(`join:${r.sessionId}:${r.playerId}`)
      ) {
        queueJoined();
      } else if (
        prev.status === 'going' &&
        r.status === 'going' &&
        prev.guestCount !== guestCount &&
        !queuedInThisPass.has(`join:${r.sessionId}:${r.playerId}`)
      ) {
        // Still going, only the number of guests changed: say that, not "joined"
        sessionsChangedByOthers.add(r.sessionId);
        const added = guestCount > prev.guestCount;
        const delta = Math.abs(guestCount - prev.guestCount);
        pendingToQueue.push({
          dedupKey: `owner_snap_guests:${r.id}:${prev.guestCount}>${guestCount}:${stamp}`,
          category: 'owner_guest_changed',
          title: `${r.playerName} ${added ? 'Added' : 'Removed'} ${delta} Guest${delta > 1 ? 's' : ''}`,
          body: `${r.playerName} ${added ? 'added' : 'removed'} ${delta} guest${delta > 1 ? 's' : ''} for "${sessionTitle}" (${clubName}). Now bringing ${guestCount}.`,
          playerName: r.playerName,
          clubId: r.clubId,
          sessionId: r.sessionId,
        });
      } else if (
        prev.status === 'going' &&
        (r.status === 'out' || r.status === 'late_out') &&
        !queuedInThisPass.has(`leave:${r.sessionId}:${r.playerId}`)
      ) {
        queueLeft();
      }
    }
  });

  // 2C. A session just reached its player limit (someone else's join or guest change did it)
  if (prevSnapshot) {
    sessionsChangedByOthers.forEach((sessionId) => {
      const sess = sessionById.get(sessionId);
      if (!sess || !sess.maxPlayers || sess.feeSplitFinalized) return;
      if (!prevEvaluatedClubIds.has(sess.clubId)) return;
      const nowCount = (rsvpsBySessionId.get(sessionId) || [])
        .filter((r) => r.status === 'going')
        .reduce((sum, r) => sum + getRsvpPartySize(r), 0);
      let prevCount = 0;
      for (const [key, entry] of Object.entries(prevSnapshot)) {
        if (isSpecialSnapshotKey(key)) continue;
        if (entry?.sessionId === sessionId && entry.status === 'going') {
          prevCount += 1 + Math.max(0, entry.guestCount || 0);
        }
      }
      if (nowCount >= sess.maxPlayers && prevCount < sess.maxPlayers) {
        const clubName = clubById.get(sess.clubId)?.name || 'Club';
        pendingToQueue.push({
          dedupKey: `owner_session_full:${sessionId}:${nowMs}`,
          category: 'owner_session_full',
          title: `Session Full · ${sess.title}`,
          body: `"${sess.title}" (${clubName}) now has ${nowCount}/${sess.maxPlayers} players. New sign-ups are blocked until someone leaves.`,
          clubId: sess.clubId,
          sessionId,
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // 3. MEMBER ALERTS ABOUT CHANGES MADE BY THE HOST (need the previous snapshot):
  //    payment confirmed / not received / waived, courts booked, session time or venue changed
  // -------------------------------------------------------------------------
  sessions.forEach((session) => {
    const club = clubById.get(session.clubId);
    if (!club) return;
    const myRsvp = (rsvpsBySessionId.get(session.id) || []).find(
      (r) => r.playerId === activePlayer.id
    );
    if (!myRsvp) return;
    nextSnapshot[`${SESSION_PREFIX}${session.id}`] = {
      status: myRsvp.status,
      guestCount: 0,
      paidStatus: myRsvp.paidStatus,
      paidMethod: '',
      feeShare: 0,
      playerName: '',
      playerId: activePlayer.id,
      sessionId: session.id,
      clubId: session.clubId,
      sessionFinalized: session.feeSplitFinalized,
      bookingStatus: session.bookingStatus,
      sessionDate: session.sessionDate,
      startTime: session.startTime,
      endTime: session.endTime,
      venue: session.venue,
      courtNumbers: session.courtNumbers,
    };
    if (!prevSnapshot) return;

    // (a) Payment status changed by the host
    const prevMine = prevSnapshot[`${MINE_PREFIX}${myRsvp.id}`];
    const prevSession = prevSnapshot[`${SESSION_PREFIX}${session.id}`];
    if (prevMine) {
      const wasFinalized = prevSession?.sessionFinalized === true && session.feeSplitFinalized;
      const stamp = stampFor(myRsvp);
      const formatted = formatClubCurrency(
        myRsvp.feeShare > 0 ? myRsvp.feeShare : prevMine.feeShare,
        club
      );
      // The owner's own row is settled by the club rules, not by a payment worth announcing
      const settledByClubRules =
        myRsvp.paidMethod === 'Club Owner' || myRsvp.paidMethod === 'Owner Excluded';
      if (
        prevMine.paidStatus !== 'paid' &&
        myRsvp.paidStatus === 'paid' &&
        !settledByClubRules &&
        (prevMine.paidStatus === 'pending_approval' || wasFinalized)
      ) {
        const waived = (myRsvp.paidMethod || '').startsWith('Fee Waived');
        pendingToQueue.push({
          dedupKey: `member_payment:${myRsvp.id}:paid:${stamp}`,
          category: 'member_payment_update',
          title: waived
            ? `Fee Waived · ${session.title}`
            : `Payment Confirmed · ${session.title}`,
          body: waived
            ? `${club.name}: your fee for ${session.title} (${session.sessionDate}) was waived. Nothing to pay.`
            : `${club.name}: your payment for ${session.title} (${session.sessionDate}) is settled (${myRsvp.paidMethod || 'Received'}).`,
          clubId: club.id,
          sessionId: session.id,
        });
      } else if (
        prevMine.paidStatus === 'pending_approval' &&
        myRsvp.paidStatus === 'unpaid' &&
        myRsvp.paidMethod === 'Rejected'
      ) {
        pendingToQueue.push({
          dedupKey: `member_payment:${myRsvp.id}:rejected:${stamp}`,
          category: 'member_payment_update',
          title: `Payment Not Received · ${session.title}`,
          body: `${club.name}: the host could not verify your payment of ${formatted} for ${session.title}. Please check the transfer and pay again.`,
          clubId: club.id,
          sessionId: session.id,
          openPaymentOnClick: true,
        });
      }
    }

    // (b) Courts booked / time or venue changed, for sessions I am going to
    if (
      prevSession &&
      myRsvp.status === 'going' &&
      !session.feeSplitFinalized &&
      session.bookingStatus !== 'completed'
    ) {
      const changes: string[] = [];
      if (prevSession.bookingStatus === 'pending' && session.bookingStatus !== 'pending') {
        changes.push(`courts are now booked${session.courtNumbers ? ` (${session.courtNumbers})` : ''}`);
      }
      if (
        prevSession.sessionDate !== session.sessionDate ||
        prevSession.startTime !== session.startTime ||
        prevSession.endTime !== session.endTime
      ) {
        changes.push(
          `time is now ${session.sessionDate} ${session.startTime}–${session.endTime}`
        );
      }
      if (prevSession.venue !== session.venue) {
        changes.push(`venue is now ${session.venue}`);
      }
      if (changes.length > 0) {
        pendingToQueue.push({
          dedupKey: `member_session_update:${session.id}:${session.bookingStatus}|${session.sessionDate}|${session.startTime}|${session.endTime}|${session.venue}|${session.courtNumbers}`,
          category: 'member_session_update',
          title: `Session Updated · ${session.title}`,
          body: `${club.name}: for ${session.title}, ${changes.join('; ')}.`,
          clubId: club.id,
          sessionId: session.id,
        });
      }
    }
  });

  // -------------------------------------------------------------------------
  // 4. MEMBER ALERT: my share changed AFTER I had already paid (extra due / refund)
  // -------------------------------------------------------------------------
  sessions.forEach((session) => {
    if (!session.feeSplitFinalized) return;
    const club = clubById.get(session.clubId);
    if (!club) return;
    const myRsvp = (rsvpsBySessionId.get(session.id) || []).find(
      (r) => r.playerId === activePlayer.id
    );
    if (!myRsvp || (myRsvp.status !== 'going' && myRsvp.status !== 'late_out')) return;
    const adj = getRsvpAdjustment(myRsvp);
    if (!adj.kind) return;
    const amount = formatClubCurrency(adj.amount, club);
    pendingToQueue.push({
      dedupKey: `member_adjustment:${myRsvp.id}:${adj.kind}:${adj.amount.toFixed(2)}`,
      category: 'member_share_adjusted',
      title: `Your Share Changed · ${session.title}`,
      body:
        adj.kind === 'due'
          ? `${club.name}: after the split was recalculated you owe ${amount} more for ${session.title}. Tap to view.`
          : `${club.name}: after the split was recalculated you overpaid by ${amount} for ${session.title}. The host should refund you.`,
      clubId: club.id,
      sessionId: session.id,
      openPaymentOnClick: adj.kind === 'due',
    });
  });

  return {
    pendingToQueue,
    nextSnapshot,
    notifiedKeys: keys,
    keysMutated,
  };
}
