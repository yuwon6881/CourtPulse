import { Club, Player, Session, SessionRsvp } from '../types';
import {
  formatClubCurrency,
  getRsvpGuestCount,
  hasPlayerJoinedClub,
  isSessionCompletedOrPast,
} from './badmintonLogic';
import { resolveClubTimeZone } from './clubTime';

export type NotificationCategory =
  | 'new_unjoined_session'
  | 'fees_finalized'
  | 'owner_player_joined'
  | 'owner_player_left'
  | 'owner_player_paid';

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
  type: 'player_joined' | 'player_left' | 'player_paid';
  clubId: string;
  sessionId: string;
  sessionTitle: string;
  playerId: string;
  playerName: string;
  guestCount?: number;
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
}

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
  const nextSnapshot: Record<string, RsvpSnapshotEntry> = {};

  rsvps.forEach((r) => {
    if (!isOwnerOrManagerOfClub(r.clubId)) return;
    const guestCount = getRsvpGuestCount(r);
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
    if (prevSnapshot) {
      const prev = prevSnapshot[r.id];
      if (!prev) {
        if (
          r.status === 'going' &&
          !queuedInThisPass.has(`join:${r.sessionId}:${r.playerId}`)
        ) {
          const guestSuffix =
            guestCount > 0
              ? ` (+${guestCount} guest${guestCount > 1 ? 's' : ''})`
              : '';
          pendingToQueue.push({
            dedupKey: `owner_snap_joined:${r.id}:${guestCount}:${nowMs}`,
            category: 'owner_player_joined',
            title: `${r.playerName} Joined Session`,
            body: `${r.playerName}${guestSuffix} joined "${sessionTitle}" (${clubName}).`,
            playerName: r.playerName,
            clubId: r.clubId,
            sessionId: r.sessionId,
          });
        } else if (
          (r.status === 'out' || r.status === 'late_out') &&
          !queuedInThisPass.has(`leave:${r.sessionId}:${r.playerId}`)
        ) {
          pendingToQueue.push({
            dedupKey: `owner_snap_left:${r.id}:${r.status}:${nowMs}`,
            category: 'owner_player_left',
            title: `${r.playerName} Left Session`,
            body: `${r.playerName} left "${sessionTitle}" (${clubName}).`,
            playerName: r.playerName,
            clubId: r.clubId,
            sessionId: r.sessionId,
          });
        }
      } else {
        if (
          ((prev.status !== 'going' && r.status === 'going') ||
            (prev.status === 'going' &&
              r.status === 'going' &&
              prev.guestCount !== guestCount)) &&
          !queuedInThisPass.has(`join:${r.sessionId}:${r.playerId}`)
        ) {
          const guestSuffix =
            guestCount > 0
              ? ` (+${guestCount} guest${guestCount > 1 ? 's' : ''})`
              : '';
          pendingToQueue.push({
            dedupKey: `owner_snap_joined:${r.id}:${guestCount}:${nowMs}`,
            category: 'owner_player_joined',
            title: `${r.playerName} Joined Session`,
            body: `${r.playerName}${guestSuffix} joined "${sessionTitle}" (${clubName}).`,
            playerName: r.playerName,
            clubId: r.clubId,
            sessionId: r.sessionId,
          });
        } else if (
          prev.status === 'going' &&
          (r.status === 'out' || r.status === 'late_out') &&
          !queuedInThisPass.has(`leave:${r.sessionId}:${r.playerId}`)
        ) {
          const lateNote =
            r.status === 'late_out'
              ? ` (Late withdrawal · ${r.penaltyPercentApplied}% fee applies)`
              : '';
          pendingToQueue.push({
            dedupKey: `owner_snap_left:${r.id}:${r.status}:${nowMs}`,
            category: 'owner_player_left',
            title: `${r.playerName} Left Session`,
            body: `${r.playerName} left "${sessionTitle}" (${clubName})${lateNote}.`,
            playerName: r.playerName,
            clubId: r.clubId,
            sessionId: r.sessionId,
          });
        }
      }
    }
  });

  return {
    pendingToQueue,
    nextSnapshot,
    notifiedKeys: keys,
    keysMutated,
  };
}
