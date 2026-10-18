import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Copy,
  Gift,
  Plus,
  Search,
  Settings,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  Club,
  ClubPaymentDetails,
  PermissionTier,
  Player,
  PlayerBenefitWallet,
  Session,
} from '../types';
import {
  buildShareableClubAndSessionUrl,
  formatClubPaymentInfo,
  hasPlayerJoinedClub,
} from '../utils/badmintonLogic';
import { StyledSelect } from './ui/FormControls';
import { SettingsSectionTab } from './SettingsView';

interface AdminClubAndPolicySettingsProps {
  clubs: Club[];
  userJoinedClubs: Club[];
  unjoinedClubs: Club[];
  activeClub: Club;
  players: Player[];
  sessions: Session[];
  activePlayer: Player;
  permissionTier: PermissionTier;
  canManageActiveClub: boolean;
  onSelectClub: (clubId: string) => void;
  onJoinClub: (clubId: string) => Promise<void>;
  onAdminAddMemberToClub: (name: string) => Promise<void>;
  onAssignClubOwner: (clubId: string, ownerPlayerId: string) => Promise<void>;
  onDeleteClub: (clubId: string) => Promise<void>;
  onCreateNewClub: (clubData: {
    name: string;
    description: string;
    paymentInfo: string;
    paymentDetails?: ClubPaymentDetails;
    freeCancelHours: number;
    lockCancelHours: number;
    lateCancelFeePercent: number;
    noShowFeePercent: number;
    ownerPlayerId?: string;
  }) => Promise<Club | null>;
  onOpenSettings?: (section?: SettingsSectionTab) => void;
  onOpenUsersDirectory?: () => void;
  onUpdatePlayerWallet?: (
    playerId: string,
    updates: Partial<PlayerBenefitWallet>
  ) => Promise<void>;
}

export const AdminClubAndPolicySettings: React.FC<
  AdminClubAndPolicySettingsProps
> = ({
  clubs,
  userJoinedClubs,
  unjoinedClubs,
  activeClub,
  players,
  sessions,
  activePlayer,
  permissionTier,
  canManageActiveClub,
  onSelectClub,
  onJoinClub,
  onAdminAddMemberToClub,
  onAssignClubOwner,
  onDeleteClub,
  onCreateNewClub,
  onOpenSettings,
  onOpenUsersDirectory,
  onUpdatePlayerWallet,
}) => {
  const [showCreateClubModal, setShowCreateClubModal] = useState(false);
  const [rosterModalClubId, setRosterModalClubId] = useState<string | null>(
    null
  );
  const [copiedInviteClubId, setCopiedInviteClubId] = useState<string | null>(
    null
  );

  // Member Roster Modal state
  const [memberSearch, setMemberSearch] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [confirmDeleteClubId, setConfirmDeleteClubId] = useState<string | null>(
    null
  );

  // Member Wallet Modal state
  const [walletModalPlayer, setWalletModalPlayer] = useState<Player | null>(
    null
  );
  const [walletCreditInput, setWalletCreditInput] = useState<number>(0);
  const [walletPassesInput, setWalletPassesInput] = useState<number>(0);
  const [walletWaiveInput, setWalletWaiveInput] = useState<boolean>(false);

  // Create New Club Modal state
  const [newClubName, setNewClubName] = useState('');
  const [newClubDesc, setNewClubDesc] = useState(
    'Weekly badminton courts & automated shuttle splits.'
  );
  const [newClubRecipient, setNewClubRecipient] = useState(
    activePlayer.name || 'Club Organizer'
  );
  const [newClubPhone, setNewClubPhone] = useState('+65 9123 4567');
  const [newClubBankName, setNewClubBankName] = useState('DBS Bank');
  const [newClubBankAcct, setNewClubBankAcct] = useState('018-902341-2');
  const [newClubPayNote, setNewClubPayNote] = useState(
    'Include your name & session date in transfer reference'
  );
  const [newClubOwnerId, setNewClubOwnerId] = useState(activePlayer.id);
  const [newFreeHours, setNewFreeHours] = useState(24);
  const [newLockHours, setNewLockHours] = useState(4);
  const [newLatePct, setNewLatePct] = useState(50);
  const [newNoShowPct, setNewNoShowPct] = useState(100);

  // Platform Clubs Directory Search
  const [clubDirectorySearch, setClubDirectorySearch] = useState('');

  const isSiteAdmin = permissionTier === 'admin';
  const isClubOwnerTier = permissionTier === 'club_owner';

  const ownedClubsByCurrentPlayer = useMemo(
    () => clubs.filter((c) => c.clubOwnerPlayerId === activePlayer.id),
    [clubs, activePlayer.id]
  );

  const canCreateAnotherClub =
    isSiteAdmin || (isClubOwnerTier && ownedClubsByCurrentPlayer.length === 0);

  const filteredPlatformClubs = useMemo(() => {
    const q = clubDirectorySearch.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        (c.clubOwnerName || '').toLowerCase().includes(q)
    );
  }, [clubs, clubDirectorySearch]);

  const rosterModalClub = useMemo(
    () =>
      rosterModalClubId
        ? clubs.find((c) => c.id === rosterModalClubId) || null
        : null,
    [clubs, rosterModalClubId]
  );

  const rosterClubMembers = useMemo(() => {
    if (!rosterModalClub) return [];
    const list = players.filter((p) =>
      hasPlayerJoinedClub(p, rosterModalClub.id)
    );
    const q = memberSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.playerTag.toLowerCase().includes(q) ||
        p.playStyle.toLowerCase().includes(q)
    );
  }, [players, rosterModalClub, memberSearch]);

  const handleCopyInviteLinkForClub = async (clubId: string) => {
    const inviteUrl = buildShareableClubAndSessionUrl(clubId);
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedInviteClubId(clubId);
      setTimeout(() => setCopiedInviteClubId(null), 2500);
    } catch {
      // ignore
    }
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim()) return;
    await onAdminAddMemberToClub(newMemberName.trim());
    setNewMemberName('');
  };

  const openWalletModal = (player: Player) => {
    setWalletModalPlayer(player);
    setWalletCreditInput(Number((player.creditBalance || 0).toFixed(2)));
    setWalletPassesInput(Math.floor(player.freeSessionPasses || 0));
    setWalletWaiveInput(Boolean(player.waiveAllFees));
  };

  const handleSaveWalletModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletModalPlayer || !onUpdatePlayerWallet) return;
    await onUpdatePlayerWallet(walletModalPlayer.id, {
      creditBalance: Math.max(0, Number(walletCreditInput || 0)),
      freeSessionPasses: Math.max(0, Math.floor(Number(walletPassesInput || 0))),
      waiveAllFees: Boolean(walletWaiveInput),
    });
    setWalletModalPlayer(null);
  };

  const handleCreateClubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClubName.trim() || !canCreateAnotherClub) return;

    const details: ClubPaymentDetails = {
      recipientName:
        newClubRecipient.trim() || activePlayer.name || 'Club Owner',
      phoneNumber: newClubPhone.trim() || '+65 9123 4567',
      bankName: newClubBankName.trim() || 'DBS Bank',
      bankAccountNumber: newClubBankAcct.trim() || '018-902341-2',
      paymentNotes:
        newClubPayNote.trim() ||
        'Include your name & session date in transfer reference',
    };

    const created = await onCreateNewClub({
      name: newClubName.trim(),
      description: newClubDesc.trim(),
      paymentInfo: formatClubPaymentInfo(details),
      paymentDetails: details,
      freeCancelHours: Number(newFreeHours) || 24,
      lockCancelHours: Number(newLockHours) || 4,
      lateCancelFeePercent: Number(newLatePct) || 50,
      noShowFeePercent: Number(newNoShowPct) || 100,
      ownerPlayerId: isSiteAdmin ? newClubOwnerId : activePlayer.id,
    });

    if (created) {
      setNewClubName('');
      setShowCreateClubModal(false);
      onSelectClub(created.id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header — Clean Club Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Clubs &amp; Memberships
            </h1>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
              {userJoinedClubs.length} Joined
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Active Club:{' '}
            <span className="font-semibold text-slate-900">
              {activeClub.name}
            </span>{' '}
            · Owner: {activeClub.clubOwnerName || 'Alex Tan'}
            {activeClub.excludeOwnerFromBilling
              ? ' (Owner Excluded from Billing)'
              : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onSelectClub(activeClub.id);
              setRosterModalClubId(activeClub.id);
            }}
            className="h-9 px-3.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-slate-600" />
            <span>View Club Roster</span>
          </button>

          {onOpenSettings && (
            <button
              type="button"
              onClick={() => onOpenSettings('club_policy')}
              className="h-9 px-3.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-slate-600" />
              <span>Club Settings</span>
            </button>
          )}

          {canCreateAnotherClub && (
            <button
              type="button"
              onClick={() => setShowCreateClubModal(true)}
              className="h-9 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Club</span>
            </button>
          )}
        </div>
      </div>

      {/* SECTION 1: MY JOINED CLUBS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            My Joined Clubs ({userJoinedClubs.length})
          </h2>
          <span className="text-xs text-slate-400">
            Click a club to switch workspace or open member roster
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {userJoinedClubs.map((club) => {
            const isSelected = club.id === activeClub.id;
            const clubMemberCount = players.filter((p) =>
              hasPlayerJoinedClub(p, club.id)
            ).length;
            const clubSessionCount = sessions.filter(
              (s) => s.clubId === club.id
            ).length;
            const isOwner = club.clubOwnerPlayerId === activePlayer.id;

            return (
              <div
                key={club.id}
                onClick={() => onSelectClub(club.id)}
                className={`rounded-2xl border p-4 sm:p-5 transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                  isSelected
                    ? 'bg-white border-slate-900 ring-1 ring-slate-900 shadow-xs'
                    : 'bg-white border-slate-200/90 hover:border-slate-300'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2
                        className={`w-4 h-4 shrink-0 ${
                          isSelected ? 'text-emerald-600' : 'text-slate-400'
                        }`}
                      />
                      <h3 className="text-sm font-bold text-slate-900 truncate">
                        {club.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isOwner && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                          Owner
                        </span>
                      )}
                      {isSelected && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-900 text-white">
                          Active
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">
                    {club.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex items-center gap-3 font-mono">
                    <span>{clubMemberCount} members</span>
                    <span>·</span>
                    <span>{clubSessionCount} sessions</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectClub(club.id);
                        setRosterModalClubId(club.id);
                      }}
                      className="h-7 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      Members &amp; Details
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION 2: DISCOVER OTHER CLUBS TO JOIN */}
      {unjoinedClubs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Available Clubs to Join ({unjoinedClubs.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {unjoinedClubs.map((club) => {
              const memberCount = players.filter((p) =>
                hasPlayerJoinedClub(p, club.id)
              ).length;
              return (
                <div
                  key={club.id}
                  className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {club.name}
                    </p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {club.description}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Owner: {club.clubOwnerName || 'Club Owner'} · {memberCount}{' '}
                      members
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onJoinClub(club.id)}
                    className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shrink-0 transition-colors cursor-pointer"
                  >
                    Join Club
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 3: ALL PLATFORM CLUBS DIRECTORY (Vertical Scrollable List -> Opens Modal on Click) */}
      {isSiteAdmin && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                All Platform Clubs ({filteredPlatformClubs.length})
              </h2>
              <p className="text-xs text-slate-500">
                Vertical scrollable directory. Click any club to inspect its member roster and ownership in a modal.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={clubDirectorySearch}
                onChange={(e) => setClubDirectorySearch(e.target.value)}
                placeholder="Search clubs or owners..."
                className="w-full h-9 pl-8 pr-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-slate-400 focus:bg-white"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200/80 rounded-xl">
            {filteredPlatformClubs.map((c) => {
              const memberCount = players.filter((p) =>
                hasPlayerJoinedClub(p, c.id)
              ).length;
              const sessionCount = sessions.filter(
                (s) => s.clubId === c.id
              ).length;

              return (
                <div
                  key={c.id}
                  onClick={() => {
                    onSelectClub(c.id);
                    setRosterModalClubId(c.id);
                  }}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 truncate">
                        {c.name}
                      </span>
                      {c.excludeOwnerFromBilling && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Owner Exempt
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      Owner: {c.clubOwnerName || 'Alex Tan'} · {memberCount}{' '}
                      members · {sessionCount} sessions
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectClub(c.id);
                        setRosterModalClubId(c.id);
                      }}
                      className="h-7 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      Inspect Roster
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL 1: CLUB MEMBER ROSTER & DETAILS MODAL */}
      {rosterModalClub && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setRosterModalClubId(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 truncate">
                    {rosterModalClub.name}
                  </h3>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                    {rosterClubMembers.length} members
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  Owner: {rosterModalClub.clubOwnerName || 'Alex Tan'} · Free Tap-Out &gt;
                  {rosterModalClub.freeCancelHours}h · Late{' '}
                  {rosterModalClub.lateCancelFeePercent}%
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRosterModalClubId(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* Quick Actions Bar inside Club Modal: Invite Link + Settings + Assign Owner */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyInviteLinkForClub(rosterModalClub.id)
                    }
                    className="h-8 px-3 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedInviteClubId === rosterModalClub.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700">
                          Invite Link Copied
                        </span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500" />
                        <span>Copy Club Invite Link</span>
                      </>
                    )}
                  </button>

                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectClub(rosterModalClub.id);
                        setRosterModalClubId(null);
                        onOpenSettings('club_policy');
                      }}
                      className="h-8 px-3 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Settings className="w-3.5 h-3.5 text-slate-500" />
                      <span>Configure Policy &amp; Billing</span>
                    </button>
                  )}
                </div>

                {isSiteAdmin && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-500">
                      Owner:
                    </span>
                    <div className="w-44">
                      <StyledSelect
                        aria-label="Assign Club Owner"
                        value={
                          rosterModalClub.clubOwnerPlayerId || 'player_alex'
                        }
                        onChange={(e) =>
                          onAssignClubOwner(rosterModalClub.id, e.target.value)
                        }
                        className="h-8 text-xs"
                      >
                        {players.map((p) => {
                          const ownedOther = clubs.find(
                            (other) =>
                              other.id !== rosterModalClub.id &&
                              other.clubOwnerPlayerId === p.id
                          );
                          return (
                            <option
                              key={p.id}
                              value={p.id}
                              disabled={Boolean(ownedOther)}
                            >
                              {p.name}
                              {ownedOther ? ` (Owns ${ownedOther.name})` : ''}
                            </option>
                          );
                        })}
                      </StyledSelect>
                    </div>
                  </div>
                )}
              </div>

              {/* Search & Quick Add Member */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Filter club members..."
                    className="w-full h-9 pl-8 pr-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-slate-400 focus:bg-white"
                  />
                </div>

                {canManageActiveClub && (
                  <form
                    onSubmit={handleAddMemberSubmit}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="text"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      placeholder="Add member by name..."
                      className="h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-slate-400 focus:bg-white"
                    />
                    <button
                      type="submit"
                      className="h-9 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </form>
                )}
              </div>

              {/* Member Roster List */}
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200/80 rounded-xl">
                {rosterClubMembers.map((member) => {
                  const isClubOwner =
                    member.id === rosterModalClub.clubOwnerPlayerId;
                  const hasBenefits =
                    Boolean(member.waiveAllFees) ||
                    (member.freeSessionPasses || 0) > 0 ||
                    (member.creditBalance || 0) > 0;

                  return (
                    <div
                      key={member.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/80"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {member.name}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {member.playerTag}
                          </span>
                          {isClubOwner && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                              Club Owner
                            </span>
                          )}
                          {hasBenefits && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {member.waiveAllFees
                                ? 'VIP Waived'
                                : [
                                    (member.freeSessionPasses || 0) > 0
                                      ? `${member.freeSessionPasses} Pass`
                                      : '',
                                    (member.creditBalance || 0) > 0
                                      ? `$${(member.creditBalance || 0).toFixed(0)} Credit`
                                      : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {member.playStyle} · Rating {member.ratingScore}
                        </p>
                      </div>

                      {canManageActiveClub && onUpdatePlayerWallet && (
                        <button
                          type="button"
                          onClick={() => openWalletModal(member)}
                          className="h-7 px-2.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
                        >
                          <Gift className="w-3 h-3 text-indigo-600" />
                          <span>Passes &amp; Credit</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <div>
                {isSiteAdmin && clubs.length > 1 && (
                  <>
                    {confirmDeleteClubId === rosterModalClub.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-rose-700">
                          Delete {rosterModalClub.name}?
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await onDeleteClub(rosterModalClub.id);
                            setConfirmDeleteClubId(null);
                            setRosterModalClubId(null);
                          }}
                          className="h-7 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteClubId(null)}
                          className="h-7 px-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDeleteClubId(rosterModalClub.id)
                        }
                        className="h-8 px-2.5 rounded-lg text-rose-700 hover:bg-rose-50 text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Club</span>
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {onOpenUsersDirectory && (
                  <button
                    type="button"
                    onClick={() => {
                      setRosterModalClubId(null);
                      onOpenUsersDirectory();
                    }}
                    className="h-8 px-3 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Open Full Users &amp; Balances →
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRosterModalClubId(null)}
                  className="h-8 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CREATE NEW CLUB MODAL */}
      {showCreateClubModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowCreateClubModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Create New Badminton Club
                </h3>
                <p className="text-xs text-slate-500">
                  Set up club schedule, tap-out policies, and payment recipient details.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateClubModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateClubSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Club Name
                </label>
                <input
                  type="text"
                  required
                  value={newClubName}
                  onChange={(e) => setNewClubName(e.target.value)}
                  placeholder="e.g., East Coast Shuttle Club"
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Schedule &amp; Venue Description
                </label>
                <input
                  type="text"
                  value={newClubDesc}
                  onChange={(e) => setNewClubDesc(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                />
              </div>

              {isSiteAdmin && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Assign Club Owner (1 Club per Owner)
                  </label>
                  <StyledSelect
                    value={newClubOwnerId}
                    onChange={(e) => setNewClubOwnerId(e.target.value)}
                    className="h-10 text-xs"
                  >
                    {players.map((p) => {
                      const alreadyOwns = clubs.find(
                        (c) => c.clubOwnerPlayerId === p.id
                      );
                      return (
                        <option
                          key={p.id}
                          value={p.id}
                          disabled={Boolean(alreadyOwns)}
                        >
                          {p.name}
                          {alreadyOwns ? ` (Owns ${alreadyOwns.name})` : ''}
                        </option>
                      );
                    })}
                  </StyledSelect>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    PayNow Recipient
                  </label>
                  <input
                    type="text"
                    value={newClubRecipient}
                    onChange={(e) => setNewClubRecipient(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-300 rounded-xl px-3 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    PayNow Mobile
                  </label>
                  <input
                    type="text"
                    value={newClubPhone}
                    onChange={(e) => setNewClubPhone(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-300 rounded-xl px-3 text-xs font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Bank Name
                  </label>
                  <input
                    type="text"
                    value={newClubBankName}
                    onChange={(e) => setNewClubBankName(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-300 rounded-xl px-3 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Account No.
                  </label>
                  <input
                    type="text"
                    value={newClubBankAcct}
                    onChange={(e) => setNewClubBankAcct(e.target.value)}
                    className="w-full h-9 bg-slate-50 border border-slate-300 rounded-xl px-3 text-xs font-mono text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Free &gt; hrs
                  </label>
                  <input
                    type="number"
                    value={newFreeHours}
                    onChange={(e) => setNewFreeHours(Number(e.target.value))}
                    className="w-full h-9 bg-slate-50 border border-slate-300 rounded-xl px-2.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Lock &lt; hrs
                  </label>
                  <input
                    type="number"
                    value={newLockHours}
                    onChange={(e) => setNewLockHours(Number(e.target.value))}
                    className="w-full h-9 bg-slate-50 border border-slate-300 rounded-xl px-2.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Late Fee %
                  </label>
                  <input
                    type="number"
                    value={newLatePct}
                    onChange={(e) => setNewLatePct(Number(e.target.value))}
                    className="w-full h-9 bg-slate-50 border border-slate-300 rounded-xl px-2.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    No-Show %
                  </label>
                  <input
                    type="number"
                    value={newNoShowPct}
                    onChange={(e) => setNewNoShowPct(Number(e.target.value))}
                    className="w-full h-9 bg-slate-50 border border-slate-300 rounded-xl px-2.5 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateClubModal(false)}
                  className="h-9 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Create Club
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: MEMBER BENEFITS WALLET MODAL */}
      {walletModalPlayer && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setWalletModalPlayer(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-5 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Member Passes &amp; Credit Wallet
                </h3>
                <p className="text-xs text-slate-500">
                  {walletModalPlayer.name} ({walletModalPlayer.playerTag})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWalletModalPlayer(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveWalletModal} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Credit Balance ($)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={walletCreditInput}
                    onChange={(e) =>
                      setWalletCreditInput(Number(e.target.value))
                    }
                    className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-sm font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Free Session Passes
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={walletPassesInput}
                    onChange={(e) =>
                      setWalletPassesInput(Number(e.target.value))
                    }
                    className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-sm font-mono text-slate-900"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    Waive All Session Fees (VIP)
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Automatically settles all session shares at $0 owed.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={walletWaiveInput}
                  onChange={(e) => setWalletWaiveInput(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-600"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setWalletModalPlayer(null)}
                  className="h-9 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Save Wallet Benefits
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
