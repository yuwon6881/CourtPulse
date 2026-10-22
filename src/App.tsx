/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  Award,
  Briefcase,
  Building2,
  Calendar,
  ChevronDown,
  LogOut,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  auth,
  BatchWriteOperation,
  clampNumber,
  clampString,
  db,
  deleteCurrentAuthUser,
  describeFirestoreFailure,
  getReauthMethod,
  reauthenticateCurrentUser,
  safeBatchWrite,
  safeDeleteDoc,
  safeSetDoc,
  safeUpdateDoc,
  sanitizeId,
  describeAuthError,
  fetchIsAdminAccount,
  signInWithGooglePopup,
  signOutUser,
} from './firebase';
import {
  chunkArray,
  friendlyFirestoreMessage,
  getErrorCode,
} from './utils/friendlyErrors';
import {
  buildProfileMappingOp,
  chunkClubIds,
  classifyInviteLookup,
  clubIdsFromKey,
  clubIdsKey,
  createAttemptLedger,
  decideProfileMapping,
  isMissingIndex,
  isPermissionDenied,
  isServerConfirmed,
  mergeById,
  ownedClubIdsOf,
  parseClubIdCsv,
  parseJoinRequestData,
  sortJoinRequestsNewestFirst,
} from './utils/clubAccess';
import {
  clearAllCourtPulseLocalData,
  DEV_SESSION_STORAGE_KEY,
} from './utils/localData';
import {
  AttendanceOutcome,
  BadmintonMatch,
  BookingStatus,
  Club,
  ClubJoinRequest,
  ClubPaymentDetails,
  ClubVisibility,
  MatchFormat,
  PermissionTier,
  Player,
  PlayerBenefitWallet,
  RsvpStatus,
  Session,
  SessionRsvp,
} from './types';
import {
  ADMIN_EMAILS,
  appendClubToCsv,
  applyWalletsToFinalizedSessionRsvps,
  calculateOutstandingBalancesForPlayer,
  aggregateMatchStatDeltas,
  applyStatDelta,
  ClubLocalRules,
  computePlayerLeaderboardAndTiers,
  computeRating,
  checkSessionFeeInputs,
  computeSessionSplitDetails,
  evaluateJoinWindow,
  evaluateTapOutWindow,
  formatClubPaymentInfo,
  getRsvpWalletLedger,
  settleRsvpAdjustment,
  TapRsvpResult,
  type SessionInstants,
  getMatchSidePlayers,
  getPlayerJoinedClubIds,
  getRsvpPartySize,
  getSessionGoingHeadcount,
  computeSessionInstants,
  sessionInstantsDiffer,
  hasPlayerJoinedClub,
  INITIAL_CLUBS,
  INITIAL_MATCHES,
  INITIAL_PLAYERS,
  INITIAL_RSVPS,
  INITIAL_SESSIONS,
  isClubPrivate,
  isSessionCompletedOrPast,
  loadClubBillingRulesMap,
  loadClubJoinRequests,
  loadClubPaymentDetailsMap,
  loadPlayerWalletsMap,
  loadRsvpGuestsMap,
  LOCAL_STATE_STORAGE_KEY,
  makeClubWalletKey,
  parseClubPaymentDetails,
  parseSharedSessionFromUrlParams,
  PLAYER_WALLETS_STORAGE_KEY,
  PlayerStatCounters,
  removeClubFromCsv,
  restoreSessionRsvpsAndWalletsForReopen,
  saveClubBillingRule,
  saveClubJoinRequests,
  saveClubPaymentDetails,
  savePlayerWalletsMap,
  saveRsvpGuestsMap,
  settlePlayerExistingUnpaidRsvpsWithWallet,
  validateBadmintonMatchScores,
} from './utils/badmintonLogic';
import {
  DEFAULT_CLUB_TIMEZONE,
  isValidTimeZone,
  resolveClubTimeZone,
  toEpochMs,
} from './utils/clubTime';
import { checkAndConsumeRateLimit } from './utils/rateLimiter';
import { todayIsoDate } from './utils/equipmentMath';
import {
  ActionResult,
  applyWalletUpdate,
  computeFullWalletRefund,
  computeManualWaiver,
  computeRsvpWalletPair,
  rsvpFromDocData,
  friendlyWriteError,
  rowNeedsLedgerWork,
  rsvpLedgerChanged,
  WalletUpdate,
} from './utils/walletLedger';
import {
  runRsvpWalletPairs,
  updateClubWalletTransactional,
  type RsvpWalletPairTask,
} from './utils/walletTransactions';
import { SegmentedControl, StyledSelect } from './components/ui/FormControls';
import {
  AuthGateScreen,
  ClubJoinPromptModal,
  DEV_LOGIN_PERSONAS,
  DevLoginPersona,
  ProfileSetupScreen,
  SharedSessionPreviewScreen,
  VerifyEmailScreen,
} from './components/AuthGateAndClubJoinModal';
import { AdminClubAndPolicySettings } from './components/AdminClubAndPolicySettings';
import { PaymentRequestBannerAndModal } from './components/PaymentRequestBannerAndModal';
import { SessionsOverviewAndQuickOrganize } from './components/SessionsOverviewAndQuickOrganize';
import { TapRsvpPortal } from './components/TapRsvpPortal';
import { LeaderboardAndTierView } from './components/LeaderboardAndTierView';
import { SiteAdminUserManagement } from './components/SiteAdminUserManagement';
import { PlayerProfileAndHistoryView } from './components/PlayerProfileAndHistoryView';
import { SettingsView } from './components/SettingsView';
import { EquipmentLockerView } from './components/EquipmentLockerView';
import type { HostPlayerSummary } from './types/equipment';

type ActiveTab =
  | 'sessions'
  | 'rsvp'
  | 'leaderboard'
  | 'profile'
  | 'gear'
  | 'clubs'
  | 'users'
  | 'settings';

const VIEW_MODE_STORAGE_KEY = 'courtpulse_view_mode_v1';

// The preferred view mode (User / Owner / Admin) is a per-account display preference only;
// what an account may actually do is decided by its linked player and the Firestore rules.
function loadViewMode(uid: string): PermissionTier | null {
  try {
    const raw = localStorage.getItem(`${VIEW_MODE_STORAGE_KEY}_${uid}`);
    return raw === 'user' || raw === 'club_owner' || raw === 'admin' ? raw : null;
  } catch {
    return null;
  }
}

function saveViewMode(uid: string, tier: PermissionTier) {
  try {
    localStorage.setItem(`${VIEW_MODE_STORAGE_KEY}_${uid}`, tier);
  } catch {
    // ignore
  }
}

const IS_DEV_MODE = Boolean(import.meta.env.DEV);

// Invite links carry ?club=&session=. The query is captured once at load and then stripped from
// the address bar after it is handled, so later code must read it from here.
let inviteSearch =
  typeof window !== 'undefined' ? window.location.search : '';

function getInviteParams(): URLSearchParams {
  return new URLSearchParams(inviteSearch);
}

function consumeInviteLink() {
  inviteSearch = '';
  try {
    if (window.location.search) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.hash}`
      );
    }
  } catch {
    // ignore (e.g. sandboxed frames)
  }
}

const EMPTY_CLUB_PLACEHOLDER: Club = {
  id: 'club_empty_placeholder',
  name: 'No Club Selected',
  description: 'Create or join a club to organize sessions and track standings.',
  paymentInfo: 'PayNow',
  freeCancelHours: 24,
  lockCancelHours: 4,
  lateCancelFeePercent: 50,
  noShowFeePercent: 100,
  excludeOwnerFromBilling: false,
  defaultMatchTargetPoints: 21,
  currency: 'USD',
  visibility: 'public',
  timezone: DEFAULT_CLUB_TIMEZONE,
  ownerId: 'system',
  ownerPlayerId: '',
  clubOwnerPlayerId: '',
  clubOwnerName: 'Unassigned',
};

function loadDevSession(): DevLoginPersona | null {
  if (!IS_DEV_MODE) {
    // Production never honours a stored dev persona; drop any leftover from an older build.
    try {
      localStorage.removeItem(DEV_SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
  try {
    const raw = localStorage.getItem(DEV_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DevLoginPersona;
    if (parsed && typeof parsed.playerId === 'string' && typeof parsed.name === 'string') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveDevSession(persona: DevLoginPersona | null) {
  try {
    if (!persona || !IS_DEV_MODE) {
      localStorage.removeItem(DEV_SESSION_STORAGE_KEY);
    } else {
      localStorage.setItem(DEV_SESSION_STORAGE_KEY, JSON.stringify(persona));
    }
  } catch {
    // ignore
  }
}

/** Turns a failed Firestore write into an Error whose message is safe to show a person. */
function toFriendlyWriteError(err: unknown): Error {
  const message = err instanceof Error ? err.message.trim() : String(err ?? '').trim();
  if (!message) return new Error('Could not save. Refresh and try again.');
  if (message.startsWith('{')) {
    return new Error(
      /permission|PERMISSION_DENIED/i.test(message)
        ? 'Could not save: the change was not allowed. Refresh and try again.'
        : 'Could not save. Refresh and try again.'
    );
  }
  return err instanceof Error ? err : new Error(message);
}

/**
 * Player stat write for a recorded/removed match: counters move by `delta` relative to the value
 * stored on the server (increment), which is what the rules verify. ratingScore is a mirror of the
 * shared rating formula over the counters as we last saw them; displays derive it themselves.
 */
function buildPlayerStatDeltaOp(
  player: Player,
  delta: PlayerStatCounters,
  lastMatchId: string
): BatchWriteOperation {
  return {
    type: 'update',
    collectionName: 'players',
    docId: player.id,
    updates: {
      lastMatchId,
      wins: increment(delta.wins),
      losses: increment(delta.losses),
      gamesPlayed: increment(delta.gamesPlayed),
      pointsScored: increment(delta.pointsScored),
      pointsConceded: increment(delta.pointsConceded),
      singlesWins: increment(delta.singlesWins),
      singlesLosses: increment(delta.singlesLosses),
      doublesWins: increment(delta.doublesWins),
      doublesLosses: increment(delta.doublesLosses),
      ratingScore: applyStatDelta(player, delta).ratingScore,
    },
  };
}

/**
 * The stat rollback for removing one match: exactly that game, taken back from each of its
 * players (firestore.rules matchDeletionAuthorizesStats). A player whose stored counters are
 * already too low to take the game back (old data) is left alone rather than blocking the
 * delete, since displays recompute standings from the remaining matches anyway.
 */
function statRollbackForMatchWith(match: BadmintonMatch, players: Player[]) {
  const statDeltas = aggregateMatchStatDeltas([match], -1);
  const involvedPlayers = players.filter((p) => {
    const delta = statDeltas.get(p.id);
    if (!delta) return false;
    return (
      p.gamesPlayed + delta.gamesPlayed >= 0 &&
      p.wins + delta.wins >= 0 &&
      p.losses + delta.losses >= 0 &&
      p.pointsScored + delta.pointsScored >= 0 &&
      p.pointsConceded + delta.pointsConceded >= 0 &&
      p.singlesWins + delta.singlesWins >= 0 &&
      p.singlesLosses + delta.singlesLosses >= 0 &&
      p.doublesWins + delta.doublesWins >= 0 &&
      p.doublesLosses + delta.doublesLosses >= 0
    );
  });
  return { statDeltas, involvedPlayers };
}

function toLockerPlayer(player: Player): HostPlayerSummary {
  return {
    id: player.id,
    name: player.name,
    clubIds: getPlayerJoinedClubIds(player),
    elo: player.ratingScore,
    matchesPlayed: player.gamesPlayed,
  };
}

function isBootstrapAdminEmail(email: string | null | undefined): boolean {
  const clean = (email || '').trim().toLowerCase();
  return Boolean(clean) && ADMIN_EMAILS.some((e) => e.toLowerCase() === clean);
}

interface LocalClubSnapshot {
  clubs: Club[];
  sessions: Session[];
  players: Player[];
  rsvps: SessionRsvp[];
  matches: BadmintonMatch[];
}

/**
 * Local demo state has no Firestore rules, but the UI still measures cancel windows from startsAt,
 * so give every local session the instant its date/time imply in its club's zone.
 */
function loadLocalClubState(): LocalClubSnapshot {
  const snapshot = readLocalClubState();
  const clubById = new Map(snapshot.clubs.map((c) => [c.id, c]));
  return {
    ...snapshot,
    sessions: snapshot.sessions.map((s) => {
      const club = clubById.get(s.clubId);
      return club ? { ...s, ...instantsToState(computeInstantsFor(s, club)) } : s;
    }),
  };
}

function readLocalClubState(): LocalClubSnapshot {
  if (!IS_DEV_MODE) {
    return {
      clubs: [],
      sessions: [],
      players: [],
      rsvps: [],
      matches: [],
    };
  }
  try {
    const raw = localStorage.getItem(LOCAL_STATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalClubSnapshot;
      if (
        Array.isArray(parsed.clubs) &&
        parsed.clubs.length > 0 &&
        Array.isArray(parsed.sessions) &&
        parsed.sessions.length > 0 &&
        Array.isArray(parsed.players) &&
        parsed.players.length > 0
      ) {
        const hasProposedSeed = parsed.sessions.some(
          (s) => s.id === 'session_oct24_proposed' || s.bookingStatus === 'pending'
        );
        const proposedSession = INITIAL_SESSIONS.find(
          (s) => s.id === 'session_oct24_proposed'
        );
        if (!hasProposedSeed && proposedSession) {
          const proposedRsvps = INITIAL_RSVPS.filter(
            (r) => r.sessionId === 'session_oct24_proposed'
          );
          return {
            ...parsed,
            sessions: [proposedSession, ...parsed.sessions],
            rsvps: [...parsed.rsvps, ...proposedRsvps],
          };
        }
        return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  return {
    clubs: INITIAL_CLUBS,
    sessions: INITIAL_SESSIONS,
    players: INITIAL_PLAYERS,
    rsvps: INITIAL_RSVPS,
    matches: INITIAL_MATCHES,
  };
}

function parseSessionDoc(id: string, raw: Record<string, unknown>): Session {
  // startsAt / lateCancelUntil / freeCancelUntil arrive as Firestore Timestamps; keep them in
  // memory as Dates (null when absent) and write them back as Timestamps (see instants*Fields).
  const asDate = (value: unknown): Date | null => {
    const ms = toEpochMs(value);
    return ms === null ? null : new Date(ms);
  };
  return {
    ...(raw as unknown as Omit<Session, 'id'>),
    clubId: typeof raw.clubId === 'string' ? raw.clubId : 'club_bintang_prime',
    shuttlesUsed: typeof raw.shuttlesUsed === 'number' ? raw.shuttlesUsed : 0,
    shuttleUnitCost:
      typeof raw.shuttleUnitCost === 'number' ? raw.shuttleUnitCost : 3.0,
    startsAt: asDate(raw.startsAt),
    lateCancelUntil: asDate(raw.lateCancelUntil),
    freeCancelUntil: asDate(raw.freeCancelUntil),
    id,
  };
}

/**
 * The three instants a session SHOULD carry for its date/start time under the club's CURRENT zone
 * and cancel hours (null when the start time is unreadable). A club that has not loaded falls back
 * to the placeholder defaults; callers that must not guess (backfill, resync) pass a real club.
 */
function computeInstantsFor(
  session: Pick<Session, 'sessionDate' | 'startTime'>,
  club: Pick<Club, 'timezone' | 'freeCancelHours' | 'lockCancelHours'> | undefined
): SessionInstants | null {
  return computeSessionInstants(session, club ?? EMPTY_CLUB_PLACEHOLDER);
}

/** In-memory (Date) form of the instants; all null when there are none. */
function instantsToState(
  i: SessionInstants | null
): Pick<Session, 'startsAt' | 'lateCancelUntil' | 'freeCancelUntil'> {
  if (!i) return { startsAt: null, lateCancelUntil: null, freeCancelUntil: null };
  return {
    startsAt: new Date(i.startsAtMs),
    lateCancelUntil: new Date(i.lateCancelUntilMs),
    freeCancelUntil: i.freeCancelUntilMs === null ? null : new Date(i.freeCancelUntilMs),
  };
}

/** Timestamps for a CREATE; freeCancelUntil is omitted (absent) when the club has no free period. */
function instantsCreateFields(i: SessionInstants | null): Record<string, Timestamp> {
  if (!i) return {};
  return {
    startsAt: Timestamp.fromMillis(i.startsAtMs),
    lateCancelUntil: Timestamp.fromMillis(i.lateCancelUntilMs),
    ...(i.freeCancelUntilMs !== null
      ? { freeCancelUntil: Timestamp.fromMillis(i.freeCancelUntilMs) }
      : {}),
  };
}

/**
 * Only the instants of an UPDATE that actually changed. A freeCancelUntil that no longer applies
 * is removed from the document (deleteField), never left stale; when the start is unreadable
 * every stored instant is removed so players are locked out rather than left on old deadlines.
 */
function instantsUpdateFields(
  i: SessionInstants | null,
  current: Pick<Session, 'startsAt' | 'lateCancelUntil' | 'freeCancelUntil'>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const cur = {
    startsAt: toEpochMs(current.startsAt),
    lateCancelUntil: toEpochMs(current.lateCancelUntil),
    freeCancelUntil: toEpochMs(current.freeCancelUntil),
  };
  const next = i
    ? {
        startsAt: i.startsAtMs,
        lateCancelUntil: i.lateCancelUntilMs,
        freeCancelUntil: i.freeCancelUntilMs,
      }
    : { startsAt: null, lateCancelUntil: null, freeCancelUntil: null };
  (['startsAt', 'lateCancelUntil', 'freeCancelUntil'] as const).forEach((key) => {
    if (next[key] === cur[key]) return;
    out[key] = next[key] === null ? deleteField() : Timestamp.fromMillis(next[key] as number);
  });
  return out;
}

function parseRsvpDoc(id: string, raw: Record<string, unknown>): SessionRsvp {
  return {
    ...(raw as unknown as Omit<SessionRsvp, 'id'>),
    clubId: typeof raw.clubId === 'string' ? raw.clubId : 'club_bintang_prime',
    guestCount:
      typeof raw.guestCount === 'number'
        ? Math.max(0, Math.min(4, Math.floor(raw.guestCount)))
        : 0,
    attendanceOutcome:
      typeof raw.attendanceOutcome === 'string'
        ? (raw.attendanceOutcome as AttendanceOutcome)
        : 'present',
    penaltyPercentApplied:
      typeof raw.penaltyPercentApplied === 'number'
        ? raw.penaltyPercentApplied
        : 0,
    grossFeeShare:
      typeof raw.grossFeeShare === 'number' ? raw.grossFeeShare : undefined,
    walletCreditApplied:
      typeof raw.walletCreditApplied === 'number'
        ? raw.walletCreditApplied
        : undefined,
    walletPassApplied:
      typeof raw.walletPassApplied === 'boolean'
        ? raw.walletPassApplied
        : undefined,
    walletWaiverApplied:
      typeof raw.walletWaiverApplied === 'boolean'
        ? raw.walletWaiverApplied
        : undefined,
    id,
  };
}

function parseMatchDoc(id: string, raw: Record<string, unknown>): BadmintonMatch {
  const createdAtRaw = raw.createdAt as
    | { toDate?: () => Date }
    | string
    | number
    | null
    | undefined;
  const resolvedCreatedAt =
    createdAtRaw &&
    typeof createdAtRaw === 'object' &&
    typeof createdAtRaw.toDate === 'function'
      ? createdAtRaw.toDate().toISOString()
      : typeof createdAtRaw === 'string' || typeof createdAtRaw === 'number'
      ? createdAtRaw
      : undefined;
  return {
    ...(raw as unknown as Omit<BadmintonMatch, 'id'>),
    clubId: typeof raw.clubId === 'string' ? raw.clubId : 'club_bintang_prime',
    ...(resolvedCreatedAt !== undefined ? { createdAt: resolvedCreatedAt } : {}),
    id,
  };
}

// Waiting for the server this long with only an empty cache snapshot means we are effectively
// offline; show the retry screen instead of spinning forever.
const SERVER_SNAPSHOT_TIMEOUT_MS = 8000;

export default function App() {
  const initialLocal = useMemo(() => loadLocalClubState(), []);

  const [user, setUser] = useState<User | null>(null);
  const [devSession, setDevSession] = useState<DevLoginPersona | null>(() =>
    loadDevSession()
  );
  const [authReady, setAuthReady] = useState<boolean>(false);

  const [clubPaymentMap, setClubPaymentMap] = useState<
    Record<string, ClubPaymentDetails>
  >(() => loadClubPaymentDetailsMap());

  const [clubBillingRulesMap, setClubBillingRulesMap] = useState<
    Record<string, ClubLocalRules>
  >(() => loadClubBillingRulesMap());

  const [clubJoinRequests, setClubJoinRequests] = useState<ClubJoinRequest[]>(
    () => loadClubJoinRequests()
  );

  const [playerWalletsMap, setPlayerWalletsMap] = useState<
    Record<string, PlayerBenefitWallet>
  >(() => loadPlayerWalletsMap());
  const cloudWalletDocIdsRef = useRef<Set<string>>(new Set());

  const [rsvpGuestsMap, setRsvpGuestsMap] = useState<Record<string, number>>(
    () => loadRsvpGuestsMap()
  );

  const [rawClubs, setRawClubs] = useState<Club[]>(initialLocal.clubs);
  const [sessions, setSessions] = useState<Session[]>(initialLocal.sessions);
  const [rawPlayers, setPlayers] = useState<Player[]>(initialLocal.players);
  const [rawRsvps, setRsvps] = useState<SessionRsvp[]>(initialLocal.rsvps);

  // Enrich RSVPs with persistent +1 guest count (prefers cloud guestCount when signed in)
  const rsvps = useMemo<SessionRsvp[]>(() => {
    return rawRsvps.map((r) => {
      const mappedGuests =
        r.guestCount !== undefined
          ? r.guestCount
          : rsvpGuestsMap[r.id] !== undefined
          ? rsvpGuestsMap[r.id]
          : 0;
      return {
        ...r,
        guestCount:
          r.status === 'going'
            ? Math.max(0, Math.min(4, Math.floor(Number(mappedGuests || 0))))
            : 0,
      };
    });
  }, [rawRsvps, rsvpGuestsMap]);

  const rsvpsRef = useRef<SessionRsvp[]>(rsvps);
  rsvpsRef.current = rsvps;
  const [matches, setMatches] = useState<BadmintonMatch[]>(initialLocal.matches);

  // Bumped after the user verifies their email so data listeners re-subscribe with the fresh token
  const [authVersion, setAuthVersion] = useState(0);
  const [isAdminDoc, setIsAdminDoc] = useState(false);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  // A listener failed (rules, offline, quota). Shown as a full-screen retry view instead of an
  // endless spinner; retryNonce re-subscribes every listener.
  const [dataError, setDataError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  // profiles/{uid} maps this account to its player profile; the rules decide club membership
  // from it, so no club-scoped listener may subscribe before it is confirmed. healNonce re-runs the
  // mapping check (once) after a listener answers permission-denied.
  const [profileMapReady, setProfileMapReady] = useState(false);
  const [healNonce, setHealNonce] = useState(0);
  // The own player's joinedClubIdsCsv as the SERVER has it (never a pending optimistic write), so
  // listeners never subscribe to a club the rules do not yet count the account as a member of.
  // null until the first answer.
  const [confirmedJoinedCsv, setConfirmedJoinedCsv] = useState<string | null>(
    null
  );
  // The own player's id once the SERVER has confirmed that document (no pending local write, not a
  // cache read). Listeners whose rules call isPlayerSelf() (join requests, wallets) wait for it:
  // right after sign-up the player exists only as an optimistic local copy, and a query that reaches
  // the server before the sign-up batch commits is denied.
  const [confirmedOwnPlayerId, setConfirmedOwnPlayerId] = useState<
    string | null
  >(null);
  // Bumped once (after a short delay) when a secondary listener is denied, to resubscribe them.
  const [secondaryRetryNonce, setSecondaryRetryNonce] = useState(0);
  const secondaryRetryRef = useRef<{
    key: string;
    used: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ key: '', used: false, timer: null });
  const profileHealLedgerRef = useRef(createAttemptLedger());
  const listenerHealRef = useRef<{ key: string; used: boolean }>({
    key: '',
    used: false,
  });
  const latestScopeKeyRef = useRef('');
  // Set while a sign-up or account deletion writes the mapping itself, so the self-heal does not race it.
  const profileWriteInFlightRef = useRef(false);
  // What an invite link points at: the club when it is readable (public, or already a member), or
  // null for a private club the account may not see (the card then stays generic).
  const [inviteClubInfo, setInviteClubInfo] = useState<{
    id: string;
    club: Club | null;
  } | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [signedOutNotice, setSignedOutNotice] = useState<string | null>(null);
  const errorNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [myProfileClaim, setMyProfileClaim] = useState<{
    playerId: string;
  } | null>(null);
  const [profileClaims, setProfileClaims] = useState<
    { uid: string; playerId: string; email: string; displayName: string }[]
  >([]);

  // Defaults to the highest mode; effectiveTier degrades it to what the account is entitled to
  const [permissionTier, setPermissionTier] = useState<PermissionTier>('admin');

  const [rateLimitNotice, setRateLimitNotice] = useState<string | null>(null);
  // Visible, auto-clearing error toast for failed money/RSVP writes (rolled back locally)
  const [actionError, setActionError] = useState<string | null>(null);
  const actionErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportActionError = (message: string) => {
    setActionError(message);
    if (actionErrorTimerRef.current) clearTimeout(actionErrorTimerRef.current);
    actionErrorTimerRef.current = setTimeout(() => setActionError(null), 9000);
  };
  const [activeTab, setActiveTab] = useState<ActiveTab>('sessions');
  const [inspectedPlayerId, setInspectedPlayerId] = useState<string | null>(
    null
  );
  const [activeClubId, setActiveClubId] = useState<string>('all');

  // Stored counters are the lifetime record (kept in step with match writes via increment()), so
  // they are shown as-is, never recomputed from the windowed `matches` list. The rating is always
  // derived from those counters with the one shared formula; the stored ratingScore is only a
  // mirror. Club standings and profiles are derived from the club's own matches separately.
  const players = useMemo<Player[]>(
    () =>
      rawPlayers.map((p) => ({
        ...p,
        ratingScore: computeRating(p),
      })),
    [rawPlayers]
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    initialLocal.sessions[0]?.id || 'session_oct22_upcoming'
  );
  const [openPayInfoOnLedger, setOpenPayInfoOnLedger] =
    useState<boolean>(false);
  const [initialSessionSubTab, setInitialSessionSubTab] = useState<
    'roster' | 'matches' | undefined
  >(undefined);

  const [pendingInviteClubId, setPendingInviteClubId] = useState<string | null>(
    null
  );
  const [pendingInviteSessionId, setPendingInviteSessionId] = useState<
    string | null
  >(null);
  const [authGateRequestedFromPreview, setAuthGateRequestedFromPreview] =
    useState<boolean>(false);
  const [authGateInitialMode, setAuthGateInitialMode] = useState<
    'login' | 'register'
  >('login');
  const [clubJoinModalClubId, setClubJoinModalClubId] = useState<string | null>(
    null
  );

  const [paymentModalOpen, setPaymentModalOpen] = useState<boolean>(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState<boolean>(false);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const quickOrganizerRef = useRef<HTMLDivElement | null>(null);
  const hasSeededCloudRef = useRef<boolean>(false);

  // Enrich clubs with their resolved Club Owner identity and structured payment details
  const clubs = useMemo<Club[]>(() => {
    return rawClubs.map((c) => {
      // Club ownership lives on the club document (ownerPlayerId) and is enforced by the rules
      const ownerPlayerId = c.ownerPlayerId ?? c.clubOwnerPlayerId ?? '';
      const ownerPlayer = players.find((p) => p.id === ownerPlayerId);
      const ownerName = ownerPlayer?.name || c.clubOwnerName || 'Unassigned';
      let parsedFromJson: ClubPaymentDetails | null = null;
      if (c.paymentDetailsJson) {
        try {
          const parsed = JSON.parse(c.paymentDetailsJson) as ClubPaymentDetails;
          if (parsed && typeof parsed.recipientName === 'string') {
            parsedFromJson = parsed;
          }
        } catch {
          // ignore
        }
      }
      const resolvedPaymentDetails =
        parsedFromJson ||
        c.paymentDetails ||
        clubPaymentMap[c.id] ||
        parseClubPaymentDetails(c.paymentInfo, ownerName);
      const billingRule = clubBillingRulesMap[c.id];
      const excludeOwnerFromBilling =
        c.excludeOwnerFromBilling !== undefined
          ? Boolean(c.excludeOwnerFromBilling)
          : billingRule !== undefined
          ? Boolean(billingRule.excludeOwnerFromBilling)
          : false;
      const defaultMatchTargetPoints =
        c.defaultMatchTargetPoints !== undefined
          ? clampNumber(c.defaultMatchTargetPoints, 1, 100)
          : billingRule?.defaultMatchTargetPoints !== undefined
          ? clampNumber(billingRule.defaultMatchTargetPoints, 1, 100)
          : 21;
      const currency = c.currency || billingRule?.currency || 'USD';
      const visibility: ClubVisibility =
        c.visibility === 'private' ? 'private' : 'public';
      return {
        ...c,
        clubOwnerPlayerId: ownerPlayerId,
        clubOwnerName: ownerName,
        paymentDetails: resolvedPaymentDetails,
        excludeOwnerFromBilling,
        defaultMatchTargetPoints,
        currency,
        visibility,
        // A club without (or with an unknown) timezone is read in the default zone
        timezone: resolveClubTimeZone(c.timezone),
      };
    });
  }, [
    rawClubs,
    clubPaymentMap,
    clubBillingRulesMap,
    players,
  ]);

  // Short, dismissing toast for failed writes. `err` may be a thrown Error or a plain message.
  const showError = (err: unknown) => {
    const message =
      typeof err === 'string'
        ? err
        : describeFirestoreFailure(err);
    setErrorNotice(message);
    if (errorNoticeTimerRef.current) clearTimeout(errorNoticeTimerRef.current);
    errorNoticeTimerRef.current = setTimeout(() => setErrorNotice(null), 7000);
  };

  // onSnapshot error callbacks must not throw (the SDK would swallow it and the listener would
  // die silently). Log the detail, show a friendly message and let the retry screen take over.
  const reportListenerError = (source: string, err: unknown) => {
    console.error(`Firestore listener failed (${source})`, err);
    setDataError(friendlyFirestoreMessage(err));
  };

  const enforceRateLimit = (actionKey: string): boolean => {
    const check = checkAndConsumeRateLimit(actionKey);
    if (!check.allowed) {
      setRateLimitNotice(
        check.reason || 'Too many requests. Please wait a moment.'
      );
      setTimeout(() => setRateLimitNotice(null), 3000);
      return false;
    }
    return true;
  };

  useEffect(() => {
    const params = getInviteParams();
    const sharedClubId = params.get('club');
    const sharedSessionId = params.get('session');

    if (sharedClubId) {
      setPendingInviteClubId(sharedClubId);
    }
    if (sharedSessionId) {
      const { hydratedSession } = parseSharedSessionFromUrlParams(params);
      if (hydratedSession) {
        setSessions((prev) => {
          if (prev.some((s) => s.id === hydratedSession.id)) {
            return prev.map((s) =>
              s.id === hydratedSession.id ? { ...s, ...hydratedSession } : s
            );
          }
          return [hydratedSession, ...prev];
        });
      }
      setPendingInviteSessionId(sharedSessionId);
      setAuthGateRequestedFromPreview(false);
    }
  }, []);

  useEffect(() => {
    if (IS_DEV_MODE && !user && devSession) {
      try {
        localStorage.setItem(
          LOCAL_STATE_STORAGE_KEY,
          JSON.stringify({ clubs: rawClubs, sessions, players, rsvps, matches })
        );
      } catch {
        // ignore
      }
    }
  }, [user, devSession, rawClubs, sessions, players, rsvps, matches]);

  // Drops every piece of cloud-derived React state (clubs, sessions, players, RSVPs, matches,
  // wallets, requests, claims) so one account's data never shows up for the next one.
  const resetClientDataState = () => {
    const fallback = loadLocalClubState();
    const { hydratedSession } = parseSharedSessionFromUrlParams(
      getInviteParams()
    );
    setRawClubs(fallback.clubs);
    setSessions(
      hydratedSession
        ? [
            hydratedSession,
            ...fallback.sessions.filter((s) => s.id !== hydratedSession.id),
          ]
        : fallback.sessions
    );
    setPlayers(fallback.players);
    setRsvps(fallback.rsvps);
    setMatches(fallback.matches);
    cloudWalletDocIdsRef.current = new Set();
    setPlayerWalletsMap({});
    setClubPaymentMap({});
    setClubBillingRulesMap({});
    setRsvpGuestsMap({});
    setClubJoinRequests([]);
    setMyProfileClaim(null);
    setProfileClaims([]);
    setIsAdminDoc(false);
    setPlayersLoaded(false);
    setDataError(null);
    setProfileMapReady(false);
    setConfirmedJoinedCsv(null);
    setConfirmedOwnPlayerId(null);
    setInviteClubInfo(null);
    profileHealLedgerRef.current = createAttemptLedger();
    listenerHealRef.current = { key: '', used: false };
  };

  const lastAuthUidRef = useRef<string | null>(null);
  const authEventSeqRef = useRef(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const seq = ++authEventSeqRef.current;
      // A user who verified their email on another device and then reloads still carries a
      // token with email_verified=false; refresh once so the rules see the verified claim.
      if (currentUser && currentUser.emailVerified) {
        try {
          await currentUser.getIdToken(true);
        } catch (err) {
          console.warn('Could not refresh the sign-in token', err);
        }
      }
      // A newer auth event superseded this one while the token was refreshing.
      if (seq !== authEventSeqRef.current) return;

      const previousUid = lastAuthUidRef.current;
      const nextUid = currentUser?.uid ?? null;
      lastAuthUidRef.current = nextUid;
      // Sign-out or account switch: wipe this browser's club data and cached state.
      const accountChanged = previousUid !== null && previousUid !== nextUid;
      if (accountChanged) {
        clearAllCourtPulseLocalData();
      }

      setUser(currentUser);
      setAuthReady(true);
      setPlayersLoaded(false);
      setPermissionTier(
        (currentUser && loadViewMode(currentUser.uid)) || 'admin'
      );
      if (accountChanged || (!currentUser && !loadDevSession())) {
        resetClientDataState();
      }
      if (!currentUser) {
        setDataError(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const isUserVerified = Boolean(user && user.emailVerified);

  useEffect(() => {
    if (!user || !isUserVerified) {
      setIsAdminDoc(false);
      return;
    }
    let cancelled = false;
    void fetchIsAdminAccount(user.uid).then((ok) => {
      if (!cancelled) setIsAdminDoc(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [user, isUserVerified, authVersion]);

  // The signed-in account's own pending request to be linked to an existing profile
  useEffect(() => {
    if (!user || !isUserVerified) {
      setMyProfileClaim(null);
      return;
    }
    return onSnapshot(
      doc(db, 'profileClaims', user.uid),
      (snap) =>
        setMyProfileClaim(
          snap.exists()
            ? {
                playerId: String(
                  (snap.data() as { playerId?: string }).playerId || ''
                ),
              }
            : null
        ),
      (err) => {
        // A claim lookup failing is not fatal: onboarding still works and stale claims can be cancelled.
        console.error('Profile claim listener failed', err);
        setMyProfileClaim(null);
      }
    );
  }, [user, isUserVerified, authVersion, retryNonce]);

  // Site Admins see every pending request to link an account to an existing profile
  const isAdminForClaims = Boolean(
    user && isUserVerified && (isBootstrapAdminEmail(user.email) || isAdminDoc)
  );
  useEffect(() => {
    if (!isAdminForClaims) {
      setProfileClaims([]);
      return;
    }
    return onSnapshot(
      collection(db, 'profileClaims'),
      (snap) =>
        setProfileClaims(
          snap.docs.map((d) => {
            const raw = d.data() as Record<string, unknown>;
            return {
              uid: d.id,
              playerId: String(raw.playerId || ''),
              email: String(raw.email || ''),
              displayName: String(raw.displayName || ''),
            };
          })
        ),
      (err) => {
        console.error('Profile claims listener failed', err);
        setProfileClaims([]);
      }
    );
  }, [isAdminForClaims, authVersion, retryNonce]);

  // Club join requests (the scoped listeners live further down, once the player and clubs are known).

  useEffect(() => {
    if (!authReady || !user || !isUserVerified) return;

    // Forget the previous load's server-confirmed memberships until this load hears from the server.
    setConfirmedJoinedCsv(null);
    setConfirmedOwnPlayerId(null);
    const uid = user.uid;
    try {
      localStorage.removeItem(PLAYER_WALLETS_STORAGE_KEY);
    } catch {
      // ignore
    }
    // Newest first so the caps drop the oldest rows, not arbitrary ones. (Clubs have their own
    // scoped listeners further down: a private club document is readable by its members only.)
    const playersQuery = query(
      collection(db, 'players'),
      orderBy('createdAt', 'desc'),
      limit(1000)
    );
    const ownPlayerQuery = query(
      collection(db, 'players'),
      where('authUid', '==', uid),
      limit(1)
    );

    const parsePlayerDoc = (
      id: string,
      raw: Record<string, unknown>
    ): Player => {
      const num = (v: unknown, fallback = 0) =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      return {
        ...(raw as unknown as Omit<Player, 'id'>),
        wins: num(raw.wins, 0),
        losses: num(raw.losses, 0),
        gamesPlayed: num(raw.gamesPlayed, 0),
        pointsScored: num(raw.pointsScored, 0),
        pointsConceded: num(raw.pointsConceded, 0),
        singlesWins: num(raw.singlesWins, 0),
        singlesLosses: num(raw.singlesLosses, 0),
        doublesWins: num(raw.doublesWins, 0),
        doublesLosses: num(raw.doublesLosses, 0),
        ratingScore: num(raw.ratingScore, 1200),
        playerTag:
          typeof raw.playerTag === 'string'
            ? raw.playerTag
            : `${String(raw.name || 'player')
                .toLowerCase()
                .split(' ')[0]}#100`,
        joinedClubIdsCsv:
          typeof raw.joinedClubIdsCsv === 'string'
            ? raw.joinedClubIdsCsv
            : 'club_bintang_prime',
        id,
      };
    };

    let listPlayersSnapshot: Player[] = [];
    let ownAuthPlayerSnapshot: Player | null = null;
    let listLoaded = false;
    let ownLoaded = false;

    // If the server never answers (only empty cache snapshots arrive), stop waiting and offer a retry.
    const serverTimeout = setTimeout(() => {
      if (!(listLoaded && ownLoaded)) {
        console.error('Timed out waiting for the first server snapshot');
        setDataError(
          "CourtPulse couldn't reach the server. Check your connection and try again."
        );
      }
    }, SERVER_SNAPSHOT_TIMEOUT_MS);

    const commitMergedPlayers = () => {
      const merged = [...listPlayersSnapshot];
      if (ownAuthPlayerSnapshot) {
        const idx = merged.findIndex((p) => p.id === ownAuthPlayerSnapshot!.id);
        if (idx >= 0) {
          merged[idx] = ownAuthPlayerSnapshot;
        } else {
          merged.unshift(ownAuthPlayerSnapshot);
        }
      }
      setPlayers(merged);
      if (listLoaded && ownLoaded) {
        setPlayersLoaded(true);
      }
    };

    const unsubPlayers = onSnapshot(
      playersQuery,
      (snap) => {
        // Keep waiting for the server rather than treating an empty cache as "no players".
        if (snap.metadata.fromCache && snap.empty) return;
        listPlayersSnapshot = snap.docs.map((d) =>
          parsePlayerDoc(d.id, d.data() as Record<string, unknown>)
        );
        listLoaded = true;
        commitMergedPlayers();
      },
      (err) => {
        listLoaded = true;
        reportListenerError('players', err);
      }
    );

    const unsubOwnPlayer = onSnapshot(
      ownPlayerQuery,
      // Metadata changes are delivered so we hear when a local membership write is acknowledged.
      { includeMetadataChanges: true },
      (snap) => {
        // An empty cache snapshot must not look like "this account has no profile yet"
        // (that would send an existing user to onboarding).
        if (snap.metadata.fromCache && snap.empty) return;
        const first = snap.docs[0];
        ownAuthPlayerSnapshot = first
          ? parsePlayerDoc(first.id, first.data() as Record<string, unknown>)
          : null;
        ownLoaded = true;
        commitMergedPlayers();
        // Listeners follow the memberships the server has acknowledged, never an optimistic join
        // (the rules would still refuse that club's data) or leave (already revoked is fine).
        if (!snap.metadata.hasPendingWrites) {
          setConfirmedJoinedCsv(
            first
              ? String(
                  (first.data() as { joinedClubIdsCsv?: unknown })
                    .joinedClubIdsCsv ?? ''
                )
              : ''
          );
        }
        // Server-confirmed: acknowledged by the server and not read from the cache.
        if (isServerConfirmed(snap.metadata)) {
          setConfirmedOwnPlayerId(first ? first.id : null);
        }
      },
      (err) => {
        // Deliberately NOT marking the profile as loaded: a permission or network error is not
        // proof that the profile is missing, so never fall through to onboarding.
        reportListenerError('own player', err);
      }
    );

    return () => {
      clearTimeout(serverTimeout);
      unsubPlayers();
      unsubOwnPlayer();
    };
  }, [authReady, user, isUserVerified, authVersion, retryNonce]);

  function makeCloudWalletDocId(clubId: string, playerId: string): string {
    return sanitizeId(`wallet_${clubId}_${playerId}`);
  }

  function buildWalletBatchOp(
    clubId: string,
    playerId: string,
    wallet: PlayerBenefitWallet
  ): BatchWriteOperation {
    const docId = makeCloudWalletDocId(clubId, playerId);
    const cleanCredit = clampNumber(
      Number((wallet.creditBalance || 0).toFixed(2)),
      0,
      100000
    );
    const cleanPasses = Math.round(
      clampNumber(Math.floor(wallet.freeSessionPasses || 0), 0, 1000)
    );
    const cleanWaive = Boolean(wallet.waiveAllFees);
    if (cloudWalletDocIdsRef.current.has(docId)) {
      return {
        type: 'update',
        collectionName: 'clubWallets',
        docId,
        updates: {
          creditBalance: cleanCredit,
          freeSessionPasses: cleanPasses,
          waiveAllFees: cleanWaive,
        },
      };
    }
    cloudWalletDocIdsRef.current.add(docId);
    return {
      type: 'set',
      collectionName: 'clubWallets',
      docId,
      data: {
        clubId: sanitizeId(clubId),
        playerId: sanitizeId(playerId),
        creditBalance: cleanCredit,
        freeSessionPasses: cleanPasses,
        waiveAllFees: cleanWaive,
        ownerId: user?.uid || 'local_club',
      },
    };
  }

  async function seedInitialClubDataToFirestore(uid: string) {
    const ops: BatchWriteOperation[] = [
      ...INITIAL_CLUBS.map(
        (c): BatchWriteOperation => ({
          type: 'set',
          collectionName: 'clubs',
          docId: c.id,
          data: {
            name: clampString(c.name, 100),
            description: clampString(c.description, 200),
            paymentInfo: clampString(c.paymentInfo, 160),
            freeCancelHours: clampNumber(c.freeCancelHours, 0, 720),
            lockCancelHours: clampNumber(c.lockCancelHours, 0, 720),
            lateCancelFeePercent: clampNumber(c.lateCancelFeePercent, 0, 100),
            noShowFeePercent: clampNumber(c.noShowFeePercent, 0, 100),
            excludeOwnerFromBilling: Boolean(c.excludeOwnerFromBilling),
            defaultMatchTargetPoints: clampNumber(
              c.defaultMatchTargetPoints ?? 21,
              1,
              100
            ),
            currency: clampString(c.currency || 'USD', 10, 'USD'),
            ...(c.paymentDetails
              ? {
                  paymentDetailsJson: clampString(
                    JSON.stringify(c.paymentDetails),
                    2000,
                    ''
                  ),
                }
              : {}),
            visibility: c.visibility || 'public',
            timezone: resolveClubTimeZone(c.timezone),
            ownerPlayerId: c.clubOwnerPlayerId || '',
            ownerId: uid,
          },
        })
      ),
      ...INITIAL_SESSIONS.map(
        (s): BatchWriteOperation => ({
          type: 'set',
          collectionName: 'sessions',
          docId: s.id,
          data: {
            clubId: sanitizeId(s.clubId),
            title: clampString(s.title, 120),
            venue: clampString(s.venue, 120),
            courtNumbers: clampString(s.courtNumbers, 60),
            sessionDate: clampString(s.sessionDate, 40),
            startTime: clampString(s.startTime, 20),
            endTime: clampString(s.endTime, 20),
            bookingStatus: s.bookingStatus,
            courtFee: clampNumber(s.courtFee, 0, 100000),
            shuttlesUsed: clampNumber(s.shuttlesUsed, 0, 1000),
            shuttleUnitCost: clampNumber(s.shuttleUnitCost, 0, 1000),
            shuttleFee: clampNumber(s.shuttleFee, 0, 100000),
            maxPlayers: clampNumber(s.maxPlayers, 2, 64),
            organizerName: clampString(s.organizerName, 80),
            paymentInfo: clampString(s.paymentInfo, 160),
            feeSplitFinalized: Boolean(s.feeSplitFinalized),
            ...instantsCreateFields(
              computeInstantsFor(
                s,
                INITIAL_CLUBS.find((c) => c.id === s.clubId)
              )
            ),
            ownerId: uid,
          },
        })
      ),
      ...INITIAL_PLAYERS.map(
        (p): BatchWriteOperation => ({
          type: 'set',
          collectionName: 'players',
          docId: p.id,
          data: {
            name: clampString(p.name, 80),
            playerTag: clampString(p.playerTag, 40),
            joinedClubIdsCsv: clampString(
              p.joinedClubIdsCsv,
              400,
              'club_bintang_prime'
            ),
            wins: clampNumber(p.wins, 0, 100000),
            losses: clampNumber(p.losses, 0, 100000),
            gamesPlayed: clampNumber(p.gamesPlayed, 0, 200000),
            pointsScored: clampNumber(p.pointsScored, 0, 5000000),
            pointsConceded: clampNumber(p.pointsConceded, 0, 5000000),
            singlesWins: clampNumber(p.singlesWins, 0, 100000),
            singlesLosses: clampNumber(p.singlesLosses, 0, 100000),
            doublesWins: clampNumber(p.doublesWins, 0, 100000),
            doublesLosses: clampNumber(p.doublesLosses, 0, 100000),
            ratingScore: clampNumber(p.ratingScore, 0, 10000),
            ownerId: uid,
          },
        })
      ),
      ...INITIAL_RSVPS.map(
        (r): BatchWriteOperation => ({
          type: 'set',
          collectionName: 'rsvps',
          docId: r.id,
          data: {
            clubId: sanitizeId(r.clubId),
            sessionId: sanitizeId(r.sessionId),
            playerId: sanitizeId(r.playerId),
            playerName: clampString(r.playerName, 80),
            guestCount: Math.max(0, Math.min(4, Math.floor(r.guestCount || 0))),
            status: r.status,
            attendanceOutcome: r.attendanceOutcome,
            penaltyPercentApplied: clampNumber(r.penaltyPercentApplied, 0, 100),
            feeShare: clampNumber(r.feeShare, 0, 100000),
            paidStatus: r.paidStatus,
            paidMethod: clampString(r.paidMethod, 40, 'pending'),
            ownerId: uid,
          },
        })
      ),
      ...INITIAL_MATCHES.map(
        (m): BatchWriteOperation => ({
          type: 'set',
          collectionName: 'matches',
          docId: m.id,
          data: {
            clubId: sanitizeId(m.clubId),
            sessionId: sanitizeId(m.sessionId),
            matchFormat: m.matchFormat,
            teamAPlayer1Id: sanitizeId(m.teamAPlayer1Id),
            teamAPlayer1Name: clampString(m.teamAPlayer1Name, 80),
            teamAPlayer2Id: sanitizeId(m.teamAPlayer2Id),
            teamAPlayer2Name: clampString(m.teamAPlayer2Name, 80),
            teamBPlayer1Id: sanitizeId(m.teamBPlayer1Id),
            teamBPlayer1Name: clampString(m.teamBPlayer1Name, 80),
            teamBPlayer2Id: sanitizeId(m.teamBPlayer2Id),
            teamBPlayer2Name: clampString(m.teamBPlayer2Name, 80),
            scoreTeamA: clampNumber(m.scoreTeamA, 0, 500),
            scoreTeamB: clampNumber(m.scoreTeamB, 0, 500),
            setScoresText: clampString(m.setScoresText, 60),
            winnerSide: m.winnerSide,
            ownerId: uid,
          },
        })
      ),
    ];
    // Rules check that referenced clubs / sessions / players already exist, so seed in dependency
    // order: clubs & players first, then sessions, then RSVPs and matches.
    // Small batches keep each commit under the rules' 20 document-lookup limit.
    const stage = async (names: string[]) => {
      const staged = ops.filter((op) => names.includes(op.collectionName));
      for (let i = 0; i < staged.length; i += 4) {
        await safeBatchWrite(staged.slice(i, i + 4));
      }
    };
    await stage(['clubs', 'players']);
    await stage(['sessions']);
    await stage(['rsvps']);
    await stage(['matches']);
  }

  // The signed-in player is the profile linked to this Firebase account (or active dev persona in dev mode).
  const activePlayer = useMemo(() => {
    if (user && isUserVerified && playersLoaded) {
      return players.find((p) => p.authUid === user.uid) || null;
    }
    if (!user && devSession) {
      return (
        players.find((p) => p.id === devSession.playerId) ||
        players[0] ||
        null
      );
    }
    return null;
  }, [players, user, isUserVerified, playersLoaded, devSession]);

  // Mirrors isAdmin() in firestore.rules: a verified bootstrap admin email, /admins/{uid} doc, or dev admin persona
  const isAdminAccount = Boolean(
    (user &&
      isUserVerified &&
      (isBootstrapAdminEmail(user.email) || isAdminDoc)) ||
      (!user && devSession && devSession.tier === 'admin')
  );

  const ownsAnyClub = Boolean(
    activePlayer && clubs.some((c) => c.clubOwnerPlayerId === activePlayer.id)
  );

  // Effective permission tier:
  // - Site Admin ('isAdminAccount') can freely toggle between 'user', 'club_owner' (if they own a club), and 'admin'.
  // - Non-admin Club Owners ('ownsAnyClub && !isAdminAccount') are always in 'club_owner' view (no toggle to 'user').
  const effectiveTier: PermissionTier = useMemo(() => {
    if (permissionTier === 'admin' && !isAdminAccount) {
      return ownsAnyClub ? 'club_owner' : 'user';
    }
    if (permissionTier === 'club_owner' && !ownsAnyClub) {
      return isAdminAccount ? 'admin' : 'user';
    }
    if (permissionTier === 'user' && ownsAnyClub && !isAdminAccount) {
      return 'club_owner';
    }
    return permissionTier;
  }, [permissionTier, isAdminAccount, ownsAnyClub]);

  const userJoinedClubs = useMemo(() => {
    if (effectiveTier === 'admin') return clubs;
    const joinedIds = getPlayerJoinedClubIds(activePlayer);
    const joined = clubs.filter(
      (c) =>
        joinedIds.includes(c.id) ||
        (activePlayer && c.clubOwnerPlayerId === activePlayer.id)
    );
    if (effectiveTier === 'club_owner' && activePlayer) {
      // Place the owner's own club first while keeping all other joined clubs visible
      return [...joined].sort((a, b) => {
        const aOwned = a.clubOwnerPlayerId === activePlayer.id ? 0 : 1;
        const bOwned = b.clubOwnerPlayerId === activePlayer.id ? 0 : 1;
        return aOwned - bOwned;
      });
    }
    return joined;
  }, [clubs, activePlayer, effectiveTier]);

  // Clubs the player is actually a member (or owner) of — regardless of view mode.
  // The Sessions page and its club filter are scoped strictly to these.
  const memberClubs = useMemo(() => {
    const joinedIds = getPlayerJoinedClubIds(activePlayer);
    const joined = clubs.filter(
      (c) =>
        joinedIds.includes(c.id) ||
        (activePlayer && c.clubOwnerPlayerId === activePlayer.id)
    );
    if (activePlayer) {
      return [...joined].sort((a, b) => {
        const aOwned = a.clubOwnerPlayerId === activePlayer.id ? 0 : 1;
        const bOwned = b.clubOwnerPlayerId === activePlayer.id ? 0 : 1;
        return aOwned - bOwned;
      });
    }
    return joined;
  }, [clubs, activePlayer]);

  const unjoinedClubs = useMemo(() => {
    const joinedIds = getPlayerJoinedClubIds(activePlayer);
    // Private clubs are listed for members, owners and Site Admins only; a non-member never gets
    // a join card for a club whose details they may not see.
    return clubs.filter(
      (c) =>
        !joinedIds.includes(c.id) &&
        (!activePlayer || c.clubOwnerPlayerId !== activePlayer.id) &&
        (isAdminAccount || c.visibility !== 'private')
    );
  }, [clubs, activePlayer, isAdminAccount]);

  const myOwnedClub = useMemo(() => {
    if (!activePlayer) return null;
    return (
      clubs.find((c) => c.clubOwnerPlayerId === activePlayer.id) || null
    );
  }, [clubs, activePlayer]);

  // The clubs this account is a member of, exactly as the rules count them: the joinedClubIdsCsv
  // of the own player as the server has it. An owned club is not added separately — the rules grant
  // reads to members, and one foreign id in an `in` filter would deny the whole query.
  const joinedScopeKey = useMemo(
    () => clubIdsKey(parseClubIdCsv(confirmedJoinedCsv)),
    [confirmedJoinedCsv]
  );

  // Sessions, RSVPs and matches are scoped to those clubs, queried in chunks because Firestore
  // allows at most 30 values in an `in` filter. Site Admins need every club, so they keep the
  // unscoped queries. '*' marks the unscoped case; '' means "not known yet".
  const scopeKey = isAdminAccount
    ? '*'
    : confirmedJoinedCsv === null
    ? ''
    : joinedScopeKey;
  latestScopeKeyRef.current = scopeKey;

  // permission-denied on a club-scoped listener: re-check the profile mapping and resubscribe ONCE per
  // scope; a second denial for the same scope falls back to the retry screen.
  const requestListenerHeal = (scope: string): boolean => {
    // A subscription for a scope that has since changed is stale: ignore its error.
    if (latestScopeKeyRef.current !== scope) return true;
    const key = `${retryNonce}|${scope}`;
    const heal = listenerHealRef.current;
    if (heal.key !== key) {
      heal.key = key;
      heal.used = false;
    }
    if (heal.used) return false;
    heal.used = true;
    setProfileMapReady(false);
    setHealNonce((n) => n + 1);
    return true;
  };

  // Profile mapping (profiles/{uid}) lifecycle. The rules read club membership through it, so it must
  // exist before any club-scoped listener subscribes. Runs on every load: if the own player exists
  // but the mapping does not (accounts created before the mapping existed), create it.
  const ownPlayerIdForMapping =
    user && isUserVerified && playersLoaded ? activePlayer?.id ?? null : null;
  useEffect(() => {
    if (!authReady || !user || !isUserVerified || !ownPlayerIdForMapping) {
      setProfileMapReady(false);
      return;
    }
    // Sign-up and account deletion write the mapping themselves; do not race them.
    if (profileWriteInFlightRef.current) return;
    const uid = user.uid;
    const playerId = ownPlayerIdForMapping;
    let cancelled = false;
    setProfileMapReady(false);
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'profiles', uid));
        if (cancelled || profileWriteInFlightRef.current) return;
        const decision = decideProfileMapping({
          uid,
          ownPlayer: { id: playerId, authUid: uid },
          profile: snap.exists()
            ? {
                playerId: String(
                  (snap.data() as { playerId?: unknown }).playerId || ''
                ),
              }
            : null,
        });
        if (decision === 'ready') {
          setProfileMapReady(true);
          return;
        }
        if (decision === 'none') return;
        // One repair attempt per account, load and heal round: never a loop.
        const attemptKey = `${uid}|${playerId}|${retryNonce}|${healNonce}`;
        if (!profileHealLedgerRef.current.claim(attemptKey)) {
          setDataError(
            "CourtPulse couldn't finish setting up your club access. Try again."
          );
          return;
        }
        if (decision === 'replace') {
          await safeDeleteDoc('profiles', uid);
        }
        await safeSetDoc('profiles', uid, { playerId, ownerId: uid });
        if (!cancelled) setProfileMapReady(true);
      } catch (err) {
        if (cancelled) return;
        console.error('Could not confirm the club access mapping', err);
        setDataError(friendlyFirestoreMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    user,
    isUserVerified,
    ownPlayerIdForMapping,
    authVersion,
    retryNonce,
    healNonce,
  ]);

  // Clubs. Site Admins keep the single unscoped listener. Everyone else reads the public directory
  // (visibility == 'public') plus one document listener per club they belong to (and the club an
  // invite link points at); a document that is private or gone is silently left out, never fatal.
  useEffect(() => {
    if (!authReady || !user || !isUserVerified) return;
    const uid = user.uid;
    const unsubs: (() => void)[] = [];

    if (isAdminAccount) {
      // Demo auto-seeding only ever runs against the local emulators, never a real project
      const canSeed =
        Boolean(import.meta.env.DEV) &&
        import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' &&
        isBootstrapAdminEmail(user.email);
      const adminClubsQuery = query(
        collection(db, 'clubs'),
        orderBy('createdAt', 'desc'),
        limit(200)
      );
      unsubs.push(
        onSnapshot(
          adminClubsQuery,
          async (snap) => {
            // An empty cache snapshot only means "nothing cached yet"; wait for the server's answer.
            if (snap.metadata.fromCache && snap.empty) return;
            if (snap.empty && canSeed && !hasSeededCloudRef.current) {
              hasSeededCloudRef.current = true;
              try {
                await seedInitialClubDataToFirestore(uid);
              } catch (err) {
                hasSeededCloudRef.current = false;
                console.error('Demo seeding failed', err);
                showError(err);
              }
              return;
            }
            // Signed in: show only real cloud data (never the local demo seed)
            setRawClubs(
              snap.docs.map((d) => ({
                ...(d.data() as Omit<Club, 'id'>),
                id: d.id,
              }))
            );
          },
          (err) => reportListenerError('clubs', err)
        )
      );
      return () => unsubs.forEach((u) => u());
    }

    // Club documents are only readable through the profile mapping (private clubs), so wait for it.
    const memberIds =
      profileMapReady && confirmedJoinedCsv !== null
        ? clubIdsFromKey(joinedScopeKey)
        : [];
    const docIds = new Set(memberIds);
    if (pendingInviteClubId) docIds.add(sanitizeId(pendingInviteClubId));

    let directory: Club[] = [];
    const docClubs = new Map<string, Club>();
    // Commit only after every source has answered once, so the list never shows half a picture.
    const answered = new Set<string>();
    const sourceCount = 1 + docIds.size;
    const parseClub = (id: string, raw: Record<string, unknown>): Club => ({
      ...(raw as unknown as Omit<Club, 'id'>),
      id,
    });
    const commit = (source: string) => {
      answered.add(source);
      if (answered.size < sourceCount) return;
      setRawClubs(mergeById(directory, Array.from(docClubs.values())));
    };

    const directoryBase = collection(db, 'clubs');
    const subscribeDirectory = (ordered: boolean) => {
      const directoryQuery = ordered
        ? query(
            directoryBase,
            where('visibility', '==', 'public'),
            orderBy('createdAt', 'desc'),
            limit(200)
          )
        : query(directoryBase, where('visibility', '==', 'public'), limit(200));
      let unsubDirectory: () => void = () => {};
      unsubDirectory = onSnapshot(
        directoryQuery,
        (snap) => {
          if (snap.metadata.fromCache && snap.empty) return;
          directory = snap.docs.map((d) =>
            parseClub(d.id, d.data() as Record<string, unknown>)
          );
          commit('directory');
        },
        (err) => {
          // Without the (visibility, createdAt) composite index, fall back to an unordered query
          // that still constrains visibility == 'public'.
          if (ordered && isMissingIndex(err)) {
            console.warn(
              'Club directory index is missing; using an unordered query',
              err
            );
            unsubDirectory();
            subscribeDirectory(false);
            return;
          }
          reportListenerError('clubs', err);
        }
      );
      unsubs.push(() => unsubDirectory());
    };
    subscribeDirectory(true);

    docIds.forEach((clubId) => {
      unsubs.push(
        onSnapshot(
          doc(db, 'clubs', clubId),
          (snap) => {
            if (!snap.exists()) {
              // A cache miss is "unknown"; wait for the server before dropping the club.
              if (snap.metadata.fromCache) return;
              docClubs.delete(clubId);
            } else {
              docClubs.set(
                clubId,
                parseClub(snap.id, snap.data() as Record<string, unknown>)
              );
            }
            commit(`doc:${clubId}`);
          },
          (err) => {
            // A private club (or one that no longer exists) is not an error for this account.
            docClubs.delete(clubId);
            if (!isPermissionDenied(err)) {
              console.warn('Club document listener failed', err);
            }
            commit(`doc:${clubId}`);
          }
        )
      );
    });

    return () => unsubs.forEach((u) => u());
  }, [
    authReady,
    user,
    isUserVerified,
    authVersion,
    retryNonce,
    isAdminAccount,
    profileMapReady,
    joinedScopeKey,
    confirmedJoinedCsv === null,
    pendingInviteClubId,
  ]);

  // Join requests live in Firestore when signed in (so club owners on any device see them) and fall
  // back to this browser's storage in local mode. Non-admins read only their own requests and the
  // requests for clubs they own; Site Admins keep the unscoped listener.
  const ownedClubIdsKey = clubIdsKey(
    ownedClubIdsOf(activePlayer?.id, rawClubs)
  );
  // Only the server-confirmed own player (see confirmedOwnPlayerId): the rules resolve both "my
  // request" and "my club's request" through isPlayerSelf().
  const requestsPlayerId = confirmedOwnPlayerId;

  // Join requests and wallets are secondary data. A permission-denied (typically a query that raced
  // a write the server had not applied yet) is retried ONCE after a short delay and never shows the
  // full-screen error; other wallet failures keep the retry screen.
  const handleSecondaryListenerError = (
    label: string,
    err: unknown,
    fatal: boolean
  ) => {
    if (isPermissionDenied(err)) {
      console.warn(`${label} listener was denied; retrying once shortly`, err);
      const key = `${retryNonce}|${confirmedOwnPlayerId}`;
      const retry = secondaryRetryRef.current;
      if (retry.key !== key) {
        retry.key = key;
        retry.used = false;
      }
      if (!retry.used) {
        retry.used = true;
        if (retry.timer) clearTimeout(retry.timer);
        retry.timer = setTimeout(() => {
          retry.timer = null;
          setSecondaryRetryNonce((n) => n + 1);
        }, 1500);
      }
      return;
    }
    if (fatal) {
      reportListenerError(label, err);
    } else {
      console.error(`${label} listener failed`, err);
    }
  };

  useEffect(() => {
    if (!authReady) return;
    if (!user || !isUserVerified) {
      setClubJoinRequests(loadClubJoinRequests());
      return;
    }
    if (!isAdminAccount && !requestsPlayerId) {
      // No server-confirmed profile yet: there is nothing to list (and nothing to query safely).
      setClubJoinRequests([]);
      return;
    }
    const requestsBase = collection(db, 'clubJoinRequests');
    const queries: ReturnType<typeof query>[] = isAdminAccount
      ? [query(requestsBase, orderBy('createdAt', 'desc'), limit(500))]
      : [
          query(requestsBase, where('playerId', '==', requestsPlayerId), limit(200)),
          // Never an `in` with an empty array: chunkClubIds yields no chunks for no owned clubs.
          ...chunkClubIds(clubIdsFromKey(ownedClubIdsKey)).map((chunk) =>
            query(requestsBase, where('clubId', 'in', chunk), limit(500))
          ),
        ];
    const results = new Map<number, ClubJoinRequest[]>();
    // Every answer is merged and committed straight away. Waiting for ALL queries made an owner's
    // list depend on the (usually empty) "my own requests" query answering from the server: an empty
    // cache snapshot is skipped, and without metadata changes its server confirmation never arrives,
    // so the owner's requests were never shown.
    const commitMerged = () =>
      setClubJoinRequests(
        sortJoinRequestsNewestFirst(mergeById(...Array.from(results.values())))
      );
    const unsubs = queries.map((q, index) =>
      onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snap) => {
          if (snap.metadata.fromCache && snap.empty && !results.has(index)) {
            // Wait for the server's answer rather than committing an empty cache snapshot.
            return;
          }
          results.set(
            index,
            snap.docs.map((d) =>
              parseJoinRequestData(d.id, d.data() as Record<string, unknown>)
            )
          );
          commitMerged();
        },
        (err) => {
          // Requests are secondary data: never take the whole app down for them.
          handleSecondaryListenerError('Club join request', err, false);
          results.set(index, []);
          commitMerged();
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [
    authReady,
    user,
    isUserVerified,
    authVersion,
    retryNonce,
    secondaryRetryNonce,
    isAdminAccount,
    requestsPlayerId,
    ownedClubIdsKey,
  ]);

  useEffect(() => {
    // Wait for the profile mapping (and the server's membership list): the rules read both.
    if (!authReady || !user || !isUserVerified || !playersLoaded) return;
    if (!isAdminAccount && (!profileMapReady || confirmedJoinedCsv === null)) {
      return;
    }

    const unscoped = scopeKey === '*';
    const clubIds = unscoped || !scopeKey ? [] : clubIdsFromKey(scopeKey);
    // Never query with an empty `in` array: a player with no clubs simply has no club data.
    if (!unscoped && clubIds.length === 0) {
      setSessions([]);
      setRsvps([]);
      setMatches([]);
      return;
    }
    const chunks: (string[] | null)[] = unscoped
      ? [null]
      : chunkClubIds(clubIds);

    const createdAtMillis = (value: unknown): number => {
      if (value && typeof value === 'object' && 'toMillis' in value) {
        return (value as { toMillis: () => number }).toMillis();
      }
      if (typeof value === 'string' || typeof value === 'number') {
        const t = new Date(value).getTime();
        return Number.isFinite(t) ? t : 0;
      }
      return 0;
    };

    const unsubs: (() => void)[] = [];
    // Each chunk reports separately; commit only once every chunk has answered so a re-scope never
    // shows a half-loaded list, then merge by id.
    const subscribeScoped = <T extends { id: string }>(
      label: string,
      orderField: string,
      cap: number,
      parse: (id: string, raw: Record<string, unknown>) => T,
      sortMerged: (a: T, b: T) => number,
      commit: (items: T[]) => void
    ) => {
      const results = new Map<number, T[]>();
      chunks.forEach((chunk, index) => {
        const base = collection(db, label);
        const scopedQuery = chunk
          ? query(
              base,
              where('clubId', 'in', chunk),
              orderBy(orderField, 'desc'),
              limit(cap)
            )
          : query(base, orderBy(orderField, 'desc'), limit(cap));
        unsubs.push(
          onSnapshot(
            scopedQuery,
            (snap) => {
              // Wait for the server instead of committing an empty cache snapshot.
              if (snap.metadata.fromCache && snap.empty) return;
              results.set(
                index,
                snap.docs.map((d) =>
                  parse(d.id, d.data() as Record<string, unknown>)
                )
              );
              if (results.size < chunks.length) return;
              const byId = new Map<string, T>();
              results.forEach((list) =>
                list.forEach((item) => byId.set(item.id, item))
              );
              const merged = Array.from(byId.values());
              if (chunks.length > 1) merged.sort(sortMerged);
              commit(merged);
            },
            (err) => {
              if (isPermissionDenied(err) && requestListenerHeal(scopeKey)) {
                console.warn(
                  `Club-scoped ${label} listener was denied; re-checking club access once`,
                  err
                );
                return;
              }
              reportListenerError(label, err);
            }
          )
        );
      });
    };

    subscribeScoped<Session>(
      'sessions',
      'sessionDate',
      200,
      parseSessionDoc,
      (a, b) => String(b.sessionDate).localeCompare(String(a.sessionDate)),
      setSessions
    );
    subscribeScoped<SessionRsvp>(
      'rsvps',
      'createdAt',
      2000,
      parseRsvpDoc,
      (a, b) =>
        createdAtMillis((b as { createdAt?: unknown }).createdAt) -
        createdAtMillis((a as { createdAt?: unknown }).createdAt),
      setRsvps
    );
    subscribeScoped<BadmintonMatch>(
      'matches',
      'createdAt',
      1500,
      parseMatchDoc,
      (a, b) =>
        createdAtMillis((b as { createdAt?: unknown }).createdAt) -
        createdAtMillis((a as { createdAt?: unknown }).createdAt),
      setMatches
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [
    authReady,
    user,
    isUserVerified,
    playersLoaded,
    scopeKey,
    isAdminAccount,
    profileMapReady,
    confirmedJoinedCsv === null,
    healNonce,
    authVersion,
    retryNonce,
  ]);

  // Scoped clubWallets listener:
  // - Site Admins read all clubWallets
  // - Players read their own wallets (where playerId == activePlayer.id)
  // - Club Owners read all wallets in every club they own (one where clubId == id query each)
  useEffect(() => {
    if (!authReady || !user || !isUserVerified) return;
    // Wait for the server-confirmed own player (see confirmedOwnPlayerId): the wallet rules resolve
    // "my wallet" and "my club's wallets" through isPlayerSelf().
    if (!isAdminAccount && !confirmedOwnPlayerId) return;

    const parseWalletDoc = (raw: Record<string, unknown>) => {
      const clubId = String(raw.clubId || '');
      const playerId = String(raw.playerId || '');
      if (!clubId || !playerId) return null;
      return {
        key: makeClubWalletKey(clubId, playerId),
        wallet: {
          creditBalance:
            typeof raw.creditBalance === 'number'
              ? Math.max(0, Number(raw.creditBalance.toFixed(2)))
              : 0,
          freeSessionPasses:
            typeof raw.freeSessionPasses === 'number'
              ? Math.max(0, Math.floor(raw.freeSessionPasses))
              : 0,
          waiveAllFees: Boolean(raw.waiveAllFees),
        },
      };
    };

    if (isAdminAccount) {
      const adminWalletsQuery = query(collection(db, 'clubWallets'), limit(1000));
      return onSnapshot(
        adminWalletsQuery,
        (snap) => {
          const nextIds = new Set<string>();
          const nextMap: Record<string, PlayerBenefitWallet> = {};
          snap.docs.forEach((d) => {
            nextIds.add(d.id);
            const parsed = parseWalletDoc(d.data() as Record<string, unknown>);
            if (parsed) nextMap[parsed.key] = parsed.wallet;
          });
          cloudWalletDocIdsRef.current = nextIds;
          setPlayerWalletsMap(nextMap);
        },
        (err) => reportListenerError('clubWallets', err)
      );
    }

    const selfIds = new Set<string>();
    const selfMap: Record<string, PlayerBenefitWallet> = {};
    const clubIdsByClub = new Map<string, Set<string>>();
    const clubMapsByClub = new Map<string, Record<string, PlayerBenefitWallet>>();

    const syncCombinedWallets = () => {
      const allClubIds: string[] = [];
      clubIdsByClub.forEach((ids) => allClubIds.push(...Array.from(ids)));
      cloudWalletDocIdsRef.current = new Set([...Array.from(selfIds), ...allClubIds]);
      const combined: Record<string, PlayerBenefitWallet> = { ...selfMap };
      clubMapsByClub.forEach((map) => Object.assign(combined, map));
      setPlayerWalletsMap(combined);
    };

    const unsubs: (() => void)[] = [];

    if (confirmedOwnPlayerId) {
      const selfWalletsQuery = query(
        collection(db, 'clubWallets'),
        where('playerId', '==', confirmedOwnPlayerId),
        limit(100)
      );
      unsubs.push(
        onSnapshot(
          selfWalletsQuery,
          (snap) => {
            selfIds.clear();
            Object.keys(selfMap).forEach((k) => delete selfMap[k]);
            snap.docs.forEach((d) => {
              selfIds.add(d.id);
              const parsed = parseWalletDoc(d.data() as Record<string, unknown>);
              if (parsed) selfMap[parsed.key] = parsed.wallet;
            });
            syncCombinedWallets();
          },
          (err) => handleSecondaryListenerError('clubWallets', err, true)
        )
      );
    }

    const ownedClubIds = ownedClubIdsKey ? ownedClubIdsKey.split(',') : [];
    for (const ownedClubId of ownedClubIds) {
      const ownedClubWalletsQuery = query(
        collection(db, 'clubWallets'),
        where('clubId', '==', ownedClubId),
        limit(500)
      );
      unsubs.push(
        onSnapshot(
          ownedClubWalletsQuery,
          (snap) => {
            const ids = new Set<string>();
            const map: Record<string, PlayerBenefitWallet> = {};
            snap.docs.forEach((d) => {
              ids.add(d.id);
              const parsed = parseWalletDoc(d.data() as Record<string, unknown>);
              if (parsed) map[parsed.key] = parsed.wallet;
            });
            clubIdsByClub.set(ownedClubId, ids);
            clubMapsByClub.set(ownedClubId, map);
            syncCombinedWallets();
          },
          (err) => handleSecondaryListenerError('clubWallets', err, true)
        )
      );
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [
    authReady,
    user,
    isUserVerified,
    authVersion,
    retryNonce,
    secondaryRetryNonce,
    isAdminAccount,
    confirmedOwnPlayerId,
    ownedClubIdsKey,
  ]);

  const activeClub = useMemo(() => {
    if (activeClubId === 'all') {
      return (
        myOwnedClub ||
        userJoinedClubs[0] ||
        clubs[0] ||
        EMPTY_CLUB_PLACEHOLDER
      );
    }
    return (
      userJoinedClubs.find((c) => c.id === activeClubId) ||
      myOwnedClub ||
      userJoinedClubs[0] ||
      clubs[0] ||
      EMPTY_CLUB_PLACEHOLDER
    );
  }, [userJoinedClubs, activeClubId, clubs, myOwnedClub]);

  // Strict per-club management check:
  // - Site Admin ('admin') can manage any real club
  // - Club Owner ('club_owner') can ONLY manage the single club where clubOwnerPlayerId === activePlayer.id
  // - In any club not owned by the person, they have zero management rights and behave like a normal user
  const canManageClubById = (targetClubId?: string | null): boolean => {
    if (!targetClubId || targetClubId === EMPTY_CLUB_PLACEHOLDER.id) {
      return false;
    }
    if (effectiveTier === 'admin') return true;
    if (effectiveTier === 'club_owner' && activePlayer) {
      const target = clubs.find((c) => c.id === targetClubId);
      return Boolean(target && target.clubOwnerPlayerId === activePlayer.id);
    }
    return false;
  };

  // Financial & Wallet ownership check: ONLY the actual owner of a club (when in Owner or Admin mode) can manage its balances, payments, and wallets
  const isOwnerOfClubById = (targetClubId?: string | null): boolean => {
    if (!targetClubId || !activePlayer || effectiveTier === 'user') {
      return false;
    }
    const target = clubs.find((c) => c.id === targetClubId);
    return Boolean(target && target.clubOwnerPlayerId === activePlayer.id);
  };

  // Does the current user have management rights over the currently active club view?
  const canManageActiveClub = useMemo(() => {
    if (effectiveTier === 'admin') return true;
    if (effectiveTier === 'club_owner' && activePlayer) {
      if (activeClubId === 'all' && activeTab === 'sessions') {
        return userJoinedClubs.some(
          (c) => c.clubOwnerPlayerId === activePlayer.id
        );
      }
      if (activeTab === 'users' && myOwnedClub) {
        return true;
      }
      return Boolean(
        activeClub && activeClub.clubOwnerPlayerId === activePlayer.id
      );
    }
    return false;
  }, [
    effectiveTier,
    activePlayer,
    activeClub,
    activeClubId,
    activeTab,
    userJoinedClubs,
    myOwnedClub,
  ]);

  const canManageFunds =
    canManageActiveClub ||
    effectiveTier === 'admin' ||
    (effectiveTier === 'club_owner' && Boolean(myOwnedClub));

  // The Sessions page (and its club filter) only ever lists clubs the player has joined.
  // Site Admins read every club's sessions, so a club they made active without joining it is listed too
  // (otherwise the header would name one club while the list shows another).
  const sessionTabClubs = useMemo(
    () =>
      effectiveTier === 'admin' &&
      activeClub &&
      activeClub.id !== EMPTY_CLUB_PLACEHOLDER.id &&
      !memberClubs.some((c) => c.id === activeClub.id)
        ? [...memberClubs, activeClub]
        : memberClubs,
    [effectiveTier, activeClub, memberClubs]
  );
  const selectorClubs =
    activeTab === 'sessions' ? sessionTabClubs : userJoinedClubs;

  // Only the Sessions overview needs the "All Clubs" combined feed option when the player has joined multiple clubs.
  const isAllClubsAllowedOnTab =
    activeTab === 'sessions' && sessionTabClubs.length > 1;
  const showTopClubSelectorOnTab =
    selectorClubs.length > 1 &&
    (activeTab === 'sessions' ||
      activeTab === 'rsvp' ||
      activeTab === 'leaderboard');

  const effectiveClubId = (() => {
    if (isAllClubsAllowedOnTab && activeClubId === 'all') return 'all';
    if (activeTab === 'sessions') {
      if (activeClub && sessionTabClubs.some((c) => c.id === activeClub.id)) {
        return activeClub.id;
      }
      if (isAllClubsAllowedOnTab) return 'all';
      return myOwnedClub?.id || sessionTabClubs[0]?.id || 'none';
    }
    // Non-admins never see data from a club they have not joined (activeClub falls back to the
    // first platform club when the player has no clubs yet).
    if (
      effectiveTier !== 'admin' &&
      !(activeClub && memberClubs.some((c) => c.id === activeClub.id))
    ) {
      return myOwnedClub?.id || 'none';
    }
    return activeClub?.id || 'none';
  })();

  const scopedClubIdSet = useMemo(
    () =>
      effectiveClubId === 'all'
        ? new Set(sessionTabClubs.map((c) => c.id))
        : new Set([effectiveClubId]),
    [effectiveClubId, sessionTabClubs]
  );

  const sessionsViewClub =
    sessionTabClubs.find((c) => c.id === effectiveClubId) ||
    sessionTabClubs[0] ||
    null;

  const clubSessions = useMemo(
    () => sessions.filter((s) => scopedClubIdSet.has(s.clubId)),
    [sessions, scopedClubIdSet]
  );

  const clubRsvps = useMemo(
    () => rsvps.filter((r) => scopedClubIdSet.has(r.clubId)),
    [rsvps, scopedClubIdSet]
  );

  const clubMatches = useMemo(
    () => matches.filter((m) => scopedClubIdSet.has(m.clubId)),
    [matches, scopedClubIdSet]
  );

  const clubPlayers = useMemo(
    () =>
      players.filter((p) =>
        getPlayerJoinedClubIds(p).some((id) => scopedClubIdSet.has(id))
      ),
    [players, scopedClubIdSet]
  );

  const rankedClubPlayers = useMemo(
    () => computePlayerLeaderboardAndTiers(clubPlayers, clubMatches, sessions),
    [clubPlayers, clubMatches, sessions]
  );

  const activePlayerDebts = useMemo(() => {
    if (!activePlayer) return [];
    const joinedClubIds = getPlayerJoinedClubIds(activePlayer);
    const allowedSessions = sessions.filter((s) =>
      joinedClubIds.includes(s.clubId)
    );
    return calculateOutstandingBalancesForPlayer(
      activePlayer.id,
      allowedSessions,
      rsvps,
      undefined,
      clubs
    );
  }, [activePlayer, sessions, rsvps, clubs]);

  const myUnpaidTotal = useMemo(
    () =>
      activePlayerDebts
        .filter((d) => d.rsvp.paidStatus === 'unpaid')
        .reduce((sum, item) => sum + item.rsvp.feeShare, 0),
    [activePlayerDebts]
  );

  const myPendingTotal = useMemo(
    () =>
      activePlayerDebts
        .filter((d) => d.rsvp.paidStatus === 'pending_approval')
        .reduce((sum, item) => sum + item.rsvp.feeShare, 0),
    [activePlayerDebts]
  );

  const currentLockerPlayer: HostPlayerSummary | null = useMemo(
    () => (activePlayer ? toLockerPlayer(activePlayer) : null),
    [activePlayer]
  );

  // Invite links (?club=&session=) never join anyone silently: a non-member always gets the
  // confirm card (join, or request to join a private club). The session param is honoured only
  // when that session really belongs to the club; the query string is stripped once handled.
  const inviteHandlingRef = useRef<string | null>(null);
  // The invited session id of a link the player has not joined yet. Sessions are readable by
  // members only, so it is checked after the join (see validateInviteSession).
  const postJoinSessionIdRef = useRef<string | null>(null);

  // A session id from an invite link counts only if that session really belongs to the club.
  // Non-members cannot read sessions: permission-denied means "ignore the session param".
  const validateInviteSession = async (
    clubId: string,
    sessionIdParam: string
  ): Promise<string | null> => {
    try {
      if (user) {
        const snap = await getDoc(
          doc(db, 'sessions', sanitizeId(sessionIdParam))
        );
        const data = snap.exists()
          ? (snap.data() as { clubId?: unknown })
          : null;
        return data && data.clubId === clubId ? snap.id : null;
      }
      const local = sessions.find((s) => s.id === sessionIdParam);
      return local && local.clubId === clubId ? local.id : null;
    } catch (err) {
      if (!isPermissionDenied(err)) {
        console.error('Could not verify the invited session', err);
      }
      return null;
    }
  };

  useEffect(() => {
    if (!activePlayer || !pendingInviteClubId) return;
    const inviteClubId = sanitizeId(pendingInviteClubId);
    const handlingKey = `${inviteClubId}|${pendingInviteSessionId || ''}`;
    if (inviteHandlingRef.current === handlingKey) return;
    inviteHandlingRef.current = handlingKey;

    const alreadyJoined = hasPlayerJoinedClub(activePlayer, inviteClubId);
    const sessionIdParam = pendingInviteSessionId;
    const loadedClub = clubs.find((c) => c.id === inviteClubId) || null;

    const finish = () => {
      setPendingInviteClubId(null);
      setPendingInviteSessionId(null);
      inviteHandlingRef.current = null;
      consumeInviteLink();
    };

    const handleInvite = async () => {
      // Resolve the club by id. Public (or a club the player belongs to) is readable; a private
      // club answers permission-denied and stays a generic "private club" card with no name.
      let club: Club | null = loadedClub;
      if (!club) {
        if (!user) {
          // Local demo mode: the link points at a club that is not here.
          finish();
          return;
        }
        let kind = classifyInviteLookup({});
        try {
          const snap = await getDoc(doc(db, 'clubs', inviteClubId));
          if (snap.exists()) {
            club = {
              ...(snap.data() as Omit<Club, 'id'>),
              id: snap.id,
            };
          }
          kind = classifyInviteLookup({ exists: snap.exists() });
        } catch (err) {
          kind = classifyInviteLookup({ errorCode: getErrorCode(err) });
          if (kind === 'error') console.error('Could not look up the invited club', err);
        }
        if (kind === 'missing' || kind === 'error') {
          // Stale or unreachable link: ignore it.
          finish();
          return;
        }
      }

      if (alreadyJoined) {
        setActiveClubId(inviteClubId);
        if (sessionIdParam) {
          const validSessionId = await validateInviteSession(
            inviteClubId,
            sessionIdParam
          );
          if (validSessionId) {
            setSelectedSessionId(validSessionId);
            setActiveTab('rsvp');
          }
        }
      } else {
        // Ask first; the session is checked and opened after the player actually joins.
        postJoinSessionIdRef.current = sessionIdParam;
        setInviteClubInfo({ id: inviteClubId, club });
        setClubJoinModalClubId(inviteClubId);
      }
      finish();
    };
    void handleInvite().catch((err) => {
      console.error('Invite link handling failed', err);
      finish();
    });
  }, [activePlayer, pendingInviteClubId, pendingInviteSessionId, clubs]);

  // If the user switches to a club they do not own (or switches to 'user' mode) while on 'users',
  // redirect them to 'sessions' so normal users never stay on fund-management views.
  useEffect(() => {
    if (activeTab === 'users' && !canManageFunds) {
      setActiveTab('sessions');
    }
  }, [activeTab, canManageFunds]);

  const handleSetTier = (nextTier: PermissionTier) => {
    setPermissionTier(nextTier);
    if (user) saveViewMode(user.uid, nextTier);
    if (nextTier === 'user' && activeTab === 'users') {
      setActiveTab('sessions');
    } else if (nextTier === 'club_owner' && myOwnedClub) {
      setActiveClubId(myOwnedClub.id);
    }
  };

  // First sign-in: create the player profile linked to this account. The id is derived from the
  // account uid so each account can only ever create one profile (enforced by the rules).
  const handleCreateOwnProfile = async (name: string) => {
    if (!user || !isUserVerified) return;
    const cleanName = clampString(name, 80, user.displayName || 'New Player');
    const shortPrefix =
      cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || 'player';
    const randomPin = Math.floor(100 + Math.random() * 900);
    // Never join a club silently: an invited club (public or private) is offered through the
    // confirm card once the profile exists.
    const newPlayer: Player = {
      id: sanitizeId(`player_${user.uid}`),
      name: cleanName,
      playerTag: clampString(`${shortPrefix}#${randomPin}`, 40),
      joinedClubIdsCsv: '',
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
      authUid: user.uid,
      ownerId: user.uid,
    };
    // The mapping self-heal must not race this write.
    profileWriteInFlightRef.current = true;
    setPlayers((prev) =>
      prev.some((p) => p.id === newPlayer.id) ? prev : [...prev, newPlayer]
    );
    const { id, ...payload } = newPlayer;
    try {
      // An older mapping that points elsewhere can only be replaced by the account deleting it
      // first (the rules allow only an admin to update one).
      const staleMapping = await getDoc(doc(db, 'profiles', user.uid));
      if (staleMapping.exists()) await safeDeleteDoc('profiles', user.uid);
      // Player and account->player mapping land together: the rules need the player (after this
      // batch) to point back at the account before they accept the mapping.
      await safeBatchWrite([
        { type: 'set', collectionName: 'players', docId: id, data: payload },
        {
          type: 'set',
          collectionName: 'profiles',
          docId: user.uid,
          data: { playerId: id, ownerId: user.uid },
        },
      ]);
      setProfileMapReady(true);
    } catch (err) {
      // Roll the optimistic profile back so onboarding is shown again, and let the form show why.
      setPlayers((prev) => prev.filter((p) => p.id !== newPlayer.id));
      throw err;
    } finally {
      profileWriteInFlightRef.current = false;
    }
  };

  // Ask a Site Admin to link this account to an existing, unlinked player profile
  const handleRequestProfileClaim = async (playerId: string) => {
    if (!user || !isUserVerified || !user.email) return;
    // A Site Admin needs no approval: link the unlinked profile straight away
    if (isAdminAccount) {
      const target = players.find((p) => p.id === playerId);
      if (!target || target.authUid) return;
      setPlayers((prev) =>
        prev.map((p) => (p.id === playerId ? { ...p, authUid: user.uid } : p))
      );
      try {
        await safeUpdateDoc('players', playerId, { authUid: user.uid });
      } catch (err) {
        setPlayers((prev) =>
          prev.map((p) => (p.id === playerId ? { ...p, authUid: target.authUid } : p))
        );
        throw err;
      }
      return;
    }
    const previousClaim = myProfileClaim;
    setMyProfileClaim({ playerId });
    try {
      // Claims cannot be updated (rules), so clear any earlier one before filing the new one.
      await safeDeleteDoc('profileClaims', user.uid);
      await safeSetDoc('profileClaims', user.uid, {
        playerId: sanitizeId(playerId),
        email: user.email,
        displayName: clampString(user.displayName || '', 80, ''),
      });
    } catch (err) {
      setMyProfileClaim(previousClaim);
      throw err;
    }
  };

  const handleCancelProfileClaim = async () => {
    if (!user) return;
    const previousClaim = myProfileClaim;
    setMyProfileClaim(null);
    try {
      await safeDeleteDoc('profileClaims', user.uid);
    } catch (err) {
      setMyProfileClaim(previousClaim);
      throw err;
    }
  };

  const handleApproveProfileClaim = async (claimUid: string) => {
    if (!isAdminAccount) return;
    const claim = profileClaims.find((c) => c.uid === claimUid);
    if (!claim) return;
    const target = players.find((p) => p.id === claim.playerId);
    // Never link an account twice, or a profile that already belongs to someone
    const alreadyLinked = players.some((p) => p.authUid === claimUid);
    if (!target || target.authUid || alreadyLinked) {
      try {
        await safeDeleteDoc('profileClaims', claimUid);
      } catch (err) {
        showError(err);
      }
      return;
    }
    setPlayers((prev) =>
      prev.map((p) => (p.id === target.id ? { ...p, authUid: claimUid } : p))
    );
    try {
      // The claimant reads club data through profiles/{uid}. An existing mapping can only be
      // UPDATED by an admin (keeping createdAt); otherwise it is created, in the same batch.
      const existingMapping = await getDoc(doc(db, 'profiles', claimUid));
      await safeBatchWrite([
        {
          type: 'update',
          collectionName: 'players',
          docId: target.id,
          updates: { authUid: claimUid },
        },
        buildProfileMappingOp({
          accountUid: claimUid,
          playerId: target.id,
          writerUid: user?.uid ?? '',
          exists: existingMapping.exists(),
        }),
        { type: 'delete', collectionName: 'profileClaims', docId: claimUid },
      ]);
    } catch (err) {
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === target.id ? { ...p, authUid: target.authUid } : p
        )
      );
      showError(err);
    }
  };

  const handleRejectProfileClaim = async (claimUid: string) => {
    if (!isAdminAccount) return;
    const rejected = profileClaims.find((c) => c.uid === claimUid);
    setProfileClaims((prev) => prev.filter((c) => c.uid !== claimUid));
    try {
      await safeDeleteDoc('profileClaims', claimUid);
    } catch (err) {
      if (rejected) setProfileClaims((prev) => [...prev, rejected]);
      showError(err);
    }
  };

  // Adds a club to a player's memberships. actingClubId tells the rules which club authorises
  // the change (a public club the player joins themselves, or the approving owner's club).
  const addPlayerToClub = async (player: Player, clubId: string) => {
    const currentCsv = (player.joinedClubIdsCsv || '').trim();
    const nextCsv = appendClubToCsv(currentCsv, clubId);
    if (nextCsv === currentCsv) return;
    setPlayers((prev) =>
      prev.map((p) =>
        p.id === player.id
          ? { ...p, joinedClubIdsCsv: nextCsv, actingClubId: clubId }
          : p
      )
    );
    if (user) {
      try {
        await safeUpdateDoc('players', player.id, {
          joinedClubIdsCsv: nextCsv,
          actingClubId: clubId,
        });
      } catch (err) {
        setPlayers((prev) =>
          prev.map((p) =>
            p.id === player.id
              ? {
                  ...p,
                  joinedClubIdsCsv: player.joinedClubIdsCsv,
                  actingClubId: player.actingClubId,
                }
              : p
          )
        );
        throw err;
      }
    }
  };

  // Removes a club from a player's memberships (used when a member leaves an unowned club or a manager removes them).
  const removePlayerFromClub = async (player: Player, clubId: string) => {
    const targetClub = clubs.find((c) => c.id === clubId);
    if (targetClub && targetClub.clubOwnerPlayerId === player.id) {
      return;
    }
    const currentCsv = (player.joinedClubIdsCsv || '').trim();
    const nextCsv = removeClubFromCsv(currentCsv, clubId);
    if (nextCsv === currentCsv) return;

    // Only RSVPs the rules let a player or club manager delete (open, not yet finalized) are
    // withdrawn with the membership; anything else stays as club history.
    const openSessionIds = new Set(
      sessions
        .filter(
          (s) =>
            s.clubId === clubId &&
            (s.bookingStatus === 'pending' || s.bookingStatus === 'booked') &&
            !s.feeSplitFinalized
        )
        .map((s) => s.id)
    );
    // A player leaving by themself may only drop rows the rules let them: an 'out' row, or a
    // 'going' row still inside the free-cancel window. A booking past that window stays (it
    // still owes the late fee); one refused row would otherwise block leaving the club at all.
    const actingAsManager = canManageClubById(clubId);
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const nowMs = Date.now();
    const removableOpenRsvps = rsvps.filter((r) => {
      if (
        r.playerId !== player.id ||
        r.clubId !== clubId ||
        !openSessionIds.has(r.sessionId) ||
        r.status === 'late_out' ||
        r.feeShare !== 0 ||
        r.paidStatus !== 'unpaid'
      ) {
        return false;
      }
      if (actingAsManager || r.status === 'out') return true;
      const freeUntilMs = toEpochMs(sessionById.get(r.sessionId)?.freeCancelUntil);
      return freeUntilMs !== null && nowMs <= freeUntilMs;
    });
    const removableRsvpIds = new Set(removableOpenRsvps.map((r) => r.id));

    setPlayers((prev) =>
      prev.map((p) =>
        p.id === player.id
          ? { ...p, joinedClubIdsCsv: nextCsv, actingClubId: clubId }
          : p
      )
    );
    if (removableRsvpIds.size > 0) {
      setRsvps((prev) => prev.filter((r) => !removableRsvpIds.has(r.id)));
    }
    if (activePlayer && player.id === activePlayer.id && activeClubId === clubId) {
      const remainingJoined = getPlayerJoinedClubIds({
        ...player,
        joinedClubIdsCsv: nextCsv,
      });
      setActiveClubId(remainingJoined[0] || 'all');
    }

    if (user) {
      try {
        await safeBatchWrite([
          {
            type: 'update',
            collectionName: 'players',
            docId: player.id,
            updates: {
              joinedClubIdsCsv: nextCsv,
              actingClubId: clubId,
            },
          },
          ...removableOpenRsvps.map(
            (r): BatchWriteOperation => ({
              type: 'delete',
              collectionName: 'rsvps',
              docId: r.id,
            })
          ),
        ]);
      } catch (err) {
        // Put the membership and the withdrawn RSVPs back; nothing was written.
        setPlayers((prev) =>
          prev.map((p) =>
            p.id === player.id
              ? {
                  ...p,
                  joinedClubIdsCsv: player.joinedClubIdsCsv,
                  actingClubId: player.actingClubId,
                }
              : p
          )
        );
        if (removableOpenRsvps.length > 0) {
          setRsvps((prev) => [
            ...prev,
            ...removableOpenRsvps.filter(
              (r) => !prev.some((existing) => existing.id === r.id)
            ),
          ]);
        }
        throw err;
      }
    }
  };

  // Callers (Settings, Clubs) show the thrown message next to the Leave button.
  const handleLeaveClub = async (clubId: string) => {
    if (!activePlayer) return;
    const targetClub = clubs.find((c) => c.id === clubId);
    if (!targetClub || targetClub.clubOwnerPlayerId === activePlayer.id) return;
    // Block leaving if the member has unsettled session debt in this club
    const hasUnsettledDebtInClub = activePlayerDebts.some(
      (d) => d.rsvp.clubId === clubId && d.rsvp.feeShare > 0
    );
    if (hasUnsettledDebtInClub) {
      throw new Error(
        'Settle your outstanding session fees in this club before leaving it.'
      );
    }
    await removePlayerFromClub(activePlayer, clubId);
  };

  const handleRemoveMemberFromClub = async (
    playerId: string,
    clubId: string
  ) => {
    if (!canManageClubById(clubId)) return;
    const targetPlayer = players.find((p) => p.id === playerId);
    if (!targetPlayer) return;
    try {
      await removePlayerFromClub(targetPlayer, clubId);
    } catch (err) {
      showError(err);
    }
  };

  const handleAcceptJoinClub = async (clubId: string) => {
    if (!activePlayer) return;
    const previousActiveClubId = activeClubId;
    setActiveClubId(clubId);
    setClubJoinModalClubId(null);
    try {
      await addPlayerToClub(activePlayer, clubId);
    } catch (err) {
      setActiveClubId(previousActiveClubId);
      showError(err);
      return;
    }
    // Joined: any earlier request of mine for this club is moot.
    void removeClubJoinRequests(
      (r) => r.clubId === clubId && r.playerId === activePlayer.id
    ).catch(showError);
    const postJoinSessionId = postJoinSessionIdRef.current;
    postJoinSessionIdRef.current = null;
    if (postJoinSessionId) {
      // Now a member, so the invited session can be read and checked against the club.
      const validSessionId = await validateInviteSession(
        clubId,
        postJoinSessionId
      );
      if (validSessionId) {
        setSelectedSessionId(validSessionId);
        setActiveTab('rsvp');
      }
    }
  };

  const addClubJoinRequest = async (request: ClubJoinRequest) => {
    let added = false;
    setClubJoinRequests((prev) => {
      if (prev.some((r) => r.id === request.id)) return prev;
      added = true;
      const next = [...prev, request];
      if (!user) saveClubJoinRequests(next);
      return next;
    });
    if (user) {
      try {
        await safeSetDoc('clubJoinRequests', request.id, {
          clubId: request.clubId,
          playerId: request.playerId,
          playerName: clampString(request.playerName, 80, 'Player'),
          playerTag: clampString(request.playerTag, 40, 'player'),
          ownerId: user.uid,
        });
      } catch (err) {
        if (added) {
          setClubJoinRequests((prev) => prev.filter((r) => r.id !== request.id));
        }
        throw err;
      }
    }
  };

  const removeClubJoinRequests = async (
    shouldRemove: (r: ClubJoinRequest) => boolean
  ) => {
    const removed = clubJoinRequests.filter(shouldRemove);
    const removedIds = removed.map((r) => r.id);
    if (removedIds.length === 0) return;
    setClubJoinRequests((prev) => {
      const next = prev.filter((r) => !removedIds.includes(r.id));
      if (!user) saveClubJoinRequests(next);
      return next;
    });
    if (user) {
      try {
        await safeBatchWrite(
          removedIds.map(
            (id): BatchWriteOperation => ({
              type: 'delete',
              collectionName: 'clubJoinRequests',
              docId: id,
            })
          )
        );
      } catch (err) {
        setClubJoinRequests((prev) => [
          ...prev,
          ...removed.filter((r) => !prev.some((p) => p.id === r.id)),
        ]);
        throw err;
      }
    }
  };

  // Public clubs: join instantly. Private clubs: file a join request for the owner to approve.
  const handleJoinOrRequestClub = async (clubId: string) => {
    if (!activePlayer) return;
    // A private club behind an invite link is not readable by a non-member: its card is generic
    // (inviteClubInfo.club is null) and the request is filed for the club id alone.
    const targetClub =
      clubs.find((c) => c.id === clubId) ||
      (inviteClubInfo?.id === clubId ? inviteClubInfo.club : null);
    const isPrivateInviteOnly =
      !targetClub && inviteClubInfo?.id === clubId && inviteClubInfo.club === null;
    if (
      (!targetClub && !isPrivateInviteOnly) ||
      hasPlayerJoinedClub(activePlayer, clubId)
    ) {
      setClubJoinModalClubId(null);
      return;
    }
    if (targetClub && !isClubPrivate(targetClub)) {
      await handleAcceptJoinClub(clubId);
      return;
    }
    if (!enforceRateLimit('club_join_request')) return;
    setClubJoinModalClubId(null);
    // Deterministic id (one request per player per club) — mirrored by the Firestore rules
    try {
      await addClubJoinRequest({
        id: sanitizeId(`joinreq_${clubId}_${activePlayer.id}`),
        clubId,
        playerId: activePlayer.id,
        playerName: activePlayer.name,
        playerTag: activePlayer.playerTag,
        requestedAt: new Date().toISOString(),
      });
    } catch (err) {
      showError(err);
    }
  };

  const handleCancelClubJoinRequest = (clubId: string) => {
    if (!activePlayer) return;
    void removeClubJoinRequests(
      (r) => r.clubId === clubId && r.playerId === activePlayer.id
    ).catch(showError);
  };

  // Approval is ONE batch: add the club to the player and delete the request together. The rules
  // require the request to exist before the write when the player has their own account, so the
  // request must never be deleted first.
  const handleApproveClubJoinRequest = async (requestId: string) => {
    const request = clubJoinRequests.find((r) => r.id === requestId);
    if (!request || !canManageClubById(request.clubId)) return;
    const requester = players.find((p) => p.id === request.playerId);
    if (!requester) {
      showError(
        'That player could not be found. Refresh and try again, or reject the request.'
      );
      return;
    }
    if (!user) {
      // Local demo mode: no Firestore rules involved.
      void removeClubJoinRequests((r) => r.id === requestId).catch(showError);
      if (!hasPlayerJoinedClub(requester, request.clubId)) {
        await addPlayerToClub(requester, request.clubId).catch(showError);
      }
      return;
    }
    const alreadyJoined = hasPlayerJoinedClub(requester, request.clubId);
    const currentCsv = (requester.joinedClubIdsCsv || '').trim();
    const nextCsv = appendClubToCsv(currentCsv, request.clubId);
    if (!alreadyJoined) {
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === requester.id
            ? { ...p, joinedClubIdsCsv: nextCsv, actingClubId: request.clubId }
            : p
        )
      );
    }
    setClubJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
    try {
      await safeBatchWrite([
        ...(alreadyJoined
          ? []
          : [
              {
                type: 'update',
                collectionName: 'players',
                docId: requester.id,
                updates: {
                  joinedClubIdsCsv: nextCsv,
                  actingClubId: request.clubId,
                },
              } as BatchWriteOperation,
            ]),
        {
          type: 'delete',
          collectionName: 'clubJoinRequests',
          docId: requestId,
        },
      ]);
    } catch (err) {
      // Nothing was committed: restore the request and the player exactly as they were.
      if (!alreadyJoined) {
        setPlayers((prev) =>
          prev.map((p) =>
            p.id === requester.id
              ? {
                  ...p,
                  joinedClubIdsCsv: requester.joinedClubIdsCsv,
                  actingClubId: requester.actingClubId,
                }
              : p
          )
        );
      }
      setClubJoinRequests((prev) =>
        prev.some((r) => r.id === request.id) ? prev : [...prev, request]
      );
      showError(err);
    }
  };

  const handleRejectClubJoinRequest = (requestId: string) => {
    const request = clubJoinRequests.find((r) => r.id === requestId);
    if (!request || !canManageClubById(request.clubId)) return;
    // Rejecting only deletes the request; the player is never touched.
    void removeClubJoinRequests((r) => r.id === requestId).catch(showError);
  };

  const handleUpdateClubVisibility = async (
    clubId: string,
    visibility: ClubVisibility
  ) => {
    if (!canManageClubById(clubId)) return;
    setRawClubs((prev) =>
      prev.map((c) => (c.id === clubId ? { ...c, visibility } : c))
    );
    if (user) {
      await safeUpdateDoc('clubs', clubId, { visibility });
    }
  };

  // Existing players are matched by id only (never by display name across the platform):
  // `existingPlayerId` picks one. Without it a brand-new unlinked profile is created, unless the
  // club already has a member with that name.
  const handleAdminAddMemberToClub = async (
    name: string,
    targetClubId?: string,
    existingPlayerId?: string
  ) => {
    const targetClub = targetClubId
      ? clubs.find((c) => c.id === targetClubId)
      : activeClub;
    if (!targetClub || !canManageClubById(targetClub.id)) return;
    const cleanName = clampString(name, 80, 'Member');
    if (existingPlayerId) {
      const existing = players.find((p) => p.id === existingPlayerId);
      if (!existing) {
        showError('That player could not be found. Refresh and try again.');
        return;
      }
      if (hasPlayerJoinedClub(existing, targetClub.id)) {
        showError(`${existing.name} is already a member of ${targetClub.name}.`);
        return;
      }
      if (existing.authUid) {
        // A player with their own account must ask to join (the rules need their join request to
        // exist before an owner can add them); owners cannot file it on their behalf.
        showError(
          `${existing.name} has their own CourtPulse account. Ask them to request to join ${targetClub.name}, then approve the request here.`
        );
        return;
      }
      try {
        await addPlayerToClub(existing, targetClub.id);
      } catch (err) {
        showError(err);
      }
      return;
    }
    const sameNameMember = players.find(
      (p) =>
        p.name.toLowerCase() === cleanName.toLowerCase() &&
        hasPlayerJoinedClub(p, targetClub.id)
    );
    if (sameNameMember) {
      showError(`${sameNameMember.name} is already a member of ${targetClub.name}.`);
      return;
    }

    const newId = sanitizeId(`player_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const shortPrefix =
      cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || 'player';
    const randomPin = Math.floor(100 + Math.random() * 900);
    const newPlayer: Player = {
      id: newId,
      name: cleanName,
      playerTag: clampString(`${shortPrefix}#${randomPin}`, 40),
      joinedClubIdsCsv: clampString(targetClub.id, 400),
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
      ownerId,
    };

    setPlayers((prev) => [...prev, newPlayer]);
    if (user) {
      const { id, ...payload } = newPlayer;
      try {
        await safeSetDoc('players', id, payload);
      } catch (err) {
        setPlayers((prev) => prev.filter((p) => p.id !== newPlayer.id));
        showError(err);
      }
    }
  };

  const handleAssignClubOwner = async (
    clubId: string,
    ownerPlayerId: string
  ) => {
    if (effectiveTier !== 'admin') return;
    // Enforce: 1 club per Club Owner (an owner cannot own multiple clubs)
    const alreadyOwned = clubs.find(
      (c) => c.id !== clubId && c.clubOwnerPlayerId === ownerPlayerId
    );
    if (alreadyOwned) return;
    const ownerPlayer = players.find((p) => p.id === ownerPlayerId);
    if (!ownerPlayer) return;
    setRawClubs((prev) =>
      prev.map((c) =>
        c.id === clubId
          ? { ...c, ownerPlayerId, clubOwnerName: ownerPlayer.name }
          : c
      )
    );
    if (user) {
      await safeUpdateDoc('clubs', clubId, { ownerPlayerId });
    }
    // Ensure the assigned owner is also a joined member of the club they own
    await addPlayerToClub(ownerPlayer, clubId);
  };

  const handleAdminCreateUser = async (data: {
    name: string;
    ratingScore: number;
    clubIds: string[];
  }) => {
    if (!canManageActiveClub && effectiveTier !== 'admin') return;
    const cleanName = clampString(data.name, 80, 'Player');
    const newId = sanitizeId(`player_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const shortPrefix =
      cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || 'player';
    const randomPin = Math.floor(100 + Math.random() * 900);
    // Club owners can only add members to the club they own; Site Admins can create members with or without a club
    const allowedClubIds =
      effectiveTier === 'admin'
        ? data.clubIds.filter(
            (id) => Boolean(id) && id !== EMPTY_CLUB_PLACEHOLDER.id
          )
        : myOwnedClub
        ? [myOwnedClub.id]
        : activeClub && canManageClubById(activeClub.id)
        ? [activeClub.id]
        : [];
    if (effectiveTier !== 'admin' && allowedClubIds.length === 0) return;

    const joinedCsv = clampString(
      Array.from(new Set(allowedClubIds)).join(','),
      400,
      ''
    );

    const newPlayer: Player = {
      id: newId,
      name: cleanName,
      playerTag: clampString(`${shortPrefix}#${randomPin}`, 40),
      joinedClubIdsCsv: joinedCsv,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      pointsScored: 0,
      pointsConceded: 0,
      singlesWins: 0,
      singlesLosses: 0,
      doublesWins: 0,
      doublesLosses: 0,
      ratingScore: clampNumber(data.ratingScore, 800, 3000),
      ownerId,
    };

    setPlayers((prev) => [...prev, newPlayer]);
    if (user) {
      const { id, ...payload } = newPlayer;
      await safeSetDoc('players', id, payload);
    }
  };

  const handleAdminUpdateUser = async (
    playerId: string,
    updates: {
      name: string;
      clubIds: string[];
    }
  ) => {
    if (!canManageActiveClub && effectiveTier !== 'admin') return;
    const target = players.find((p) => p.id === playerId);
    if (!target) return;
    if (
      effectiveTier !== 'admin' &&
      !(myOwnedClub && hasPlayerJoinedClub(target, myOwnedClub.id))
    ) {
      return;
    }
    const cleanName = clampString(updates.name, 80, target.name);

    // Site Admins can update club memberships when needed; Club Owners preserve existing memberships
    const joinedCsv =
      effectiveTier === 'admin' && Array.isArray(updates.clubIds)
        ? clampString(
            Array.from(new Set(updates.clubIds.filter(Boolean))).join(','),
            400,
            ''
          )
        : target.joinedClubIdsCsv;

    setPlayers((prev) =>
      prev.map((p) =>
        p.id === playerId
          ? {
              ...p,
              name: cleanName,
              joinedClubIdsCsv: joinedCsv,
            }
          : p
      )
    );

    if (cleanName !== target.name) {
      setRsvps((prev) =>
        prev.map((r) =>
          r.playerId === playerId ? { ...r, playerName: cleanName } : r
        )
      );
    }

    if (user) {
      // Owners may only rename RSVPs in clubs they manage; admins update them all
      const affectedRsvps =
        cleanName !== target.name
          ? rsvps.filter(
              (r) => r.playerId === playerId && canManageClubById(r.clubId)
            )
          : [];
      await safeBatchWrite([
        {
          type: 'update',
          collectionName: 'players',
          docId: playerId,
          updates: {
            name: cleanName,
            ...(effectiveTier === 'admin' && joinedCsv !== target.joinedClubIdsCsv
              ? { joinedClubIdsCsv: joinedCsv }
              : {}),
            // Tells the rules which club authorises an owner's edit
            ...(effectiveTier !== 'admin' && myOwnedClub
              ? { actingClubId: myOwnedClub.id }
              : {}),
          },
        },
        ...affectedRsvps.map(
          (r): BatchWriteOperation => ({
            type: 'update',
            collectionName: 'rsvps',
            docId: r.id,
            updates: {
              playerName: cleanName,
            },
          })
        ),
      ]);
    }
  };

  const handleUpdateOwnProfile = async (updates: { name: string }) => {
    if (!activePlayer) return;
    const cleanName = clampString(updates.name, 80, activePlayer.name);
    const previousName = activePlayer.name;

    setPlayers((prev) =>
      prev.map((p) =>
        p.id === activePlayer.id
          ? {
              ...p,
              name: cleanName,
            }
          : p
      )
    );

    if (cleanName !== activePlayer.name) {
      setRsvps((prev) =>
        prev.map((r) =>
          r.playerId === activePlayer.id ? { ...r, playerName: cleanName } : r
        )
      );
    }

    if (user) {
      const affectedRsvps =
        cleanName !== activePlayer.name
          ? rsvps.filter((r) => r.playerId === activePlayer.id)
          : [];
      try {
        await safeBatchWrite([
          {
            type: 'update',
            collectionName: 'players',
            docId: activePlayer.id,
            updates: {
              name: cleanName,
              playerTag: activePlayer.playerTag,
            },
          },
          ...affectedRsvps.map(
            (r): BatchWriteOperation => ({
              type: 'update',
              collectionName: 'rsvps',
              docId: r.id,
              updates: {
                playerName: cleanName,
              },
            })
          ),
        ]);
      } catch (err) {
        // Restore the old name everywhere it was optimistically changed, then let Settings show why.
        setPlayers((prev) =>
          prev.map((p) =>
            p.id === activePlayer.id ? { ...p, name: previousName } : p
          )
        );
        if (cleanName !== previousName) {
          setRsvps((prev) =>
            prev.map((r) =>
              r.playerId === activePlayer.id
                ? { ...r, playerName: previousName }
                : r
            )
          );
        }
        throw err;
      }
    }
  };

  const handleOpenProfileView = (playerId?: string) => {
    setInspectedPlayerId(playerId || activePlayer?.id || null);
    setActiveTab('profile');
  };

  const handleOpenGearLocker = () => {
    setActiveTab('gear');
  };

  // The Gear tab always opens on the signed-in player's own locker.
  const handleSelectNavItem = (tab: ActiveTab) => {
    if (tab === 'gear') {
      handleOpenGearLocker();
      return;
    }
    if (
      tab === 'users' &&
      effectiveTier === 'club_owner' &&
      myOwnedClub &&
      activeClub?.id !== myOwnedClub.id
    ) {
      setActiveClubId(myOwnedClub.id);
    }
    setActiveTab(tab);
  };

  const handleAdminDeleteUser = async (playerId: string) => {
    if (effectiveTier !== 'admin' || players.length < 1) return;
    if (activePlayer && activePlayer.id === playerId) return;
    const target = players.find((p) => p.id === playerId);
    const authUid = target?.authUid || '';
    const playerRsvps = rsvps.filter((r) => r.playerId === playerId);
    const previousPlayers = rawPlayers;
    const previousRsvps = rawRsvps;

    setPlayers((prev) => prev.filter((p) => p.id !== playerId));
    setRsvps((prev) => prev.filter((r) => r.playerId !== playerId));
    void removeClubJoinRequests((r) => r.playerId === playerId);
    if (!user) return;
    try {
      // Every wallet the player has, in any club (not just the ones loaded on this screen).
      const walletSnap = await getDocs(
        query(collection(db, 'clubWallets'), where('playerId', '==', playerId))
      );
      await safeBatchWrite([
        ...playerRsvps.map(
          (r): BatchWriteOperation => ({ type: 'delete', collectionName: 'rsvps', docId: r.id })
        ),
        ...walletSnap.docs.map(
          (d): BatchWriteOperation => ({ type: 'delete', collectionName: 'clubWallets', docId: d.id })
        ),
        // The linked account's club-access mapping, profile claim and gear locker go too.
        ...(authUid
          ? ([
              { type: 'delete', collectionName: 'profiles', docId: authUid },
              { type: 'delete', collectionName: 'profileClaims', docId: authUid },
              { type: 'delete', collectionName: 'gearLockers', docId: authUid },
            ] as BatchWriteOperation[])
          : []),
        // The player document last, so a failure part-way leaves it in place to retry.
        { type: 'delete', collectionName: 'players', docId: playerId },
      ]);
    } catch (err) {
      setPlayers(previousPlayers);
      setRsvps(previousRsvps);
      showError(err);
    }
  };

  const handleDeleteClub = async (clubId: string) => {
    if (effectiveTier !== 'admin' || rawClubs.length < 1) return;
    const remaining = rawClubs.filter((c) => c.id !== clubId);
    const clubSessionIds = sessions
      .filter((s) => s.clubId === clubId)
      .map((s) => s.id);
    const clubRsvpIds = rsvps
      .filter((r) => r.clubId === clubId)
      .map((r) => r.id);
    const clubMatchesToDelete = matches.filter((m) => m.clubId === clubId);
    const clubMatchIds = clubMatchesToDelete.map((m) => m.id);
    const clubWalletDocIds = players
      .map((p) => makeCloudWalletDocId(clubId, p.id))
      .filter((docId) => cloudWalletDocIdsRef.current.has(docId));
    clubWalletDocIds.forEach((docId) =>
      cloudWalletDocIdsRef.current.delete(docId)
    );

    // Drop the deleted club from its members' joined-club lists so the dead id does
    // not keep using up their (size-limited) membership list
    const formerMembers = players
      .filter((p) => hasPlayerJoinedClub(p, clubId))
      .map((p) => ({
        id: p.id,
        joinedClubIdsCsv: getPlayerJoinedClubIds(p)
          .filter((id) => id !== clubId)
          .join(','),
      }));
    const formerMemberCsv = new Map(
      formerMembers.map((m) => [m.id, m.joinedClubIdsCsv])
    );

    setRawClubs(remaining);
    setPlayers((prev) =>
      prev.map((p) =>
        formerMemberCsv.has(p.id)
          ? { ...p, joinedClubIdsCsv: formerMemberCsv.get(p.id) || '' }
          : p
      )
    );
    setSessions((prev) => prev.filter((s) => s.clubId !== clubId));
    setRsvps((prev) => prev.filter((r) => r.clubId !== clubId));
    setMatches((prev) => prev.filter((m) => m.clubId !== clubId));
    void removeClubJoinRequests((r) => r.clubId === clubId);

    if (activeClubId === clubId && remaining[0]) {
      setActiveClubId(remaining[0].id);
    }
    if (user) {
      await safeBatchWrite([
        { type: 'delete', collectionName: 'clubs', docId: clubId },
        ...clubSessionIds.map(
          (id): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'sessions',
            docId: id,
          })
        ),
        ...clubRsvpIds.map(
          (id): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'rsvps',
            docId: id,
          })
        ),
        ...clubMatchIds.map(
          (id): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'matches',
            docId: id,
          })
        ),
        ...clubWalletDocIds.map(
          (docId): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'clubWallets',
            docId,
          })
        ),
        ...formerMembers.map(
          (m): BatchWriteOperation => ({
            type: 'update',
            collectionName: 'players',
            docId: m.id,
            updates: { joinedClubIdsCsv: m.joinedClubIdsCsv },
          })
        ),
      ]);
    }
  };

  const handleDevLogin = (persona: DevLoginPersona) => {
    if (!IS_DEV_MODE) return;
    saveDevSession(persona);
    setDevSession(persona);
    setPermissionTier(persona.tier);
    saveViewMode(persona.playerId, persona.tier);
    setAuthErrorMessage(null);
  };

  const handleSignOutAccount = async () => {
    saveDevSession(null);
    setDevSession(null);
    setAccountMenuOpen(false);
    setPaymentModalOpen(false);
    setInspectedPlayerId(null);
    setClubJoinModalClubId(null);
    if (user) {
      try {
        await signOutUser();
      } catch (err) {
        showError(describeAuthError(err) || err);
        return;
      }
    }
    // Wipe this browser's club data (payment details, billing rules, guest counts, wallets,
    // dev session, every gear locker) and every in-memory copy so the next account starts clean.
    clearAllCourtPulseLocalData();
    resetClientDataState();
    const params = getInviteParams();
    const sharedClubId = params.get('club');
    const sharedSessionId = params.get('session');

    if (sharedClubId) {
      setPendingInviteClubId(sharedClubId);
    }
    if (sharedSessionId) {
      setPendingInviteSessionId(sharedSessionId);
      setSelectedSessionId(sharedSessionId);
      setAuthGateRequestedFromPreview(false);
    } else {
      setActiveTab('sessions');
      setActiveClubId('all');
    }
  };

  const handleUpdateClubSettings = async (
    clubId: string,
    updates: {
      name: string;
      description: string;
      paymentInfo: string;
      paymentDetails?: ClubPaymentDetails;
      freeCancelHours: number;
      lockCancelHours: number;
      lateCancelFeePercent: number;
      noShowFeePercent: number;
      excludeOwnerFromBilling?: boolean;
      defaultMatchTargetPoints?: number;
      /** IANA zone the club's session times and cancel deadlines are read in. */
      timezone?: string;
    }
  ) => {
    if (!canManageClubById(clubId)) return;
    if (!enforceRateLimit('update_club')) return;

    const existingClub = clubs.find((c) => c.id === clubId);
    const previousTimeZone = resolveClubTimeZone(existingClub?.timezone);
    const nextTimeZone = isValidTimeZone(updates.timezone)
      ? updates.timezone.trim()
      : previousTimeZone;

    const cleanUpdates = {
      name: clampString(updates.name, 100, 'Badminton Club'),
      description: clampString(updates.description, 200, 'Club sessions'),
      paymentInfo: clampString(updates.paymentInfo, 160, 'PayNow'),
      freeCancelHours: clampNumber(updates.freeCancelHours, 0, 720),
      lockCancelHours: clampNumber(updates.lockCancelHours, 0, 720),
      lateCancelFeePercent: clampNumber(updates.lateCancelFeePercent, 0, 100),
      noShowFeePercent: clampNumber(updates.noShowFeePercent, 0, 100),
      timezone: nextTimeZone,
    };
    // Any of these moves the session deadlines (see resyncClubSessionInstants below)
    const instantsInputsChanged =
      nextTimeZone !== previousTimeZone ||
      cleanUpdates.freeCancelHours !== (existingClub?.freeCancelHours ?? null) ||
      cleanUpdates.lockCancelHours !== (existingClub?.lockCancelHours ?? null);
    // Keep the silent backfill away from this club's sessions until the resync has run
    if (instantsInputsChanged) instantsSyncBusyClubsRef.current.add(clubId);

    const nextExcludeOwner =
      updates.excludeOwnerFromBilling !== undefined
        ? Boolean(updates.excludeOwnerFromBilling)
        : Boolean(existingClub?.excludeOwnerFromBilling);
    const nextTargetPoints =
      updates.defaultMatchTargetPoints !== undefined
        ? clampNumber(updates.defaultMatchTargetPoints, 1, 100)
        : existingClub?.defaultMatchTargetPoints ?? 21;
    const nextCurrency = clampString(
      existingClub?.currency || 'USD',
      10,
      'USD'
    );
    const nextPaymentDetails =
      updates.paymentDetails || existingClub?.paymentDetails;
    const nextPaymentDetailsJson = nextPaymentDetails
      ? clampString(JSON.stringify(nextPaymentDetails), 2000, '')
      : undefined;

    // Snapshot for rollback if the save is rejected
    const prevRawClub = rawClubs.find((c) => c.id === clubId);
    const prevBillingMap = clubBillingRulesMap;
    const prevPaymentMap = clubPaymentMap;

    const nextBillingMap = saveClubBillingRule(
      clubId,
      nextExcludeOwner,
      nextTargetPoints,
      nextCurrency
    );
    setClubBillingRulesMap(nextBillingMap);

    if (updates.paymentDetails) {
      const nextPayMap = saveClubPaymentDetails(clubId, updates.paymentDetails);
      setClubPaymentMap(nextPayMap);
    }

    setRawClubs((prev) =>
      prev.map((c) =>
        c.id === clubId
          ? {
              ...c,
              ...cleanUpdates,
              excludeOwnerFromBilling: nextExcludeOwner,
              defaultMatchTargetPoints: nextTargetPoints,
              currency: nextCurrency,
              paymentDetails: updates.paymentDetails || c.paymentDetails,
              ...(nextPaymentDetailsJson !== undefined
                ? { paymentDetailsJson: nextPaymentDetailsJson }
                : {}),
            }
          : c
      )
    );

    // P1-3: Club policy changes (noShowFeePercent, lateCancelFeePercent, excludeOwnerFromBilling)
    // apply only to open/future sessions. Finalized sessions are historical records and are
    // never silently rewritten unless the owner explicitly reopens or recalculates that session.
    if (user) {
      try {
        await safeUpdateDoc('clubs', clubId, {
          ...cleanUpdates,
          excludeOwnerFromBilling: nextExcludeOwner,
          defaultMatchTargetPoints: nextTargetPoints,
          currency: nextCurrency,
          ...(nextPaymentDetailsJson !== undefined
            ? { paymentDetailsJson: nextPaymentDetailsJson }
            : {}),
        });
      } catch (err) {
        // Put the previous club settings back so the screen never shows terms that were not saved
        if (prevRawClub) {
          setRawClubs((prev) => prev.map((c) => (c.id === clubId ? prevRawClub : c)));
        }
        setClubBillingRulesMap(prevBillingMap);
        setClubPaymentMap(prevPaymentMap);
        reportActionError(`Club settings were not saved. ${friendlyWriteError(err)}`);
        instantsSyncBusyClubsRef.current.delete(clubId);
        return;
      }
    }

    // The three session instants depend on the club's zone and cancel hours: when any of them
    // changes, re-derive them for the club's open sessions.
    if (instantsInputsChanged) {
      await resyncClubSessionInstants(clubId, {
        timezone: nextTimeZone,
        freeCancelHours: cleanUpdates.freeCancelHours,
        lockCancelHours: cleanUpdates.lockCancelHours,
      });
    }
  };

  // Clubs whose settings are being saved: the silent backfill leaves their sessions to the resync.
  const instantsSyncBusyClubsRef = useRef<Set<string>>(new Set());

  /**
   * Writes startsAt / lateCancelUntil / freeCancelUntil for sessions whose stored instants no longer
   * match their date/time under the club's zone and cancel hours. Local state is updated first;
   * cloud writes go in small batches (<= 5 sessions per commit). Returns how many sessions could
   * not be saved.
   */
  const writeSessionInstants = async (
    patches: { id: string; instants: SessionInstants; fields: Record<string, unknown> }[]
  ): Promise<number> => {
    if (patches.length === 0) return 0;
    const byId = new Map(patches.map((p) => [p.id, p.instants]));
    setSessions((prev) =>
      prev.map((s) =>
        byId.has(s.id) ? { ...s, ...instantsToState(byId.get(s.id) as SessionInstants) } : s
      )
    );
    if (!user) return 0;
    let failed = 0;
    for (const chunk of chunkArray(patches, 5)) {
      try {
        await safeBatchWrite(
          chunk.map(
            (p): BatchWriteOperation => ({
              type: 'update',
              collectionName: 'sessions',
              docId: p.id,
              updates: p.fields,
            })
          )
        );
      } catch (err) {
        failed += chunk.length;
        console.warn('Could not update session instants', err);
      }
    }
    return failed;
  };

  /** Patches for the sessions in `list` that are open (not finalized/completed) and out of date. */
  const buildInstantPatches = (
    list: Session[],
    clubFor: (s: Session) => Pick<Club, 'timezone' | 'freeCancelHours' | 'lockCancelHours'> | undefined,
    keep: (s: Session, expected: SessionInstants) => boolean
  ) => {
    const patches: { id: string; instants: SessionInstants; fields: Record<string, unknown> }[] = [];
    list.forEach((s) => {
      if (s.feeSplitFinalized || s.bookingStatus === 'completed') return;
      const club = clubFor(s);
      if (!club) return;
      const expected = computeInstantsFor(s, club);
      if (!expected || !sessionInstantsDiffer(s, expected) || !keep(s, expected)) return;
      patches.push({ id: s.id, instants: expected, fields: instantsUpdateFields(expected, s) });
    });
    return patches;
  };

  const resyncClubSessionInstants = async (
    clubId: string,
    club: Pick<Club, 'timezone' | 'freeCancelHours' | 'lockCancelHours'>
  ) => {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    instantsSyncBusyClubsRef.current.add(clubId);
    try {
      const patches = buildInstantPatches(
        sessions.filter((s) => s.clubId === clubId),
        () => club,
        // Only sessions that have not long passed: history is left alone.
        (s, expected) =>
          expected.startsAtMs >= dayAgo || (toEpochMs(s.startsAt) ?? 0) >= dayAgo
      );
      const failed = await writeSessionInstants(patches);
      if (failed > 0) {
        reportActionError(
          `The club settings were saved, but ${failed} ${
            failed === 1 ? 'session' : 'sessions'
          } could not be updated. Open each one and save it again so its cancel deadlines follow the new settings.`
        );
      }
    } finally {
      instantsSyncBusyClubsRef.current.delete(clubId);
    }
  };

  // Silent backfill: sessions created before the instants existed carry none (or stale ones), and
  // the rules lock players out of such a session. A manager who loads them writes the missing /
  // stale values, once per session per app load (failures are only logged; the next load retries).
  const startsAtBackfillTriedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!authReady || !user || !isUserVerified) return;
    const now = Date.now();
    const patches = buildInstantPatches(
      sessions.filter(
        (s) =>
          !startsAtBackfillTriedRef.current.has(s.id) &&
          !instantsSyncBusyClubsRef.current.has(s.clubId) &&
          canManageClubById(s.clubId)
      ),
      // Without the club we would guess its zone and hours; wait until it has loaded.
      (s) => clubs.find((c) => c.id === s.clubId),
      // History cannot be joined or cancelled any more, so it needs nothing.
      (_s, expected) => expected.startsAtMs >= now
    );
    if (patches.length === 0) return;
    patches.forEach((p) => startsAtBackfillTriedRef.current.add(p.id));
    void writeSessionInstants(patches).catch((err) =>
      console.warn('Session instants backfill failed', err)
    );
  }, [authReady, user, isUserVerified, sessions, clubs]);

  const handleUpdateClubPaymentDetails = async (
    clubId: string,
    details: ClubPaymentDetails
  ) => {
    if (!canManageClubById(clubId)) return;
    const formatted = clampString(formatClubPaymentInfo(details), 160, 'PayNow');
    const detailsJson = clampString(JSON.stringify(details), 2000, '');
    const nextPayMap = saveClubPaymentDetails(clubId, details);
    setClubPaymentMap(nextPayMap);

    setRawClubs((prev) =>
      prev.map((c) =>
        c.id === clubId
          ? {
              ...c,
              paymentInfo: formatted,
              paymentDetails: details,
              paymentDetailsJson: detailsJson,
            }
          : c
      )
    );

    if (user) {
      const target = rawClubs.find((c) => c.id === clubId);
      if (target) {
        await safeUpdateDoc('clubs', clubId, {
          name: target.name,
          description: target.description,
          paymentInfo: formatted,
          paymentDetailsJson: detailsJson,
          freeCancelHours: target.freeCancelHours,
          lockCancelHours: target.lockCancelHours,
          lateCancelFeePercent: target.lateCancelFeePercent,
          noShowFeePercent: target.noShowFeePercent,
        });
      }
    }
  };

  const handleCreateNewClub = async (clubData: {
    name: string;
    description: string;
    paymentInfo: string;
    paymentDetails?: ClubPaymentDetails;
    freeCancelHours: number;
    lockCancelHours: number;
    lateCancelFeePercent: number;
    noShowFeePercent: number;
    excludeOwnerFromBilling?: boolean;
    defaultMatchTargetPoints?: number;
    visibility?: ClubVisibility;
    ownerPlayerId?: string;
    timezone?: string;
  }): Promise<Club | null> => {
    if (effectiveTier !== 'admin') return null;
    const assignedPlayerId =
      effectiveTier === 'admin' && clubData.ownerPlayerId
        ? clubData.ownerPlayerId
        : activePlayer?.id || 'player_alex';

    // Enforce: 1 club per owner — a person can only own 1 club
    const alreadyOwns = clubs.some(
      (c) => c.clubOwnerPlayerId === assignedPlayerId
    );
    if (alreadyOwns) {
      return null;
    }

    const newClubId = sanitizeId(`club_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const assignedPlayer = players.find((p) => p.id === assignedPlayerId);
    const assignedPlayerName =
      assignedPlayer?.name || activePlayer?.name || 'Club owner';
    const excludeOwner = Boolean(clubData.excludeOwnerFromBilling);
    const targetPoints = clampNumber(
      clubData.defaultMatchTargetPoints ?? 21,
      1,
      100
    );
    const paymentDetailsJson = clubData.paymentDetails
      ? clampString(JSON.stringify(clubData.paymentDetails), 2000, '')
      : undefined;

    const newClub: Club = {
      id: newClubId,
      name: clampString(clubData.name, 100, 'New Badminton Club'),
      description: clampString(clubData.description, 200, 'Badminton Club'),
      paymentInfo: clampString(clubData.paymentInfo, 160, 'PayNow'),
      paymentDetails: clubData.paymentDetails,
      ...(paymentDetailsJson ? { paymentDetailsJson } : {}),
      freeCancelHours: clampNumber(clubData.freeCancelHours, 0, 720),
      lockCancelHours: clampNumber(clubData.lockCancelHours, 0, 720),
      lateCancelFeePercent: clampNumber(clubData.lateCancelFeePercent, 0, 100),
      noShowFeePercent: clampNumber(clubData.noShowFeePercent, 0, 100),
      excludeOwnerFromBilling: excludeOwner,
      defaultMatchTargetPoints: targetPoints,
      currency: 'USD',
      visibility: clubData.visibility || 'public',
      timezone: resolveClubTimeZone(clubData.timezone),
      ownerId,
      ownerPlayerId: assignedPlayerId,
      clubOwnerPlayerId: assignedPlayerId,
      clubOwnerName: assignedPlayerName,
    };

    const nextBillingMap = saveClubBillingRule(
      newClubId,
      excludeOwner,
      targetPoints,
      'USD'
    );
    setClubBillingRulesMap(nextBillingMap);

    if (clubData.paymentDetails) {
      const nextPayMap = saveClubPaymentDetails(
        newClubId,
        clubData.paymentDetails
      );
      setClubPaymentMap(nextPayMap);
    }

    setRawClubs((prev) => [...prev, newClub]);

    if (user) {
      await safeSetDoc('clubs', newClubId, {
        name: newClub.name,
        description: newClub.description,
        paymentInfo: newClub.paymentInfo,
        ...(paymentDetailsJson ? { paymentDetailsJson } : {}),
        freeCancelHours: newClub.freeCancelHours,
        lockCancelHours: newClub.lockCancelHours,
        lateCancelFeePercent: newClub.lateCancelFeePercent,
        noShowFeePercent: newClub.noShowFeePercent,
        excludeOwnerFromBilling: excludeOwner,
        defaultMatchTargetPoints: targetPoints,
        currency: 'USD',
        visibility: newClub.visibility || 'public',
        timezone: newClub.timezone,
        ownerPlayerId: assignedPlayerId,
        ownerId: newClub.ownerId,
      });
    }

    // The new club's owner is also its first member
    if (assignedPlayer) {
      await addPlayerToClub(assignedPlayer, newClubId);
    }
    return newClub;
  };

  const handleCreateSession = async (
    sessionData: Omit<Session, 'id' | 'ownerId'>
  ): Promise<Session> => {
    const targetClubId = sanitizeId(sessionData.clubId || activeClub.id);
    if (!canManageClubById(targetClubId)) return sessions[0];
    if (!enforceRateLimit('create_session')) return sessions[0];

    const newId = sanitizeId(`session_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const newSession: Session = {
      id: newId,
      clubId: targetClubId,
      title: clampString(sessionData.title, 120, 'Badminton Session'),
      venue: clampString(sessionData.venue, 120, 'Badminton Hall'),
      courtNumbers: clampString(sessionData.courtNumbers, 60, 'Court 1'),
      sessionDate: clampString(sessionData.sessionDate, 40, todayIsoDate()),
      startTime: clampString(sessionData.startTime, 20, '20:00'),
      endTime: clampString(sessionData.endTime, 20, '22:00'),
      bookingStatus: sessionData.bookingStatus,
      courtFee: clampNumber(sessionData.courtFee, 0, 100000),
      shuttlesUsed: 0,
      shuttleUnitCost: clampNumber(sessionData.shuttleUnitCost || 3.0, 0, 1000),
      shuttleFee: 0,
      maxPlayers: clampNumber(sessionData.maxPlayers, 2, 64),
      organizerName: clampString(sessionData.organizerName, 80, 'Organizer'),
      paymentInfo: clampString(sessionData.paymentInfo, 160, 'PayNow'),
      feeSplitFinalized: false,
      ownerId,
    };
    // Exact UTC start in the CLUB's zone plus the two cancel deadlines from the club's current
    // hours; all omitted (so players are locked out) when the start time is unreadable.
    const newInstants = computeInstantsFor(
      newSession,
      clubs.find((c) => c.id === targetClubId)
    );
    Object.assign(newSession, instantsToState(newInstants));

    setSessions((prev) => [newSession, ...prev]);
    setSelectedSessionId(newId);

    if (user) {
      const {
        id,
        startsAt: _startsAt,
        lateCancelUntil: _lateCancelUntil,
        freeCancelUntil: _freeCancelUntil,
        ...payload
      } = newSession;
      try {
        await safeSetDoc('sessions', id, { ...payload, ...instantsCreateFields(newInstants) });
      } catch (err) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        showError(err);
        throw err;
      }
    }
    return newSession;
  };

  const handleCloneNextWeekSession = async (source: Session) => {
    if (!canManageClubById(source.clubId)) return;
    // Calendar-date arithmetic in UTC so the device timezone can never shift the day.
    const dateParts = source.sessionDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!dateParts) {
      showError('This session has no readable date, so it cannot be repeated next week.');
      return;
    }
    const nextDate = new Date(
      Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]) + 7)
    )
      .toISOString()
      .slice(0, 10);
    // Next week's courts are not booked just because this week's were.
    const nextStatus: BookingStatus =
      source.bookingStatus === 'booked' || source.bookingStatus === 'pending'
        ? source.bookingStatus
        : 'pending';

    await handleCreateSession({
      clubId: source.clubId,
      title: source.title,
      venue: source.venue,
      courtNumbers: source.courtNumbers,
      sessionDate: nextDate,
      startTime: source.startTime,
      endTime: source.endTime,
      bookingStatus: nextStatus,
      courtFee: source.courtFee,
      shuttlesUsed: 0,
      shuttleUnitCost: source.shuttleUnitCost || 3.0,
      shuttleFee: 0,
      maxPlayers: source.maxPlayers,
      organizerName: source.organizerName,
      paymentInfo: source.paymentInfo,
      feeSplitFinalized: false,
    });
  };

  const handleTapRsvp = async (
    sessionId: string,
    player: Player,
    status: RsvpStatus,
    penaltyPercent = 0,
    guestCount?: number,
    // What the tap-out confirm dialog showed the player; a mismatch with the policy in force
    // at click time is reported back (code 'policy_changed') instead of silently applied.
    expectedPolicy?: { status: RsvpStatus; penaltyPercent: number }
  ): Promise<TapRsvpResult> => {
    const fail = (
      reason: string,
      code?: 'policy_changed'
    ): { ok: false; reason: string; code?: 'policy_changed' } => {
      reportActionError(reason);
      return { ok: false, reason, ...(code ? { code } : {}) };
    };
    if (!enforceRateLimit('tap_rsvp')) {
      return { ok: false, reason: 'Too many requests. Please wait a moment.' };
    }

    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return fail('That session no longer exists.');
    if (session.bookingStatus === 'completed') {
      return fail('This session is already completed.');
    }
    // Players may only RSVP themselves, in clubs they belong to; club managers may RSVP anyone.
    const isSelfRsvp = Boolean(activePlayer && player.id === activePlayer.id);
    if (
      !canManageClubById(session.clubId) &&
      !(isSelfRsvp && hasPlayerJoinedClub(activePlayer, session.clubId))
    ) {
      return fail('Join this club first to sign up for its sessions.');
    }

    const existingRsvp = rsvps.find(
      (r) => r.sessionId === sessionId && r.playerId === player.id
    );
    const isManager = canManageClubById(session.clubId);
    const sessionClub = clubs.find((c) => c.id === session.clubId);

    // Non-managers can only self-update/create while session bookingStatus is 'pending' or 'booked' and not finalized
    if (
      !isManager &&
      ((session.bookingStatus !== 'pending' &&
        session.bookingStatus !== 'booked') ||
        session.feeSplitFinalized)
    ) {
      return fail('This session is locked for changes. Ask the organiser.');
    }

    // A late cancellation is final for players (firestore.rules never lets a late_out row
    // return to going/out); only the organiser can restore it.
    if (!isManager && existingRsvp?.status === 'late_out') {
      return fail(
        'A late cancellation cannot be undone here. Ask the organiser to restore your spot.'
      );
    }

    // The cancel window and the join window are measured from the session's startsAt and read in
    // the CLUB's timezone; the Firestore rules enforce the same boundaries with server time, and
    // the evaluators switch to the stricter option shortly before each boundary.
    const clubTimeZone = resolveClubTimeZone(sessionClub?.timezone);

    // Joining and +1 guest increases close when the session starts (or when no valid start
    // instant is stored). A +1 guest DEcrease is a cancel and follows the free window instead.
    const currentGuestCount =
      existingRsvp?.status === 'going' ? Math.max(0, Math.floor(Number(existingRsvp.guestCount || 0))) : 0;
    const isGuestDecrease =
      status === 'going' &&
      existingRsvp?.status === 'going' &&
      guestCount !== undefined &&
      Math.max(0, Math.min(4, Math.floor(guestCount))) < currentGuestCount;
    if (!isManager && status === 'going' && !isGuestDecrease) {
      const joinWindow = evaluateJoinWindow(session, Date.now(), clubTimeZone);
      if (!joinWindow.canJoin) {
        return fail(joinWindow.reason || 'This session is no longer open for sign-ups.');
      }
    }
    if (!isManager && isGuestDecrease) {
      if (!sessionClub) return fail('Club details are still loading. Try again.');
      const policy = evaluateTapOutWindow(session, sessionClub, Date.now(), clubTimeZone);
      if (!policy.canFreeCancel) {
        return fail(
          policy.phase === 'unavailable'
            ? policy.policySummary
            : 'Guests can only be removed during the free-cancel window. Ask the organiser to change your guests.'
        );
      }
    }

    // Players leaving a session follow the club's tap-out policy: no tap-out once
    // the lock cutoff has passed or session has started, and the late fee inside the late window.
    if (!isManager && status !== 'going') {
      if (!sessionClub) return fail('Club details are still loading. Try again.');
      // Nothing to cancel: never create an 'out' row for someone who has not signed up.
      if (!existingRsvp) return fail('You have not signed up for this session.');
      // Already out: leave the row (and any late fee) exactly as it is.
      if (existingRsvp.status === 'out') {
        return { ok: true, status: 'out', penaltyPercent: 0 };
      }
      const policy = evaluateTapOutWindow(session, sessionClub, Date.now(), clubTimeZone);
      if (!policy.canTapOut) return fail(policy.policySummary);
      status = policy.isPenaltyWindow ? 'late_out' : 'out';
      penaltyPercent = policy.isPenaltyWindow ? policy.penaltyPercent : 0;
      if (
        expectedPolicy &&
        (expectedPolicy.status !== status ||
          Math.round(expectedPolicy.penaltyPercent) !== Math.round(penaltyPercent))
      ) {
        return fail(
          status === 'late_out'
            ? `Cancellation terms changed while you were deciding: it is now a late cancellation (${Math.round(penaltyPercent)}% fee). Review and confirm again.`
            : 'Cancellation terms changed while you were deciding: it is now a free cancellation. Review and confirm again.',
          'policy_changed'
        );
      }
    }

    const rsvpId = existingRsvp
      ? existingRsvp.id
      : sanitizeId(`rsvp_${sessionId}_${player.id}`);
    const ownerId = user ? user.uid : 'local_club';
    const minLateCancelPct = sessionClub ? sessionClub.lateCancelFeePercent : 0;
    const appliedPct =
      status === 'going'
        ? 0
        : status === 'late_out'
        ? clampNumber(Math.max(penaltyPercent, minLateCancelPct), 0, 100)
        : 0;

    const resolvedGuestCount =
      status !== 'going'
        ? 0
        : guestCount !== undefined
        ? Math.max(0, Math.min(4, Math.floor(guestCount)))
        : Math.max(0, Math.floor(Number(existingRsvp?.guestCount || 0)));

    // P1-5: Enforce session.maxPlayers across all open sessions whenever adding spots.
    // Capacity is ADVISORY: firestore.rules cannot count documents, so two people tapping
    // Join at the same moment can still both get the last spot.
    if (status === 'going') {
      const currentParty =
        existingRsvp?.status === 'going' ? getRsvpPartySize(existingRsvp) : 0;
      const nextParty = 1 + resolvedGuestCount;
      const othersGoing =
        getSessionGoingHeadcount(
          rsvps.filter((r) => r.sessionId === sessionId)
        ) - currentParty;
      if (
        nextParty > currentParty &&
        othersGoing + nextParty > session.maxPlayers
      ) {
        return fail('This session is full.');
      }
    }

    if (!user) {
      setRsvpGuestsMap((prev) => {
        const next = { ...prev, [rsvpId]: resolvedGuestCount };
        saveRsvpGuestsMap(next);
        return next;
      });
    }

    const preservedAttendance: AttendanceOutcome =
      existingRsvp?.attendanceOutcome || 'present';
    const preservedFeeShare = existingRsvp ? existingRsvp.feeShare : 0;

    // Optimistic state update (zero lag)
    setRsvps((prev) => {
      const exists = prev.some((r) => r.id === rsvpId);
      if (exists) {
        return prev.map((r) =>
          r.id === rsvpId
            ? {
                ...r,
                status,
                guestCount: resolvedGuestCount,
                attendanceOutcome: preservedAttendance,
                penaltyPercentApplied: appliedPct,
                feeShare: preservedFeeShare,
                playerName: player.name,
              }
            : r
        );
      }
      return [
        ...prev,
        {
          id: rsvpId,
          clubId: session.clubId,
          sessionId,
          playerId: player.id,
          playerName: player.name,
          guestCount: resolvedGuestCount,
          status,
          attendanceOutcome: 'present' as const,
          penaltyPercentApplied: appliedPct,
          feeShare: 0,
          grossFeeShare: 0,
          walletCreditApplied: 0,
          walletPassApplied: false,
          walletWaiverApplied: false,
          paidStatus: 'unpaid' as const,
          paidMethod: 'pending',
          ownerId,
        },
      ];
    });

    if (user) {
      try {
        if (existingRsvp) {
          // Relies on firestore.rules:491-518 (rsvpSelfUpdateAllowed: attendanceOutcome and feeShare unchanged)
          await safeUpdateDoc('rsvps', rsvpId, {
            status,
            guestCount: resolvedGuestCount,
            penaltyPercentApplied: appliedPct,
            paidStatus: existingRsvp.paidStatus,
            paidMethod: existingRsvp.paidMethod,
            playerName: clampString(player.name, 80),
          });
        } else {
          // P0-6: Check if deterministic rsvpId already exists on server (e.g. windowed out of local snapshot)
          // A document that does not exist has no clubId for the read rule to check, so the
          // server may answer permission-denied for it: treat that as "not there yet".
          let serverSnap: Awaited<ReturnType<typeof getDoc>> | null = null;
          try {
            serverSnap = await getDoc(doc(db, 'rsvps', rsvpId));
          } catch (err) {
            if (!isPermissionDenied(err)) throw err;
          }
          if (serverSnap && serverSnap.exists()) {
            const serverData = serverSnap.data() as Record<string, unknown>;
            await safeUpdateDoc('rsvps', rsvpId, {
              status,
              guestCount: resolvedGuestCount,
              penaltyPercentApplied: appliedPct,
              paidStatus:
                typeof serverData.paidStatus === 'string'
                  ? serverData.paidStatus
                  : 'unpaid',
              paidMethod:
                typeof serverData.paidMethod === 'string'
                  ? serverData.paidMethod
                  : 'pending',
              playerName: clampString(player.name, 80),
            });
          } else {
            // Relies on firestore.rules:522-549 (rsvpId == 'rsvp_' + sessionId + '_' + playerId, zero wallet ledger fields)
            await safeSetDoc('rsvps', rsvpId, {
              clubId: sanitizeId(session.clubId),
              sessionId: sanitizeId(sessionId),
              playerId: sanitizeId(player.id),
              playerName: clampString(player.name, 80),
              guestCount: resolvedGuestCount,
              status,
              attendanceOutcome: 'present',
              penaltyPercentApplied: appliedPct,
              feeShare: 0,
              grossFeeShare: 0,
              walletCreditApplied: 0,
              walletPassApplied: false,
              walletWaiverApplied: false,
              paidStatus: 'unpaid',
              paidMethod: 'pending',
              ownerId,
            });
          }
        }
      } catch (err) {
        // Roll the optimistic row back so the roster never shows a spot that was not saved
        setRsvps((prev) =>
          existingRsvp
            ? prev.map((r) => (r.id === rsvpId ? existingRsvp : r))
            : prev.filter((r) => r.id !== rsvpId)
        );
        return fail(`Your RSVP was not saved. ${friendlyWriteError(err)}`);
      }
    }

    return { ok: true, status, penaltyPercent: appliedPct };
  };

  // --- Session money ledger plumbing (shared by finalize / attendance edit / reopen) ---

  // Optimistic local update of the session's rows and the affected wallets. Returns what
  // is needed to undo it if the server write fails.
  const applyLocalLedger = (
    rowsById: Map<string, SessionRsvp>,
    nextWallets: Record<string, PlayerBenefitWallet>
  ) => {
    const changedWallets: Record<string, PlayerBenefitWallet> = {};
    const walletBackup: Record<string, PlayerBenefitWallet | undefined> = {};
    Object.keys(nextWallets).forEach((key) => {
      const before = playerWalletsMap[key];
      const after = nextWallets[key];
      if (
        !before ||
        before.creditBalance !== after.creditBalance ||
        before.freeSessionPasses !== after.freeSessionPasses ||
        before.waiveAllFees !== after.waiveAllFees
      ) {
        changedWallets[key] = after;
        walletBackup[key] = before;
      }
    });
    setRsvps((prev) => prev.map((r) => rowsById.get(r.id) || r));
    rsvpsRef.current = rsvpsRef.current.map((r) => rowsById.get(r.id) || r);
    if (Object.keys(changedWallets).length > 0) {
      setPlayerWalletsMap((prev) => ({ ...prev, ...changedWallets }));
    }
    return { walletBackup };
  };

  const restoreLocalLedger = (
    previousRowsById: Map<string, SessionRsvp>,
    walletBackup: Record<string, PlayerBenefitWallet | undefined>
  ) => {
    setRsvps((prev) => prev.map((r) => previousRowsById.get(r.id) || r));
    rsvpsRef.current = rsvpsRef.current.map((r) => previousRowsById.get(r.id) || r);
    setPlayerWalletsMap((prev) => {
      const next = { ...prev };
      Object.keys(walletBackup).forEach((key) => {
        const before = walletBackup[key];
        if (before) next[key] = before;
        else delete next[key];
      });
      return next;
    });
  };

  // One transaction per RSVP+wallet pair, computed on the SERVER-read documents. Rows are
  // idempotent, so after a partial failure pressing the same action again converges.
  const runSessionLedgerWrites = async (
    tasks: RsvpWalletPairTask[]
  ): Promise<ActionResult> => {
    if (!user || tasks.length === 0) return { ok: true };
    const batch = await runRsvpWalletPairs(tasks, user.uid);
    if (batch.failed.length === 0) return { ok: true };
    const first = batch.failed[0].message;
    return {
      ok: false,
      reason:
        batch.failed.length === batch.total
          ? `Nothing was saved. ${first}`
          : `${batch.failed.length} of ${batch.total} players could not be updated (${first}). Press the same button again to finish; completed players are not charged twice.`,
    };
  };

  const handleMarkAttendanceOutcome = async (
    rsvpId: string,
    outcome: AttendanceOutcome
  ): Promise<ActionResult> => {
    const failAction = (reason: string): ActionResult => {
      reportActionError(reason);
      return { ok: false, reason };
    };
    const currentRsvps = rsvpsRef.current;
    const targetRsvp = currentRsvps.find((r) => r.id === rsvpId);
    if (!targetRsvp) return failAction('That RSVP no longer exists.');
    if (!canManageClubById(targetRsvp.clubId)) {
      return failAction('Only the club organiser can change attendance.');
    }

    const session = sessions.find((s) => s.id === targetRsvp.sessionId);
    const club =
      clubs.find((c) => c.id === targetRsvp.clubId) || activeClub;
    const nextPenaltyPct =
      outcome === 'no_show' ? club.noShowFeePercent : 100;
    const patchTarget = (r: SessionRsvp): SessionRsvp =>
      r.id === rsvpId
        ? {
            ...r,
            attendanceOutcome: outcome,
            penaltyPercentApplied: nextPenaltyPct,
          }
        : r;

    if (
      session &&
      session.bookingStatus === 'completed' &&
      session.feeSplitFinalized
    ) {
      // Attendance changes everyone's share. applyWalletToSingleRsvp reverses each row's
      // prior wallet ledger itself, so it gets the ORIGINAL rows and wallets (no pre-restore:
      // that would wipe cash-paid rows). Cash/pending rows keep their payment and show an
      // adjustment instead.
      const ownerOpts = {
        clubOwnerPlayerId: club.clubOwnerPlayerId,
        excludeOwnerFromBilling: Boolean(club.excludeOwnerFromBilling),
      };
      const sessionRows = currentRsvps.filter((r) => r.sessionId === session.id);
      const patchedRows = sessionRows.map(patchTarget);
      const splits = computeSessionSplitDetails(
        session.courtFee,
        session.shuttleFee,
        patchedRows,
        club.noShowFeePercent,
        ownerOpts
      ).splits;
      const settlement = applyWalletsToFinalizedSessionRsvps({
        sessionRsvps: patchedRows,
        splits,
        walletsMap: playerWalletsMap,
        finalizeSplit: true,
        ...ownerOpts,
      });

      const previousRowsById = new Map(sessionRows.map((r) => [r.id, r]));
      const settledById = new Map(
        settlement.updatedSessionRsvps.map((r) => [r.id, r])
      );
      const { walletBackup } = applyLocalLedger(
        settledById,
        settlement.updatedWalletsMap
      );

      if (!user) {
        savePlayerWalletsMap(settlement.updatedWalletsMap);
        return { ok: true };
      }

      const tasks: RsvpWalletPairTask[] = patchedRows
        .filter((r) => r.id === rsvpId || rowNeedsLedgerWork(r))
        .map((r) => ({
          rsvpId: r.id,
          clubId: r.clubId,
          playerId: r.playerId,
          requireFinalizedSessionId: session.id,
          compute: (serverRsvp, serverWallet) => {
            const calc = splits.get(r.id) || {
              feeShare: 0,
              penaltyPercentApplied: 0,
            };
            return computeRsvpWalletPair({
              serverRsvp,
              serverWallet,
              mutate: r.id === rsvpId ? patchTarget : undefined,
              grossFeeShare: calc.feeShare,
              penaltyPercentApplied: calc.penaltyPercentApplied,
              finalizeSplit: true,
              ...ownerOpts,
            });
          },
        }));
      const written = await runSessionLedgerWrites(tasks);
      if (!written.ok) {
        restoreLocalLedger(previousRowsById, walletBackup);
        return failAction(`Attendance change was not fully saved. ${written.reason}`);
      }
      return { ok: true };
    }

    setRsvps((prev) => prev.map(patchTarget));
    rsvpsRef.current = rsvpsRef.current.map(patchTarget);

    if (user) {
      try {
        await safeUpdateDoc('rsvps', rsvpId, {
          attendanceOutcome: outcome,
          penaltyPercentApplied: nextPenaltyPct,
        });
      } catch (err) {
        setRsvps((prev) => prev.map((r) => (r.id === rsvpId ? targetRsvp : r)));
        rsvpsRef.current = rsvpsRef.current.map((r) =>
          r.id === rsvpId ? targetRsvp : r
        );
        return failAction(`Attendance was not saved. ${friendlyWriteError(err)}`);
      }
    }
    return { ok: true };
  };

  const handleUpdateSessionBooking = async (
    sessionId: string,
    updates: {
      bookingStatus: BookingStatus;
      courtFee: number;
      courtNumbers: string;
      maxPlayers: number;
    }
  ): Promise<ActionResult> => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || !canManageClubById(session.clubId)) {
      return { ok: false, reason: 'Only the club organiser can change this session.' };
    }

    const cleanCourtFee = clampNumber(updates.courtFee, 0, 100000);
    const cleanCourts = clampString(updates.courtNumbers, 60, 'Court 1');
    const cleanMaxPlayers = clampNumber(updates.maxPlayers, 2, 64);
    // P1-3: A finalized session's fees are locked: the amounts every player owes were computed
    // from this court fee and status. Changing them needs Reopen or Recalculate, which also
    // fixes the shares; never move a finalized session off 'completed' here.
    if (
      session.feeSplitFinalized &&
      (cleanCourtFee !== session.courtFee ||
        updates.bookingStatus !== session.bookingStatus)
    ) {
      const reason =
        'Fees for this session are already finalized. Use Reopen or Recalculate to change the court fee or status.';
      reportActionError(reason);
      return { ok: false, reason };
    }
    // P1-3: A session cannot be marked 'completed' without finalizing its fee split
    const nextStatus: BookingStatus =
      updates.bookingStatus === 'completed' && !session.feeSplitFinalized
        ? 'in_play'
        : updates.bookingStatus;
    const previousSession = session;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              bookingStatus: nextStatus,
              courtFee: cleanCourtFee,
              courtNumbers: cleanCourts,
              maxPlayers: cleanMaxPlayers,
            }
          : s
      )
    );

    if (user) {
      try {
        await safeUpdateDoc('sessions', sessionId, {
          title: session.title,
          venue: session.venue,
          courtNumbers: cleanCourts,
          sessionDate: session.sessionDate,
          startTime: session.startTime,
          endTime: session.endTime,
          bookingStatus: nextStatus,
          courtFee: cleanCourtFee,
          shuttlesUsed: session.shuttlesUsed,
          shuttleUnitCost: session.shuttleUnitCost,
          shuttleFee: session.shuttleFee,
          maxPlayers: cleanMaxPlayers,
          organizerName: session.organizerName,
          paymentInfo: session.paymentInfo,
          feeSplitFinalized: session.feeSplitFinalized,
        });
      } catch (err) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? previousSession : s))
        );
        const reason = `Session changes were not saved. ${friendlyWriteError(err)}`;
        reportActionError(reason);
        return { ok: false, reason };
      }
    }
    return { ok: true };
  };

  const handleEditSessionDetails = async (
    sessionId: string,
    updates: {
      title: string;
      venue: string;
      courtNumbers: string;
      sessionDate: string;
      startTime: string;
      endTime: string;
      bookingStatus: BookingStatus;
      courtFee: number;
      maxPlayers: number;
    }
  ): Promise<ActionResult> => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || !canManageClubById(session.clubId)) {
      return { ok: false, reason: 'Only the club organiser can change this session.' };
    }

    const cleanTitle = clampString(updates.title, 120, session.title);
    const cleanVenue = clampString(updates.venue, 120, session.venue);
    const cleanCourts = clampString(
      updates.courtNumbers,
      60,
      updates.bookingStatus === 'pending' ? 'TBD' : 'Court 1'
    );
    const cleanDate = clampString(updates.sessionDate, 40, session.sessionDate);
    const cleanStart = clampString(updates.startTime, 20, session.startTime);
    const cleanEnd = clampString(updates.endTime, 20, session.endTime);
    const cleanCourtFee = clampNumber(updates.courtFee, 0, 100000);
    const cleanMaxPlayers = clampNumber(updates.maxPlayers, 2, 64);
    // P1-3: A finalized session's court fee and status are locked (see handleUpdateSessionBooking);
    // title / venue / date / time / capacity can still be corrected.
    if (
      session.feeSplitFinalized &&
      (cleanCourtFee !== session.courtFee ||
        updates.bookingStatus !== session.bookingStatus)
    ) {
      const reason =
        'Fees for this session are already finalized. Use Reopen or Recalculate to change the court fee or status.';
      reportActionError(reason);
      return { ok: false, reason };
    }
    // P1-3: Prevent marking 'completed' without finalizing split
    const nextStatus: BookingStatus =
      updates.bookingStatus === 'completed' && !session.feeSplitFinalized
        ? 'in_play'
        : updates.bookingStatus;
    const previousSession = session;

    // startsAt / lateCancelUntil / freeCancelUntil follow the date/start time in the club's zone and
    // its CURRENT cancel hours. When the new start time cannot be read the stored instants are
    // removed, so players are locked out rather than left on stale deadlines.
    const nextInstants = computeInstantsFor(
      { sessionDate: cleanDate, startTime: cleanStart },
      clubs.find((c) => c.id === session.clubId)
    );
    const instantsWrite = instantsUpdateFields(nextInstants, session);

    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              title: cleanTitle,
              venue: cleanVenue,
              courtNumbers: cleanCourts,
              sessionDate: cleanDate,
              startTime: cleanStart,
              endTime: cleanEnd,
              bookingStatus: nextStatus,
              courtFee: cleanCourtFee,
              maxPlayers: cleanMaxPlayers,
              ...instantsToState(nextInstants),
            }
          : s
      )
    );

    if (user) {
      try {
        await safeUpdateDoc('sessions', sessionId, {
          title: cleanTitle,
          venue: cleanVenue,
          courtNumbers: cleanCourts,
          sessionDate: cleanDate,
          startTime: cleanStart,
          endTime: cleanEnd,
          bookingStatus: nextStatus,
          courtFee: cleanCourtFee,
          shuttlesUsed: session.shuttlesUsed,
          shuttleUnitCost: session.shuttleUnitCost,
          shuttleFee: session.shuttleFee,
          maxPlayers: cleanMaxPlayers,
          organizerName: session.organizerName,
          paymentInfo: session.paymentInfo,
          feeSplitFinalized: session.feeSplitFinalized,
          ...instantsWrite,
        });
      } catch (err) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? previousSession : s))
        );
        const reason = `Session changes were not saved. ${friendlyWriteError(err)}`;
        reportActionError(reason);
        return { ok: false, reason };
      }
    }
    return { ok: true };
  };

  const handleReopenSessionSplit = async (
    sessionId: string
  ): Promise<ActionResult> => {
    const failAction = (reason: string): ActionResult => {
      reportActionError(reason);
      return { ok: false, reason };
    };
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || !canManageClubById(session.clubId)) {
      return failAction('Only the club organiser can reopen a session.');
    }

    const club = clubs.find((c) => c.id === session.clubId) || activeClub;
    const ownerOpts = {
      clubOwnerPlayerId: club.clubOwnerPlayerId,
      excludeOwnerFromBilling: Boolean(club.excludeOwnerFromBilling),
    };
    const sessionRows = rsvpsRef.current.filter((r) => r.sessionId === sessionId);
    // Gives back every wallet benefit and zeroes wallet-settled / unpaid rows. Cash-paid and
    // pending_approval rows are left alone: real money survives a reopen.
    const reopened = restoreSessionRsvpsAndWalletsForReopen({
      sessionRsvps: sessionRows,
      walletsMap: playerWalletsMap,
    });
    const restoredById = new Map(
      reopened.restoredSessionRsvps.map((r) => [r.id, r])
    );
    const previousRowsById = new Map(sessionRows.map((r) => [r.id, r]));
    const previousSession = session;

    const nextBookingStatus: BookingStatus =
      session.bookingStatus === 'completed' ? 'in_play' : session.bookingStatus;

    const { walletBackup } = applyLocalLedger(
      restoredById,
      reopened.restoredWalletsMap
    );
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              bookingStatus: nextBookingStatus,
              feeSplitFinalized: false,
            }
          : s
      )
    );

    if (!user) {
      savePlayerWalletsMap(reopened.restoredWalletsMap);
      return { ok: true };
    }

    // Per RSVP+wallet pair on server data first; the session flag flips last so a failure
    // midway leaves a session that is still finalized and can simply be reopened again.
    const tasks: RsvpWalletPairTask[] = sessionRows
      .filter((r) => rowNeedsLedgerWork(r))
      .map((r) => ({
        rsvpId: r.id,
        clubId: r.clubId,
        playerId: r.playerId,
        compute: (serverRsvp, serverWallet) =>
          computeRsvpWalletPair({
            serverRsvp,
            serverWallet,
            grossFeeShare: 0,
            finalizeSplit: false,
            ...ownerOpts,
          }),
      }));
    const written = await runSessionLedgerWrites(tasks);
    if (written.ok) {
      try {
        await safeUpdateDoc('sessions', sessionId, {
          bookingStatus: nextBookingStatus,
          feeSplitFinalized: false,
        });
        return { ok: true };
      } catch (err) {
        restoreLocalLedger(previousRowsById, walletBackup);
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? previousSession : s))
        );
        return failAction(`Reopen was not saved. ${friendlyWriteError(err)}`);
      }
    }
    restoreLocalLedger(previousRowsById, walletBackup);
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? previousSession : s))
    );
    return failAction(`Reopen was not completed. ${written.reason}`);
  };

  const statRollbackForMatch = (match: BadmintonMatch) =>
    statRollbackForMatchWith(match, rawPlayers);

  const handleDeleteSession = async (sessionId: string) => {
    const targetSession = sessions.find((s) => s.id === sessionId);
    if (!targetSession || !canManageClubById(targetSession.clubId)) return;

    const sessionRsvps = rsvps.filter((r) => r.sessionId === sessionId);
    const sessionMatches = matches.filter((m) => m.sessionId === sessionId);
    const previousSessions = sessions;
    const previousRsvps = rawRsvps;
    const previousMatches = matches;

    const remainingSessions = sessions.filter((s) => s.id !== sessionId);
    setSessions(remainingSessions);
    setRsvps((prev) => prev.filter((r) => r.sessionId !== sessionId));
    setMatches((prev) => prev.filter((m) => m.sessionId !== sessionId));
    if (selectedSessionId === sessionId) {
      const nextInClub =
        remainingSessions.find((s) => s.clubId === targetSession.clubId) ||
        remainingSessions[0];
      if (nextInClub) {
        setSelectedSessionId(nextInClub.id);
      } else {
        setActiveTab('sessions');
      }
    }

    if (!user) {
      // Local demo mode: wallets and stats live in this browser only.
      if (targetSession.feeSplitFinalized) {
        const reopened = restoreSessionRsvpsAndWalletsForReopen({
          sessionRsvps,
          walletsMap: playerWalletsMap,
        });
        savePlayerWalletsMap(reopened.restoredWalletsMap);
        setPlayerWalletsMap(reopened.restoredWalletsMap);
      }
      const localDeltas = aggregateMatchStatDeltas(sessionMatches, -1);
      if (localDeltas.size > 0) {
        setPlayers((prev) =>
          prev.map((p) => {
            const delta = localDeltas.get(p.id);
            return delta ? applyStatDelta(p, delta) : p;
          })
        );
      }
      return;
    }

    try {
      // 1. Every credit and pass this session's rows used goes back to its wallet, one RSVP +
      //    wallet pair per transaction on the server's values (cash-paid and waived rows too:
      //    the rows are about to disappear, and credit must not disappear with them).
      const refunds = await runRsvpWalletPairs(
        sessionRsvps.map((r) => ({
          rsvpId: r.id,
          clubId: r.clubId,
          playerId: r.playerId,
          compute: (serverRsvp, serverWallet) =>
            computeFullWalletRefund({ serverRsvp, serverWallet }),
        })),
        user.uid
      );
      if (refunds.failed.length > 0) throw new Error(refunds.failed[0].message);

      // 2. Matches one at a time, each with exactly its own stat rollback (the rules check it
      //    against that one match).
      for (const match of sessionMatches) {
        const { statDeltas, involvedPlayers } = statRollbackForMatch(match);
        await safeBatchWrite(
          [
            { type: 'delete', collectionName: 'matches', docId: match.id },
            ...involvedPlayers.map((p) =>
              buildPlayerStatDeltaOp(p, statDeltas.get(p.id)!, match.id)
            ),
          ],
          { chunkSize: 5 }
        );
      }

      // 3. The RSVPs, then the session last (the RSVP rules look the session up).
      await safeBatchWrite([
        ...sessionRsvps.map(
          (r): BatchWriteOperation => ({ type: 'delete', collectionName: 'rsvps', docId: r.id })
        ),
        { type: 'delete', collectionName: 'sessions', docId: sessionId },
      ]);
    } catch (err) {
      // Live listeners bring back whatever was already removed; restore the rest.
      setSessions(previousSessions);
      setRsvps(previousRsvps);
      setMatches(previousMatches);
      showError(err);
    }
  };

  const handleFinalizeSessionShuttleAndSplit = async (
    sessionId: string,
    bookingStatus: BookingStatus,
    courtFee: number,
    shuttlesUsed: number,
    shuttleUnitCost: number,
    courtNumbers: string,
    finalizeSplit: boolean,
    options?: { acknowledgeUnallocated?: boolean }
  ): Promise<ActionResult> => {
    const failAction = (reason: string): ActionResult => {
      reportActionError(reason);
      return { ok: false, reason };
    };
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || !canManageClubById(session.clubId)) {
      return failAction('Only the club organiser can finalize a session.');
    }
    if (!enforceRateLimit('finalize_session')) {
      return { ok: false, reason: 'Too many requests. Please wait a moment.' };
    }

    // Clamp BEFORE computing anything: firestore.rules cap shuttleFee, courtFee and every
    // share at 100000, so amounts that cannot be stored are blocked with a clear message.
    const feeCheck = checkSessionFeeInputs(courtFee, shuttlesUsed, shuttleUnitCost);
    if (!feeCheck.ok) {
      return failAction(feeCheck.error || 'Those amounts cannot be saved.');
    }
    const cleanCourtFee = feeCheck.courtFee;
    const cleanShuttlesUsed = feeCheck.shuttlesUsed;
    const cleanUnitCost = feeCheck.shuttleUnitCost;
    const cleanShuttleFee = feeCheck.shuttleFee;
    const cleanCourts = clampString(courtNumbers, 60, 'Court 1');
    // A session is only 'completed' together with a finalized split (P1-3)
    const nextBookingStatus: BookingStatus =
      !finalizeSplit && bookingStatus === 'completed' ? 'in_play' : bookingStatus;

    const club =
      clubs.find((c) => c.id === session.clubId) || activeClub;
    const ownerOpts = {
      clubOwnerPlayerId: club.clubOwnerPlayerId,
      excludeOwnerFromBilling: Boolean(club.excludeOwnerFromBilling),
    };
    // The split is computed from the RSVPs as the SERVER has them: a tap-out or rejoin that has
    // not reached this device yet must not be billed (or skipped) from a stale copy.
    let sessionRows = rsvpsRef.current.filter((r) => r.sessionId === sessionId);
    if (user) {
      try {
        const fresh = await getDocs(
          query(
            collection(db, 'rsvps'),
            where('clubId', '==', session.clubId),
            where('sessionId', '==', sessionId)
          )
        );
        sessionRows = fresh.docs.map((d) =>
          rsvpFromDocData(d.id, d.data() as Record<string, unknown>)
        );
      } catch (err) {
        return failAction(`Could not read this session's latest RSVPs. ${friendlyWriteError(err)}`);
      }
    }
    const rowById = new Map(sessionRows.map((r) => [r.id, r]));

    // Court and shuttle cost nobody is weighted to pay (nobody present) would silently vanish:
    // the organiser must acknowledge that explicitly.
    const splitDetails = computeSessionSplitDetails(
      cleanCourtFee,
      cleanShuttleFee,
      sessionRows,
      club.noShowFeePercent,
      ownerOpts
    );
    if (
      finalizeSplit &&
      splitDetails.hasUnallocated &&
      !options?.acknowledgeUnallocated
    ) {
      return failAction(
        `${splitDetails.unallocatedAmount.toFixed(2)} of the cost would not be charged to anyone (nobody is marked present). Confirm in the finalize dialog to finalize anyway.`
      );
    }

    // applyWalletToSingleRsvp reverses each row's own prior wallet ledger, so it gets the
    // ORIGINAL rows and wallets: a restore pre-pass would wipe cash-paid rows back to unpaid.
    // Cash-paid / pending rows keep their payment; a changed share shows up as an adjustment.
    const walletSettlement = applyWalletsToFinalizedSessionRsvps({
      sessionRsvps: sessionRows,
      splits: splitDetails.splits,
      walletsMap: playerWalletsMap,
      finalizeSplit,
      ...ownerOpts,
    });

    const touchLedger = finalizeSplit || session.feeSplitFinalized;
    const previousSession = session;
    const previousRowsById = new Map(sessionRows.map((r) => [r.id, r]));
    let walletBackup: Record<string, PlayerBenefitWallet | undefined> = {};
    if (touchLedger) {
      walletBackup = applyLocalLedger(
        new Map(walletSettlement.updatedSessionRsvps.map((r) => [r.id, r])),
        walletSettlement.updatedWalletsMap
      ).walletBackup;
    }

    // Single synchronous batch update to eliminate any UI stutter
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              bookingStatus: nextBookingStatus,
              courtFee: cleanCourtFee,
              shuttlesUsed: cleanShuttlesUsed,
              shuttleUnitCost: cleanUnitCost,
              shuttleFee: cleanShuttleFee,
              courtNumbers: cleanCourts,
              feeSplitFinalized: finalizeSplit,
            }
          : s
      )
    );
    const rollback = () => {
      if (touchLedger) restoreLocalLedger(previousRowsById, walletBackup);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? previousSession : s))
      );
    };

    if (!user) {
      if (touchLedger) savePlayerWalletsMap(walletSettlement.updatedWalletsMap);
      return { ok: true };
    }

    // Per RSVP+wallet pair, computed on server-read data, one transaction each. The session
    // document is written last, so a failure midway never leaves a finalized session with
    // half-computed rows; running the same action again converges (rows are idempotent).
    if (touchLedger) {
      const tasks: RsvpWalletPairTask[] = sessionRows
        .filter((r) => rowNeedsLedgerWork(r))
        .map((r) => ({
          rsvpId: r.id,
          clubId: r.clubId,
          playerId: r.playerId,
          compute: (serverRsvp, serverWallet) => {
            // The row changed after the split was computed: refuse rather than bill a stale share.
            const read = rowById.get(r.id);
            if (
              read &&
              (serverRsvp.status !== read.status ||
                serverRsvp.attendanceOutcome !== read.attendanceOutcome ||
                (serverRsvp.guestCount ?? 0) !== (read.guestCount ?? 0))
            ) {
              throw new Error(
                `${serverRsvp.playerName || 'A player'} changed their RSVP just now. Finalize again to include it.`
              );
            }
            const calc = splitDetails.splits.get(r.id) || {
              feeShare: 0,
              penaltyPercentApplied: 0,
            };
            return computeRsvpWalletPair({
              serverRsvp,
              serverWallet,
              grossFeeShare: calc.feeShare,
              penaltyPercentApplied: calc.penaltyPercentApplied,
              finalizeSplit,
              ...ownerOpts,
            });
          },
        }));
      const written = await runSessionLedgerWrites(tasks);
      if (!written.ok) {
        rollback();
        return failAction(`Fee split was not saved. ${written.reason}`);
      }
    }
    try {
      await safeUpdateDoc('sessions', sessionId, {
        bookingStatus: nextBookingStatus,
        courtFee: cleanCourtFee,
        shuttlesUsed: cleanShuttlesUsed,
        shuttleUnitCost: cleanUnitCost,
        shuttleFee: cleanShuttleFee,
        courtNumbers: cleanCourts,
        feeSplitFinalized: finalizeSplit,
      });
    } catch (err) {
      rollback();
      return failAction(
        `Session was not saved. ${friendlyWriteError(err)} Press the button again to retry.`
      );
    }
    return { ok: true };
  };

  // Club Owner ONLY: Top up member credit balance, grant free session passes, or toggle complete fee waiver for a specific club
  const handleUpdatePlayerWallet = async (
    playerId: string,
    updates: WalletUpdate,
    targetClubId?: string
  ): Promise<void> => {
    const resolvedClubId =
      targetClubId ||
      (effectiveClubId !== 'all'
        ? effectiveClubId
        : myOwnedClub?.id || activeClub?.id || 'club_bintang_prime');

    // The rules let any club manager (owner OR admin) write wallets, so the gate matches them
    if (!canManageClubById(resolvedClubId)) {
      reportActionError('Only the club owner or an admin can change a member wallet.');
      return;
    }

    const walletKey = makeClubWalletKey(resolvedClubId, playerId);
    const existing = playerWalletsMap[walletKey] || {
      creditBalance: 0,
      freeSessionPasses: 0,
      waiveAllFees: false,
    };
    // Optimistic value only: the real edit is applied to the SERVER wallet in a transaction
    const updatedWallet = applyWalletUpdate(existing, updates);

    // Automatically settle or reverse any finalized RSVPs for this member in THIS club using their updated waiver, passes, or credit
    const settled = settlePlayerExistingUnpaidRsvpsWithWallet({
      playerId,
      clubId: resolvedClubId,
      wallet: updatedWallet,
      rsvps: rsvpsRef.current,
      sessions,
    });

    const previousRowsById = new Map(
      rsvpsRef.current
        .filter((r) => settled.modifiedRsvps.some((m) => m.id === r.id))
        .map((r) => [r.id, r])
    );
    const modifiedById = new Map(settled.modifiedRsvps.map((r) => [r.id, r]));
    const { walletBackup } = applyLocalLedger(modifiedById, {
      [walletKey]: settled.remainingWallet,
    });

    if (!user) {
      savePlayerWalletsMap({
        ...playerWalletsMap,
        [walletKey]: settled.remainingWallet,
      });
      return;
    }

    try {
      // 1) Wallet edit on the server value (delta / clamp applied inside the transaction)
      await updateClubWalletTransactional({
        clubId: resolvedClubId,
        playerId,
        uid: user.uid,
        update: updates,
      });
    } catch (err) {
      restoreLocalLedger(previousRowsById, walletBackup);
      reportActionError(`Wallet was not updated. ${friendlyWriteError(err)}`);
      return;
    }

    // 2) Re-settle this member's finalized debts one RSVP+wallet pair at a time, oldest first,
    // on server data. They share the wallet document, so they run strictly in sequence.
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const candidates = rsvpsRef.current
      .filter((r) => {
        if (r.playerId !== playerId || r.clubId !== resolvedClubId) return false;
        const sess = sessionById.get(r.sessionId);
        if (!sess || sess.bookingStatus !== 'completed' || !sess.feeSplitFinalized) {
          return false;
        }
        const ledger = getRsvpWalletLedger(r);
        return (
          (r.paidStatus === 'unpaid' && r.feeShare > 0) ||
          (ledger.walletWaiverApplied && ledger.grossFeeShare > 0)
        );
      })
      .sort((a, b) =>
        (sessionById.get(a.sessionId)?.sessionDate || '').localeCompare(
          sessionById.get(b.sessionId)?.sessionDate || ''
        )
      );
    const tasks: RsvpWalletPairTask[] = candidates.map((r) => ({
      rsvpId: r.id,
      clubId: r.clubId,
      playerId: r.playerId,
      requireFinalizedSessionId: r.sessionId,
      compute: (serverRsvp, serverWallet) =>
        computeRsvpWalletPair({
          serverRsvp,
          serverWallet,
          finalizeSplit: true,
        }),
    }));
    if (tasks.length === 0) return;
    const batch = await runRsvpWalletPairs(tasks, user.uid, 1);
    if (batch.failed.length > 0) {
      // Server wallet is saved; the rows resync from the live listeners and any unsettled
      // debt is picked up by the next wallet change or Recalculate.
      restoreLocalLedger(previousRowsById, {});
      reportActionError(
        `Wallet saved, but ${batch.failed.length} of ${batch.total} outstanding fees could not be settled yet (${batch.failed[0].message}). Update the wallet again to retry.`
      );
    }
  };

  // Club manager: an adjustment (extra cash collected, or a refund handed back) after a share
  // was recalculated on an already-paid row is now settled; cash collected catches up to the share.
  const handleSettleRsvpAdjustment = async (
    rsvpId: string
  ): Promise<ActionResult> => {
    const failAction = (reason: string): ActionResult => {
      reportActionError(reason);
      return { ok: false, reason };
    };
    const target = rsvpsRef.current.find((r) => r.id === rsvpId);
    if (!target) return failAction('That RSVP no longer exists.');
    if (!canManageClubById(target.clubId)) {
      return failAction('Only the club organiser can settle an adjustment.');
    }
    const settledRow = settleRsvpAdjustment(target);
    if (settledRow === target) return { ok: true };
    const applyRow = (row: SessionRsvp) => {
      setRsvps((prev) => prev.map((r) => (r.id === rsvpId ? row : r)));
      rsvpsRef.current = rsvpsRef.current.map((r) => (r.id === rsvpId ? row : r));
    };
    applyRow(settledRow);
    if (!user) return { ok: true };
    const batch = await runRsvpWalletPairs(
      [
        {
          rsvpId,
          clubId: target.clubId,
          playerId: target.playerId,
          compute: (serverRsvp, serverWallet) => {
            const next = settleRsvpAdjustment(serverRsvp);
            return {
              rsvp: next,
              wallet: serverWallet,
              rsvpChanged: rsvpLedgerChanged(serverRsvp, next),
              walletChanged: false,
            };
          },
        },
      ],
      user.uid
    );
    if (batch.failed.length > 0) {
      applyRow(target);
      return failAction(`Adjustment was not saved. ${batch.failed[0].message}`);
    }
    return { ok: true };
  };

  // Normal User: Mark single RSVP as paid -> sets paidStatus to 'pending_approval'
  const handleNotifyPaymentSentForRsvp = async (
    rsvpId: string,
    method = 'Reported Paid'
  ) => {
    const target = rsvps.find((r) => r.id === rsvpId);
    if (!target || target.paidStatus === 'paid') return;
    // Only the player who owes the fee can report it as paid
    if (!activePlayer || target.playerId !== activePlayer.id) return;
    await writePaymentStatus(
      [target],
      'pending_approval',
      clampString(method, 40, 'Reported Paid')
    );
  };

  // Normal User: report all of their unpaid fees as paid (scoped to clubId when provided)
  const handleNotifyPaymentSentAllForPlayer = async (
    playerId: string,
    method = 'Reported Paid',
    clubId?: string
  ) => {
    if (!activePlayer || playerId !== activePlayer.id) return;
    const targets = rsvps.filter(
      (r) =>
        r.playerId === playerId &&
        r.paidStatus !== 'paid' &&
        r.feeShare > 0 &&
        (!clubId || r.clubId === clubId)
    );
    await writePaymentStatus(
      targets,
      'pending_approval',
      clampString(method, 40, 'Reported Paid')
    );
  };

  // Writes only the payment fields of the given rows, so a stale local copy can never undo a
  // recalculation made on another device. Rolls back and reports on failure.
  const writePaymentStatus = async (
    targets: SessionRsvp[],
    paidStatus: SessionRsvp['paidStatus'],
    paidMethod: string
  ) => {
    if (targets.length === 0) return;
    const targetIds = new Set(targets.map((t) => t.id));
    const previousRsvps = rawRsvps;
    setRsvps((prev) =>
      prev.map((r) => (targetIds.has(r.id) ? { ...r, paidStatus, paidMethod } : r))
    );
    if (!user) return;
    try {
      await safeBatchWrite(
        targets.map(
          (target): BatchWriteOperation => ({
            type: 'update',
            collectionName: 'rsvps',
            docId: target.id,
            updates: { paidStatus, paidMethod },
          })
        )
      );
    } catch (err) {
      setRsvps(previousRsvps);
      showError(err);
    }
  };

  // The organiser waives fees: anything a wallet already paid goes back first (one RSVP +
  // wallet pair per transaction), then the row owes nothing. A plain 'paid' write would leave
  // the consumed credit stranded on a row that reopen/recalculate treats as final.
  const waiveRsvps = async (targets: SessionRsvp[], paidMethod: string) => {
    if (targets.length === 0) return;
    const targetIds = new Set(targets.map((t) => t.id));
    const previousRsvps = rawRsvps;
    setRsvps((prev) =>
      prev.map((r) =>
        targetIds.has(r.id) ? { ...r, feeShare: 0, paidStatus: 'paid', paidMethod } : r
      )
    );
    if (!user) return;
    const result = await runRsvpWalletPairs(
      targets.map((r) => ({
        rsvpId: r.id,
        clubId: r.clubId,
        playerId: r.playerId,
        compute: (serverRsvp, serverWallet) =>
          computeManualWaiver({ serverRsvp, serverWallet, paidMethod }),
      })),
      user.uid
    );
    if (result.failed.length > 0) {
      setRsvps(previousRsvps);
      showError(result.failed[0].message);
    }
  };

  // Club owner or site admin: accept a payment ('paid') or waive the fee.
  const handleAcceptOrClearSingleRsvp = async (rsvpId: string, method = 'Approved') => {
    const target = rsvps.find((r) => r.id === rsvpId);
    if (!target || !canManageClubById(target.clubId)) return;
    const cleanMethod = clampString(method, 40, 'Approved');
    if (cleanMethod.startsWith('Fee Waived')) {
      await waiveRsvps([target], cleanMethod);
    } else {
      await writePaymentStatus([target], 'paid', cleanMethod);
    }
  };

  // Club owner or site admin: reject a reported payment (back to 'unpaid', marked 'Rejected').
  const handleRejectPaymentForRsvp = async (rsvpId: string) => {
    const target = rsvps.find((r) => r.id === rsvpId);
    if (!target || !canManageClubById(target.clubId)) return;
    await writePaymentStatus([target], 'unpaid', 'Rejected');
  };

  // Club owner or site admin: accept or waive all of a player's unpaid fees in their clubs.
  const handleAcceptOrClearAllForPlayer = async (
    playerId: string,
    method = 'Approved',
    clubId?: string
  ) => {
    const cleanMethod = clampString(method, 40, 'Approved');
    const unpaidForPlayer = rsvps.filter(
      (r) =>
        r.playerId === playerId &&
        r.paidStatus !== 'paid' &&
        r.feeShare > 0 &&
        (!clubId || r.clubId === clubId) &&
        canManageClubById(r.clubId)
    );
    if (cleanMethod.startsWith('Fee Waived')) {
      await waiveRsvps(unpaidForPlayer, cleanMethod);
    } else {
      await writePaymentStatus(unpaidForPlayer, 'paid', cleanMethod);
    }
  };

  // Club owner or site admin: reject all of a player's reported payments in their clubs.
  const handleRejectAllForPlayer = async (playerId: string, clubId?: string) => {
    const pendingForPlayer = rsvps.filter(
      (r) =>
        r.playerId === playerId &&
        r.paidStatus === 'pending_approval' &&
        r.feeShare > 0 &&
        (!clubId || r.clubId === clubId) &&
        canManageClubById(r.clubId)
    );
    await writePaymentStatus(pendingForPlayer, 'unpaid', 'Rejected');
  };

  const handleRecordMatch = async (matchData: {
    sessionId: string;
    matchFormat: MatchFormat;
    teamAPlayer1: Player;
    teamAPlayer2: Player | null;
    teamBPlayer1: Player;
    teamBPlayer2: Player | null;
    scoreTeamA: number;
    scoreTeamB: number;
    setScoresText: string;
    /** Game target chosen in the form (11-30); falls back to the club default. */
    targetPoints?: number;
  }) => {
    const matchSession = sessions.find((s) => s.id === matchData.sessionId);
    if (!matchSession || !canManageClubById(matchSession.clubId)) {
      throw new Error('You do not have permission to log matches for this session.');
    }
    const matchClub = clubs.find((c) => c.id === matchSession.clubId) || activeClub;
    const targetPoints = Math.round(
      clampNumber(
        Number(matchData.targetPoints) || matchClub?.defaultMatchTargetPoints || 21,
        11,
        30
      )
    );

    // Every player in the match must have joined (RSVP'd going to) this session and exist in players
    const sessionGoingIds = new Set(
      rsvps
        .filter((r) => r.sessionId === matchSession.id && r.status === 'going')
        .map((r) => r.playerId)
    );
    const knownPlayerIds = new Set(players.map((p) => p.id));
    const matchPlayerIds = [
      matchData.teamAPlayer1.id,
      matchData.teamBPlayer1.id,
      ...(matchData.matchFormat === 'doubles'
        ? [matchData.teamAPlayer2?.id, matchData.teamBPlayer2?.id]
        : []),
    ];
    if (
      matchPlayerIds.some(
        (id) => !id || !sessionGoingIds.has(id) || !knownPlayerIds.has(id)
      ) ||
      new Set(matchPlayerIds).size !== matchPlayerIds.length
    ) {
      throw new Error(
        'All match participants must have active player profiles and be marked Going in this session.'
      );
    }
    // The rules only let a club manager update stats of that club's members.
    for (const id of matchPlayerIds) {
      const participant = players.find((p) => p.id === id);
      if (participant && !hasPlayerJoinedClub(participant, matchSession.clubId)) {
        throw new Error(
          `${participant.name} is not a member of this club, so their match can't be recorded. Add them to the club first.`
        );
      }
    }

    const cleanScoreA = Math.round(clampNumber(matchData.scoreTeamA, 0, 500));
    const cleanScoreB = Math.round(clampNumber(matchData.scoreTeamB, 0, 500));
    const scoreErr = validateBadmintonMatchScores(
      cleanScoreA,
      cleanScoreB,
      targetPoints
    );
    if (scoreErr) {
      throw new Error(scoreErr);
    }
    if (!enforceRateLimit('record_match')) {
      throw new Error('Too many requests. Please wait a moment.');
    }

    const matchId = sanitizeId(`match_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const winnerSide = cleanScoreA > cleanScoreB ? 'A' : 'B';

    const newMatch: BadmintonMatch = {
      id: matchId,
      clubId: sanitizeId(matchSession.clubId),
      sessionId: sanitizeId(matchData.sessionId),
      matchFormat: matchData.matchFormat,
      teamAPlayer1Id: sanitizeId(matchData.teamAPlayer1.id),
      teamAPlayer1Name: clampString(matchData.teamAPlayer1.name, 80),
      teamAPlayer2Id:
        matchData.matchFormat === 'doubles' && matchData.teamAPlayer2
          ? sanitizeId(matchData.teamAPlayer2.id)
          : 'NONE',
      teamAPlayer2Name:
        matchData.matchFormat === 'doubles' && matchData.teamAPlayer2
          ? clampString(matchData.teamAPlayer2.name, 80)
          : 'None',
      teamBPlayer1Id: sanitizeId(matchData.teamBPlayer1.id),
      teamBPlayer1Name: clampString(matchData.teamBPlayer1.name, 80),
      teamBPlayer2Id:
        matchData.matchFormat === 'doubles' && matchData.teamBPlayer2
          ? sanitizeId(matchData.teamBPlayer2.id)
          : 'NONE',
      teamBPlayer2Name:
        matchData.matchFormat === 'doubles' && matchData.teamBPlayer2
          ? clampString(matchData.teamBPlayer2.name, 80)
          : 'None',
      scoreTeamA: cleanScoreA,
      scoreTeamB: cleanScoreB,
      setScoresText: clampString(matchData.setScoresText, 60, '21-17'),
      winnerSide,
      ownerId,
      createdAt: new Date().toISOString(),
    };

    // Stat changes are deltas applied to the server's counters (see firestore.rules
    // matchAuthorizesStats: gamesPlayed and wins+losses must grow by exactly 1), never absolute
    // values recomputed from the locally loaded match window.
    const statDeltas = aggregateMatchStatDeltas([newMatch], 1);
    const involvedPlayers = rawPlayers.filter((p) => statDeltas.has(p.id));

    setMatches((cur) => [newMatch, ...cur]);
    if (!user) {
      // Local-only mode has no server to hold the counters, so keep them here.
      setPlayers((prev) =>
        prev.map((p) => {
          const delta = statDeltas.get(p.id);
          return delta ? applyStatDelta(p, delta) : p;
        })
      );
    }

    if (user) {
      const { id, createdAt: _createdAt, ...payload } = newMatch;
      try {
        // Relies on firestore.rules matchAuthorizesStats and the matches create rule
        await safeBatchWrite([
          {
            type: 'set',
            collectionName: 'matches',
            docId: id,
            data: payload,
          },
          ...involvedPlayers.map((p) =>
            buildPlayerStatDeltaOp(p, statDeltas.get(p.id)!, id)
          ),
          // One commit: the rules accept the stats only in the batch that creates the match.
        ], { chunkSize: 5 });
      } catch (err) {
        // Only the optimistic match was added locally (cloud player counters are untouched)
        setMatches((cur) => cur.filter((m) => m.id !== id));
        throw toFriendlyWriteError(err);
      }
    }
  };

  const handleDeleteMatch = async (matchId: string) => {
    const target = matches.find((m) => m.id === matchId);
    if (!target || !canManageClubById(target.clubId)) {
      throw new Error('This match could not be found or you cannot delete it.');
    }
    if (!enforceRateLimit('delete_match')) {
      throw new Error('Too many requests. Please wait a moment.');
    }

    // Reverse exactly this match's contribution on the server's counters (deltas, not recounts)
    const { statDeltas, involvedPlayers } = statRollbackForMatch(target);

    setMatches((cur) => cur.filter((m) => m.id !== matchId));
    if (!user) {
      setPlayers((prev) =>
        prev.map((p) => {
          const delta = statDeltas.get(p.id);
          return delta ? applyStatDelta(p, delta) : p;
        })
      );
    }

    if (user) {
      try {
        await safeBatchWrite([
          { type: 'delete', collectionName: 'matches', docId: matchId },
          ...involvedPlayers.map((p) =>
            buildPlayerStatDeltaOp(p, statDeltas.get(p.id)!, matchId)
          ),
          // One commit: the rules accept the rollback only in the batch that deletes the match.
        ], { chunkSize: 5 });
      } catch (err) {
        // Put the match back (cloud player counters were never touched locally)
        setMatches((cur) =>
          cur.some((m) => m.id === matchId) ? cur : [...cur, target]
        );
        throw toFriendlyWriteError(err);
      }
    }
  };

  // Deletes the signed-in player's account in an order that stays recoverable: confirm identity,
  // leave every club, remove what the rules let a player remove, delete the profile LAST, and only
  // then delete the sign-in itself. Any failure before the profile is deleted stops with a message
  // and leaves everything usable. Throws friendly messages for Settings to display.
  const handleDeleteOwnAccount = async (options?: { password?: string }) => {
    if (!activePlayer) return;
    if (ownsAnyClub) {
      throw new Error('Ask a site admin to transfer or delete your club first.');
    }
    if (myUnpaidTotal > 0 || myPendingTotal > 0) {
      throw new Error(
        `Please settle your $${(myUnpaidTotal + myPendingTotal).toFixed(
          2
        )} in outstanding session fees before deleting your account.`
      );
    }
    if (!user) {
      // Local demo persona: nothing lives in Firestore.
      await handleSignOutAccount();
      return;
    }

    const playerId = activePlayer.id;
    const uid = user.uid;

    // 1. Reauthenticate first (Firebase requires a recent sign-in to delete an account).
    try {
      await reauthenticateCurrentUser(options?.password);
    } catch (err) {
      throw new Error(
        describeAuthError(err) ||
          'Confirmation was cancelled, so nothing was deleted.'
      );
    }

    // Decide what can be removed now: the session list shrinks as the player leaves clubs.
    const myRsvps = rsvps.filter((r) => r.playerId === playerId);
    const nowMs = Date.now();
    const isOpenSession = (sess: Session | undefined): sess is Session =>
      Boolean(sess) &&
      (sess!.bookingStatus === 'pending' || sess!.bookingStatus === 'booked') &&
      !sess!.feeSplitFinalized;
    const insideFreeWindow = (sess: Session) => {
      const freeUntilMs = toEpochMs(sess.freeCancelUntil);
      return freeUntilMs !== null && nowMs <= freeUntilMs;
    };
    // A booking past the free-cancel window cannot be withdrawn by the player (the rules
    // refuse it) and must not be left behind on a deleted account, so it blocks deletion.
    const lockedBooking = myRsvps.find((r) => {
      const sess = sessions.find((s) => s.id === r.sessionId);
      return r.status === 'going' && isOpenSession(sess) && !insideFreeWindow(sess);
    });
    if (lockedBooking) {
      const sess = sessions.find((s) => s.id === lockedBooking.sessionId);
      throw new Error(
        `You are still booked into "${sess?.title || 'a session'}" and it is past the free-cancel time. Ask the organiser to remove you, or delete your account after that session.`
      );
    }
    const deletableRsvps = myRsvps.filter((r) => {
      const sess = sessions.find((s) => s.id === r.sessionId);
      return (
        isOpenSession(sess) &&
        r.feeShare === 0 &&
        r.paidStatus === 'unpaid' &&
        r.status !== 'late_out' &&
        (r.status === 'out' || insideFreeWindow(sess))
      );
    });
    const keptRsvpCount = myRsvps.length - deletableRsvps.length;
    const myRequests = clubJoinRequests.filter((r) => r.playerId === playerId);

    let step = 'checking your profile';
    // The club-access mapping is removed below; keep the self-heal from recreating it meanwhile.
    profileWriteInFlightRef.current = true;
    try {
      // 2. Leave every club, one membership per update (what the rules allow).
      step = 'leaving your clubs';
      const freshPlayer = await getDoc(doc(db, 'players', playerId));
      let csv = freshPlayer.exists()
        ? String(
            (freshPlayer.data() as { joinedClubIdsCsv?: unknown })
              .joinedClubIdsCsv || ''
          ).trim()
        : '';
      for (const clubId of getPlayerJoinedClubIds({
        ...activePlayer,
        joinedClubIdsCsv: csv,
      })) {
        const nextCsv = removeClubFromCsv(csv, clubId);
        await safeUpdateDoc('players', playerId, {
          joinedClubIdsCsv: nextCsv,
          actingClubId: clubId,
        });
        csv = nextCsv;
      }

      // 3. Delete the RSVPs the rules let a player delete, in small batches.
      step = 'withdrawing your open RSVPs';
      for (const batch of chunkArray(deletableRsvps, 4)) {
        await safeBatchWrite(
          batch.map(
            (r): BatchWriteOperation => ({
              type: 'delete',
              collectionName: 'rsvps',
              docId: r.id,
            })
          )
        );
      }

      // 3b. Everything that needed club data is done (the mapping is what grants club reads), so
      // the account -> player mapping goes now. If a later step fails the account can retry: the
      // remaining deletes need only the player document, and the self-heal recreates the mapping
      // if the player still exists.
      step = 'removing your club access';
      await safeDeleteDoc('profiles', uid);

      // 4. Gear locker, profile claim and join requests.
      step = 'deleting your gear locker';
      const lockerSnap = await getDoc(doc(db, 'gearLockers', uid));
      if (lockerSnap.exists()) {
        await safeDeleteDoc('gearLockers', uid);
      }
      step = 'removing your profile claim';
      await safeDeleteDoc('profileClaims', uid);
      step = 'removing your join requests';
      for (const batch of chunkArray(myRequests, 4)) {
        await safeBatchWrite(
          batch.map(
            (r): BatchWriteOperation => ({
              type: 'delete',
              collectionName: 'clubJoinRequests',
              docId: r.id,
            })
          )
        );
      }

      // 5. The player document goes last, so any earlier failure leaves a working profile.
      step = 'deleting your profile';
      await safeDeleteDoc('players', playerId);
    } catch (err) {
      // Let the mapping check run again so a half-finished deletion leaves a working account.
      profileWriteInFlightRef.current = false;
      setHealNonce((n) => n + 1);
      throw new Error(
        `Account deletion stopped while ${step}: ${describeFirestoreFailure(
          err
        )} Nothing else was removed and you can try again.`
      );
    }

    // 6. Finally remove the sign-in itself.
    let notice: string | null = keptRsvpCount > 0
      ? `Your account was deleted. ${keptRsvpCount} past session record(s) stay with the club for its own books.`
      : 'Your account was deleted.';
    let failure: string | null = null;
    try {
      await deleteCurrentAuthUser();
    } catch (err) {
      failure =
        'Your CourtPulse data was deleted, but your sign-in could not be removed automatically. Sign in again and delete the account once more, or contact support.';
      notice = null;
      console.error('Auth user deletion failed', err);
    }
    clearAllCourtPulseLocalData();
    await handleSignOutAccount();
    profileWriteInFlightRef.current = false;
    setSignedOutNotice(notice);
    setAuthErrorMessage(failure);
  };

  // Errors are surfaced by the auth screen (describeAuthError)
  const handleGoogleSignIn = async () => {
    setAuthErrorMessage(null);
    setSignedOutNotice(null);
    await signInWithGooglePopup();
  };

  const invitedSessionForGate = pendingInviteSessionId
    ? sessions.find((s) => s.id === pendingInviteSessionId) || null
    : null;

  const invitedClubForGate =
    (pendingInviteClubId
      ? clubs.find((c) => c.id === pendingInviteClubId) || null
      : null) ||
    (invitedSessionForGate
      ? clubs.find((c) => c.id === invitedSessionForGate.clubId) || null
      : null);

  // A listener failed or the server never answered: never leave the player on a spinner.
  if (dataError && user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div
          role="alert"
          className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4 text-center"
        >
          <h1 className="text-base font-bold text-slate-900">
            CourtPulse could not load your data
          </h1>
          <p className="text-xs text-slate-600 leading-relaxed">{dataError}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDataError(null);
                setRetryNonce((n) => n + 1);
              }}
              className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void handleSignOutAccount()}
              className="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Signed-in members wait for the club-access mapping (profiles/{uid}) before the app renders, so
  // club data is never read, or shown as empty, before the rules can grant it.
  const awaitingProfileMapping = Boolean(
    user &&
      isUserVerified &&
      playersLoaded &&
      activePlayer &&
      !isAdminAccount &&
      !profileMapReady
  );
  if (
    !authReady ||
    (user && isUserVerified && !playersLoaded) ||
    awaitingProfileMapping
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xs font-semibold text-slate-500">
        Loading CourtPulse…
      </div>
    );
  }

  if (!user && !devSession) {
    if (invitedSessionForGate && !authGateRequestedFromPreview) {
      const invitedSessionRsvps = rsvps.filter(
        (r) => r.sessionId === invitedSessionForGate.id
      );
      return (
        <SharedSessionPreviewScreen
          session={invitedSessionForGate}
          club={invitedClubForGate}
          sessionRsvps={invitedSessionRsvps}
          onJoinSession={() => {
            setAuthGateInitialMode('register');
            setAuthGateRequestedFromPreview(true);
          }}
          onSignIn={() => {
            setAuthGateInitialMode('login');
            setAuthGateRequestedFromPreview(true);
          }}
        />
      );
    }
    return (
      <AuthGateScreen
        invitedClub={invitedClubForGate}
        invitedSession={invitedSessionForGate}
        initialMode={authGateInitialMode}
        onBackToSessionPreview={
          invitedSessionForGate
            ? () => setAuthGateRequestedFromPreview(false)
            : undefined
        }
        onSignInWithGoogle={handleGoogleSignIn}
        onDevLogin={IS_DEV_MODE ? handleDevLogin : undefined}
        authError={authErrorMessage}
        signedOutNotice={signedOutNotice}
      />
    );
  }

  if (user && !isUserVerified) {
    return (
      <VerifyEmailScreen
        email={user.email || 'your email'}
        onVerified={() => setAuthVersion((v) => v + 1)}
        onSignOut={() => void handleSignOutAccount()}
      />
    );
  }

  if (!activePlayer) {
    return (
      <ProfileSetupScreen
        accountName={user?.displayName || devSession?.name || ''}
        accountEmail={user?.email || devSession?.email || ''}
        unclaimedPlayers={players.filter((p) => !p.authUid)}
        pendingClaimPlayer={
          myProfileClaim
            ? players.find((p) => p.id === myProfileClaim.playerId) || null
            : null
        }
        hasPendingClaim={Boolean(myProfileClaim)}
        onCreateProfile={handleCreateOwnProfile}
        onRequestClaim={handleRequestProfileClaim}
        onCancelClaim={handleCancelProfileClaim}
        onSignOut={() => void handleSignOutAccount()}
      />
    );
  }

  const modalJoinClub = clubJoinModalClubId
    ? clubs.find((c) => c.id === clubJoinModalClubId) ||
      (inviteClubInfo?.id === clubJoinModalClubId ? inviteClubInfo.club : null)
    : null;
  // An invited private club the player may not read: generic card, club id only.
  const showPrivateInviteCard = Boolean(
    clubJoinModalClubId &&
      !modalJoinClub &&
      inviteClubInfo?.id === clubJoinModalClubId &&
      inviteClubInfo.club === null
  );

  // Only offer the view modes this account is actually entitled to.
  // - Site Admins can switch between User, Owner (if they also own a club), and Admin views.
  // - Pure Club Owners do not have a toggle to switch to User view — they stay in Owner view.
  const tierOptions: { value: PermissionTier; label: string }[] = isAdminAccount
    ? [
        { value: 'user', label: 'User' },
        ...(ownsAnyClub
          ? [{ value: 'club_owner' as PermissionTier, label: 'Owner' }]
          : []),
        { value: 'admin', label: 'Admin' },
      ]
    : ownsAnyClub
    ? [{ value: 'club_owner', label: 'Owner' }]
    : [{ value: 'user', label: 'User' }];

  const navItems: {
    id: ActiveTab;
    label: string;
    shortLabel?: string;
    isActive: boolean;
    badge?: string;
  }[] = [
    {
      id: 'sessions',
      label: 'Sessions',
      isActive: activeTab === 'sessions' || activeTab === 'rsvp',
    },
    {
      id: 'leaderboard',
      label: 'Standings',
      isActive: activeTab === 'leaderboard',
    },
    {
      id: 'clubs',
      label: 'Clubs',
      isActive: activeTab === 'clubs',
    },
    ...(canManageFunds
      ? [
          {
            id: 'users' as const,
            label: 'Users & Balances',
            shortLabel: 'Users',
            isActive: activeTab === 'users',
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen flex flex-col text-slate-900 pb-20 md:pb-12">
      {errorNotice && (
        <div
          role="alert"
          className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-[min(92vw,28rem)] rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-900 shadow-lg flex items-start gap-3"
        >
          <span className="break-words">{errorNotice}</span>
          <button
            type="button"
            onClick={() => setErrorNotice(null)}
            className="shrink-0 font-semibold text-rose-700 hover:text-rose-900 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Top Navigation Bar — Responsive across Mobile, Tablet (md/lg), and Desktop (xl+) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 lg:px-8 py-3 shadow-2xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between xl:grid xl:grid-cols-[auto_1fr_auto] gap-3 sm:gap-4">
          {/* Zone 1: Brand Title (Left) */}
          <div className="flex items-center justify-self-start min-w-0">
            <a
              href="#sessions"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('sessions');
              }}
              className="text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0 flex items-center"
            >
              <span>CourtPulse</span>
            </a>
          </div>

          {/* Zone 2 (Desktop xl+): Centered Navigation Links with Animated Active Indicator */}
          <nav
            aria-label="Primary Navigation"
            className="hidden xl:flex items-center justify-center gap-1 text-xs font-semibold text-slate-700 justify-self-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/80"
          >
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleSelectNavItem(item.id);
                }}
                className={`relative px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                  item.isActive
                    ? 'text-slate-950 font-bold'
                    : 'text-slate-700 hover:text-slate-950 hover:bg-white/60'
                }`}
              >
                {item.isActive && (
                  <motion.span
                    layoutId="desktop-nav-pill"
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    className="absolute inset-0 bg-white rounded-lg shadow-2xs border border-slate-200/90"
                  />
                )}
                <span className="relative z-10">{item.label}</span>
                {item.badge && (
                  <span
                    className="relative z-10 font-mono tabular-nums text-[11px] font-bold text-amber-700"
                    title={`Unpaid balance: $${myUnpaidTotal.toFixed(2)}`}
                  >
                    ({item.badge})
                  </span>
                )}
              </a>
            ))}
          </nav>

          {/* Zone 3: Right Controls (Owe Fee ONLY when not cleared + Responsive Account / Sign Out) */}
          <div className="flex items-center justify-end gap-2 sm:gap-2.5 shrink-0 justify-self-end">
            {/* Owe Fee Button — Hidden when cleared ($0.00); only appears when unpaid or pending */}
            {myUnpaidTotal > 0 ? (
              <button
                type="button"
                onClick={() => setPaymentModalOpen(true)}
                className="h-9 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
                title="Click to settle your unpaid session fees"
              >
                <span>
                  Owe{' '}
                  <span className="font-mono tabular-nums font-bold">
                    ${myUnpaidTotal.toFixed(2)}
                  </span>
                </span>
              </button>
            ) : myPendingTotal > 0 ? (
              <button
                type="button"
                onClick={() => setPaymentModalOpen(true)}
                className="h-9 px-3 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-900 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
                title="Payment marked as sent; waiting for Club Owner approval"
              >
                <span>
                  Pending{' '}
                  <span className="font-mono tabular-nums font-bold">
                    ${myPendingTotal.toFixed(2)}
                  </span>
                </span>
              </button>
            ) : null}

            {/* Compact Account Menu Dropdown across all viewports (Mobile, Tablet & Desktop) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && accountMenuOpen) {
                    e.stopPropagation();
                    setAccountMenuOpen(false);
                  }
                }}
                className={`h-9 px-3 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer border transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/20 ${
                  (activeTab === 'profile' ||
                    activeTab === 'settings' ||
                    activeTab === 'gear') &&
                  (!inspectedPlayerId || inspectedPlayerId === activePlayer.id)
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : accountMenuOpen
                    ? 'text-slate-900 bg-slate-50 border-emerald-600 ring-3 ring-emerald-500/15 shadow-2xs'
                    : 'text-slate-800 bg-white hover:bg-slate-50 hover:border-slate-400 border-slate-300 shadow-2xs'
                }`}
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
              >
                <UserIcon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    (activeTab === 'profile' ||
                      activeTab === 'settings' ||
                      activeTab === 'gear') &&
                    (!inspectedPlayerId || inspectedPlayerId === activePlayer.id)
                      ? 'text-white'
                      : 'text-emerald-600'
                  }`}
                />
                <span className="truncate max-w-28 sm:max-w-36">
                  {activePlayer.name}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-150 ${
                    (activeTab === 'profile' ||
                      activeTab === 'settings' ||
                      activeTab === 'gear') &&
                    (!inspectedPlayerId || inspectedPlayerId === activePlayer.id)
                      ? 'text-slate-300'
                      : accountMenuOpen
                      ? 'text-emerald-600'
                      : 'text-slate-600'
                  } ${accountMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              <AnimatePresence>
                {accountMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setAccountMenuOpen(false)}
                      aria-hidden="true"
                    />
                    <motion.div
                      role="menu"
                      aria-label="Account menu"
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute right-0 mt-1.5 w-60 bg-white border border-slate-200/95 rounded-2xl shadow-xl shadow-slate-900/10 py-2 px-2.5 z-50 space-y-1 ring-1 ring-slate-900/5"
                    >
                      <div className="px-2.5 py-1.5 pb-2 mb-1 border-b border-slate-100">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {activePlayer.name}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 font-medium mt-0.5 truncate">
                          {activePlayer.playerTag}
                        </p>
                      </div>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          handleOpenProfileView(activePlayer.id);
                        }}
                        className="w-full h-9 px-2.5 text-xs font-semibold text-slate-700 hover:text-slate-950 hover:bg-slate-50 rounded-xl flex items-center gap-2 transition-all active:scale-[0.98] whitespace-nowrap cursor-pointer"
                      >
                        <UserIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>Profile &amp; Preferences</span>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          handleOpenGearLocker();
                        }}
                        className="w-full h-9 px-2.5 text-xs font-semibold text-slate-700 hover:text-slate-950 hover:bg-slate-50 rounded-xl flex items-center gap-2 transition-all active:scale-[0.98] whitespace-nowrap cursor-pointer"
                      >
                        <Briefcase className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>My Gear Locker</span>
                      </button>

                      {IS_DEV_MODE && !user && devSession && (
                        <div className="pt-1 mt-1 border-t border-slate-100 space-y-1">
                          <p className="px-2.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                            Switch Dev Persona
                          </p>
                          {DEV_LOGIN_PERSONAS.map((persona) => {
                            const isCurrentPersona =
                              activePlayer.id === persona.playerId;
                            return (
                              <button
                                key={persona.playerId}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  handleDevLogin(persona);
                                  setAccountMenuOpen(false);
                                }}
                                className={`w-full px-2.5 py-1.5 text-left rounded-xl text-xs flex items-center justify-between gap-2 transition-all active:scale-[0.99] cursor-pointer ${
                                  isCurrentPersona
                                    ? 'bg-emerald-50 text-emerald-950 font-bold'
                                    : 'text-slate-700 hover:bg-slate-50 font-medium'
                                }`}
                              >
                                <span className="truncate">{persona.name}</span>
                                <span className="text-[10px] font-mono text-slate-500 shrink-0">
                                  {persona.tier === 'admin'
                                    ? 'Admin'
                                    : persona.tier === 'club_owner'
                                    ? 'Owner'
                                    : 'Member'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="pt-1 mt-1 border-t border-slate-100">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAccountMenuOpen(false);
                            void handleSignOutAccount();
                          }}
                          className="w-full h-9 px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-xl flex items-center gap-2 transition-all active:scale-[0.98] whitespace-nowrap cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5 shrink-0" />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Tablet Navigation Bar (md to xl): Full-width centered pill bar so Tablet never clips tabs */}
        <nav
          aria-label="Tablet Navigation"
          className="hidden md:flex xl:hidden max-w-6xl mx-auto mt-2.5 pt-2.5 border-t border-slate-100 flex-wrap items-center justify-center gap-1 text-xs font-semibold text-slate-700"
        >
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                handleSelectNavItem(item.id);
              }}
              className={`relative px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                item.isActive
                  ? 'bg-slate-900 text-white font-bold shadow-2xs'
                  : 'text-slate-700 hover:text-slate-950 hover:bg-slate-100'
              }`}
            >
              <span>{item.shortLabel || item.label}</span>
              {item.badge && (
                <span
                  className={`font-mono tabular-nums text-[11px] font-bold ${
                    item.isActive ? 'text-amber-300' : 'text-amber-700'
                  }`}
                >
                  ({item.badge})
                </span>
              )}
            </a>
          ))}
        </nav>
      </header>

      {/* Compact Unpaid Session Balance Strip */}
      {activeClub && (
        <PaymentRequestBannerAndModal
          activeClub={activeClub}
          clubs={clubs}
          activePlayer={activePlayer}
          outstandingDebts={activePlayerDebts}
          canManageClub={false}
          onNotifyPaymentSentAll={(method, clubId) =>
            handleNotifyPaymentSentAllForPlayer(activePlayer.id, method, clubId)
          }
          onNotifyPaymentSentSingle={handleNotifyPaymentSentForRsvp}
          onAcceptOrClearAll={(method, clubId) =>
            handleAcceptOrClearAllForPlayer(activePlayer.id, method, clubId)
          }
          onAcceptOrClearSingle={handleAcceptOrClearSingleRsvp}
          onRejectSingle={handleRejectPaymentForRsvp}
          autoPromptOpen={paymentModalOpen}
          onCloseAutoPrompt={() => setPaymentModalOpen(false)}
          onOpenPrompt={() => setPaymentModalOpen(true)}
          onGoToLedger={
            canManageFunds
              ? (sessionId?: string) => {
                  if (sessionId) {
                    const targetSess = sessions.find((s) => s.id === sessionId);
                    if (targetSess) {
                      setActiveClubId(targetSess.clubId);
                    }
                    setSelectedSessionId(sessionId);
                  }
                  setOpenPayInfoOnLedger(true);
                  setActiveTab('rsvp');
                }
              : undefined
          }
        />
      )}

      {/* Workspace Context Bar — Stacks cleanly on narrow mobile, side-by-side on tablet & desktop */}
      <div className="bg-white border-b border-slate-200/80 px-4 sm:px-6 lg:px-8 py-2.5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 text-xs">
          <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto flex-1 sm:flex-initial">
            {showTopClubSelectorOnTab ? (
              <>
                <span className="text-slate-700 font-semibold shrink-0">
                  Club:
                </span>
                <div className="w-full sm:w-64 md:w-72 min-w-0">
                  <StyledSelect
                    aria-label="Filter by badminton club"
                    value={effectiveClubId}
                    onChange={(e) => {
                      const nextClubId = e.target.value;
                      setActiveClubId(nextClubId);
                      const firstClubSession =
                        nextClubId === 'all'
                          ? sessions.find((s) =>
                              selectorClubs.some((c) => c.id === s.clubId)
                            )
                          : sessions.find((s) => s.clubId === nextClubId);
                      if (firstClubSession) {
                        setSelectedSessionId(firstClubSession.id);
                      }
                    }}
                  >
                    {isAllClubsAllowedOnTab && (
                      <option value="all">
                        All Joined Clubs ({selectorClubs.length})
                      </option>
                    )}
                    {selectorClubs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </StyledSelect>
                </div>
              </>
            ) : (
              <span className="text-xs font-semibold text-slate-700 truncate">
                {activeTab === 'clubs'
                  ? clubs.length === 0
                    ? 'Clubs Directory · No clubs created yet'
                    : `Active Club: ${activeClub?.name || 'Badminton Club'}`
                  : activeTab === 'users'
                  ? clubs.length === 0
                    ? 'Platform Users Directory'
                    : `Directory & Member Ledger · ${activeClub?.name || 'Badminton Club'}`
                  : activeTab === 'gear'
                  ? `Gear Locker · ${currentLockerPlayer?.name ?? activePlayer.name}`
                  : activeTab === 'settings'
                  ? `Personal Settings · ${activePlayer.name}`
                  : activeTab === 'profile'
                  ? `Player Profile · ${activePlayer.name}`
                  : effectiveClubId === 'none'
                  ? clubs.length === 0
                    ? 'No platform clubs created yet'
                    : 'No club joined yet'
                  : `Club: ${
                      (activeTab === 'sessions'
                        ? sessionsViewClub?.name
                        : activeClub?.name) || 'Badminton Club'
                    }`}
              </span>
            )}
          </div>

          {/* Right: 3-Tier Permission Switcher (User | Owner | Admin) */}
          <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
            {tierOptions.length > 1 && (
              <span className="sm:hidden text-xs font-semibold text-slate-600">
                View Mode:
              </span>
            )}
            {rateLimitNotice && (
              <span className="hidden md:inline text-amber-700 font-medium">
                {rateLimitNotice}
              </span>
            )}

            {/* Plain members have a single mode, so the switcher is hidden for them */}
            {tierOptions.length > 1 && (
              <SegmentedControl
                size="sm"
                options={tierOptions}
                value={effectiveTier}
                onChange={handleSetTier}
              />
            )}
          </div>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed inset-x-3 bottom-20 md:bottom-6 md:left-auto md:right-6 md:max-w-md z-[70] rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 shadow-lg text-xs font-semibold text-rose-900 flex items-start justify-between gap-3"
        >
          <span>{actionError}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setActionError(null)}
            className="shrink-0 text-rose-700 hover:text-rose-900 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Club Join Invitation Modal */}
      {clubJoinModalClubId && (modalJoinClub || showPrivateInviteCard) && (
        <ClubJoinPromptModal
          club={modalJoinClub}
          clubId={clubJoinModalClubId}
          player={activePlayer}
          hasPendingRequest={clubJoinRequests.some(
            (r) =>
              r.clubId === clubJoinModalClubId &&
              r.playerId === activePlayer.id
          )}
          onAcceptJoinClub={handleJoinOrRequestClub}
          onCancelRequest={handleCancelClubJoinRequest}
          onDismiss={() => setClubJoinModalClubId(null)}
        />
      )}

      {/* Main Content Container with Smooth View Transitions */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-5 sm:py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {((activeTab === 'sessions' && !sessionsViewClub) ||
              ((activeTab === 'rsvp' || activeTab === 'leaderboard') &&
                effectiveClubId === 'none')) && (
              <div className="p-10 text-center bg-white rounded-2xl border border-slate-200/80 space-y-3">
                <Building2 className="w-6 h-6 text-slate-400 mx-auto" />
                <p className="text-sm font-semibold text-slate-900">
                  {clubs.length === 0
                    ? effectiveTier === 'admin'
                      ? 'No clubs have been created yet'
                      : 'No clubs available on the platform yet'
                    : 'You haven’t joined any clubs yet'}
                </p>
                <p className="text-xs text-slate-600 max-w-md mx-auto">
                  {clubs.length === 0
                    ? effectiveTier === 'admin'
                      ? 'Create your first badminton club to start organizing court sessions, inviting members, and tracking match standings.'
                      : 'Once a platform administrator creates and publishes a badminton club, you will be able to join it from the Clubs tab.'
                    : 'Sessions and standings appear here once you join a club. Public clubs can be joined instantly; private clubs need owner approval.'}
                </p>
                <button
                  type="button"
                  onClick={() => handleSelectNavItem('clubs')}
                  className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer shadow-xs"
                >
                  {clubs.length === 0 && effectiveTier === 'admin'
                    ? 'Create First Club'
                    : 'Browse Clubs'}
                </button>
              </div>
            )}

            {activeTab === 'sessions' && sessionsViewClub && (
              <SessionsOverviewAndQuickOrganize
                activeClub={sessionsViewClub}
                clubs={sessionTabClubs}
                isAllClubsFilter={effectiveClubId === 'all'}
                sessions={clubSessions}
                rsvps={clubRsvps}
                matches={clubMatches}
                activePlayer={activePlayer}
                isAdmin={canManageActiveClub}
                permissionTier={effectiveTier}
                onCreateSession={handleCreateSession}
                onOpenSessionDetail={(sessionId, openPayInfo) => {
                  const targetSess = sessions.find((s) => s.id === sessionId);
                  if (targetSess) {
                    setActiveClubId(targetSess.clubId);
                  }
                  setSelectedSessionId(sessionId);
                  setInitialSessionSubTab('roster');
                  if (openPayInfo) {
                    setOpenPayInfoOnLedger(true);
                  }
                  setActiveTab('rsvp');
                }}
                onOpenMatchScorerForSession={(sessionId) => {
                  const targetSess = sessions.find((s) => s.id === sessionId);
                  if (targetSess) {
                    setActiveClubId(targetSess.clubId);
                  }
                  setSelectedSessionId(sessionId);
                  setInitialSessionSubTab('matches');
                  setActiveTab('rsvp');
                }}
                onCloneNextWeekSession={handleCloneNextWeekSession}
                showQuickOrganizerRef={quickOrganizerRef}
              />
            )}

            {activeTab === 'rsvp' &&
              activeClub &&
              effectiveClubId !== 'none' &&
              (() => {
                const selectedSess =
                  clubSessions.find((s) => s.id === selectedSessionId) ||
                  clubSessions[0] ||
                  null;
                const sessionClub =
                  (selectedSess &&
                    clubs.find((c) => c.id === selectedSess.clubId)) ||
                  activeClub;
                return (
                  <TapRsvpPortal
                    activeClub={sessionClub}
                    sessions={clubSessions}
                    selectedSessionId={selectedSessionId}
                    onSelectSession={setSelectedSessionId}
                    rsvps={clubRsvps}
                    players={clubPlayers}
                    activePlayer={activePlayer}
                    walletsMap={playerWalletsMap}
                    isAdmin={canManageClubById(sessionClub.id)}
                    permissionTier={effectiveTier}
                    canManageClub={canManageClubById(sessionClub.id)}
                    isActualClubOwner={isOwnerOfClubById(sessionClub.id)}
                    initialOpenPayInfo={openPayInfoOnLedger}
                    onConsumeInitialOpenPayInfo={() =>
                      setOpenPayInfoOnLedger(false)
                    }
                    onTapRsvp={handleTapRsvp}
                    onMarkAttendanceOutcome={handleMarkAttendanceOutcome}
                    onUpdateSessionBooking={handleUpdateSessionBooking}
                    onEditSessionDetails={handleEditSessionDetails}
                    onReopenSessionSplit={handleReopenSessionSplit}
                    onSettleRsvpAdjustment={handleSettleRsvpAdjustment}
                    onDeleteSession={handleDeleteSession}
                    onUpdateClubPaymentDetails={handleUpdateClubPaymentDetails}
                    onFinalizeSessionShuttleAndSplit={
                      handleFinalizeSessionShuttleAndSplit
                    }
                    onNotifyPaymentSentForRsvp={handleNotifyPaymentSentForRsvp}
                    onAcceptOrClearSingleRsvp={handleAcceptOrClearSingleRsvp}
                    onRejectPaymentForRsvp={handleRejectPaymentForRsvp}
                    onOpenMatchScorerForSession={(sessionId) => {
                      setSelectedSessionId(sessionId);
                      setInitialSessionSubTab('matches');
                    }}
                    onBackToSessions={() => setActiveTab('sessions')}
                    matches={clubMatches}
                    rankedPlayers={rankedClubPlayers}
                    onRecordMatch={handleRecordMatch}
                    onDeleteMatch={handleDeleteMatch}
                    onOpenProfileView={handleOpenProfileView}
                    initialSessionSubTab={initialSessionSubTab}
                    onConsumeInitialSessionSubTab={() =>
                      setInitialSessionSubTab(undefined)
                    }
                  />
                );
              })()}

            {activeTab === 'leaderboard' && effectiveClubId !== 'none' && (
              <LeaderboardAndTierView
                rankedPlayers={rankedClubPlayers}
                matches={clubMatches}
                sessions={clubSessions}
                activePlayer={activePlayer}
                onOpenProfileView={handleOpenProfileView}
              />
            )}

            {activeTab === 'profile' && activeClub && activePlayer && (
              <PlayerProfileAndHistoryView
                activePlayer={activePlayer}
                inspectedPlayerId={inspectedPlayerId}
                rankedPlayers={rankedClubPlayers}
                allPlayers={players}
                clubs={clubs}
                activeClub={activeClub}
                sessions={sessions}
                rsvps={rsvps}
                matches={clubMatches}
                walletsMap={playerWalletsMap}
                canManageClub={canManageClubById(activeClub.id)}
                canManageClubById={canManageClubById}
                onUpdateOwnProfile={handleUpdateOwnProfile}
                onTapRsvp={handleTapRsvp}
                onNotifyPaymentSentForRsvp={handleNotifyPaymentSentForRsvp}
                onNotifyPaymentSentAllForPlayer={
                  handleNotifyPaymentSentAllForPlayer
                }
                onUpdatePlayerWallet={handleUpdatePlayerWallet}
                onOpenGearLocker={handleOpenGearLocker}
              />
            )}

            {activeTab === 'gear' && currentLockerPlayer && (
              <EquipmentLockerView
                player={currentLockerPlayer}
                canEdit={true}
                cloudOwnerId={user?.uid ?? null}
              />
            )}

            {activeTab === 'clubs' && activeClub && (
              <AdminClubAndPolicySettings
                clubs={clubs}
                userJoinedClubs={userJoinedClubs}
                unjoinedClubs={unjoinedClubs}
                activeClub={activeClub}
                players={players}
                sessions={sessions}
                activePlayer={activePlayer}
                activePlayerDebts={activePlayerDebts}
                walletsMap={playerWalletsMap}
                permissionTier={effectiveTier}
                canManageActiveClub={canManageActiveClub}
                onSelectClub={setActiveClubId}
                onJoinClub={(clubId) => {
                  setClubJoinModalClubId(clubId);
                  return Promise.resolve();
                }}
                onLeaveClub={handleLeaveClub}
                onRemoveMemberFromClub={handleRemoveMemberFromClub}
                onAdminAddMemberToClub={(name, targetClubId) =>
                  handleAdminAddMemberToClub(name, targetClubId)
                }
                onAssignClubOwner={handleAssignClubOwner}
                onDeleteClub={handleDeleteClub}
                clubJoinRequests={clubJoinRequests}
                onCancelJoinRequest={handleCancelClubJoinRequest}
                onApproveJoinRequest={handleApproveClubJoinRequest}
                onRejectJoinRequest={handleRejectClubJoinRequest}
                onUpdateClubVisibility={handleUpdateClubVisibility}
                onCreateNewClub={handleCreateNewClub}
                onUpdateClubSettings={handleUpdateClubSettings}
                onTriggerClubJoinPromptPreview={(clubId) =>
                  setClubJoinModalClubId(clubId)
                }
                onOpenUsersDirectory={
                  canManageFunds ? () => setActiveTab('users') : undefined
                }
                onUpdatePlayerWallet={handleUpdatePlayerWallet}
              />
            )}

            {activeTab === 'users' &&
              canManageFunds &&
              (activeClub || myOwnedClub || clubs[0]) &&
              (() => {
                const targetClubForUsers =
                  effectiveTier === 'club_owner' &&
                  myOwnedClub &&
                  (!activeClub ||
                    activeClub.clubOwnerPlayerId !== activePlayer.id)
                    ? myOwnedClub
                    : activeClub || clubs[0];
                const scopedPlayers =
                  effectiveTier === 'admin'
                    ? players
                    : players.filter((p) =>
                        hasPlayerJoinedClub(p, targetClubForUsers.id)
                      );
                const scopedSessions =
                  effectiveTier === 'admin'
                    ? sessions
                    : sessions.filter((s) => s.clubId === targetClubForUsers.id);
                const scopedRsvps =
                  effectiveTier === 'admin'
                    ? rsvps
                    : rsvps.filter((r) => r.clubId === targetClubForUsers.id);

                return (
                  <>
                  {isAdminAccount && profileClaims.length > 0 && (
                    <div className="mb-5 bg-amber-50/60 border border-amber-200 rounded-2xl p-4 sm:p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                          Account Link Requests ({profileClaims.length})
                        </h2>
                        <span className="text-xs text-amber-900/80 font-medium">
                          Confirm the person owns this profile before linking it to their sign-in
                        </span>
                      </div>
                      <div className="divide-y divide-amber-100 bg-white border border-amber-200/80 rounded-xl">
                        {profileClaims.map((claim) => {
                          const target = players.find(
                            (p) => p.id === claim.playerId
                          );
                          return (
                            <div
                              key={claim.uid}
                              className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3"
                            >
                              <div className="min-w-0 text-xs">
                                <p className="font-bold text-slate-900">
                                  {claim.displayName || claim.email}{' '}
                                  <span className="font-mono font-medium text-slate-500">
                                    {claim.email}
                                  </span>
                                </p>
                                <p className="text-[11px] text-slate-600 mt-0.5">
                                  Wants to link profile:{' '}
                                  <span className="font-semibold text-slate-900">
                                    {target
                                      ? `${target.name} (${target.playerTag})`
                                      : 'profile no longer exists'}
                                  </span>
                                  {target?.authUid
                                    ? ' · already linked to another account'
                                    : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleRejectProfileClaim(claim.uid)
                                  }
                                  className="h-8 px-3 rounded-xl bg-white hover:bg-rose-50 border border-slate-300 text-rose-700 text-xs font-semibold cursor-pointer"
                                >
                                  Decline
                                </button>
                                <button
                                  type="button"
                                  disabled={!target || Boolean(target.authUid)}
                                  onClick={() =>
                                    void handleApproveProfileClaim(claim.uid)
                                  }
                                  className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-semibold cursor-pointer"
                                >
                                  Link Account
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <SiteAdminUserManagement
                    players={scopedPlayers}
                    clubs={
                      effectiveTier === 'admin' ? clubs : [targetClubForUsers]
                    }
                    activeClub={targetClubForUsers}
                    sessions={scopedSessions}
                    rsvps={scopedRsvps}
                    walletsMap={playerWalletsMap}
                    activePlayer={activePlayer}
                    permissionTier={effectiveTier}
                    onAdminCreateUser={handleAdminCreateUser}
                    onAdminUpdateUser={handleAdminUpdateUser}
                    onAdminDeleteUser={handleAdminDeleteUser}
                    onRemoveMemberFromClub={handleRemoveMemberFromClub}
                    onAssignClubOwner={handleAssignClubOwner}
                    onAcceptOrClearSingleRsvp={handleAcceptOrClearSingleRsvp}
                    onRejectPaymentForRsvp={handleRejectPaymentForRsvp}
                    onAcceptOrClearAllForPlayer={handleAcceptOrClearAllForPlayer}
                    onRejectAllForPlayer={handleRejectAllForPlayer}
                    onOpenPlayerProfile={handleOpenProfileView}
                    onOpenSessionLedger={(sessionId) => {
                      const targetSess = sessions.find(
                        (s) => s.id === sessionId
                      );
                      if (targetSess) {
                        setActiveClubId(targetSess.clubId);
                      }
                      setSelectedSessionId(sessionId);
                      setActiveTab('rsvp');
                    }}
                    onUpdatePlayerWallet={handleUpdatePlayerWallet}
                  />
                  </>
                );
              })()}

            {activeTab === 'settings' && activeClub && activePlayer && (
              <SettingsView
                activePlayer={activePlayer}
                activeClub={activeClub}
                joinedClubs={memberClubs}
                activePlayerDebts={activePlayerDebts}
                walletsMap={playerWalletsMap}
                permissionTier={effectiveTier}
                onUpdateOwnProfile={handleUpdateOwnProfile}
                onLeaveClub={handleLeaveClub}
                onDeleteOwnAccount={handleDeleteOwnAccount}
                reauthMethod={user ? getReauthMethod() : 'unknown'}
                onOpenClubsView={() => setActiveTab('clubs')}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Tab Bar (< md) — Sessions, Standings & Clubs with Animated Active Indicator */}
      <nav
        aria-label="Mobile Navigation"
        className={`md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 grid ${
          canManageFunds ? 'grid-cols-4' : 'grid-cols-3'
        } items-center min-h-16 pb-[env(safe-area-inset-bottom)] px-1 shadow-lg`}
      >
        <button
          type="button"
          onClick={() => handleSelectNavItem('sessions')}
          className={`relative flex flex-col items-center justify-center h-full text-[11px] whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'sessions' || activeTab === 'rsvp'
              ? 'text-slate-950 font-bold'
              : 'text-slate-600 font-semibold hover:text-slate-900'
          }`}
        >
          {(activeTab === 'sessions' || activeTab === 'rsvp') && (
            <motion.span
              layoutId="mobile-nav-indicator"
              className="absolute top-0 inset-x-3 h-0.5 bg-emerald-600 rounded-b-full"
            />
          )}
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="mt-1">Sessions</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectNavItem('leaderboard')}
          className={`relative flex flex-col items-center justify-center h-full text-[11px] whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'leaderboard'
              ? 'text-slate-950 font-bold'
              : 'text-slate-600 font-semibold hover:text-slate-900'
          }`}
        >
          {activeTab === 'leaderboard' && (
            <motion.span
              layoutId="mobile-nav-indicator"
              className="absolute top-0 inset-x-3 h-0.5 bg-emerald-600 rounded-b-full"
            />
          )}
          <Award className="w-4 h-4 shrink-0" />
          <span className="mt-1">Standings</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectNavItem('clubs')}
          className={`relative flex flex-col items-center justify-center h-full text-[11px] whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'clubs'
              ? 'text-slate-950 font-bold'
              : 'text-slate-600 font-semibold hover:text-slate-900'
          }`}
        >
          {activeTab === 'clubs' && (
            <motion.span
              layoutId="mobile-nav-indicator"
              className="absolute top-0 inset-x-3 h-0.5 bg-emerald-600 rounded-b-full"
            />
          )}
          <Building2 className="w-4 h-4 shrink-0" />
          <span className="mt-1">Clubs</span>
        </button>

        {canManageFunds && (
          <button
            type="button"
            onClick={() => handleSelectNavItem('users')}
            className={`relative flex flex-col items-center justify-center h-full text-[11px] whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'users'
                ? 'text-slate-950 font-bold'
                : 'text-slate-600 font-semibold hover:text-slate-900'
            }`}
          >
            {activeTab === 'users' && (
              <motion.span
                layoutId="mobile-nav-indicator"
                className="absolute top-0 inset-x-3 h-0.5 bg-emerald-600 rounded-b-full"
              />
            )}
            <Users className="w-4 h-4 shrink-0" />
            <span className="mt-1">Users</span>
          </button>
        )}
      </nav>
    </div>
  );
}
