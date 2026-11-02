/**
 * Direct Add Player utility functions for CourtPulse.
 * Pure helpers for filtering candidate members, searching, checking capacity,
 * detecting already-enrolled idempotency, and validating manager authorization.
 */
import type { Club, PermissionTier, Player, Session, SessionRsvp } from '../types';
import { getRsvpPartySize, getSessionGoingHeadcount } from './badmintonLogic';

export interface EligibleDirectAddMembersResult {
  /** Members who are not currently 'going' in the session (eligible to be added). */
  eligible: Player[];
  /** Members who already have an active RSVP with status 'going'. */
  enrolled: Player[];
}

export interface DirectAddCapacityResult {
  /** Whether the direct addition can proceed. */
  ok: boolean;
  /** Number of remaining open spots in the session before addition (clamped to >= 0). */
  spotsOpen: number;
  /** Current number of players with status 'going' in the session. */
  currentGoing: number;
  /** Party size of the addition (1 + guestCount). */
  partySize: number;
  /** Warning message if capacity is exceeded but allowed via manager override. */
  warning?: string;
  /** Error message if capacity is exceeded and override is not enabled. */
  error?: string;
}

/**
 * Checks if a player is currently actively enrolled (status === 'going') in a session.
 * Inactive RSVPs ('out' or 'late_out') or absent records return false.
 * Supports both (sessionRsvps, playerId) and (playerId, sessionRsvps, sessionId?) signatures.
 */
export function isPlayerEnrolledInSession(
  arg1: string | null | undefined | SessionRsvp[],
  arg2: SessionRsvp[] | string | null | undefined,
  sessionId?: string
): boolean {
  let playerId: string | null | undefined;
  let sessionRsvps: SessionRsvp[];

  if (Array.isArray(arg1)) {
    sessionRsvps = arg1;
    playerId = typeof arg2 === 'string' ? arg2 : null;
  } else {
    playerId = typeof arg1 === 'string' ? arg1 : null;
    sessionRsvps = Array.isArray(arg2) ? arg2 : [];
  }

  if (!playerId) return false;
  return sessionRsvps.some(
    (r) =>
      r.playerId === playerId &&
      (!sessionId || r.sessionId === sessionId) &&
      r.status === 'going'
  );
}

/**
 * Locates an existing RSVP for a player in a session regardless of status.
 */
export function findExistingSessionRsvp(
  sessionRsvps: SessionRsvp[],
  playerId: string
): SessionRsvp | undefined {
  if (!playerId) return undefined;
  return sessionRsvps.find((r) => r.playerId === playerId);
}

/**
 * Partitions club members into eligible candidates (not 'going') and enrolled players ('going').
 * Deduplicates input members by ID while preserving ordering and reference equality.
 */
export function filterEligibleDirectAddMembers(
  clubMembers: Player[],
  sessionRsvps: SessionRsvp[]
): EligibleDirectAddMembersResult {
  const goingPlayerIds = new Set(
    sessionRsvps
      .filter((r) => r.status === 'going')
      .map((r) => r.playerId)
  );

  const eligible: Player[] = [];
  const enrolled: Player[] = [];
  const seenIds = new Set<string>();

  for (const member of clubMembers) {
    if (!member || !member.id || seenIds.has(member.id)) continue;
    seenIds.add(member.id);

    if (goingPlayerIds.has(member.id)) {
      enrolled.push(member);
    } else {
      eligible.push(member);
    }
  }

  return { eligible, enrolled };
}

/**
 * Filters a list of players by display name or player tag (case-insensitive substring match).
 * Returns all members if query is empty or whitespace.
 */
export function searchMembers(members: Player[], query: string): Player[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return members;

  return members.filter((member) => {
    const name = String(member?.name ?? '').toLowerCase();
    const tag = String(member?.playerTag ?? '').toLowerCase();
    return name.includes(q) || tag.includes(q);
  });
}

/**
 * Checks whether adding a player + guests fits within the session's maxPlayers capacity.
 * If capacity is exceeded, manager override can be allowed.
 */
export function checkDirectAddCapacity(
  session: Pick<Session, 'id' | 'maxPlayers'>,
  sessionRsvps: SessionRsvp[],
  guestCount = 0,
  allowOverride = false,
  existingRsvp?: Pick<SessionRsvp, 'status' | 'guestCount'> | null
): DirectAddCapacityResult {
  const maxPlayers = Math.max(1, Math.floor(session.maxPlayers || 0));
  const resolvedGuests = Math.max(0, Math.min(4, Math.floor(Number(guestCount) || 0)));
  const partySize = 1 + resolvedGuests;

  const rsvpsForSession = session.id
    ? sessionRsvps.filter((r) => !r.sessionId || r.sessionId === session.id)
    : sessionRsvps;

  const currentGoing = getSessionGoingHeadcount(rsvpsForSession);
  const currentParty =
    existingRsvp && existingRsvp.status === 'going'
      ? getRsvpPartySize(existingRsvp)
      : 0;

  const othersGoing = currentGoing - currentParty;
  const projectedHeadcount = othersGoing + partySize;
  const spotsOpen = Math.max(0, maxPlayers - currentGoing);

  if (projectedHeadcount <= maxPlayers) {
    return {
      ok: true,
      spotsOpen,
      currentGoing,
      partySize,
    };
  }

  if (allowOverride) {
    return {
      ok: true,
      spotsOpen,
      currentGoing,
      partySize,
      warning: 'Session capacity exceeded (manager override).',
    };
  }

  return {
    ok: false,
    spotsOpen,
    currentGoing,
    partySize,
    error: 'This session is full.',
  };
}

/**
 * Verifies if the acting user has permission to directly add a player to a session.
 * Site Admins and Club Owners of this specific club are authorized; regular participants are not.
 */
export function canDirectAddPlayer(
  sessionClubId: string | null | undefined,
  actingPlayer: Player | null | undefined,
  effectiveTier: PermissionTier | null | undefined,
  clubs: ReadonlyArray<Pick<Club, 'id' | 'ownerPlayerId' | 'clubOwnerPlayerId'>>
): boolean {
  if (effectiveTier === 'admin') {
    return true;
  }

  if (!sessionClubId || !sessionClubId.trim()) {
    return false;
  }

  if (effectiveTier === 'club_owner' && actingPlayer && actingPlayer.id) {
    const club = clubs.find((c) => c.id === sessionClubId);
    if (!club) return false;
    const ownerId = club.clubOwnerPlayerId ?? club.ownerPlayerId;
    return ownerId === actingPlayer.id;
  }

  return false;
}
