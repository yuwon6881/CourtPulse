import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Edit3,
  FileText,
  Gift,
  Plus,
  Search,
  Sparkles,
  Ticket,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Club,
  PermissionTier,
  Player,
  PlayerBenefitWallet,
  Session,
  SessionRsvp,
} from '../types';
import {
  calculateOutstandingBalancesByPlayerMap,
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
    method: string
  ) => Promise<void>;
  onRejectAllForPlayer?: (playerId: string) => Promise<void>;
  onAcceptOrClearSingleRsvp?: (rsvpId: string, method: string) => Promise<void>;
  onRejectPaymentForRsvp?: (rsvpId: string) => Promise<void>;
  onOpenPlayerProfile?: (playerId: string) => void;
  onOpenSessionLedger?: (sessionId: string) => void;
  onUpdatePlayerWallet?: (
    playerId: string,
    updates: Partial<PlayerBenefitWallet>
  ) => void;
}

type MemberSortKey = 'due_desc' | 'pending_desc' | 'received_desc' | 'rating_desc' | 'name_asc';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'owing' | 'perks' | 'owners'
  >('all');
  const [tableClubFilter, setTableClubFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<MemberSortKey>('due_desc');
  const [visibleMemberCount, setVisibleMemberCount] = useState(25);
  const [visibleClubCount, setVisibleClubCount] = useState(15);

  // Platform Clubs vertical scrollable section state — only display member info on click
  const [clubSearchQuery, setClubSearchQuery] = useState('');
  const [expandedPlatformClubId, setExpandedPlatformClubId] = useState<
    string | null
  >(null);

  // Create User State
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRating, setNewRating] = useState(1200);
  const [newClubIds, setNewClubIds] = useState<string[]>(() =>
    clubs[0] ? [clubs[0].id] : []
  );

  // Table Row Expand States (Bills breakdown & Wallet/Profile Edit)
  const [expandedBillsPlayerId, setExpandedBillsPlayerId] = useState<
    string | null
  >(null);
  const [showModalBillsList, setShowModalBillsList] = useState<boolean>(false);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRating, setEditRating] = useState(1200);
  const [editClubIds, setEditClubIds] = useState<string[]>([]);
  const [editOwnedClubId, setEditOwnedClubId] = useState<string>('NONE');
  const [savedNoticeId, setSavedNoticeId] = useState<string | null>(null);
  const [walletTopUpInput, setWalletTopUpInput] = useState<string>('20');
  const [pendingDeletePlayer, setPendingDeletePlayer] =
    useState<Player | null>(null);
  const [pendingRejectPlayer, setPendingRejectPlayer] =
    useState<Player | null>(null);
  const [pendingRejectSingleRsvp, setPendingRejectSingleRsvp] =
    useState<SessionRsvp | null>(null);
  const [pendingResetCreditPlayer, setPendingResetCreditPlayer] =
    useState<Player | null>(null);

  const isSiteAdmin = permissionTier === 'admin';
  const resolvedActiveClub = activeClub || clubs[0];
  const manageableClubs = useMemo(
    () =>
      (isSiteAdmin ? clubs : [resolvedActiveClub]).filter((c): c is Club =>
        Boolean(c)
      ),
    [isSiteAdmin, clubs, resolvedActiveClub]
  );

  // Map finalized completed sessions for received/paid total calculation in O(S)
  const finalizedSessionIds = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      if (s.bookingStatus === 'completed' && s.feeSplitFinalized) {
        set.add(s.id);
      }
    }
    return set;
  }, [sessions]);

  // Single-pass O(S + C + R) outstanding debts map across all players
  const debtsByPlayerId = useMemo(
    () => calculateOutstandingBalancesByPlayerMap(sessions, rsvps, undefined, clubs),
    [sessions, rsvps, clubs]
  );

  // Single-pass O(R) player received/attendance stats & per-club financial totals
  const { playerRsvpStatsMap, clubLedgerStatsMap } = useMemo(() => {
    const pStats = new Map<
      string,
      {
        totalReceived: number;
        paidSessionsCount: number;
        sessionsAttendedCount: number;
      }
    >();
    const cStats = new Map<
      string,
      {
        clubReceived: number;
        clubPending: number;
        clubUnpaid: number;
      }
    >();

    for (let i = 0; i < rsvps.length; i++) {
      const r = rsvps[i];
      if (!finalizedSessionIds.has(r.sessionId)) continue;

      let pEntry = pStats.get(r.playerId);
      if (!pEntry) {
        pEntry = {
          totalReceived: 0,
          paidSessionsCount: 0,
          sessionsAttendedCount: 0,
        };
        pStats.set(r.playerId, pEntry);
      }

      if (r.paidStatus === 'paid' && r.feeShare > 0) {
        pEntry.totalReceived += r.feeShare;
        pEntry.paidSessionsCount += 1;
      }
      if (r.status === 'going' && r.attendanceOutcome === 'present') {
        pEntry.sessionsAttendedCount += 1;
      }

      let cEntry = cStats.get(r.clubId);
      if (!cEntry) {
        cEntry = { clubReceived: 0, clubPending: 0, clubUnpaid: 0 };
        cStats.set(r.clubId, cEntry);
      }
      if (r.paidStatus === 'paid') {
        cEntry.clubReceived += r.feeShare;
      } else if (r.paidStatus === 'pending_approval') {
        cEntry.clubPending += r.feeShare;
      } else if (r.paidStatus === 'unpaid') {
        cEntry.clubUnpaid += r.feeShare;
      }
    }

    return { playerRsvpStatsMap: pStats, clubLedgerStatsMap: cStats };
  }, [rsvps, finalizedSessionIds]);

  // Pre-index clubs & memberships in O(C + P)
  const { clubByIdMap, ownedClubByOwnerIdMap, membersByClubIdMap } = useMemo(() => {
    const cMap = new Map<string, Club>();
    const ownerMap = new Map<string, Club>();
    const mMap = new Map<string, Player[]>();

    for (let i = 0; i < clubs.length; i++) {
      const c = clubs[i];
      cMap.set(c.id, c);
      mMap.set(c.id, []);
      if (c.clubOwnerPlayerId) {
        ownerMap.set(c.clubOwnerPlayerId, c);
      }
    }

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const joined = getPlayerJoinedClubIds(p);
      for (let j = 0; j < joined.length; j++) {
        const list = mMap.get(joined[j]);
        if (list) list.push(p);
      }
    }

    return {
      clubByIdMap: cMap,
      ownedClubByOwnerIdMap: ownerMap,
      membersByClubIdMap: mMap,
    };
  }, [clubs, players]);

  const playerSummaries = useMemo(() => {
    return players.map((player) => {
      const joinedIds = getPlayerJoinedClubIds(player);
      const joinedClubs: Club[] = [];
      for (let i = 0; i < joinedIds.length; i++) {
        const c = clubByIdMap.get(joinedIds[i]);
        if (c) joinedClubs.push(c);
      }
      const ownedClub = ownedClubByOwnerIdMap.get(player.id) || null;

      const debts = debtsByPlayerId.get(player.id) || [];
      let totalUnpaid = 0;
      let totalPending = 0;
      let unpaidCount = 0;
      let pendingCount = 0;

      for (let i = 0; i < debts.length; i++) {
        const d = debts[i];
        if (d.rsvp.paidStatus === 'unpaid') {
          totalUnpaid += d.rsvp.feeShare;
          unpaidCount += 1;
        } else if (d.rsvp.paidStatus === 'pending_approval') {
          totalPending += d.rsvp.feeShare;
          pendingCount += 1;
        }
      }

      const rStats = playerRsvpStatsMap.get(player.id);
      const totalReceived = rStats ? rStats.totalReceived : 0;
      const paidSessionsCount = rStats ? rStats.paidSessionsCount : 0;
      const sessionsAttendedCount = rStats ? rStats.sessionsAttendedCount : 0;

      const hasPerks =
        Boolean(player.waiveAllFees) ||
        Number(player.freeSessionPasses || 0) > 0 ||
        Number(player.creditBalance || 0) > 0;

      return {
        player,
        joinedIds,
        joinedClubs,
        ownedClub,
        debts,
        totalReceived,
        paidSessionsCount,
        sessionsAttendedCount,
        totalUnpaid,
        totalPending,
        unpaidCount,
        pendingCount,
        hasPerks,
      };
    });
  }, [
    players,
    clubByIdMap,
    ownedClubByOwnerIdMap,
    debtsByPlayerId,
    playerRsvpStatsMap,
  ]);

  const summaryByPlayerId = useMemo(() => {
    const map = new Map<string, (typeof playerSummaries)[number]>();
    playerSummaries.forEach((s) => map.set(s.player.id, s));
    return map;
  }, [playerSummaries]);

  // Platform Clubs summaries for the vertical scrollable section in O(C)
  const platformClubSummaries = useMemo(() => {
    const q = clubSearchQuery.trim().toLowerCase();
    return clubs
      .filter((club) => {
        if (!q) return true;
        return (
          club.name.toLowerCase().includes(q) ||
          (club.clubOwnerName || '').toLowerCase().includes(q) ||
          club.description.toLowerCase().includes(q)
        );
      })
      .map((club) => {
        const members = membersByClubIdMap.get(club.id) || [];
        const cStats = clubLedgerStatsMap.get(club.id);
        return {
          club,
          members,
          clubReceived: cStats ? cStats.clubReceived : 0,
          clubPending: cStats ? cStats.clubPending : 0,
          clubUnpaid: cStats ? cStats.clubUnpaid : 0,
        };
      });
  }, [clubs, membersByClubIdMap, clubLedgerStatsMap, clubSearchQuery]);

  const filteredSummaries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = playerSummaries.filter((item) => {
      if (
        isSiteAdmin &&
        tableClubFilter !== 'all' &&
        !item.joinedIds.includes(tableClubFilter)
      ) {
        return false;
      }
      if (statusFilter === 'owners' && !item.ownedClub) return false;
      if (
        statusFilter === 'owing' &&
        item.totalUnpaid <= 0 &&
        item.totalPending <= 0
      ) {
        return false;
      }
      if (statusFilter === 'perks' && !item.hasPerks) return false;

      if (!q) return true;
      return (
        item.player.name.toLowerCase().includes(q) ||
        item.player.playerTag.toLowerCase().includes(q) ||
        (isSiteAdmin &&
          item.joinedClubs.some((c) => c.name.toLowerCase().includes(q))) ||
        (isSiteAdmin &&
          item.ownedClub &&
          item.ownedClub.name.toLowerCase().includes(q))
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'due_desc') {
        if (b.totalUnpaid !== a.totalUnpaid) {
          return b.totalUnpaid - a.totalUnpaid;
        }
        if (b.totalPending !== a.totalPending) {
          return b.totalPending - a.totalPending;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      if (sortBy === 'pending_desc') {
        if (b.totalPending !== a.totalPending) {
          return b.totalPending - a.totalPending;
        }
        if (b.totalUnpaid !== a.totalUnpaid) {
          return b.totalUnpaid - a.totalUnpaid;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      if (sortBy === 'received_desc') {
        if (b.totalReceived !== a.totalReceived) {
          return b.totalReceived - a.totalReceived;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      if (sortBy === 'rating_desc') {
        if (b.player.ratingScore !== a.player.ratingScore) {
          return b.player.ratingScore - a.player.ratingScore;
        }
        return a.player.name.localeCompare(b.player.name);
      }
      return a.player.name.localeCompare(b.player.name);
    });
  }, [playerSummaries, searchQuery, statusFilter, tableClubFilter, sortBy, isSiteAdmin]);

  const totalPlatformReceived = playerSummaries.reduce(
    (sum, p) => sum + p.totalReceived,
    0
  );
  const totalPlatformUnpaid = playerSummaries.reduce(
    (sum, p) => sum + p.totalUnpaid,
    0
  );
  const totalPlatformPending = playerSummaries.reduce(
    (sum, p) => sum + p.totalPending,
    0
  );
  const totalOwnersCount = playerSummaries.filter((p) =>
    Boolean(p.ownedClub)
  ).length;
  const totalOwingUsersCount = playerSummaries.filter(
    (p) => p.totalUnpaid > 0 || p.totalPending > 0
  ).length;
  const totalPerksUsersCount = playerSummaries.filter(
    (p) => p.hasPerks
  ).length;

  const filteredTotals = useMemo(() => {
    return filteredSummaries.reduce(
      (acc, item) => ({
        received: acc.received + item.totalReceived,
        pending: acc.pending + item.totalPending,
        unpaid: acc.unpaid + item.totalUnpaid,
      }),
      { received: 0, pending: 0, unpaid: 0 }
    );
  }, [filteredSummaries]);

  const visibleSummaries = useMemo(
    () => filteredSummaries.slice(0, visibleMemberCount),
    [filteredSummaries, visibleMemberCount]
  );

  const visiblePlatformClubs = useMemo(
    () => platformClubSummaries.slice(0, visibleClubCount),
    [platformClubSummaries, visibleClubCount]
  );

  const handleToggleNewClub = (clubId: string) => {
    setNewClubIds((prev) =>
      prev.includes(clubId)
        ? prev.filter((id) => id !== clubId)
        : [...prev, clubId]
    );
  };

  const handleToggleEditClub = (clubId: string) => {
    setEditClubIds((prev) =>
      prev.includes(clubId)
        ? prev.filter((id) => id !== clubId)
        : [...prev, clubId]
    );
  };

  const handleStartEdit = (player: Player) => {
    const joinedIds = getPlayerJoinedClubIds(player);
    const owned = clubs.find((c) => c.clubOwnerPlayerId === player.id);
    setEditingPlayerId(player.id);
    setShowModalBillsList(false);
    setEditName(player.name);
    setEditRating(player.ratingScore);
    setEditClubIds(joinedIds);
    setEditOwnedClubId(owned ? owned.id : 'NONE');
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const defaultClubId =
      resolvedActiveClub?.id || clubs[0]?.id || 'club_bintang_prime';
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
    if (!editName.trim()) return;
    const userChosenClubs = getPlayerJoinedClubIds(player);
    const preservedClubs =
      editOwnedClubId !== 'NONE' && !userChosenClubs.includes(editOwnedClubId)
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
      const currentOwned = clubs.find((c) => c.clubOwnerPlayerId === player.id);
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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display">
            Users, Member Balances &amp; Wallets
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {isSiteAdmin
              ? 'Audit member fee balances across finalized sessions, manage prepaid credits & passes, and inspect platform clubs.'
              : `Audit member fee balances for ${resolvedActiveClub?.name || 'your club'} and manage prepaid credits, free passes, and waivers.`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateForm(true)}
          className="h-10 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto shadow-xs"
        >
          <UserPlus className="w-4 h-4 shrink-0" />
          <span>Add Member</span>
        </button>
      </div>

      {/* 4-Column Member Financial & Roster KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">Registered Members</span>
            <span className="font-mono tabular-nums text-slate-600 font-medium truncate max-w-28">
              {isSiteAdmin
                ? `${totalOwnersCount} owners`
                : resolvedActiveClub?.name || 'Club'}
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {players.length}
          </p>
          <p className="text-[11px] text-slate-600 truncate">
            Signed in as {activePlayer.name}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">Received Total</span>
            <span className="text-emerald-700 font-semibold">Settled</span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700">
            ${totalPlatformReceived.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-600">
            Cumulative verified payments
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">Pending Approval</span>
            <span className="text-blue-700 font-semibold font-mono tabular-nums">
              {playerSummaries.filter((p) => p.totalPending > 0).length} member(s)
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-blue-700">
            ${totalPlatformPending.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-600">
            Marked paid · awaiting verification
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">Total Due (Unpaid)</span>
            <span className="text-amber-800 font-semibold font-mono tabular-nums">
              {playerSummaries.filter((p) => p.totalUnpaid > 0).length} owing
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-800">
            ${totalPlatformUnpaid.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-600">
            Outstanding across sessions
          </p>
        </div>
      </div>

      {/* Create New User Modal */}
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
                    Register New Member
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Creates a player profile. Members choose and join clubs directly by their own intention.
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

              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <StyledInput
                    label="Full Name"
                    type="text"
                    required
                    maxLength={80}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Jordan Lim"
                  />
                  <StyledInput
                    label="Initial Rating"
                    type="number"
                    min={800}
                    max={3000}
                    value={newRating}
                    onChange={(e) =>
                      setNewRating(parseInt(e.target.value, 10) || 1200)
                    }
                    className="font-mono tabular-nums"
                  />
                </div>

                <p className="text-[11px] text-slate-500 bg-slate-50 rounded-xl border border-slate-200/80 px-3 py-2">
                  Club membership is determined solely by user intention—players join or leave clubs directly via club invite links or the Clubs directory.
                </p>

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
                    Create Member
                  </button>
                </div>
              </form>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      {/* All Platform Clubs Section — Site Admin Only (since Club Owner owns a single club) */}
      {isSiteAdmin && (
        <section
          aria-label="Platform Clubs"
          className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-2xs"
        >
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="w-4 h-4 text-slate-600 shrink-0" />
              <div>
                <h2 className="text-sm font-bold text-slate-900 font-display">
                  All Platform Clubs ({clubs.length})
                </h2>
                <p className="text-[11px] text-slate-600">
                  Vertical scrollable directory · Click any club to inspect its member list and balances
                </p>
              </div>
            </div>

            <div className="w-full sm:w-64 shrink-0">
              <StyledInput
                type="text"
                icon={<Search className="w-3.5 h-3.5" />}
                value={clubSearchQuery}
                onChange={(e) => {
                  setClubSearchQuery(e.target.value);
                  setVisibleClubCount(15);
                }}
                placeholder="Filter platform clubs..."
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {platformClubSummaries.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-600">
                No platform clubs match &ldquo;{clubSearchQuery}&rdquo;.
              </div>
            ) : (
              <>
                {visiblePlatformClubs.map(({ club, members }) => {
                  const isRowExpanded = expandedPlatformClubId === club.id;
                  return (
                    <div key={club.id} className="w-full">
                      <button
                        type="button"
                        onClick={() => setExpandedPlatformClubId(club.id)}
                        className={`w-full px-4 sm:px-5 py-3.5 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors cursor-pointer focus-visible:shadow-none ${
                          isRowExpanded
                            ? 'bg-slate-100/90'
                            : 'hover:bg-slate-50/90 active:bg-slate-100/90'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {club.name}
                            </span>
                            <span className="text-[11px] text-slate-600">
                              · Owner:{' '}
                              <strong className="font-semibold text-slate-800">
                                {club.clubOwnerName || 'Alex Tan'}
                              </strong>
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 truncate mt-0.5">
                            {club.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 text-xs font-mono tabular-nums">
                          <span className="text-[11px] font-sans font-semibold text-slate-700">
                            {members.length}{' '}
                            {members.length === 1 ? 'member' : 'members'}
                          </span>
                        </div>
                      </button>
                    </div>
                  );
                })}
                {platformClubSummaries.length > visibleClubCount && (
                  <div className="p-3 bg-white text-center">
                    <button
                      type="button"
                      onClick={() => setVisibleClubCount((prev) => prev + 15)}
                      className="h-8 px-3.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                    >
                      Show More Clubs ({platformClubSummaries.length - visibleClubCount} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* Platform Club Member Roster & Balances Modal */}
      <AnimatePresence>
        {expandedPlatformClubId &&
          (() => {
            const selectedSummary = platformClubSummaries.find(
              (s) => s.club.id === expandedPlatformClubId
            );
            if (!selectedSummary) return null;
            const { club, members, clubReceived, clubPending, clubUnpaid } =
              selectedSummary;

            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
                onClick={() => setExpandedPlatformClubId(null)}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900 truncate font-display">
                          {club.name} — Club Details &amp; Balances ({members.length} members)
                        </h3>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Owner: <strong className="font-semibold text-slate-800">{club.clubOwnerName || 'Alex Tan'}</strong> · {club.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedPlatformClubId(null)}
                      className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-5 overflow-y-auto flex-1 space-y-4">
                    {/* Club Balance Summary Strip (Shown Inside Modal) */}
                    <div className="grid grid-cols-3 gap-3 bg-slate-50 rounded-xl border border-slate-200/80 p-3.5 font-mono tabular-nums text-xs">
                      <div>
                        <span className="text-[11px] font-sans font-semibold text-slate-600 block">
                          Receive
                        </span>
                        <span className="text-sm sm:text-base font-bold text-emerald-700">
                          ${clubReceived.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] font-sans font-semibold text-slate-600 block">
                          Pending
                        </span>
                        <span className="text-sm sm:text-base font-bold text-blue-700">
                          ${clubPending.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] font-sans font-semibold text-slate-600 block">
                          Due Balance
                        </span>
                        <span
                          className={`text-sm sm:text-base font-bold ${
                            clubUnpaid > 0 ? 'text-amber-800' : 'text-slate-600'
                          }`}
                        >
                          ${clubUnpaid.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-slate-500" />
                        <span>Select any member row to manage bills, wallet, perks, or profile</span>
                      </span>
                    </div>

                    {members.length === 0 ? (
                      <p className="text-xs text-slate-600 py-4 text-center">
                        No members currently assigned to this club.
                      </p>
                    ) : (
                      <div className="rounded-xl border border-slate-200/80 bg-white overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-white border-b border-slate-200/80 text-[11px] font-semibold text-slate-600">
                            <tr>
                              <th className="py-2.5 px-3">Member</th>
                              <th className="hidden sm:table-cell py-2.5 px-3">Club Role</th>
                              <th className="py-2.5 px-3">Active Perks</th>
                              <th className="hidden sm:table-cell py-2.5 px-3 text-right">
                                Rating &amp; W–L
                              </th>
                              <th className="py-2.5 px-3 text-right">
                                Due Balance
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-xs">
                            {members.map((m) => {
                              const mSum = summaryByPlayerId.get(m.id);
                              const isClubOwner = club.clubOwnerPlayerId === m.id;
                              const dueAmt = mSum ? mSum.totalUnpaid : 0;
                              const pendAmt = mSum ? mSum.totalPending : 0;

                              return (
                                <tr
                                  key={m.id}
                                  onClick={() => {
                                    setExpandedPlatformClubId(null);
                                    handleStartEdit(m);
                                  }}
                                  className="bg-white hover:bg-slate-50/90 transition-colors cursor-pointer"
                                >
                                  <td className="py-2.5 px-3">
                                    <span className="font-semibold text-slate-900">
                                      {m.name}
                                    </span>
                                    <span className="font-mono text-[11px] text-slate-500 ml-1.5">
                                      {m.playerTag}
                                    </span>
                                  </td>
                                  <td className="hidden sm:table-cell py-2.5 px-3">
                                    {isClubOwner ? (
                                      <span className="font-semibold text-emerald-800">
                                        Club Owner
                                      </span>
                                    ) : (
                                      <span className="text-slate-600">
                                        Member
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-[11px]">
                                    {m.waiveAllFees ? (
                                      <span className="text-purple-700 font-semibold">
                                        All Fees Waived
                                      </span>
                                    ) : Number(m.freeSessionPasses || 0) > 0 ? (
                                      <span className="text-emerald-700 font-semibold">
                                        {Math.floor(
                                          Number(m.freeSessionPasses || 0)
                                        )}{' '}
                                        Free Pass(es)
                                      </span>
                                    ) : Number(m.creditBalance || 0) > 0 ? (
                                      <span className="text-sky-700 font-mono font-semibold tabular-nums">
                                        $
                                        {Number(m.creditBalance || 0).toFixed(2)}{' '}
                                        Credit
                                      </span>
                                    ) : (
                                      <span className="text-slate-600">
                                        Standard
                                      </span>
                                    )}
                                  </td>
                                  <td className="hidden sm:table-cell py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                                    {m.ratingScore} pts · {m.wins}W–{m.losses}L
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                    {dueAmt > 0 ? (
                                      <span className="font-bold text-amber-800">
                                        ${dueAmt.toFixed(2)}
                                      </span>
                                    ) : pendAmt > 0 ? (
                                      <span className="font-semibold text-blue-700">
                                        ${pendAmt.toFixed(2)} pend
                                      </span>
                                    ) : (
                                      <span className="text-slate-600">
                                        $0.00
                                      </span>
                                    )}
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
                      onClick={() => setExpandedPlatformClubId(null)}
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

      {/* Member Directory & Financial Ledger Table Section — Clean White Outer Layer Showing Due Balances */}
      <section
        aria-label="Member Balances Table"
        className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-2xs"
      >
        {/* Table Control Header Bar */}
        <div className="p-4 sm:px-5 border-b border-slate-200/80 space-y-3 bg-white">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 font-display">
                Member Balances &amp; Wallet Directory ({filteredSummaries.length})
              </h2>
              <p className="text-[11px] text-slate-600">
                Select any member to inspect itemized session bills, mark payments received, or manage wallet credits and passes.
              </p>
            </div>

            <div className="flex flex-wrap items-center">
              <SegmentedControl
                size="sm"
                options={[
                  {
                    value: 'all',
                    label: 'All Members',
                    count: playerSummaries.length,
                  },
                  {
                    value: 'owing',
                    label: 'Due / Pending',
                    count: totalOwingUsersCount,
                  },
                  {
                    value: 'perks',
                    label: 'Credits & Waivers',
                    count: totalPerksUsersCount,
                  },
                  ...(isSiteAdmin
                    ? [
                        {
                          value: 'owners' as const,
                          label: 'Club Owners',
                          count: totalOwnersCount,
                        },
                      ]
                    : []),
                ]}
                value={statusFilter}
                onChange={(val) => {
                  setStatusFilter(val);
                  setVisibleMemberCount(25);
                }}
              />
            </div>
          </div>

          <div
            className={`grid grid-cols-1 ${
              isSiteAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
            } gap-2.5`}
          >
            <StyledInput
              type="text"
              icon={<Search className="w-4 h-4" />}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleMemberCount(25);
              }}
              placeholder={
                isSiteAdmin
                  ? 'Search member name, #tag, or club...'
                  : 'Search member name or #tag...'
              }
            />

            {isSiteAdmin && (
              <StyledSelect
                aria-label="Filter table by club"
                value={tableClubFilter}
                onChange={(e) => {
                  setTableClubFilter(e.target.value);
                  setVisibleMemberCount(25);
                }}
              >
                <option value="all">All Clubs ({clubs.length})</option>
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    Club: {c.name}
                  </option>
                ))}
              </StyledSelect>
            )}

            <StyledSelect
              aria-label="Sort members"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as MemberSortKey);
                setVisibleMemberCount(25);
              }}
            >
              <option value="due_desc">Sort: Due Balance (High → Low)</option>
              <option value="pending_desc">
                Sort: Pending Approval First
              </option>
              <option value="received_desc">
                Sort: Received Total (High → Low)
              </option>
              <option value="rating_desc">Sort: Rating Score (High → Low)</option>
              <option value="name_asc">Sort: Member Name (A → Z)</option>
            </StyledSelect>
          </div>
        </div>

        {/* MOBILE & TABLET ERGONOMIC CARD VIEW (< lg) — Clean White Outer Layer */}
        <div className="lg:hidden divide-y divide-slate-100 bg-white">
          {filteredSummaries.length === 0 ? (
            <div className="py-10 px-5 text-center text-xs text-slate-600">
              No members match your current filter criteria.
            </div>
          ) : (
            visibleSummaries.map((item) => {
              const {
                player,
                joinedClubs,
                ownedClub,
                totalUnpaid,
                totalPending,
                unpaidCount,
                pendingCount,
              } = item;
              const isCurrentActive = player.id === activePlayer.id;

              return (
                <div
                  key={player.id}
                  onClick={() => handleStartEdit(player)}
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
                      {isCurrentActive && (
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
                    <p className="text-[11px] text-slate-600">
                      {ownedClub ? `Owner (${ownedClub.name})` : 'Member'}
                      {isSiteAdmin && joinedClubs.length > 0
                        ? ` · ${joinedClubs.map((c) => c.name).join(', ')}`
                        : ''}{' '}
                      · <span className="font-mono">{player.ratingScore} pts</span>
                    </p>
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
          {filteredSummaries.length > visibleMemberCount && (
            <div className="p-3.5 bg-white flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setVisibleMemberCount((prev) => prev + 25)}
                className="h-8 px-3.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Show 25 More ({filteredSummaries.length - visibleMemberCount} remaining)
              </button>
              <button
                type="button"
                onClick={() => setVisibleMemberCount(filteredSummaries.length)}
                className="h-8 px-3 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Show All
              </button>
            </div>
          )}
        </div>

        {/* Structured Vertical-Only Scrollable Data Table with Sticky White Header (lg and up) */}
        <div className="hidden lg:block max-h-[640px] overflow-y-auto overflow-x-hidden bg-white">
          <table className="w-full text-left border-collapse bg-white">
            <thead className="sticky top-0 z-10 bg-white border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-3 px-4">
                  {isSiteAdmin ? 'Member & Clubs' : 'Member'}
                </th>
                <th className="py-3 px-3 text-right">Rating &amp; Record</th>
                <th className="py-3 px-3">Wallet &amp; Perks</th>
                <th className="py-3 px-4 text-right">Due Balance</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 text-xs bg-white">
              {filteredSummaries.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="py-10 px-5 text-center text-xs text-slate-600"
                  >
                    No members match your current filter criteria.
                  </td>
                </tr>
              ) : (
                visibleSummaries.map((item) => {
                  const {
                    player,
                    joinedClubs,
                    ownedClub,
                    sessionsAttendedCount,
                    totalUnpaid,
                    totalPending,
                  } = item;
                  const isCurrentActive = player.id === activePlayer.id;
                  const isEditing = editingPlayerId === player.id;
                  const isBillsOpen = expandedBillsPlayerId === player.id;

                  const clubNamesSummary =
                    joinedClubs.length > 0
                      ? joinedClubs.map((c) => c.name).join(', ')
                      : 'None';

                  return (
                    <tr
                      key={player.id}
                      onClick={() => handleStartEdit(player)}
                      className={`transition-colors cursor-pointer ${
                        isEditing || isBillsOpen
                          ? 'bg-slate-50/90'
                          : 'bg-white hover:bg-slate-50/70'
                      }`}
                    >
                      {/* Col 1: Member Identity & Role */}
                      <td className="py-3.5 px-4 align-middle">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-slate-900">
                            {player.name}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {player.playerTag}
                          </span>
                          {isCurrentActive && (
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

                        <div
                          className="text-[11px] text-slate-600 truncate mt-0.5"
                          title={
                            isSiteAdmin
                              ? `Clubs (${joinedClubs.length}): ${clubNamesSummary}`
                              : undefined
                          }
                        >
                          {ownedClub ? (
                            <span className="font-semibold text-slate-800">
                              {isSiteAdmin
                                ? `Owner (${ownedClub.name})`
                                : 'Club Owner'}
                            </span>
                          ) : (
                            <span>Member</span>
                          )}
                          {isSiteAdmin && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span className="text-slate-800">
                                {clubNamesSummary}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Col 2: Rating & Match/Session Record */}
                      <td className="py-3.5 px-3 align-middle text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {player.ratingScore} pts
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {player.wins}W–{player.losses}L ·{' '}
                          {sessionsAttendedCount}s
                        </div>
                      </td>

                      {/* Col 3: Wallet & Perks */}
                      <td className="py-3.5 px-3 align-middle">
                        <div className="flex flex-wrap items-center gap-1">
                          {Boolean(player.waiveAllFees) && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-800">
                              <Sparkles className="w-3 h-3 text-purple-600 shrink-0" />
                              VIP Waived
                            </span>
                          )}
                          {Number(player.freeSessionPasses || 0) > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                              <Ticket className="w-3 h-3 text-emerald-600 shrink-0" />
                              {Math.floor(
                                Number(player.freeSessionPasses || 0)
                              )}{' '}
                              Free
                            </span>
                          )}
                          {Number(player.creditBalance || 0) > 0 && (
                            <span className="text-[11px] font-mono tabular-nums font-semibold text-sky-800">
                              ${Number(player.creditBalance || 0).toFixed(2)}
                            </span>
                          )}
                          {!player.waiveAllFees &&
                            Number(player.freeSessionPasses || 0) <= 0 &&
                            Number(player.creditBalance || 0) <= 0 && (
                              <span className="text-[11px] text-slate-600">
                                Standard
                              </span>
                            )}
                        </div>
                      </td>

                      {/* Col 4: Due Balance */}
                      <td className="py-3.5 px-4 align-middle text-right font-mono tabular-nums whitespace-nowrap">
                        {totalUnpaid > 0 ? (
                          <>
                            <div className="font-bold text-amber-800">
                              ${totalUnpaid.toFixed(2)}
                            </div>
                            <div className="text-[10px] font-sans text-amber-700">
                              {item.unpaidCount} unpaid
                            </div>
                          </>
                        ) : totalPending > 0 ? (
                          <>
                            <div className="font-bold text-blue-700">
                              ${totalPending.toFixed(2)}
                            </div>
                            <div className="text-[10px] font-sans text-blue-700">
                              {item.pendingCount} pending approval
                            </div>
                          </>
                        ) : (
                          <div className="font-semibold text-slate-600">
                            $0.00
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Table Footer Summary */}
            {filteredSummaries.length > 0 && (
              <tfoot className="bg-white border-t border-slate-200 text-xs font-mono tabular-nums">
                <tr>
                  <td
                    colSpan={3}
                    className="py-3 px-4 sm:px-5 font-sans font-semibold text-slate-700"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        Showing {visibleSummaries.length} of{' '}
                        {filteredSummaries.length} filtered ({playerSummaries.length} total)
                      </span>
                      {filteredSummaries.length > visibleMemberCount && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setVisibleMemberCount((prev) => prev + 25)
                            }
                            className="h-7 px-2.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-[11px] font-semibold text-slate-800 cursor-pointer"
                          >
                            +25 More
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setVisibleMemberCount(filteredSummaries.length)
                            }
                            className="h-7 px-2 rounded-lg text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                          >
                            Show All
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-amber-800">
                    ${filteredTotals.unpaid.toFixed(2)} due
                    {filteredTotals.pending > 0
                      ? ` · $${filteredTotals.pending.toFixed(2)} pend`
                      : ''}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* MODAL: ITEMIZED OUTSTANDING SESSION BILLS FOR A MEMBER */}
      <AnimatePresence>
        {expandedBillsPlayerId &&
          (() => {
            const item = summaryByPlayerId.get(expandedBillsPlayerId);
            if (!item) return null;
            const { player, debts } = item;

            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
                onClick={() => setExpandedBillsPlayerId(null)}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 font-display">
                        Outstanding Session Bills — {player.name}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {debts.length} unsettled session(s)
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedBillsPlayerId(null)}
                      className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-5 overflow-y-auto flex-1 divide-y divide-slate-100">
                    {debts.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">
                        All session bills are settled!
                      </p>
                    ) : (
                      debts.map(({ rsvp, session }) => (
                        <div
                          key={rsvp.id}
                          className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div className="space-y-0.5 min-w-0">
                            {onOpenSessionLedger ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedBillsPlayerId(null);
                                  onOpenSessionLedger(session.id);
                                }}
                                className="font-semibold text-slate-900 hover:underline truncate cursor-pointer block"
                              >
                                {session.title}
                              </button>
                            ) : (
                              <span className="font-semibold text-slate-900 truncate block">
                                {session.title}
                              </span>
                            )}
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <span className="font-mono">
                                {session.sessionDate}
                              </span>
                              <span>·</span>
                              <span
                                className={`font-semibold ${
                                  rsvp.paidStatus === 'pending_approval'
                                    ? 'text-blue-700'
                                    : 'text-amber-800'
                                }`}
                              >
                                {rsvp.paidStatus === 'pending_approval'
                                  ? `Pending (${rsvp.paidMethod})`
                                  : 'Unpaid'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 shrink-0">
                            {onAcceptOrClearSingleRsvp && (
                              <button
                                type="button"
                                onClick={() =>
                                  onAcceptOrClearSingleRsvp(rsvp.id, 'Received')
                                }
                                className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5 shrink-0" />
                                <span>Receive</span>
                              </button>
                            )}
                            {rsvp.paidStatus === 'pending_approval' &&
                              onRejectPaymentForRsvp && (
                                <button
                                  type="button"
                                  onClick={() => setPendingRejectSingleRsvp(rsvp)}
                                  className="h-8 px-2.5 rounded-xl bg-white border border-slate-300 hover:bg-rose-50 text-slate-600 hover:text-rose-700 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                  <span>Reject</span>
                                </button>
                              )}
                            <span className="w-20 text-right font-mono tabular-nums font-bold text-slate-900">
                              ${rsvp.feeShare.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setExpandedBillsPlayerId(null)}
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

      {/* MODAL: FOCUSED MEMBER DETAILS, BILLS, WALLET & PROFILE EDITOR */}
      <AnimatePresence>
        {editingPlayerId &&
          (() => {
            const item = summaryByPlayerId.get(editingPlayerId);
            if (!item) return null;
            const {
              player,
              joinedClubs,
              debts,
              totalReceived,
              paidSessionsCount,
              totalUnpaid,
              totalPending,
              unpaidCount,
              pendingCount,
            } = item;

            const currentCredit = Math.max(
              0,
              Number(player.creditBalance || 0)
            );
            const currentPasses = Math.max(
              0,
              Math.floor(Number(player.freeSessionPasses || 0))
            );

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
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  onSubmit={(e) => handleSaveEdit(e, player)}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden"
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
                          {player.ratingScore} pts ({player.wins}W–{player.losses}L)
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          Manage session bills, payment approvals, prepaid credits, and session passes.
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
                    {/* SECTION 1: Financial Balances & Session Bills */}
                    <div className="bg-slate-50/70 rounded-2xl border border-slate-200/90 p-3.5 sm:p-4 space-y-3.5">
                      {/* 3-Column Responsive Balance Cards */}
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

                      {/* Quick Settlement & Itemized Bills Toolbar */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
                        <span className="text-xs text-slate-600">
                          {debts.length === 0
                            ? 'All finalized session fees for this member are settled.'
                            : `${debts.length} open session ${
                                debts.length === 1 ? 'bill requires' : 'bills require'
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
                                    'Approved'
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
                                  onClick={() => setPendingRejectPlayer(player)}
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
                                  'Received'
                                )
                              }
                              className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer shadow-2xs"
                            >
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>Mark All Received</span>
                            </button>
                          )}

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
                        </div>
                      </div>

                      {/* Expandable Itemized Session Bills inside the Focused Modal */}
                      {showModalBillsList && (
                        <div className="pt-3 border-t border-slate-200/80 space-y-2">
                          {debts.length === 0 ? (
                            <p className="text-xs text-slate-500 py-2 text-center">
                              All session bills are settled!
                            </p>
                          ) : (
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
                                          rsvp.paidStatus === 'pending_approval'
                                            ? 'text-blue-700'
                                            : 'text-amber-800'
                                        }`}
                                      >
                                        {rsvp.paidStatus === 'pending_approval'
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
                                      {rsvp.paidStatus === 'pending_approval' &&
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
                          )}
                        </div>
                      )}
                    </div>

                    {/* SECTION 2: Prepaid Credit, Free Session Passes & Fee Waiver */}
                    {onUpdatePlayerWallet && (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <Gift className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>
                              Prepaid Credits, Session Passes &amp; Fee Waiver
                            </span>
                          </span>
                          <span className="text-[11px] text-slate-500">
                            Auto-settles current unpaid &amp; future finalized session shares
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          {/* Card 1: Prepaid Credit Top-Up */}
                          <div className="bg-slate-50/70 rounded-xl border border-slate-200/90 p-3.5 sm:p-4 flex flex-col justify-between gap-3">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <span className="text-xs font-bold text-slate-900 block">
                                  Prepaid Credit
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  Deducted automatically on split
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
                                    onUpdatePlayerWallet(player.id, {
                                      creditBalance:
                                        Math.round(
                                          (currentCredit + amt) * 100
                                        ) / 100,
                                    });
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
                                  if (!Number.isFinite(parsed) || parsed <= 0)
                                    return;
                                  onUpdatePlayerWallet(player.id, {
                                    creditBalance:
                                      Math.round(
                                        (currentCredit + parsed) * 100
                                      ) / 100,
                                  });
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
                                  Free Session Passes
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
                                  onUpdatePlayerWallet(player.id, {
                                    freeSessionPasses: Math.max(
                                      0,
                                      currentPasses - 1
                                    ),
                                  });
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
                                    onUpdatePlayerWallet(player.id, {
                                      freeSessionPasses: currentPasses + cnt,
                                    });
                                  }}
                                  className="h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200/90 text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors"
                                >
                                  +{cnt} Pass
                                </button>
                              ))}
                            </div>

                            <p className="text-[11px] text-slate-500 leading-snug">
                              {currentPasses > 0
                                ? `Automatically covers the next ${currentPasses} finalized session fee(s).`
                                : 'Grant free session passes to waive upcoming session shares.'}
                            </p>
                          </div>

                          {/* Card 3 (Full Width): Complete Fee Waiver */}
                          <div className="sm:col-span-2 bg-slate-50/70 rounded-xl border border-slate-200/90 p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-900">
                                  Complete Fee Waiver (VIP Exemption)
                                </span>
                                {player.waiveAllFees && (
                                  <span className="text-[11px] font-semibold text-purple-700">
                                    · Active
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500">
                                Completely waives all current unpaid &amp; future session fees for {player.name} ($0.00 share).
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                onUpdatePlayerWallet(player.id, {
                                  waiveAllFees: !player.waiveAllFees,
                                })
                              }
                              className={`h-9 px-4 rounded-xl text-xs font-semibold border whitespace-nowrap transition-colors cursor-pointer shrink-0 self-start sm:self-center ${
                                player.waiveAllFees
                                  ? 'bg-purple-600 hover:bg-purple-700 text-white border-purple-600 shadow-2xs'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                              }`}
                            >
                              {player.waiveAllFees
                                ? 'Waiver Active · Disable'
                                : 'Enable Fee Waiver'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SECTION 3: Profile Details & Club Ownership (Read-only Joined Clubs) */}
                    <div className="pt-4 border-t border-slate-200/80 space-y-4">
                      <div
                        className={`grid grid-cols-1 ${
                          isSiteAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
                        } gap-3.5`}
                      >
                        <StyledInput
                          label="Full Name"
                          type="text"
                          required
                          maxLength={80}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                        <StyledInput
                          label="Rating Score"
                          type="number"
                          min={800}
                          max={3000}
                          value={editRating}
                          onChange={(e) =>
                            setEditRating(
                              parseInt(e.target.value, 10) || player.ratingScore
                            )
                          }
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
                              disabled={Boolean(
                                clubs.some(
                                  (c) => c.clubOwnerPlayerId === player.id
                                )
                              )}
                            >
                              {clubs.some(
                                (c) => c.clubOwnerPlayerId === player.id
                              )
                                ? 'Must assign replacement owner from club roster first'
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

                      {/* Read-only Joined Clubs Display (Strictly User Intention) */}
                      <div className="bg-slate-50/70 rounded-xl border border-slate-200/80 p-3 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                          <span className="font-semibold text-slate-700">
                            Joined Clubs ({joinedClubs.length})
                          </span>
                          <span className="text-[11px] text-slate-500">
                            Read-only · Joining a club is strictly by player intention
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
                  <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200/80 bg-slate-50/80 flex items-center justify-end gap-2.5 shrink-0">
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
                </motion.form>
              </motion.div>
            );
          })()}
      </AnimatePresence>

      {/* Confirmation Modal: Delete Member */}
      <ConfirmModal
        open={Boolean(pendingDeletePlayer)}
        title="Delete Member Profile?"
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
        confirmLabel="Delete Member"
        variant="danger"
        onCancel={() => setPendingDeletePlayer(null)}
        onConfirm={async () => {
          if (!pendingDeletePlayer) return;
          const target = pendingDeletePlayer;
          setPendingDeletePlayer(null);
          await onAdminDeleteUser(target.id);
        }}
      />

      {/* Confirmation Modal: Reject All Pending Payments for Member */}
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
          await onRejectAllForPlayer(target.id);
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

      {/* Confirmation Modal: Reset Prepaid Credit */}
      <ConfirmModal
        open={Boolean(pendingResetCreditPlayer)}
        title="Reset Prepaid Credit Balance?"
        description={
          pendingResetCreditPlayer ? (
            <p>
              Reset{' '}
              <strong className="font-semibold text-slate-900">
                {pendingResetCreditPlayer.name}
              </strong>
              &rsquo;s prepaid club credit balance (
              <strong className="font-mono font-semibold text-slate-900">
                ${Number(pendingResetCreditPlayer.creditBalance || 0).toFixed(2)}
              </strong>
              ) back to $0.00?
            </p>
          ) : null
        }
        confirmLabel="Reset to $0.00"
        variant="warning"
        onCancel={() => setPendingResetCreditPlayer(null)}
        onConfirm={() => {
          if (!pendingResetCreditPlayer || !onUpdatePlayerWallet) return;
          const target = pendingResetCreditPlayer;
          setPendingResetCreditPlayer(null);
          onUpdatePlayerWallet(target.id, { creditBalance: 0 });
        }}
      />
    </div>
  );
};
