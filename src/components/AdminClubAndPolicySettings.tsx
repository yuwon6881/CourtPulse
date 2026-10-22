import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Clock,
  Copy,
  CreditCard,
  Eye,
  Gift,
  Globe,
  Lock,
  LogOut,
  Plus,
  Search,
  Settings,
  Sliders,
  Swords,
  Trash2,
  UserMinus,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Club,
  ClubJoinRequest,
  ClubPaymentDetails,
  ClubVisibility,
  OutstandingDebtItem,
  PermissionTier,
  Player,
  PlayerBenefitWallet,
  Session,
} from '../types';
import {
  buildShareableClubAndSessionUrl,
  formatClubPaymentInfo,
  validateClubPaymentDetails,
  getPlayerClubWallet,
  hasPlayerJoinedClub,
  parseClubPaymentDetails,
} from '../utils/badmintonLogic';
import {
  COMMON_CLUB_TIMEZONES,
  DEFAULT_CLUB_TIMEZONE,
  resolveClubTimeZone,
} from '../utils/clubTime';
import {
  ConfirmModal,
  FormAlertBanner,
  SegmentedControl,
  StyledInput,
  StyledSelect,
} from './ui/FormControls';

type ClubConfigTab = 'policy' | 'payment' | 'invites';

const ClubVisibilityBadge: React.FC<{ club: Pick<Club, 'visibility'> }> = ({
  club,
}) =>
  club.visibility === 'private' ? (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0"
      title="Private club: joining requires club owner approval"
    >
      <Lock className="w-3 h-3" />
      Private
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0"
      title="Public club: anyone can join instantly"
    >
      <Globe className="w-3 h-3" />
      Public
    </span>
  );

const VISIBILITY_OPTIONS: { value: ClubVisibility; label: string }[] = [
  { value: 'public', label: 'Public · Anyone can join' },
  { value: 'private', label: 'Private · Owner approves' },
];

interface AdminClubAndPolicySettingsProps {
  clubs: Club[];
  userJoinedClubs: Club[];
  unjoinedClubs: Club[];
  activeClub: Club;
  players: Player[];
  sessions: Session[];
  activePlayer: Player;
  activePlayerDebts?: OutstandingDebtItem[];
  walletsMap?: Record<string, PlayerBenefitWallet>;
  permissionTier: PermissionTier;
  canManageActiveClub: boolean;
  onSelectClub: (clubId: string) => void;
  onJoinClub: (clubId: string) => Promise<void>;
  onLeaveClub?: (clubId: string) => Promise<void>;
  onRemoveMemberFromClub?: (
    playerId: string,
    clubId: string
  ) => Promise<void>;
  onAdminAddMemberToClub: (
    name: string,
    targetClubId?: string
  ) => Promise<void>;
  onAssignClubOwner: (clubId: string, ownerPlayerId: string) => Promise<void>;
  onDeleteClub: (clubId: string) => Promise<void>;
  clubJoinRequests: ClubJoinRequest[];
  onCancelJoinRequest: (clubId: string) => void;
  onApproveJoinRequest: (requestId: string) => Promise<void>;
  onRejectJoinRequest: (requestId: string) => void;
  onUpdateClubVisibility: (clubId: string, visibility: ClubVisibility) => void;
  onCreateNewClub: (clubData: {
    name: string;
    description: string;
    paymentInfo: string;
    paymentDetails?: ClubPaymentDetails;
    freeCancelHours: number;
    lockCancelHours: number;
    lateCancelFeePercent: number;
    noShowFeePercent: number;
    defaultMatchTargetPoints?: number;
    visibility?: ClubVisibility;
    ownerPlayerId?: string;
    timezone?: string;
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
      defaultMatchTargetPoints?: number;
      timezone?: string;
    }
  ) => Promise<void>;
  onTriggerClubJoinPromptPreview?: (clubId: string) => void;
  onOpenUsersDirectory?: () => void;
  onUpdatePlayerWallet?: (
    playerId: string,
    updates: Partial<PlayerBenefitWallet>,
    clubId?: string
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
  activePlayerDebts = [],
  walletsMap,
  permissionTier,
  canManageActiveClub,
  onSelectClub,
  onJoinClub,
  onLeaveClub,
  onRemoveMemberFromClub,
  onAdminAddMemberToClub,
  onAssignClubOwner,
  onDeleteClub,
  clubJoinRequests,
  onCancelJoinRequest,
  onApproveJoinRequest,
  onRejectJoinRequest,
  onUpdateClubVisibility,
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
  const [pendingLeaveClub, setPendingLeaveClub] = useState<Club | null>(null);
  const [pendingRemoveMember, setPendingRemoveMember] = useState<{
    player: Player;
    club: Club;
  } | null>(null);
  const [membershipActionError, setMembershipActionError] = useState<
    string | null
  >(null);

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
      activeClub.clubOwnerName || 'Club owner'
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
  const [defaultMatchTargetPoints, setDefaultMatchTargetPoints] = useState<number>(
    activeClub.defaultMatchTargetPoints ?? 21
  );
  const [clubVisibility, setClubVisibility] = useState<ClubVisibility>(
    activeClub.visibility || 'public'
  );
  const [clubTimezone, setClubTimezone] = useState<string>(
    resolveClubTimeZone(activeClub.timezone)
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
  const [clubSettingsErrors, setClubSettingsErrors] = useState<{
    clubName?: string;
    freeCancelHours?: string;
    lockCancelHours?: string;
    lateCancelPct?: string;
    noShowPct?: string;
    defaultMatchTargetPoints?: string;
    payment?: string;
  }>({});

  useEffect(() => {
    const details =
      activeClub.paymentDetails ||
      parseClubPaymentDetails(
        activeClub.paymentInfo,
        activeClub.clubOwnerName || 'Club owner'
      );
    setClubName(activeClub.name);
    setClubDesc(activeClub.description);
    setFreeCancelHours(activeClub.freeCancelHours);
    setLockCancelHours(activeClub.lockCancelHours);
    setLateCancelPct(activeClub.lateCancelFeePercent);
    setNoShowPct(activeClub.noShowFeePercent);
    setExcludeOwnerFromBilling(Boolean(activeClub.excludeOwnerFromBilling));
    setDefaultMatchTargetPoints(activeClub.defaultMatchTargetPoints ?? 21);
    setClubVisibility(activeClub.visibility || 'public');
    setClubTimezone(resolveClubTimeZone(activeClub.timezone));
    setRecipientName(details.recipientName);
    setPhoneNumber(details.phoneNumber);
    setBankName(details.bankName);
    setBankAccountNumber(details.bankAccountNumber);
    setPaymentNotes(details.paymentNotes);
    setClubSettingsErrors({});
  }, [activeClub.id]);

  // Create New Club Modal state
  const [newClubName, setNewClubName] = useState('');
  const [newClubNameError, setNewClubNameError] = useState<string | undefined>(
    undefined
  );
  const [newClubPayError, setNewClubPayError] = useState<string | undefined>(
    undefined
  );
  const [newClubDesc, setNewClubDesc] = useState(
    'Weekly badminton courts & automated shuttle splits.'
  );
  const [newClubRecipient, setNewClubRecipient] = useState(
    activePlayer.name || 'Club Organizer'
  );
  const [newClubPhone, setNewClubPhone] = useState('');
  const [newClubBankName, setNewClubBankName] = useState('');
  const [newClubBankAcct, setNewClubBankAcct] = useState('');
  const [newClubPayNote, setNewClubPayNote] = useState(
    'Include your name & session date in transfer reference'
  );
  const [newClubOwnerId, setNewClubOwnerId] = useState(activePlayer.id);
  const [newClubOwnerError, setNewClubOwnerError] = useState<
    string | undefined
  >(undefined);
  const [newClubTimezone, setNewClubTimezone] = useState<string>(
    DEFAULT_CLUB_TIMEZONE
  );
  const [newFreeHours, setNewFreeHours] = useState(24);
  const [newLockHours, setNewLockHours] = useState(4);
  const [newLatePct, setNewLatePct] = useState(50);
  const [newNoShowPct, setNewNoShowPct] = useState(100);
  const [newClubVisibility, setNewClubVisibility] =
    useState<ClubVisibility>('public');
  const [walletErrors, setWalletErrors] = useState<{
    credit?: string;
    passes?: string;
  }>({});

  // Platform Clubs Directory Search
  const [clubDirectorySearch, setClubDirectorySearch] = useState('');

  const isSiteAdmin = permissionTier === 'admin';
  const isClubOwnerTier = permissionTier === 'club_owner';

  const ownedClubsByCurrentPlayer = useMemo(
    () => clubs.filter((c) => c.clubOwnerPlayerId === activePlayer.id),
    [clubs, activePlayer.id]
  );

  const myPendingRequestClubIds = useMemo(
    () =>
      new Set(
        clubJoinRequests
          .filter((r) => r.playerId === activePlayer.id)
          .map((r) => r.clubId)
      ),
    [clubJoinRequests, activePlayer.id]
  );

  // Pending requests of mine for clubs I cannot read (private clubs I am not in): shown without any
  // club details so the request can still be cancelled.
  const hiddenPendingRequests = useMemo(
    () =>
      clubJoinRequests.filter(
        (r) =>
          r.playerId === activePlayer.id && !clubs.some((c) => c.id === r.clubId)
      ),
    [clubJoinRequests, clubs, activePlayer.id]
  );

  // Join requests waiting on the current Club Owner / Site Admin, for private clubs they manage
  const manageableJoinRequests = useMemo(
    () =>
      clubJoinRequests
        .filter((r) => {
          const club = clubs.find((c) => c.id === r.clubId);
          return Boolean(
            club &&
              (isSiteAdmin ||
                (isClubOwnerTier && club.clubOwnerPlayerId === activePlayer.id))
          );
        })
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)),
    [clubJoinRequests, clubs, isSiteAdmin, isClubOwnerTier, activePlayer.id]
  );

  const canCreateAnotherClub =
    isSiteAdmin;

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

  // Member balances and wallets are strictly the Club Owner's business (not Site Admin's unless Admin owns this club)
  const isOwnerOfRosterModalClub = useMemo(() => {
    if (!rosterModalClub || permissionTier === 'user') return false;
    return rosterModalClub.clubOwnerPlayerId === activePlayer.id;
  }, [rosterModalClub, permissionTier, activePlayer.id]);

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
    const nextErrors: typeof clubSettingsErrors = {};
    if (!clubName.trim()) {
      nextErrors.clubName = 'Please enter a club name.';
    }
    if (
      Number.isNaN(Number(freeCancelHours)) ||
      Number(freeCancelHours) < 0 ||
      Number(freeCancelHours) > 168
    ) {
      nextErrors.freeCancelHours = '0–168 hrs.';
    }
    if (
      Number.isNaN(Number(lockCancelHours)) ||
      Number(lockCancelHours) < 0 ||
      Number(lockCancelHours) > 72
    ) {
      nextErrors.lockCancelHours = '0–72 hrs.';
    }
    if (
      Number.isNaN(Number(lateCancelPct)) ||
      Number(lateCancelPct) < 0 ||
      Number(lateCancelPct) > 100
    ) {
      nextErrors.lateCancelPct = '0–100%.';
    }
    if (
      Number.isNaN(Number(noShowPct)) ||
      Number(noShowPct) < 0 ||
      Number(noShowPct) > 100
    ) {
      nextErrors.noShowPct = '0–100%.';
    }
    if (
      Number.isNaN(Number(defaultMatchTargetPoints)) ||
      Number(defaultMatchTargetPoints) < 1 ||
      Number(defaultMatchTargetPoints) > 100
    ) {
      nextErrors.defaultMatchTargetPoints = '1–100 pts.';
    }
    const details: ClubPaymentDetails = {
      recipientName: recipientName.trim(),
      phoneNumber: phoneNumber.trim(),
      bankName: bankName.trim(),
      bankAccountNumber: bankAccountNumber.trim(),
      paymentNotes:
        paymentNotes.trim() || 'Include your name & session date in reference',
    };
    const paymentError = validateClubPaymentDetails(details);
    if (paymentError) nextErrors.payment = paymentError;
    if (Object.keys(nextErrors).length > 0) {
      setClubSettingsErrors(nextErrors);
      setClubConfigTab(paymentError && !nextErrors.clubName && !nextErrors.freeCancelHours && !nextErrors.lateCancelPct && !nextErrors.noShowPct && !nextErrors.defaultMatchTargetPoints ? 'payment' : 'policy');
      return;
    }
    setClubSettingsErrors({});

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
      defaultMatchTargetPoints: Math.max(
        1,
        Math.min(100, Math.round(Number(defaultMatchTargetPoints) || 21))
      ),
      timezone: clubTimezone,
    });
    if (clubVisibility !== (activeClub.visibility || 'public')) {
      onUpdateClubVisibility(activeClub.id, clubVisibility);
    }
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

  const openWalletModal = (player: Player, clubId: string) => {
    const clubWallet = getPlayerClubWallet(player, clubId, walletsMap);
    setWalletModalPlayer(player);
    setWalletCreditInput(Number(clubWallet.creditBalance.toFixed(2)));
    setWalletPassesInput(Math.floor(clubWallet.freeSessionPasses));
    setWalletWaiveInput(Boolean(clubWallet.waiveAllFees));
    setWalletErrors({});
  };

  const handleSaveWalletModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletModalPlayer || !onUpdatePlayerWallet) return;
    const nextWalletErrs: typeof walletErrors = {};
    if (Number.isNaN(Number(walletCreditInput)) || Number(walletCreditInput) < 0) {
      nextWalletErrs.credit = 'Credit balance must be $0 or more.';
    }
    if (Number.isNaN(Number(walletPassesInput)) || Number(walletPassesInput) < 0) {
      nextWalletErrs.passes = 'Passes must be 0 or more.';
    }
    if (Object.keys(nextWalletErrs).length > 0) {
      setWalletErrors(nextWalletErrs);
      return;
    }
    setWalletErrors({});
    const targetClubId = rosterModalClub?.id || activeClub.id;
    await onUpdatePlayerWallet(
      walletModalPlayer.id,
      {
        creditBalance: Math.max(0, Number(walletCreditInput || 0)),
        freeSessionPasses: Math.max(
          0,
          Math.floor(Number(walletPassesInput || 0))
        ),
        waiveAllFees: Boolean(walletWaiveInput),
      },
      targetClubId
    );
    setWalletModalPlayer(null);
  };

  const handleCreateClubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateAnotherClub) return;
    if (!newClubName.trim()) {
      setNewClubNameError('Please enter a name for your new club.');
      return;
    }
    setNewClubNameError(undefined);

    const details: ClubPaymentDetails = {
      recipientName: newClubRecipient.trim(),
      phoneNumber: newClubPhone.trim(),
      bankName: newClubBankName.trim(),
      bankAccountNumber: newClubBankAcct.trim(),
      paymentNotes:
        newClubPayNote.trim() ||
        'Include your name & session date in transfer reference',
    };
    const newPayError = validateClubPaymentDetails(details);
    if (newPayError) {
      setNewClubPayError(newPayError);
      return;
    }
    setNewClubPayError(undefined);

    // One club per owner: say so instead of silently doing nothing.
    const chosenOwnerId = isSiteAdmin ? newClubOwnerId : activePlayer.id;
    const ownedAlready = clubs.find((c) => c.clubOwnerPlayerId === chosenOwnerId);
    if (ownedAlready) {
      const ownerName =
        players.find((p) => p.id === chosenOwnerId)?.name || 'This player';
      setNewClubOwnerError(
        `${ownerName} already owns ${ownedAlready.name}. A player can own only one club, so pick a different owner.`
      );
      return;
    }
    setNewClubOwnerError(undefined);

    const created = await onCreateNewClub({
      name: newClubName.trim(),
      description: newClubDesc.trim(),
      paymentInfo: formatClubPaymentInfo(details),
      paymentDetails: details,
      freeCancelHours: Number(newFreeHours) || 24,
      lockCancelHours: Number(newLockHours) || 4,
      lateCancelFeePercent: Number(newLatePct) || 50,
      noShowFeePercent: Number(newNoShowPct) || 100,
      visibility: newClubVisibility,
      ownerPlayerId: isSiteAdmin ? newClubOwnerId : activePlayer.id,
      timezone: newClubTimezone,
    });

    if (created) {
      setNewClubName('');
      setNewClubVisibility('public');
      setShowCreateClubModal(false);
      onSelectClub(created.id);
    } else {
      setNewClubOwnerError(
        'The club could not be created. Check that the chosen owner does not already own a club and try again.'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header — Clean Club Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display">
              {isClubOwnerTier ? 'My Club & Policy' : 'Clubs & Memberships'}
            </h1>
            {!isClubOwnerTier && (
              <span className="text-xs font-mono font-semibold text-slate-500">
                · {userJoinedClubs.length} Joined
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Active Club:{' '}
            <span className="font-semibold text-slate-900">
              {activeClub.name}
            </span>{' '}
            · Owner: {activeClub.clubOwnerName || 'Club owner'} ·{' '}
            {activeClub.visibility === 'private' ? 'Private' : 'Public'} · Match
            Target: {activeClub.defaultMatchTargetPoints ?? 21} pts
            {activeClub.excludeOwnerFromBilling
              ? ' (Owner Excluded from Billing)'
              : ''}
          </p>
        </div>

        {/* Admin / Club Owner Only Actions (Hidden when viewing a club not owned by the user) */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
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

      {/* SECTION 0: PENDING JOIN REQUESTS (Club Owner / Site Admin) */}
      {manageableJoinRequests.length > 0 && (
        <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-900 inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Join Requests ({manageableJoinRequests.length})
            </h2>
            <span className="text-xs text-amber-900/80 font-medium">
              Players waiting to join your private club
            </span>
          </div>
          <div className="divide-y divide-amber-100 bg-white border border-amber-200/80 rounded-xl">
            {manageableJoinRequests.map((r) => {
              const club = clubs.find((c) => c.id === r.clubId);
              return (
                <div
                  key={r.id}
                  className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900">
                        {r.playerName}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        {r.playerTag}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      {isSiteAdmin && club ? `${club.name} · ` : ''}Requested{' '}
                      {new Date(r.requestedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onRejectJoinRequest(r.id)}
                      className="h-8 px-3 rounded-xl bg-white hover:bg-rose-50 border border-slate-300 text-rose-700 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => void onApproveJoinRequest(r.id)}
                      className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Approve
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 1: MY CLUBS */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            {isClubOwnerTier
              ? 'Managed Club'
              : `My Clubs (${userJoinedClubs.length})`}
          </h2>
          <span className="text-xs text-slate-600 font-medium">
            {isClubOwnerTier
              ? 'Click your club card to view its members and settings'
              : 'Click any club card to view its members and settings'}
          </span>
        </div>

        {userJoinedClubs.length === 0 && (
          <div className="p-6 text-center rounded-2xl border border-dashed border-slate-300 bg-white text-xs text-slate-600">
            {clubs.length === 0
              ? isSiteAdmin
                ? 'No clubs exist on the platform yet. Click "+ Create Club" above to create the first badminton club and assign its owner.'
                : 'No clubs have been published on the platform yet. Once an organizer creates a club, it will appear here.'
              : 'You haven’t joined any clubs yet. Pick one below — public clubs can be joined instantly, private clubs need owner approval.'}
          </div>
        )}

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
                      <ClubVisibilityBadge club={club} />
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

      {/* SECTION 2: DISCOVER OTHER CLUBS TO JOIN (public clubs; private ones only for members/owners/admins) */}
      {hiddenPendingRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            Pending requests to private clubs ({hiddenPendingRequests.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {hiddenPendingRequests.map((request) => (
              <div
                key={request.id}
                className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center justify-between gap-4 shadow-2xs"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate font-display">
                    Private club
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Waiting for the club owner to approve your request.
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="h-9 px-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Request Pending
                  </span>
                  <button
                    type="button"
                    onClick={() => onCancelJoinRequest(request.clubId)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:underline cursor-pointer"
                  >
                    Cancel request
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
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
              const isPrivate = club.visibility === 'private';
              const isPending =
                isPrivate && myPendingRequestClubIds.has(club.id);
              return (
                <div
                  key={club.id}
                  className="bg-white border border-slate-200/90 rounded-2xl p-4 flex items-center justify-between gap-4 shadow-2xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate font-display">
                        {club.name}
                      </p>
                      <ClubVisibilityBadge club={club} />
                    </div>
                    <p className="text-xs text-slate-600 truncate mt-0.5">
                      {club.description}
                    </p>
                    <p className="text-[11px] text-slate-600 font-medium mt-1">
                      Owner: {club.clubOwnerName || 'Club Owner'} · {memberCount}{' '}
                      members
                    </p>
                  </div>
                  {isPending ? (
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="h-9 px-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold inline-flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        Request Pending
                      </span>
                      <button
                        type="button"
                        onClick={() => onCancelJoinRequest(club.id)}
                        className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:underline cursor-pointer"
                      >
                        Cancel request
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onJoinClub(club.id)}
                      className={`h-9 px-3.5 rounded-xl text-xs font-semibold shrink-0 transition-colors cursor-pointer shadow-xs inline-flex items-center gap-1.5 ${
                        isPrivate
                          ? 'bg-slate-900 hover:bg-slate-800 text-white'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      {isPrivate && <Lock className="w-3.5 h-3.5" />}
                      {isPrivate ? 'Request to Join' : 'Join Club'}
                    </button>
                  )}
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
                Select any club row to view its members and ownership.
              </p>
            </div>
            <div className="w-full sm:w-64">
              <StyledInput
                type="text"
                icon={<Search className="w-3.5 h-3.5" />}
                value={clubDirectorySearch}
                onChange={(e) => setClubDirectorySearch(e.target.value)}
                placeholder="Search clubs or owners..."
                aria-label="Search clubs or owners"
                className="h-9 text-xs"
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
                      <ClubVisibilityBadge club={c} />
                      {c.excludeOwnerFromBilling && (
                        <span className="text-[11px] font-semibold text-emerald-700">
                          · Owner Exempt
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 truncate mt-0.5">
                      Owner: {c.clubOwnerName || 'Club owner'}
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
                    <ClubVisibilityBadge club={rosterModalClub} />
                  </div>
                  <p className="text-xs text-slate-600 truncate mt-0.5">
                    Owner: {rosterModalClub.clubOwnerName || 'Club owner'} · Free Tap-Out &gt;
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
                          value={rosterModalClub.clubOwnerPlayerId || ''}
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
                          {!rosterModalClub.clubOwnerPlayerId && (
                            <option value="" disabled>
                              No owner assigned
                            </option>
                          )}
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

                {/* Search Club Roster */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex-1">
                    <StyledInput
                      type="text"
                      icon={<Search className="w-3.5 h-3.5" />}
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Filter club members..."
                      aria-label="Filter club members"
                      className="h-9 text-xs"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500 shrink-0">
                    {rosterModalClub.visibility === 'private'
                      ? 'Private · new members need owner approval'
                      : 'Public · anyone can join via Club Invite Link'}
                  </span>
                </div>

                {membershipActionError && (
                  <FormAlertBanner
                    variant="error"
                    message={membershipActionError}
                    onDismiss={() => setMembershipActionError(null)}
                  />
                )}

                {/* Member Roster List */}
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200/80 rounded-xl">
                  {rosterClubMembers.map((member) => {
                    const isClubOwner =
                      member.id === rosterModalClub.clubOwnerPlayerId;
                    const memberClubWallet = getPlayerClubWallet(
                      member,
                      rosterModalClub.id,
                      walletsMap
                    );
                    const hasBenefits =
                      isOwnerOfRosterModalClub &&
                      (Boolean(memberClubWallet.waiveAllFees) ||
                        memberClubWallet.freeSessionPasses > 0 ||
                        memberClubWallet.creditBalance > 0);

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
                                {memberClubWallet.waiveAllFees
                                  ? 'VIP Waived'
                                  : [
                                      memberClubWallet.freeSessionPasses > 0
                                        ? `${memberClubWallet.freeSessionPasses} Pass`
                                        : '',
                                      memberClubWallet.creditBalance > 0
                                        ? `$${memberClubWallet.creditBalance.toFixed(0)} Credit`
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

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isOwnerOfRosterModalClub && onUpdatePlayerWallet && (
                            <button
                              type="button"
                              onClick={() =>
                                openWalletModal(member, rosterModalClub.id)
                              }
                              className="h-8 px-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 transition-colors shrink-0 cursor-pointer shadow-2xs"
                            >
                              <Gift className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Passes &amp; Credit</span>
                            </button>
                          )}

                          {canManageRosterModalClub &&
                            !isClubOwner &&
                            onRemoveMemberFromClub && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMembershipActionError(null);
                                  setPendingRemoveMember({
                                    player: member,
                                    club: rosterModalClub,
                                  });
                                }}
                                className="h-8 px-2.5 rounded-xl bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-rose-700 text-xs font-semibold inline-flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
                                title={`Remove ${member.name} from ${rosterModalClub.name}`}
                              >
                                <UserMinus className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Remove</span>
                              </button>
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
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

                  {onLeaveClub &&
                    hasPlayerJoinedClub(activePlayer, rosterModalClub.id) &&
                    rosterModalClub.clubOwnerPlayerId !== activePlayer.id &&
                    (() => {
                      const clubDebtAmount = activePlayerDebts
                        .filter(
                          (d) =>
                            d.rsvp.clubId === rosterModalClub.id &&
                            (d.rsvp.paidStatus === 'unpaid' ||
                              d.rsvp.paidStatus === 'pending_approval')
                        )
                        .reduce((acc, d) => acc + d.rsvp.feeShare, 0);
                      return (
                        <button
                          type="button"
                          disabled={clubDebtAmount > 0}
                          title={
                            clubDebtAmount > 0
                              ? `Settle $${clubDebtAmount.toFixed(2)} in unpaid fees before leaving this club`
                              : `Leave ${rosterModalClub.name}`
                          }
                          onClick={() => {
                            setMembershipActionError(null);
                            setPendingLeaveClub(rosterModalClub);
                          }}
                          className="h-8 px-3 rounded-xl border border-slate-300 bg-white hover:bg-rose-50 hover:border-rose-200 text-rose-700 disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>
                            {clubDebtAmount > 0
                              ? `Leave Club ($${clubDebtAmount.toFixed(2)} due)`
                              : 'Leave Club'}
                          </span>
                        </button>
                      );
                    })()}
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
                noValidate
                onSubmit={handleSaveClubSettingsSubmit}
                className="p-5 overflow-y-auto flex-1 space-y-5"
              >
                {clubConfigTab === 'policy' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <StyledInput
                        label="Club Name"
                        type="text"
                        value={clubName}
                        error={clubSettingsErrors.clubName}
                        onChange={(e) => {
                          setClubName(e.target.value);
                          if (clubSettingsErrors.clubName)
                            setClubSettingsErrors((prev) => ({
                              ...prev,
                              clubName: undefined,
                            }));
                        }}
                      />
                      <StyledInput
                        label="Schedule & Venue Description"
                        type="text"
                        value={clubDesc}
                        onChange={(e) => setClubDesc(e.target.value)}
                      />
                    </div>

                    {/* Club Visibility Card */}
                    <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 space-y-2.5">
                      <div className="flex items-center gap-2">
                        {clubVisibility === 'private' ? (
                          <Lock className="w-4 h-4 text-amber-700 shrink-0" />
                        ) : (
                          <Globe className="w-4 h-4 text-emerald-700 shrink-0" />
                        )}
                        <h4 className="text-xs font-bold text-slate-900">
                          Club Visibility
                        </h4>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {clubVisibility === 'private'
                          ? 'Private: players can only request to join. You approve or decline each request from the Clubs page.'
                          : 'Public: anyone can join instantly from the Clubs page or an invite link.'}
                      </p>
                      <SegmentedControl
                        size="sm"
                        value={clubVisibility}
                        onChange={setClubVisibility}
                        options={VISIBILITY_OPTIONS}
                      />
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
                            className="w-4 h-4 rounded border-slate-300 accent-emerald-600 cursor-pointer focus:ring-emerald-500 transition-colors"
                          />
                          <span className="text-xs font-bold text-slate-900">
                            {excludeOwnerFromBilling
                              ? 'Owner Excluded ($0)'
                              : 'Owner Included'}
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* Match Scoring & Target Points Rule Card */}
                    <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Swords className="w-4 h-4 text-emerald-700 shrink-0" />
                            <h4 className="text-xs font-bold text-slate-900">
                              Match Scoring &amp; Default Target Points
                            </h4>
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">
                            Set the default winning score pre-filled in the Match Logger (e.g. 11, 15, 21, or 30 pts). Matches played to fewer than 21 points or time-capped games with any score can always be logged.
                          </p>
                        </div>

                        <div className="w-full sm:w-32 shrink-0">
                          <StyledInput
                            label="Target (pts)"
                            type="number"
                            min={1}
                            max={100}
                            value={defaultMatchTargetPoints}
                            error={clubSettingsErrors.defaultMatchTargetPoints}
                            onChange={(e) => {
                              setDefaultMatchTargetPoints(Number(e.target.value));
                              if (clubSettingsErrors.defaultMatchTargetPoints) {
                                setClubSettingsErrors((prev) => ({
                                  ...prev,
                                  defaultMatchTargetPoints: undefined,
                                }));
                              }
                            }}
                            className="font-mono tabular-nums"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-500 mr-1">
                          Quick Presets:
                        </span>
                        {[11, 15, 21, 30].map((pts) => {
                          const isSelected = Number(defaultMatchTargetPoints) === pts;
                          return (
                            <button
                              key={pts}
                              type="button"
                              onClick={() => {
                                setDefaultMatchTargetPoints(pts);
                                if (clubSettingsErrors.defaultMatchTargetPoints) {
                                  setClubSettingsErrors((prev) => ({
                                    ...prev,
                                    defaultMatchTargetPoints: undefined,
                                  }));
                                }
                              }}
                              className={`h-7 px-2.5 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-emerald-600 text-white shadow-2xs'
                                  : 'bg-white hover:bg-slate-100 border border-slate-200 text-slate-700'
                              }`}
                            >
                              {pts} pts{pts === 21 ? ' (Std)' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Tap-Out Cutoffs */}
                    <div className="space-y-2.5 pt-2 border-t border-slate-100">
                      <div>
                        <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <Sliders className="w-3.5 h-3.5 text-slate-500" />
                          <span>Tap-Out Cutoffs &amp; Penalty Weights</span>
                        </h4>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Members can always leave an uncompleted session; withdrawing within the free-cancel window applies the Late Fee (%) weight instead of a full No-Show Fee (%).
                        </p>
                      </div>
                      <StyledSelect
                        label="Club Timezone"
                        value={clubTimezone}
                        helperText="Cancel deadlines use this timezone for everyone"
                        onChange={(e) => setClubTimezone(e.target.value)}
                      >
                        {(COMMON_CLUB_TIMEZONES.includes(clubTimezone)
                          ? COMMON_CLUB_TIMEZONES
                          : [clubTimezone, ...COMMON_CLUB_TIMEZONES]
                        ).map((zone) => (
                          <option key={zone} value={zone}>
                            {zone.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </StyledSelect>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <StyledInput
                          label="Free Cancel Window (hrs)"
                          type="number"
                          min={0}
                          max={168}
                          value={freeCancelHours}
                          error={clubSettingsErrors.freeCancelHours}
                          onChange={(e) => {
                            setFreeCancelHours(Number(e.target.value));
                            if (clubSettingsErrors.freeCancelHours)
                              setClubSettingsErrors((prev) => ({
                                ...prev,
                                freeCancelHours: undefined,
                              }));
                          }}
                          className="font-mono"
                        />
                        <StyledInput
                          label="Late Cancel Fee (%)"
                          type="number"
                          min={0}
                          max={100}
                          value={lateCancelPct}
                          error={clubSettingsErrors.lateCancelPct}
                          onChange={(e) => {
                            setLateCancelPct(Number(e.target.value));
                            if (clubSettingsErrors.lateCancelPct)
                              setClubSettingsErrors((prev) => ({
                                ...prev,
                                lateCancelPct: undefined,
                              }));
                          }}
                          className="font-mono"
                        />
                        <StyledInput
                          label="No-Show Fee (%)"
                          type="number"
                          min={0}
                          max={100}
                          value={noShowPct}
                          error={clubSettingsErrors.noShowPct}
                          onChange={(e) => {
                            setNoShowPct(Number(e.target.value));
                            if (clubSettingsErrors.noShowPct)
                              setClubSettingsErrors((prev) => ({
                                ...prev,
                                noShowPct: undefined,
                              }));
                          }}
                          className="font-mono"
                        />
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

                    <FormAlertBanner
                      variant="error"
                      message={clubSettingsErrors.payment}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <StyledInput
                        label="Recipient Name (PayNow / Bank)"
                        type="text"
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                        placeholder="e.g., Alex Tan"
                      />
                      <StyledInput
                        label="PayNow Phone Number"
                        type="text"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+65 9123 4567"
                        className="font-mono"
                      />
                      <StyledInput
                        label="Bank Name"
                        type="text"
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        placeholder="DBS Bank / OCBC / UOB"
                      />
                      <StyledInput
                        label="Bank Account Number"
                        type="text"
                        value={bankAccountNumber}
                        onChange={(e) => setBankAccountNumber(e.target.value)}
                        placeholder="018-902341-2"
                        className="font-mono"
                      />
                      <StyledInput
                        containerClassName="sm:col-span-2"
                        label="Transfer Reference Instructions"
                        type="text"
                        value={paymentNotes}
                        onChange={(e) => setPaymentNotes(e.target.value)}
                        placeholder="Include your name & session date in transfer reference"
                      />
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
                          aria-label="Direct Club Invite URL"
                          className="flex-1 h-10 bg-slate-50 border border-slate-300 hover:border-slate-400 rounded-xl px-3.5 text-xs font-mono text-slate-700 shadow-2xs transition-all focus:outline-none focus:border-emerald-600 focus:ring-3 focus:ring-emerald-500/15 select-all"
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

              <form
                noValidate
                onSubmit={handleCreateClubSubmit}
                className="space-y-4"
              >
                <StyledInput
                  label="Club Name"
                  type="text"
                  value={newClubName}
                  error={newClubNameError}
                  onChange={(e) => {
                    setNewClubName(e.target.value);
                    if (newClubNameError) setNewClubNameError(undefined);
                  }}
                  placeholder="e.g., East Coast Shuttle Club"
                />

                <StyledInput
                  label="Schedule & Venue Description"
                  type="text"
                  value={newClubDesc}
                  onChange={(e) => setNewClubDesc(e.target.value)}
                />

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Club Visibility
                  </label>
                  <SegmentedControl
                    size="sm"
                    value={newClubVisibility}
                    onChange={setNewClubVisibility}
                    options={VISIBILITY_OPTIONS}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    {newClubVisibility === 'private'
                      ? 'Players request to join; you approve each request.'
                      : 'Anyone can join without approval.'}
                  </p>
                </div>

                {isSiteAdmin && (
                  <StyledSelect
                    label="Assign Club Owner (1 Club per Owner)"
                    value={newClubOwnerId}
                    onChange={(e) => {
                      setNewClubOwnerId(e.target.value);
                      setNewClubOwnerError(undefined);
                    }}
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
                )}
                <FormAlertBanner variant="error" message={newClubOwnerError} />

                <FormAlertBanner variant="error" message={newClubPayError} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <StyledInput
                    label="PayNow Recipient"
                    type="text"
                    value={newClubRecipient}
                    onChange={(e) => setNewClubRecipient(e.target.value)}
                  />
                  <StyledInput
                    label="PayNow Mobile"
                    type="text"
                    value={newClubPhone}
                    onChange={(e) => setNewClubPhone(e.target.value)}
                    className="font-mono"
                  />
                  <StyledInput
                    label="Bank Name"
                    type="text"
                    value={newClubBankName}
                    onChange={(e) => setNewClubBankName(e.target.value)}
                  />
                  <StyledInput
                    label="Account No."
                    type="text"
                    value={newClubBankAcct}
                    onChange={(e) => setNewClubBankAcct(e.target.value)}
                    className="font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <StyledInput
                    label="Free > hrs"
                    type="number"
                    value={newFreeHours}
                    onChange={(e) => setNewFreeHours(Number(e.target.value))}
                    className="font-mono"
                  />
                  <StyledInput
                    label="Lock < hrs"
                    type="number"
                    value={newLockHours}
                    onChange={(e) => setNewLockHours(Number(e.target.value))}
                    className="font-mono"
                  />
                  <StyledInput
                    label="Late Fee %"
                    type="number"
                    value={newLatePct}
                    onChange={(e) => setNewLatePct(Number(e.target.value))}
                    className="font-mono"
                  />
                  <StyledInput
                    label="No-Show %"
                    type="number"
                    value={newNoShowPct}
                    onChange={(e) => setNewNoShowPct(Number(e.target.value))}
                    className="font-mono"
                  />
                </div>

                <StyledSelect
                  label="Club Timezone"
                  value={newClubTimezone}
                  helperText="Cancel deadlines use this timezone for everyone"
                  onChange={(e) => setNewClubTimezone(e.target.value)}
                >
                  {COMMON_CLUB_TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replace(/_/g, ' ')}
                    </option>
                  ))}
                </StyledSelect>

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
                    {rosterModalClub?.name || activeClub.name} · Passes &amp;
                    Credit Wallet
                  </h3>
                  <p className="text-xs text-slate-500">
                    {walletModalPlayer.name} ({walletModalPlayer.playerTag}) ·
                    Applies only to {rosterModalClub?.name || activeClub.name}
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

              <form
                noValidate
                onSubmit={handleSaveWalletModal}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-3">
                  <StyledInput
                    label="Credit Balance ($)"
                    type="number"
                    step="0.5"
                    min="0"
                    value={walletCreditInput}
                    error={walletErrors.credit}
                    onChange={(e) => {
                      setWalletCreditInput(Number(e.target.value));
                      if (walletErrors.credit)
                        setWalletErrors((prev) => ({
                          ...prev,
                          credit: undefined,
                        }));
                    }}
                    className="font-mono"
                  />
                  <StyledInput
                    label="Free Session Passes"
                    type="number"
                    min="0"
                    step="1"
                    value={walletPassesInput}
                    error={walletErrors.passes}
                    onChange={(e) => {
                      setWalletPassesInput(Number(e.target.value));
                      if (walletErrors.passes)
                        setWalletErrors((prev) => ({
                          ...prev,
                          passes: undefined,
                        }));
                    }}
                    className="font-mono"
                  />
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
                    className="w-4 h-4 rounded border-slate-300 accent-emerald-600 cursor-pointer transition-colors"
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

      {/* Confirmation Modal: Leave Club */}
      {onLeaveClub && (
        <ConfirmModal
          open={Boolean(pendingLeaveClub)}
          title={
            pendingLeaveClub ? `Leave ${pendingLeaveClub.name}?` : 'Leave Club?'
          }
          description={
            pendingLeaveClub ? (
              <div className="space-y-1.5">
                <p>
                  Are you sure you want to leave{' '}
                  <strong className="font-semibold text-slate-900">
                    {pendingLeaveClub.name}
                  </strong>
                  ?
                </p>
                <p className="text-slate-600">
                  Your upcoming session RSVPs in this club will be withdrawn. You can rejoin later if it is public or request to join again if private.
                </p>
              </div>
            ) : null
          }
          confirmLabel="Confirm Leave Club"
          variant="danger"
          onCancel={() => setPendingLeaveClub(null)}
          onConfirm={async () => {
            if (!pendingLeaveClub) return;
            const target = pendingLeaveClub;
            setPendingLeaveClub(null);
            setRosterModalClubId(null);
            try {
              await onLeaveClub(target.id);
            } catch (err) {
              setMembershipActionError(
                err instanceof Error ? err.message : 'Unable to leave club.'
              );
            }
          }}
        />
      )}

      {/* Confirmation Modal: Remove Member from Club */}
      {onRemoveMemberFromClub && (
        <ConfirmModal
          open={Boolean(pendingRemoveMember)}
          title="Remove Member from Club?"
          description={
            pendingRemoveMember ? (
              <div className="space-y-1.5">
                <p>
                  Remove{' '}
                  <strong className="font-semibold text-slate-900">
                    {pendingRemoveMember.player.name}
                  </strong>{' '}
                  from{' '}
                  <strong className="font-semibold text-slate-900">
                    {pendingRemoveMember.club.name}
                  </strong>
                  ?
                </p>
                <p className="text-slate-600">
                  Any upcoming session RSVPs for this member in {pendingRemoveMember.club.name} will be withdrawn.
                </p>
              </div>
            ) : null
          }
          confirmLabel="Remove Member"
          variant="danger"
          onCancel={() => setPendingRemoveMember(null)}
          onConfirm={async () => {
            if (!pendingRemoveMember) return;
            const target = pendingRemoveMember;
            setPendingRemoveMember(null);
            try {
              await onRemoveMemberFromClub(target.player.id, target.club.id);
            } catch (err) {
              setMembershipActionError(
                err instanceof Error
                  ? err.message
                  : 'Unable to remove member from club.'
              );
            }
          }}
        />
      )}
    </div>
  );
};
