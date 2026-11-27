import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Receipt,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Club,
  OutstandingDebtItem,
  PermissionTier,
  Player,
  PlayerBenefitWallet,
  Session,
  SessionRsvp,
} from '../types';
import {
  formatClubCurrency,
  getClubCurrencySymbol,
  getPlayerClubWallet,
  getPlayerJoinedClubIds,
} from '../utils/badmintonLogic';
import {
  ConfirmModal,
  SegmentedControl,
  StyledInput,
  StyledSelect,
} from './ui/FormControls';
import { backdropClose } from '../utils/backdropClose';

interface SiteAdminUserManagementProps {
  players: Player[];
  clubs: Club[];
  activeClub?: Club;
  sessions: Session[];
  rsvps: SessionRsvp[];
  walletsMap?: Record<string, PlayerBenefitWallet>;
  activePlayer: Player;
  permissionTier?: PermissionTier;
  onAdminCreateUser: (data: {
    name: string;
    ratingScore: number;
    clubIds: string[];
  }) => Promise<void>;
  onAdminUpdateUser: (
    playerId: string,
    updates: {
      name: string;
      clubIds: string[];
    }
  ) => Promise<void>;
  onAdminDeleteUser: (playerId: string) => Promise<void>;
  onRemoveMemberFromClub?: (
    playerId: string,
    clubId: string
  ) => Promise<void>;
  onAssignClubOwner: (clubId: string, ownerPlayerId: string) => Promise<void>;
  onAcceptOrClearAllForPlayer: (
    playerId: string,
    method: string,
    clubId?: string
  ) => Promise<void>;
  onRejectAllForPlayer?: (playerId: string, clubId?: string) => Promise<void>;
  onAcceptOrClearSingleRsvp?: (rsvpId: string, method: string) => Promise<void>;
  onRejectPaymentForRsvp?: (rsvpId: string) => Promise<void>;
  onOpenPlayerProfile?: (playerId: string) => void;
  onOpenSessionLedger?: (sessionId: string) => void;
  onUpdatePlayerWallet?: (
    playerId: string,
    updates: Partial<PlayerBenefitWallet>,
    clubId?: string
  ) => void;
}

type ClubBalanceSortKey =
  | 'due_desc'
  | 'pending_desc'
  | 'received_desc'
  | 'rating_desc'
  | 'name_asc';

type PlatformUserSortKey =
  | 'name_asc'
  | 'rating_desc'
  | 'games_desc'
  | 'clubs_desc';

interface PerClubPlayerStats {
  received: number;
  pending: number;
  unpaid: number;
  paidCount: number;
  pendingCount: number;
  unpaidCount: number;
  attendedCount: number;
  debts: OutstandingDebtItem[];
}

export const SiteAdminUserManagement: React.FC<
  SiteAdminUserManagementProps
> = ({
  players,
  clubs,
  activeClub,
  sessions,
  rsvps,
  walletsMap,
  activePlayer,
  permissionTier = 'admin',
  onAdminCreateUser,
  onAdminUpdateUser,
  onAdminDeleteUser,
  onRemoveMemberFromClub,
  onAssignClubOwner,
  onAcceptOrClearAllForPlayer,
  onRejectAllForPlayer,
  onAcceptOrClearSingleRsvp,
  onRejectPaymentForRsvp,
  onOpenPlayerProfile,
  onOpenSessionLedger,
  onUpdatePlayerWallet,
}) => {
  const isSiteAdmin = permissionTier === 'admin';

  // Pre-index clubs, club owners, and memberships in a single linear pass O(C + P)
  const {
    clubByIdMap,
    ownedClubByOwnerIdMap,
    membersByClubIdMap,
    playerJoinedIdsMap,
    sessionCountByClubIdMap,
  } = useMemo(() => {
    const cMap = new Map<string, Club>();
    const ownerMap = new Map<string, Club>();
    const mMap = new Map<string, Player[]>();
    const joinedMap = new Map<string, string[]>();
    const sCountMap = new Map<string, number>();

    for (let i = 0; i < clubs.length; i++) {
      const c = clubs[i];
      cMap.set(c.id, c);
      mMap.set(c.id, []);
      sCountMap.set(c.id, 0);
      if (c.clubOwnerPlayerId) {
        ownerMap.set(c.clubOwnerPlayerId, c);
      }
    }

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const joined = getPlayerJoinedClubIds(p);
      joinedMap.set(p.id, joined);
      for (let j = 0; j < joined.length; j++) {
        const list = mMap.get(joined[j]);
        if (list) list.push(p);
      }
    }

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      sCountMap.set(s.clubId, (sCountMap.get(s.clubId) || 0) + 1);
    }

    return {
      clubByIdMap: cMap,
      ownedClubByOwnerIdMap: ownerMap,
      membersByClubIdMap: mMap,
      playerJoinedIdsMap: joinedMap,
      sessionCountByClubIdMap: sCountMap,
    };
  }, [clubs, players, sessions]);

  // Does the currently signed-in player own a club?
  const myOwnedClub = useMemo(() => {
    return ownedClubByOwnerIdMap.get(activePlayer.id) || null;
  }, [ownedClubByOwnerIdMap, activePlayer.id]);

  // In Admin mode, default to 'platform' (Users & Clubs Administration); allow switching to 'owned_club' if Admin also owns a club.
  // In Club Owner mode, always show 'owned_club' (Member Balances & Wallets for their owned club).
  const [adminWorkspaceTab, setAdminWorkspaceTab] = useState<
    'platform' | 'owned_club'
  >('platform');
  const [platformSection, setPlatformSection] = useState<'users' | 'clubs'>(
    'users'
  );

  const effectiveWorkspace: 'platform' | 'owned_club' =
    !isSiteAdmin
      ? 'owned_club'
      : adminWorkspaceTab === 'owned_club' && myOwnedClub
      ? 'owned_club'
      : 'platform';

  // The club whose financial balances & wallets are being managed (ONLY valid when owned by activePlayer)
  const managedOwnedClub: Club | null = useMemo(() => {
    if (myOwnedClub) return myOwnedClub;
    if (!isSiteAdmin && activeClub && activeClub.clubOwnerPlayerId === activePlayer.id) {
      return activeClub;
    }
    return null;
  }, [myOwnedClub, isSiteAdmin, activeClub, activePlayer.id]);

  // Ledger amounts use the currency of the club being managed
  const ledgerMoney = (n: number) => formatClubCurrency(n, managedOwnedClub);

  // Search, Filter & Pagination States (Deferred search values prevent any input lag on large datasets)
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const [clubSearchQuery, setClubSearchQuery] = useState('');
  const deferredClubSearchQuery = useDeferredValue(clubSearchQuery);

  // Club Owner Ledger Filters (strictly scoped to managedOwnedClub)
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'owing' | 'perks'>(
    'all'
  );
  const [ledgerSortBy, setLedgerSortBy] =
    useState<ClubBalanceSortKey>('due_desc');

  // Platform Admin User Directory Filters
  const [platformRoleFilter, setPlatformRoleFilter] = useState<
    'all' | 'owners' | 'members'
  >('all');
  const [platformClubFilter, setPlatformClubFilter] = useState<string>('all');
  const [platformSortBy, setPlatformSortBy] =
    useState<PlatformUserSortKey>('name_asc');

  const [visibleMemberCount, setVisibleMemberCount] = useState(30);
  const [visibleClubCount, setVisibleClubCount] = useState(20);

  // Modals & Editor States
  const [inspectedPlatformClubId, setInspectedPlatformClubId] = useState<
    string | null
  >(null);
  const [clubModalMemberSearch, setClubModalMemberSearch] = useState('');
  const deferredClubModalMemberSearch = useDeferredValue(clubModalMemberSearch);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRating, setNewRating] = useState(1200);
  const [createUserErrors, setCreateUserErrors] = useState<{
    name?: string;
    rating?: string;
  }>({});

  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingInLedgerMode, setEditingInLedgerMode] =
    useState<boolean>(false);
  const [memberModalTab, setMemberModalTab] = useState<
    'payments' | 'wallet' | 'details'
  >('payments');
  const [modalActionFeedback, setModalActionFeedback] = useState<string | null>(
    null
  );
  const [busyPaymentAction, setBusyPaymentAction] = useState<string | null>(
    null
  );
  const modalFeedbackTimerRef = useRef<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editUserErrors, setEditUserErrors] = useState<{
    name?: string;
  }>({});
  const [editOwnedClubId, setEditOwnedClubId] = useState<string>('NONE');
  const [savedNoticeId, setSavedNoticeId] = useState<string | null>(null);
  const [walletTopUpInput, setWalletTopUpInput] = useState<string>('20');
  const [walletTopUpError, setWalletTopUpError] = useState<string | undefined>(
    undefined
  );

  const [pendingDeletePlayer, setPendingDeletePlayer] =
    useState<Player | null>(null);
  const [pendingRejectPlayer, setPendingRejectPlayer] =
    useState<Player | null>(null);
  const [pendingRejectSingleRsvp, setPendingRejectSingleRsvp] =
    useState<SessionRsvp | null>(null);
  const [pendingResetCreditPlayer, setPendingResetCreditPlayer] =
    useState<Player | null>(null);
  const [pendingRemoveFromClub, setPendingRemoveFromClub] = useState<{
    player: Player;
    club: Club;
  } | null>(null);

  const showModalFeedback = (message: string) => {
    setModalActionFeedback(message);
    if (modalFeedbackTimerRef.current) {
      window.clearTimeout(modalFeedbackTimerRef.current);
    }
    modalFeedbackTimerRef.current = window.setTimeout(() => {
      setModalActionFeedback(null);
      modalFeedbackTimerRef.current = null;
    }, 2600);
  };

  useEffect(() => {
    return () => {
      if (modalFeedbackTimerRef.current) {
        window.clearTimeout(modalFeedbackTimerRef.current);
      }
    };
  }, []);

  const hasNestedConfirmOpen = Boolean(
    pendingDeletePlayer ||
      pendingRejectPlayer ||
      pendingRejectSingleRsvp ||
      pendingResetCreditPlayer ||
      pendingRemoveFromClub
  );

  useEffect(() => {
    if (!editingPlayerId || hasNestedConfirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setEditingPlayerId(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editingPlayerId, hasNestedConfirmOpen]);

  // Single-pass O(S + R) financial calculation strictly for `managedOwnedClub`
  // Admin never computes or aggregates financial balances for clubs they don't own!
  const ownedClubLedgerData = useMemo(() => {
    const emptyStatsMap = new Map<string, PerClubPlayerStats>();
    if (!managedOwnedClub) {
      return {
        clubReceivedTotal: 0,
        clubPendingTotal: 0,
        clubUnpaidTotal: 0,
        clubSettledSharesCount: 0,
        statsByPlayerId: emptyStatsMap,
      };
    }

    const targetClubId = managedOwnedClub.id;
    const clubOwnerPlayerId = managedOwnedClub.clubOwnerPlayerId;

    // Index finalized completed sessions for this owned club in O(S)
    const finalizedSessionById = new Map<string, Session>();
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      if (
        s.clubId === targetClubId &&
        s.bookingStatus === 'completed' &&
        s.feeSplitFinalized
      ) {
        finalizedSessionById.set(s.id, s);
      }
    }

    let clubReceivedTotal = 0;
    let clubPendingTotal = 0;
    let clubUnpaidTotal = 0;
    let clubSettledSharesCount = 0;

    for (let i = 0; i < rsvps.length; i++) {
      const r = rsvps[i];
      if (r.clubId !== targetClubId) continue;
      const session = finalizedSessionById.get(r.sessionId);
      if (!session) continue;

      let pStats = emptyStatsMap.get(r.playerId);
      if (!pStats) {
        pStats = {
          received: 0,
          pending: 0,
          unpaid: 0,
          paidCount: 0,
          pendingCount: 0,
          unpaidCount: 0,
          attendedCount: 0,
          debts: [],
        };
        emptyStatsMap.set(r.playerId, pStats);
      }

      if (r.status === 'going' && r.attendanceOutcome === 'present') {
        pStats.attendedCount += 1;
      }

      const hadChargeableShare =
        r.feeShare > 0 ||
        (r.grossFeeShare ?? 0) > 0 ||
        (r.walletCreditApplied ?? 0) > 0 ||
        Boolean(r.walletPassApplied) ||
        Boolean(r.walletWaiverApplied);
      if (!hadChargeableShare) continue;

      const isOwnerSelf = Boolean(
        clubOwnerPlayerId && r.playerId === clubOwnerPlayerId
      );

      if (r.paidStatus === 'paid' || isOwnerSelf) {
        pStats.received += r.feeShare;
        pStats.paidCount += 1;
        clubReceivedTotal += r.feeShare;
        clubSettledSharesCount += 1;
      } else if (r.paidStatus === 'pending_approval') {
        pStats.pending += r.feeShare;
        pStats.pendingCount += 1;
        pStats.debts.push({ rsvp: r, session });
        clubPendingTotal += r.feeShare;
      } else if (r.paidStatus === 'unpaid') {
        pStats.unpaid += r.feeShare;
        pStats.unpaidCount += 1;
        pStats.debts.push({ rsvp: r, session });
        clubUnpaidTotal += r.feeShare;
      }
    }

    // Sort each player's debts newest session first
    emptyStatsMap.forEach((stat) => {
      if (stat.debts.length > 1) {
        stat.debts.sort((a, b) =>
          b.session.sessionDate.localeCompare(a.session.sessionDate)
        );
      }
    });

    return {
      clubReceivedTotal,
      clubPendingTotal,
      clubUnpaidTotal,
      clubSettledSharesCount,
      statsByPlayerId: emptyStatsMap,
    };
  }, [managedOwnedClub, sessions, rsvps]);

  // Build summaries for Owned Club Ledger (strictly members of `managedOwnedClub` and their club-scoped wallets & balances)
  const ownedClubMemberSummaries = useMemo(() => {
    if (!managedOwnedClub) return [];
    const clubId = managedOwnedClub.id;
    const clubMembers = membersByClubIdMap.get(clubId) || [];

    return clubMembers.map((player) => {
      const cStats = ownedClubLedgerData.statsByPlayerId.get(player.id);
      const clubWallet = getPlayerClubWallet(player, clubId, walletsMap);
      const hasClubPerks =
        Boolean(clubWallet.waiveAllFees) ||
        clubWallet.freeSessionPasses > 0 ||
        clubWallet.creditBalance > 0;

      return {
        player,
        isClubOwner: managedOwnedClub.clubOwnerPlayerId === player.id,
        clubWallet,
        hasClubPerks,
        totalReceived: cStats ? cStats.received : 0,
        totalPending: cStats ? cStats.pending : 0,
        totalUnpaid: cStats ? cStats.unpaid : 0,
        paidSessionsCount: cStats ? cStats.paidCount : 0,
        pendingCount: cStats ? cStats.pendingCount : 0,
        unpaidCount: cStats ? cStats.unpaidCount : 0,
        sessionsAttendedCount: cStats ? cStats.attendedCount : 0,
        debts: cStats ? cStats.debts : [],
      };
    });
  }, [managedOwnedClub, membersByClubIdMap, ownedClubLedgerData, walletsMap]);

  const ownedClubSummaryByPlayerId = useMemo(() => {
    const map = new Map<
      string,
      (typeof ownedClubMemberSummaries)[number]
    >();
    for (let i = 0; i < ownedClubMemberSummaries.length; i++) {
      const item = ownedClubMemberSummaries[i];
      map.set(item.player.id, item);
    }
    return map;
  }, [ownedClubMemberSummaries]);

  const ownedClubCounts = useMemo(() => {
    let owingOrPending = 0;
    let owingOnly = 0;
    let pendingOnly = 0;
    let perks = 0;
    for (let i = 0; i < ownedClubMemberSummaries.length; i++) {
      const s = ownedClubMemberSummaries[i];
      if (s.totalUnpaid > 0 || s.totalPending > 0) owingOrPending += 1;
      if (s.totalUnpaid > 0) owingOnly += 1;
      if (s.totalPending > 0) pendingOnly += 1;
      if (s.hasClubPerks) perks += 1;
    }
    return { owingOrPending, owingOnly, pendingOnly, perks };
  }, [ownedClubMemberSummaries]);

  const filteredOwnedClubSummaries = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    const filtered = ownedClubMemberSummaries.filter((item) => {
      if (
        ledgerFilter === 'owing' &&
        item.totalUnpaid <= 0 &&
        item.totalPending <= 0
      ) {
        return false;
      }
      if (ledgerFilter === 'perks' && !item.hasClubPerks) {
        return false;
      }
      if (!q) return true;
      return (
        item.player.name.toLowerCase().includes(q) ||
        item.player.playerTag.toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      if (ledgerSortBy === 'due_desc') {
        if (b.totalUnpaid !== a.totalUnpaid) {
          return b.totalUnpaid - a.totalUnpaid;
        }
        if (b.totalPending !== a.totalPending) {
          return b.totalPending - a.totalPending;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      if (ledgerSortBy === 'pending_desc') {
        if (b.totalPending !== a.totalPending) {
          return b.totalPending - a.totalPending;
        }
        if (b.totalUnpaid !== a.totalUnpaid) {
          return b.totalUnpaid - a.totalUnpaid;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      if (ledgerSortBy === 'received_desc') {
        if (b.totalReceived !== a.totalReceived) {
          return b.totalReceived - a.totalReceived;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      if (ledgerSortBy === 'rating_desc') {
        if (b.player.ratingScore !== a.player.ratingScore) {
          return b.player.ratingScore - a.player.ratingScore;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      return a.player.name.localeCompare(b.player.name);
    });
  }, [
    ownedClubMemberSummaries,
    deferredSearchQuery,
    ledgerFilter,
    ledgerSortBy,
  ]);

  // Platform Users Directory Data (Site Admin View — zero financial clutter)
  const platformUserSummaries = useMemo(() => {
    return players.map((player) => {
      const joinedIds = playerJoinedIdsMap.get(player.id) || [];
      const joinedClubs: Club[] = [];
      for (let i = 0; i < joinedIds.length; i++) {
        const c = clubByIdMap.get(joinedIds[i]);
        if (c) joinedClubs.push(c);
      }
      const ownedClub = ownedClubByOwnerIdMap.get(player.id) || null;
      return {
        player,
        joinedIds,
        joinedClubs,
        ownedClub,
      };
    });
  }, [players, playerJoinedIdsMap, clubByIdMap, ownedClubByOwnerIdMap]);

  const platformUserSummaryById = useMemo(() => {
    const map = new Map<string, (typeof platformUserSummaries)[number]>();
    for (let i = 0; i < platformUserSummaries.length; i++) {
      const s = platformUserSummaries[i];
      map.set(s.player.id, s);
    }
    return map;
  }, [platformUserSummaries]);

  const totalOwnersCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < platformUserSummaries.length; i++) {
      if (platformUserSummaries[i].ownedClub) count += 1;
    }
    return count;
  }, [platformUserSummaries]);

  const filteredPlatformUsers = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    const list = platformUserSummaries.filter((item) => {
      if (
        platformClubFilter !== 'all' &&
        !item.joinedIds.includes(platformClubFilter)
      ) {
        return false;
      }
      if (platformRoleFilter === 'owners' && !item.ownedClub) return false;
      if (platformRoleFilter === 'members' && item.ownedClub) return false;

      if (!q) return true;
      return (
        item.player.name.toLowerCase().includes(q) ||
        item.player.playerTag.toLowerCase().includes(q) ||
        item.joinedClubs.some((c) => c.name.toLowerCase().includes(q)) ||
        Boolean(item.ownedClub && item.ownedClub.name.toLowerCase().includes(q))
      );
    });

    return [...list].sort((a, b) => {
      if (platformSortBy === 'rating_desc') {
        if (b.player.ratingScore !== a.player.ratingScore) {
          return b.player.ratingScore - a.player.ratingScore;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      if (platformSortBy === 'games_desc') {
        if (b.player.gamesPlayed !== a.player.gamesPlayed) {
          return b.player.gamesPlayed - a.player.gamesPlayed;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      if (platformSortBy === 'clubs_desc') {
        if (b.joinedClubs.length !== a.joinedClubs.length) {
          return b.joinedClubs.length - a.joinedClubs.length;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      return a.player.name.localeCompare(b.player.name);
    });
  }, [
    platformUserSummaries,
    deferredSearchQuery,
    platformClubFilter,
    platformRoleFilter,
    platformSortBy,
  ]);

  // Platform Clubs Directory Data (Site Admin View)
  const filteredPlatformClubs = useMemo(() => {
    const q = deferredClubSearchQuery.trim().toLowerCase();
    return clubs
      .filter((club) => {
        if (!q) return true;
        return (
          club.name.toLowerCase().includes(q) ||
          (club.clubOwnerName || '').toLowerCase().includes(q) ||
          club.description.toLowerCase().includes(q)
        );
      })
      .map((club) => ({
        club,
        members: membersByClubIdMap.get(club.id) || [],
        sessionCount: sessionCountByClubIdMap.get(club.id) || 0,
        isOwnedByMe: club.clubOwnerPlayerId === activePlayer.id,
      }));
  }, [
    clubs,
    deferredClubSearchQuery,
    membersByClubIdMap,
    sessionCountByClubIdMap,
    activePlayer.id,
  ]);

  const visibleOwnedClubSummaries = useMemo(
    () => filteredOwnedClubSummaries.slice(0, visibleMemberCount),
    [filteredOwnedClubSummaries, visibleMemberCount]
  );

  const visiblePlatformUsers = useMemo(
    () => filteredPlatformUsers.slice(0, visibleMemberCount),
    [filteredPlatformUsers, visibleMemberCount]
  );

  const visiblePlatformClubs = useMemo(
    () => filteredPlatformClubs.slice(0, visibleClubCount),
    [filteredPlatformClubs, visibleClubCount]
  );

  const filteredLedgerTotals = useMemo(() => {
    let received = 0;
    let pending = 0;
    let unpaid = 0;
    for (let i = 0; i < filteredOwnedClubSummaries.length; i++) {
      const s = filteredOwnedClubSummaries[i];
      received += s.totalReceived;
      pending += s.totalPending;
      unpaid += s.totalUnpaid;
    }
    return { received, pending, unpaid };
  }, [filteredOwnedClubSummaries]);

  const handleOpenMemberModal = (player: Player, inLedgerMode: boolean) => {
    const owned = ownedClubByOwnerIdMap.get(player.id) || null;
    setEditingPlayerId(player.id);
    setEditingInLedgerMode(inLedgerMode);
    setMemberModalTab(inLedgerMode ? 'payments' : 'details');
    setModalActionFeedback(null);
    setBusyPaymentAction(null);
    setEditName(player.name);
    setEditUserErrors({});
    setWalletTopUpError(undefined);
    setEditOwnedClubId(owned ? owned.id : 'NONE');
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: typeof createUserErrors = {};
    if (!newName.trim()) {
      nextErrors.name = 'Please enter the member full name.';
    }
    if (Number.isNaN(Number(newRating)) || newRating < 800 || newRating > 3000) {
      nextErrors.rating = 'Rating must be between 800 and 3000.';
    }
    if (Object.keys(nextErrors).length > 0) {
      setCreateUserErrors(nextErrors);
      return;
    }
    setCreateUserErrors({});
    const defaultClubId =
      managedOwnedClub?.id ||
      (activeClub && activeClub.id !== 'club_empty_placeholder'
        ? activeClub.id
        : '') ||
      clubs[0]?.id ||
      '';
    await onAdminCreateUser({
      name: newName.trim(),
      ratingScore: newRating,
      clubIds: defaultClubId ? [defaultClubId] : [],
    });
    setNewName('');
    setNewRating(1200);
    setShowCreateForm(false);
  };

  const handleSaveEdit = async (e: React.FormEvent, player: Player) => {
    e.preventDefault();
    // Pressing Enter in the modal must not rename anyone for a club owner (the rules refuse it too).
    if (!isSiteAdmin) return;
    const nextErrors: typeof editUserErrors = {};
    if (!editName.trim()) {
      nextErrors.name = 'Please enter the member full name.';
    }
    if (Object.keys(nextErrors).length > 0) {
      setEditUserErrors(nextErrors);
      return;
    }
    setEditUserErrors({});
    const userChosenClubs = playerJoinedIdsMap.get(player.id) || [];
    const preservedClubs =
      isSiteAdmin &&
      editOwnedClubId !== 'NONE' &&
      !userChosenClubs.includes(editOwnedClubId)
        ? [...userChosenClubs, editOwnedClubId]
        : userChosenClubs;

    await onAdminUpdateUser(player.id, {
      name: editName.trim(),
      clubIds: preservedClubs,
    });

    if (isSiteAdmin) {
      const currentOwned = ownedClubByOwnerIdMap.get(player.id) || null;
      if (editOwnedClubId !== 'NONE') {
        if (!currentOwned || currentOwned.id !== editOwnedClubId) {
          await onAssignClubOwner(editOwnedClubId, player.id);
        }
      }
    }

    setSavedNoticeId(player.id);
    setEditingPlayerId(null);
    setTimeout(() => setSavedNoticeId(null), 2000);
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
    }
    return (name.slice(0, 2) || 'MB').toUpperCase();
  };

  return (
    <div className="space-y-6">
      {/* Top Page Header & Workspace Mode Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 pb-4 border-b border-slate-200/80 dark:border-slate-800">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-display">
              {effectiveWorkspace === 'platform'
                ? 'Users & Ownership'
                : `${managedOwnedClub?.name || 'Club'} Balances`}
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {effectiveWorkspace === 'platform'
              ? `${players.length} users · ${clubs.length} clubs`
              : 'Fee settlements, approvals & wallets'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 w-full lg:w-auto shrink-0">
          {isSiteAdmin && myOwnedClub && (
            <SegmentedControl
              size="sm"
              options={[
                {
                  value: 'platform',
                  label: 'Directory',
                  count: players.length,
                },
                {
                  value: 'owned_club',
                  label: 'Club Ledger',
                  count: (membersByClubIdMap.get(myOwnedClub.id) || []).length,
                },
              ]}
              value={effectiveWorkspace}
              onChange={(val) => {
                setAdminWorkspaceTab(val);
                setSearchQuery('');
                setVisibleMemberCount(30);
              }}
            />
          )}

          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="w-full sm:w-auto h-10 sm:h-9 px-3.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
          >
            <UserPlus className="w-3.5 h-3.5 shrink-0" />
            <span>Add User</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          MODE A: SITE ADMIN PLATFORM DIRECTORY (USERS & CLUBS)
          No financial Received Total / Pending Approval / Due / Wallets shown here!
         ===================================================================== */}
      {effectiveWorkspace === 'platform' && (
        <div className="space-y-6">
          {/* 4-Column Platform Administration KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold">Users</span>
                <Users className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
              </div>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {players.length}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Registered accounts
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold">Clubs</span>
                <Building2 className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
              </div>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {clubs.length}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {sessions.length} sessions
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold">Owners</span>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {totalOwnersCount}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Max 1 club each
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-4 flex flex-col justify-between gap-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold">Your Club</span>
                <Wallet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              {myOwnedClub ? (
                <>
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate font-display">
                    {myOwnedClub.name}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setAdminWorkspaceTab('owned_club');
                      setSearchQuery('');
                    }}
                    className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:underline inline-flex items-center gap-1 self-start cursor-pointer"
                  >
                    <span>Open Ledger</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    None
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Owner-managed
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Unified Platform Directory Workspace Card */}
          <section
            aria-label="Platform Users and Clubs Directory"
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden shadow-2xs"
          >
            {/* Workspace Control Bar */}
            <div className="p-4 sm:px-5 border-b border-slate-200/80 dark:border-slate-800 space-y-3.5 bg-white dark:bg-slate-900">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
                <SegmentedControl
                  size="sm"
                  options={[
                    {
                      value: 'users',
                      label: 'Users',
                      count: players.length,
                    },
                    {
                      value: 'clubs',
                      label: 'Clubs',
                      count: clubs.length,
                    },
                  ]}
                  value={platformSection}
                  onChange={(val) => {
                    setPlatformSection(val);
                  }}
                />

                {platformSection === 'users' && (
                  <SegmentedControl
                    size="sm"
                    options={[
                      {
                        value: 'all',
                        label: 'All',
                        count: players.length,
                      },
                      {
                        value: 'owners',
                        label: 'Owners',
                        count: totalOwnersCount,
                      },
                      {
                        value: 'members',
                        label: 'Members',
                        count: players.length - totalOwnersCount,
                      },
                    ]}
                    value={platformRoleFilter}
                    onChange={(val) => {
                      setPlatformRoleFilter(val);
                      setVisibleMemberCount(30);
                    }}
                  />
                )}
              </div>

              {platformSection === 'users' ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <StyledInput
                    type="text"
                    icon={<Search className="w-4 h-4" />}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setVisibleMemberCount(30);
                    }}
                    onClear={() => {
                      setSearchQuery('');
                      setVisibleMemberCount(30);
                    }}
                    placeholder="Search user name, #tag, or club..."
                  />

                  <StyledSelect
                    aria-label="Filter users by club"
                    value={platformClubFilter}
                    onChange={(e) => {
                      setPlatformClubFilter(e.target.value);
                      setVisibleMemberCount(30);
                    }}
                  >
                    <option value="all">All Platform Clubs ({clubs.length})</option>
                    {clubs.map((c) => (
                      <option key={c.id} value={c.id}>
                        Club: {c.name}
                      </option>
                    ))}
                  </StyledSelect>

                  <StyledSelect
                    aria-label="Sort platform users"
                    value={platformSortBy}
                    onChange={(e) => {
                      setPlatformSortBy(e.target.value as PlatformUserSortKey);
                      setVisibleMemberCount(30);
                    }}
                  >
                    <option value="name_asc">Sort: Name (A → Z)</option>
                    <option value="rating_desc">
                      Sort: Rating Score (High → Low)
                    </option>
                    <option value="games_desc">
                      Sort: Matches Played (High → Low)
                    </option>
                    <option value="clubs_desc">
                      Sort: Joined Clubs (Most → Least)
                    </option>
                  </StyledSelect>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Click any club row to view its members or reassign
                    club ownership.
                  </p>
                  <div className="w-full sm:w-72">
                    <StyledInput
                      type="text"
                      icon={<Search className="w-4 h-4" />}
                      value={clubSearchQuery}
                      onChange={(e) => {
                        setClubSearchQuery(e.target.value);
                        setVisibleClubCount(20);
                      }}
                      onClear={() => {
                        setClubSearchQuery('');
                        setVisibleClubCount(20);
                      }}
                      placeholder="Search clubs or owners..."
                    />
                  </div>
                </div>
              )}

              {/* Contextual shortcut when Admin filters by the club they personally own */}
              {platformSection === 'users' &&
                myOwnedClub &&
                platformClubFilter === myOwnedClub.id && (
                  <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/50 border border-emerald-200/90 dark:border-emerald-800/80 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <span className="text-emerald-950 dark:text-emerald-200">
                      You are the owner of{' '}
                      <strong className="font-semibold">
                        {myOwnedClub.name}
                      </strong>
                      . Switch to your Club Ledger to manage Received Total,
                      Pending Approvals, Due Balances, and Member Wallets.
                    </span>
                    <button
                      type="button"
                      onClick={() => setAdminWorkspaceTab('owned_club')}
                      className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
                    >
                      Open My Club Ledger →
                    </button>
                  </div>
                )}
            </div>

            {/* SUB-VIEW 1: PLATFORM USERS DIRECTORY */}
            {platformSection === 'users' ? (
              <>
                {/* Mobile & Tablet List (< lg) */}
                <div className="lg:hidden divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {filteredPlatformUsers.length === 0 ? (
                    <div className="py-10 px-5 text-center text-xs text-slate-500 dark:text-slate-400">
                      No users match your filter criteria.
                    </div>
                  ) : (
                    visiblePlatformUsers.map(
                      ({ player, joinedClubs, ownedClub }) => {
                        const isSelf = player.id === activePlayer.id;
                        return (
                          <div
                            key={player.id}
                            onClick={() => handleOpenMemberModal(player, false)}
                            className="p-4 bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-bold text-slate-900 dark:text-white">
                                  {player.name}
                                </span>
                                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                  {player.playerTag}
                                </span>
                                {isSelf && (
                                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                    · You
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                                {ownedClub ? (
                                  <strong className="font-semibold text-emerald-800 dark:text-emerald-400">
                                    Owner ({ownedClub.name})
                                  </strong>
                                ) : (
                                  'Member'
                                )}
                                {joinedClubs.length > 0
                                  ? ` · ${joinedClubs.map((c) => c.name).join(', ')}`
                                  : ''}
                              </p>
                            </div>

                            <div className="text-right font-mono tabular-nums shrink-0">
                              <div className="text-xs font-bold text-slate-900 dark:text-white">
                                {player.ratingScore} pts
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {player.wins}W–{player.losses}L
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )
                  )}
                </div>

                {/* Desktop Table (lg+) */}
                <div className="hidden lg:block max-h-[620px] overflow-y-auto overflow-x-hidden bg-white dark:bg-slate-900">
                  <table className="w-full text-left border-collapse bg-white dark:bg-slate-900">
                    <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-950/90 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="py-3 px-4">User Account</th>
                        <th className="py-3 px-3">Platform Role &amp; Ownership</th>
                        <th className="py-3 px-3">Joined Clubs</th>
                        <th className="py-3 px-4 text-right">
                          Rating &amp; Match Record
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs bg-white dark:bg-slate-900">
                      {filteredPlatformUsers.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-10 px-5 text-center text-xs text-slate-500 dark:text-slate-400"
                          >
                            No users match your filter criteria.
                          </td>
                        </tr>
                      ) : (
                        visiblePlatformUsers.map(
                          ({ player, joinedClubs, ownedClub }) => {
                            const isSelf = player.id === activePlayer.id;
                            return (
                              <tr
                                key={player.id}
                                onClick={() =>
                                  handleOpenMemberModal(player, false)
                                }
                                className="bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                              >
                                <td className="py-3 px-4 align-middle">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center justify-center shrink-0 font-display">
                                      {getInitials(player.name)}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-bold text-slate-900 dark:text-white truncate">
                                          {player.name}
                                        </span>
                                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                          {player.playerTag}
                                        </span>
                                        {isSelf && (
                                          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                            · You
                                          </span>
                                        )}
                                        {savedNoticeId === player.id && (
                                          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-0.5">
                                            <Check className="w-3 h-3" />
                                            Saved
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </td>

                                <td className="py-3 px-3 align-middle">
                                  {ownedClub ? (
                                    <div className="text-xs">
                                      <span className="font-semibold text-emerald-800 dark:text-emerald-400">
                                        Club Owner
                                      </span>
                                      <span className="text-slate-400 dark:text-slate-600 mx-1">
                                        ·
                                      </span>
                                      <span className="font-medium text-slate-800 dark:text-slate-200">
                                        {ownedClub.name}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-slate-600 dark:text-slate-400">
                                      Member
                                    </span>
                                  )}
                                </td>

                                <td className="py-3 px-3 align-middle">
                                  <div className="text-xs text-slate-700 dark:text-slate-300 truncate max-w-md">
                                    <span className="font-mono font-semibold text-slate-900 dark:text-white">
                                      {joinedClubs.length}
                                    </span>{' '}
                                    {joinedClubs.length === 1 ? 'club' : 'clubs'}
                                    {joinedClubs.length > 0 && (
                                      <span className="text-slate-500 dark:text-slate-400">
                                        {' '}
                                        ({joinedClubs.map((c) => c.name).join(', ')})
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="py-3 px-4 align-middle text-right font-mono tabular-nums whitespace-nowrap">
                                  <span className="font-bold text-slate-900 dark:text-white">
                                    {player.ratingScore} pts
                                  </span>
                                  <span className="text-slate-400 dark:text-slate-600 mx-1.5">·</span>
                                  <span className="text-slate-600 dark:text-slate-400">
                                    {player.wins}W–{player.losses}L (
                                    {player.gamesPlayed}g)
                                  </span>
                                </td>
                              </tr>
                            );
                          }
                        )
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Footer */}
                {filteredPlatformUsers.length > visibleMemberCount && (
                  <div className="p-3.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">
                      Showing {visiblePlatformUsers.length} of{' '}
                      {filteredPlatformUsers.length} users
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleMemberCount((prev) => prev + 30)
                        }
                        className="h-8 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        Show 30 More
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleMemberCount(filteredPlatformUsers.length)
                        }
                        className="h-8 px-3 rounded-xl font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        Show All ({filteredPlatformUsers.length})
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* SUB-VIEW 2: PLATFORM CLUBS DIRECTORY */
              <div className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 max-h-[620px] overflow-y-auto">
                {filteredPlatformClubs.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    No platform clubs match &ldquo;{clubSearchQuery}&rdquo;.
                  </div>
                ) : (
                  <>
                    {visiblePlatformClubs.map(
                      ({ club, members, sessionCount, isOwnedByMe }) => (
                        <div
                          key={club.id}
                          onClick={() => {
                            setClubModalMemberSearch('');
                            setInspectedPlatformClubId(club.id);
                          }}
                          className="p-4 sm:px-5 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-slate-900 dark:text-white font-display">
                                {club.name}
                              </span>
                              <span className="text-xs text-slate-600 dark:text-slate-400">
                                · Owner:{' '}
                                <strong className="font-semibold text-slate-900 dark:text-slate-200">
                                  {club.clubOwnerName || 'Club owner'}
                                </strong>
                              </span>
                              {isOwnedByMe && (
                                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                  (Owned by You)
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {club.description}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 shrink-0 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            <span>
                              <strong className="text-slate-900 dark:text-white">
                                {members.length}
                              </strong>{' '}
                              {members.length === 1 ? 'member' : 'members'}
                            </span>
                            <span className="text-slate-300 dark:text-slate-700">·</span>
                            <span>
                              <strong className="text-slate-900 dark:text-white">
                                {sessionCount}
                              </strong>{' '}
                              {sessionCount === 1 ? 'session' : 'sessions'}
                            </span>
                            <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">
                              ·
                            </span>
                            <span className="hidden sm:inline text-[11px] font-sans text-slate-500 dark:text-slate-400">
                              Free &gt;{club.freeCancelHours}h · Late{' '}
                              {club.lateCancelFeePercent}%
                            </span>
                          </div>
                        </div>
                      )
                    )}
                    {filteredPlatformClubs.length > visibleClubCount && (
                      <div className="p-3.5 bg-slate-50/50 dark:bg-slate-950/50 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setVisibleClubCount((prev) => prev + 20)
                          }
                          className="h-8 px-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          Show More Clubs (
                          {filteredPlatformClubs.length - visibleClubCount}{' '}
                          remaining)
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* =====================================================================
          MODE B: OWNED CLUB MEMBER BALANCES & WALLETS (100% CLUB-DEPENDENT)
          Only shown for the club owned by `activePlayer` (`managedOwnedClub`)!
         ===================================================================== */}
      {effectiveWorkspace === 'owned_club' && managedOwnedClub && (
        <div className="space-y-6">
          {/* 4-Column Club-Scoped Financial & Roster KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400 min-w-0">
                <span className="font-semibold shrink-0">Members</span>
              </div>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {ownedClubMemberSummaries.length}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {ownedClubCounts.perks} with perks
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold">Received</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold hidden sm:inline">Settled</span>
              </div>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {ledgerMoney(ownedClubLedgerData.clubReceivedTotal)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {ownedClubLedgerData.clubSettledSharesCount} verified
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold">Pending</span>
                <span className="text-blue-700 dark:text-blue-300 font-semibold font-mono tabular-nums">
                  {ownedClubCounts.pendingOnly}
                </span>
              </div>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-300">
                {ledgerMoney(ownedClubLedgerData.clubPendingTotal)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Awaiting verify
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold">Unpaid</span>
                <span className="text-amber-800 dark:text-amber-300 font-semibold font-mono tabular-nums">
                  {ownedClubCounts.owingOnly}
                </span>
              </div>
              <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-amber-800 dark:text-amber-300">
                {ledgerMoney(ownedClubLedgerData.clubUnpaidTotal)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Finalized shares
              </p>
            </div>
          </div>

          {/* Club-Scoped Member Balances & Wallets Directory Table */}
          <section
            aria-label="Club Member Balances and Wallets"
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden shadow-2xs"
          >
            <div className="p-4 sm:px-5 border-b border-slate-200/80 dark:border-slate-800 space-y-3 bg-white dark:bg-slate-900">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                    {managedOwnedClub.name} — Member Balances &amp; Wallets (
                    {filteredOwnedClubSummaries.length})
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    All balances, credits, free session passes, and fee waivers
                    below are scoped exclusively to {managedOwnedClub.name}.
                  </p>
                </div>

                <SegmentedControl
                  size="sm"
                  options={[
                    {
                      value: 'all',
                      label: 'All Members',
                      count: ownedClubMemberSummaries.length,
                    },
                    {
                      value: 'owing',
                      label: 'Due / Pending',
                      count: ownedClubCounts.owingOrPending,
                    },
                    {
                      value: 'perks',
                      label: 'Credits & Waivers',
                      count: ownedClubCounts.perks,
                    },
                  ]}
                  value={ledgerFilter}
                  onChange={(val) => {
                    setLedgerFilter(val);
                    setVisibleMemberCount(30);
                  }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <StyledInput
                  type="text"
                  icon={<Search className="w-4 h-4" />}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setVisibleMemberCount(30);
                  }}
                  onClear={() => {
                    setSearchQuery('');
                    setVisibleMemberCount(30);
                  }}
                  placeholder="Search club member or #tag..."
                />

                <StyledSelect
                  aria-label="Sort club members"
                  value={ledgerSortBy}
                  onChange={(e) => {
                    setLedgerSortBy(e.target.value as ClubBalanceSortKey);
                    setVisibleMemberCount(30);
                  }}
                >
                  <option value="due_desc">
                    Sort: Due Balance (High → Low)
                  </option>
                  <option value="pending_desc">
                    Sort: Pending Approval First
                  </option>
                  <option value="received_desc">
                    Sort: Received Total (High → Low)
                  </option>
                  <option value="rating_desc">
                    Sort: Rating Score (High → Low)
                  </option>
                  <option value="name_asc">Sort: Member Name (A → Z)</option>
                </StyledSelect>
              </div>
            </div>

            {/* Mobile & Tablet List (< lg) */}
            <div className="lg:hidden divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {filteredOwnedClubSummaries.length === 0 ? (
                <div className="py-10 px-5 text-center text-xs text-slate-500 dark:text-slate-400">
                  No club members match your current filter criteria.
                </div>
              ) : (
                visibleOwnedClubSummaries.map((item) => {
                  const {
                    player,
                    isClubOwner,
                    clubWallet,
                    totalUnpaid,
                    totalPending,
                    unpaidCount,
                    pendingCount,
                  } = item;

                  return (
                    <div
                      key={player.id}
                      onClick={() => handleOpenMemberModal(player, true)}
                      className="p-4 bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-900 dark:text-white">
                            {player.name}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {player.playerTag}
                          </span>
                          {isClubOwner && (
                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                              · Club Owner
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                          <span className="font-mono">
                            {player.ratingScore} pts
                          </span>
                          <span>·</span>
                          {clubWallet.waiveAllFees ? (
                            <span className="text-purple-700 dark:text-purple-300 font-semibold">
                              VIP Waived
                            </span>
                          ) : clubWallet.freeSessionPasses > 0 ? (
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                              {clubWallet.freeSessionPasses} Free Pass
                            </span>
                          ) : clubWallet.creditBalance > 0 ? (
                            <span className="text-sky-700 dark:text-sky-300 font-mono font-semibold">
                              {ledgerMoney(clubWallet.creditBalance)} Credit
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">Standard</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right font-mono tabular-nums">
                          {totalUnpaid > 0 ? (
                            <>
                              <div className="text-sm font-bold text-amber-800 dark:text-amber-300">
                                {ledgerMoney(totalUnpaid)}
                              </div>
                              <div className="text-[10px] font-sans text-amber-700 dark:text-amber-400">
                                {unpaidCount} unpaid
                              </div>
                            </>
                          ) : totalPending > 0 ? (
                            <>
                              <div className="text-sm font-bold text-blue-700 dark:text-blue-300">
                                {ledgerMoney(totalPending)}
                              </div>
                              <div className="text-[10px] font-sans text-blue-700 dark:text-blue-400">
                                {pendingCount} pending
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                                {ledgerMoney(0)}
                              </div>
                              <div className="text-[10px] font-sans text-slate-400 dark:text-slate-500">
                                Settled
                              </div>
                            </>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" aria-hidden="true" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table (lg+) */}
            <div className="hidden lg:block max-h-[620px] overflow-y-auto overflow-x-hidden bg-white dark:bg-slate-900">
              <table className="w-full text-left border-collapse bg-white dark:bg-slate-900">
                <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-950/90 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="py-3 px-4">Club Member</th>
                    <th className="py-3 px-3 text-right">
                      Rating &amp; Attendance
                    </th>
                    <th className="py-3 px-3">Club Credits &amp; Waivers</th>
                    <th className="py-3 px-3 text-right">Received</th>
                    <th className="py-3 px-4 text-right">Due / Pending</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs bg-white dark:bg-slate-900">
                  {filteredOwnedClubSummaries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-10 px-5 text-center text-xs text-slate-500 dark:text-slate-400"
                      >
                        No club members match your current filter criteria.
                      </td>
                    </tr>
                  ) : (
                    visibleOwnedClubSummaries.map((item) => {
                      const {
                        player,
                        isClubOwner,
                        clubWallet,
                        sessionsAttendedCount,
                        paidSessionsCount,
                        totalReceived,
                        totalUnpaid,
                        totalPending,
                        unpaidCount,
                        pendingCount,
                      } = item;

                      return (
                        <tr
                          key={player.id}
                          onClick={() => handleOpenMemberModal(player, true)}
                          className="group bg-white dark:bg-slate-900 hover:bg-slate-50/90 dark:hover:bg-slate-800/55 transition-colors cursor-pointer"
                        >
                          <td className="py-3.5 px-4 align-middle">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center justify-center shrink-0 font-display group-hover:border-slate-300 dark:group-hover:border-slate-600 transition-colors">
                                {getInitials(player.name)}
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-bold text-slate-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                                    {player.name}
                                  </span>
                                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                    {player.playerTag}
                                  </span>
                                  {isClubOwner && (
                                    <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                      · Club Owner
                                    </span>
                                  )}
                                  {savedNoticeId === player.id && (
                                    <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-0.5">
                                      <Check className="w-3 h-3" />
                                      Saved
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-3 align-middle text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {player.ratingScore} pts
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {player.wins}W–{player.losses}L ·{' '}
                              {sessionsAttendedCount}s in club
                            </div>
                          </td>

                          <td className="py-3.5 px-3 align-middle">
                            <div className="flex flex-wrap items-center gap-2">
                              {clubWallet.waiveAllFees && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-800 dark:text-purple-300">
                                  <Sparkles className="w-3 h-3 text-purple-600 dark:text-purple-400 shrink-0" />
                                  VIP Waived
                                </span>
                              )}
                              {clubWallet.freeSessionPasses > 0 && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                                  <Ticket className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  {clubWallet.freeSessionPasses} Free Pass
                                  {clubWallet.freeSessionPasses === 1
                                    ? ''
                                    : 'es'}
                                </span>
                              )}
                              {clubWallet.creditBalance > 0 && (
                                <span className="text-[11px] font-mono tabular-nums font-semibold text-sky-800 dark:text-sky-300">
                                  {ledgerMoney(clubWallet.creditBalance)} Credit
                                </span>
                              )}
                              {!clubWallet.waiveAllFees &&
                                clubWallet.freeSessionPasses <= 0 &&
                                clubWallet.creditBalance <= 0 && (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Standard
                                  </span>
                                )}
                            </div>
                          </td>

                          <td className="py-3.5 px-3 align-middle text-right font-mono tabular-nums whitespace-nowrap">
                            <div
                              className={`font-semibold ${
                                totalReceived > 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {ledgerMoney(totalReceived)}
                            </div>
                            <div className="text-[10px] font-sans text-slate-500 dark:text-slate-400">
                              {paidSessionsCount} settled
                            </div>
                          </td>

                          <td className="py-3.5 px-4 align-middle text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-2.5">
                              <div>
                                {totalUnpaid > 0 ? (
                                  <>
                                    <div className="font-bold text-amber-800 dark:text-amber-300">
                                      {ledgerMoney(totalUnpaid)}
                                    </div>
                                    <div className="text-[10px] font-sans text-amber-700 dark:text-amber-400">
                                      {unpaidCount} unpaid
                                    </div>
                                  </>
                                ) : totalPending > 0 ? (
                                  <>
                                    <div className="font-bold text-blue-700 dark:text-blue-300">
                                      {ledgerMoney(totalPending)}
                                    </div>
                                    <div className="text-[10px] font-sans text-blue-700 dark:text-blue-400">
                                      {pendingCount} pending approval
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="font-semibold text-slate-500 dark:text-slate-400">
                                      {ledgerMoney(0)}
                                    </div>
                                    <div className="text-[10px] font-sans text-slate-400 dark:text-slate-500">
                                      Settled
                                    </div>
                                  </>
                                )}
                              </div>
                              <ChevronRight
                                className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 group-hover:text-slate-600 dark:group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all shrink-0"
                                aria-hidden="true"
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {filteredOwnedClubSummaries.length > 0 && (
                  <tfoot className="bg-slate-50/80 dark:bg-slate-950/70 border-t border-slate-200 dark:border-slate-800 text-xs font-mono tabular-nums">
                    <tr>
                      <td
                        colSpan={3}
                        className="py-3 px-4 font-sans font-semibold text-slate-700 dark:text-slate-300"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            Showing {visibleOwnedClubSummaries.length} of{' '}
                            {filteredOwnedClubSummaries.length} club members
                          </span>
                          {filteredOwnedClubSummaries.length >
                            visibleMemberCount && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setVisibleMemberCount((prev) => prev + 30)
                                }
                                className="h-7 px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                              >
                                +30 More
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setVisibleMemberCount(
                                    filteredOwnedClubSummaries.length
                                  )
                                }
                                className="h-7 px-2 rounded-lg text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                              >
                                Show All
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-700 dark:text-emerald-400">
                        {ledgerMoney(filteredLedgerTotals.received)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-amber-800 dark:text-amber-300">
                        {ledgerMoney(filteredLedgerTotals.unpaid)} due
                        {filteredLedgerTotals.pending > 0
                          ? ` · ${ledgerMoney(filteredLedgerTotals.pending)} pend`
                          : ''}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        </div>
      )}

      {/* =====================================================================
          MODAL 1: REGISTER NEW USER ACCOUNT
         ===================================================================== */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            {...backdropClose(() => setShowCreateForm(false))}
          >
            <motion.section
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16, transition: { duration: 0.12, ease: 'easeIn' } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full max-h-[90dvh] flex flex-col overflow-hidden shadow-xl"
            >
              <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
              </div>
              <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white font-display">
                    Add Member
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Creates a player profile ready to join clubs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  aria-label="Close add member modal"
                  className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form
                noValidate
                onSubmit={handleCreateSubmit}
                className="flex flex-col flex-1 min-h-0"
              >
                <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain flex-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <StyledInput
                      label="Full Name"
                      type="text"
                      maxLength={80}
                      value={newName}
                      error={createUserErrors.name}
                      onChange={(e) => {
                        setNewName(e.target.value);
                        if (createUserErrors.name)
                          setCreateUserErrors((prev) => ({
                            ...prev,
                            name: undefined,
                          }));
                      }}
                      placeholder="e.g. Jordan Lim"
                    />
                    <StyledInput
                      label="Initial Rating"
                      type="number"
                      min={800}
                      max={3000}
                      value={newRating}
                      error={createUserErrors.rating}
                      onChange={(e) => {
                        setNewRating(parseInt(e.target.value, 10) || 0);
                        if (createUserErrors.rating)
                          setCreateUserErrors((prev) => ({
                            ...prev,
                            rating: undefined,
                          }));
                      }}
                      className="font-mono tabular-nums"
                    />
                  </div>
                </div>

                <div className="px-4 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 shrink-0 [&>button]:w-full sm:[&>button]:w-auto">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="h-10 sm:h-9 px-3.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white bg-slate-200/80 dark:bg-slate-800 sm:bg-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl inline-flex items-center justify-center whitespace-nowrap cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-10 sm:h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center whitespace-nowrap cursor-pointer shadow-xs"
                  >
                    Create Account
                  </button>
                </div>
              </form>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          MODAL 2: PLATFORM CLUB ROSTER & OWNERSHIP INSPECTION MODAL (ADMIN)
          Shows roster & owner assignment. Does NOT expose other clubs' financial balances!
         ===================================================================== */}
      <AnimatePresence>
        {inspectedPlatformClubId &&
          (() => {
            const club = clubByIdMap.get(inspectedPlatformClubId);
            if (!club) return null;
            const allClubMembers = membersByClubIdMap.get(club.id) || [];
            const q = deferredClubModalMemberSearch.trim().toLowerCase();
            const filteredClubMembers = q
              ? allClubMembers.filter(
                  (m) =>
                    m.name.toLowerCase().includes(q) ||
                    m.playerTag.toLowerCase().includes(q)
                )
              : allClubMembers;
            const isOwnedByCurrentAdmin =
              club.clubOwnerPlayerId === activePlayer.id;

            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
                {...backdropClose(() => setInspectedPlatformClubId(null))}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 16, transition: { duration: 0.12, ease: 'easeIn' } }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-2xl w-full max-h-[90dvh] flex flex-col overflow-hidden"
                >
                  <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
                    <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
                  </div>
                  <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white truncate font-display">
                        {club.name} ({allClubMembers.length})
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        Owner:{' '}
                        <strong className="font-semibold text-slate-900 dark:text-slate-200">
                          {club.clubOwnerName || 'Club owner'}
                        </strong>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectedPlatformClubId(null)}
                      aria-label="Close club members modal"
                      className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-4 sm:p-5 overflow-y-auto overscroll-contain flex-1 space-y-4">
                    {isOwnedByCurrentAdmin && (
                      <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <span className="text-emerald-950 dark:text-emerald-200 font-medium">
                          You own this club. Open your Club Ledger to manage
                          Received Total, Pending Approvals, Due Balances, and
                          Wallets.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setInspectedPlatformClubId(null);
                            setAdminWorkspaceTab('owned_club');
                          }}
                          className="w-full sm:w-auto h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Open Club Ledger →
                        </button>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="w-full sm:w-64">
                        <StyledInput
                          type="text"
                          icon={<Search className="w-3.5 h-3.5" />}
                          value={clubModalMemberSearch}
                          onChange={(e) =>
                            setClubModalMemberSearch(e.target.value)
                          }
                          onClear={() => setClubModalMemberSearch('')}
                          placeholder="Filter club members..."
                        />
                      </div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Select any member to inspect profile or ownership
                      </span>
                    </div>

                    {filteredClubMembers.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                        No members match your filter.
                      </p>
                    ) : (
                      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                        {/* Mobile cards (< sm) */}
                        <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
                          {filteredClubMembers.map((m) => {
                            const isOwner = club.clubOwnerPlayerId === m.id;
                            return (
                              <div
                                key={m.id}
                                onClick={() => {
                                  setInspectedPlatformClubId(null);
                                  handleOpenMemberModal(
                                    m,
                                    isOwnedByCurrentAdmin
                                  );
                                }}
                                className="px-3.5 py-2.5 bg-white dark:bg-slate-900 hover:bg-slate-50/90 dark:hover:bg-slate-800/60 transition-colors cursor-pointer flex items-center justify-between gap-2.5 text-xs"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-semibold text-slate-900 dark:text-white truncate">
                                      {m.name}
                                    </span>
                                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                      {m.playerTag}
                                    </span>
                                  </div>
                                  <span
                                    className={`text-[11px] ${
                                      isOwner
                                        ? 'font-semibold text-emerald-800 dark:text-emerald-400'
                                        : 'text-slate-600 dark:text-slate-400'
                                    }`}
                                  >
                                    {isOwner ? 'Club Owner' : 'Member'}
                                  </span>
                                </div>
                                <span className="font-mono tabular-nums text-[11px] text-slate-700 dark:text-slate-300 shrink-0 text-right">
                                  {m.ratingScore} pts · {m.wins}W–{m.losses}L
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Desktop table (sm+) */}
                        <table className="hidden sm:table w-full text-left border-collapse">
                          <thead className="bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                            <tr>
                              <th className="py-2.5 px-3.5">Member</th>
                              <th className="py-2.5 px-3">Club Role</th>
                              <th className="py-2.5 px-3.5 text-right">
                                Rating &amp; W–L
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                            {filteredClubMembers.map((m) => {
                              const isOwner = club.clubOwnerPlayerId === m.id;
                              return (
                                <tr
                                  key={m.id}
                                  onClick={() => {
                                    setInspectedPlatformClubId(null);
                                    handleOpenMemberModal(
                                      m,
                                      isOwnedByCurrentAdmin
                                    );
                                  }}
                                  className="bg-white dark:bg-slate-900 hover:bg-slate-50/90 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                                >
                                  <td className="py-2.5 px-3.5">
                                    <span className="font-semibold text-slate-900 dark:text-white">
                                      {m.name}
                                    </span>
                                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 ml-1.5">
                                      {m.playerTag}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {isOwner ? (
                                      <span className="font-semibold text-emerald-800 dark:text-emerald-400">
                                        Club Owner
                                      </span>
                                    ) : (
                                      <span className="text-slate-600 dark:text-slate-400">
                                        Member
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                    {m.ratingScore} pts · {m.wins}W–{m.losses}L
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="px-4 sm:px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => setInspectedPlatformClubId(null)}
                      className="w-full sm:w-auto h-10 sm:h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer shadow-xs"
                    >
                      Close
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            );
          })()}
      </AnimatePresence>

      {/* =====================================================================
          MODAL 3: MEMBER DETAILS MODAL
          - If `editingInLedgerMode && managedOwnedClub`: Shows Club-Scoped Bills,
            Approvals, and Club-Scoped Wallet (Credits, Passes, Waiver) for `managedOwnedClub`.
          - If Platform Admin Mode (`!editingInLedgerMode`): Shows clean User Account &
            Club Ownership Editor (Zero irrelevant financial/wallet noise!).
         ===================================================================== */}
      <AnimatePresence>
        {editingPlayerId &&
          (() => {
            const platformItem = platformUserSummaryById.get(editingPlayerId);
            if (!platformItem) return null;
            const { player, joinedClubs, ownedClub } = platformItem;

            const showClubFinancials = Boolean(
              editingInLedgerMode && managedOwnedClub
            );
            const ledgerItem = showClubFinancials
              ? ownedClubSummaryByPlayerId.get(player.id)
              : undefined;

            const currentWallet =
              showClubFinancials && managedOwnedClub
                ? getPlayerClubWallet(player, managedOwnedClub.id, walletsMap)
                : { creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false };

            const currentCredit = currentWallet.creditBalance;
            const currentPasses = currentWallet.freeSessionPasses;
            const currentWaived = currentWallet.waiveAllFees;

            const debts = ledgerItem ? ledgerItem.debts : [];
            const totalReceived = ledgerItem ? ledgerItem.totalReceived : 0;
            const paidSessionsCount = ledgerItem
              ? ledgerItem.paidSessionsCount
              : 0;
            const totalUnpaid = ledgerItem ? ledgerItem.totalUnpaid : 0;
            const totalPending = ledgerItem ? ledgerItem.totalPending : 0;
            const unpaidCount = ledgerItem ? ledgerItem.unpaidCount : 0;
            const pendingCount = ledgerItem ? ledgerItem.pendingCount : 0;

            const totalOpenAmount =
              Math.round((totalUnpaid + totalPending) * 100) / 100;
            const activeTab: 'payments' | 'wallet' | 'details' =
              showClubFinancials && managedOwnedClub
                ? memberModalTab === 'wallet' && !onUpdatePlayerWallet
                  ? 'payments'
                  : memberModalTab
                : 'details';
            const initialOwnedClubId = ownedClub ? ownedClub.id : 'NONE';
            const hasProfileChanges =
              isSiteAdmin &&
              (editName.trim() !== player.name ||
                editOwnedClubId !== initialOwnedClubId);
            const walletSummaryLabel = currentWaived
              ? 'VIP'
              : currentCredit > 0
              ? ledgerMoney(currentCredit)
              : currentPasses > 0
              ? `${currentPasses}p`
              : null;

            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                role="dialog"
                aria-modal="true"
                aria-label={`${player.name} member management`}
                className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
                {...backdropClose(() => setEditingPlayerId(null))}
              >
                <motion.form
                  noValidate
                  initial={{ opacity: 0, scale: 0.97, y: 18 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    scale: 0.97,
                    y: 18,
                    transition: { duration: 0.12, ease: 'easeIn' },
                  }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  onSubmit={(e) => handleSaveEdit(e, player)}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border-t sm:border border-slate-200 dark:border-slate-800 shadow-2xl max-w-xl w-full max-h-[90dvh] flex flex-col overflow-hidden"
                >
                  {/* Mobile Drag Handle */}
                  <div
                    className="sm:hidden flex justify-center pt-2.5 pb-0.5 shrink-0"
                    aria-hidden="true"
                  >
                    <span className="w-9 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
                  </div>

                  {/* Compact Modal Header + Focused Section Tabs */}
                  <div className="px-4 sm:px-6 pt-3 sm:pt-4 pb-3 border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shrink-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center shrink-0 font-display">
                          {getInitials(player.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2 min-w-0">
                            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white font-display truncate">
                              {player.name}
                            </h3>
                            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 shrink-0">
                              {player.playerTag}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            <span className="font-mono tabular-nums">
                              {player.ratingScore} pts ({player.wins}W–
                              {player.losses}L)
                            </span>
                            {showClubFinancials && managedOwnedClub && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate max-w-[160px] sm:max-w-[220px]">
                                  {managedOwnedClub.name}
                                </span>
                              </>
                            )}
                            {onOpenPlayerProfile && (
                              <>
                                <span aria-hidden="true">·</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingPlayerId(null);
                                    onOpenPlayerProfile(player.id);
                                  }}
                                  className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer whitespace-nowrap"
                                >
                                  Profile →
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingPlayerId(null)}
                        className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer shrink-0"
                        aria-label="Close modal"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Focused Workspace Tabs (Only shown in Club Ledger Mode) */}
                    {showClubFinancials && managedOwnedClub && (
                      <div
                        role="tablist"
                        aria-label="Member ledger sections"
                        className={`grid ${
                          onUpdatePlayerWallet ? 'grid-cols-3' : 'grid-cols-2'
                        } gap-1 p-1 rounded-xl bg-slate-100/95 dark:bg-slate-800/85 border border-slate-200/80 dark:border-slate-700/70`}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeTab === 'payments'}
                          onClick={() => setMemberModalTab('payments')}
                          className={`relative h-9 rounded-lg px-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors duration-150 whitespace-nowrap cursor-pointer active:scale-[0.98] ${
                            activeTab === 'payments'
                              ? 'text-slate-950 dark:text-white font-bold'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          {activeTab === 'payments' && (
                            <motion.span
                              layoutId="member-modal-tab-pill"
                              transition={{ type: 'spring', stiffness: 460, damping: 36, mass: 0.85 }}
                              className="absolute inset-0 bg-white dark:bg-slate-900 rounded-lg shadow-xs ring-1 ring-slate-900/8 dark:ring-white/10"
                              aria-hidden="true"
                            />
                          )}
                          <Receipt className="relative z-10 w-3.5 h-3.5 shrink-0" />
                          <span className="relative z-10">Payments</span>
                          {debts.length > 0 && (
                            <span
                              className={`relative z-10 font-mono tabular-nums text-[11px] font-bold ${
                                totalPending > 0
                                  ? 'text-blue-700 dark:text-blue-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {debts.length}
                            </span>
                          )}
                        </button>

                        {onUpdatePlayerWallet && (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'wallet'}
                            onClick={() => setMemberModalTab('wallet')}
                            className={`relative h-9 rounded-lg px-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors duration-150 whitespace-nowrap cursor-pointer active:scale-[0.98] ${
                              activeTab === 'wallet'
                                ? 'text-slate-950 dark:text-white font-bold'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                            }`}
                          >
                            {activeTab === 'wallet' && (
                              <motion.span
                                layoutId="member-modal-tab-pill"
                                transition={{ type: 'spring', stiffness: 460, damping: 36, mass: 0.85 }}
                                className="absolute inset-0 bg-white dark:bg-slate-900 rounded-lg shadow-xs ring-1 ring-slate-900/8 dark:ring-white/10"
                                aria-hidden="true"
                              />
                            )}
                            <Wallet className="relative z-10 w-3.5 h-3.5 shrink-0" />
                            <span className="relative z-10">Wallet</span>
                            {walletSummaryLabel && (
                              <span className="relative z-10 font-mono tabular-nums text-[11px] font-bold text-emerald-700 dark:text-emerald-400 truncate max-w-[54px]">
                                {walletSummaryLabel}
                              </span>
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeTab === 'details'}
                          onClick={() => setMemberModalTab('details')}
                          className={`relative h-9 rounded-lg px-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors duration-150 whitespace-nowrap cursor-pointer active:scale-[0.98] ${
                            activeTab === 'details'
                              ? 'text-slate-950 dark:text-white font-bold'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          {activeTab === 'details' && (
                            <motion.span
                              layoutId="member-modal-tab-pill"
                              transition={{ type: 'spring', stiffness: 460, damping: 36, mass: 0.85 }}
                              className="absolute inset-0 bg-white dark:bg-slate-900 rounded-lg shadow-xs ring-1 ring-slate-900/8 dark:ring-white/10"
                              aria-hidden="true"
                            />
                          )}
                          <UserCog className="relative z-10 w-3.5 h-3.5 shrink-0" />
                          <span className="relative z-10">Details</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Inline Instant-Save Feedback Strip */}
                  <AnimatePresence initial={false}>
                    {modalActionFeedback && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                        role="status"
                        aria-live="polite"
                        className="px-4 sm:px-6 py-2.5 bg-emerald-50 dark:bg-emerald-950/60 border-b border-emerald-200/80 dark:border-emerald-800/70 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2 shrink-0"
                      >
                        <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          <span className="truncate">{modalActionFeedback}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setModalActionFeedback(null)}
                          className="text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline shrink-0 cursor-pointer"
                        >
                          Dismiss
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Scrollable Focused Tab Content with Smooth Transitions */}
                  <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain flex-1">
                    <AnimatePresence mode="wait" initial={false}>
                    {/* =========================================================
                        TAB 1: PAYMENTS (Compact 3-Col Summary + Right-Aligned Bills)
                       ========================================================= */}
                    {activeTab === 'payments' &&
                      showClubFinancials &&
                      managedOwnedClub && (
                        <motion.div
                          key="tab-payments"
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -3 }}
                          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                          className="space-y-4"
                        >
                          {/* Compact 3-Column Balance Strip */}
                          <div className="grid grid-cols-3 divide-x divide-slate-200/80 dark:divide-slate-800/90 rounded-2xl bg-slate-50/85 dark:bg-slate-950/55 border border-slate-200/80 dark:border-slate-800">
                            <div className="px-3 sm:px-4 py-3 text-center sm:text-left">
                              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                                Due
                              </span>
                              <span
                                className={`text-sm sm:text-base font-bold font-mono tabular-nums mt-0.5 block ${
                                  totalUnpaid > 0
                                    ? 'text-amber-700 dark:text-amber-300'
                                    : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {ledgerMoney(totalUnpaid)}
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                                {unpaidCount === 0
                                  ? 'Clear'
                                  : `${unpaidCount} unpaid`}
                              </span>
                            </div>

                            <div className="px-3 sm:px-4 py-3 text-center sm:text-left">
                              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                                Pending
                              </span>
                              <span
                                className={`text-sm sm:text-base font-bold font-mono tabular-nums mt-0.5 block ${
                                  totalPending > 0
                                    ? 'text-blue-700 dark:text-blue-300'
                                    : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {ledgerMoney(totalPending)}
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                                {pendingCount === 0
                                  ? 'None'
                                  : `${pendingCount} to verify`}
                              </span>
                            </div>

                            <div className="px-3 sm:px-4 py-3 text-center sm:text-left">
                              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                                Received
                              </span>
                              <span
                                className={`text-sm sm:text-base font-bold font-mono tabular-nums mt-0.5 block ${
                                  totalReceived > 0
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {ledgerMoney(totalReceived)}
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                                {paidSessionsCount} settled
                              </span>
                            </div>
                          </div>

                          {/* Open Bills List or Clean Settled State */}
                          {debts.length === 0 ? (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.98 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                              className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 px-4 py-8 text-center space-y-1.5"
                            >
                              <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-2">
                                <CheckCircle2 className="w-5 h-5" />
                              </div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                All session bills settled
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                                {player.name} has no unpaid or pending balances in{' '}
                                {managedOwnedClub.name}.
                              </p>
                            </motion.div>
                          ) : (
                            <div className="space-y-3">
                              {/* Section Header & Primary Bulk Settle Action */}
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
                                <div className="text-xs text-slate-600 dark:text-slate-400">
                                  <span className="font-semibold text-slate-900 dark:text-white">
                                    {debts.length} open{' '}
                                    {debts.length === 1 ? 'bill' : 'bills'}
                                  </span>{' '}
                                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700 mx-0.5">
                                    ·
                                  </span>{' '}
                                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                                    {ledgerMoney(totalOpenAmount)}
                                  </span>{' '}
                                  total
                                </div>

                                {(debts.length > 1 ||
                                  (totalPending > 0 && onRejectAllForPlayer)) && (
                                  <div className="flex items-center justify-end gap-2 shrink-0">
                                    {totalPending > 0 && onRejectAllForPlayer && (
                                      <button
                                        type="button"
                                        disabled={Boolean(busyPaymentAction)}
                                        onClick={() =>
                                          setPendingRejectPlayer(player)
                                        }
                                        className="h-9 px-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/60 hover:border-rose-300 dark:hover:border-rose-800 hover:text-rose-700 dark:hover:text-rose-300 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-all duration-150 active:scale-[0.97] disabled:opacity-50"
                                      >
                                        <X className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                                        <span>Reject Pending</span>
                                      </button>
                                    )}

                                    {debts.length > 1 && (
                                      <button
                                        type="button"
                                        disabled={Boolean(busyPaymentAction)}
                                        onClick={async () => {
                                          const amountLabel =
                                            ledgerMoney(totalOpenAmount);
                                          const billCount = debts.length;
                                          setBusyPaymentAction('all');
                                          try {
                                            await onAcceptOrClearAllForPlayer(
                                              player.id,
                                              'Received',
                                              managedOwnedClub.id
                                            );
                                            showModalFeedback(
                                              `Confirmed ${billCount} bills (${amountLabel}) as received`
                                            );
                                          } finally {
                                            setBusyPaymentAction(null);
                                          }
                                        }}
                                        className="flex-1 sm:flex-initial h-9 px-3.5 bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs transition-all duration-150 active:scale-[0.97] disabled:opacity-60"
                                      >
                                        {busyPaymentAction === 'all' ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                        ) : (
                                          <Check className="w-3.5 h-3.5 shrink-0" />
                                        )}
                                        <span>
                                          Confirm All ({ledgerMoney(totalOpenAmount)})
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Individual Session Bill Rows — Crisp Left Info + Right-Aligned Amount & Action */}
                              <div className="divide-y divide-slate-200/75 dark:divide-slate-800/90 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-950/35 overflow-hidden">
                                <AnimatePresence initial={false}>
                                  {debts.map(({ rsvp, session }) => {
                                    const isPending =
                                      rsvp.paidStatus === 'pending_approval';
                                    const isRowBusy =
                                      busyPaymentAction === rsvp.id ||
                                      busyPaymentAction === 'all';
                                    const isSinglePrimary = debts.length === 1;
                                    return (
                                      <motion.div
                                        key={rsvp.id}
                                        layout
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                                        className="px-3.5 sm:px-4 py-3.5 hover:bg-slate-50/75 dark:hover:bg-slate-800/30 transition-colors"
                                      >
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
                                          {/* Left: Session Title + Date/Status (with inline mobile amount on right) */}
                                          <div className="flex items-start justify-between gap-3 min-w-0 flex-1">
                                            <div className="min-w-0 space-y-0.5">
                                              {onOpenSessionLedger ? (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setEditingPlayerId(null);
                                                    onOpenSessionLedger(session.id);
                                                  }}
                                                  className="group/link text-sm font-semibold text-slate-900 dark:text-white hover:text-emerald-700 dark:hover:text-emerald-400 truncate cursor-pointer inline-flex items-center gap-1 max-w-full text-left transition-colors"
                                                >
                                                  <span className="truncate group-hover/link:underline">
                                                    {session.title}
                                                  </span>
                                                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover/link:text-emerald-600 dark:group-hover/link:text-emerald-400 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform shrink-0" />
                                                </button>
                                              ) : (
                                                <span className="text-sm font-semibold text-slate-900 dark:text-white truncate block">
                                                  {session.title}
                                                </span>
                                              )}

                                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                                                <span className="font-mono tabular-nums text-[11px] sm:text-xs">
                                                  {session.sessionDate}
                                                </span>
                                                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                                                  ·
                                                </span>
                                                <span
                                                  className={`font-semibold ${
                                                    isPending
                                                      ? 'text-blue-700 dark:text-blue-300'
                                                      : 'text-amber-700 dark:text-amber-300'
                                                  }`}
                                                >
                                                  {isPending
                                                    ? `Pending (${rsvp.paidMethod})`
                                                    : 'Unpaid'}
                                                </span>
                                              </div>
                                            </div>

                                            {/* Mobile-only amount top-right */}
                                            <span className="sm:hidden text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white shrink-0 pt-0.5">
                                              {ledgerMoney(rsvp.feeShare)}
                                            </span>
                                          </div>

                                          {/* Right: Desktop Amount + Right-Aligned Action Cluster */}
                                          <div className="flex items-center justify-end gap-2 sm:gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800/80">
                                            <span className="hidden sm:inline-block text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white text-right min-w-[4.25rem] shrink-0">
                                              {ledgerMoney(rsvp.feeShare)}
                                            </span>

                                            {isPending && onRejectPaymentForRsvp && (
                                              <button
                                                type="button"
                                                disabled={Boolean(busyPaymentAction)}
                                                onClick={() =>
                                                  setPendingRejectSingleRsvp(rsvp)
                                                }
                                                className="h-9 sm:h-8 px-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/60 hover:border-rose-300 dark:hover:border-rose-800 text-slate-600 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-300 text-xs font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer transition-all duration-150 active:scale-[0.97] disabled:opacity-50"
                                              >
                                                <X className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                                                <span>Reject</span>
                                              </button>
                                            )}

                                            {onAcceptOrClearSingleRsvp && (
                                              <button
                                                type="button"
                                                disabled={Boolean(busyPaymentAction)}
                                                onClick={async () => {
                                                  const amt = ledgerMoney(
                                                    rsvp.feeShare
                                                  );
                                                  setBusyPaymentAction(rsvp.id);
                                                  try {
                                                    await onAcceptOrClearSingleRsvp(
                                                      rsvp.id,
                                                      'Received'
                                                    );
                                                    showModalFeedback(
                                                      `Confirmed ${amt} for ${session.title}`
                                                    );
                                                  } finally {
                                                    setBusyPaymentAction(null);
                                                  }
                                                }}
                                                className={`h-9 sm:h-8 px-3 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-all duration-150 active:scale-[0.97] disabled:opacity-60 ${
                                                  isSinglePrimary
                                                    ? 'bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 text-white shadow-xs'
                                                    : 'bg-emerald-50/90 dark:bg-emerald-500/12 hover:bg-emerald-600 dark:hover:bg-emerald-600 text-emerald-700 dark:text-emerald-300 hover:text-white dark:hover:text-white border border-emerald-200/90 dark:border-emerald-500/35 hover:border-emerald-600 dark:hover:border-emerald-500'
                                                }`}
                                              >
                                                {isRowBusy ? (
                                                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                                ) : (
                                                  <Check className="w-3.5 h-3.5 shrink-0" />
                                                )}
                                                <span>Confirm Received</span>
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </motion.div>
                                    );
                                  })}
                                </AnimatePresence>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}

                    {/* =========================================================
                        TAB 2: CLUB WALLET & PERKS (Instant-Apply Controls)
                       ========================================================= */}
                    {activeTab === 'wallet' &&
                      showClubFinancials &&
                      managedOwnedClub &&
                      onUpdatePlayerWallet && (
                        <motion.div
                          key="tab-wallet"
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -3 }}
                          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                          className="space-y-4"
                        >
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Strictly applies to sessions in{' '}
                            <strong className="font-semibold text-slate-700 dark:text-slate-200">
                              {managedOwnedClub.name}
                            </strong>
                            . Adjustments save immediately.
                          </p>

                          {/* Prepaid Credit */}
                          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/45 p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <span className="text-sm font-bold text-slate-900 dark:text-white block">
                                  Prepaid Credit
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  Auto-deducted on finalized splits
                                </span>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="text-lg font-bold text-sky-700 dark:text-sky-300 font-mono tabular-nums block">
                                  {ledgerMoney(currentCredit)}
                                </span>
                                {currentCredit > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPendingResetCreditPlayer(player)
                                    }
                                    className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                                  >
                                    Reset to {ledgerMoney(0)}
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              {[10, 20, 50].map((amt) => (
                                <button
                                  key={amt}
                                  type="button"
                                  onClick={() => {
                                    onUpdatePlayerWallet(
                                      player.id,
                                      {
                                        creditBalance:
                                          Math.round(
                                            (currentCredit + amt) * 100
                                          ) / 100,
                                      },
                                      managedOwnedClub.id
                                    );
                                    setWalletTopUpError(undefined);
                                    showModalFeedback(
                                      `Added ${ledgerMoney(amt)} prepaid credit`
                                    );
                                  }}
                                  className="h-10 sm:h-9 rounded-xl bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/70 text-sky-900 dark:text-sky-200 border border-sky-200/90 dark:border-sky-800/80 text-xs font-semibold font-mono tabular-nums whitespace-nowrap cursor-pointer transition-all duration-150 active:scale-[0.97]"
                                >
                                  +{getClubCurrencySymbol(managedOwnedClub)}
                                  {amt}
                                </button>
                              ))}
                            </div>

                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <div className="relative flex-1 min-w-0 flex items-center">
                                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-semibold font-mono text-slate-500 dark:text-slate-400">
                                    {getClubCurrencySymbol(managedOwnedClub)}
                                  </span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={walletTopUpInput}
                                    onChange={(e) => {
                                      setWalletTopUpInput(e.target.value);
                                      if (walletTopUpError) {
                                        setWalletTopUpError(undefined);
                                      }
                                    }}
                                    aria-label="Custom credit top-up amount"
                                    className="w-full h-10 sm:h-9 pl-7 pr-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 text-xs text-slate-900 dark:text-slate-100 font-mono tabular-nums shadow-2xs transition-all focus:outline-none focus:border-emerald-600 focus:ring-3 focus:ring-emerald-500/15"
                                    placeholder="Custom amount"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const parsed = Number(walletTopUpInput);
                                    if (
                                      !Number.isFinite(parsed) ||
                                      parsed <= 0
                                    ) {
                                      setWalletTopUpError(
                                        'Enter an amount greater than 0.'
                                      );
                                      return;
                                    }
                                    setWalletTopUpError(undefined);
                                    onUpdatePlayerWallet(
                                      player.id,
                                      {
                                        creditBalance:
                                          Math.round(
                                            (currentCredit + parsed) * 100
                                          ) / 100,
                                      },
                                      managedOwnedClub.id
                                    );
                                    showModalFeedback(
                                      `Added ${ledgerMoney(parsed)} prepaid credit`
                                    );
                                  }}
                                  className="px-4 h-10 sm:h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-all duration-150 active:scale-[0.97] shadow-xs cursor-pointer"
                                >
                                  Top Up
                                </button>
                              </div>
                              {walletTopUpError && (
                                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                                  {walletTopUpError}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Free Session Passes */}
                          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/45 p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <span className="text-sm font-bold text-slate-900 dark:text-white block">
                                  Free Session Passes
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  1 pass waives 1 full session share
                                </span>
                              </div>
                              <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums whitespace-nowrap shrink-0">
                                {currentPasses}{' '}
                                <span className="text-xs font-sans font-semibold text-slate-500 dark:text-slate-400">
                                  left
                                </span>
                              </span>
                            </div>

                            <div className="grid grid-cols-4 gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.max(0, currentPasses - 1);
                                  onUpdatePlayerWallet(
                                    player.id,
                                    { freeSessionPasses: next },
                                    managedOwnedClub.id
                                  );
                                  showModalFeedback(
                                    `Removed 1 pass (${next} left)`
                                  );
                                }}
                                disabled={currentPasses <= 0}
                                className="h-10 sm:h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-semibold font-mono tabular-nums whitespace-nowrap cursor-pointer transition-all duration-150 active:scale-[0.97]"
                              >
                                -1
                              </button>
                              {[1, 3, 5].map((cnt) => (
                                <button
                                  key={cnt}
                                  type="button"
                                  onClick={() => {
                                    const next = currentPasses + cnt;
                                    onUpdatePlayerWallet(
                                      player.id,
                                      { freeSessionPasses: next },
                                      managedOwnedClub.id
                                    );
                                    showModalFeedback(
                                      `Granted +${cnt} ${
                                        cnt === 1 ? 'pass' : 'passes'
                                      } (${next} total)`
                                    );
                                  }}
                                  className="h-10 sm:h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 text-emerald-900 dark:text-emerald-200 border border-emerald-200/90 dark:border-emerald-800/80 text-xs font-semibold whitespace-nowrap cursor-pointer transition-all duration-150 active:scale-[0.97]"
                                >
                                  +{cnt} {cnt === 1 ? 'Pass' : 'Passes'}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Complete Fee Waiver (Tactile Switch Row) */}
                          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/45 p-4 flex items-center justify-between gap-4">
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="text-sm font-bold text-slate-900 dark:text-white">
                                  VIP Fee Waiver
                                </span>
                                {currentWaived && (
                                  <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">
                                    · Active
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                Waives all unpaid &amp; future session fees in{' '}
                                {managedOwnedClub.name} ({ledgerMoney(0)} share).
                              </p>
                            </div>

                            <button
                              type="button"
                              role="switch"
                              aria-checked={currentWaived}
                              aria-label={`Toggle VIP fee waiver for ${player.name}`}
                              onClick={() => {
                                const next = !currentWaived;
                                onUpdatePlayerWallet(
                                  player.id,
                                  { waiveAllFees: next },
                                  managedOwnedClub.id
                                );
                                showModalFeedback(
                                  next
                                    ? `Enabled VIP fee waiver for ${player.name}`
                                    : `Disabled VIP fee waiver for ${player.name}`
                                );
                              }}
                              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/30 ${
                                currentWaived
                                  ? 'bg-purple-600 justify-end'
                                  : 'bg-slate-300 dark:bg-slate-700 justify-start'
                              }`}
                            >
                              <motion.span
                                layout
                                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                                className="inline-block h-5 w-5 rounded-full bg-white shadow-xs"
                              />
                            </button>
                          </div>
                        </motion.div>
                      )}

                    {/* =========================================================
                        TAB 3: DETAILS (Profile, Ownership, Clubs & Danger Zone)
                       ========================================================= */}
                    {activeTab === 'details' && (
                      <motion.div
                        key="tab-details"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -3 }}
                        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                        className="space-y-5"
                      >
                        <div
                          className={`grid grid-cols-1 ${
                            isSiteAdmin ? 'sm:grid-cols-2' : 'sm:grid-cols-1'
                          } gap-3.5`}
                        >
                          <StyledInput
                            label={
                              isSiteAdmin
                                ? 'Full Name'
                                : 'Full Name (Site Admin editable)'
                            }
                            type="text"
                            maxLength={80}
                            readOnly={!isSiteAdmin}
                            value={editName}
                            error={editUserErrors.name}
                            onChange={(e) => {
                              setEditName(e.target.value);
                              if (editUserErrors.name)
                                setEditUserErrors((prev) => ({
                                  ...prev,
                                  name: undefined,
                                }));
                            }}
                          />
                          {isSiteAdmin && (
                            <StyledSelect
                              label="Club Owner Assignment"
                              value={editOwnedClubId}
                              onChange={(e) =>
                                setEditOwnedClubId(e.target.value)
                              }
                            >
                              <option
                                value="NONE"
                                disabled={Boolean(ownedClub)}
                              >
                                {ownedClub
                                  ? 'Reassign club from another user first'
                                  : 'No Owned Club (Normal Member)'}
                              </option>
                              {clubs.map((c) => {
                                const isCurrentOwner =
                                  c.clubOwnerPlayerId === player.id;
                                return (
                                  <option key={c.id} value={c.id}>
                                    Owner of {c.name}
                                    {!isCurrentOwner && c.clubOwnerName
                                      ? ` (Replaces ${c.clubOwnerName})`
                                      : ''}
                                  </option>
                                );
                              })}
                            </StyledSelect>
                          )}
                        </div>

                        {/* Joined Clubs with Remove Member Option */}
                        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              Joined Clubs ({joinedClubs.length})
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              Organizers can remove members from managed clubs
                            </span>
                          </div>
                          {joinedClubs.length > 0 ? (
                            <div className="divide-y divide-slate-200/70 dark:divide-slate-800 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                              {joinedClubs.map((c) => {
                                const isClubOwner =
                                  c.clubOwnerPlayerId === player.id;
                                const canRemoveHere =
                                  Boolean(onRemoveMemberFromClub) &&
                                  !isClubOwner &&
                                  (isSiteAdmin ||
                                    c.clubOwnerPlayerId === activePlayer.id);
                                return (
                                  <div
                                    key={c.id}
                                    className="px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                                  >
                                    <div className="min-w-0 truncate">
                                      <span className="font-semibold text-slate-900 dark:text-white">
                                        {c.name}
                                      </span>
                                      {isClubOwner && (
                                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                          {' '}
                                          · Club Owner
                                        </span>
                                      )}
                                    </div>
                                    {canRemoveHere && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPendingRemoveFromClub({
                                            player,
                                            club: c,
                                          })
                                        }
                                        className="text-rose-700 dark:text-rose-400 hover:underline font-semibold text-xs shrink-0 cursor-pointer"
                                        title={`Remove ${player.name} from ${c.name}`}
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              No clubs joined yet
                            </p>
                          )}
                        </div>

                        {/* Destructive Actions safely tucked inside Details tab */}
                        {((isSiteAdmin &&
                          player.id !== activePlayer.id &&
                          players.length > 1) ||
                          (!isSiteAdmin &&
                            managedOwnedClub &&
                            onRemoveMemberFromClub &&
                            managedOwnedClub.clubOwnerPlayerId !==
                              player.id)) && (
                          <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <div className="space-y-0.5">
                              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                                {isSiteAdmin
                                  ? 'Account Removal'
                                  : 'Club Membership'}
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                                {isSiteAdmin
                                  ? 'Permanently delete this user from the platform.'
                                  : `Remove ${player.name} from ${managedOwnedClub?.name}.`}
                              </span>
                            </div>

                            {isSiteAdmin &&
                              player.id !== activePlayer.id &&
                              players.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingPlayerId(null);
                                    setPendingDeletePlayer(player);
                                  }}
                                  className="h-9 px-3.5 rounded-xl border border-rose-200 dark:border-rose-900/70 bg-rose-50/70 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/80 text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>Delete User</span>
                                </button>
                              )}

                            {!isSiteAdmin &&
                              managedOwnedClub &&
                              onRemoveMemberFromClub &&
                              managedOwnedClub.clubOwnerPlayerId !==
                                player.id && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingPlayerId(null);
                                    setPendingRemoveFromClub({
                                      player,
                                      club: managedOwnedClub,
                                    });
                                  }}
                                  className="h-9 px-3.5 rounded-xl border border-rose-200 dark:border-rose-900/70 bg-rose-50/70 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/80 text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>Remove from Club</span>
                                </button>
                              )}
                          </div>
                        )}
                      </motion.div>
                    )}
                    </AnimatePresence>
                  </div>

                  {/* Slim Context-Aware Sticky Footer (Zero wasted mobile space, zero Save-vs-Instant confusion) */}
                  <div className="px-4 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 flex items-center justify-between gap-3 shrink-0">
                    {activeTab === 'details' && isSiteAdmin ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingPlayerId(null)}
                          className="flex-1 sm:flex-initial h-10 sm:h-9 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl inline-flex items-center justify-center whitespace-nowrap cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!hasProfileChanges}
                          className={`flex-1 sm:flex-initial h-10 sm:h-9 px-4 text-xs font-semibold rounded-xl inline-flex items-center justify-center whitespace-nowrap transition-colors ${
                            hasProfileChanges
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          Save Changes
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {activeTab === 'details'
                            ? 'Read-only club member view'
                            : 'Changes apply immediately'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditingPlayerId(null)}
                          className="h-10 sm:h-9 px-5 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white border border-slate-900 dark:border-slate-700 text-xs font-semibold rounded-xl inline-flex items-center justify-center whitespace-nowrap cursor-pointer shrink-0"
                        >
                          Done
                        </button>
                      </>
                    )}
                  </div>
                </motion.form>
              </motion.div>
            );
          })()}
      </AnimatePresence>

      {/* Confirmation Modal: Delete Member */}
      <ConfirmModal
        open={Boolean(pendingDeletePlayer)}
        title="Delete User Account?"
        description={
          pendingDeletePlayer ? (
            <p>
              Are you sure you want to permanently remove{' '}
              <strong className="font-semibold text-slate-900 dark:text-white">
                {pendingDeletePlayer.name}
              </strong>{' '}
              ({pendingDeletePlayer.playerTag}) from the platform? This action
              cannot be undone.
            </p>
          ) : null
        }
        confirmLabel="Delete Account"
        variant="danger"
        onCancel={() => setPendingDeletePlayer(null)}
        onConfirm={async () => {
          if (!pendingDeletePlayer) return;
          const target = pendingDeletePlayer;
          setPendingDeletePlayer(null);
          await onAdminDeleteUser(target.id);
        }}
      />

      {/* Confirmation Modal: Reject All Pending Payments for Member in Owned Club */}
      <ConfirmModal
        open={Boolean(pendingRejectPlayer)}
        title="Reject Pending Payment Submissions?"
        description={
          pendingRejectPlayer ? (
            <p>
              Mark all pending payment submissions from{' '}
              <strong className="font-semibold text-slate-900 dark:text-white">
                {pendingRejectPlayer.name}
              </strong>{' '}
              in{' '}
              <strong className="font-semibold text-slate-900 dark:text-white">
                {managedOwnedClub?.name || 'your club'}
              </strong>{' '}
              as Not Received and return their balance to Unpaid?
            </p>
          ) : null
        }
        confirmLabel="Confirm Reject"
        variant="danger"
        onCancel={() => setPendingRejectPlayer(null)}
        onConfirm={async () => {
          if (!pendingRejectPlayer || !onRejectAllForPlayer) return;
          const target = pendingRejectPlayer;
          setPendingRejectPlayer(null);
          await onRejectAllForPlayer(target.id, managedOwnedClub?.id);
          if (editingPlayerId === target.id) {
            showModalFeedback('Returned pending submissions to Unpaid');
          }
        }}
      />

      {/* Confirmation Modal: Reject Single Bill Payment */}
      <ConfirmModal
        open={Boolean(pendingRejectSingleRsvp)}
        title="Reject Session Payment?"
        description={
          pendingRejectSingleRsvp ? (
            <p>
              Return{' '}
              <strong className="font-semibold text-slate-900 dark:text-white">
                {pendingRejectSingleRsvp.playerName}
              </strong>
              &rsquo;s{' '}
              <strong className="font-mono font-semibold text-slate-900 dark:text-white">
                {ledgerMoney(pendingRejectSingleRsvp.feeShare)}
              </strong>{' '}
              session bill to Unpaid status?
            </p>
          ) : null
        }
        confirmLabel="Reject Payment"
        variant="danger"
        onCancel={() => setPendingRejectSingleRsvp(null)}
        onConfirm={async () => {
          if (!pendingRejectSingleRsvp || !onRejectPaymentForRsvp) return;
          const target = pendingRejectSingleRsvp;
          setPendingRejectSingleRsvp(null);
          await onRejectPaymentForRsvp(target.id);
          if (editingPlayerId === target.playerId) {
            showModalFeedback(
              `Returned ${ledgerMoney(target.feeShare)} bill to Unpaid`
            );
          }
        }}
      />

      {/* Confirmation Modal: Reset Prepaid Credit in Owned Club */}
      <ConfirmModal
        open={Boolean(pendingResetCreditPlayer)}
        title="Reset Club Prepaid Credit Balance?"
        description={
          pendingResetCreditPlayer && managedOwnedClub ? (
            <p>
              Reset{' '}
              <strong className="font-semibold text-slate-900 dark:text-white">
                {pendingResetCreditPlayer.name}
              </strong>
              &rsquo;s prepaid credit balance in{' '}
              <strong className="font-semibold text-slate-900 dark:text-white">
                {managedOwnedClub.name}
              </strong>{' '}
              (
              <strong className="font-mono font-semibold text-slate-900 dark:text-white">
                {ledgerMoney(
                  getPlayerClubWallet(
                    pendingResetCreditPlayer,
                    managedOwnedClub.id,
                    walletsMap
                  ).creditBalance
                )}
              </strong>
              ) back to {ledgerMoney(0)}?
            </p>
          ) : null
        }
        confirmLabel={`Reset to ${ledgerMoney(0)}`}
        variant="warning"
        onCancel={() => setPendingResetCreditPlayer(null)}
        onConfirm={() => {
          if (
            !pendingResetCreditPlayer ||
            !onUpdatePlayerWallet ||
            !managedOwnedClub
          )
            return;
          const target = pendingResetCreditPlayer;
          setPendingResetCreditPlayer(null);
          onUpdatePlayerWallet(
            target.id,
            { creditBalance: 0 },
            managedOwnedClub.id
          );
          if (editingPlayerId === target.id) {
            showModalFeedback(`Reset prepaid credit to ${ledgerMoney(0)}`);
          }
        }}
      />

      {/* Confirmation Modal: Remove Member from Club */}
      {onRemoveMemberFromClub && (
        <ConfirmModal
          open={Boolean(pendingRemoveFromClub)}
          title="Remove Member from Club?"
          description={
            pendingRemoveFromClub ? (
              <div className="space-y-1.5">
                <p>
                  Remove{' '}
                  <strong className="font-semibold text-slate-900 dark:text-white">
                    {pendingRemoveFromClub.player.name}
                  </strong>{' '}
                  from{' '}
                  <strong className="font-semibold text-slate-900 dark:text-white">
                    {pendingRemoveFromClub.club.name}
                  </strong>
                  ?
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  Any upcoming session RSVPs for this member in {pendingRemoveFromClub.club.name} will be withdrawn.
                </p>
              </div>
            ) : null
          }
          confirmLabel="Remove Member"
          variant="danger"
          onCancel={() => setPendingRemoveFromClub(null)}
          onConfirm={async () => {
            if (!pendingRemoveFromClub) return;
            const target = pendingRemoveFromClub;
            setPendingRemoveFromClub(null);
            await onRemoveMemberFromClub(target.player.id, target.club.id);
          }}
        />
      )}
    </div>
  );
};
