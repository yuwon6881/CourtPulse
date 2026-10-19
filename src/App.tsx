/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
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
  formatClubPaymentInfo,
  getMatchSidePlayers,
  getPlayerJoinedClubIds,
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
  saveClubBillingRule,
  saveClubJoinRequests,
  saveClubPaymentDetails,
  savePlayerWalletsMap,
  saveRsvpGuestsMap,
  settlePlayerExistingUnpaidRsvpsWithWallet,
} from './utils/badmintonLogic';
import { checkAndConsumeRateLimit } from './utils/rateLimiter';
import { SegmentedControl, StyledSelect } from './components/ui/FormControls';
import {
  AuthGateScreen,
  ClubJoinPromptModal,
  DEV_LOGIN_PERSONAS,
  DevLoginPersona,
  ProfileSetupScreen,
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

const DEV_SESSION_STORAGE_KEY = 'courtpulse_dev_session_v1';

function loadDevSession(): DevLoginPersona | null {
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
    if (!persona) {
      localStorage.removeItem(DEV_SESSION_STORAGE_KEY);
    } else {
      localStorage.setItem(DEV_SESSION_STORAGE_KEY, JSON.stringify(persona));
    }
  } catch {
    // ignore
  }
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

function loadLocalClubState(): LocalClubSnapshot {
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

  const [rsvpGuestsMap, setRsvpGuestsMap] = useState<Record<string, number>>(
    () => loadRsvpGuestsMap()
  );

  const [rawClubs, setRawClubs] = useState<Club[]>(initialLocal.clubs);
  const [sessions, setSessions] = useState<Session[]>(initialLocal.sessions);
  const [rawPlayers, setPlayers] = useState<Player[]>(initialLocal.players);
  const [rawRsvps, setRsvps] = useState<SessionRsvp[]>(initialLocal.rsvps);

  // Enrich RSVPs with persistent +1 guest count
  const rsvps = useMemo<SessionRsvp[]>(() => {
    return rawRsvps.map((r) => {
      const mappedGuests =
        rsvpGuestsMap[r.id] !== undefined ? rsvpGuestsMap[r.id] : r.guestCount;
      return {
        ...r,
        guestCount:
          r.status === 'going'
            ? Math.max(0, Math.floor(Number(mappedGuests || 0)))
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

  // Enrich players with their persistent per-club Credit Balance, Free Session Passes, and Fee Waiver flags
  const players = useMemo<Player[]>(() => {
    const defaultClubId =
      activeClubId !== 'all'
        ? activeClubId
        : rawClubs[0]?.id || 'club_bintang_prime';

    return rawPlayers.map((p) => {
      const clubWallets: Record<string, PlayerBenefitWallet> = {};
      for (let i = 0; i < rawClubs.length; i++) {
        const cId = rawClubs[i].id;
        const wKey = makeClubWalletKey(cId, p.id);
        const w = playerWalletsMap[wKey];
        if (w) {
          clubWallets[cId] = {
            creditBalance: Math.max(0, Number(w.creditBalance || 0)),
            freeSessionPasses: Math.max(
              0,
              Math.floor(Number(w.freeSessionPasses || 0))
            ),
            waiveAllFees: Boolean(w.waiveAllFees),
          };
        }
      }

      const activeWallet = clubWallets[defaultClubId];
      return {
        ...p,
        clubWallets,
        creditBalance: activeWallet ? activeWallet.creditBalance : 0,
        freeSessionPasses: activeWallet ? activeWallet.freeSessionPasses : 0,
        waiveAllFees: activeWallet ? Boolean(activeWallet.waiveAllFees) : false,
      };
    });
  }, [rawPlayers, rawClubs, playerWalletsMap, activeClubId]);
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
      const resolvedPaymentDetails =
        clubPaymentMap[c.id] ||
        c.paymentDetails ||
        parseClubPaymentDetails(c.paymentInfo, ownerName);
      const billingRule = clubBillingRulesMap[c.id];
      const excludeOwnerFromBilling =
        billingRule !== undefined
          ? Boolean(billingRule.excludeOwnerFromBilling)
          : Boolean(c.excludeOwnerFromBilling);
      const defaultMatchTargetPoints =
        billingRule?.defaultMatchTargetPoints !== undefined
          ? clampNumber(billingRule.defaultMatchTargetPoints, 1, 100)
          : c.defaultMatchTargetPoints !== undefined
          ? clampNumber(c.defaultMatchTargetPoints, 1, 100)
          : 21;
      const visibility: ClubVisibility =
        c.visibility === 'private' ? 'private' : 'public';
      return {
        ...c,
        clubOwnerPlayerId: ownerPlayerId,
        clubOwnerName: ownerName,
        paymentDetails: resolvedPaymentDetails,
        excludeOwnerFromBilling,
        defaultMatchTargetPoints,
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
          if (prev.some((s) => s.id === hydratedSession.id)) return prev;
          return [hydratedSession, ...prev];
        });
      }
      setPendingInviteSessionId(sharedSessionId);
      setSelectedSessionId(sharedSessionId);
      setActiveTab('rsvp');
    }
  }, []);

  useEffect(() => {
    if (!user) {
      try {
        localStorage.setItem(
          LOCAL_STATE_STORAGE_KEY,
          JSON.stringify({ clubs: rawClubs, sessions, players, rsvps, matches })
        );
      } catch {
        // ignore
      }
    }
  }, [user, rawClubs, sessions, players, rsvps, matches]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      setPlayersLoaded(false);
      setPermissionTier(
        (currentUser && loadViewMode(currentUser.uid)) || 'admin'
      );
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
    // Only a bootstrap admin may seed demo data into an empty project (rules: clubs.create is admin-only)
    const canSeed = isBootstrapAdminEmail(user.email);

    const clubsQuery = query(collection(db, 'clubs'), limit(100));
    const sessionsQuery = query(
      collection(db, 'sessions'),
      orderBy('sessionDate', 'desc'),
      limit(200)
    );
    const playersQuery = query(collection(db, 'players'), limit(500));
    const rsvpsQuery = query(collection(db, 'rsvps'), limit(2000));
    const matchesQuery = query(collection(db, 'matches'), limit(600));

    const unsubClubs = onSnapshot(
      clubsQuery,
      async (snap) => {
        if (snap.empty && canSeed && !hasSeededCloudRef.current) {
          hasSeededCloudRef.current = true;
          await seedInitialClubDataToFirestore(uid);
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
      (err) => handleFirestoreError(err, OperationType.LIST, 'clubs')
    );

    const unsubSessions = onSnapshot(
      sessionsQuery,
      (snap) => {
        const docs: Session[] = snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            ...(raw as unknown as Omit<Session, 'id'>),
            clubId:
              typeof raw.clubId === 'string'
                ? raw.clubId
                : 'club_bintang_prime',
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
        const docs: Player[] = snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
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
            id: d.id,
          };
        });
        setPlayers(docs);
        setPlayersLoaded(true);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'players')
    );

    const unsubRsvps = onSnapshot(
      rsvpsQuery,
      (snap) => {
        const docs: SessionRsvp[] = snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            ...(raw as unknown as Omit<SessionRsvp, 'id'>),
            clubId:
              typeof raw.clubId === 'string'
                ? raw.clubId
                : 'club_bintang_prime',
            attendanceOutcome:
              typeof raw.attendanceOutcome === 'string'
                ? (raw.attendanceOutcome as AttendanceOutcome)
                : 'present',
            penaltyPercentApplied:
              typeof raw.penaltyPercentApplied === 'number'
                ? raw.penaltyPercentApplied
                : 100,
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
        const docs: BadmintonMatch[] = snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            ...(raw as unknown as Omit<BadmintonMatch, 'id'>),
            clubId:
              typeof raw.clubId === 'string'
                ? raw.clubId
                : 'club_bintang_prime',
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
      unsubRsvps();
      unsubMatches();
    };
  }, [authReady, user, isUserVerified, authVersion]);

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
            visibility: c.visibility || 'public',
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
      (!user && devSession && devSession.role === 'admin')
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

  const activeClub = useMemo(() => {
    if (activeClubId === 'all') {
      return myOwnedClub || userJoinedClubs[0] || clubs[0];
    }
    return (
      userJoinedClubs.find((c) => c.id === activeClubId) ||
      myOwnedClub ||
      userJoinedClubs[0] ||
      clubs[0]
    );
  }, [userJoinedClubs, activeClubId, clubs, myOwnedClub]);

  // Strict per-club management check:
  // - Site Admin ('admin') can manage any club
  // - Club Owner ('club_owner') can ONLY manage the single club where clubOwnerPlayerId === activePlayer.id
  // - In any club not owned by the person, they have zero management rights and behave like a normal user
  const canManageClubById = (targetClubId?: string | null): boolean => {
    if (!targetClubId) return false;
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
    // Club owners can only add members to the club they own
    const allowedClubIds =
      effectiveTier === 'admin'
        ? data.clubIds
        : activeClub && canManageClubById(activeClub.id)
        ? [activeClub.id]
        : [];
    if (allowedClubIds.length === 0) return;

    const joinedCsv = clampString(
      Array.from(new Set(allowedClubIds)).join(','),
      400,
      activeClub?.id || 'club_bintang_prime'
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
      ratingScore: number;
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
    const cleanRating = clampNumber(updates.ratingScore, 800, 3000);

    // Club membership is purely user intention and is not reconfigured by admin/owner
    const joinedCsv = target.joinedClubIdsCsv;

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
              status: r.status,
              attendanceOutcome: r.attendanceOutcome,
              penaltyPercentApplied: r.penaltyPercentApplied,
              feeShare: r.feeShare,
              paidStatus: r.paidStatus,
              paidMethod: r.paidMethod,
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
            joinedClubIdsCsv: activePlayer.joinedClubIdsCsv,
            ratingScore: activePlayer.ratingScore,
          },
        },
        ...affectedRsvps.map(
          (r): BatchWriteOperation => ({
            type: 'update',
            collectionName: 'rsvps',
            docId: r.id,
            updates: {
              status: r.status,
              attendanceOutcome: r.attendanceOutcome,
              penaltyPercentApplied: r.penaltyPercentApplied,
              feeShare: r.feeShare,
              paidStatus: r.paidStatus,
              paidMethod: r.paidMethod,
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
    if (effectiveTier !== 'admin' || players.length <= 1) return;
    if (activePlayer && activePlayer.id === playerId) return;
    const playerRsvps = rsvps.filter((r) => r.playerId === playerId);
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
      ]);
    }
  };

  const handleDeleteClub = async (clubId: string) => {
    if (effectiveTier !== 'admin' || rawClubs.length <= 1) return;
    const remaining = rawClubs.filter((c) => c.id !== clubId);
    const clubSessionIds = sessions
      .filter((s) => s.clubId === clubId)
      .map((s) => s.id);
    const clubRsvpIds = rsvps
      .filter((r) => r.clubId === clubId)
      .map((r) => r.id);
    const clubMatchIds = matches
      .filter((m) => m.clubId === clubId)
      .map((m) => m.id);

    setRawClubs(remaining);
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
      ]);
    }
  };

  const handleDevLogin = (persona: DevLoginPersona) => {
    saveDevSession(persona);
    setDevSession(persona);
    setPermissionTier(persona.role);
    saveViewMode(persona.playerId, persona.role);
    setAuthErrorMessage(null);
  };

  const handleSignOutAccount = async () => {
    saveDevSession(null);
    setDevSession(null);
    if (user) {
      await signOutUser();
    }
    setActiveTab('sessions');
    setActiveClubId('all');
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

    const nextBillingMap = saveClubBillingRule(
      clubId,
      nextExcludeOwner,
      nextTargetPoints
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
              paymentDetails: updates.paymentDetails || c.paymentDetails,
            }
          : c
      )
    );

    // Recompute session splits for this club so the owner billing exclusion setting takes immediate effect
    const targetClub = clubs.find((c) => c.id === clubId);
    const ownerPlayerId = targetClub?.clubOwnerPlayerId;
    const clubFinalizedSessions = sessions.filter(
      (s) => s.clubId === clubId && s.feeSplitFinalized
    );
    const changedRsvpsForCloud: SessionRsvp[] = [];
    if (clubFinalizedSessions.length > 0) {
      let nextList = [...rsvps];
      clubFinalizedSessions.forEach((sess) => {
        const sessRsvps = nextList.filter((r) => r.sessionId === sess.id);
        const splits = computeWeightedSessionSplits(
          sess.courtFee,
          sess.shuttleFee,
          sessRsvps,
          cleanUpdates.noShowFeePercent,
          {
            clubOwnerPlayerId: ownerPlayerId,
            excludeOwnerFromBilling: nextExcludeOwner,
          }
        );
        nextList = nextList.map((r) => {
          if (r.sessionId !== sess.id) return r;
          const calc = splits.get(r.id) || {
            feeShare: 0,
            penaltyPercentApplied: 0,
          };
          const updatedRow: SessionRsvp =
            ownerPlayerId && r.playerId === ownerPlayerId
              ? {
                  ...r,
                  feeShare: calc.feeShare,
                  penaltyPercentApplied: calc.penaltyPercentApplied,
                  paidStatus: 'paid',
                  paidMethod: nextExcludeOwner
                    ? 'Owner Excluded'
                    : 'Club Owner',
                }
              : {
                  ...r,
                  feeShare: calc.feeShare,
                  penaltyPercentApplied: calc.penaltyPercentApplied,
                };
          if (
            updatedRow.feeShare !== r.feeShare ||
            updatedRow.penaltyPercentApplied !== r.penaltyPercentApplied ||
            updatedRow.paidStatus !== r.paidStatus ||
            updatedRow.paidMethod !== r.paidMethod
          ) {
            changedRsvpsForCloud.push(updatedRow);
          }
          return updatedRow;
        });
      });
      setRsvps(nextList);
    }

    if (user) {
      await safeBatchWrite([
        {
          type: 'update',
          collectionName: 'clubs',
          docId: clubId,
          updates: cleanUpdates,
        },
        ...changedRsvpsForCloud.map(
          (r): BatchWriteOperation => ({
            type: 'update',
            collectionName: 'rsvps',
            docId: r.id,
            updates: {
              status: r.status,
              attendanceOutcome: r.attendanceOutcome,
              penaltyPercentApplied: r.penaltyPercentApplied,
              feeShare: r.feeShare,
              paidStatus: r.paidStatus,
              paidMethod: r.paidMethod,
              playerName: r.playerName,
            },
          })
        ),
      ]);
    }
  };

  const handleUpdateClubPaymentDetails = async (
    clubId: string,
    details: ClubPaymentDetails
  ) => {
    if (!canManageClubById(clubId)) return;
    const formatted = clampString(formatClubPaymentInfo(details), 160, 'PayNow');
    const nextPayMap = saveClubPaymentDetails(clubId, details);
    setClubPaymentMap(nextPayMap);

    setRawClubs((prev) =>
      prev.map((c) =>
        c.id === clubId
          ? { ...c, paymentInfo: formatted, paymentDetails: details }
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
      assignedPlayer?.name || activePlayer?.name || 'Alex Tan';
    const excludeOwner = Boolean(clubData.excludeOwnerFromBilling);
    const targetPoints = clampNumber(
      clubData.defaultMatchTargetPoints ?? 21,
      1,
      100
    );

    const newClub: Club = {
      id: newClubId,
      name: clampString(clubData.name, 100, 'New Badminton Club'),
      description: clampString(clubData.description, 200, 'Badminton Club'),
      paymentInfo: clampString(clubData.paymentInfo, 160, 'PayNow'),
      paymentDetails: clubData.paymentDetails,
      freeCancelHours: clampNumber(clubData.freeCancelHours, 0, 720),
      lockCancelHours: clampNumber(clubData.lockCancelHours, 0, 720),
      lateCancelFeePercent: clampNumber(clubData.lateCancelFeePercent, 0, 100),
      noShowFeePercent: clampNumber(clubData.noShowFeePercent, 0, 100),
      excludeOwnerFromBilling: excludeOwner,
      defaultMatchTargetPoints: targetPoints,
      visibility: clubData.visibility || 'public',
      ownerId,
      ownerPlayerId: assignedPlayerId,
      clubOwnerPlayerId: assignedPlayerId,
      clubOwnerName: assignedPlayerName,
    };

    const nextBillingMap = saveClubBillingRule(
      newClubId,
      excludeOwner,
      targetPoints
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
        freeCancelHours: newClub.freeCancelHours,
        lockCancelHours: newClub.lockCancelHours,
        lateCancelFeePercent: newClub.lateCancelFeePercent,
        noShowFeePercent: newClub.noShowFeePercent,
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
    const newSession: Session = {
      id: newId,
      clubId: targetClubId,
      title: clampString(sessionData.title, 120, 'Badminton Session'),
      venue: clampString(sessionData.venue, 120, 'Badminton Hall'),
      courtNumbers: clampString(sessionData.courtNumbers, 60, 'Court 1'),
      sessionDate: clampString(sessionData.sessionDate, 40, '2026-10-22'),
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

    setSessions((prev) => [newSession, ...prev]);
    setSelectedSessionId(newId);

    if (user) {
      const { id, ...payload } = newSession;
      await safeSetDoc('sessions', id, payload);
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
    guestCount?: number
  ) => {
    if (!enforceRateLimit('tap_rsvp')) return;

    const session = sessions.find((s) => s.id === sessionId);
    if (!session || session.bookingStatus === 'completed') return;
    // Players may only RSVP themselves, in clubs they belong to; club managers may RSVP anyone.
    const isSelfRsvp = Boolean(activePlayer && player.id === activePlayer.id);
    if (
      !canManageClubById(session.clubId) &&
      !(isSelfRsvp && hasPlayerJoinedClub(activePlayer, session.clubId))
    ) {
      return;
    }

    const existingRsvp = rsvps.find(
      (r) => r.sessionId === sessionId && r.playerId === player.id
    );
    const rsvpId = existingRsvp
      ? existingRsvp.id
      : sanitizeId(`rsvp_${sessionId}_${player.id}`);
    const ownerId = user ? user.uid : 'local_club';
    const appliedPct =
      status === 'going'
        ? 100
        : status === 'late_out'
        ? clampNumber(penaltyPercent, 0, 100)
        : 0;

    const resolvedGuestCount =
      status !== 'going'
        ? 0
        : guestCount !== undefined
        ? Math.max(0, Math.min(4, Math.floor(guestCount)))
        : Math.max(0, Math.floor(Number(existingRsvp?.guestCount || 0)));

    setRsvpGuestsMap((prev) => {
      const next = { ...prev, [rsvpId]: resolvedGuestCount };
      saveRsvpGuestsMap(next);
      return next;
    });

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
                attendanceOutcome: 'present',
                penaltyPercentApplied: appliedPct,
                feeShare: 0,
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
          paidStatus: 'unpaid' as const,
          paidMethod: 'pending',
          ownerId,
        },
      ];
    });

    if (user) {
      if (existingRsvp) {
        await safeUpdateDoc('rsvps', rsvpId, {
          status,
          attendanceOutcome: 'present',
          penaltyPercentApplied: appliedPct,
          feeShare: 0,
          paidStatus: existingRsvp.paidStatus,
          paidMethod: existingRsvp.paidMethod,
          playerName: clampString(player.name, 80),
        });
      } else {
        await safeSetDoc('rsvps', rsvpId, {
          clubId: sanitizeId(session.clubId),
          sessionId: sanitizeId(sessionId),
          playerId: sanitizeId(player.id),
          playerName: clampString(player.name, 80),
          status,
          attendanceOutcome: 'present',
          penaltyPercentApplied: appliedPct,
          feeShare: 0,
          paidStatus: 'unpaid',
          paidMethod: 'pending',
          ownerId,
        });
      }
    }
  };

  const handleMarkAttendanceOutcome = async (
    rsvpId: string,
    outcome: AttendanceOutcome
  ) => {
    const currentRsvps = rsvpsRef.current;
    const targetRsvp = currentRsvps.find((r) => r.id === rsvpId);
    if (!targetRsvp) return;
    if (!canManageClubById(targetRsvp.clubId)) return;

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
      const nextAll = currentRsvps.map((r) =>
        r.id === rsvpId
          ? {
              ...r,
              attendanceOutcome: outcome,
              penaltyPercentApplied: nextPenaltyPct,
            }
          : r
      );
      const computedSessionRsvps = nextAll.filter(
        (r) => r.sessionId === session.id
      );
      const computedSplits = computeWeightedSessionSplits(
        session.courtFee,
        session.shuttleFee,
        computedSessionRsvps,
        club.noShowFeePercent,
        {
          clubOwnerPlayerId: club.clubOwnerPlayerId,
          excludeOwnerFromBilling: Boolean(club.excludeOwnerFromBilling),
        }
      );

      const finalRsvps = nextAll.map((r) => {
        if (r.sessionId !== session.id) return r;
        const calc = computedSplits.get(r.id) || {
          feeShare: 0,
          penaltyPercentApplied: 0,
        };
        const isOwnerRow =
          Boolean(club.clubOwnerPlayerId) &&
          r.playerId === club.clubOwnerPlayerId;
        return {
          ...r,
          attendanceOutcome:
            r.id === rsvpId ? outcome : r.attendanceOutcome,
          penaltyPercentApplied: calc.penaltyPercentApplied,
          feeShare: calc.feeShare,
          paidStatus: isOwnerRow ? ('paid' as const) : r.paidStatus,
          paidMethod: isOwnerRow
            ? Boolean(club.excludeOwnerFromBilling)
              ? 'Owner Excluded'
              : 'Club Owner'
            : r.paidMethod,
        };
      });

      rsvpsRef.current = finalRsvps;
      setRsvps(finalRsvps);

      if (user && computedSessionRsvps.length > 0) {
        await safeBatchWrite(
          computedSessionRsvps.map((r): BatchWriteOperation => {
            const calc = computedSplits.get(r.id) || {
              feeShare: 0,
              penaltyPercentApplied: 0,
            };
            const isOwnerRow =
              Boolean(club.clubOwnerPlayerId) &&
              r.playerId === club.clubOwnerPlayerId;
            return {
              type: 'update',
              collectionName: 'rsvps',
              docId: r.id,
              updates: {
                status: r.status,
                attendanceOutcome:
                  r.id === rsvpId ? outcome : r.attendanceOutcome,
                penaltyPercentApplied: calc.penaltyPercentApplied,
                feeShare: calc.feeShare,
                paidStatus: isOwnerRow ? 'paid' : r.paidStatus,
                paidMethod: isOwnerRow
                  ? Boolean(club.excludeOwnerFromBilling)
                    ? 'Owner Excluded'
                    : 'Club Owner'
                  : r.paidMethod,
                playerName: r.playerName,
              },
            };
          })
        );
      }
      return;
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
  };

  const handleUpdateSessionBooking = async (
    sessionId: string,
    updates: {
      bookingStatus: BookingStatus;
      courtFee: number;
      courtNumbers: string;
      maxPlayers: number;
    }
  ) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || !canManageClubById(session.clubId)) return;

    const cleanCourtFee = clampNumber(updates.courtFee, 0, 100000);
    const cleanCourts = clampString(updates.courtNumbers, 60, 'Court 1');
    const cleanMaxPlayers = clampNumber(updates.maxPlayers, 2, 64);
    const nextStatus = updates.bookingStatus;

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
  };

  const handleFinalizeSessionShuttleAndSplit = async (
    sessionId: string,
    bookingStatus: BookingStatus,
    courtFee: number,
    shuttlesUsed: number,
    shuttleUnitCost: number,
    courtNumbers: string,
    finalizeSplit: boolean
  ) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || !canManageClubById(session.clubId)) return;
    if (!enforceRateLimit('finalize_session')) return;

    const cleanCourtFee = clampNumber(courtFee, 0, 100000);
    const cleanShuttlesUsed = clampNumber(shuttlesUsed, 0, 1000);
    const cleanUnitCost = clampNumber(shuttleUnitCost, 0, 1000);
    const cleanShuttleFee = Number(
      (cleanShuttlesUsed * cleanUnitCost).toFixed(2)
    );
    const cleanCourts = clampString(courtNumbers, 60, 'Court 1');

    const club =
      clubs.find((c) => c.id === session.clubId) || activeClub;
    const sessionRsvps = rsvps.filter((r) => r.sessionId === sessionId);

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
      walletsMap: playerWalletsMap,
      finalizeSplit,
      clubOwnerPlayerId: club.clubOwnerPlayerId,
      excludeOwnerFromBilling: Boolean(club.excludeOwnerFromBilling),
    });

    const settledById = new Map(
      walletSettlement.updatedSessionRsvps.map((r) => [r.id, r])
    );

    if (finalizeSplit) {
      savePlayerWalletsMap(walletSettlement.updatedWalletsMap);
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
      await safeBatchWrite([
        {
          type: 'update',
          collectionName: 'sessions',
          docId: sessionId,
          updates: {
            bookingStatus,
            courtFee: cleanCourtFee,
            shuttlesUsed: cleanShuttlesUsed,
            shuttleUnitCost: cleanUnitCost,
            shuttleFee: cleanShuttleFee,
            courtNumbers: cleanCourts,
            feeSplitFinalized: finalizeSplit,
          },
        },
        ...walletSettlement.updatedSessionRsvps.map(
          (rsvp): BatchWriteOperation => ({
            type: 'update',
            collectionName: 'rsvps',
            docId: rsvp.id,
            updates: {
              status: rsvp.status,
              attendanceOutcome: rsvp.attendanceOutcome,
              penaltyPercentApplied: rsvp.penaltyPercentApplied,
              feeShare: rsvp.feeShare,
              paidStatus: rsvp.paidStatus,
              paidMethod: rsvp.paidMethod,
              playerName: rsvp.playerName,
            },
          })
        ),
      ]);
    }
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

    // Automatically settle any existing unpaid/pending RSVPs for this member in THIS club using their updated waiver, passes, or credit
    const settled = settlePlayerExistingUnpaidRsvpsWithWallet({
      playerId,
      clubId: resolvedClubId,
      wallet: updatedWallet,
      rsvps,
      sessions,
    });

    const finalMap = savePlayerWalletsMap({
      ...playerWalletsMap,
      [walletKey]: settled.remainingWallet,
    });
    setPlayerWalletsMap(finalMap);

    if (settled.modifiedRsvps.length > 0) {
      setRsvps(settled.updatedRsvps);

      if (user) {
        await safeBatchWrite(
          settled.modifiedRsvps.map(
            (r): BatchWriteOperation => ({
              type: 'update',
              collectionName: 'rsvps',
              docId: r.id,
              updates: {
                status: r.status,
                attendanceOutcome: r.attendanceOutcome,
                penaltyPercentApplied: r.penaltyPercentApplied,
                feeShare: r.feeShare,
                paidStatus: r.paidStatus,
                paidMethod: r.paidMethod,
                playerName: r.playerName,
              },
            })
          )
        );
      }
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
        status: target.status,
        attendanceOutcome: target.attendanceOutcome,
        penaltyPercentApplied: target.penaltyPercentApplied,
        feeShare: target.feeShare,
        paidStatus: 'pending_approval',
        paidMethod: cleanMethod,
        playerName: target.playerName,
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
              status: target.status,
              attendanceOutcome: target.attendanceOutcome,
              penaltyPercentApplied: target.penaltyPercentApplied,
              feeShare: target.feeShare,
              paidStatus: 'pending_approval',
              paidMethod: cleanMethod,
              playerName: target.playerName,
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
  }) => {
    const matchSession = sessions.find((s) => s.id === matchData.sessionId);
    if (!matchSession || !canManageClubById(matchSession.clubId)) return;
    // Every player in the match must have joined (RSVP'd going to) this session
    const sessionGoingIds = new Set(
      rsvps
        .filter((r) => r.sessionId === matchSession.id && r.status === 'going')
        .map((r) => r.playerId)
    );
    const matchPlayerIds = [
      matchData.teamAPlayer1.id,
      matchData.teamBPlayer1.id,
      ...(matchData.matchFormat === 'doubles'
        ? [matchData.teamAPlayer2?.id, matchData.teamBPlayer2?.id]
        : []),
    ];
    if (
      matchPlayerIds.some((id) => !id || !sessionGoingIds.has(id)) ||
      new Set(matchPlayerIds).size !== matchPlayerIds.length
    ) {
      return;
    }
    if (!enforceRateLimit('record_match')) return;

    const matchId = sanitizeId(`match_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const winnerSide =
      matchData.scoreTeamA >= matchData.scoreTeamB ? 'A' : 'B';

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
      scoreTeamA: clampNumber(matchData.scoreTeamA, 0, 500),
      scoreTeamB: clampNumber(matchData.scoreTeamB, 0, 500),
      setScoresText: clampString(matchData.setScoresText, 60, '21-17'),
      winnerSide,
      ownerId,
    };

    const teamAIds = getMatchSidePlayers(newMatch, 'A').map((p) => p.id);
    const teamBIds = getMatchSidePlayers(newMatch, 'B').map((p) => p.id);

    const pointDiff = Math.abs(newMatch.scoreTeamA - newMatch.scoreTeamB);
    const ratingDelta = Math.min(36, 16 + Math.round(pointDiff * 0.8));

    // Optimistic state update -> zero stutter
    setMatches((prev) => [newMatch, ...prev]);
    setPlayers((prev) =>
      prev.map((p) => {
        const inA = teamAIds.includes(p.id);
        const inB = teamBIds.includes(p.id);
        if (!inA && !inB) return p;

        const won =
          (inA && winnerSide === 'A') || (inB && winnerSide === 'B');
        const ptsFor = inA ? newMatch.scoreTeamA : newMatch.scoreTeamB;
        const ptsAgainst = inA ? newMatch.scoreTeamB : newMatch.scoreTeamA;

        return {
          ...p,
          wins: (p.wins || 0) + (won ? 1 : 0),
          losses: (p.losses || 0) + (won ? 0 : 1),
          gamesPlayed: (p.gamesPlayed || 0) + 1,
          pointsScored: (p.pointsScored || 0) + ptsFor,
          pointsConceded: (p.pointsConceded || 0) + ptsAgainst,
          singlesWins:
            (p.singlesWins || 0) +
            (newMatch.matchFormat === 'singles' && won ? 1 : 0),
          singlesLosses:
            (p.singlesLosses || 0) +
            (newMatch.matchFormat === 'singles' && !won ? 1 : 0),
          doublesWins:
            (p.doublesWins || 0) +
            (newMatch.matchFormat === 'doubles' && won ? 1 : 0),
          doublesLosses:
            (p.doublesLosses || 0) +
            (newMatch.matchFormat === 'doubles' && !won ? 1 : 0),
          ratingScore: clampNumber(
            (p.ratingScore || 1200) +
              (won ? ratingDelta : -Math.round(ratingDelta * 0.75)),
            800,
            3000
          ),
        };
      })
    );

    if (user) {
      const { id, ...payload } = newMatch;
      const involvedPlayers = players.filter(
        (p) => teamAIds.includes(p.id) || teamBIds.includes(p.id)
      );
      await safeBatchWrite([
        {
          type: 'set',
          collectionName: 'matches',
          docId: id,
          data: payload,
        },
        ...involvedPlayers.map((p): BatchWriteOperation => {
          const inA = teamAIds.includes(p.id);
          const inB = teamBIds.includes(p.id);
          const won =
            (inA && winnerSide === 'A') || (inB && winnerSide === 'B');
          const ptsFor = inA ? newMatch.scoreTeamA : newMatch.scoreTeamB;
          const ptsAgainst = inA ? newMatch.scoreTeamB : newMatch.scoreTeamA;

          return {
            type: 'update',
            collectionName: 'players',
            docId: p.id,
            updates: {
              // Lets the rules verify these stats come from this recorded match
              lastMatchId: id,
              wins: (p.wins || 0) + (won ? 1 : 0),
              losses: (p.losses || 0) + (won ? 0 : 1),
              gamesPlayed: (p.gamesPlayed || 0) + 1,
              pointsScored: (p.pointsScored || 0) + ptsFor,
              pointsConceded: (p.pointsConceded || 0) + ptsAgainst,
              singlesWins:
                (p.singlesWins || 0) +
                (newMatch.matchFormat === 'singles' && won ? 1 : 0),
              singlesLosses:
                (p.singlesLosses || 0) +
                (newMatch.matchFormat === 'singles' && !won ? 1 : 0),
              doublesWins:
                (p.doublesWins || 0) +
                (newMatch.matchFormat === 'doubles' && won ? 1 : 0),
              doublesLosses:
                (p.doublesLosses || 0) +
                (newMatch.matchFormat === 'doubles' && !won ? 1 : 0),
              ratingScore: clampNumber(
                (p.ratingScore || 1200) +
                  (won ? ratingDelta : -Math.round(ratingDelta * 0.75)),
                800,
                3000
              ),
            },
          };
        }),
      ]);
    }
  };

  const handleDeleteMatch = async (matchId: string) => {
    const target = matches.find((m) => m.id === matchId);
    if (!target || !canManageClubById(target.clubId)) return;
    if (!enforceRateLimit('delete_match')) return;

    const teamAIds = getMatchSidePlayers(target, 'A').map((p) => p.id);
    const teamBIds = getMatchSidePlayers(target, 'B').map((p) => p.id);
    const pointDiff = Math.abs(target.scoreTeamA - target.scoreTeamB);
    const ratingDelta = Math.min(36, 16 + Math.round(pointDiff * 0.8));

    setMatches((prev) => prev.filter((m) => m.id !== matchId));
    setPlayers((prev) =>
      prev.map((p) => {
        const inA = teamAIds.includes(p.id);
        const inB = teamBIds.includes(p.id);
        if (!inA && !inB) return p;

        const won =
          (inA && target.winnerSide === 'A') ||
          (inB && target.winnerSide === 'B');
        const ptsFor = inA ? target.scoreTeamA : target.scoreTeamB;
        const ptsAgainst = inA ? target.scoreTeamB : target.scoreTeamA;

        return {
          ...p,
          wins: Math.max(0, p.wins - (won ? 1 : 0)),
          losses: Math.max(0, p.losses - (won ? 0 : 1)),
          gamesPlayed: Math.max(0, p.gamesPlayed - 1),
          pointsScored: Math.max(0, p.pointsScored - ptsFor),
          pointsConceded: Math.max(0, p.pointsConceded - ptsAgainst),
          singlesWins: Math.max(
            0,
            p.singlesWins -
              (target.matchFormat === 'singles' && won ? 1 : 0)
          ),
          singlesLosses: Math.max(
            0,
            p.singlesLosses -
              (target.matchFormat === 'singles' && !won ? 1 : 0)
          ),
          doublesWins: Math.max(
            0,
            p.doublesWins -
              (target.matchFormat === 'doubles' && won ? 1 : 0)
          ),
          doublesLosses: Math.max(
            0,
            p.doublesLosses -
              (target.matchFormat === 'doubles' && !won ? 1 : 0)
          ),
          ratingScore: clampNumber(
            p.ratingScore -
              (won ? ratingDelta : -Math.round(ratingDelta * 0.75)),
            800,
            3000
          ),
        };
      })
    );

    if (user) {
      await safeDeleteDoc('matches', matchId);
    }
  };

  // Errors are surfaced by the auth screen (describeAuthError)
  const handleGoogleSignIn = async () => {
    setAuthErrorMessage(null);
    await signInWithGooglePopup();
  };

  const invitedClubForGate = pendingInviteClubId
    ? clubs.find((c) => c.id === pendingInviteClubId) || null
    : null;

  if (!authReady || (user && isUserVerified && !playersLoaded)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xs font-semibold text-slate-500">
        Loading CourtPulse…
      </div>
    );
  }

  if (!user && !devSession) {
    return (
      <AuthGateScreen
        invitedClub={invitedClubForGate}
        onSignInWithGoogle={handleGoogleSignIn}
        onDevLogin={handleDevLogin}
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
        accountName={user?.displayName || devSession?.name || ''}
        accountEmail={user?.email || devSession?.email || ''}
        unclaimedPlayers={players.filter((p) => !p.authUid)}
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

                      {!user && devSession && (
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
                                  {persona.role === 'admin'
                                    ? 'Admin'
                                    : persona.role === 'club_owner'
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
                  ? `Active Club: ${activeClub?.name || 'Badminton Club'}`
                  : activeTab === 'users'
                  ? `Directory & Member Ledger · ${activeClub?.name || 'Badminton Club'}`
                  : activeTab === 'gear'
                  ? `Gear Locker · ${currentLockerPlayer?.name ?? activePlayer.name}`
                  : activeTab === 'settings'
                  ? `Personal Settings · ${activePlayer.name}`
                  : activeTab === 'profile'
                  ? `Player Profile · ${activePlayer.name}`
                  : effectiveClubId === 'none'
                  ? 'No club joined yet'
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
                  You haven&apos;t joined any clubs yet
                </p>
                <p className="text-xs text-slate-600">
                  Sessions and standings appear here once you join a club. Public clubs can be
                  joined instantly; private clubs need owner approval.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('clubs')}
                  className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer shadow-xs"
                >
                  Browse Clubs
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
                    isAdmin={canManageClubById(sessionClub.id)}
                    permissionTier={effectiveTier}
                    canManageClub={isOwnerOfClubById(sessionClub.id)}
                    initialOpenPayInfo={openPayInfoOnLedger}
                    onConsumeInitialOpenPayInfo={() =>
                      setOpenPayInfoOnLedger(false)
                    }
                    onTapRsvp={handleTapRsvp}
                    onMarkAttendanceOutcome={handleMarkAttendanceOutcome}
                    onUpdateSessionBooking={handleUpdateSessionBooking}
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
                canManageClub={isOwnerOfClubById(activeClub.id)}
                isOwnerOfClubById={isOwnerOfClubById}
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
                permissionTier={effectiveTier}
                canManageActiveClub={canManageActiveClub}
                onSelectClub={setActiveClubId}
                onJoinClub={(clubId) => {
                  setClubJoinModalClubId(clubId);
                  return Promise.resolve();
                }}
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
                    activePlayer={activePlayer}
                    permissionTier={effectiveTier}
                    onAdminCreateUser={handleAdminCreateUser}
                    onAdminUpdateUser={handleAdminUpdateUser}
                    onAdminDeleteUser={handleAdminDeleteUser}
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
                joinedClubs={userJoinedClubs}
                permissionTier={effectiveTier}
                onUpdateOwnProfile={handleUpdateOwnProfile}
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
        } items-center h-16 px-1 shadow-lg`}
      >
        <button
          type="button"
          onClick={() => setActiveTab('sessions')}
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
          onClick={() => setActiveTab('leaderboard')}
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
          onClick={() => setActiveTab('clubs')}
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
            onClick={() => setActiveTab('users')}
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
