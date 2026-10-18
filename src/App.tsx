/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, onSnapshot, query } from 'firebase/firestore';
import {
  Award,
  Building2,
  Calendar,
  ChevronDown,
  LogOut,
  Receipt,
  Settings,
  Swords,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  auth,
  clampNumber,
  clampString,
  db,
  handleFirestoreError,
  OperationType,
  safeDeleteDoc,
  safeSetDoc,
  safeUpdateDoc,
  sanitizeId,
  signInWithGooglePopup,
  signOutUser,
} from './firebase';
import {
  AttendanceOutcome,
  BadmintonMatch,
  BookingStatus,
  CachedPlayerIdentity,
  Club,
  ClubPaymentDetails,
  MatchFormat,
  PermissionTier,
  Player,
  PlayerBenefitWallet,
  RsvpStatus,
  Session,
  SessionRsvp,
} from './types';
import {
  ADMIN_EMAIL,
  applyWalletsToFinalizedSessionRsvps,
  calculateOutstandingBalancesForPlayer,
  computePlayerLeaderboardAndTiers,
  computeWeightedSessionSplits,
  formatClubPaymentInfo,
  getPlayerJoinedClubIds,
  hasPlayerJoinedClub,
  INITIAL_CLUBS,
  INITIAL_MATCHES,
  INITIAL_PLAYERS,
  INITIAL_RSVPS,
  INITIAL_SESSIONS,
  loadCachedPlayerIdentity,
  loadClubBillingRulesMap,
  loadClubOwnerMap,
  loadClubPaymentDetailsMap,
  loadPlayerWalletsMap,
  LOCAL_STATE_STORAGE_KEY,
  parseClubPaymentDetails,
  parseSharedSessionFromUrlParams,
  saveCachedPlayerIdentity,
  saveClubBillingRule,
  saveClubOwnerAssignment,
  saveClubPaymentDetails,
  savePlayerWalletsMap,
  settlePlayerExistingUnpaidRsvpsWithWallet,
} from './utils/badmintonLogic';
import { checkAndConsumeRateLimit } from './utils/rateLimiter';
import { SegmentedControl, StyledSelect } from './components/ui/FormControls';
import {
  AuthGateScreen,
  ClubJoinPromptModal,
} from './components/AuthGateAndClubJoinModal';
import { AdminClubAndPolicySettings } from './components/AdminClubAndPolicySettings';
import { PaymentRequestBannerAndModal } from './components/PaymentRequestBannerAndModal';
import { SessionsOverviewAndQuickOrganize } from './components/SessionsOverviewAndQuickOrganize';
import { TapRsvpPortal } from './components/TapRsvpPortal';
import { MatchScorerAndCourtView } from './components/MatchScorerAndCourtView';
import { LeaderboardAndTierView } from './components/LeaderboardAndTierView';
import { FeeLedgerAndSplitView } from './components/FeeLedgerAndSplitView';
import { SiteAdminUserManagement } from './components/SiteAdminUserManagement';
import { PlayerProfileAndHistoryView } from './components/PlayerProfileAndHistoryView';
import { SettingsView } from './components/SettingsView';

type ActiveTab =
  | 'sessions'
  | 'rsvp'
  | 'matches'
  | 'leaderboard'
  | 'profile'
  | 'ledger'
  | 'clubs'
  | 'users'
  | 'settings';

const CREDENTIALS_STORAGE_KEY = 'courtpulse_account_passwords_v3';

function loadAccountPasswords(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CREDENTIALS_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as Record<string, string>;
    }
  } catch {
    // ignore
  }
  return {};
}

function saveAccountPassword(playerKey: string, password: string) {
  try {
    const current = loadAccountPasswords();
    current[playerKey.toLowerCase()] = password;
    localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
}

function isAdminPlayerOrEmail(nameOrEmail: string, playerId?: string): boolean {
  const clean = nameOrEmail.trim().toLowerCase();
  return (
    playerId === 'player_alex' ||
    clean === ADMIN_EMAIL.toLowerCase() ||
    clean === 'alex tan' ||
    clean === 'admin'
  );
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
  const [authReady, setAuthReady] = useState<boolean>(false);

  const [clubOwnerMap, setClubOwnerMap] = useState<
    Record<string, { playerId: string; playerName: string }>
  >(() => loadClubOwnerMap());

  const [clubPaymentMap, setClubPaymentMap] = useState<
    Record<string, ClubPaymentDetails>
  >(() => loadClubPaymentDetailsMap());

  const [clubBillingRulesMap, setClubBillingRulesMap] = useState<
    Record<string, { excludeOwnerFromBilling: boolean }>
  >(() => loadClubBillingRulesMap());

  const [playerWalletsMap, setPlayerWalletsMap] = useState<
    Record<string, PlayerBenefitWallet>
  >(() => loadPlayerWalletsMap());

  const [rawClubs, setRawClubs] = useState<Club[]>(initialLocal.clubs);
  const [sessions, setSessions] = useState<Session[]>(initialLocal.sessions);
  const [rawPlayers, setPlayers] = useState<Player[]>(initialLocal.players);
  const [rsvps, setRsvps] = useState<SessionRsvp[]>(initialLocal.rsvps);
  const rsvpsRef = useRef<SessionRsvp[]>(initialLocal.rsvps);
  rsvpsRef.current = rsvps;
  const [matches, setMatches] = useState<BadmintonMatch[]>(initialLocal.matches);

  // Enrich players with their persistent Credit Balance, Free Session Passes, and Fee Waiver flags
  const players = useMemo<Player[]>(() => {
    return rawPlayers.map((p) => {
      const w = playerWalletsMap[p.id];
      return {
        ...p,
        creditBalance: w
          ? w.creditBalance
          : Math.max(0, Number(p.creditBalance || 0)),
        freeSessionPasses: w
          ? w.freeSessionPasses
          : Math.max(0, Math.floor(Number(p.freeSessionPasses || 0))),
        waiveAllFees: w ? Boolean(w.waiveAllFees) : Boolean(p.waiveAllFees),
      };
    });
  }, [rawPlayers, playerWalletsMap]);

  const [signedInIdentity, setSignedInIdentity] =
    useState<CachedPlayerIdentity | null>(() => loadCachedPlayerIdentity());

  const [permissionTier, setPermissionTier] = useState<PermissionTier>(() => {
    const cached = loadCachedPlayerIdentity();
    if (cached?.permissionTier) return cached.permissionTier;
    return cached?.isAdminAccount ? 'admin' : 'user';
  });

  const [rateLimitNotice, setRateLimitNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('sessions');
  const [inspectedPlayerId, setInspectedPlayerId] = useState<string | null>(
    null
  );
  const [activeClubId, setActiveClubId] = useState<string>('all');
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    initialLocal.sessions[0]?.id || 'session_oct22_upcoming'
  );
  const [openPayInfoOnLedger, setOpenPayInfoOnLedger] =
    useState<boolean>(false);

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
      const mapped = clubOwnerMap[c.id];
      const ownerPlayerId =
        mapped?.playerId || c.clubOwnerPlayerId || 'player_alex';
      const ownerPlayer = players.find((p) => p.id === ownerPlayerId);
      const ownerName =
        ownerPlayer?.name || mapped?.playerName || c.clubOwnerName || 'Alex Tan';
      const resolvedPaymentDetails =
        clubPaymentMap[c.id] ||
        c.paymentDetails ||
        parseClubPaymentDetails(c.paymentInfo, ownerName);
      const billingRule = clubBillingRulesMap[c.id];
      const excludeOwnerFromBilling =
        billingRule !== undefined
          ? Boolean(billingRule.excludeOwnerFromBilling)
          : Boolean(c.excludeOwnerFromBilling);
      return {
        ...c,
        clubOwnerPlayerId: ownerPlayerId,
        clubOwnerName: ownerName,
        paymentDetails: resolvedPaymentDetails,
        excludeOwnerFromBilling,
      };
    });
  }, [rawClubs, clubOwnerMap, clubPaymentMap, clubBillingRulesMap, players]);

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
      if (currentUser) {
        const isBootstrappedAdmin = isAdminPlayerOrEmail(
          currentUser.email || currentUser.displayName || ''
        );
        if (isBootstrappedAdmin) {
          setPermissionTier('admin');
        }
        setSignedInIdentity((prev) => {
          if (prev) {
            if (isBootstrappedAdmin && !prev.isAdminAccount) {
              const elevated: CachedPlayerIdentity = {
                ...prev,
                isAdminAccount: true,
                permissionTier: 'admin',
              };
              saveCachedPlayerIdentity(elevated);
              return elevated;
            }
            return prev;
          }
          const matchedByDisplayName = currentUser.displayName
            ? players.find(
                (p) =>
                  p.name.toLowerCase() ===
                  currentUser.displayName!.trim().toLowerCase()
              )
            : undefined;
          const fallbackPlayer =
            matchedByDisplayName ||
            (isBootstrappedAdmin ? players[0] : players[1] || players[0]);
          if (!fallbackPlayer) return null;
          const nextTier: PermissionTier = isBootstrappedAdmin
            ? 'admin'
            : 'user';
          const nextIdentity: CachedPlayerIdentity = {
            playerId: fallbackPlayer.id,
            name: fallbackPlayer.name,
            playerTag: fallbackPlayer.playerTag,
            linkedAccountEmail: currentUser.email || undefined,
            isAdminAccount: isBootstrappedAdmin,
            permissionTier: nextTier,
            lastRecognizedAt: new Date().toISOString(),
          };
          saveCachedPlayerIdentity(nextIdentity);
          return nextIdentity;
        });
      }
    });
    return () => unsubscribe();
  }, [players]);

  useEffect(() => {
    if (!authReady || !user) return;

    const uid = user.uid;

    const clubsQuery = query(collection(db, 'clubs'));
    const sessionsQuery = query(collection(db, 'sessions'));
    const playersQuery = query(collection(db, 'players'));
    const rsvpsQuery = query(collection(db, 'rsvps'));
    const matchesQuery = query(collection(db, 'matches'));

    const unsubClubs = onSnapshot(
      clubsQuery,
      async (snap) => {
        if (snap.empty && !hasSeededCloudRef.current) {
          hasSeededCloudRef.current = true;
          await seedInitialClubDataToFirestore(uid);
          return;
        }
        const docs: Club[] = snap.docs.map((d) => ({
          ...(d.data() as Omit<Club, 'id'>),
          id: d.id,
        }));
        if (docs.length > 0) {
          setRawClubs(docs);
        }
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
        if (docs.length > 0) {
          setSessions(docs);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'sessions')
    );

    const unsubPlayers = onSnapshot(
      playersQuery,
      (snap) => {
        const docs: Player[] = snap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            ...(raw as unknown as Omit<Player, 'id'>),
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
        if (docs.length > 0) {
          setPlayers(docs);
        }
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
        if (docs.length > 0) {
          setRsvps(docs);
        }
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
        if (docs.length > 0) {
          setMatches(docs);
        }
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
  }, [authReady, user]);

  async function seedInitialClubDataToFirestore(uid: string) {
    await Promise.all([
      ...INITIAL_CLUBS.map((c) =>
        safeSetDoc('clubs', c.id, {
          name: clampString(c.name, 100),
          description: clampString(c.description, 200),
          paymentInfo: clampString(c.paymentInfo, 160),
          freeCancelHours: clampNumber(c.freeCancelHours, 0, 720),
          lockCancelHours: clampNumber(c.lockCancelHours, 0, 720),
          lateCancelFeePercent: clampNumber(c.lateCancelFeePercent, 0, 100),
          noShowFeePercent: clampNumber(c.noShowFeePercent, 0, 100),
          ownerId: uid,
        })
      ),
      ...INITIAL_SESSIONS.map((s) =>
        safeSetDoc('sessions', s.id, {
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
        })
      ),
      ...INITIAL_PLAYERS.map((p) =>
        safeSetDoc('players', p.id, {
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
        })
      ),
      ...INITIAL_RSVPS.map((r) =>
        safeSetDoc('rsvps', r.id, {
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
        })
      ),
      ...INITIAL_MATCHES.map((m) =>
        safeSetDoc('matches', m.id, {
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
        })
      ),
    ]);
  }

  const activePlayer = useMemo(() => {
    if (!signedInIdentity) return null;
    return (
      players.find((p) => p.id === signedInIdentity.playerId) ||
      players[0] ||
      null
    );
  }, [players, signedInIdentity]);

  const isAdminAccount = useMemo(() => {
    return Boolean(
      signedInIdentity?.isAdminAccount ||
        (user?.email && isAdminPlayerOrEmail(user.email)) ||
        (activePlayer && isAdminPlayerOrEmail(activePlayer.name, activePlayer.id))
    );
  }, [signedInIdentity, user, activePlayer]);

  // Effective permission tier: only Site Admin account can use 'admin' tier
  const effectiveTier: PermissionTier = useMemo(() => {
    if (permissionTier === 'admin' && !isAdminAccount) {
      return 'club_owner';
    }
    return permissionTier;
  }, [permissionTier, isAdminAccount]);

  const userJoinedClubs = useMemo(() => {
    if (effectiveTier === 'admin') return clubs;
    const joinedIds = getPlayerJoinedClubIds(activePlayer);
    const filtered = clubs.filter(
      (c) =>
        joinedIds.includes(c.id) ||
        (activePlayer && c.clubOwnerPlayerId === activePlayer.id)
    );
    return filtered.length > 0 ? filtered : [clubs[0]].filter(Boolean);
  }, [clubs, activePlayer, effectiveTier]);

  const unjoinedClubs = useMemo(() => {
    const joinedIds = getPlayerJoinedClubIds(activePlayer);
    return clubs.filter(
      (c) =>
        !joinedIds.includes(c.id) &&
        (!activePlayer || c.clubOwnerPlayerId !== activePlayer.id)
    );
  }, [clubs, activePlayer]);

  const activeClub = useMemo(() => {
    if (activeClubId === 'all') {
      return userJoinedClubs[0] || clubs[0];
    }
    return (
      userJoinedClubs.find((c) => c.id === activeClubId) ||
      userJoinedClubs[0] ||
      clubs[0]
    );
  }, [userJoinedClubs, activeClubId, clubs]);

  const joinedClubIdSet = useMemo(
    () => new Set(userJoinedClubs.map((c) => c.id)),
    [userJoinedClubs]
  );

  // Does the current user have management rights over the active club?
  // - Site Admin ('admin') can manage any club
  // - Club Owner ('club_owner') can manage the club if they own it (or if they are previewing Club Owner mode as Site Admin)
  const canManageActiveClub = useMemo(() => {
    if (effectiveTier === 'admin') return true;
    if (effectiveTier === 'club_owner') {
      if (isAdminAccount) return true;
      if (activeClubId === 'all') {
        return Boolean(
          activePlayer &&
            userJoinedClubs.some((c) => c.clubOwnerPlayerId === activePlayer.id)
        );
      }
      return Boolean(
        activePlayer &&
          activeClub &&
          activeClub.clubOwnerPlayerId === activePlayer.id
      );
    }
    return false;
  }, [
    effectiveTier,
    isAdminAccount,
    activePlayer,
    activeClub,
    activeClubId,
    userJoinedClubs,
  ]);

  // Only the Sessions overview needs the "All Clubs" combined feed option.
  // Club-specific pages (RSVP, Matches, Standings, Session Ledger) scope to activeClub.
  const isAllClubsAllowedOnTab = activeTab === 'sessions';
  const showTopClubSelectorOnTab =
    activeTab === 'sessions' ||
    activeTab === 'rsvp' ||
    activeTab === 'matches' ||
    activeTab === 'leaderboard' ||
    activeTab === 'ledger';

  const effectiveClubId =
    isAllClubsAllowedOnTab && activeClubId === 'all'
      ? 'all'
      : activeClub?.id || 'club_bintang_prime';

  const clubSessions = useMemo(
    () =>
      effectiveClubId === 'all'
        ? sessions.filter((s) => joinedClubIdSet.has(s.clubId))
        : sessions.filter((s) => s.clubId === activeClub?.id),
    [sessions, activeClub, effectiveClubId, joinedClubIdSet]
  );

  const clubRsvps = useMemo(
    () =>
      effectiveClubId === 'all'
        ? rsvps.filter((r) => joinedClubIdSet.has(r.clubId))
        : rsvps.filter((r) => r.clubId === activeClub?.id),
    [rsvps, activeClub, effectiveClubId, joinedClubIdSet]
  );

  const clubMatches = useMemo(
    () =>
      effectiveClubId === 'all'
        ? matches.filter((m) => joinedClubIdSet.has(m.clubId))
        : matches.filter((m) => m.clubId === activeClub?.id),
    [matches, activeClub, effectiveClubId, joinedClubIdSet]
  );

  const clubPlayers = useMemo(
    () =>
      effectiveClubId === 'all'
        ? players.filter((p) =>
            userJoinedClubs.some((c) => hasPlayerJoinedClub(p, c.id))
          )
        : players.filter((p) =>
            hasPlayerJoinedClub(p, activeClub?.id || 'club_bintang_prime')
          ),
    [players, activeClub, effectiveClubId, userJoinedClubs]
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

  useEffect(() => {
    if (!activePlayer || !pendingInviteClubId) return;
    const targetClub = clubs.find((c) => c.id === pendingInviteClubId);
    if (!targetClub) return;

    const alreadyJoined = hasPlayerJoinedClub(activePlayer, targetClub.id);

    if (pendingInviteSessionId) {
      // Direct session invite link: ensure club & session are selected and go straight to the RSVP Join page
      if (!alreadyJoined) {
        const nextClubIds = Array.from(
          new Set([...getPlayerJoinedClubIds(activePlayer), targetClub.id])
        );
        const updatedCsv = clampString(nextClubIds.join(','), 400);
        setPlayers((prev) =>
          prev.map((p) =>
            p.id === activePlayer.id ? { ...p, joinedClubIdsCsv: updatedCsv } : p
          )
        );
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

  const handleSetTier = (nextTier: PermissionTier) => {
    setPermissionTier(nextTier);
    if (nextTier !== 'admin' && activeTab === 'users') {
      setActiveTab('sessions');
    }
    if (signedInIdentity) {
      const updated = { ...signedInIdentity, permissionTier: nextTier };
      setSignedInIdentity(updated);
      saveCachedPlayerIdentity(updated);
    }
  };

  const completePlayerSignIn = (player: Player, isAccountAdmin: boolean) => {
    const ownsAClub = clubs.some((c) => c.clubOwnerPlayerId === player.id);
    const initialTier: PermissionTier = isAccountAdmin
      ? 'admin'
      : ownsAClub
      ? 'club_owner'
      : 'user';

    const identity: CachedPlayerIdentity = {
      playerId: player.id,
      name: player.name,
      playerTag: player.playerTag,
      linkedAccountEmail: user?.email || undefined,
      isAdminAccount: isAccountAdmin,
      permissionTier: initialTier,
      lastRecognizedAt: new Date().toISOString(),
    };
    setSignedInIdentity(identity);
    saveCachedPlayerIdentity(identity);
    setPermissionTier(initialTier);

    const joinedIds = getPlayerJoinedClubIds(player);
    if (pendingInviteClubId) {
      setActiveClubId(pendingInviteClubId);
    } else if (
      activeClubId !== 'all' &&
      joinedIds.length > 0 &&
      !joinedIds.includes(activeClubId)
    ) {
      setActiveClubId('all');
    }

    if (pendingInviteSessionId) {
      setSelectedSessionId(pendingInviteSessionId);
      setActiveTab('rsvp');
    }
  };

  const handleSignInWithCredentials = (
    nameInput: string,
    passwordInput: string
  ): { ok: boolean; error?: string } => {
    const q = nameInput.trim().toLowerCase();
    const matchedPlayer =
      players.find(
        (p) =>
          p.name.toLowerCase() === q ||
          p.playerTag.toLowerCase() === q ||
          (q === 'admin' && p.id === 'player_alex') ||
          (q === ADMIN_EMAIL.toLowerCase() && p.id === 'player_alex')
      ) || null;

    if (!matchedPlayer) {
      return {
        ok: false,
        error: 'Account not found. Check your name or register.',
      };
    }

    const storedPasswords = loadAccountPasswords();
    const key = matchedPlayer.name.toLowerCase();
    const existingPwd = storedPasswords[key];

    if (existingPwd && existingPwd !== passwordInput) {
      return {
        ok: false,
        error: 'Incorrect password for this account.',
      };
    }

    if (!existingPwd) {
      saveAccountPassword(key, passwordInput);
    }

    const adminFlag = isAdminPlayerOrEmail(nameInput, matchedPlayer.id);
    completePlayerSignIn(matchedPlayer, adminFlag);
    return { ok: true };
  };

  const handleRegisterNewAccount = async (name: string, password: string) => {
    if (!enforceRateLimit('register_player')) return;

    const cleanName = clampString(name, 80, 'New Player');
    const existing = players.find(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (existing) {
      saveAccountPassword(existing.name, password);
      const adminFlag = isAdminPlayerOrEmail(existing.name, existing.id);
      completePlayerSignIn(existing, adminFlag);
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
    const playerTag = `${shortPrefix}#${randomPin}`;
    const defaultClubId =
      pendingInviteClubId || clubs[0]?.id || 'club_bintang_prime';

    const newPlayer: Player = {
      id: newId,
      name: cleanName,
      playerTag: clampString(playerTag, 40),
      joinedClubIdsCsv: clampString(defaultClubId, 400),
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

    saveAccountPassword(cleanName, password);
    setPlayers((prev) => [...prev, newPlayer]);

    if (user) {
      const { id, ...payload } = newPlayer;
      void safeSetDoc('players', id, payload);
    }

    const adminFlag = isAdminPlayerOrEmail(cleanName, newPlayer.id);
    completePlayerSignIn(newPlayer, adminFlag);
    setClubJoinModalClubId(defaultClubId);
  };

  const handleAcceptJoinClub = async (clubId: string) => {
    if (!activePlayer) return;
    const currentClubs = getPlayerJoinedClubIds(activePlayer);
    const nextClubs = Array.from(new Set([...currentClubs, clubId]));
    const nextCsv = clampString(nextClubs.join(','), 400, clubId);

    setPlayers((prev) =>
      prev.map((p) =>
        p.id === activePlayer.id ? { ...p, joinedClubIdsCsv: nextCsv } : p
      )
    );
    setActiveClubId(clubId);
    setClubJoinModalClubId(null);

    if (user) {
      await safeUpdateDoc('players', activePlayer.id, {
        name: activePlayer.name,
        playerTag: activePlayer.playerTag,
        joinedClubIdsCsv: nextCsv,
      });
    }
  };

  const handleAdminAddMemberToClub = async (name: string) => {
    if (!canManageActiveClub || !activeClub) return;
    const cleanName = clampString(name, 80, 'Member');
    const existing = players.find(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (existing) {
      const currentIds = getPlayerJoinedClubIds(existing);
      const nextCsv = clampString(
        Array.from(new Set([...currentIds, activeClub.id])).join(','),
        400,
        activeClub.id
      );
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === existing.id
            ? {
                ...p,
                joinedClubIdsCsv: nextCsv,
              }
            : p
        )
      );
      if (user) {
        await safeUpdateDoc('players', existing.id, {
          name: existing.name,
          playerTag: existing.playerTag,
          joinedClubIdsCsv: nextCsv,
        });
      }
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
      joinedClubIdsCsv: clampString(activeClub.id, 400),
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
    // Enforce: 1 club per Club Owner
    const alreadyOwned = clubs.find(
      (c) => c.id !== clubId && c.clubOwnerPlayerId === ownerPlayerId
    );
    if (alreadyOwned) return;
    const ownerPlayer = players.find((p) => p.id === ownerPlayerId);
    const ownerName = ownerPlayer?.name || 'Club Owner';
    const nextMap = saveClubOwnerAssignment(clubId, ownerPlayerId, ownerName);
    setClubOwnerMap(nextMap);
  };

  const handleAdminCreateUser = async (data: {
    name: string;
    ratingScore: number;
    clubIds: string[];
  }) => {
    if (effectiveTier !== 'admin') return;
    const cleanName = clampString(data.name, 80, 'Player');
    const newId = sanitizeId(`player_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const shortPrefix =
      cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || 'player';
    const randomPin = Math.floor(100 + Math.random() * 900);
    const joinedCsv = clampString(
      Array.from(new Set(data.clubIds)).join(','),
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
    if (effectiveTier !== 'admin') return;
    const target = players.find((p) => p.id === playerId);
    if (!target) return;
    const cleanName = clampString(updates.name, 80, target.name);
    const cleanRating = clampNumber(updates.ratingScore, 800, 3000);
    const joinedCsv = clampString(
      Array.from(new Set(updates.clubIds)).join(','),
      400,
      activeClub?.id || 'club_bintang_prime'
    );

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

    if (signedInIdentity && signedInIdentity.playerId === playerId) {
      const updatedIdentity: CachedPlayerIdentity = {
        ...signedInIdentity,
        name: cleanName,
      };
      setSignedInIdentity(updatedIdentity);
      saveCachedPlayerIdentity(updatedIdentity);
    }

    if (user) {
      await safeUpdateDoc('players', playerId, {
        name: cleanName,
        playerTag: target.playerTag,
        joinedClubIdsCsv: joinedCsv,
        ratingScore: cleanRating,
      });
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

    if (signedInIdentity) {
      const updatedIdentity: CachedPlayerIdentity = {
        ...signedInIdentity,
        name: cleanName,
      };
      setSignedInIdentity(updatedIdentity);
      saveCachedPlayerIdentity(updatedIdentity);
    }

    if (user) {
      await safeUpdateDoc('players', activePlayer.id, {
        name: cleanName,
        playerTag: activePlayer.playerTag,
        joinedClubIdsCsv: activePlayer.joinedClubIdsCsv,
        ratingScore: activePlayer.ratingScore,
      });
    }
  };

  const handleOpenProfileView = (playerId?: string) => {
    setInspectedPlayerId(playerId || activePlayer?.id || null);
    setActiveTab('profile');
  };

  const handleAdminDeleteUser = async (playerId: string) => {
    if (effectiveTier !== 'admin' || players.length <= 1) return;
    if (activePlayer && activePlayer.id === playerId) return;
    setPlayers((prev) => prev.filter((p) => p.id !== playerId));
    setRsvps((prev) => prev.filter((r) => r.playerId !== playerId));
    if (user) {
      await safeDeleteDoc('players', playerId);
    }
  };

  const handleDeleteClub = async (clubId: string) => {
    if (effectiveTier !== 'admin' || rawClubs.length <= 1) return;
    const remaining = rawClubs.filter((c) => c.id !== clubId);
    setRawClubs(remaining);
    if (activeClubId === clubId && remaining[0]) {
      setActiveClubId(remaining[0].id);
    }
    if (user) {
      await safeDeleteDoc('clubs', clubId);
    }
  };

  const handleSignOutAccount = async () => {
    if (user) {
      await signOutUser();
    }
    setSignedInIdentity(null);
    saveCachedPlayerIdentity(null);
    setPermissionTier('user');
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
    }
  ) => {
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

    const nextExcludeOwner =
      updates.excludeOwnerFromBilling !== undefined
        ? Boolean(updates.excludeOwnerFromBilling)
        : Boolean(
            clubs.find((c) => c.id === clubId)?.excludeOwnerFromBilling
          );

    const nextBillingMap = saveClubBillingRule(clubId, nextExcludeOwner);
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
    if (clubFinalizedSessions.length > 0) {
      setRsvps((prev) => {
        let nextList = [...prev];
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
            if (ownerPlayerId && r.playerId === ownerPlayerId) {
              return {
                ...r,
                feeShare: calc.feeShare,
                penaltyPercentApplied: calc.penaltyPercentApplied,
                paidStatus: 'paid',
                paidMethod: nextExcludeOwner
                  ? 'Owner Excluded'
                  : 'Club Owner',
              };
            }
            return {
              ...r,
              feeShare: calc.feeShare,
              penaltyPercentApplied: calc.penaltyPercentApplied,
            };
          });
        });
        return nextList;
      });
    }

    if (user) {
      await safeUpdateDoc('clubs', clubId, cleanUpdates);
    }
  };

  const handleUpdateClubPaymentDetails = async (
    clubId: string,
    details: ClubPaymentDetails
  ) => {
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
    ownerPlayerId?: string;
  }): Promise<Club | null> => {
    // Enforce: Club Owner can only create 1 club
    if (effectiveTier === 'club_owner' && activePlayer) {
      const alreadyOwns = clubs.some(
        (c) => c.clubOwnerPlayerId === activePlayer.id
      );
      if (alreadyOwns) {
        return null;
      }
    }

    const newClubId = sanitizeId(`club_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const assignedPlayerId =
      clubData.ownerPlayerId || activePlayer?.id || 'player_alex';
    const assignedPlayer = players.find((p) => p.id === assignedPlayerId);
    const assignedPlayerName =
      assignedPlayer?.name || activePlayer?.name || 'Alex Tan';
    const excludeOwner = Boolean(clubData.excludeOwnerFromBilling);

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
      ownerId,
      clubOwnerPlayerId: assignedPlayerId,
      clubOwnerName: assignedPlayerName,
    };

    const nextMap = saveClubOwnerAssignment(
      newClubId,
      assignedPlayerId,
      assignedPlayerName
    );
    setClubOwnerMap(nextMap);

    const nextBillingMap = saveClubBillingRule(newClubId, excludeOwner);
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
        ownerId: newClub.ownerId,
      });
    }

    if (activePlayer) {
      await handleAcceptJoinClub(newClubId);
    }
    return newClub;
  };

  const handleCreateSession = async (
    sessionData: Omit<Session, 'id' | 'ownerId'>
  ): Promise<Session> => {
    if (!enforceRateLimit('create_session')) return sessions[0];

    const newId = sanitizeId(`session_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const newSession: Session = {
      id: newId,
      clubId: sanitizeId(sessionData.clubId || activeClub.id),
      title: clampString(sessionData.title, 120, 'Badminton Session'),
      venue: clampString(sessionData.venue, 120, 'Badminton Hall'),
      courtNumbers: clampString(sessionData.courtNumbers, 60, 'Court 1'),
      sessionDate: clampString(sessionData.sessionDate, 40, '2026-10-22'),
      startTime: clampString(sessionData.startTime, 20, '20:00'),
      endTime: clampString(sessionData.endTime, 20, '22:00'),
      bookingStatus: sessionData.bookingStatus,
      courtFee: clampNumber(sessionData.courtFee, 0, 100000),
      shuttlesUsed: 0,
      shuttleUnitCost: 3.0,
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
    penaltyPercent = 0
  ) => {
    if (!enforceRateLimit('tap_rsvp')) return;

    const session = sessions.find((s) => s.id === sessionId);
    if (!session || session.bookingStatus === 'completed') return;

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

    // Optimistic state update (zero lag)
    setRsvps((prev) => {
      const exists = prev.some((r) => r.id === rsvpId);
      if (exists) {
        return prev.map((r) =>
          r.id === rsvpId
            ? {
                ...r,
                status,
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
        await Promise.all(
          computedSessionRsvps.map((r) => {
            const calc = computedSplits.get(r.id) || {
              feeShare: 0,
              penaltyPercentApplied: 0,
            };
            const isOwnerRow =
              Boolean(club.clubOwnerPlayerId) &&
              r.playerId === club.clubOwnerPlayerId;
            return safeUpdateDoc('rsvps', r.id, {
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
            });
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

  const handleFinalizeSessionShuttleAndSplit = async (
    sessionId: string,
    bookingStatus: BookingStatus,
    courtFee: number,
    shuttlesUsed: number,
    shuttleUnitCost: number,
    courtNumbers: string,
    finalizeSplit: boolean
  ) => {
    if (!enforceRateLimit('finalize_session')) return;

    const cleanCourtFee = clampNumber(courtFee, 0, 100000);
    const cleanShuttlesUsed = clampNumber(shuttlesUsed, 0, 1000);
    const cleanUnitCost = clampNumber(shuttleUnitCost, 0, 1000);
    const cleanShuttleFee = Number(
      (cleanShuttlesUsed * cleanUnitCost).toFixed(2)
    );
    const cleanCourts = clampString(courtNumbers, 60, 'Court 1');

    const session = sessions.find((s) => s.id === sessionId);
    const club =
      clubs.find((c) => c.id === session?.clubId) || activeClub;
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
      await Promise.all([
        safeUpdateDoc('sessions', sessionId, {
          bookingStatus,
          courtFee: cleanCourtFee,
          shuttlesUsed: cleanShuttlesUsed,
          shuttleUnitCost: cleanUnitCost,
          shuttleFee: cleanShuttleFee,
          courtNumbers: cleanCourts,
          feeSplitFinalized: finalizeSplit,
        }),
        ...walletSettlement.updatedSessionRsvps.map((rsvp) =>
          safeUpdateDoc('rsvps', rsvp.id, {
            status: rsvp.status,
            attendanceOutcome: rsvp.attendanceOutcome,
            penaltyPercentApplied: rsvp.penaltyPercentApplied,
            feeShare: rsvp.feeShare,
            paidStatus: rsvp.paidStatus,
            paidMethod: rsvp.paidMethod,
            playerName: rsvp.playerName,
          })
        ),
      ]);
    }
  };

  // Club Owner / Site Admin: Top up member credit balance, grant free session passes, or toggle complete fee waiver
  const handleUpdatePlayerWallet = async (
    playerId: string,
    updates: Partial<PlayerBenefitWallet>
  ) => {
    if (!canManageActiveClub && effectiveTier !== 'admin') return;

    const existing = playerWalletsMap[playerId] || {
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

    // Automatically settle any existing unpaid/pending RSVPs for this member using their updated waiver, passes, or credit
    const settled = settlePlayerExistingUnpaidRsvpsWithWallet({
      playerId,
      wallet: updatedWallet,
      rsvps,
      sessions,
    });

    const finalMap = savePlayerWalletsMap({
      ...playerWalletsMap,
      [playerId]: settled.remainingWallet,
    });
    setPlayerWalletsMap(finalMap);

    if (settled.modifiedRsvps.length > 0) {
      setRsvps(settled.updatedRsvps);

      if (user) {
        await Promise.all(
          settled.modifiedRsvps.map((r) =>
            safeUpdateDoc('rsvps', r.id, {
              status: r.status,
              attendanceOutcome: r.attendanceOutcome,
              penaltyPercentApplied: r.penaltyPercentApplied,
              feeShare: r.feeShare,
              paidStatus: r.paidStatus,
              paidMethod: r.paidMethod,
              playerName: r.playerName,
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

  // Normal User: Mark all unpaid RSVPs for player as 'pending_approval' in a SINGLE batch
  const handleNotifyPaymentSentAllForPlayer = async (
    playerId: string,
    method = 'Reported Paid'
  ) => {
    const cleanMethod = clampString(method, 40, 'Reported Paid');
    const targets = rsvps.filter(
      (r) =>
        r.playerId === playerId &&
        r.paidStatus !== 'paid' &&
        r.feeShare > 0
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
      await Promise.all(
        targets.map((target) =>
          safeUpdateDoc('rsvps', target.id, {
            status: target.status,
            attendanceOutcome: target.attendanceOutcome,
            penaltyPercentApplied: target.penaltyPercentApplied,
            feeShare: target.feeShare,
            paidStatus: 'pending_approval',
            paidMethod: cleanMethod,
            playerName: target.playerName,
          })
        )
      );
    }
  };

  // Club Owner / Site Admin: Accept or Clear a single RSVP ('paid')
  const handleAcceptOrClearSingleRsvp = async (
    rsvpId: string,
    method = 'Approved'
  ) => {
    if (!canManageActiveClub) return;
    const target = rsvps.find((r) => r.id === rsvpId);
    if (!target) return;
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

  // Club Owner / Site Admin: Reject a pending payment notification (returns to 'unpaid' with 'Rejected')
  const handleRejectPaymentForRsvp = async (rsvpId: string) => {
    if (!canManageActiveClub) return;
    const target = rsvps.find((r) => r.id === rsvpId);
    if (!target) return;

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

  // Club Owner / Site Admin: Accept/Clear all unpaid RSVPs for a player in a SINGLE batch (fixes stuttering!)
  const handleAcceptOrClearAllForPlayer = async (
    playerId: string,
    method = 'Approved'
  ) => {
    if (!canManageActiveClub) return;
    const cleanMethod = clampString(method, 40, 'Approved');
    const unpaidForPlayer = rsvps.filter(
      (r) =>
        r.playerId === playerId &&
        r.paidStatus !== 'paid' &&
        r.feeShare > 0
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
      await Promise.all(
        unpaidForPlayer.map((target) =>
          safeUpdateDoc('rsvps', target.id, {
            status: target.status,
            attendanceOutcome: target.attendanceOutcome,
            penaltyPercentApplied: target.penaltyPercentApplied,
            feeShare: target.feeShare,
            paidStatus: 'paid',
            paidMethod: cleanMethod,
            playerName: target.playerName,
          })
        )
      );
    }
  };

  // Club Owner / Site Admin: Reject all pending RSVPs for a player in a SINGLE batch
  const handleRejectAllForPlayer = async (playerId: string) => {
    if (!canManageActiveClub) return;
    const pendingForPlayer = rsvps.filter(
      (r) =>
        r.playerId === playerId &&
        r.paidStatus === 'pending_approval' &&
        r.feeShare > 0
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
      await Promise.all(
        pendingForPlayer.map((target) =>
          safeUpdateDoc('rsvps', target.id, {
            status: target.status,
            attendanceOutcome: target.attendanceOutcome,
            penaltyPercentApplied: target.penaltyPercentApplied,
            feeShare: target.feeShare,
            paidStatus: 'unpaid',
            paidMethod: 'Rejected',
            playerName: target.playerName,
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
    if (!enforceRateLimit('record_match')) return;

    const matchId = sanitizeId(`match_${Date.now()}`);
    const ownerId = user ? user.uid : 'local_club';
    const winnerSide =
      matchData.scoreTeamA >= matchData.scoreTeamB ? 'A' : 'B';

    const newMatch: BadmintonMatch = {
      id: matchId,
      clubId: sanitizeId(activeClub.id),
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

    const teamAIds = [
      newMatch.teamAPlayer1Id,
      newMatch.teamAPlayer2Id !== 'NONE' ? newMatch.teamAPlayer2Id : null,
    ].filter((id): id is string => Boolean(id));

    const teamBIds = [
      newMatch.teamBPlayer1Id,
      newMatch.teamBPlayer2Id !== 'NONE' ? newMatch.teamBPlayer2Id : null,
    ].filter((id): id is string => Boolean(id));

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
          wins: p.wins + (won ? 1 : 0),
          losses: p.losses + (won ? 0 : 1),
          gamesPlayed: p.gamesPlayed + 1,
          pointsScored: p.pointsScored + ptsFor,
          pointsConceded: p.pointsConceded + ptsAgainst,
          singlesWins:
            p.singlesWins +
            (newMatch.matchFormat === 'singles' && won ? 1 : 0),
          singlesLosses:
            p.singlesLosses +
            (newMatch.matchFormat === 'singles' && !won ? 1 : 0),
          doublesWins:
            p.doublesWins +
            (newMatch.matchFormat === 'doubles' && won ? 1 : 0),
          doublesLosses:
            p.doublesLosses +
            (newMatch.matchFormat === 'doubles' && !won ? 1 : 0),
          ratingScore: clampNumber(
            p.ratingScore +
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
      await Promise.all([
        safeSetDoc('matches', id, payload),
        ...involvedPlayers.map((p) => {
          const inA = teamAIds.includes(p.id);
          const inB = teamBIds.includes(p.id);
          const won =
            (inA && winnerSide === 'A') || (inB && winnerSide === 'B');
          const ptsFor = inA ? newMatch.scoreTeamA : newMatch.scoreTeamB;
          const ptsAgainst = inA ? newMatch.scoreTeamB : newMatch.scoreTeamA;

          return safeUpdateDoc('players', p.id, {
            wins: p.wins + (won ? 1 : 0),
            losses: p.losses + (won ? 0 : 1),
            gamesPlayed: p.gamesPlayed + 1,
            pointsScored: p.pointsScored + ptsFor,
            pointsConceded: p.pointsConceded + ptsAgainst,
            singlesWins:
              p.singlesWins +
              (newMatch.matchFormat === 'singles' && won ? 1 : 0),
            singlesLosses:
              p.singlesLosses +
              (newMatch.matchFormat === 'singles' && !won ? 1 : 0),
            doublesWins:
              p.doublesWins +
              (newMatch.matchFormat === 'doubles' && won ? 1 : 0),
            doublesLosses:
              p.doublesLosses +
              (newMatch.matchFormat === 'doubles' && !won ? 1 : 0),
            ratingScore: clampNumber(
              p.ratingScore +
                (won ? ratingDelta : -Math.round(ratingDelta * 0.75)),
              800,
              3000
            ),
          });
        }),
      ]);
    }
  };

  const handleDeleteMatch = async (matchId: string) => {
    if (!enforceRateLimit('delete_match')) return;
    setMatches((prev) => prev.filter((m) => m.id !== matchId));
    if (user) {
      await safeDeleteDoc('matches', matchId);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthErrorMessage(null);
    try {
      await signInWithGooglePopup();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('auth/popup-closed-by-user') ||
        msg.includes('auth/cancelled-popup-request') ||
        msg.includes('popup-closed-by-user')
      ) {
        return;
      }
      setAuthErrorMessage(msg);
    }
  };

  const isSignedIn = Boolean(user || signedInIdentity);
  const invitedClubForGate = pendingInviteClubId
    ? clubs.find((c) => c.id === pendingInviteClubId) || null
    : null;

  if (!isSignedIn || !activePlayer) {
    return (
      <AuthGateScreen
        invitedClub={invitedClubForGate}
        onSignInWithGoogle={handleGoogleSignIn}
        onSignInWithCredentials={handleSignInWithCredentials}
        onRegisterNewAccount={handleRegisterNewAccount}
        authError={authErrorMessage}
      />
    );
  }

  const modalJoinClub = clubJoinModalClubId
    ? clubs.find((c) => c.id === clubJoinModalClubId) || null
    : null;

  const tierOptions: { value: PermissionTier; label: string }[] = isAdminAccount
    ? [
        { value: 'user', label: 'User' },
        { value: 'club_owner', label: 'Owner' },
        { value: 'admin', label: 'Admin' },
      ]
    : [
        { value: 'user', label: 'User' },
        { value: 'club_owner', label: 'Owner' },
      ];

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
      id: 'matches',
      label: 'Matches',
      isActive: activeTab === 'matches',
    },
    {
      id: 'leaderboard',
      label: 'Standings',
      isActive: activeTab === 'leaderboard',
    },
    {
      id: 'ledger',
      label: 'Session Ledger',
      shortLabel: 'Ledger',
      isActive: activeTab === 'ledger',
      badge: myUnpaidTotal > 0 ? `$${myUnpaidTotal.toFixed(0)}` : undefined,
    },
    {
      id: 'clubs',
      label: 'Clubs',
      isActive: activeTab === 'clubs',
    },
    ...(canManageActiveClub || effectiveTier === 'admin'
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
    <div className="min-h-screen flex flex-col bg-[#f8fafc] text-slate-900 pb-20 md:pb-12">
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
              className="text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0 flex items-center gap-2"
            >
              <span className="w-7 h-7 rounded-lg bg-slate-900 text-white text-xs font-bold inline-flex items-center justify-center shrink-0">
                CP
              </span>
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
                  setActiveTab(item.id);
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

            {/* Wide Viewports (xl+): Clickable Personal Profile Button + Sign Out */}
            <div className="hidden xl:flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleOpenProfileView(activePlayer.id)}
                title="View your Personal Profile, Match History, Session Ledger & Preferences"
                className={`h-9 px-3 rounded-xl text-xs inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                  (activeTab === 'profile' || activeTab === 'settings') &&
                  (!inspectedPlayerId || inspectedPlayerId === activePlayer.id)
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-white hover:bg-slate-50 text-slate-900 border-slate-300 shadow-2xs'
                }`}
              >
                <UserIcon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    (activeTab === 'profile' || activeTab === 'settings') &&
                    (!inspectedPlayerId || inspectedPlayerId === activePlayer.id)
                      ? 'text-white'
                      : 'text-emerald-600'
                  }`}
                />
                <span className="font-semibold truncate max-w-32">
                  {activePlayer.name}
                </span>
                <span
                  className={`font-mono ${
                    (activeTab === 'profile' || activeTab === 'settings') &&
                    (!inspectedPlayerId || inspectedPlayerId === activePlayer.id)
                      ? 'text-slate-300'
                      : 'text-slate-600'
                  }`}
                >
                  ({activePlayer.playerTag})
                </span>
              </button>

              <button
                type="button"
                onClick={handleSignOutAccount}
                className="h-9 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign Out
              </button>
            </div>

            {/* Tighter Viewports (< xl): Clean Account Menu Dropdown */}
            <div className="relative xl:hidden">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                className={`h-9 px-3 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer border ${
                  activeTab === 'profile' || activeTab === 'settings'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'text-slate-800 bg-white hover:bg-slate-50 border-slate-300 shadow-2xs'
                }`}
                aria-expanded={accountMenuOpen}
              >
                <UserIcon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    activeTab === 'profile' || activeTab === 'settings'
                      ? 'text-white'
                      : 'text-emerald-600'
                  }`}
                />
                <span className="truncate max-w-28 sm:max-w-36">
                  {activePlayer.name}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${
                    activeTab === 'profile' || activeTab === 'settings'
                      ? 'text-slate-300'
                      : 'text-slate-600'
                  } ${accountMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              <AnimatePresence>
                {accountMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.14 }}
                    className="absolute right-0 mt-1.5 w-60 bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-900/10 py-2 px-2.5 z-50 space-y-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        handleOpenProfileView(activePlayer.id);
                      }}
                      className="w-full text-left pb-2 border-b border-slate-100 hover:bg-slate-50/80 rounded-xl px-2.5 py-2 transition-colors cursor-pointer"
                    >
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {activePlayer.name}
                      </p>
                      <p className="text-[11px] font-mono text-emerald-700 font-semibold mt-0.5">
                        {activePlayer.playerTag} · My Profile &amp; Preferences →
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        void handleSignOutAccount();
                      }}
                      className="w-full h-9 px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-xl flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5 shrink-0" />
                      <span>Sign Out</span>
                    </button>
                  </motion.div>
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
                setActiveTab(item.id);
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
          canManageClub={canManageActiveClub}
          onNotifyPaymentSentAll={(method) =>
            handleNotifyPaymentSentAllForPlayer(activePlayer.id, method)
          }
          onNotifyPaymentSentSingle={handleNotifyPaymentSentForRsvp}
          onAcceptOrClearAll={(method) =>
            handleAcceptOrClearAllForPlayer(activePlayer.id, method)
          }
          onAcceptOrClearSingle={handleAcceptOrClearSingleRsvp}
          onRejectSingle={handleRejectPaymentForRsvp}
          autoPromptOpen={paymentModalOpen}
          onCloseAutoPrompt={() => setPaymentModalOpen(false)}
          onOpenPrompt={() => setPaymentModalOpen(true)}
          onGoToLedger={() => {
            setOpenPayInfoOnLedger(true);
            setActiveTab('ledger');
          }}
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
                          ? sessions[0]
                          : sessions.find((s) => s.clubId === nextClubId);
                      if (firstClubSession) {
                        setSelectedSessionId(firstClubSession.id);
                      }
                    }}
                  >
                    {isAllClubsAllowedOnTab && (
                      <option value="all">
                        All Clubs ({userJoinedClubs.length})
                      </option>
                    )}
                    {userJoinedClubs.map((c) => (
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
                  ? 'Directory & Member Ledger'
                  : activeTab === 'settings'
                  ? `Personal Settings · ${activePlayer.name}`
                  : `Player Profile · ${activePlayer.name}`}
              </span>
            )}
          </div>

          {/* Right: 3-Tier Permission Switcher (User | Owner | Admin) */}
          <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
            <span className="sm:hidden text-xs font-semibold text-slate-600">
              View Mode:
            </span>
            {rateLimitNotice && (
              <span className="hidden md:inline text-amber-700 font-medium">
                {rateLimitNotice}
              </span>
            )}

            <SegmentedControl
              size="sm"
              options={tierOptions}
              value={effectiveTier}
              onChange={handleSetTier}
            />
          </div>
        </div>
      </div>

      {/* Club Join Invitation Modal */}
      {modalJoinClub && (
        <ClubJoinPromptModal
          club={modalJoinClub}
          player={activePlayer}
          onAcceptJoinClub={handleAcceptJoinClub}
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
            {activeTab === 'sessions' && activeClub && (
              <SessionsOverviewAndQuickOrganize
                activeClub={activeClub}
                clubs={userJoinedClubs}
                isAllClubsFilter={activeClubId === 'all'}
                sessions={clubSessions}
                rsvps={clubRsvps}
                matches={clubMatches}
                activePlayer={activePlayer}
                isAdmin={canManageActiveClub}
                onCreateSession={handleCreateSession}
                onTapRsvp={handleTapRsvp}
                onOpenTapRsvpForSession={(sessionId) => {
                  setSelectedSessionId(sessionId);
                  setActiveTab('rsvp');
                }}
                onOpenMatchScorerForSession={(sessionId) => {
                  setSelectedSessionId(sessionId);
                  setActiveTab('matches');
                }}
                onOpenFeeSplitForSession={(sessionId, openPayInfo) => {
                  setSelectedSessionId(sessionId);
                  if (openPayInfo) {
                    setOpenPayInfoOnLedger(true);
                  }
                  setActiveTab('ledger');
                }}
                onCloneNextWeekSession={handleCloneNextWeekSession}
                showQuickOrganizerRef={quickOrganizerRef}
              />
            )}

            {activeTab === 'rsvp' && activeClub && (
              <TapRsvpPortal
                activeClub={activeClub}
                sessions={clubSessions}
                selectedSessionId={selectedSessionId}
                onSelectSession={setSelectedSessionId}
                rsvps={clubRsvps}
                activePlayer={activePlayer}
                isAdmin={canManageActiveClub}
                onTapRsvp={handleTapRsvp}
                onMarkAttendanceOutcome={handleMarkAttendanceOutcome}
                onBackToSessions={() => setActiveTab('sessions')}
              />
            )}

            {activeTab === 'matches' && (
              <MatchScorerAndCourtView
                sessions={clubSessions}
                selectedSessionId={selectedSessionId}
                onSelectSession={setSelectedSessionId}
                players={rankedClubPlayers}
                matches={clubMatches}
                activePlayer={activePlayer}
                isAdmin={canManageActiveClub}
                onRecordMatch={handleRecordMatch}
                onDeleteMatch={handleDeleteMatch}
                onOpenProfileView={handleOpenProfileView}
              />
            )}

            {activeTab === 'leaderboard' && (
              <LeaderboardAndTierView
                rankedPlayers={rankedClubPlayers}
                matches={clubMatches}
                sessions={clubSessions}
                activePlayer={activePlayer}
                onOpenMatchesView={() => setActiveTab('matches')}
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
                sessions={clubSessions}
                rsvps={clubRsvps}
                matches={clubMatches}
                canManageClub={canManageActiveClub}
                onUpdateOwnProfile={handleUpdateOwnProfile}
                onTapRsvp={handleTapRsvp}
                onNotifyPaymentSentForRsvp={handleNotifyPaymentSentForRsvp}
                onNotifyPaymentSentAllForPlayer={
                  handleNotifyPaymentSentAllForPlayer
                }
                onUpdatePlayerWallet={handleUpdatePlayerWallet}
              />
            )}

            {activeTab === 'ledger' && activeClub && (
              <FeeLedgerAndSplitView
                activeClub={activeClub}
                sessions={clubSessions}
                selectedSessionId={selectedSessionId}
                onSelectSession={setSelectedSessionId}
                rsvps={clubRsvps}
                players={clubPlayers}
                activePlayer={activePlayer}
                permissionTier={effectiveTier}
                canManageClub={canManageActiveClub}
                initialOpenPayInfo={openPayInfoOnLedger}
                onConsumeInitialOpenPayInfo={() => setOpenPayInfoOnLedger(false)}
                onUpdateClubPaymentDetails={handleUpdateClubPaymentDetails}
                onFinalizeSessionShuttleAndSplit={
                  handleFinalizeSessionShuttleAndSplit
                }
                onMarkAttendanceOutcome={handleMarkAttendanceOutcome}
                onNotifyPaymentSentForRsvp={handleNotifyPaymentSentForRsvp}
                onAcceptOrClearSingleRsvp={handleAcceptOrClearSingleRsvp}
                onRejectPaymentForRsvp={handleRejectPaymentForRsvp}
                onOpenUsersView={
                  canManageActiveClub || effectiveTier === 'admin'
                    ? () => setActiveTab('users')
                    : undefined
                }
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
                onAdminAddMemberToClub={(name) =>
                  handleAdminAddMemberToClub(name)
                }
                onAssignClubOwner={handleAssignClubOwner}
                onDeleteClub={handleDeleteClub}
                onCreateNewClub={handleCreateNewClub}
                onUpdateClubSettings={handleUpdateClubSettings}
                onTriggerClubJoinPromptPreview={(clubId) =>
                  setClubJoinModalClubId(clubId)
                }
                onOpenUsersDirectory={
                  canManageActiveClub || effectiveTier === 'admin'
                    ? () => setActiveTab('users')
                    : undefined
                }
                onUpdatePlayerWallet={handleUpdatePlayerWallet}
              />
            )}

            {activeTab === 'users' &&
              (canManageActiveClub || effectiveTier === 'admin') &&
              activeClub && (
                <SiteAdminUserManagement
                  players={effectiveTier === 'admin' ? players : clubPlayers}
                  clubs={
                    effectiveTier === 'admin' ? clubs : userJoinedClubs
                  }
                  activeClub={activeClub}
                  sessions={effectiveTier === 'admin' ? sessions : clubSessions}
                  rsvps={effectiveTier === 'admin' ? rsvps : clubRsvps}
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
                    setSelectedSessionId(sessionId);
                    setActiveTab('ledger');
                  }}
                  onUpdatePlayerWallet={handleUpdatePlayerWallet}
                />
              )}

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

      {/* Mobile Bottom Tab Bar (< md) — Includes Matches & Standings with Animated Active Indicator */}
      <nav
        aria-label="Mobile Navigation"
        className={`md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 grid ${
          canManageActiveClub || effectiveTier === 'admin'
            ? 'grid-cols-6'
            : 'grid-cols-5'
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
              className="absolute top-0 inset-x-3 h-0.5 bg-slate-900 rounded-b-full"
            />
          )}
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="mt-1">Sessions</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('matches')}
          className={`relative flex flex-col items-center justify-center h-full text-[11px] whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'matches'
              ? 'text-slate-950 font-bold'
              : 'text-slate-600 font-semibold hover:text-slate-900'
          }`}
        >
          {activeTab === 'matches' && (
            <motion.span
              layoutId="mobile-nav-indicator"
              className="absolute top-0 inset-x-3 h-0.5 bg-slate-900 rounded-b-full"
            />
          )}
          <Swords className="w-4 h-4 shrink-0" />
          <span className="mt-1">Matches</span>
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
              className="absolute top-0 inset-x-3 h-0.5 bg-slate-900 rounded-b-full"
            />
          )}
          <Award className="w-4 h-4 shrink-0" />
          <span className="mt-1">Standings</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ledger')}
          className={`relative flex flex-col items-center justify-center h-full text-[11px] whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'ledger'
              ? 'text-slate-950 font-bold'
              : 'text-slate-600 font-semibold hover:text-slate-900'
          }`}
        >
          {activeTab === 'ledger' && (
            <motion.span
              layoutId="mobile-nav-indicator"
              className="absolute top-0 inset-x-3 h-0.5 bg-slate-900 rounded-b-full"
            />
          )}
          <Receipt className="w-4 h-4 shrink-0" />
          <span className="mt-1">Ledger</span>
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
              className="absolute top-0 inset-x-3 h-0.5 bg-slate-900 rounded-b-full"
            />
          )}
          <Building2 className="w-4 h-4 shrink-0" />
          <span className="mt-1">Clubs</span>
        </button>

        {(canManageActiveClub || effectiveTier === 'admin') && (
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
                className="absolute top-0 inset-x-3 h-0.5 bg-slate-900 rounded-b-full"
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
