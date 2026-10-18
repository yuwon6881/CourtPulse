import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Copy,
  CreditCard,
  Eye,
  Gift,
  Plus,
  Search,
  Settings,
  Sliders,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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
  parseClubPaymentDetails,
} from '../utils/badmintonLogic';
import {
  ConfirmModal,
  SegmentedControl,
  StyledSelect,
} from './ui/FormControls';

type ClubConfigTab = 'policy' | 'payment' | 'invites';

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
  onAdminAddMemberToClub: (
    name: string,
    targetClubId?: string
  ) => Promise<void>;
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
  onUpdateClubSettings?: (
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
  ) => Promise<void>;
  onTriggerClubJoinPromptPreview?: (clubId: string) => void;
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
  onUpdateClubSettings,
  onTriggerClubJoinPromptPreview,
  onOpenUsersDirectory,
  onUpdatePlayerWallet,
}) => {
  const [showCreateClubModal, setShowCreateClubModal] = useState(false);
  const [showClubSettingsModal, setShowClubSettingsModal] = useState(false);
  const [clubConfigTab, setClubConfigTab] = useState<ClubConfigTab>('policy');
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
  const [pendingOwnerAssignment, setPendingOwnerAssignment] = useState<{
    clubId: string;
    clubName: string;
    newOwnerId: string;
    newOwnerName: string;
  } | null>(null);

  // Member Wallet Modal state
  const [walletModalPlayer, setWalletModalPlayer] = useState<Player | null>(
    null
  );
  const [walletCreditInput, setWalletCreditInput] = useState<number>(0);
  const [walletPassesInput, setWalletPassesInput] = useState<number>(0);
  const [walletWaiveInput, setWalletWaiveInput] = useState<boolean>(false);

  // Club Settings Modal state (for Club Owners & Site Admins only)
  const initialPayDetails =
    activeClub.paymentDetails ||
    parseClubPaymentDetails(
      activeClub.paymentInfo,
      activeClub.clubOwnerName || 'Alex Tan'
    );

  const [clubName, setClubName] = useState(activeClub.name);
  const [clubDesc, setClubDesc] = useState(activeClub.description);
  const [freeCancelHours, setFreeCancelHours] = useState(
    activeClub.freeCancelHours
  );
  const [lockCancelHours, setLockCancelHours] = useState(
    activeClub.lockCancelHours
  );
  const [lateCancelPct, setLateCancelPct] = useState(
    activeClub.lateCancelFeePercent
  );
  const [noShowPct, setNoShowPct] = useState(activeClub.noShowFeePercent);
  const [excludeOwnerFromBilling, setExcludeOwnerFromBilling] = useState(
    Boolean(activeClub.excludeOwnerFromBilling)
  );
  const [recipientName, setRecipientName] = useState(
    initialPayDetails.recipientName
  );
  const [phoneNumber, setPhoneNumber] = useState(initialPayDetails.phoneNumber);
  const [bankName, setBankName] = useState(initialPayDetails.bankName);
  const [bankAccountNumber, setBankAccountNumber] = useState(
    initialPayDetails.bankAccountNumber
  );
  const [paymentNotes, setPaymentNotes] = useState(
    initialPayDetails.paymentNotes
  );
  const [clubSettingsSavedToast, setClubSettingsSavedToast] = useState(false);

  useEffect(() => {
    const details =
      activeClub.paymentDetails ||
      parseClubPaymentDetails(
        activeClub.paymentInfo,
        activeClub.clubOwnerName || 'Alex Tan'
      );
    setClubName(activeClub.name);
    setClubDesc(activeClub.description);
    setFreeCancelHours(activeClub.freeCancelHours);
    setLockCancelHours(activeClub.lockCancelHours);
    setLateCancelPct(activeClub.lateCancelFeePercent);
    setNoShowPct(activeClub.noShowFeePercent);
    setExcludeOwnerFromBilling(Boolean(activeClub.excludeOwnerFromBilling));
    setRecipientName(details.recipientName);
    setPhoneNumber(details.phoneNumber);
    setBankName(details.bankName);
    setBankAccountNumber(details.bankAccountNumber);
    setPaymentNotes(details.paymentNotes);
  }, [activeClub]);

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

  const canManageRosterModalClub = useMemo(() => {
    if (!rosterModalClub) return false;
    if (isSiteAdmin) return true;
    if (isClubOwnerTier) {
      return rosterModalClub.clubOwnerPlayerId === activePlayer.id;
    }
    return false;
  }, [rosterModalClub, isSiteAdmin, isClubOwnerTier, activePlayer.id]);

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
        p.playerTag.toLowerCase().includes(q)
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

  const handleSaveClubSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageActiveClub || !onUpdateClubSettings) return;
    const details: ClubPaymentDetails = {
      recipientName:
        recipientName.trim() || activeClub.clubOwnerName || 'Club Owner',
      phoneNumber: phoneNumber.trim() || '+65 9123 4567',
      bankName: bankName.trim() || 'DBS Bank',
      bankAccountNumber: bankAccountNumber.trim() || '018-902341-2',
      paymentNotes:
        paymentNotes.trim() || 'Include your name & session date in reference',
    };
    await onUpdateClubSettings(activeClub.id, {
      name: clubName.trim() || activeClub.name,
      description: clubDesc.trim() || activeClub.description,
      paymentInfo: formatClubPaymentInfo(details),
      paymentDetails: details,
      freeCancelHours: Number(freeCancelHours) || 0,
      lockCancelHours: Number(lockCancelHours) || 0,
      lateCancelFeePercent: Number(lateCancelPct) || 0,
      noShowFeePercent: Number(noShowPct) || 0,
      excludeOwnerFromBilling,
    });
    setClubSettingsSavedToast(true);
    setTimeout(() => setClubSettingsSavedToast(false), 2500);
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim() || !rosterModalClub || !canManageRosterModalClub)
      return;
    await onAdminAddMemberToClub(newMemberName.trim(), rosterModalClub.id);
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
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display">
              Clubs &amp; Memberships
            </h1>
            <span className="text-xs font-mono font-semibold text-slate-500">
              · {userJoinedClubs.length} Joined
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
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

        {/* Admin / Club Owner Only Actions (Hidden when viewing a club not owned by the user) */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isClubOwnerTier &&
            !canManageActiveClub &&
            ownedClubsByCurrentPlayer[0] && (
              <button
                type="button"
                onClick={() => onSelectClub(ownedClubsByCurrentPlayer[0].id)}
                className="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer shadow-2xs"
              >
                <Building2 className="w-4 h-4 text-emerald-600" />
                <span>
                  Switch to My Club ({ownedClubsByCurrentPlayer[0].name})
                </span>
              </button>
            )}

          {canManageActiveClub && onUpdateClubSettings && (
            <button
              type="button"
              onClick={() => {
                setClubConfigTab('policy');
                setShowClubSettingsModal(true);
              }}
              className="h-10 px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer shadow-2xs"
            >
              <Settings className="w-4 h-4 text-slate-600" />
              <span>Club Settings</span>
            </button>
          )}

          {canCreateAnotherClub && (
            <button
              type="button"
              onClick={() => setShowCreateClubModal(true)}
              className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Create Club</span>
            </button>
          )}
        </div>
      </div>

      {/* SECTION 1: MY CLUBS */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            My Clubs ({userJoinedClubs.length})
          </h2>
          <span className="text-xs text-slate-600 font-medium">
            Click any club card to inspect its member roster and settings
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {userJoinedClubs.map((club, idx) => {
            const clubMemberCount = players.filter((p) =>
              hasPlayerJoinedClub(p, club.id)
            ).length;
            const clubSessionCount = sessions.filter(
              (s) => s.clubId === club.id
            ).length;
            const isOwner = club.clubOwnerPlayerId === activePlayer.id;

            return (
              <motion.div
                key={club.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: idx * 0.04 }}
                onClick={() => {
                  onSelectClub(club.id);
                  setRosterModalClubId(club.id);
                }}
                className="rounded-2xl border p-4 sm:p-5 transition-all cursor-pointer flex flex-col justify-between gap-3 bg-white border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/40 shadow-2xs"
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-4 h-4 shrink-0 text-slate-500" />
                      <h3 className="text-base font-bold text-slate-900 truncate font-display">
                        {club.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                      {isOwner && (
                        <span className="font-semibold text-emerald-700">
                          Owner
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">
                    {club.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <div className="flex items-center gap-2 font-mono tabular-nums">
                    <span>{clubMemberCount} members</span>
                    <span>·</span>
                    <span>{clubSessionCount} sessions</span>
                  </div>
                  <span className="text-[11px] font-medium text-slate-500">
                    Free cancel &gt;{club.freeCancelHours}h · Late {club.lateCancelFeePercent}%
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* SECTION 2: DISCOVER OTHER CLUBS TO JOIN */}
      {unjoinedClubs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
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
                  className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center justify-between gap-4 shadow-2xs"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate font-display">
                      {club.name}
                    </p>
                    <p className="text-xs text-slate-600 truncate mt-0.5">
                      {club.description}
                    </p>
                    <p className="text-[11px] text-slate-600 font-medium mt-1">
                      Owner: {club.clubOwnerName || 'Club Owner'} · {memberCount}{' '}
                      members
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onJoinClub(club.id)}
                    className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shrink-0 transition-colors cursor-pointer shadow-xs"
                  >
                    Join Club
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 3: ALL PLATFORM CLUBS DIRECTORY */}
      {isSiteAdmin && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 font-display">
                All Platform Clubs ({filteredPlatformClubs.length})
              </h2>
              <p className="text-xs text-slate-600">
                Select any club row to inspect its member roster and ownership.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={clubDirectorySearch}
                onChange={(e) => setClubDirectorySearch(e.target.value)}
                placeholder="Search clubs or owners..."
                className="w-full h-9 pl-8 pr-3 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-slate-500 focus:bg-white"
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
                        <span className="text-[11px] font-semibold text-emerald-700">
                          · Owner Exempt
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 truncate mt-0.5">
                      Owner: {c.clubOwnerName || 'Alex Tan'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-xs font-mono tabular-nums text-slate-600">
                    <span>{memberCount} members</span>
                    <span>·</span>
                    <span>{sessionCount} sessions</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL 1: CLUB MEMBER ROSTER & DETAILS MODAL */}
      <AnimatePresence>
        {rosterModalClub && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setRosterModalClubId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 truncate font-display">
                      {rosterModalClub.name}
                    </h3>
                    <span className="text-xs font-mono text-slate-600 font-medium">
                      · {rosterClubMembers.length} members
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 truncate mt-0.5">
                    Owner: {rosterModalClub.clubOwnerName || 'Alex Tan'} · Free Tap-Out &gt;
                    {rosterModalClub.freeCancelHours}h · Late{' '}
                    {rosterModalClub.lateCancelFeePercent}%
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRosterModalClubId(null)}
                  className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer shrink-0"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                {/* Quick Actions Bar inside Club Modal: Invite Link + Owner Assignment */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyInviteLinkForClub(rosterModalClub.id)
                      }
                      className="h-9 px-3.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
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
                          <Copy className="w-3.5 h-3.5 text-slate-600" />
                          <span>Copy Club Invite Link</span>
                        </>
                      )}
                    </button>
                  </div>

                  {isSiteAdmin && (
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <span className="text-[11px] font-semibold text-slate-600 shrink-0">
                        Owner:
                      </span>
                      <div className="flex-1 sm:w-44">
                        <StyledSelect
                          aria-label="Assign Club Owner"
                          value={
                            rosterModalClub.clubOwnerPlayerId || 'player_alex'
                          }
                          onChange={(e) => {
                            const nextId = e.target.value;
                            if (nextId === rosterModalClub.clubOwnerPlayerId)
                              return;
                            const nextPlayer = players.find(
                              (p) => p.id === nextId
                            );
                            if (nextPlayer) {
                              setPendingOwnerAssignment({
                                clubId: rosterModalClub.id,
                                clubName: rosterModalClub.name,
                                newOwnerId: nextPlayer.id,
                                newOwnerName: nextPlayer.name,
                              });
                            }
                          }}
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
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Filter club members..."
                      className="w-full h-9 pl-8 pr-3 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-slate-500 focus:bg-white"
                    />
                  </div>

                  {canManageRosterModalClub && (
                    <form
                      onSubmit={handleAddMemberSubmit}
                      className="flex items-center gap-1.5"
                    >
                      <input
                        type="text"
                        value={newMemberName}
                        onChange={(e) => setNewMemberName(e.target.value)}
                        placeholder="Add member by name..."
                        className="flex-1 sm:w-auto h-9 px-3 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-slate-500 focus:bg-white"
                      />
                      <button
                        type="submit"
                        className="h-9 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer shrink-0"
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
                            <span className="text-[11px] font-mono text-slate-500">
                              {member.playerTag}
                            </span>
                            {isClubOwner && (
                              <span className="text-[11px] font-semibold text-emerald-700">
                                · Club Owner
                              </span>
                            )}
                            {hasBenefits && (
                              <span className="text-[11px] font-semibold text-indigo-700">
                                ·{' '}
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
                          <p className="text-[11px] text-slate-600 mt-0.5">
                            Rating {member.ratingScore}
                          </p>
                        </div>

                        {canManageRosterModalClub && onUpdatePlayerWallet && (
                          <button
                            type="button"
                            onClick={() => openWalletModal(member)}
                            className="h-8 px-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 transition-colors shrink-0 cursor-pointer shadow-2xs"
                          >
                            <Gift className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Passes &amp; Credit</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  {isSiteAdmin && clubs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteClubId(rosterModalClub.id)}
                      className="h-8 px-3 rounded-xl text-rose-700 hover:bg-rose-50 text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Club</span>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRosterModalClubId(null)}
                    className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL 2: CLUB SETTINGS & POLICY CONFIGURATION (STRICTLY FOR CLUB OWNERS / SITE ADMINS) */}
      <AnimatePresence>
        {showClubSettingsModal && canManageActiveClub && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShowClubSettingsModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-display">
                    Club Settings — {activeClub.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configure club rules, owner billing exemption, payment recipient info, and invite links.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowClubSettingsModal(false)}
                  className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Section Switcher Bar */}
              <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                <SegmentedControl
                  size="sm"
                  value={clubConfigTab}
                  onChange={setClubConfigTab}
                  options={[
                    { value: 'policy', label: 'Policy & Billing' },
                    { value: 'payment', label: 'Payment Recipient' },
                    { value: 'invites', label: 'Club Invites' },
                  ]}
                />

                {clubs.length > 1 && isSiteAdmin && (
                  <div className="w-48">
                    <StyledSelect
                      aria-label="Select club to configure"
                      value={activeClub.id}
                      onChange={(e) => onSelectClub(e.target.value)}
                    >
                      {clubs.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </StyledSelect>
                  </div>
                )}
              </div>

              {/* Modal Body */}
              <form
                onSubmit={handleSaveClubSettingsSubmit}
                className="p-5 overflow-y-auto flex-1 space-y-5"
              >
                {clubConfigTab === 'policy' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                          Club Name
                        </label>
                        <input
                          type="text"
                          required
                          value={clubName}
                          onChange={(e) => setClubName(e.target.value)}
                          className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                          Schedule &amp; Venue Description
                        </label>
                        <input
                          type="text"
                          value={clubDesc}
                          onChange={(e) => setClubDesc(e.target.value)}
                          className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                        />
                      </div>
                    </div>

                    {/* Owner Billing Rule Card */}
                    <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Wallet className="w-4 h-4 text-emerald-700 shrink-0" />
                            <h4 className="text-xs font-bold text-slate-900">
                              Exclude Club Owner from Session Fee Calculations
                            </h4>
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">
                            When enabled, the club owner (<span className="font-semibold text-slate-900">{activeClub.clubOwnerName || 'Club Owner'}</span>) is exempt (<span className="font-mono font-semibold">$0.00</span>) and session costs are split among the remaining players.
                          </p>
                        </div>

                        <label className="inline-flex items-center gap-2 cursor-pointer shrink-0 select-none bg-white px-3 py-2 rounded-xl border border-slate-200 self-start">
                          <input
                            type="checkbox"
                            checked={excludeOwnerFromBilling}
                            onChange={(e) =>
                              setExcludeOwnerFromBilling(e.target.checked)
                            }
                            className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-xs font-bold text-slate-900">
                            {excludeOwnerFromBilling
                              ? 'Owner Excluded ($0)'
                              : 'Owner Included'}
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* Tap-Out Cutoffs */}
                    <div className="space-y-2.5 pt-2 border-t border-slate-100">
                      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-slate-500" />
                        <span>Tap-Out Cutoffs &amp; Penalty Weights</span>
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Free Cancel (hrs)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={168}
                            value={freeCancelHours}
                            onChange={(e) =>
                              setFreeCancelHours(Number(e.target.value))
                            }
                            className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-sm font-mono text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Lock Cutoff (hrs)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={72}
                            value={lockCancelHours}
                            onChange={(e) =>
                              setLockCancelHours(Number(e.target.value))
                            }
                            className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-sm font-mono text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Late Fee (%)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={lateCancelPct}
                            onChange={(e) =>
                              setLateCancelPct(Number(e.target.value))
                            }
                            className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-sm font-mono text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            No-Show Fee (%)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={noShowPct}
                            onChange={(e) =>
                              setNoShowPct(Number(e.target.value))
                            }
                            className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-sm font-mono text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {clubConfigTab === 'payment' && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <CreditCard className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Displayed to members of <strong className="text-slate-900">{activeClub.name}</strong> when settling session fees.
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Recipient Name (PayNow / Bank)
                        </label>
                        <input
                          type="text"
                          value={recipientName}
                          onChange={(e) => setRecipientName(e.target.value)}
                          placeholder="e.g., Alex Tan"
                          className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          PayNow Phone Number
                        </label>
                        <input
                          type="text"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          placeholder="+65 9123 4567"
                          className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm font-mono text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Bank Name
                        </label>
                        <input
                          type="text"
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          placeholder="DBS Bank / OCBC / UOB"
                          className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Bank Account Number
                        </label>
                        <input
                          type="text"
                          value={bankAccountNumber}
                          onChange={(e) => setBankAccountNumber(e.target.value)}
                          placeholder="018-902341-2"
                          className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm font-mono text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Transfer Reference Instructions
                        </label>
                        <input
                          type="text"
                          value={paymentNotes}
                          onChange={(e) => setPaymentNotes(e.target.value)}
                          placeholder="Include your name & session date in transfer reference"
                          className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {clubConfigTab === 'invites' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        Direct Club Invite URL
                      </label>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={buildShareableClubAndSessionUrl(activeClub.id)}
                          onFocus={(e) => e.currentTarget.select()}
                          className="flex-1 h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-xs font-mono text-slate-700 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyInviteLinkForClub(activeClub.id)
                          }
                          className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
                        >
                          {copiedInviteClubId === activeClub.id ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-400" />
                              <span>Invite Link Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              <span>Copy Invite Link</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {onTriggerClubJoinPromptPreview && (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-slate-900">
                            Test Member Join Invitation Modal
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Preview the onboarding modal that appears when a player opens your club invite link.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowClubSettingsModal(false);
                            onTriggerClubJoinPromptPreview(activeClub.id);
                          }}
                          className="h-9 px-3.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
                        >
                          <Eye className="w-3.5 h-3.5 text-slate-500" />
                          <span>Preview Join Modal</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">
                    {clubSettingsSavedToast ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                        <Check className="w-4 h-4" />
                        Club settings saved!
                      </span>
                    ) : (
                      <span>Changes take effect immediately for all club members.</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowClubSettingsModal(false)}
                      className="h-9 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                    >
                      Close
                    </button>
                    {clubConfigTab !== 'invites' && (
                      <button
                        type="submit"
                        className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer shadow-xs"
                      >
                        Save Club Settings
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL 3: CREATE NEW CLUB MODAL */}
      <AnimatePresence>
        {showCreateClubModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShowCreateClubModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-display">
                    Create New Badminton Club
                  </h3>
                  <p className="text-xs text-slate-600">
                    Set up club schedule, tap-out policies, and payment recipient details.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateClubModal(false)}
                  className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateClubSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
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
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
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
                    <label className="block text-xs font-semibold text-slate-800 mb-1">
                      Assign Club Owner (1 Club per Owner)
                    </label>
                    <StyledSelect
                      value={newClubOwnerId}
                      onChange={(e) => setNewClubOwnerId(e.target.value)}
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
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

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
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
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
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
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
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
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
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
                    className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer shadow-xs"
                  >
                    Create Club
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL 4: MEMBER BENEFITS WALLET MODAL */}
      <AnimatePresence>
        {walletModalPlayer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setWalletModalPlayer(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-5 shadow-xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-display">
                    Member Passes &amp; Credit Wallet
                  </h3>
                  <p className="text-xs text-slate-500">
                    {walletModalPlayer.name} ({walletModalPlayer.playerTag})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setWalletModalPlayer(null)}
                  className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
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
                    className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer shadow-xs"
                  >
                    Save Wallet Benefits
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal: Delete Club */}
      <ConfirmModal
        open={Boolean(confirmDeleteClubId)}
        title="Delete Badminton Club?"
        description={(() => {
          const targetClub = clubs.find((c) => c.id === confirmDeleteClubId);
          return targetClub ? (
            <p>
              Are you sure you want to permanently delete{' '}
              <strong className="font-semibold text-slate-900">
                {targetClub.name}
              </strong>
              ? All sessions, RSVPs, and settings associated with this club will
              be removed.
            </p>
          ) : null;
        })()}
        confirmLabel="Delete Club"
        variant="danger"
        onCancel={() => setConfirmDeleteClubId(null)}
        onConfirm={async () => {
          if (!confirmDeleteClubId) return;
          const targetId = confirmDeleteClubId;
          setConfirmDeleteClubId(null);
          setRosterModalClubId(null);
          await onDeleteClub(targetId);
        }}
      />

      {/* Confirmation Modal: Reassign Club Owner */}
      <ConfirmModal
        open={Boolean(pendingOwnerAssignment)}
        title="Reassign Club Ownership?"
        description={
          pendingOwnerAssignment ? (
            <p>
              Transfer club ownership of{' '}
              <strong className="font-semibold text-slate-900">
                {pendingOwnerAssignment.clubName}
              </strong>{' '}
              to{' '}
              <strong className="font-semibold text-slate-900">
                {pendingOwnerAssignment.newOwnerName}
              </strong>
              ? They will gain full administrative and billing control over this
              club.
            </p>
          ) : null
        }
        confirmLabel="Confirm Ownership Transfer"
        variant="warning"
        onCancel={() => setPendingOwnerAssignment(null)}
        onConfirm={async () => {
          if (!pendingOwnerAssignment) return;
          const target = pendingOwnerAssignment;
          setPendingOwnerAssignment(null);
          await onAssignClubOwner(target.clubId, target.newOwnerId);
        }}
      />
    </div>
  );
};
