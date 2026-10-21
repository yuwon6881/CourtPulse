/**
 * Pure helpers for private-club read isolation. The Firestore rules only let a member read a club's
 * sessions / RSVPs / matches, and only let a member (or admin) read a private club document, so the
 * client scopes every listener to the clubs the account belongs to. Kept free of Firebase imports so
 * it can be unit tested without initialising the SDK.
 */
import type { ClubJoinRequest } from '../types';
import { chunkArray, getErrorCode } from './friendlyErrors';

/** Firestore allows at most 30 values in an `in` filter. */
export const CLUB_IN_CHUNK_SIZE = 30;

/** Distinct, non-empty club ids from a joinedClubIdsCsv, sorted so equal sets compare equal. */
export function parseClubIdCsv(csv: string | null | undefined): string[] {
  const ids = new Set<string>();
  String(csv ?? '')
    .split(',')
    .forEach((raw) => {
      const id = raw.trim();
      if (id) ids.add(id);
    });
  return Array.from(ids).sort();
}

/** Stable string form of a club id set, used as an effect dependency. */
export function clubIdsKey(ids: readonly string[]): string {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
    .sort()
    .join(',');
}

export function clubIdsFromKey(key: string): string[] {
  return key ? key.split(',') : [];
}

/**
 * Splits club ids into `in`-filter sized groups. Duplicates and blanks are dropped and an empty
 * input yields NO chunks, so a caller can never build an `in` query with an empty array.
 */
export function chunkClubIds(
  ids: readonly string[],
  size: number = CLUB_IN_CHUNK_SIZE
): string[][] {
  const distinct = Array.from(
    new Set(ids.map((id) => id.trim()).filter(Boolean))
  );
  return chunkArray(distinct, Math.min(size, CLUB_IN_CHUNK_SIZE));
}

/** Merges lists by id. Later lists win; first-seen order is kept. */
export function mergeById<T extends { id: string }>(
  ...lists: ReadonlyArray<readonly T[]>
): T[] {
  const byId = new Map<string, T>();
  lists.forEach((list) => list.forEach((item) => byId.set(item.id, item)));
  return Array.from(byId.values());
}

export function isPermissionDenied(err: unknown): boolean {
  return getErrorCode(err) === 'permission-denied';
}

/**
 * A snapshot the server has acknowledged: no local write still pending and not served from the
 * cache. Listeners whose rules call isPlayerSelf() must wait for this about the own player, since a
 * freshly created player exists only as an optimistic local copy until its batch commits.
 */
export function isServerConfirmed(metadata: {
  hasPendingWrites: boolean;
  fromCache: boolean;
}): boolean {
  return !metadata.hasPendingWrites && !metadata.fromCache;
}

/** A query that needs a composite index (or is otherwise not supported yet). */
export function isMissingIndex(err: unknown): boolean {
  return getErrorCode(err) === 'failed-precondition';
}

// ---------------------------------------------------------------------------
// profiles/{uid}: the account -> player mapping the rules use to decide membership
// ---------------------------------------------------------------------------

export type ProfileMappingDecision =
  /** The mapping exists and points at the account's own player. */
  | 'ready'
  /** No mapping yet: the account may create it (its player points back at it). */
  | 'create'
  /** The mapping points at some other player: remove it, then create the right one. */
  | 'replace'
  /** The account has no linked player (new user): nothing to map yet. */
  | 'none';

export function decideProfileMapping(input: {
  uid: string;
  ownPlayer: { id: string; authUid?: string | null } | null;
  profile: { playerId: string } | null;
}): ProfileMappingDecision {
  const { uid, ownPlayer, profile } = input;
  if (!uid || !ownPlayer || ownPlayer.authUid !== uid) return 'none';
  if (!profile) return 'create';
  return profile.playerId === ownPlayer.id ? 'ready' : 'replace';
}

/**
 * The batch operation that maps `accountUid` to `playerId`. Creating uses `set`; if a mapping already
 * exists the rules only allow an admin UPDATE that keeps createdAt, so the caller says which.
 */
export function buildProfileMappingOp(input: {
  accountUid: string;
  playerId: string;
  writerUid: string;
  exists: boolean;
}):
  | {
      type: 'set';
      collectionName: 'profiles';
      docId: string;
      data: { playerId: string; ownerId: string };
    }
  | {
      type: 'update';
      collectionName: 'profiles';
      docId: string;
      updates: { playerId: string; ownerId: string };
    } {
  const fields = { playerId: input.playerId, ownerId: input.writerUid };
  return input.exists
    ? {
        type: 'update',
        collectionName: 'profiles',
        docId: input.accountUid,
        updates: fields,
      }
    : {
        type: 'set',
        collectionName: 'profiles',
        docId: input.accountUid,
        data: fields,
      };
}

/**
 * Bookkeeping for the self-heal: at most one repair attempt per key (account + load + heal round),
 * so a rules or network problem can never turn into a loop.
 */
export function createAttemptLedger() {
  const seen = new Set<string>();
  return {
    /** True the first time a key is claimed. */
    claim(key: string): boolean {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    has(key: string): boolean {
      return seen.has(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

export type InviteLookupKind = 'found' | 'private' | 'missing' | 'error';

/**
 * Reading a club by id: a public club (or one the account belongs to) is `found`; a private club the
 * account is not a member of answers permission-denied, which must not reveal anything about it.
 */
export function classifyInviteLookup(input: {
  exists?: boolean;
  errorCode?: string | null;
}): InviteLookupKind {
  if (input.errorCode) {
    return input.errorCode === 'permission-denied' ? 'private' : 'error';
  }
  return input.exists ? 'found' : 'missing';
}

// ---------------------------------------------------------------------------
// Join requests
// ---------------------------------------------------------------------------

export function parseJoinRequestData(
  id: string,
  raw: Record<string, unknown>,
  fallbackNow: () => Date = () => new Date()
): ClubJoinRequest {
  const createdAt = raw.createdAt as { toDate?: () => Date } | null | undefined;
  return {
    id,
    clubId: String(raw.clubId || ''),
    playerId: String(raw.playerId || ''),
    playerName: String(raw.playerName || 'Player'),
    playerTag: String(raw.playerTag || ''),
    requestedAt:
      createdAt && typeof createdAt.toDate === 'function'
        ? createdAt.toDate().toISOString()
        : fallbackNow().toISOString(),
  };
}

export function sortJoinRequestsNewestFirst(
  requests: readonly ClubJoinRequest[]
): ClubJoinRequest[] {
  return [...requests].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

/**
 * Club ids a player owns, from the club documents already loaded. Owners are members of their club,
 * so its document is always among the loaded ones.
 */
export function ownedClubIdsOf(
  playerId: string | null | undefined,
  clubs: ReadonlyArray<{
    id: string;
    ownerPlayerId?: string;
    clubOwnerPlayerId?: string;
  }>
): string[] {
  if (!playerId) return [];
  return clubIdsFromKey(
    clubIdsKey(
      clubs
        .filter((c) => (c.ownerPlayerId ?? c.clubOwnerPlayerId) === playerId)
        .map((c) => c.id)
    )
  );
}
