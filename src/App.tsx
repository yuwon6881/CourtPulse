/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
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
  handleFirestoreError,
  OperationType,
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
  ClubLocalRules,
  computePlayerLeaderboardAndTiers,
  computeWeightedSessionSplits,
  evaluateTapOutWindow,
  formatClubPaymentInfo,
  getMatchSidePlayers,
  getPlayerJoinedClubIds,
  getRsvpPartySize,
  getSessionGoingHeadcount,
  hasPlayerJoinedClub,
  isClubPrivate,
  isSessionCompletedOrPast,
  INITIAL_CLUBS,
  INITIAL_MATCHES,
  INITIAL_PLAYERS,
  INITIAL_RSVPS,
  INITIAL_SESSIONS,
  LEGACY_SEEDED_DOC_IDS,
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
  recalculatePlayerStatsFromMatches,
  removeClubFromCsv,
  restoreSessionRsvpsAndWalletsForReopen,
  saveClubBillingRule,
  saveClubJoinRequests,
  saveClubPaymentDetails,
  savePlayerWalletsMap,
  saveRsvpGuestsMap,
  settlePlayerExistingUnpaidRsvpsWithWallet,
  settleRsvpAdjustment,
  TapRsvpResult,
  computeSessionInstants,
  validateBadmintonMatchScores,
} from './utils/badmintonLogic';
import { ActionResult, friendlyWriteError } from './utils/walletLedger';
import {
  clearAllCourtPulseLocalData,
  DEV_SESSION_STORAGE_KEY,
  purgeDevLeftoversOutsideDev,
} from './utils/localData';
import { checkAndConsumeRateLimit } from './utils/rateLimiter';
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
const IS_DEV_MODE = Boolean(import.meta.env.DEV);
purgeDevLeftoversOutsideDev(IS_DEV_MODE);

function loadDevSession(): DevLoginPersona | null {
  if (!IS_DEV_MODE) return null;
  try {
    const raw = localStorage.getItem(DEV_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DevLoginPersona;
    if (
      parsed &&
      typeof parsed.id === 'string' &&
      typeof parsed.playerId === 'string' &&
      typeof parsed.name === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
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
  ownerId: 'system',
  ownerPlayerId: '',
  clubOwnerPlayerId: '',
  clubOwnerName: 'Unassigned',
};

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

function loadLocalClubState(): LocalClubSnapshot {
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
    if (!raw) {
      return {
        clubs: INITIAL_CLUBS,
        sessions: INITIAL_SESSIONS,
        players: INITIAL_PLAYERS,
        rsvps: INITIAL_RSVPS,
        matches: INITIAL_MATCHES,
      };
    }
    const parsed = JSON.parse(raw) as Partial<LocalClubSnapshot>;
    return {
      clubs:
        Array.isArray(parsed.clubs) && parsed.clubs.length > 0
          ? parsed.clubs
          : INITIAL_CLUBS,
      sessions:
        Array.isArray(parsed.sessions) && parsed.sessions.length > 0
          ? parsed.sessions
          : INITIAL_SESSIONS,
      players:
        Array.isArray(parsed.players) && parsed.players.length > 0
          ? parsed.players
          : INITIAL_PLAYERS,
      rsvps: Array.isArray(parsed.rsvps) ? parsed.rsvps : INITIAL_RSVPS,
      matches: Array.isArray(parsed.matches) ? parsed.matches : INITIAL_MATCHES,
    };
  } catch {
    return {
      clubs: INITIAL_CLUBS,
      sessions: INITIAL_SESSIONS,
      players: INITIAL_PLAYERS,
      rsvps: INITIAL_RSVPS,
      matches: INITIAL_MATCHES,
    };
  }
}

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
  const [myProfileClaim, setMyProfileClaim] = useState<{
    playerId: string;
  } | null>(null);
  const [profileClaims, setProfileClaims] = useState<
    { uid: string; playerId: string; email: string; displayName: string }[]
  >([]);

  // Defaults to the highest mode; effectiveTier degrades it to what the account is entitled to
  const [permissionTier, setPermissionTier] = useState<PermissionTier>('admin');

  const [rateLimitNotice, setRateLimitNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('sessions');
  const [inspectedPlayerId, setInspectedPlayerId] = useState<string | null>(
    null
  );
  const [activeClubId, setActiveClubId] = useState<string>('all');

  // Recompute canonical player stats from matches so all views share a single source of truth
  const players = useMemo<Player[]>(
    () => recalculatePlayerStatsFromMatches(rawPlayers, matches, sessions),
    [rawPlayers, matches, sessions]
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    initialLocal.sessions[0]?.id || ''
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
  const purgedLegacyIdsRef = useRef<Set<string>>(new Set());

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
      };
    });
  }, [
    rawClubs,
    clubPaymentMap,
    clubBillingRulesMap,
    players,
  ]);

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
    const params = new URLSearchParams(window.location.search);
    const sharedClubId = params.get('club');
    const sharedSessionId = params.get('session');

    if (sharedClubId) {
      setPendingInviteClubId(sharedClubId);
      setActiveClubId(sharedClubId);
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
      setSelectedSessionId(sharedSessionId);
      setActiveTab('rsvp');
      setAuthGateRequestedFromPreview(false);
    }
  }, []);

  useEffect(() => {
    if (!IS_DEV_MODE || user) return;
    try {
      const payload: LocalClubSnapshot = {
        clubs: rawClubs,
        sessions,
        players: rawPlayers,
        rsvps: rawRsvps,
        matches,
      };
      localStorage.setItem(LOCAL_STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage quota errors
    }
  }, [rawClubs, sessions, rawPlayers, rawRsvps, matches, user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      setPlayersLoaded(false);
      if (currentUser) {
        saveDevSession(null);
        setDevSession(null);
        setPermissionTier(loadViewMode(currentUser.uid) || 'admin');
      } else {
        const storedDev = loadDevSession();
        setPermissionTier(storedDev?.tier || 'admin');
        const fallback = loadLocalClubState();
        const params = new URLSearchParams(window.location.search);
        const { hydratedSession } = parseSharedSessionFromUrlParams(params);
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
        setPlayerWalletsMap(IS_DEV_MODE ? loadPlayerWalletsMap() : {});
        setClubJoinRequests(IS_DEV_MODE ? loadClubJoinRequests() : []);
        setMyProfileClaim(null);
        setProfileClaims([]);
        setIsAdminDoc(false);
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
      () => setMyProfileClaim(null)
    );
  }, [user, isUserVerified, authVersion]);

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
      () => setProfileClaims([])
    );
  }, [isAdminForClaims, authVersion]);

  // Club join requests live in Firestore when signed in (so club owners on any device see them),
  // and fall back to this browser's storage in local mode.
  useEffect(() => {
    if (!authReady) return;
    if (!user || !isUserVerified) {
      setClubJoinRequests(loadClubJoinRequests());
      return;
    }
    const requestsQuery = query(
      collection(db, 'clubJoinRequests'),
      limit(500)
    );
    return onSnapshot(
      requestsQuery,
      (snap) => {
        setClubJoinRequests(
          snap.docs.map((d) => {
            const raw = d.data() as Record<string, unknown>;
            const createdAt = raw.createdAt as
              | { toDate?: () => Date }
              | null
              | undefined;
            return {
              id: d.id,
              clubId: String(raw.clubId || ''),
              playerId: String(raw.playerId || ''),
              playerName: String(raw.playerName || 'Player'),
              playerTag: String(raw.playerTag || ''),
              requestedAt:
                createdAt && typeof createdAt.toDate === 'function'
                  ? createdAt.toDate().toISOString()
                  : new Date().toISOString(),
            };
          })
        );
      },
      (err) =>
        handleFirestoreError(err, OperationType.LIST, 'clubJoinRequests')
    );
  }, [authReady, user, isUserVerified, authVersion]);

  useEffect(() => {
    if (!authReady || !user || !isUserVerified) return;

    const uid = user.uid;
    try {
      localStorage.removeItem(PLAYER_WALLETS_STORAGE_KEY);
    } catch {
      // ignore
    }
    const canPurgeLegacySeed = isBootstrapAdminEmail(user.email) || isAdminDoc;
    const purgeLegacyDocIfNeeded = (collectionName: string, docId: string) => {
      if (!canPurgeLegacySeed) return;
      const key = `${collectionName}/${docId}`;
      if (purgedLegacyIdsRef.current.has(key)) return;
      purgedLegacyIdsRef.current.add(key);
      void safeDeleteDoc(collectionName, docId).catch(() => {
        purgedLegacyIdsRef.current.delete(key);
      });
    };

    const clubsQuery = query(collection(db, 'clubs'), limit(100));
    const sessionsQuery = query(
      collection(db, 'sessions'),
      orderBy('sessionDate', 'desc'),
      limit(200)
    );
    const playersQuery = query(collection(db, 'players'), limit(500));
    const ownPlayerQuery = query(
      collection(db, 'players'),
      where('authUid', '==', uid),
      limit(1)
    );
    const rsvpsQuery = query(
      collection(db, 'rsvps'),
      orderBy('createdAt', 'desc'),
      limit(2000)
    );
    const matchesQuery = query(
      collection(db, 'matches'),
      orderBy('createdAt', 'desc'),
      limit(600)
    );

    const parsePlayerDoc = (
      id: string,
      raw: Record<string, unknown>
    ): Player => {
      const num = (v: unknown, fallback = 0) =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      const cleanClubsCsv =
        typeof raw.joinedClubIdsCsv === 'string'
          ? raw.joinedClubIdsCsv
              .split(',')
              .map((s) => s.trim())
              .filter((cid) => cid && !LEGACY_SEEDED_DOC_IDS.has(cid))
              .join(',')
          : '';
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
        joinedClubIdsCsv: cleanClubsCsv,
        id,
      };
    };

    let listPlayersSnapshot: Player[] = [];
    let ownAuthPlayerSnapshot: Player | null = null;
    let listLoaded = false;
    let ownLoaded = false;

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

    const unsubClubs = onSnapshot(
      clubsQuery,
      (snap) => {
        const realClubDocs = snap.docs.filter((d) => {
          if (LEGACY_SEEDED_DOC_IDS.has(d.id)) {
            purgeLegacyDocIfNeeded('clubs', d.id);
            return false;
          }
          return true;
        });
        setRawClubs(
          realClubDocs.map((d) => ({
            ...(d.data() as Omit<Club, 'id'>),
            id: d.id,
          }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'clubs')
    );

    const unsubSessions = onSnapshot(
      sessionsQuery,
      (snap) => {
        const realSessionDocs = snap.docs.filter((d) => {
          if (LEGACY_SEEDED_DOC_IDS.has(d.id)) {
            purgeLegacyDocIfNeeded('sessions', d.id);
            return false;
          }
          return true;
        });
        const docs: Session[] = realSessionDocs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            ...(raw as unknown as Omit<Session, 'id'>),
            clubId: typeof raw.clubId === 'string' ? raw.clubId : '',
            shuttlesUsed:
              typeof raw.shuttlesUsed === 'number' ? raw.shuttlesUsed : 0,
            shuttleUnitCost:
              typeof raw.shuttleUnitCost === 'number'
                ? raw.shuttleUnitCost
                : 3.0,
            id: d.id,
          };
        });
        setSessions(docs);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'sessions')
    );

    const unsubPlayers = onSnapshot(
      playersQuery,
      (snap) => {
        const realPlayerDocs = snap.docs.filter((d) => {
          const raw = d.data() as Record<string, unknown>;
          const hasAuthUid =
            typeof raw.authUid === 'string' && raw.authUid.trim().length > 0;
          if (LEGACY_SEEDED_DOC_IDS.has(d.id) && !hasAuthUid) {
            purgeLegacyDocIfNeeded('players', d.id);
            return false;
          }
          return true;
        });
        listPlayersSnapshot = realPlayerDocs.map((d) =>
          parsePlayerDoc(d.id, d.data() as Record<string, unknown>)
        );
        listLoaded = true;
        commitMergedPlayers();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'players')
    );

    const unsubOwnPlayer = onSnapshot(
      ownPlayerQuery,
      (snap) => {
        const first = snap.docs[0];
        ownAuthPlayerSnapshot = first
          ? parsePlayerDoc(first.id, first.data() as Record<string, unknown>)
          : null;
        ownLoaded = true;
        commitMergedPlayers();
      },
      () => {
        ownLoaded = true;
        commitMergedPlayers();
      }
    );

    const unsubRsvps = onSnapshot(
      rsvpsQuery,
      (snap) => {
        const realRsvpDocs = snap.docs.filter((d) => {
          if (LEGACY_SEEDED_DOC_IDS.has(d.id)) {
            purgeLegacyDocIfNeeded('rsvps', d.id);
            return false;
          }
          return true;
        });
        const docs: SessionRsvp[] = realRsvpDocs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            ...(raw as unknown as Omit<SessionRsvp, 'id'>),
            clubId: typeof raw.clubId === 'string' ? raw.clubId : '',
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
              typeof raw.grossFeeShare === 'number'
                ? raw.grossFeeShare
                : undefined,
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
            id: d.id,
          };
        });
        setRsvps(docs);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'rsvps')
    );

    const unsubMatches = onSnapshot(
      matchesQuery,
      (snap) => {
        const realMatchDocs = snap.docs.filter((d) => {
          if (LEGACY_SEEDED_DOC_IDS.has(d.id)) {
            purgeLegacyDocIfNeeded('matches', d.id);
            return false;
          }
          return true;
        });
        const docs: BadmintonMatch[] = realMatchDocs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
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
              : typeof createdAtRaw === 'string' ||
                typeof createdAtRaw === 'number'
              ? createdAtRaw
              : undefined;
          return {
            ...(raw as unknown as Omit<BadmintonMatch, 'id'>),
            clubId: typeof raw.clubId === 'string' ? raw.clubId : '',
            ...(resolvedCreatedAt !== undefined
              ? { createdAt: resolvedCreatedAt }
              : {}),
            id: d.id,
          };
        });
        setMatches(docs);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'matches')
    );

    return () => {
      unsubClubs();
      unsubSessions();
      unsubPlayers();
      unsubOwnPlayer();
      unsubRsvps();
      unsubMatches();
    };
  }, [authReady, user, isUserVerified, authVersion, isAdminDoc]);

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

  // The signed-in player is the profile linked to this Firebase account (or active Dev persona in local preview).
  const activePlayer = useMemo(() => {
    if (user && isUserVerified && playersLoaded) {
      return players.find((p) => p.authUid === user.uid) || null;
    }
    if (!user && IS_DEV_MODE && devSession) {
      return (
        players.find((p) => p.id === devSession.playerId) || players[0] || null
      );
    }
    return null;
  }, [players, user, isUserVerified, playersLoaded, devSession]);

  // Mirrors isAdmin() in firestore.rules: a verified bootstrap admin email or /admins/{uid} doc (or dev admin persona)
  const isAdminAccount = Boolean(
    (user &&
      isUserVerified &&
      (isBootstrapAdminEmail(user.email) || isAdminDoc)) ||
      (!user && IS_DEV_MODE && devSession?.tier === 'admin')
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
    return clubs.filter(
      (c) =>
        !joinedIds.includes(c.id) &&
        (!activePlayer || c.clubOwnerPlayerId !== activePlayer.id)
    );
  }, [clubs, activePlayer]);

  const myOwnedClub = useMemo(() => {
    if (!activePlayer) return null;
    return (
      clubs.find((c) => c.clubOwnerPlayerId === activePlayer.id) || null
    );
  }, [clubs, activePlayer]);

  // Scoped clubWallets listener:
  // - Site Admins read all clubWallets
  // - Players read their own wallets (where playerId == activePlayer.id)
  // - Club Owners read all wallets in their owned club (where clubId == myOwnedClub.id)
  useEffect(() => {
    if (!authReady || !user || !isUserVerified) return;
    if (!isAdminAccount && !activePlayer) return;

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
        (err) => handleFirestoreError(err, OperationType.LIST, 'clubWallets')
      );
    }

    const selfIds = new Set<string>();
    const clubIds = new Set<string>();
    const selfMap: Record<string, PlayerBenefitWallet> = {};
    const clubMap: Record<string, PlayerBenefitWallet> = {};

    const syncCombinedWallets = () => {
      cloudWalletDocIdsRef.current = new Set([
        ...Array.from(selfIds),
        ...Array.from(clubIds),
      ]);
      setPlayerWalletsMap({
        ...selfMap,
        ...clubMap,
      });
    };

    const unsubs: (() => void)[] = [];

    if (activePlayer) {
      const selfWalletsQuery = query(
        collection(db, 'clubWallets'),
        where('playerId', '==', activePlayer.id),
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
          (err) => handleFirestoreError(err, OperationType.LIST, 'clubWallets')
        )
      );
    }

    if (myOwnedClub) {
      const ownedClubWalletsQuery = query(
        collection(db, 'clubWallets'),
        where('clubId', '==', myOwnedClub.id),
        limit(500)
      );
      unsubs.push(
        onSnapshot(
          ownedClubWalletsQuery,
          (snap) => {
            clubIds.clear();
            Object.keys(clubMap).forEach((k) => delete clubMap[k]);
            snap.docs.forEach((d) => {
              clubIds.add(d.id);
              const parsed = parseWalletDoc(d.data() as Record<string, unknown>);
              if (parsed) clubMap[parsed.key] = parsed.wallet;
            });
            syncCombinedWallets();
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'clubWallets')
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
    isAdminAccount,
    activePlayer?.id,
    myOwnedClub?.id,
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
  const sessionTabClubs = memberClubs;
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
    () => computePlayerLeaderboardAndTiers(clubPlayers, clubMatches),
    [clubPlayers, clubMatches]
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

  useEffect(() => {
    if (!activePlayer || !pendingInviteClubId) return;
    const targetClub = clubs.find((c) => c.id === pendingInviteClubId);
    if (!targetClub) return;

    const alreadyJoined = hasPlayerJoinedClub(activePlayer, targetClub.id);

    if (pendingInviteSessionId && !alreadyJoined && isClubPrivate(targetClub)) {
      // Private club: a session link cannot bypass owner approval — prompt a join request instead
      setClubJoinModalClubId(targetClub.id);
      setPendingInviteClubId(null);
      setPendingInviteSessionId(null);
      return;
    }

    if (pendingInviteSessionId) {
      // Direct session invite link: ensure club & session are selected and go straight to the RSVP Join page
      if (!alreadyJoined) {
        void addPlayerToClub(activePlayer, targetClub.id);
      }
      setActiveClubId(targetClub.id);
      setSelectedSessionId(pendingInviteSessionId);
      setActiveTab('rsvp');
      setPendingInviteClubId(null);
      setPendingInviteSessionId(null);
      return;
    }

    if (!alreadyJoined) {
      setClubJoinModalClubId(targetClub.id);
    } else {
      setActiveClubId(targetClub.id);
    }
    setPendingInviteClubId(null);
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
    // Auto-join the invited club only when it is public; a private one prompts a join request.
    const inviteClub = pendingInviteClubId
      ? clubs.find((c) => c.id === pendingInviteClubId) || null
      : null;
    const autoJoinClub =
      inviteClub && !isClubPrivate(inviteClub) ? inviteClub : null;

    const newPlayer: Player = {
      id: sanitizeId(`player_${user.uid}`),
      name: cleanName,
      playerTag: clampString(`${shortPrefix}#${randomPin}`, 40),
      joinedClubIdsCsv: autoJoinClub ? autoJoinClub.id : '',
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
    setPlayers((prev) =>
      prev.some((p) => p.id === newPlayer.id) ? prev : [...prev, newPlayer]
    );
    const { id, ...payload } = newPlayer;
    await safeSetDoc('players', id, payload);
    if (inviteClub && !autoJoinClub) {
      setClubJoinModalClubId(inviteClub.id);
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
      await safeUpdateDoc('players', playerId, { authUid: user.uid });
      return;
    }
    setMyProfileClaim({ playerId });
    await safeSetDoc('profileClaims', user.uid, {
      playerId: sanitizeId(playerId),
      email: user.email,
      displayName: clampString(user.displayName || '', 80, ''),
    });
  };

  const handleCancelProfileClaim = async () => {
    if (!user) return;
    setMyProfileClaim(null);
    await safeDeleteDoc('profileClaims', user.uid);
  };

  const handleApproveProfileClaim = async (claimUid: string) => {
    if (!isAdminAccount) return;
    const claim = profileClaims.find((c) => c.uid === claimUid);
    if (!claim) return;
    const target = players.find((p) => p.id === claim.playerId);
    // Never link an account twice, or a profile that already belongs to someone
    const alreadyLinked = players.some((p) => p.authUid === claimUid);
    if (!target || target.authUid || alreadyLinked) {
      await safeDeleteDoc('profileClaims', claimUid);
      return;
    }
    setPlayers((prev) =>
      prev.map((p) => (p.id === target.id ? { ...p, authUid: claimUid } : p))
    );
    await safeBatchWrite([
      {
        type: 'update',
        collectionName: 'players',
        docId: target.id,
        updates: { authUid: claimUid },
      },
      { type: 'delete', collectionName: 'profileClaims', docId: claimUid },
    ]);
  };

  const handleRejectProfileClaim = async (claimUid: string) => {
    if (!isAdminAccount) return;
    setProfileClaims((prev) => prev.filter((c) => c.uid !== claimUid));
    await safeDeleteDoc('profileClaims', claimUid);
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
      await safeUpdateDoc('players', player.id, {
        joinedClubIdsCsv: nextCsv,
        actingClubId: clubId,
      });
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

    const openSessionIds = new Set(
      sessions
        .filter((s) => s.clubId === clubId && s.bookingStatus !== 'completed')
        .map((s) => s.id)
    );
    const removableOpenRsvps = rsvps.filter(
      (r) =>
        r.playerId === player.id &&
        r.clubId === clubId &&
        openSessionIds.has(r.sessionId) &&
        r.status !== 'late_out' &&
        r.feeShare === 0 &&
        r.paidStatus === 'unpaid'
    );
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
    }
  };

  const handleLeaveClub = async (clubId: string) => {
    if (!activePlayer) return;
    const targetClub = clubs.find((c) => c.id === clubId);
    if (!targetClub || targetClub.clubOwnerPlayerId === activePlayer.id) return;
    // Block leaving if the member has unsettled session debt in this club
    const hasUnsettledDebtInClub = activePlayerDebts.some(
      (d) => d.rsvp.clubId === clubId && d.rsvp.feeShare > 0
    );
    if (hasUnsettledDebtInClub) return;
    await removePlayerFromClub(activePlayer, clubId);
  };

  const handleRemoveMemberFromClub = async (
    playerId: string,
    clubId: string
  ) => {
    if (!canManageClubById(clubId)) return;
    const targetPlayer = players.find((p) => p.id === playerId);
    if (!targetPlayer) return;
    await removePlayerFromClub(targetPlayer, clubId);
  };

  const handleAcceptJoinClub = async (clubId: string) => {
    if (!activePlayer) return;
    setActiveClubId(clubId);
    setClubJoinModalClubId(null);
    void removeClubJoinRequests(
      (r) => r.clubId === clubId && r.playerId === activePlayer.id
    );
    await addPlayerToClub(activePlayer, clubId);
  };

  const addClubJoinRequest = async (request: ClubJoinRequest) => {
    setClubJoinRequests((prev) => {
      if (prev.some((r) => r.id === request.id)) return prev;
      const next = [...prev, request];
      if (!user) saveClubJoinRequests(next);
      return next;
    });
    if (user) {
      await safeSetDoc('clubJoinRequests', request.id, {
        clubId: request.clubId,
        playerId: request.playerId,
        playerName: clampString(request.playerName, 80, 'Player'),
        playerTag: clampString(request.playerTag, 40, 'player'),
        ownerId: user.uid,
      });
    }
  };

  const removeClubJoinRequests = async (
    shouldRemove: (r: ClubJoinRequest) => boolean
  ) => {
    const removedIds = clubJoinRequests.filter(shouldRemove).map((r) => r.id);
    if (removedIds.length === 0) return;
    setClubJoinRequests((prev) => {
      const next = prev.filter((r) => !removedIds.includes(r.id));
      if (!user) saveClubJoinRequests(next);
      return next;
    });
    if (user) {
      await safeBatchWrite(
        removedIds.map(
          (id): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'clubJoinRequests',
            docId: id,
          })
        )
      );
    }
  };

  // Public clubs: join instantly. Private clubs: file a join request for the owner to approve.
  const handleJoinOrRequestClub = async (clubId: string) => {
    if (!activePlayer) return;
    const targetClub = clubs.find((c) => c.id === clubId);
    if (!targetClub || hasPlayerJoinedClub(activePlayer, clubId)) {
      setClubJoinModalClubId(null);
      return;
    }
    if (!isClubPrivate(targetClub)) {
      await handleAcceptJoinClub(clubId);
      return;
    }
    if (!enforceRateLimit('club_join_request')) return;
    setClubJoinModalClubId(null);
    // Deterministic id (one request per player per club) — mirrored by the Firestore rules
    await addClubJoinRequest({
      id: sanitizeId(`joinreq_${clubId}_${activePlayer.id}`),
      clubId,
      playerId: activePlayer.id,
      playerName: activePlayer.name,
      playerTag: activePlayer.playerTag,
      requestedAt: new Date().toISOString(),
    });
  };

  const handleCancelClubJoinRequest = (clubId: string) => {
    if (!activePlayer) return;
    void removeClubJoinRequests(
      (r) => r.clubId === clubId && r.playerId === activePlayer.id
    );
  };

  const handleApproveClubJoinRequest = async (requestId: string) => {
    const request = clubJoinRequests.find((r) => r.id === requestId);
    if (!request || !canManageClubById(request.clubId)) return;
    void removeClubJoinRequests((r) => r.id === requestId);
    const requester = players.find((p) => p.id === request.playerId);
    if (!requester || hasPlayerJoinedClub(requester, request.clubId)) return;
    await addPlayerToClub(requester, request.clubId);
  };

  const handleRejectClubJoinRequest = (requestId: string) => {
    const request = clubJoinRequests.find((r) => r.id === requestId);
    if (!request || !canManageClubById(request.clubId)) return;
    void removeClubJoinRequests((r) => r.id === requestId);
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

  const handleAdminAddMemberToClub = async (
    name: string,
    targetClubId?: string
  ) => {
    const targetClub = targetClubId
      ? clubs.find((c) => c.id === targetClubId)
      : activeClub;
    if (!targetClub || !canManageClubById(targetClub.id)) return;
    const cleanName = clampString(name, 80, 'Member');
    const existing = players.find(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (existing) {
      await addPlayerToClub(existing, targetClub.id);
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
      await safeSetDoc('players', id, payload);
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
      ratingScore?: number;
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
    const cleanRating = clampNumber(
      updates.ratingScore ?? target.ratingScore,
      800,
      3000
    );

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
              ratingScore: cleanRating,
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
            ratingScore: cleanRating,
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
    const playerRsvps = rsvps.filter((r) => r.playerId === playerId);
    const playerWalletDocIds = clubs
      .map((c) => makeCloudWalletDocId(c.id, playerId))
      .filter((docId) => cloudWalletDocIdsRef.current.has(docId));
    playerWalletDocIds.forEach((docId) =>
      cloudWalletDocIdsRef.current.delete(docId)
    );

    setPlayers((prev) => prev.filter((p) => p.id !== playerId));
    setRsvps((prev) => prev.filter((r) => r.playerId !== playerId));
    void removeClubJoinRequests((r) => r.playerId === playerId);
    if (user) {
      await safeBatchWrite([
        { type: 'delete', collectionName: 'players', docId: playerId },
        ...playerRsvps.map(
          (r): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'rsvps',
            docId: r.id,
          })
        ),
        ...playerWalletDocIds.map(
          (docId): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'clubWallets',
            docId,
          })
        ),
      ]);
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

  const handleSignOutAccount = async () => {
    setAccountMenuOpen(false);
    setPaymentModalOpen(false);
    setInspectedPlayerId(null);
    setClubJoinModalClubId(null);
    saveDevSession(null);
    setDevSession(null);
    if (!IS_DEV_MODE) {
      clearAllCourtPulseLocalData();
    }
    if (user) {
      await signOutUser();
    }
    const fallback = loadLocalClubState();
    const params = new URLSearchParams(window.location.search);
    const sharedClubId = params.get('club');
    const sharedSessionId = params.get('session');
    const { hydratedSession } = parseSharedSessionFromUrlParams(params);
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
    setPlayerWalletsMap(IS_DEV_MODE ? loadPlayerWalletsMap() : {});
    setClubJoinRequests(IS_DEV_MODE ? loadClubJoinRequests() : []);
    setMyProfileClaim(null);
    setProfileClaims([]);
    setIsAdminDoc(false);
    setPlayersLoaded(false);

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
    }
  ) => {
    if (!canManageClubById(clubId)) return;
    if (!enforceRateLimit('update_club')) return;

    const cleanUpdates = {
      name: clampString(updates.name, 100, 'Badminton Club'),
      description: clampString(updates.description, 200, 'Club sessions'),
      paymentInfo: clampString(updates.paymentInfo, 160, 'PayNow'),
      freeCancelHours: clampNumber(updates.freeCancelHours, 0, 720),
      lockCancelHours: clampNumber(updates.lockCancelHours, 0, 720),
      lateCancelFeePercent: clampNumber(updates.lateCancelFeePercent, 0, 100),
      noShowFeePercent: clampNumber(updates.noShowFeePercent, 0, 100),
    };

    const existingClub = clubs.find((c) => c.id === clubId);
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
      await safeUpdateDoc('clubs', clubId, {
        ...cleanUpdates,
        excludeOwnerFromBilling: nextExcludeOwner,
        defaultMatchTargetPoints: nextTargetPoints,
        currency: nextCurrency,
        ...(nextPaymentDetailsJson !== undefined
          ? { paymentDetailsJson: nextPaymentDetailsJson }
          : {}),
      });
    }
  };

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
  }): Promise<Club | null> => {
    if (effectiveTier !== 'admin') return null;
    const assignedPlayerId =
      effectiveTier === 'admin' && clubData.ownerPlayerId
        ? clubData.ownerPlayerId
        : activePlayer?.id || '';

    // Enforce: 1 club per owner — a person can only own 1 club
    const alreadyOwns = Boolean(
      assignedPlayerId &&
        clubs.some((c) => c.clubOwnerPlayerId === assignedPlayerId)
    );
    if (alreadyOwns) {
      return null;
    }

    const newClubId = sanitizeId(`club_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const assignedPlayer = players.find((p) => p.id === assignedPlayerId);
    const assignedPlayerName =
      assignedPlayer?.name || activePlayer?.name || 'Unassigned';
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
    const sessionClub =
      clubs.find((c) => c.id === targetClubId) || activeClub;
    const cleanDate = clampString(sessionData.sessionDate, 40, '2026-10-22');
    const cleanStart = clampString(sessionData.startTime, 20, '20:00');
    const cleanEnd = clampString(sessionData.endTime, 20, '22:00');
    const instants = computeSessionInstants(
      { sessionDate: cleanDate, startTime: cleanStart },
      sessionClub
    );
    const newSession: Session = {
      id: newId,
      clubId: targetClubId,
      title: clampString(sessionData.title, 120, 'Badminton Session'),
      venue: clampString(sessionData.venue, 120, 'Badminton Hall'),
      courtNumbers: clampString(sessionData.courtNumbers, 60, 'Court 1'),
      sessionDate: cleanDate,
      startTime: cleanStart,
      endTime: cleanEnd,
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
      ...(instants
        ? {
            startsAt: instants.startsAtMs,
            lateCancelUntil: instants.lateCancelUntilMs,
            freeCancelUntil: instants.freeCancelUntilMs,
          }
        : {}),
    };

    setSessions((prev) => [newSession, ...prev]);
    setSelectedSessionId(newId);

    if (user) {
      const { id, startsAt: _s, lateCancelUntil: _l, freeCancelUntil: _f, ...payload } = newSession;
      await safeSetDoc('sessions', id, {
        ...payload,
        ...(instants
          ? {
              startsAt: new Date(instants.startsAtMs),
              lateCancelUntil: new Date(instants.lateCancelUntilMs),
              freeCancelUntil:
                instants.freeCancelUntilMs !== null
                  ? new Date(instants.freeCancelUntilMs)
                  : null,
            }
          : {}),
      });
    }
    return newSession;
  };

  const handleCloneNextWeekSession = async (source: Session) => {
    if (!canManageClubById(source.clubId)) return;
    const baseDate = new Date(`${source.sessionDate}T12:00:00`);
    const nextDate = Number.isNaN(baseDate.getTime())
      ? '2026-10-29'
      : new Date(baseDate.getTime() + 7 * 86400000).toISOString().slice(0, 10);

    await handleCreateSession({
      clubId: source.clubId,
      title: source.title,
      venue: source.venue,
      courtNumbers: source.courtNumbers,
      sessionDate: nextDate,
      startTime: source.startTime,
      endTime: source.endTime,
      bookingStatus: 'booked',
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
    expectedPolicy?: { status: RsvpStatus; penaltyPercent: number }
  ): Promise<TapRsvpResult> => {
    if (!enforceRateLimit('tap_rsvp')) {
      return { ok: false, reason: 'Too many requests. Please wait a moment.' };
    }

    const session = sessions.find((s) => s.id === sessionId);
    if (!session || session.bookingStatus === 'completed') {
      return { ok: false, reason: 'This session is no longer accepting RSVP updates.' };
    }
    // Players may only RSVP themselves, in clubs they belong to; club managers may RSVP anyone.
    const isSelfRsvp = Boolean(activePlayer && player.id === activePlayer.id);
    if (
      !canManageClubById(session.clubId) &&
      !(isSelfRsvp && hasPlayerJoinedClub(activePlayer, session.clubId))
    ) {
      return { ok: false, reason: 'You must join this club before updating an RSVP.' };
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
      return { ok: false, reason: 'RSVPs are locked for this session.' };
    }

    // Players leaving a session follow the club's tap-out policy: no tap-out once
    // the lock cutoff has passed or session has started, and the late fee inside the late window.
    if (!isManager && status !== 'going') {
      if (!sessionClub) {
        return { ok: false, reason: 'Club policy unavailable.' };
      }
      const policy = evaluateTapOutWindow(session, sessionClub);
      if (!policy.canTapOut) {
        return { ok: false, reason: policy.policySummary };
      }
      const resolvedStatus: RsvpStatus = policy.isPenaltyWindow
        ? 'late_out'
        : 'out';
      const resolvedPenalty = policy.isPenaltyWindow
        ? policy.penaltyPercent
        : 0;
      if (
        expectedPolicy &&
        (expectedPolicy.status !== resolvedStatus ||
          expectedPolicy.penaltyPercent !== resolvedPenalty)
      ) {
        return {
          ok: false,
          code: 'policy_changed',
          reason:
            'The cancellation window changed while you were confirming. Please review the updated policy and try again.',
        };
      }
      status = resolvedStatus;
      penaltyPercent = resolvedPenalty;
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

    // P1-5: Enforce session.maxPlayers across all open sessions whenever adding spots
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
        return {
          ok: false,
          reason: `This session is full (${session.maxPlayers} players max).`,
        };
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
        const serverSnap = await getDoc(doc(db, 'rsvps', rsvpId));
        if (serverSnap.exists()) {
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
    }
    return { ok: true };
  };

  const handleMarkAttendanceOutcome = async (
    rsvpId: string,
    outcome: AttendanceOutcome
  ): Promise<ActionResult> => {
    const currentRsvps = rsvpsRef.current;
    const targetRsvp = currentRsvps.find((r) => r.id === rsvpId);
    if (!targetRsvp) {
      return { ok: false, reason: 'RSVP not found.' };
    }
    if (!canManageClubById(targetRsvp.clubId)) {
      return { ok: false, reason: 'Permission denied.' };
    }

    const session = sessions.find((s) => s.id === targetRsvp.sessionId);
    const club =
      clubs.find((c) => c.id === targetRsvp.clubId) || activeClub;
    const nextPenaltyPct =
      outcome === 'no_show' ? club.noShowFeePercent : 100;

    if (
      session &&
      session.bookingStatus === 'completed' &&
      session.feeSplitFinalized
    ) {
      // P1-1 & P1-3: Restore prior wallet ledger on this session first, update attendance,
      // recompute largest-remainder splits, and re-apply wallets idempotently.
      const rawSessionRsvps = currentRsvps.filter(
        (r) => r.sessionId === session.id
      );
      const preReopen = restoreSessionRsvpsAndWalletsForReopen({
        sessionRsvps: rawSessionRsvps,
        walletsMap: playerWalletsMap,
      });
      const updatedSessionInput = preReopen.restoredSessionRsvps.map((r) =>
        r.id === rsvpId
          ? {
              ...r,
              attendanceOutcome: outcome,
              penaltyPercentApplied: nextPenaltyPct,
            }
          : r
      );
      const computedSplits = computeWeightedSessionSplits(
        session.courtFee,
        session.shuttleFee,
        updatedSessionInput,
        club.noShowFeePercent,
        {
          clubOwnerPlayerId: club.clubOwnerPlayerId,
          excludeOwnerFromBilling: Boolean(club.excludeOwnerFromBilling),
        }
      );
      const walletSettlement = applyWalletsToFinalizedSessionRsvps({
        sessionRsvps: updatedSessionInput,
        splits: computedSplits,
        walletsMap: preReopen.restoredWalletsMap,
        finalizeSplit: true,
        clubOwnerPlayerId: club.clubOwnerPlayerId,
        excludeOwnerFromBilling: Boolean(club.excludeOwnerFromBilling),
      });

      const settledById = new Map(
        walletSettlement.updatedSessionRsvps.map((r) => [r.id, r])
      );
      const finalRsvps = currentRsvps.map((r) =>
        r.sessionId === session.id ? settledById.get(r.id) || r : r
      );

      const changedWalletKeysSet = new Set<string>(preReopen.changedWalletKeys);
      Object.keys(walletSettlement.updatedWalletsMap).forEach((wKey) => {
        const prevW = playerWalletsMap[wKey];
        const nextW = walletSettlement.updatedWalletsMap[wKey];
        if (
          !prevW ||
          prevW.creditBalance !== nextW.creditBalance ||
          prevW.freeSessionPasses !== nextW.freeSessionPasses ||
          prevW.waiveAllFees !== nextW.waiveAllFees
        ) {
          changedWalletKeysSet.add(wKey);
        }
      });

      if (!user) {
        savePlayerWalletsMap(walletSettlement.updatedWalletsMap);
      }
      setPlayerWalletsMap(walletSettlement.updatedWalletsMap);
      rsvpsRef.current = finalRsvps;
      setRsvps(finalRsvps);

      if (user && walletSettlement.updatedSessionRsvps.length > 0) {
        await runTransaction(db, async (tx) => {
          const walletSnaps = new Map<string, boolean>();
          for (const wKey of Array.from(changedWalletKeysSet)) {
            const [wClubId, wPlayerId] = wKey.split('::');
            const docId = makeCloudWalletDocId(
              wClubId || session.clubId,
              wPlayerId
            );
            const snap = await tx.get(doc(db, 'clubWallets', docId));
            walletSnaps.set(docId, snap.exists());
          }
          for (const rsvp of walletSettlement.updatedSessionRsvps) {
            tx.update(doc(db, 'rsvps', rsvp.id), {
              status: rsvp.status,
              attendanceOutcome: rsvp.attendanceOutcome,
              penaltyPercentApplied: rsvp.penaltyPercentApplied,
              feeShare: rsvp.feeShare,
              grossFeeShare: clampNumber(
                rsvp.grossFeeShare ?? rsvp.feeShare,
                0,
                100000
              ),
              walletCreditApplied: clampNumber(
                rsvp.walletCreditApplied ?? 0,
                0,
                100000
              ),
              walletPassApplied: Boolean(rsvp.walletPassApplied),
              walletWaiverApplied: Boolean(rsvp.walletWaiverApplied),
              paidStatus: rsvp.paidStatus,
              paidMethod: rsvp.paidMethod,
              playerName: rsvp.playerName,
              updatedAt: serverTimestamp(),
            });
          }
          for (const wKey of Array.from(changedWalletKeysSet)) {
            const w = walletSettlement.updatedWalletsMap[wKey];
            const [wClubId, wPlayerId] = wKey.split('::');
            const resolvedCId = wClubId || session.clubId;
            const docId = makeCloudWalletDocId(resolvedCId, wPlayerId);
            const wRef = doc(db, 'clubWallets', docId);
            const cleanCredit = clampNumber(
              Number((w.creditBalance || 0).toFixed(2)),
              0,
              100000
            );
            const cleanPasses = Math.round(
              clampNumber(Math.floor(w.freeSessionPasses || 0), 0, 1000)
            );
            const cleanWaive = Boolean(w.waiveAllFees);
            if (walletSnaps.get(docId)) {
              tx.update(wRef, {
                creditBalance: cleanCredit,
                freeSessionPasses: cleanPasses,
                waiveAllFees: cleanWaive,
                updatedAt: serverTimestamp(),
              });
            } else {
              cloudWalletDocIdsRef.current.add(docId);
              tx.set(wRef, {
                clubId: sanitizeId(resolvedCId),
                playerId: sanitizeId(wPlayerId),
                creditBalance: cleanCredit,
                freeSessionPasses: cleanPasses,
                waiveAllFees: cleanWaive,
                ownerId: user.uid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          }
        });
      }
      return { ok: true };
    }

    const updatedRsvps = currentRsvps.map((r) =>
      r.id === rsvpId
        ? {
            ...r,
            attendanceOutcome: outcome,
            penaltyPercentApplied: nextPenaltyPct,
          }
        : r
    );
    rsvpsRef.current = updatedRsvps;
    setRsvps(updatedRsvps);

    if (user) {
      await safeUpdateDoc('rsvps', rsvpId, {
        status: targetRsvp.status,
        attendanceOutcome: outcome,
        penaltyPercentApplied: nextPenaltyPct,
        feeShare: targetRsvp.feeShare,
        paidStatus: targetRsvp.paidStatus,
        paidMethod: targetRsvp.paidMethod,
        playerName: targetRsvp.playerName,
      });
    }
    return { ok: true };
  };

  const handleSettleRsvpAdjustment = async (
    rsvpId: string
  ): Promise<ActionResult> => {
    const targetRsvp = rsvpsRef.current.find((r) => r.id === rsvpId);
    if (!targetRsvp) {
      return { ok: false, reason: 'RSVP not found.' };
    }
    if (!canManageClubById(targetRsvp.clubId)) {
      return { ok: false, reason: 'Permission denied.' };
    }
    const settled = settleRsvpAdjustment(targetRsvp);
    const updatedRsvps = rsvpsRef.current.map((r) =>
      r.id === rsvpId ? settled : r
    );
    rsvpsRef.current = updatedRsvps;
    setRsvps(updatedRsvps);

    if (user) {
      try {
        await safeUpdateDoc('rsvps', rsvpId, {
          status: settled.status,
          attendanceOutcome: settled.attendanceOutcome,
          penaltyPercentApplied: settled.penaltyPercentApplied,
          feeShare: settled.feeShare,
          grossFeeShare: settled.grossFeeShare ?? settled.feeShare,
          paidStatus: settled.paidStatus,
          paidMethod: settled.paidMethod,
          playerName: settled.playerName,
        });
      } catch (err) {
        return {
          ok: false,
          reason: friendlyWriteError(err),
        };
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
      return { ok: false, reason: 'Permission denied.' };
    }

    const cleanCourtFee = clampNumber(updates.courtFee, 0, 100000);
    const cleanCourts = clampString(updates.courtNumbers, 60, 'Court 1');
    const cleanMaxPlayers = clampNumber(updates.maxPlayers, 2, 64);
    // P1-3: A session cannot be marked 'completed' without finalizing its fee split
    const nextStatus: BookingStatus =
      updates.bookingStatus === 'completed' && !session.feeSplitFinalized
        ? 'in_play'
        : updates.bookingStatus;

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
      return { ok: false, reason: 'Permission denied.' };
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
    // P1-3: Prevent marking 'completed' without finalizing split
    const nextStatus: BookingStatus =
      updates.bookingStatus === 'completed' && !session.feeSplitFinalized
        ? 'in_play'
        : updates.bookingStatus;
    const sessionClub =
      clubs.find((c) => c.id === session.clubId) || activeClub;
    const instants = computeSessionInstants(
      { sessionDate: cleanDate, startTime: cleanStart },
      sessionClub
    );

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
              ...(instants
                ? {
                    startsAt: instants.startsAtMs,
                    lateCancelUntil: instants.lateCancelUntilMs,
                    freeCancelUntil: instants.freeCancelUntilMs,
                  }
                : {}),
            }
          : s
      )
    );

    if (user) {
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
        ...(instants
          ? {
              startsAt: new Date(instants.startsAtMs),
              lateCancelUntil: new Date(instants.lateCancelUntilMs),
              freeCancelUntil:
                instants.freeCancelUntilMs !== null
                  ? new Date(instants.freeCancelUntilMs)
                  : null,
            }
          : {}),
      });
    }
    return { ok: true };
  };

  const handleReopenSessionSplit = async (
    sessionId: string
  ): Promise<ActionResult> => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || !canManageClubById(session.clubId)) {
      return { ok: false, reason: 'Permission denied.' };
    }

    const sessionRsvps = rsvps.filter((r) => r.sessionId === sessionId);
    const reopened = restoreSessionRsvpsAndWalletsForReopen({
      sessionRsvps,
      walletsMap: playerWalletsMap,
    });

    const restoredById = new Map(
      reopened.restoredSessionRsvps.map((r) => [r.id, r])
    );

    if (!user) {
      savePlayerWalletsMap(reopened.restoredWalletsMap);
    }
    setPlayerWalletsMap(reopened.restoredWalletsMap);

    const nextBookingStatus: BookingStatus =
      session.bookingStatus === 'completed' ? 'in_play' : session.bookingStatus;

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
    setRsvps((prev) =>
      prev.map((r) => (r.sessionId === sessionId ? restoredById.get(r.id) || r : r))
    );

    if (user) {
      await runTransaction(db, async (tx) => {
        const walletSnaps = new Map<string, boolean>();
        for (const wKey of reopened.changedWalletKeys) {
          const [, playerId] = wKey.split('::');
          const docId = makeCloudWalletDocId(session.clubId, playerId);
          const snap = await tx.get(doc(db, 'clubWallets', docId));
          walletSnaps.set(docId, snap.exists());
        }

        tx.update(doc(db, 'sessions', sessionId), {
          bookingStatus: nextBookingStatus,
          feeSplitFinalized: false,
          updatedAt: serverTimestamp(),
        });

        for (const rsvp of reopened.restoredSessionRsvps) {
          tx.update(doc(db, 'rsvps', rsvp.id), {
            status: rsvp.status,
            attendanceOutcome: rsvp.attendanceOutcome,
            penaltyPercentApplied: rsvp.penaltyPercentApplied,
            feeShare: rsvp.feeShare,
            grossFeeShare: 0,
            walletCreditApplied: 0,
            walletPassApplied: false,
            walletWaiverApplied: false,
            paidStatus: rsvp.paidStatus,
            paidMethod: rsvp.paidMethod,
            playerName: rsvp.playerName,
            updatedAt: serverTimestamp(),
          });
        }

        for (const wKey of reopened.changedWalletKeys) {
          const w = reopened.restoredWalletsMap[wKey];
          const [, playerId] = wKey.split('::');
          const docId = makeCloudWalletDocId(session.clubId, playerId);
          const wRef = doc(db, 'clubWallets', docId);
          const cleanCredit = clampNumber(
            Number((w.creditBalance || 0).toFixed(2)),
            0,
            100000
          );
          const cleanPasses = Math.round(
            clampNumber(Math.floor(w.freeSessionPasses || 0), 0, 1000)
          );
          const cleanWaive = Boolean(w.waiveAllFees);
          if (walletSnaps.get(docId)) {
            tx.update(wRef, {
              creditBalance: cleanCredit,
              freeSessionPasses: cleanPasses,
              waiveAllFees: cleanWaive,
              updatedAt: serverTimestamp(),
            });
          } else {
            cloudWalletDocIdsRef.current.add(docId);
            tx.set(wRef, {
              clubId: sanitizeId(session.clubId),
              playerId: sanitizeId(playerId),
              creditBalance: cleanCredit,
              freeSessionPasses: cleanPasses,
              waiveAllFees: cleanWaive,
              ownerId: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }
      });
    }
    return { ok: true };
  };

  const handleDeleteSession = async (sessionId: string) => {
    const targetSession = sessions.find((s) => s.id === sessionId);
    if (!targetSession || !canManageClubById(targetSession.clubId)) return;

    const sessionRsvps = rsvps.filter((r) => r.sessionId === sessionId);
    const sessionMatches = matches.filter((m) => m.sessionId === sessionId);

    // If the session was finalized, restore any wallet free passes or credits consumed by it
    const reopened = targetSession.feeSplitFinalized
      ? restoreSessionRsvpsAndWalletsForReopen({
          sessionRsvps,
          walletsMap: playerWalletsMap,
        })
      : null;

    if (reopened) {
      if (!user) {
        savePlayerWalletsMap(reopened.restoredWalletsMap);
      }
      setPlayerWalletsMap(reopened.restoredWalletsMap);
    }

    const remainingSessions = sessions.filter((s) => s.id !== sessionId);
    const remainingMatches = matches.filter((m) => m.sessionId !== sessionId);
    const modifiedPlayerIds = new Set<string>();
    const lastMatchByPlayerId = new Map<string, string>();
    sessionMatches.forEach((m) => {
      getMatchSidePlayers(m, 'A').forEach((p) => {
        modifiedPlayerIds.add(p.id);
        lastMatchByPlayerId.set(p.id, m.id);
      });
      getMatchSidePlayers(m, 'B').forEach((p) => {
        modifiedPlayerIds.add(p.id);
        lastMatchByPlayerId.set(p.id, m.id);
      });
    });

    const recalculatedPlayers = recalculatePlayerStatsFromMatches(
      rawPlayers,
      remainingMatches,
      remainingSessions
    );

    setSessions(remainingSessions);
    setRsvps((prev) => prev.filter((r) => r.sessionId !== sessionId));
    setMatches(remainingMatches);
    if (modifiedPlayerIds.size > 0) {
      setPlayers(recalculatedPlayers);
    }

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

    if (user) {
      const walletOps: BatchWriteOperation[] = reopened
        ? reopened.changedWalletKeys.map((wKey) => {
            const w = reopened.restoredWalletsMap[wKey];
            const [, playerId] = wKey.split('::');
            return buildWalletBatchOp(targetSession.clubId, playerId, w);
          })
        : [];

      const playerStatOps: BatchWriteOperation[] = recalculatedPlayers
        .filter((p) => modifiedPlayerIds.has(p.id))
        .map((p): BatchWriteOperation => ({
          type: 'update',
          collectionName: 'players',
          docId: p.id,
          updates: {
            lastMatchId: lastMatchByPlayerId.get(p.id) || '',
            wins: p.wins,
            losses: p.losses,
            gamesPlayed: p.gamesPlayed,
            pointsScored: p.pointsScored,
            pointsConceded: p.pointsConceded,
            singlesWins: p.singlesWins,
            singlesLosses: p.singlesLosses,
            doublesWins: p.doublesWins,
            doublesLosses: p.doublesLosses,
            ratingScore: p.ratingScore,
          },
        }));

      await safeBatchWrite([
        { type: 'delete', collectionName: 'sessions', docId: sessionId },
        ...sessionRsvps.map(
          (r): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'rsvps',
            docId: r.id,
          })
        ),
        ...sessionMatches.map(
          (m): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'matches',
            docId: m.id,
          })
        ),
        ...walletOps,
        ...playerStatOps,
      ]);
    }
  };

  const handleFinalizeSessionShuttleAndSplit = async (
    sessionId: string,
    bookingStatus: BookingStatus,
    courtFee: number,
    shuttlesUsed: number,
    shuttleUnitCost: number,
    courtNumbers: string,
    finalizeSplit: boolean
  ): Promise<ActionResult> => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || !canManageClubById(session.clubId)) {
      return { ok: false, reason: 'Permission denied.' };
    }
    if (!enforceRateLimit('finalize_session')) {
      return { ok: false, reason: 'Too many requests. Please wait a moment.' };
    }

    const cleanCourtFee = clampNumber(courtFee, 0, 100000);
    const cleanShuttlesUsed = clampNumber(shuttlesUsed, 0, 1000);
    const cleanUnitCost = clampNumber(shuttleUnitCost, 0, 1000);
    const cleanShuttleFee = Number(
      (cleanShuttlesUsed * cleanUnitCost).toFixed(2)
    );
    const cleanCourts = clampString(courtNumbers, 60, 'Court 1');

    const club =
      clubs.find((c) => c.id === session.clubId) || activeClub;
    const rawSessionRsvps = rsvps.filter((r) => r.sessionId === sessionId);

    // If this session was already finalized earlier, restore any wallet passes/credits first before recalculating
    const preReopen = session.feeSplitFinalized
      ? restoreSessionRsvpsAndWalletsForReopen({
          sessionRsvps: rawSessionRsvps,
          walletsMap: playerWalletsMap,
        })
      : {
          restoredSessionRsvps: rawSessionRsvps,
          restoredWalletsMap: playerWalletsMap,
          changedWalletKeys: [] as string[],
        };

    const sessionRsvps = preReopen.restoredSessionRsvps;
    const baseWalletsMap = preReopen.restoredWalletsMap;

    const splits = computeWeightedSessionSplits(
      cleanCourtFee,
      cleanShuttleFee,
      sessionRsvps,
      club.noShowFeePercent,
      {
        clubOwnerPlayerId: club.clubOwnerPlayerId,
        excludeOwnerFromBilling: Boolean(club.excludeOwnerFromBilling),
      }
    );

    // Calculate session splits and apply member wallets (VIP waivers, free session passes, or club credit) when finalizing
    const walletSettlement = applyWalletsToFinalizedSessionRsvps({
      sessionRsvps,
      splits,
      walletsMap: baseWalletsMap,
      finalizeSplit,
      clubOwnerPlayerId: club.clubOwnerPlayerId,
      excludeOwnerFromBilling: Boolean(club.excludeOwnerFromBilling),
    });

    const settledById = new Map(
      walletSettlement.updatedSessionRsvps.map((r) => [r.id, r])
    );

    const changedWalletKeysSet = new Set<string>(preReopen.changedWalletKeys);
    Object.keys(walletSettlement.updatedWalletsMap).forEach((wKey) => {
      const prevW = playerWalletsMap[wKey];
      const nextW = walletSettlement.updatedWalletsMap[wKey];
      if (
        !prevW ||
        prevW.creditBalance !== nextW.creditBalance ||
        prevW.freeSessionPasses !== nextW.freeSessionPasses ||
        prevW.waiveAllFees !== nextW.waiveAllFees
      ) {
        changedWalletKeysSet.add(wKey);
      }
    });

    if (finalizeSplit || session.feeSplitFinalized) {
      if (!user) {
        savePlayerWalletsMap(walletSettlement.updatedWalletsMap);
      }
      setPlayerWalletsMap(walletSettlement.updatedWalletsMap);
    }

    // Single synchronous batch update to eliminate any UI stutter
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              bookingStatus,
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
    setRsvps((prev) =>
      prev.map((r) => {
        if (r.sessionId !== sessionId) return r;
        return settledById.get(r.id) || r;
      })
    );

    if (user) {
      await runTransaction(db, async (tx) => {
        const walletSnaps = new Map<string, boolean>();
        for (const wKey of Array.from(changedWalletKeysSet)) {
          const [wClubId, wPlayerId] = wKey.split('::');
          const docId = makeCloudWalletDocId(
            wClubId || session.clubId,
            wPlayerId
          );
          const snap = await tx.get(doc(db, 'clubWallets', docId));
          walletSnaps.set(docId, snap.exists());
        }

        tx.update(doc(db, 'sessions', sessionId), {
          bookingStatus,
          courtFee: cleanCourtFee,
          shuttlesUsed: cleanShuttlesUsed,
          shuttleUnitCost: cleanUnitCost,
          shuttleFee: cleanShuttleFee,
          courtNumbers: cleanCourts,
          feeSplitFinalized: finalizeSplit,
          updatedAt: serverTimestamp(),
        });

        for (const rsvp of walletSettlement.updatedSessionRsvps) {
          tx.update(doc(db, 'rsvps', rsvp.id), {
            status: rsvp.status,
            attendanceOutcome: rsvp.attendanceOutcome,
            penaltyPercentApplied: rsvp.penaltyPercentApplied,
            feeShare: rsvp.feeShare,
            grossFeeShare: clampNumber(
              rsvp.grossFeeShare ?? rsvp.feeShare,
              0,
              100000
            ),
            walletCreditApplied: clampNumber(
              rsvp.walletCreditApplied ?? 0,
              0,
              100000
            ),
            walletPassApplied: Boolean(rsvp.walletPassApplied),
            walletWaiverApplied: Boolean(rsvp.walletWaiverApplied),
            paidStatus: rsvp.paidStatus,
            paidMethod: rsvp.paidMethod,
            playerName: rsvp.playerName,
            updatedAt: serverTimestamp(),
          });
        }

        for (const wKey of Array.from(changedWalletKeysSet)) {
          const w = walletSettlement.updatedWalletsMap[wKey];
          const [wClubId, wPlayerId] = wKey.split('::');
          const resolvedCId = wClubId || session.clubId;
          const docId = makeCloudWalletDocId(resolvedCId, wPlayerId);
          const wRef = doc(db, 'clubWallets', docId);
          const cleanCredit = clampNumber(
            Number((w.creditBalance || 0).toFixed(2)),
            0,
            100000
          );
          const cleanPasses = Math.round(
            clampNumber(Math.floor(w.freeSessionPasses || 0), 0, 1000)
          );
          const cleanWaive = Boolean(w.waiveAllFees);
          if (walletSnaps.get(docId)) {
            tx.update(wRef, {
              creditBalance: cleanCredit,
              freeSessionPasses: cleanPasses,
              waiveAllFees: cleanWaive,
              updatedAt: serverTimestamp(),
            });
          } else {
            cloudWalletDocIdsRef.current.add(docId);
            tx.set(wRef, {
              clubId: sanitizeId(resolvedCId),
              playerId: sanitizeId(wPlayerId),
              creditBalance: cleanCredit,
              freeSessionPasses: cleanPasses,
              waiveAllFees: cleanWaive,
              ownerId: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }
      });
    }
    return { ok: true };
  };

  // Club Owner ONLY: Top up member credit balance, grant free session passes, or toggle complete fee waiver for a specific club
  const handleUpdatePlayerWallet = async (
    playerId: string,
    updates: Partial<PlayerBenefitWallet>,
    targetClubId?: string
  ) => {
    const resolvedClubId =
      targetClubId ||
      (effectiveClubId !== 'all'
        ? effectiveClubId
        : myOwnedClub?.id || activeClub?.id || 'club_bintang_prime');

    if (!isOwnerOfClubById(resolvedClubId)) return;

    const walletKey = makeClubWalletKey(resolvedClubId, playerId);
    const existing = playerWalletsMap[walletKey] || {
      creditBalance: 0,
      freeSessionPasses: 0,
      waiveAllFees: false,
    };
    const updatedWallet: PlayerBenefitWallet = {
      creditBalance:
        updates.creditBalance !== undefined
          ? Math.max(0, Number(updates.creditBalance.toFixed(2)))
          : existing.creditBalance,
      freeSessionPasses:
        updates.freeSessionPasses !== undefined
          ? Math.max(0, Math.floor(updates.freeSessionPasses))
          : existing.freeSessionPasses,
      waiveAllFees:
        updates.waiveAllFees !== undefined
          ? Boolean(updates.waiveAllFees)
          : existing.waiveAllFees,
    };

    // Automatically settle or reverse any finalized RSVPs for this member in THIS club using their updated waiver, passes, or credit
    const settled = settlePlayerExistingUnpaidRsvpsWithWallet({
      playerId,
      clubId: resolvedClubId,
      wallet: updatedWallet,
      rsvps,
      sessions,
    });

    const nextWalletsMap = {
      ...playerWalletsMap,
      [walletKey]: settled.remainingWallet,
    };
    if (!user) {
      savePlayerWalletsMap(nextWalletsMap);
    }
    setPlayerWalletsMap(nextWalletsMap);

    if (settled.modifiedRsvps.length > 0) {
      setRsvps(settled.updatedRsvps);
    }

    if (user) {
      const docId = makeCloudWalletDocId(resolvedClubId, playerId);
      await runTransaction(db, async (tx) => {
        const wRef = doc(db, 'clubWallets', docId);
        const wSnap = await tx.get(wRef);
        const cleanCredit = clampNumber(
          Number((settled.remainingWallet.creditBalance || 0).toFixed(2)),
          0,
          100000
        );
        const cleanPasses = Math.round(
          clampNumber(
            Math.floor(settled.remainingWallet.freeSessionPasses || 0),
            0,
            1000
          )
        );
        const cleanWaive = Boolean(settled.remainingWallet.waiveAllFees);
        if (wSnap.exists()) {
          tx.update(wRef, {
            creditBalance: cleanCredit,
            freeSessionPasses: cleanPasses,
            waiveAllFees: cleanWaive,
            updatedAt: serverTimestamp(),
          });
        } else {
          cloudWalletDocIdsRef.current.add(docId);
          tx.set(wRef, {
            clubId: sanitizeId(resolvedClubId),
            playerId: sanitizeId(playerId),
            creditBalance: cleanCredit,
            freeSessionPasses: cleanPasses,
            waiveAllFees: cleanWaive,
            ownerId: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        for (const r of settled.modifiedRsvps) {
          tx.update(doc(db, 'rsvps', r.id), {
            status: r.status,
            attendanceOutcome: r.attendanceOutcome,
            penaltyPercentApplied: r.penaltyPercentApplied,
            feeShare: r.feeShare,
            grossFeeShare: clampNumber(r.grossFeeShare ?? r.feeShare, 0, 100000),
            walletCreditApplied: clampNumber(
              r.walletCreditApplied ?? 0,
              0,
              100000
            ),
            walletPassApplied: Boolean(r.walletPassApplied),
            walletWaiverApplied: Boolean(r.walletWaiverApplied),
            paidStatus: r.paidStatus,
            paidMethod: r.paidMethod,
            playerName: r.playerName,
            updatedAt: serverTimestamp(),
          });
        }
      });
    }
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
    const cleanMethod = clampString(method, 40, 'Reported Paid');

    setRsvps((prev) =>
      prev.map((r) =>
        r.id === rsvpId
          ? { ...r, paidStatus: 'pending_approval', paidMethod: cleanMethod }
          : r
      )
    );

    if (user) {
      await safeUpdateDoc('rsvps', rsvpId, {
        paidStatus: 'pending_approval',
        paidMethod: cleanMethod,
      });
    }
  };

  // Normal User: Mark all unpaid RSVPs for player as 'pending_approval' in a SINGLE batch (scoped to clubId when provided)
  const handleNotifyPaymentSentAllForPlayer = async (
    playerId: string,
    method = 'Reported Paid',
    clubId?: string
  ) => {
    if (!activePlayer || playerId !== activePlayer.id) return;
    const cleanMethod = clampString(method, 40, 'Reported Paid');
    const targets = rsvps.filter(
      (r) =>
        r.playerId === playerId &&
        r.paidStatus !== 'paid' &&
        r.feeShare > 0 &&
        (!clubId || r.clubId === clubId)
    );
    if (targets.length === 0) return;
    const targetIds = new Set(targets.map((t) => t.id));

    // Single state update -> zero stutter
    setRsvps((prev) =>
      prev.map((r) =>
        targetIds.has(r.id)
          ? { ...r, paidStatus: 'pending_approval', paidMethod: cleanMethod }
          : r
      )
    );

    if (user) {
      await safeBatchWrite(
        targets.map(
          (target): BatchWriteOperation => ({
            type: 'update',
            collectionName: 'rsvps',
            docId: target.id,
            updates: {
              paidStatus: 'pending_approval',
              paidMethod: cleanMethod,
            },
          })
        )
      );
    }
  };

  // Club Owner ONLY: Accept or Clear a single RSVP ('paid') — strictly requires ownership of the RSVP's club
  const handleAcceptOrClearSingleRsvp = async (
    rsvpId: string,
    method = 'Approved'
  ) => {
    const target = rsvps.find((r) => r.id === rsvpId);
    if (!target || !isOwnerOfClubById(target.clubId)) return;
    const cleanMethod = clampString(method, 40, 'Approved');

    setRsvps((prev) =>
      prev.map((r) =>
        r.id === rsvpId
          ? { ...r, paidStatus: 'paid', paidMethod: cleanMethod }
          : r
      )
    );

    if (user) {
      await safeUpdateDoc('rsvps', rsvpId, {
        status: target.status,
        attendanceOutcome: target.attendanceOutcome,
        penaltyPercentApplied: target.penaltyPercentApplied,
        feeShare: target.feeShare,
        paidStatus: 'paid',
        paidMethod: cleanMethod,
        playerName: target.playerName,
      });
    }
  };

  // Club Owner ONLY: Reject a pending payment notification (returns to 'unpaid' with 'Rejected')
  const handleRejectPaymentForRsvp = async (rsvpId: string) => {
    const target = rsvps.find((r) => r.id === rsvpId);
    if (!target || !isOwnerOfClubById(target.clubId)) return;

    setRsvps((prev) =>
      prev.map((r) =>
        r.id === rsvpId
          ? { ...r, paidStatus: 'unpaid', paidMethod: 'Rejected' }
          : r
      )
    );

    if (user) {
      await safeUpdateDoc('rsvps', rsvpId, {
        status: target.status,
        attendanceOutcome: target.attendanceOutcome,
        penaltyPercentApplied: target.penaltyPercentApplied,
        feeShare: target.feeShare,
        paidStatus: 'unpaid',
        paidMethod: 'Rejected',
        playerName: target.playerName,
      });
    }
  };

  // Club Owner ONLY: Accept/Clear all unpaid RSVPs for a player in a club owned by the current user
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
        isOwnerOfClubById(r.clubId)
    );
    if (unpaidForPlayer.length === 0) return;
    const targetIds = new Set(unpaidForPlayer.map((r) => r.id));

    // Single synchronous state update -> zero stutter
    setRsvps((prev) =>
      prev.map((r) =>
        targetIds.has(r.id)
          ? { ...r, paidStatus: 'paid', paidMethod: cleanMethod }
          : r
      )
    );

    if (user) {
      await safeBatchWrite(
        unpaidForPlayer.map(
          (target): BatchWriteOperation => ({
            type: 'update',
            collectionName: 'rsvps',
            docId: target.id,
            updates: {
              status: target.status,
              attendanceOutcome: target.attendanceOutcome,
              penaltyPercentApplied: target.penaltyPercentApplied,
              feeShare: target.feeShare,
              paidStatus: 'paid',
              paidMethod: cleanMethod,
              playerName: target.playerName,
            },
          })
        )
      );
    }
  };

  // Club Owner ONLY: Reject all pending RSVPs for a player in a club owned by the current user
  const handleRejectAllForPlayer = async (
    playerId: string,
    clubId?: string
  ) => {
    const pendingForPlayer = rsvps.filter(
      (r) =>
        r.playerId === playerId &&
        r.paidStatus === 'pending_approval' &&
        r.feeShare > 0 &&
        (!clubId || r.clubId === clubId) &&
        isOwnerOfClubById(r.clubId)
    );
    if (pendingForPlayer.length === 0) return;
    const targetIds = new Set(pendingForPlayer.map((r) => r.id));

    setRsvps((prev) =>
      prev.map((r) =>
        targetIds.has(r.id)
          ? { ...r, paidStatus: 'unpaid', paidMethod: 'Rejected' }
          : r
      )
    );

    if (user) {
      await safeBatchWrite(
        pendingForPlayer.map(
          (target): BatchWriteOperation => ({
            type: 'update',
            collectionName: 'rsvps',
            docId: target.id,
            updates: {
              status: target.status,
              attendanceOutcome: target.attendanceOutcome,
              penaltyPercentApplied: target.penaltyPercentApplied,
              feeShare: target.feeShare,
              paidStatus: 'unpaid',
              paidMethod: 'Rejected',
              playerName: target.playerName,
            },
          })
        )
      );
    }
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
    targetPoints?: number;
  }) => {
    const matchSession = sessions.find((s) => s.id === matchData.sessionId);
    if (!matchSession || !canManageClubById(matchSession.clubId)) {
      throw new Error('You do not have permission to log matches for this session.');
    }
    const matchClub = clubs.find((c) => c.id === matchSession.clubId) || activeClub;
    const targetPoints =
      matchData.targetPoints ?? matchClub?.defaultMatchTargetPoints ?? 21;

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

    const teamAIds = getMatchSidePlayers(newMatch, 'A').map((p) => p.id);
    const teamBIds = getMatchSidePlayers(newMatch, 'B').map((p) => p.id);

    const prevMatches = matches;
    const prevRawPlayers = rawPlayers;
    const nextMatches = [newMatch, ...matches];
    const recalculatedPlayers = recalculatePlayerStatsFromMatches(
      rawPlayers,
      nextMatches,
      sessions
    );
    const recalcById = new Map(recalculatedPlayers.map((p) => [p.id, p]));

    // Optimistic state update
    setMatches(nextMatches);
    setPlayers(recalculatedPlayers);

    if (user) {
      const { id, createdAt: _createdAt, ...payload } = newMatch;
      const involvedPlayers = rawPlayers.filter(
        (p) => teamAIds.includes(p.id) || teamBIds.includes(p.id)
      );
      try {
        // Relies on firestore.rules:384-397 (matchAuthorizesStats) and 564-575 (matches create)
        await safeBatchWrite([
          {
            type: 'set',
            collectionName: 'matches',
            docId: id,
            data: payload,
          },
          ...involvedPlayers.map((p): BatchWriteOperation => {
            const updatedP = recalcById.get(p.id) || p;
            return {
              type: 'update',
              collectionName: 'players',
              docId: p.id,
              updates: {
                lastMatchId: id,
                wins: updatedP.wins,
                losses: updatedP.losses,
                gamesPlayed: updatedP.gamesPlayed,
                pointsScored: updatedP.pointsScored,
                pointsConceded: updatedP.pointsConceded,
                singlesWins: updatedP.singlesWins,
                singlesLosses: updatedP.singlesLosses,
                doublesWins: updatedP.doublesWins,
                doublesLosses: updatedP.doublesLosses,
                ratingScore: updatedP.ratingScore,
              },
            };
          }),
        ]);
      } catch (err) {
        setMatches(prevMatches);
        setPlayers(prevRawPlayers);
        throw err;
      }
    }
  };

  const handleDeleteMatch = async (matchId: string) => {
    const target = matches.find((m) => m.id === matchId);
    if (!target || !canManageClubById(target.clubId)) return;
    if (!enforceRateLimit('delete_match')) return;

    const teamAIds = getMatchSidePlayers(target, 'A').map((p) => p.id);
    const teamBIds = getMatchSidePlayers(target, 'B').map((p) => p.id);

    const remainingMatches = matches.filter((m) => m.id !== matchId);
    const recalculatedPlayers = recalculatePlayerStatsFromMatches(
      rawPlayers,
      remainingMatches,
      sessions
    );
    const recalcById = new Map(recalculatedPlayers.map((p) => [p.id, p]));
    const involvedPlayers = rawPlayers.filter(
      (p) => teamAIds.includes(p.id) || teamBIds.includes(p.id)
    );

    setMatches(remainingMatches);
    setPlayers(recalculatedPlayers);

    if (user) {
      await safeBatchWrite([
        { type: 'delete', collectionName: 'matches', docId: matchId },
        ...involvedPlayers.map((p): BatchWriteOperation => {
          const updatedP = recalcById.get(p.id) || p;
          return {
            type: 'update',
            collectionName: 'players',
            docId: p.id,
            updates: {
              lastMatchId: matchId,
              wins: updatedP.wins,
              losses: updatedP.losses,
              gamesPlayed: updatedP.gamesPlayed,
              pointsScored: updatedP.pointsScored,
              pointsConceded: updatedP.pointsConceded,
              singlesWins: updatedP.singlesWins,
              singlesLosses: updatedP.singlesLosses,
              doublesWins: updatedP.doublesWins,
              doublesLosses: updatedP.doublesLosses,
              ratingScore: updatedP.ratingScore,
            },
          };
        }),
      ]);
    }
  };

  const handleDeleteOwnAccount = async () => {
    if (!activePlayer) return;
    if (ownsAnyClub) {
      throw new Error(
        'Please transfer ownership or delete any club you own before deleting your account.'
      );
    }
    if (myUnpaidTotal > 0 || myPendingTotal > 0) {
      throw new Error(
        `Please settle your $${(myUnpaidTotal + myPendingTotal).toFixed(
          2
        )} in outstanding session fees before deleting your account.`
      );
    }
    const openRsvpsToDelete = rsvps.filter((r) => {
      if (r.playerId !== activePlayer.id) return false;
      const sess = sessions.find((s) => s.id === r.sessionId);
      return (
        Boolean(sess) &&
        sess!.bookingStatus !== 'completed' &&
        !sess!.feeSplitFinalized &&
        r.feeShare === 0 &&
        r.paidStatus === 'unpaid'
      );
    });
    const myRequestsToDelete = clubJoinRequests.filter(
      (r) => r.playerId === activePlayer.id
    );

    if (user) {
      const ops: BatchWriteOperation[] = [
        ...openRsvpsToDelete.map(
          (r): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'rsvps',
            docId: r.id,
          })
        ),
        ...myRequestsToDelete.map(
          (r): BatchWriteOperation => ({
            type: 'delete',
            collectionName: 'clubJoinRequests',
            docId: r.id,
          })
        ),
        {
          type: 'delete',
          collectionName: 'players',
          docId: activePlayer.id,
        },
      ];
      await safeBatchWrite(ops);
      try {
        const lockerSnap = await getDoc(doc(db, 'gearLockers', user.uid));
        if (lockerSnap.exists()) {
          await safeDeleteDoc('gearLockers', user.uid);
        }
      } catch {
        // ignore if no locker doc exists
      }
    }
    await handleSignOutAccount();
  };

  // Errors are surfaced by the auth screen (describeAuthError)
  const handleGoogleSignIn = async () => {
    setAuthErrorMessage(null);
    await signInWithGooglePopup();
  };

  const handleDevLogin = (persona: DevLoginPersona) => {
    if (!IS_DEV_MODE) return;
    setAuthErrorMessage(null);
    if (rawPlayers.length === 0 || rawClubs.length === 0) {
      const fallback = loadLocalClubState();
      setRawClubs(fallback.clubs);
      setSessions(fallback.sessions);
      setPlayers(fallback.players);
      setRsvps(fallback.rsvps);
      setMatches(fallback.matches);
    }
    saveDevSession(persona);
    setDevSession(persona);
    setPermissionTier(persona.tier);
    const ownedClub = rawClubs.find(
      (c) => (c.ownerPlayerId ?? c.clubOwnerPlayerId) === persona.playerId
    );
    if (persona.tier === 'club_owner' && ownedClub) {
      setActiveClubId(ownedClub.id);
    } else {
      setActiveClubId('all');
    }
  };

  const effectiveSignedIn = Boolean(user || (IS_DEV_MODE && devSession));

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

  if (!authReady || (user && isUserVerified && !playersLoaded)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xs font-semibold text-slate-500">
        Loading CourtPulse…
      </div>
    );
  }

  if (!effectiveSignedIn) {
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
        accountName={user?.displayName || ''}
        accountEmail={user?.email || ''}
        unclaimedPlayers={players.filter(
          (p) => !p.authUid && !LEGACY_SEEDED_DOC_IDS.has(p.id)
        )}
        pendingClaimPlayer={
          myProfileClaim
            ? players.find((p) => p.id === myProfileClaim.playerId) || null
            : null
        }
        onCreateProfile={handleCreateOwnProfile}
        onRequestClaim={handleRequestProfileClaim}
        onCancelClaim={handleCancelProfileClaim}
        onSignOut={() => void handleSignOutAccount()}
      />
    );
  }

  const modalJoinClub = clubJoinModalClubId
    ? clubs.find((c) => c.id === clubJoinModalClubId) || null
    : null;

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

                      {IS_DEV_MODE && devSession && !user && (
                        <div className="pt-1.5 mt-1 border-t border-slate-100 space-y-1">
                          <p className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Switch Dev Persona
                          </p>
                          {DEV_LOGIN_PERSONAS.map((p) => {
                            const isCurrent = p.id === devSession.id;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setAccountMenuOpen(false);
                                  handleDevLogin(p);
                                }}
                                className={`w-full h-8 px-2.5 text-xs font-semibold rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                                  isCurrent
                                    ? 'bg-emerald-50 text-emerald-900'
                                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                                }`}
                              >
                                <span className="truncate">{p.name}</span>
                                <span className="text-[10px] font-mono text-slate-400 uppercase shrink-0">
                                  {p.tier === 'club_owner' ? 'owner' : p.tier}
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
                  : `Club: ${activeClub?.name || 'Badminton Club'}`}
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

      {/* Club Join Invitation Modal */}
      {modalJoinClub && (
        <ClubJoinPromptModal
          clubId={modalJoinClub.id}
          club={modalJoinClub}
          player={activePlayer}
          hasPendingRequest={clubJoinRequests.some(
            (r) =>
              r.clubId === modalJoinClub.id && r.playerId === activePlayer.id
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
                    onDeleteSession={handleDeleteSession}
                    onUpdateClubPaymentDetails={handleUpdateClubPaymentDetails}
                    onFinalizeSessionShuttleAndSplit={
                      handleFinalizeSessionShuttleAndSplit
                    }
                    onNotifyPaymentSentForRsvp={handleNotifyPaymentSentForRsvp}
                    onAcceptOrClearSingleRsvp={handleAcceptOrClearSingleRsvp}
                    onRejectPaymentForRsvp={handleRejectPaymentForRsvp}
                    onSettleRsvpAdjustment={handleSettleRsvpAdjustment}
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
          className={`relative flex flex-col items-center justify-center py-2.5 text-[11px] whitespace-nowrap transition-transform active:scale-95 cursor-pointer select-none ${
            activeTab === 'sessions' || activeTab === 'rsvp'
              ? 'text-slate-950 font-bold'
              : 'text-slate-600 font-semibold hover:text-slate-900'
          }`}
        >
          {(activeTab === 'sessions' || activeTab === 'rsvp') && (
            <motion.span
              layoutId="mobile-nav-indicator"
              transition={{ type: 'spring', stiffness: 450, damping: 34 }}
              className="absolute top-0 inset-x-3 h-0.5 bg-emerald-600 rounded-b-full"
            />
          )}
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="mt-1">Sessions</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectNavItem('leaderboard')}
          className={`relative flex flex-col items-center justify-center py-2.5 text-[11px] whitespace-nowrap transition-transform active:scale-95 cursor-pointer select-none ${
            activeTab === 'leaderboard'
              ? 'text-slate-950 font-bold'
              : 'text-slate-600 font-semibold hover:text-slate-900'
          }`}
        >
          {activeTab === 'leaderboard' && (
            <motion.span
              layoutId="mobile-nav-indicator"
              transition={{ type: 'spring', stiffness: 450, damping: 34 }}
              className="absolute top-0 inset-x-3 h-0.5 bg-emerald-600 rounded-b-full"
            />
          )}
          <Award className="w-4 h-4 shrink-0" />
          <span className="mt-1">Standings</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectNavItem('clubs')}
          className={`relative flex flex-col items-center justify-center py-2.5 text-[11px] whitespace-nowrap transition-transform active:scale-95 cursor-pointer select-none ${
            activeTab === 'clubs'
              ? 'text-slate-950 font-bold'
              : 'text-slate-600 font-semibold hover:text-slate-900'
          }`}
        >
          {activeTab === 'clubs' && (
            <motion.span
              layoutId="mobile-nav-indicator"
              transition={{ type: 'spring', stiffness: 450, damping: 34 }}
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
            className={`relative flex flex-col items-center justify-center py-2.5 text-[11px] whitespace-nowrap transition-transform active:scale-95 cursor-pointer select-none ${
              activeTab === 'users'
                ? 'text-slate-950 font-bold'
                : 'text-slate-600 font-semibold hover:text-slate-900'
            }`}
          >
            {activeTab === 'users' && (
              <motion.span
                layoutId="mobile-nav-indicator"
                transition={{ type: 'spring', stiffness: 450, damping: 34 }}
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
