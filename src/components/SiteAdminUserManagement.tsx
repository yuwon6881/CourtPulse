import React, { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  Gift,
  Plus,
  Search,
  Sparkles,
  Ticket,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  Club,
  PermissionTier,
  Player,
  PlayerBenefitWallet,
  Session,
  SessionRsvp,
} from '../types';
import {
  calculateOutstandingBalancesForPlayer,
  getPlayerJoinedClubIds,
} from '../utils/badmintonLogic';
import {
  SegmentedControl,
  StyledInput,
  StyledSelect,
} from './ui/FormControls';

interface SiteAdminUserManagementProps {
  players: Player[];
  clubs: Club[];
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
  onSwitchActivePlayer: (player: Player) => void;
  onOpenPlayerProfile?: (playerId: string) => void;
  onOpenSessionLedger?: (sessionId: string) => void;
  onUpdatePlayerWallet?: (
    playerId: string,
    updates: Partial<PlayerBenefitWallet>
  ) => void;
}

export const SiteAdminUserManagement: React.FC<
  SiteAdminUserManagementProps
> = ({
  players,
  clubs,
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
  onSwitchActivePlayer,
  onOpenPlayerProfile,
  onOpenSessionLedger,
  onUpdatePlayerWallet,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'owing' | 'perks' | 'owners'
  >('all');

  // Create User State
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRating, setNewRating] = useState(1200);
  const [newClubIds, setNewClubIds] = useState<string[]>(() =>
    clubs[0] ? [clubs[0].id] : []
  );

  // Edit User / Wallet Drawer State
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRating, setEditRating] = useState(1200);
  const [editClubIds, setEditClubIds] = useState<string[]>([]);
  const [editOwnedClubId, setEditOwnedClubId] = useState<string>('NONE');
  const [savedNoticeId, setSavedNoticeId] = useState<string | null>(null);
  const [walletTopUpInput, setWalletTopUpInput] = useState<string>('20');

  const isSiteAdmin = permissionTier === 'admin';

  // Map finalized completed sessions for received/paid total calculation
  const finalizedSessionIds = useMemo(() => {
    return new Set(
      sessions
        .filter((s) => s.bookingStatus === 'completed' && s.feeSplitFinalized)
        .map((s) => s.id)
    );
  }, [sessions]);

  const playerSummaries = useMemo(() => {
    return players.map((player) => {
      const joinedIds = getPlayerJoinedClubIds(player);
      const joinedClubs = clubs.filter((c) => joinedIds.includes(c.id));
      const ownedClub =
        clubs.find((c) => c.clubOwnerPlayerId === player.id) || null;

      // Calculate outstanding debts (unpaid & pending_approval)
      const debts = calculateOutstandingBalancesForPlayer(
        player.id,
        sessions,
        rsvps
      );
      const unpaidDebts = debts.filter((d) => d.rsvp.paidStatus === 'unpaid');
      const pendingDebts = debts.filter(
        (d) => d.rsvp.paidStatus === 'pending_approval'
      );
      const totalUnpaid = unpaidDebts.reduce((s, d) => s + d.rsvp.feeShare, 0);
      const totalPending = pendingDebts.reduce(
        (s, d) => s + d.rsvp.feeShare,
        0
      );

      // Calculate lifetime Received (Paid) total across finalized sessions
      const paidRsvps = rsvps.filter(
        (r) =>
          r.playerId === player.id &&
          finalizedSessionIds.has(r.sessionId) &&
          r.paidStatus === 'paid' &&
          r.feeShare > 0
      );
      const totalReceived = paidRsvps.reduce((s, r) => s + r.feeShare, 0);
      const sessionsAttendedCount = rsvps.filter(
        (r) =>
          r.playerId === player.id &&
          finalizedSessionIds.has(r.sessionId) &&
          r.status === 'going' &&
          r.attendanceOutcome === 'present'
      ).length;

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
        paidSessionsCount: paidRsvps.length,
        sessionsAttendedCount,
        totalUnpaid,
        totalPending,
        unpaidCount: unpaidDebts.length,
        pendingCount: pendingDebts.length,
        hasPerks,
      };
    });
  }, [players, clubs, sessions, rsvps, finalizedSessionIds]);

  const filteredSummaries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return playerSummaries.filter((item) => {
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
        (item.ownedClub && item.ownedClub.name.toLowerCase().includes(q))
      );
    });
  }, [playerSummaries, searchQuery, statusFilter]);

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
    setEditName(player.name);
    setEditRating(player.ratingScore);
    setEditClubIds(joinedIds);
    setEditOwnedClubId(owned ? owned.id : 'NONE');
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await onAdminCreateUser({
      name: newName.trim(),
      ratingScore: newRating,
      clubIds:
        newClubIds.length > 0
          ? newClubIds
          : clubs[0]
          ? [clubs[0].id]
          : ['club_bintang_prime'],
    });
    setNewName('');
    setNewRating(1200);
    setShowCreateForm(false);
  };

  const handleSaveEdit = async (e: React.FormEvent, player: Player) => {
    e.preventDefault();
    if (!editName.trim()) return;
    const ensuredClubs =
      editOwnedClubId !== 'NONE' && !editClubIds.includes(editOwnedClubId)
        ? [...editClubIds, editOwnedClubId]
        : editClubIds;

    await onAdminUpdateUser(player.id, {
      name: editName.trim(),
      ratingScore: editRating,
      clubIds:
        ensuredClubs.length > 0
          ? ensuredClubs
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
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Users, Member Balances &amp; Wallets
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Track member fee totals (received, pending, and due across sessions), manage credits &amp; free session passes, and edit user profiles.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="h-9 px-3.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
        >
          {showCreateForm ? (
            <>
              <X className="w-3.5 h-3.5 shrink-0" />
              <span>Close Form</span>
            </>
          ) : (
            <>
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              <span>Add Member</span>
            </>
          )}
        </button>
      </div>

      {/* 4-Column Member Financial & Roster KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Registered Members</span>
            <span className="font-mono tabular-nums text-slate-400">
              {totalOwnersCount} owners
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {players.length}
          </p>
          <p className="text-[11px] text-slate-400 truncate">
            Active: {activePlayer.name}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Received Total</span>
            <span className="text-emerald-700 font-semibold">Settled</span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700">
            ${totalPlatformReceived.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-400">
            Cumulative verified payments
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Pending Approval</span>
            <span className="text-blue-700 font-semibold">
              {
                playerSummaries.filter((p) => p.totalPending > 0).length
              }{' '}
              member(s)
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-blue-700">
            ${totalPlatformPending.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-400">
            Marked paid · awaiting verification
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Total Due (Unpaid)</span>
            <span className="text-amber-800 font-semibold">
              {
                playerSummaries.filter((p) => p.totalUnpaid > 0).length
              }{' '}
              owing
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-800">
            ${totalPlatformUnpaid.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-400">
            Outstanding across sessions
          </p>
        </div>
      </div>

      {/* Create New User Form */}
      {showCreateForm && (
        <section className="bg-white rounded-xl border border-slate-200/90 p-5 sm:p-6 space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">
              Register New Member
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Creates a player profile and assigns them to the selected badminton clubs.
            </p>
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

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-600 block">
                Club Memberships
              </span>
              <div className="flex flex-wrap gap-2">
                {clubs.map((club) => {
                  const selected = newClubIds.includes(club.id);
                  return (
                    <button
                      key={club.id}
                      type="button"
                      onClick={() => handleToggleNewClub(club.id)}
                      className={`h-8 px-3 rounded-lg text-xs font-medium border inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                        selected
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {selected ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <span>{club.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="h-9 px-3.5 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg inline-flex items-center justify-center whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center whitespace-nowrap cursor-pointer"
              >
                Create Member
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Search & Single Clean Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="w-full sm:w-72">
          <StyledInput
            type="text"
            icon={<Search className="w-4 h-4" />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, #tag, or club..."
            className="h-9 text-xs"
          />
        </div>

        <div className="overflow-x-auto pb-0.5 sm:pb-0">
          <SegmentedControl
            size="sm"
            options={[
              { value: 'all', label: 'All Members', count: playerSummaries.length },
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
              {
                value: 'owners',
                label: 'Club Owners',
                count: totalOwnersCount,
              },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>
      </div>

      {/* Member Directory & Financial Summary List */}
      <section className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
        <div className="divide-y divide-slate-100">
          {filteredSummaries.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No members match your current filter.
            </div>
          ) : (
            filteredSummaries.map((item) => {
              const {
                player,
                joinedClubs,
                ownedClub,
                debts,
                totalReceived,
                paidSessionsCount,
                sessionsAttendedCount,
                totalUnpaid,
                totalPending,
              } = item;
              const isCurrentActive = player.id === activePlayer.id;
              const isEditing = editingPlayerId === player.id;

              return (
                <div key={player.id} className="p-4 sm:px-6 space-y-4">
                  <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                    {/* Left: Member Identity, Role, Clubs & Active Perks */}
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {onOpenPlayerProfile ? (
                          <button
                            type="button"
                            onClick={() => onOpenPlayerProfile(player.id)}
                            className="text-sm font-bold text-slate-900 hover:underline cursor-pointer"
                          >
                            {player.name}
                          </button>
                        ) : (
                          <span className="text-sm font-bold text-slate-900">
                            {player.name}
                          </span>
                        )}
                        <span className="text-xs font-mono text-slate-400">
                          {player.playerTag}
                        </span>
                        {isCurrentActive && (
                          <span className="text-[11px] font-semibold text-emerald-700">
                            · You
                          </span>
                        )}
                        {ownedClub ? (
                          <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md whitespace-nowrap">
                            Owner · {ownedClub.name}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            · Member
                          </span>
                        )}
                        {savedNoticeId === player.id && (
                          <span className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            Saved
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono tabular-nums text-slate-700 font-medium">
                          {player.ratingScore} pts
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {player.wins}W–{player.losses}L
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {sessionsAttendedCount} session
                          {sessionsAttendedCount === 1 ? '' : 's'} attended
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">
                          Clubs:{' '}
                          <strong className="font-medium text-slate-700">
                            {joinedClubs.length > 0
                              ? joinedClubs.map((c) => c.name).join(', ')
                              : 'None'}
                          </strong>
                        </span>
                      </div>

                      {/* Member Credit / Free Session Passes / Waiver Status */}
                      {(Boolean(player.waiveAllFees) ||
                        Number(player.freeSessionPasses || 0) > 0 ||
                        Number(player.creditBalance || 0) > 0) && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {Boolean(player.waiveAllFees) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200 text-[10px] font-semibold whitespace-nowrap">
                              <Sparkles className="w-2.5 h-2.5 shrink-0" />
                              All Fees Waived
                            </span>
                          )}
                          {Number(player.freeSessionPasses || 0) > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-semibold whitespace-nowrap">
                              <Ticket className="w-2.5 h-2.5 shrink-0" />
                              {Math.floor(Number(player.freeSessionPasses || 0))} Free{' '}
                              {Math.floor(Number(player.freeSessionPasses || 0)) === 1
                                ? 'Session'
                                : 'Sessions'}
                            </span>
                          )}
                          {Number(player.creditBalance || 0) > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200 text-[10px] font-semibold tabular-nums whitespace-nowrap">
                              ${Number(player.creditBalance || 0).toFixed(2)} Credit
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right: Member Financial Summary (Received Total + Due/Pending) & Non-Wrapping Actions */}
                    <div className="flex flex-wrap items-center justify-between xl:justify-end gap-4 pt-3 xl:pt-0 border-t xl:border-t-0 border-slate-100 shrink-0">
                      {/* Member Financial Ledger Columns */}
                      <div className="flex items-center gap-4 sm:gap-5 font-mono tabular-nums text-right">
                        <div>
                          <span className="text-[10px] font-sans text-slate-400 block">
                            Received ({paidSessionsCount})
                          </span>
                          <span className="text-xs font-bold text-emerald-700">
                            ${totalReceived.toFixed(2)}
                          </span>
                        </div>

                        {totalPending > 0 && (
                          <div>
                            <span className="text-[10px] font-sans text-blue-600 block">
                              Pending
                            </span>
                            <span className="text-xs font-bold text-blue-700">
                              ${totalPending.toFixed(2)}
                            </span>
                          </div>
                        )}

                        <div>
                          <span className="text-[10px] font-sans text-slate-400 block">
                            Due Balance
                          </span>
                          <span
                            className={`text-xs font-bold ${
                              totalUnpaid > 0
                                ? 'text-amber-800'
                                : 'text-slate-400'
                            }`}
                          >
                            ${totalUnpaid.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      {/* Action Buttons — Strict whitespace-nowrap shrink-0 so text never splits */}
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
                              className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>Accept</span>
                            </button>
                            {onRejectAllForPlayer && (
                              <button
                                type="button"
                                onClick={() => onRejectAllForPlayer(player.id)}
                                className="h-8 px-2.5 bg-white border border-slate-200 hover:bg-rose-50 hover:text-rose-700 text-slate-700 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>Reject</span>
                              </button>
                            )}
                          </>
                        )}

                        {totalUnpaid > 0 && totalPending === 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              onAcceptOrClearAllForPlayer(
                                player.id,
                                'Admin Verified'
                              )
                            }
                            className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5 shrink-0" />
                            <span>Mark Recv</span>
                          </button>
                        )}

                        {isSiteAdmin && !isCurrentActive && (
                          <button
                            type="button"
                            onClick={() => onSwitchActivePlayer(player)}
                            title="Switch active session to this user"
                            className="h-8 px-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span>Switch User</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            isEditing
                              ? setEditingPlayerId(null)
                              : handleStartEdit(player)
                          }
                          className={`h-8 px-3 text-xs font-medium rounded-lg border inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                            isEditing
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <Edit3 className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {isEditing ? 'Close' : 'Wallet & Edit'}
                          </span>
                        </button>

                        {isSiteAdmin && !isCurrentActive && players.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onAdminDeleteUser(player.id)}
                            aria-label={`Delete ${player.name}`}
                            className="h-8 w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg inline-flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Itemized Unpaid / Pending Session Bills for this Member */}
                  {debts.length > 0 && (
                    <div className="bg-slate-50/70 rounded-lg border border-slate-200/70 px-3.5 py-2.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-700">
                          Outstanding Session Bills ({debts.length})
                        </span>
                        <span>Click session to inspect split</span>
                      </div>
                      <div className="divide-y divide-slate-200/50">
                        {debts.map(({ rsvp, session }) => (
                          <div
                            key={rsvp.id}
                            className="py-1.5 flex flex-wrap items-center justify-between gap-2"
                          >
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              {onOpenSessionLedger ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenSessionLedger(session.id)
                                  }
                                  className="font-semibold text-slate-800 hover:underline truncate cursor-pointer"
                                >
                                  {session.title}
                                </button>
                              ) : (
                                <span className="font-semibold text-slate-800 truncate">
                                  {session.title}
                                </span>
                              )}
                              <span className="font-mono text-[11px] text-slate-400">
                                {session.sessionDate}
                              </span>
                              <span
                                className={`text-[11px] font-semibold ${
                                  rsvp.paidStatus === 'pending_approval'
                                    ? 'text-blue-700'
                                    : 'text-amber-800'
                                }`}
                              >
                                ·{' '}
                                {rsvp.paidStatus === 'pending_approval'
                                  ? `Pending (${rsvp.paidMethod})`
                                  : 'Unpaid'}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono tabular-nums font-bold text-slate-900">
                                ${rsvp.feeShare.toFixed(2)}
                              </span>
                              {onAcceptOrClearSingleRsvp && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onAcceptOrClearSingleRsvp(
                                      rsvp.id,
                                      'Verified'
                                    )
                                  }
                                  className="h-7 px-2.5 rounded-md bg-white border border-slate-200 hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 hover:text-emerald-900 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                                  <span>Mark Recv</span>
                                </button>
                              )}
                              {rsvp.paidStatus === 'pending_approval' &&
                                onRejectPaymentForRsvp && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onRejectPaymentForRsvp(rsvp.id)
                                    }
                                    className="h-7 px-2 rounded-md bg-white border border-slate-200 hover:bg-rose-50 text-slate-600 hover:text-rose-700 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <X className="w-3 h-3 text-rose-600 shrink-0" />
                                    <span>Reject</span>
                                  </button>
                                )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Inline Member Wallet & Profile Editor */}
                  {isEditing && (
                    <form
                      onSubmit={(e) => handleSaveEdit(e, player)}
                      className="bg-slate-50/90 rounded-xl border border-slate-200/80 p-4 space-y-4"
                    >
                      {/* Credit Balance, Free Session Passes & Complete Fee Waiver Controls */}
                      {onUpdatePlayerWallet && (
                        <div className="space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                              <Gift className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>
                                Member Wallet: Prepaid Credit, Free Session Passes &amp; Fee Waiver
                              </span>
                            </span>
                            <span className="text-[11px] text-slate-500">
                              Auto-settles unpaid &amp; future finalized session fees
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {/* Credit Top-Up */}
                            <div className="bg-white rounded-lg border border-slate-200/90 p-3 space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-600 font-medium">
                                  Prepaid Credit
                                </span>
                                <span className="font-bold text-sky-700 font-mono tabular-nums">
                                  $
                                  {Math.max(
                                    0,
                                    Number(player.creditBalance || 0)
                                  ).toFixed(2)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {[10, 20, 50].map((amt) => (
                                  <button
                                    key={amt}
                                    type="button"
                                    onClick={() => {
                                      const cur = Math.max(
                                        0,
                                        Number(player.creditBalance || 0)
                                      );
                                      onUpdatePlayerWallet(player.id, {
                                        creditBalance:
                                          Math.round((cur + amt) * 100) / 100,
                                      });
                                    }}
                                    className="flex-1 py-1 rounded bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200/80 text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                                  >
                                    +${amt}
                                  </button>
                                ))}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={walletTopUpInput}
                                  onChange={(e) =>
                                    setWalletTopUpInput(e.target.value)
                                  }
                                  className="w-full h-7 px-2 rounded border border-slate-200 text-xs text-slate-900"
                                  placeholder="Amount"
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
                                    const cur = Math.max(
                                      0,
                                      Number(player.creditBalance || 0)
                                    );
                                    onUpdatePlayerWallet(player.id, {
                                      creditBalance:
                                        Math.round((cur + parsed) * 100) / 100,
                                    });
                                  }}
                                  className="px-2.5 h-7 rounded bg-slate-900 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  Top Up
                                </button>
                                {Number(player.creditBalance || 0) > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUpdatePlayerWallet(player.id, {
                                        creditBalance: 0,
                                      })
                                    }
                                    className="px-2 h-7 rounded border border-slate-200 text-slate-500 hover:text-rose-600 text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    Reset
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Free Session Passes */}
                            <div className="bg-white rounded-lg border border-slate-200/90 p-3 space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-600 font-medium">
                                  Free Session Passes
                                </span>
                                <span className="font-bold text-emerald-700 font-mono tabular-nums">
                                  {Math.max(
                                    0,
                                    Math.floor(
                                      Number(player.freeSessionPasses || 0)
                                    )
                                  )}{' '}
                                  left
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const cur = Math.max(
                                      0,
                                      Math.floor(
                                        Number(player.freeSessionPasses || 0)
                                      )
                                    );
                                    onUpdatePlayerWallet(player.id, {
                                      freeSessionPasses: Math.max(0, cur - 1),
                                    });
                                  }}
                                  disabled={
                                    Number(player.freeSessionPasses || 0) <= 0
                                  }
                                  className="px-2.5 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                                >
                                  -1
                                </button>
                                {[1, 3, 5].map((cnt) => (
                                  <button
                                    key={cnt}
                                    type="button"
                                    onClick={() => {
                                      const cur = Math.max(
                                        0,
                                        Math.floor(
                                          Number(player.freeSessionPasses || 0)
                                        )
                                      );
                                      onUpdatePlayerWallet(player.id, {
                                        freeSessionPasses: cur + cnt,
                                      });
                                    }}
                                    className="flex-1 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                                  >
                                    +{cnt} Free
                                  </button>
                                ))}
                              </div>
                              <p className="text-[10px] text-slate-400 leading-tight">
                                Waives the next{' '}
                                {Math.floor(
                                  Number(player.freeSessionPasses || 0)
                                ) || 'N'}{' '}
                                session fee(s) automatically.
                              </p>
                            </div>

                            {/* Complete Fee Waiver */}
                            <div className="bg-white rounded-lg border border-slate-200/90 p-3 flex flex-col justify-between gap-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-600 font-medium">
                                  Complete Fee Waiver
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onUpdatePlayerWallet(player.id, {
                                      waiveAllFees: !player.waiveAllFees,
                                    })
                                  }
                                  className={`px-2.5 py-1 rounded text-[11px] font-semibold border whitespace-nowrap transition-colors cursor-pointer ${
                                    player.waiveAllFees
                                      ? 'bg-purple-600 text-white border-purple-600'
                                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                                  }`}
                                >
                                  {player.waiveAllFees
                                    ? 'Waiver Active'
                                    : 'Enable Waiver'}
                                </button>
                              </div>
                              <p className="text-[10px] text-slate-400 leading-tight">
                                Completely waives all current unpaid &amp;
                                future session fees for {player.name}.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Profile & Club Assignment Fields */}
                      <div className="pt-3 border-t border-slate-200/70 grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                            label="Club Owner Assignment (Max 1)"
                            value={editOwnedClubId}
                            onChange={(e) => setEditOwnedClubId(e.target.value)}
                          >
                            <option value="NONE">
                              No Owned Club (Member)
                            </option>
                            {clubs.map((c) => (
                              <option key={c.id} value={c.id}>
                                Owner of {c.name}
                              </option>
                            ))}
                          </StyledSelect>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-200/60">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-slate-600">
                            Club Memberships:
                          </span>
                          {clubs.map((club) => {
                            const isMember = editClubIds.includes(club.id);
                            return (
                              <button
                                key={club.id}
                                type="button"
                                onClick={() => handleToggleEditClub(club.id)}
                                className={`h-7 px-2.5 rounded-md text-xs font-medium border inline-flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                                  isMember
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold'
                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                {isMember ? (
                                  <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                                ) : (
                                  <Plus className="w-3 h-3 text-slate-400 shrink-0" />
                                )}
                                <span>{club.name}</span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setEditingPlayerId(null)}
                            className="h-8 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg inline-flex items-center justify-center whitespace-nowrap"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center whitespace-nowrap cursor-pointer"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    </form>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};
