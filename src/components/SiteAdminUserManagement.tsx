import React, { useDeferredValue, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  Check,
  FileText,
  Gift,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
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
  getPlayerClubWallet,
  getPlayerJoinedClubIds,
} from '../utils/badmintonLogic';
import {
  ConfirmModal,
  SegmentedControl,
  StyledInput,
  StyledSelect,
} from './ui/FormControls';

interface SiteAdminUserManagementProps {
  players: Player[];
  clubs: Club[];
  activeClub?: Club;
  sessions: Session[];
  rsvps: SessionRsvp[];
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
      ratingScore: number;
      clubIds: string[];
    }
  ) => Promise<void>;
  onAdminDeleteUser: (playerId: string) => Promise<void>;
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
  activePlayer,
  permissionTier = 'admin',
  onAdminCreateUser,
  onAdminUpdateUser,
  onAdminDeleteUser,
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
  const [showModalBillsList, setShowModalBillsList] = useState<boolean>(true);
  const [editName, setEditName] = useState('');
  const [editRating, setEditRating] = useState(1200);
  const [editUserErrors, setEditUserErrors] = useState<{
    name?: string;
    rating?: string;
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

      if (r.feeShare <= 0) continue;

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
      const clubWallet = getPlayerClubWallet(player, clubId);
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
  }, [managedOwnedClub, membersByClubIdMap, ownedClubLedgerData]);

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
    setShowModalBillsList(true);
    setEditName(player.name);
    setEditRating(player.ratingScore);
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
      activeClub?.id ||
      clubs[0]?.id ||
      'club_bintang_prime';
    await onAdminCreateUser({
      name: newName.trim(),
      ratingScore: newRating,
      clubIds: [defaultClubId],
    });
    setNewName('');
    setNewRating(1200);
    setShowCreateForm(false);
  };

  const handleSaveEdit = async (e: React.FormEvent, player: Player) => {
    e.preventDefault();
    const nextErrors: typeof editUserErrors = {};
    if (!editName.trim()) {
      nextErrors.name = 'Please enter the member full name.';
    }
    if (
      Number.isNaN(Number(editRating)) ||
      editRating < 800 ||
      editRating > 3000
    ) {
      nextErrors.rating = 'Rating must be between 800 and 3000.';
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
      ratingScore: editRating,
      clubIds:
        preservedClubs.length > 0
          ? preservedClubs
          : clubs[0]
          ? [clubs[0].id]
          : ['club_bintang_prime'],
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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 pb-4 border-b border-slate-200/80">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display">
              {effectiveWorkspace === 'platform'
                ? 'Platform Users & Club Ownership'
                : `${managedOwnedClub?.name || 'Club'} · Member Balances & Wallets`}
            </h1>
            {effectiveWorkspace === 'owned_club' && managedOwnedClub && (
              <span className="text-xs font-semibold text-emerald-700">
                · Club Owner View
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            {effectiveWorkspace === 'platform'
              ? 'Manage registered player accounts, club ownership assignments, and platform club rosters.'
              : `Club-scoped fee settlements, pending payment approvals, and member credit/pass wallets for ${
                  managedOwnedClub?.name || 'your club'
                }.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {isSiteAdmin && myOwnedClub && (
            <SegmentedControl
              size="sm"
              options={[
                {
                  value: 'platform',
                  label: 'Platform Directory',
                  count: players.length,
                },
                {
                  value: 'owned_club',
                  label: `My Club Ledger (${myOwnedClub.name.split(' ')[0]})`,
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
            className="h-9 px-3.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold">Registered Users</span>
                <Users className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {players.length}
              </p>
              <p className="text-[11px] text-slate-500">
                Platform-wide player accounts
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold">Platform Clubs</span>
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {clubs.length}
              </p>
              <p className="text-[11px] text-slate-500">
                {sessions.length} total sessions organized
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold">Assigned Club Owners</span>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {totalOwnersCount}
              </p>
              <p className="text-[11px] text-slate-500">
                1 club max per owner enforced
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col justify-between gap-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold">Your Owned Club</span>
                <Wallet className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              {myOwnedClub ? (
                <>
                  <p className="text-sm font-bold text-slate-900 truncate font-display">
                    {myOwnedClub.name}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setAdminWorkspaceTab('owned_club');
                      setSearchQuery('');
                    }}
                    className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline inline-flex items-center gap-1 self-start cursor-pointer"
                  >
                    <span>Manage Club Balances &amp; Wallets</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-slate-700">
                    None Assigned
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Balances &amp; wallets are managed by club owners
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Unified Platform Directory Workspace Card */}
          <section
            aria-label="Platform Users and Clubs Directory"
            className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-2xs"
          >
            {/* Workspace Control Bar */}
            <div className="p-4 sm:px-5 border-b border-slate-200/80 space-y-3.5 bg-white">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <SegmentedControl
                  size="sm"
                  options={[
                    {
                      value: 'users',
                      label: 'Platform Users',
                      count: players.length,
                    },
                    {
                      value: 'clubs',
                      label: 'Platform Clubs',
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
                        label: 'All Users',
                        count: players.length,
                      },
                      {
                        value: 'owners',
                        label: 'Club Owners',
                        count: totalOwnersCount,
                      },
                      {
                        value: 'members',
                        label: 'Regular Members',
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
                  <p className="text-xs text-slate-600">
                    Click any club row to inspect its member roster or reassign
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
                      placeholder="Search clubs or owners..."
                    />
                  </div>
                </div>
              )}

              {/* Contextual shortcut when Admin filters by the club they personally own */}
              {platformSection === 'users' &&
                myOwnedClub &&
                platformClubFilter === myOwnedClub.id && (
                  <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/90 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <span className="text-emerald-950">
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
                <div className="lg:hidden divide-y divide-slate-100 bg-white">
                  {filteredPlatformUsers.length === 0 ? (
                    <div className="py-10 px-5 text-center text-xs text-slate-500">
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
                            className="p-4 bg-white hover:bg-slate-50/80 transition-colors cursor-pointer flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-bold text-slate-900">
                                  {player.name}
                                </span>
                                <span className="text-[11px] font-mono text-slate-500">
                                  {player.playerTag}
                                </span>
                                {isSelf && (
                                  <span className="text-[11px] font-semibold text-emerald-700">
                                    · You
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-600 truncate">
                                {ownedClub ? (
                                  <strong className="font-semibold text-emerald-800">
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
                              <div className="text-xs font-bold text-slate-900">
                                {player.ratingScore} pts
                              </div>
                              <div className="text-[11px] text-slate-500">
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
                <div className="hidden lg:block max-h-[620px] overflow-y-auto overflow-x-hidden bg-white">
                  <table className="w-full text-left border-collapse bg-white">
                    <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                      <tr>
                        <th className="py-3 px-4">User Account</th>
                        <th className="py-3 px-3">Platform Role &amp; Ownership</th>
                        <th className="py-3 px-3">Joined Clubs</th>
                        <th className="py-3 px-4 text-right">
                          Rating &amp; Match Record
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs bg-white">
                      {filteredPlatformUsers.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-10 px-5 text-center text-xs text-slate-500"
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
                                className="bg-white hover:bg-slate-50/80 transition-colors cursor-pointer"
                              >
                                <td className="py-3 px-4 align-middle">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200/80 text-slate-700 font-bold text-[11px] flex items-center justify-center shrink-0 font-display">
                                      {getInitials(player.name)}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-bold text-slate-900 truncate">
                                          {player.name}
                                        </span>
                                        <span className="text-[11px] font-mono text-slate-500">
                                          {player.playerTag}
                                        </span>
                                        {isSelf && (
                                          <span className="text-[11px] font-semibold text-emerald-700">
                                            · You
                                          </span>
                                        )}
                                        {savedNoticeId === player.id && (
                                          <span className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-0.5">
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
                                      <span className="font-semibold text-emerald-800">
                                        Club Owner
                                      </span>
                                      <span className="text-slate-400 mx-1">
                                        ·
                                      </span>
                                      <span className="font-medium text-slate-800">
                                        {ownedClub.name}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-slate-600">
                                      Member
                                    </span>
                                  )}
                                </td>

                                <td className="py-3 px-3 align-middle">
                                  <div className="text-xs text-slate-700 truncate max-w-md">
                                    <span className="font-mono font-semibold text-slate-900">
                                      {joinedClubs.length}
                                    </span>{' '}
                                    {joinedClubs.length === 1 ? 'club' : 'clubs'}
                                    {joinedClubs.length > 0 && (
                                      <span className="text-slate-500">
                                        {' '}
                                        ({joinedClubs.map((c) => c.name).join(', ')})
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="py-3 px-4 align-middle text-right font-mono tabular-nums whitespace-nowrap">
                                  <span className="font-bold text-slate-900">
                                    {player.ratingScore} pts
                                  </span>
                                  <span className="text-slate-400 mx-1.5">·</span>
                                  <span className="text-slate-600">
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
                  <div className="p-3.5 border-t border-slate-200/80 bg-slate-50/50 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600 font-medium">
                      Showing {visiblePlatformUsers.length} of{' '}
                      {filteredPlatformUsers.length} users
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleMemberCount((prev) => prev + 30)
                        }
                        className="h-8 px-3 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 font-semibold text-slate-700 cursor-pointer"
                      >
                        Show 30 More
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleMemberCount(filteredPlatformUsers.length)
                        }
                        className="h-8 px-3 rounded-xl font-semibold text-emerald-700 hover:underline cursor-pointer"
                      >
                        Show All ({filteredPlatformUsers.length})
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* SUB-VIEW 2: PLATFORM CLUBS DIRECTORY */
              <div className="divide-y divide-slate-100 bg-white max-h-[620px] overflow-y-auto">
                {filteredPlatformClubs.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
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
                          className="p-4 sm:px-5 hover:bg-slate-50/80 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-slate-900 font-display">
                                {club.name}
                              </span>
                              <span className="text-xs text-slate-600">
                                · Owner:{' '}
                                <strong className="font-semibold text-slate-900">
                                  {club.clubOwnerName || 'Alex Tan'}
                                </strong>
                              </span>
                              {isOwnedByMe && (
                                <span className="text-xs font-semibold text-emerald-700">
                                  (Owned by You)
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 truncate">
                              {club.description}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 shrink-0 text-xs font-mono tabular-nums text-slate-700">
                            <span>
                              <strong className="text-slate-900">
                                {members.length}
                              </strong>{' '}
                              {members.length === 1 ? 'member' : 'members'}
                            </span>
                            <span className="text-slate-300">·</span>
                            <span>
                              <strong className="text-slate-900">
                                {sessionCount}
                              </strong>{' '}
                              {sessionCount === 1 ? 'session' : 'sessions'}
                            </span>
                            <span className="text-slate-300 hidden sm:inline">
                              ·
                            </span>
                            <span className="hidden sm:inline text-[11px] font-sans text-slate-500">
                              Free &gt;{club.freeCancelHours}h · Late{' '}
                              {club.lateCancelFeePercent}%
                            </span>
                          </div>
                        </div>
                      )
                    )}
                    {filteredPlatformClubs.length > visibleClubCount && (
                      <div className="p-3.5 bg-slate-50/50 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setVisibleClubCount((prev) => prev + 20)
                          }
                          className="h-8 px-3.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold">Club Members</span>
                <span className="font-medium text-slate-500 truncate max-w-32">
                  {managedOwnedClub.name}
                </span>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {ownedClubMemberSummaries.length}
              </p>
              <p className="text-[11px] text-slate-500">
                {ownedClubCounts.perks} member(s) with club credits/waivers
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold">Received Total</span>
                <span className="text-emerald-700 font-semibold">Settled</span>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700">
                ${ownedClubLedgerData.clubReceivedTotal.toFixed(2)}
              </p>
              <p className="text-[11px] text-slate-500">
                {ownedClubLedgerData.clubSettledSharesCount} verified session
                shares in club
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold">Pending Approval</span>
                <span className="text-blue-700 font-semibold font-mono tabular-nums">
                  {ownedClubCounts.pendingOnly} member(s)
                </span>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-blue-700">
                ${ownedClubLedgerData.clubPendingTotal.toFixed(2)}
              </p>
              <p className="text-[11px] text-slate-500">
                Marked paid · awaiting your verification
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold">Total Due (Unpaid)</span>
                <span className="text-amber-800 font-semibold font-mono tabular-nums">
                  {ownedClubCounts.owingOnly} owing
                </span>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-amber-800">
                ${ownedClubLedgerData.clubUnpaidTotal.toFixed(2)}
              </p>
              <p className="text-[11px] text-slate-500">
                Outstanding across finalized club sessions
              </p>
            </div>
          </div>

          {/* Club-Scoped Member Balances & Wallets Directory Table */}
          <section
            aria-label="Club Member Balances and Wallets"
            className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-2xs"
          >
            <div className="p-4 sm:px-5 border-b border-slate-200/80 space-y-3 bg-white">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 font-display">
                    {managedOwnedClub.name} — Member Balances &amp; Wallets (
                    {filteredOwnedClubSummaries.length})
                  </h2>
                  <p className="text-[11px] text-slate-500">
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
                  placeholder={`Search ${managedOwnedClub.name} member or #tag...`}
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
            <div className="lg:hidden divide-y divide-slate-100 bg-white">
              {filteredOwnedClubSummaries.length === 0 ? (
                <div className="py-10 px-5 text-center text-xs text-slate-500">
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
                      className="p-4 bg-white hover:bg-slate-50/80 transition-colors cursor-pointer flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-900">
                            {player.name}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {player.playerTag}
                          </span>
                          {isClubOwner && (
                            <span className="text-[11px] font-semibold text-emerald-700">
                              · Club Owner
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                          <span className="font-mono">
                            {player.ratingScore} pts
                          </span>
                          <span>·</span>
                          {clubWallet.waiveAllFees ? (
                            <span className="text-purple-700 font-semibold">
                              VIP Waived
                            </span>
                          ) : clubWallet.freeSessionPasses > 0 ? (
                            <span className="text-emerald-700 font-semibold">
                              {clubWallet.freeSessionPasses} Free Pass
                            </span>
                          ) : clubWallet.creditBalance > 0 ? (
                            <span className="text-sky-700 font-mono font-semibold">
                              ${clubWallet.creditBalance.toFixed(2)} Credit
                            </span>
                          ) : (
                            <span className="text-slate-500">Standard</span>
                          )}
                        </div>
                      </div>

                      <div className="text-right font-mono tabular-nums shrink-0">
                        {totalUnpaid > 0 ? (
                          <>
                            <div className="text-sm font-bold text-amber-800">
                              ${totalUnpaid.toFixed(2)}
                            </div>
                            <div className="text-[10px] font-sans text-amber-700">
                              {unpaidCount} unpaid
                            </div>
                          </>
                        ) : totalPending > 0 ? (
                          <>
                            <div className="text-sm font-bold text-blue-700">
                              ${totalPending.toFixed(2)}
                            </div>
                            <div className="text-[10px] font-sans text-blue-700">
                              {pendingCount} pending
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-semibold text-slate-600">
                              $0.00
                            </div>
                            <div className="text-[10px] font-sans text-slate-400">
                              Settled
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table (lg+) */}
            <div className="hidden lg:block max-h-[620px] overflow-y-auto overflow-x-hidden bg-white">
              <table className="w-full text-left border-collapse bg-white">
                <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs border-b border-slate-200 text-[11px] font-semibold text-slate-600">
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
                <tbody className="divide-y divide-slate-100 text-xs bg-white">
                  {filteredOwnedClubSummaries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-10 px-5 text-center text-xs text-slate-500"
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
                          className="bg-white hover:bg-slate-50/80 transition-colors cursor-pointer"
                        >
                          <td className="py-3.5 px-4 align-middle">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200/80 text-slate-700 font-bold text-[11px] flex items-center justify-center shrink-0 font-display">
                                {getInitials(player.name)}
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-bold text-slate-900">
                                    {player.name}
                                  </span>
                                  <span className="text-[11px] font-mono text-slate-500">
                                    {player.playerTag}
                                  </span>
                                  {isClubOwner && (
                                    <span className="text-[11px] font-semibold text-emerald-700">
                                      · Club Owner
                                    </span>
                                  )}
                                  {savedNoticeId === player.id && (
                                    <span className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-0.5">
                                      <Check className="w-3 h-3" />
                                      Saved
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-3 align-middle text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {player.ratingScore} pts
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {player.wins}W–{player.losses}L ·{' '}
                              {sessionsAttendedCount}s in club
                            </div>
                          </td>

                          <td className="py-3.5 px-3 align-middle">
                            <div className="flex flex-wrap items-center gap-2">
                              {clubWallet.waiveAllFees && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-800">
                                  <Sparkles className="w-3 h-3 text-purple-600 shrink-0" />
                                  VIP Waived
                                </span>
                              )}
                              {clubWallet.freeSessionPasses > 0 && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                                  <Ticket className="w-3 h-3 text-emerald-600 shrink-0" />
                                  {clubWallet.freeSessionPasses} Free Pass
                                  {clubWallet.freeSessionPasses === 1
                                    ? ''
                                    : 'es'}
                                </span>
                              )}
                              {clubWallet.creditBalance > 0 && (
                                <span className="text-[11px] font-mono tabular-nums font-semibold text-sky-800">
                                  ${clubWallet.creditBalance.toFixed(2)} Credit
                                </span>
                              )}
                              {!clubWallet.waiveAllFees &&
                                clubWallet.freeSessionPasses <= 0 &&
                                clubWallet.creditBalance <= 0 && (
                                  <span className="text-[11px] text-slate-500">
                                    Standard
                                  </span>
                                )}
                            </div>
                          </td>

                          <td className="py-3.5 px-3 align-middle text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-emerald-700">
                              ${totalReceived.toFixed(2)}
                            </div>
                            <div className="text-[10px] font-sans text-slate-500">
                              {paidSessionsCount} settled
                            </div>
                          </td>

                          <td className="py-3.5 px-4 align-middle text-right font-mono tabular-nums whitespace-nowrap">
                            {totalUnpaid > 0 ? (
                              <>
                                <div className="font-bold text-amber-800">
                                  ${totalUnpaid.toFixed(2)}
                                </div>
                                <div className="text-[10px] font-sans text-amber-700">
                                  {unpaidCount} unpaid
                                </div>
                              </>
                            ) : totalPending > 0 ? (
                              <>
                                <div className="font-bold text-blue-700">
                                  ${totalPending.toFixed(2)}
                                </div>
                                <div className="text-[10px] font-sans text-blue-700">
                                  {pendingCount} pending approval
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="font-semibold text-slate-600">
                                  $0.00
                                </div>
                                <div className="text-[10px] font-sans text-slate-400">
                                  Settled
                                </div>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {filteredOwnedClubSummaries.length > 0 && (
                  <tfoot className="bg-slate-50/80 border-t border-slate-200 text-xs font-mono tabular-nums">
                    <tr>
                      <td
                        colSpan={3}
                        className="py-3 px-4 font-sans font-semibold text-slate-700"
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
                                className="h-7 px-2.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-[11px] font-semibold text-slate-800 cursor-pointer"
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
                                className="h-7 px-2 rounded-lg text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                              >
                                Show All
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-700">
                        ${filteredLedgerTotals.received.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-amber-800">
                        ${filteredLedgerTotals.unpaid.toFixed(2)} due
                        {filteredLedgerTotals.pending > 0
                          ? ` · $${filteredLedgerTotals.pending.toFixed(2)} pend`
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
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShowCreateForm(false)}
          >
            <motion.section
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-xl space-y-4"
            >
              <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-display">
                    Register New Member Account
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Creates a player profile. Members choose and join clubs
                    directly by their own intention.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form
                noValidate
                onSubmit={handleCreateSubmit}
                className="space-y-4"
              >
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

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="h-9 px-3.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center whitespace-nowrap cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center whitespace-nowrap cursor-pointer shadow-xs"
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
                className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
                onClick={() => setInspectedPlatformClubId(null)}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-slate-900 truncate font-display">
                        {club.name} — Roster ({allClubMembers.length} members)
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Owner:{' '}
                        <strong className="font-semibold text-slate-900">
                          {club.clubOwnerName || 'Alex Tan'}
                        </strong>{' '}
                        · {club.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectedPlatformClubId(null)}
                      className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-5 overflow-y-auto flex-1 space-y-4">
                    {isOwnedByCurrentAdmin && (
                      <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <span className="text-emerald-950 font-medium">
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
                          className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer"
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
                          placeholder="Filter club members..."
                        />
                      </div>
                      <span className="text-[11px] text-slate-500">
                        Select any member to inspect profile or ownership
                      </span>
                    </div>

                    {filteredClubMembers.length === 0 ? (
                      <p className="text-xs text-slate-500 py-6 text-center">
                        No members match your filter.
                      </p>
                    ) : (
                      <div className="rounded-xl border border-slate-200/80 bg-white overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-semibold text-slate-600">
                            <tr>
                              <th className="py-2.5 px-3.5">Member</th>
                              <th className="py-2.5 px-3">Club Role</th>
                              <th className="py-2.5 px-3.5 text-right">
                                Rating &amp; W–L
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-xs">
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
                                  className="bg-white hover:bg-slate-50/90 transition-colors cursor-pointer"
                                >
                                  <td className="py-2.5 px-3.5">
                                    <span className="font-semibold text-slate-900">
                                      {m.name}
                                    </span>
                                    <span className="font-mono text-[11px] text-slate-500 ml-1.5">
                                      {m.playerTag}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {isOwner ? (
                                      <span className="font-semibold text-emerald-800">
                                        Club Owner
                                      </span>
                                    ) : (
                                      <span className="text-slate-600">
                                        Member
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-700">
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

                  <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setInspectedPlatformClubId(null)}
                      className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
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
                ? getPlayerClubWallet(player, managedOwnedClub.id)
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

            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
                onClick={() => setEditingPlayerId(null)}
              >
                <motion.form
                  noValidate
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  onSubmit={(e) => handleSaveEdit(e, player)}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden"
                >
                  {/* Sticky Modal Header */}
                  <div className="px-4 sm:px-6 py-4 border-b border-slate-200/80 bg-white flex items-start justify-between gap-3 shrink-0">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <h3 className="text-base sm:text-lg font-bold text-slate-900 font-display truncate">
                          {player.name}
                        </h3>
                        <span className="text-xs font-mono text-slate-500">
                          {player.playerTag}
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs font-mono tabular-nums text-slate-600">
                          {player.ratingScore} pts ({player.wins}W–
                          {player.losses}L)
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          {showClubFinancials && managedOwnedClub
                            ? `Club Ledger & Wallet · ${managedOwnedClub.name}`
                            : 'Platform User Profile & Club Ownership'}
                        </span>
                        {onOpenPlayerProfile && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPlayerId(null);
                              onOpenPlayerProfile(player.id);
                            }}
                            className="font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer whitespace-nowrap"
                          >
                            View Full Profile →
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingPlayerId(null)}
                      className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer shrink-0"
                      aria-label="Close modal"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Scrollable Modal Content */}
                  <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
                    {/* CLUB OWNER LEDGER SECTIONS (Only shown when managing owned club) */}
                    {showClubFinancials && managedOwnedClub && (
                      <>
                        {/* SECTION 1: Club-Scoped Financial Balances & Session Bills */}
                        <div className="bg-slate-50/70 rounded-2xl border border-slate-200/90 p-3.5 sm:p-4 space-y-3.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-900">
                              Session Balances in {managedOwnedClub.name}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              Club-scoped ledger
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                            <div className="bg-white rounded-xl border border-slate-200/80 p-3 flex items-center justify-between sm:flex-col sm:items-start gap-1">
                              <span className="text-xs font-semibold text-slate-600">
                                Received
                              </span>
                              <div className="text-right sm:text-left">
                                <span className="text-base sm:text-lg font-bold font-mono tabular-nums text-emerald-700 block">
                                  ${totalReceived.toFixed(2)}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  {paidSessionsCount}{' '}
                                  {paidSessionsCount === 1
                                    ? 'settled session'
                                    : 'settled sessions'}
                                </span>
                              </div>
                            </div>

                            <div className="bg-white rounded-xl border border-slate-200/80 p-3 flex items-center justify-between sm:flex-col sm:items-start gap-1">
                              <span className="text-xs font-semibold text-slate-600">
                                Pending Approval
                              </span>
                              <div className="text-right sm:text-left">
                                <span
                                  className={`text-base sm:text-lg font-bold font-mono tabular-nums block ${
                                    totalPending > 0
                                      ? 'text-blue-700'
                                      : 'text-slate-600'
                                  }`}
                                >
                                  ${totalPending.toFixed(2)}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  {pendingCount > 0
                                    ? `${pendingCount} awaiting verification`
                                    : 'No pending transfers'}
                                </span>
                              </div>
                            </div>

                            <div className="bg-white rounded-xl border border-slate-200/80 p-3 flex items-center justify-between sm:flex-col sm:items-start gap-1">
                              <span className="text-xs font-semibold text-slate-600">
                                Due Balance
                              </span>
                              <div className="text-right sm:text-left">
                                <span
                                  className={`text-base sm:text-lg font-bold font-mono tabular-nums block ${
                                    totalUnpaid > 0
                                      ? 'text-amber-800'
                                      : 'text-slate-600'
                                  }`}
                                >
                                  ${totalUnpaid.toFixed(2)}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  {unpaidCount > 0
                                    ? `${unpaidCount} unpaid session(s)`
                                    : 'All bills settled'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
                            <span className="text-xs text-slate-600">
                              {debts.length === 0
                                ? `All finalized session fees in ${managedOwnedClub.name} are settled.`
                                : `${debts.length} open session ${
                                    debts.length === 1
                                      ? 'bill requires'
                                      : 'bills require'
                                  } attention.`}
                            </span>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {totalPending > 0 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onAcceptOrClearAllForPlayer(
                                        player.id,
                                        'Approved',
                                        managedOwnedClub.id
                                      )
                                    }
                                    className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer shadow-2xs"
                                  >
                                    <Check className="w-3.5 h-3.5 shrink-0" />
                                    <span>Approve Pending</span>
                                  </button>
                                  {onRejectAllForPlayer && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPendingRejectPlayer(player)
                                      }
                                      className="h-8 px-2.5 bg-white border border-slate-300 hover:bg-rose-50 hover:text-rose-700 text-slate-700 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                      <span>Reject</span>
                                    </button>
                                  )}
                                </>
                              )}

                              {totalUnpaid > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onAcceptOrClearAllForPlayer(
                                      player.id,
                                      'Received',
                                      managedOwnedClub.id
                                    )
                                  }
                                  className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer shadow-2xs"
                                >
                                  <Check className="w-3.5 h-3.5 shrink-0" />
                                  <span>Mark All Received</span>
                                </button>
                              )}

                              {debts.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowModalBillsList((prev) => !prev)
                                  }
                                  className={`h-8 px-3 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shadow-2xs ${
                                    showModalBillsList
                                      ? 'bg-slate-900 border-slate-900 text-white'
                                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  <FileText className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    {showModalBillsList
                                      ? 'Hide Bills'
                                      : `Session Bills (${debts.length})`}
                                  </span>
                                </button>
                              )}
                            </div>
                          </div>

                          {showModalBillsList && debts.length > 0 && (
                            <div className="pt-3 border-t border-slate-200/80 space-y-2">
                              <div className="divide-y divide-slate-200/70 bg-white rounded-xl border border-slate-200/80 px-3.5">
                                {debts.map(({ rsvp, session }) => (
                                  <div
                                    key={rsvp.id}
                                    className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                                  >
                                    <div className="space-y-0.5 min-w-0">
                                      {onOpenSessionLedger ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingPlayerId(null);
                                            onOpenSessionLedger(session.id);
                                          }}
                                          className="font-semibold text-slate-900 hover:underline truncate cursor-pointer block text-left"
                                        >
                                          {session.title}
                                        </button>
                                      ) : (
                                        <span className="font-semibold text-slate-900 truncate block">
                                          {session.title}
                                        </span>
                                      )}
                                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                        <span className="font-mono">
                                          {session.sessionDate}
                                        </span>
                                        <span>·</span>
                                        <span
                                          className={`font-semibold ${
                                            rsvp.paidStatus ===
                                            'pending_approval'
                                              ? 'text-blue-700'
                                              : 'text-amber-800'
                                          }`}
                                        >
                                          {rsvp.paidStatus ===
                                          'pending_approval'
                                            ? `Pending (${rsvp.paidMethod})`
                                            : 'Unpaid'}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                                      <div className="flex items-center gap-1.5">
                                        {onAcceptOrClearSingleRsvp && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              onAcceptOrClearSingleRsvp(
                                                rsvp.id,
                                                'Received'
                                              )
                                            }
                                            className="h-7 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                          >
                                            <Check className="w-3 h-3 shrink-0" />
                                            <span>Receive</span>
                                          </button>
                                        )}
                                        {rsvp.paidStatus ===
                                          'pending_approval' &&
                                          onRejectPaymentForRsvp && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setPendingRejectSingleRsvp(rsvp)
                                              }
                                              className="h-7 px-2 rounded-lg bg-white border border-slate-300 hover:bg-rose-50 text-slate-600 hover:text-rose-700 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                            >
                                              <X className="w-3 h-3 text-rose-600 shrink-0" />
                                              <span>Reject</span>
                                            </button>
                                          )}
                                      </div>
                                      <span className="w-16 text-right font-mono tabular-nums font-bold text-slate-900">
                                        ${rsvp.feeShare.toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* SECTION 2: Club-Scoped Prepaid Credit, Free Session Passes & Fee Waiver */}
                        {onUpdatePlayerWallet && (
                          <div className="space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                <Gift className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span>
                                  Club Wallet &amp; Perks ({managedOwnedClub.name})
                                </span>
                              </span>
                              <span className="text-[11px] text-slate-500">
                                Strictly applies to sessions in{' '}
                                {managedOwnedClub.name}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                              {/* Card 1: Prepaid Credit Top-Up */}
                              <div className="bg-slate-50/70 rounded-xl border border-slate-200/90 p-3.5 sm:p-4 flex flex-col justify-between gap-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <span className="text-xs font-bold text-slate-900 block">
                                      Club Prepaid Credit
                                    </span>
                                    <span className="text-[11px] text-slate-500">
                                      Deducted automatically on club split
                                    </span>
                                  </div>
                                  <span className="text-base sm:text-lg font-bold text-sky-700 font-mono tabular-nums">
                                    ${currentCredit.toFixed(2)}
                                  </span>
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
                                      }}
                                      className="h-8 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-200/90 text-xs font-semibold font-mono tabular-nums whitespace-nowrap cursor-pointer transition-colors"
                                    >
                                      +${amt}
                                    </button>
                                  ))}
                                </div>

                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={walletTopUpInput}
                                    onChange={(e) =>
                                      setWalletTopUpInput(e.target.value)
                                    }
                                    className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 font-mono tabular-nums focus:outline-none focus:border-slate-500"
                                    placeholder="Custom $"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const parsed = Number(walletTopUpInput);
                                      if (
                                        !Number.isFinite(parsed) ||
                                        parsed <= 0
                                      )
                                        return;
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
                                    }}
                                    className="px-3 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    Top Up
                                  </button>
                                  {currentCredit > 0 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPendingResetCreditPlayer(player)
                                      }
                                      className="px-2.5 h-8 rounded-lg bg-white border border-slate-300 text-slate-600 hover:text-rose-700 hover:bg-rose-50 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                                    >
                                      Reset
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Card 2: Free Session Passes */}
                              <div className="bg-slate-50/70 rounded-xl border border-slate-200/90 p-3.5 sm:p-4 flex flex-col justify-between gap-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <span className="text-xs font-bold text-slate-900 block">
                                      Club Free Session Passes
                                    </span>
                                    <span className="text-[11px] text-slate-500">
                                      1 pass waives 1 full session share
                                    </span>
                                  </div>
                                  <span className="text-base sm:text-lg font-bold text-emerald-700 font-mono tabular-nums whitespace-nowrap">
                                    {currentPasses}{' '}
                                    <span className="text-xs font-sans font-semibold">
                                      left
                                    </span>
                                  </span>
                                </div>

                                <div className="grid grid-cols-4 gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onUpdatePlayerWallet(
                                        player.id,
                                        {
                                          freeSessionPasses: Math.max(
                                            0,
                                            currentPasses - 1
                                          ),
                                        },
                                        managedOwnedClub.id
                                      );
                                    }}
                                    disabled={currentPasses <= 0}
                                    className="h-8 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40 text-xs font-semibold font-mono tabular-nums whitespace-nowrap cursor-pointer"
                                  >
                                    -1
                                  </button>
                                  {[1, 3, 5].map((cnt) => (
                                    <button
                                      key={cnt}
                                      type="button"
                                      onClick={() => {
                                        onUpdatePlayerWallet(
                                          player.id,
                                          {
                                            freeSessionPasses:
                                              currentPasses + cnt,
                                          },
                                          managedOwnedClub.id
                                        );
                                      }}
                                      className="h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200/90 text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
                                    >
                                      +{cnt} Pass
                                    </button>
                                  ))}
                                </div>

                                <p className="text-[11px] text-slate-500 leading-snug">
                                  {currentPasses > 0
                                    ? `Covers the next ${currentPasses} finalized session(s) in ${managedOwnedClub.name}.`
                                    : `Grant free passes for ${managedOwnedClub.name}.`}
                                </p>
                              </div>

                              {/* Card 3 (Full Width): Complete Fee Waiver */}
                              <div className="sm:col-span-2 bg-slate-50/70 rounded-xl border border-slate-200/90 p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-900">
                                      Club Complete Fee Waiver (VIP Exemption)
                                    </span>
                                    {currentWaived && (
                                      <span className="text-[11px] font-semibold text-purple-700">
                                        · Active in {managedOwnedClub.name}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-500">
                                    Waives all current unpaid &amp; future
                                    session fees for {player.name} in{' '}
                                    {managedOwnedClub.name} ($0.00 share).
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onUpdatePlayerWallet(
                                      player.id,
                                      {
                                        waiveAllFees: !currentWaived,
                                      },
                                      managedOwnedClub.id
                                    )
                                  }
                                  className={`h-9 px-4 rounded-xl text-xs font-semibold border whitespace-nowrap transition-colors cursor-pointer shrink-0 self-start sm:self-center ${
                                    currentWaived
                                      ? 'bg-purple-600 hover:bg-purple-700 text-white border-purple-600 shadow-2xs'
                                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                  }`}
                                >
                                  {currentWaived
                                    ? 'Waiver Active · Disable'
                                    : 'Enable Club Waiver'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* SECTION 3: Profile Details & Club Ownership */}
                    <div
                      className={`${
                        showClubFinancials
                          ? 'pt-4 border-t border-slate-200/80'
                          : ''
                      } space-y-4`}
                    >
                      <div
                        className={`grid grid-cols-1 ${
                          isSiteAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
                        } gap-3.5`}
                      >
                        <StyledInput
                          label="Full Name"
                          type="text"
                          maxLength={80}
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
                        <StyledInput
                          label="Rating Score"
                          type="number"
                          min={800}
                          max={3000}
                          value={editRating}
                          error={editUserErrors.rating}
                          onChange={(e) => {
                            setEditRating(parseInt(e.target.value, 10) || 0);
                            if (editUserErrors.rating)
                              setEditUserErrors((prev) => ({
                                ...prev,
                                rating: undefined,
                              }));
                          }}
                          className="font-mono tabular-nums"
                        />
                        {isSiteAdmin && (
                          <StyledSelect
                            label="Club Owner Assignment"
                            value={editOwnedClubId}
                            onChange={(e) => setEditOwnedClubId(e.target.value)}
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

                      {/* Read-only Joined Clubs Display */}
                      <div className="bg-slate-50/70 rounded-xl border border-slate-200/80 p-3 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                          <span className="font-semibold text-slate-700">
                            Joined Clubs ({joinedClubs.length})
                          </span>
                          <span className="text-[11px] text-slate-500">
                            Read-only · Joining a club is strictly by player
                            intention
                          </span>
                        </div>
                        <p className="text-xs text-slate-800">
                          {joinedClubs.length > 0
                            ? joinedClubs
                                .map((c) =>
                                  c.clubOwnerPlayerId === player.id
                                    ? `${c.name} (Club Owner)`
                                    : c.name
                                )
                                .join(' · ')
                            : 'No clubs joined yet'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Sticky Modal Footer */}
                  <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200/80 bg-slate-50/80 flex items-center justify-between gap-2.5 shrink-0">
                    <div>
                      {isSiteAdmin &&
                        player.id !== activePlayer.id &&
                        players.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPlayerId(null);
                              setPendingDeletePlayer(player);
                            }}
                            className="h-9 px-3 rounded-xl text-rose-700 hover:bg-rose-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete User</span>
                          </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setEditingPlayerId(null)}
                        className="h-9 px-4 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl inline-flex items-center justify-center whitespace-nowrap cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center whitespace-nowrap cursor-pointer shadow-xs"
                      >
                        Save Changes
                      </button>
                    </div>
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
              <strong className="font-semibold text-slate-900">
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
              <strong className="font-semibold text-slate-900">
                {pendingRejectPlayer.name}
              </strong>{' '}
              in{' '}
              <strong className="font-semibold text-slate-900">
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
              <strong className="font-semibold text-slate-900">
                {pendingRejectSingleRsvp.playerName}
              </strong>
              &rsquo;s{' '}
              <strong className="font-mono font-semibold text-slate-900">
                ${pendingRejectSingleRsvp.feeShare.toFixed(2)}
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
              <strong className="font-semibold text-slate-900">
                {pendingResetCreditPlayer.name}
              </strong>
              &rsquo;s prepaid credit balance in{' '}
              <strong className="font-semibold text-slate-900">
                {managedOwnedClub.name}
              </strong>{' '}
              (
              <strong className="font-mono font-semibold text-slate-900">
                $
                {getPlayerClubWallet(
                  pendingResetCreditPlayer,
                  managedOwnedClub.id
                ).creditBalance.toFixed(2)}
              </strong>
              ) back to $0.00?
            </p>
          ) : null
        }
        confirmLabel="Reset to $0.00"
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
        }}
      />
    </div>
  );
};
