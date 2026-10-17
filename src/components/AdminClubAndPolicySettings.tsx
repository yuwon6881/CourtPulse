import React, { useEffect, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Gift,
  Lock,
  Phone,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  Trash2,
  UserPlus,
  Users,
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
  parseClubPaymentDetails,
} from '../utils/badmintonLogic';
import { StyledInput, StyledSelect } from './ui/FormControls';

interface AdminClubAndPolicySettingsProps {
  clubs: Club[];
  userJoinedClubs: Club[];
  unjoinedClubs: Club[];
  activeClub: Club;
  players: Player[];
  sessions: Session[];
  activePlayer: Player | null;
  permissionTier: PermissionTier;
  canManageActiveClub: boolean;
  onSelectClub: (clubId: string) => void;
  onJoinClub: (clubId: string) => Promise<void>;
  onAdminAddMemberToClub?: (name: string) => Promise<void>;
  onAssignClubOwner?: (clubId: string, ownerPlayerId: string) => void;
  onDeleteClub?: (clubId: string) => Promise<void>;
  onUpdateClubSettings: (
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
    }
  ) => Promise<void>;
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
  onTriggerClubJoinPromptPreview: (clubId: string) => void;
  onOpenUsersDirectory?: () => void;
  onUpdatePlayerWallet?: (
    playerId: string,
    updates: Partial<PlayerBenefitWallet>
  ) => void;
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
  onUpdateClubSettings,
  onCreateNewClub,
  onTriggerClubJoinPromptPreview,
  onOpenUsersDirectory,
  onUpdatePlayerWallet,
}) => {
  const isSiteAdmin = permissionTier === 'admin';
  const isClubOwnerTier = permissionTier === 'club_owner';

  const ownedByCurrentPlayer = clubs.filter(
    (c) => activePlayer && c.clubOwnerPlayerId === activePlayer.id
  );
  const clubOwnerReachedLimit =
    isClubOwnerTier && ownedByCurrentPlayer.length >= 1;
  const canCreateClub =
    isSiteAdmin || (isClubOwnerTier && !clubOwnerReachedLimit);

  const initialPaymentDetails =
    activeClub.paymentDetails ||
    parseClubPaymentDetails(
      activeClub.paymentInfo,
      activeClub.clubOwnerName || 'Alex Tan'
    );

  const [name, setName] = useState(activeClub.name);
  const [description, setDescription] = useState(activeClub.description);
  const [payRecipient, setPayRecipient] = useState(
    initialPaymentDetails.recipientName
  );
  const [payPhone, setPayPhone] = useState(initialPaymentDetails.phoneNumber);
  const [payBankName, setPayBankName] = useState(
    initialPaymentDetails.bankName
  );
  const [payBankAccount, setPayBankAccount] = useState(
    initialPaymentDetails.bankAccountNumber
  );
  const [payNotes, setPayNotes] = useState(initialPaymentDetails.paymentNotes);
  const [freeCancelHours, setFreeCancelHours] = useState(
    String(activeClub.freeCancelHours)
  );
  const [lockCancelHours, setLockCancelHours] = useState(
    String(activeClub.lockCancelHours)
  );
  const [lateCancelFeePercent, setLateCancelFeePercent] = useState(
    String(activeClub.lateCancelFeePercent)
  );
  const [noShowFeePercent, setNoShowFeePercent] = useState(
    String(activeClub.noShowFeePercent)
  );
  const [savedBanner, setSavedBanner] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Member Credit / Pass / Waiver inline editor in Club Roster
  const [editingRosterWalletPlayerId, setEditingRosterWalletPlayerId] = useState<string | null>(null);
  const [rosterTopUpInput, setRosterTopUpInput] = useState<string>('20');
  const [rosterWalletSavedNotice, setRosterWalletSavedNotice] = useState<string | null>(null);
  const [showPolicyEditor, setShowPolicyEditor] = useState(false);

  // Create Club Form State
  const [showNewClubForm, setShowNewClubForm] = useState(false);
  const [newClubName, setNewClubName] = useState('');
  const [newClubDesc, setNewClubDesc] = useState('');
  const [newPayPhone, setNewPayPhone] = useState('+65 9123 4567');
  const [newPayBankName, setNewPayBankName] = useState('DBS Bank');
  const [newPayBankAccount, setNewPayBankAccount] = useState('018-902341-2');
  const [newPayNotes, setNewPayNotes] = useState(
    'Include player name & session date in reference'
  );
  const [newFreeHours, setNewFreeHours] = useState('24');
  const [newLockHours, setNewLockHours] = useState('4');
  const [newLatePct, setNewLatePct] = useState('50');
  const [newNoShowPct, setNewNoShowPct] = useState('100');
  const [newClubOwnerId, setNewClubOwnerId] = useState(
    activePlayer?.id || players[0]?.id || ''
  );
  const [createClubError, setCreateClubError] = useState<string | null>(null);

  // Quick Add Member State (Name only — Style and Hand removed)
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');

  useEffect(() => {
    const details =
      activeClub.paymentDetails ||
      parseClubPaymentDetails(
        activeClub.paymentInfo,
        activeClub.clubOwnerName || 'Alex Tan'
      );
    setName(activeClub.name);
    setDescription(activeClub.description);
    setPayRecipient(details.recipientName);
    setPayPhone(details.phoneNumber);
    setPayBankName(details.bankName);
    setPayBankAccount(details.bankAccountNumber);
    setPayNotes(details.paymentNotes);
    setFreeCancelHours(String(activeClub.freeCancelHours));
    setLockCancelHours(String(activeClub.lockCancelHours));
    setLateCancelFeePercent(String(activeClub.lateCancelFeePercent));
    setNoShowFeePercent(String(activeClub.noShowFeePercent));
  }, [activeClub]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageActiveClub) return;
    const freeHrs = Math.max(0, Math.min(720, parseFloat(freeCancelHours) || 0));
    const lockHrs = Math.max(
      0,
      Math.min(freeHrs, parseFloat(lockCancelHours) || 0)
    );
    const latePct = Math.max(
      0,
      Math.min(100, parseFloat(lateCancelFeePercent) || 0)
    );
    const noShowPct = Math.max(
      0,
      Math.min(100, parseFloat(noShowFeePercent) || 0)
    );

    const paymentDetails: ClubPaymentDetails = {
      recipientName:
        payRecipient.trim() || activeClub.clubOwnerName || 'Alex Tan',
      phoneNumber: payPhone.trim() || '+65 9123 4567',
      bankName: payBankName.trim() || 'DBS Bank',
      bankAccountNumber: payBankAccount.trim() || '018-902341-2',
      paymentNotes:
        payNotes.trim() ||
        'Include player name & session date in transfer reference',
    };

    const formattedPaymentInfo = formatClubPaymentInfo(paymentDetails);

    await onUpdateClubSettings(activeClub.id, {
      name: name.trim() || activeClub.name,
      description: description.trim() || activeClub.description,
      paymentInfo: formattedPaymentInfo,
      paymentDetails,
      freeCancelHours: freeHrs,
      lockCancelHours: lockHrs,
      lateCancelFeePercent: latePct,
      noShowFeePercent: noShowPct,
    });
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 2000);
  };

  const handleCreateClubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateClubError(null);
    if (!canCreateClub) {
      setCreateClubError('A Club Owner can only create one club.');
      return;
    }
    if (!newClubName.trim()) return;

    const targetOwnerId = isSiteAdmin
      ? newClubOwnerId || activePlayer?.id
      : activePlayer?.id;

    if (
      targetOwnerId &&
      clubs.some((c) => c.clubOwnerPlayerId === targetOwnerId) &&
      !isSiteAdmin
    ) {
      setCreateClubError('You already own a club (limit 1 per Club Owner).');
      return;
    }

    const ownerPlayer = players.find((p) => p.id === targetOwnerId);
    const recipientName =
      ownerPlayer?.name || activePlayer?.name || 'Alex Tan';

    const paymentDetails: ClubPaymentDetails = {
      recipientName,
      phoneNumber: newPayPhone.trim() || '+65 9123 4567',
      bankName: newPayBankName.trim() || 'DBS Bank',
      bankAccountNumber: newPayBankAccount.trim() || '018-902341-2',
      paymentNotes:
        newPayNotes.trim() || 'Include player name & session date in reference',
    };

    const freeHrs = Math.max(0, Math.min(720, parseFloat(newFreeHours) || 24));
    const lockHrs = Math.max(
      0,
      Math.min(freeHrs, parseFloat(newLockHours) || 4)
    );
    const latePct = Math.max(0, Math.min(100, parseFloat(newLatePct) || 50));
    const noShowPct = Math.max(
      0,
      Math.min(100, parseFloat(newNoShowPct) || 100)
    );

    const created = await onCreateNewClub({
      name: newClubName.trim(),
      description:
        newClubDesc.trim() || 'Weekly court rotations and standings.',
      paymentInfo: formatClubPaymentInfo(paymentDetails),
      paymentDetails,
      freeCancelHours: freeHrs,
      lockCancelHours: lockHrs,
      lateCancelFeePercent: latePct,
      noShowFeePercent: noShowPct,
      ownerPlayerId: targetOwnerId,
    });
    if (created) {
      setNewClubName('');
      setNewClubDesc('');
      setShowNewClubForm(false);
      onSelectClub(created.id);
    }
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !canManageActiveClub ||
      !newMemberName.trim() ||
      !onAdminAddMemberToClub
    )
      return;
    await onAdminAddMemberToClub(newMemberName.trim());
    setNewMemberName('');
    setShowAddMember(false);
  };

  const clubInviteUrl = buildShareableClubAndSessionUrl(activeClub.id);

  const handleCopyClubInvite = async () => {
    try {
      await navigator.clipboard.writeText(clubInviteUrl);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 1800);
    } catch {
      // ignore
    }
  };

  const clubMembers = players.filter((p) =>
    hasPlayerJoinedClub(p, activeClub.id)
  );

  return (
    <div className="space-y-8">
      {/* Page Header & Unified Admin Hub Switcher */}
      <div className="flex flex-col gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Badminton Clubs
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {isSiteAdmin
                ? 'Site Admin: Create clubs, configure payment phone/bank details, and assign club owners.'
                : isClubOwnerTier
                ? 'Club Owner: Manage your club policy, payment method details, and roster.'
                : 'Switch your active club workspace, review court policies, or invite players.'}
            </p>
          </div>

          {/* Site Admin Unified Hub Switcher (Clubs & Policies <-> Platform Users) */}
          {isSiteAdmin && onOpenUsersDirectory && (
            <div className="self-start sm:self-auto">
              <div className="inline-flex items-center bg-slate-100/90 p-1 rounded-lg border border-slate-200/70">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-white text-slate-900 shadow-2xs ring-1 ring-slate-900/5 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Building2 className="w-3.5 h-3.5 text-slate-700" />
                  <span>Clubs &amp; Policies</span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500">
                    {clubs.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onOpenUsersDirectory}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md text-slate-500 hover:text-slate-900 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Platform Users</span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">
                    {players.length}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyClubInvite}
            className="h-9 w-full sm:w-36 px-3.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
          >
            {copiedInvite ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Invite Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Copy Invite</span>
              </>
            )}
          </button>

          {canManageActiveClub && (
            <button
              type="button"
              onClick={() => {
                setShowPolicyEditor(!showPolicyEditor);
                setShowNewClubForm(false);
              }}
              className={`h-9 w-full sm:w-36 px-3.5 text-xs font-semibold rounded-lg border inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                showPolicyEditor
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span>{showPolicyEditor ? 'Close Settings' : 'Club Settings'}</span>
            </button>
          )}

          {/* Create Club Button */}
          {canCreateClub ? (
            <button
              type="button"
              onClick={() => {
                setShowNewClubForm(!showNewClubForm);
                setShowPolicyEditor(false);
              }}
              className="col-span-2 sm:col-span-1 h-9 w-full sm:w-36 px-3.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>{showNewClubForm ? 'Close Form' : 'Create Club'}</span>
            </button>
          ) : isClubOwnerTier && clubOwnerReachedLimit ? (
            <span
              title="One Club Owner can only create one club"
              className="col-span-2 sm:col-span-1 h-9 w-full sm:w-36 px-3 text-xs font-semibold text-slate-400 bg-slate-100 border border-slate-200/70 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap select-none"
            >
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>1/1 Club Owned</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Create New Badminton Club Form */}
      {canCreateClub && showNewClubForm && (
        <form
          onSubmit={handleCreateClubSubmit}
          className="bg-white rounded-xl border border-slate-200/90 p-6 space-y-5"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Create Badminton Club
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure club details, payment phone/bank fields, and withdrawal rules.
              </p>
            </div>
          </div>

          <div
            className={`grid grid-cols-1 ${
              isSiteAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
            } gap-4`}
          >
            <StyledInput
              label="Club Name"
              required
              maxLength={100}
              value={newClubName}
              onChange={(e) => setNewClubName(e.target.value)}
              placeholder="e.g. East Coast Shuttle Club"
            />
            <StyledInput
              label="Description / Schedule"
              maxLength={200}
              value={newClubDesc}
              onChange={(e) => setNewClubDesc(e.target.value)}
              placeholder="e.g. Tuesday & Saturday evening doubles"
            />
            {isSiteAdmin && (
              <StyledSelect
                label="Assign Club Owner"
                hint="1 club max/owner"
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
            )}
          </div>

          {/* Payment Method Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-3 border-t border-slate-100">
            <StyledInput
              label="Payment Phone Number"
              required
              maxLength={40}
              value={newPayPhone}
              onChange={(e) => setNewPayPhone(e.target.value)}
              placeholder="e.g. +65 9123 4567"
              className="font-mono tabular-nums"
            />
            <StyledInput
              label="Bank Name"
              required
              maxLength={40}
              value={newPayBankName}
              onChange={(e) => setNewPayBankName(e.target.value)}
              placeholder="e.g. DBS Bank"
            />
            <StyledInput
              label="Bank Account Number"
              required
              maxLength={40}
              value={newPayBankAccount}
              onChange={(e) => setNewPayBankAccount(e.target.value)}
              placeholder="e.g. 018-902341-2"
              className="font-mono tabular-nums"
            />
            <StyledInput
              label="Transfer Reference Note"
              maxLength={80}
              value={newPayNotes}
              onChange={(e) => setNewPayNotes(e.target.value)}
              placeholder="e.g. Include name & date"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-slate-100">
            <StyledInput
              label="Free Cancel Window"
              type="number"
              min={0}
              max={720}
              suffixText="h"
              value={newFreeHours}
              onChange={(e) => setNewFreeHours(e.target.value)}
              className="font-mono tabular-nums"
            />
            <StyledInput
              label="Hard Lock Cutoff"
              type="number"
              min={0}
              max={720}
              suffixText="h"
              value={newLockHours}
              onChange={(e) => setNewLockHours(e.target.value)}
              className="font-mono tabular-nums"
            />
            <StyledInput
              label="Late Cancel Fee"
              type="number"
              min={0}
              max={100}
              suffixText="%"
              value={newLatePct}
              onChange={(e) => setNewLatePct(e.target.value)}
              className="font-mono tabular-nums"
            />
            <StyledInput
              label="No-Show Fee"
              type="number"
              min={0}
              max={100}
              suffixText="%"
              value={newNoShowPct}
              onChange={(e) => setNewNoShowPct(e.target.value)}
              className="font-mono tabular-nums"
            />
          </div>

          {createClubError && (
            <p className="text-xs font-medium text-amber-700">
              {createClubError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowNewClubForm(false)}
              className="h-9 w-28 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-9 w-36 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center"
            >
              Create Club
            </button>
          </div>
        </form>
      )}

      {/* Edit Active Club Policy & Payment Method Drawer */}
      {canManageActiveClub && showPolicyEditor && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white rounded-xl border border-slate-200/90 p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Club Policy &amp; Payment Methods — {activeClub.name}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Club Owner: {activeClub.clubOwnerName || 'Alex Tan'} · Configure phone number, bank account fields, and withdrawal rules.
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => onTriggerClubJoinPromptPreview(activeClub.id)}
                className="h-8 w-36 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                <span>Preview Invite</span>
              </button>

              {isSiteAdmin && clubs.length > 1 && onDeleteClub && (
                <button
                  type="button"
                  onClick={() => onDeleteClub(activeClub.id)}
                  className="h-8 w-32 px-3 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg inline-flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Delete Club</span>
                </button>
              )}
            </div>
          </div>

          <div
            className={`grid grid-cols-1 ${
              isSiteAdmin && onAssignClubOwner
                ? 'sm:grid-cols-3'
                : 'sm:grid-cols-2'
            } gap-4`}
          >
            <StyledInput
              label="Club Name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <StyledInput
              label="Description"
              required
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {isSiteAdmin && onAssignClubOwner && (
              <StyledSelect
                label="Club Owner"
                hint="1 club max/owner"
                value={activeClub.clubOwnerPlayerId || 'player_alex'}
                onChange={(e) =>
                  onAssignClubOwner(activeClub.id, e.target.value)
                }
              >
                {players.map((p) => {
                  const otherOwned = clubs.find(
                    (c) =>
                      c.id !== activeClub.id && c.clubOwnerPlayerId === p.id
                  );
                  return (
                    <option
                      key={p.id}
                      value={p.id}
                      disabled={Boolean(otherOwned)}
                    >
                      {p.name}
                      {otherOwned ? ` (Owns ${otherOwned.name})` : ''}
                    </option>
                  );
                })}
              </StyledSelect>
            )}
          </div>

          {/* Dedicated Payment Method Fields (Phone Number & Bank Account) */}
          <div className="space-y-3 pt-3 border-t border-slate-100">
            <h3 className="text-xs font-bold text-slate-900">
              Payment Receiving Details (Shown to Members When Paying)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
              <StyledInput
                label="Account Holder / Recipient"
                required
                maxLength={60}
                value={payRecipient}
                onChange={(e) => setPayRecipient(e.target.value)}
                placeholder="e.g. Alex Tan"
              />
              <StyledInput
                label="Phone Number (PayNow / Mobile)"
                required
                maxLength={40}
                value={payPhone}
                onChange={(e) => setPayPhone(e.target.value)}
                placeholder="e.g. +65 9123 4567"
                className="font-mono tabular-nums"
              />
              <StyledInput
                label="Bank Name"
                required
                maxLength={40}
                value={payBankName}
                onChange={(e) => setPayBankName(e.target.value)}
                placeholder="e.g. DBS Bank"
              />
              <StyledInput
                label="Bank Account Number"
                required
                maxLength={40}
                value={payBankAccount}
                onChange={(e) => setPayBankAccount(e.target.value)}
                placeholder="e.g. 018-902341-2"
                className="font-mono tabular-nums"
              />
              <StyledInput
                label="Transfer Reference Note"
                maxLength={80}
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="e.g. Include name & date"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-slate-100">
            <StyledInput
              label="Free Cancel Window"
              hint="0% fee"
              type="number"
              min={0}
              max={720}
              suffixText="h"
              value={freeCancelHours}
              onChange={(e) => setFreeCancelHours(e.target.value)}
              className="font-mono tabular-nums"
            />
            <StyledInput
              label="Hard Lock Cutoff"
              hint="Locked"
              type="number"
              min={0}
              max={720}
              suffixText="h"
              value={lockCancelHours}
              onChange={(e) => setLockCancelHours(e.target.value)}
              className="font-mono tabular-nums"
            />
            <StyledInput
              label="Late Cancel Fee"
              hint={`<${freeCancelHours || 0}h`}
              type="number"
              min={0}
              max={100}
              step={5}
              suffixText="%"
              value={lateCancelFeePercent}
              onChange={(e) => setLateCancelFeePercent(e.target.value)}
              className="font-mono tabular-nums"
            />
            <StyledInput
              label="No-Show Penalty"
              hint="Court share"
              type="number"
              min={0}
              max={100}
              step={5}
              suffixText="%"
              value={noShowFeePercent}
              onChange={(e) => setNoShowFeePercent(e.target.value)}
              className="font-mono tabular-nums"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            {savedBanner ? (
              <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                Saved policy &amp; payment details
              </span>
            ) : (
              <span className="text-xs text-slate-400 font-mono tabular-nums">
                Free &gt;{freeCancelHours || 0}h · {lateCancelFeePercent || 0}% fee &lt;{freeCancelHours || 0}h · Lock &lt;{lockCancelHours || 0}h · No-show {noShowFeePercent || 0}%
              </span>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPolicyEditor(false)}
                className="h-9 w-28 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center"
              >
                Close
              </button>
              <button
                type="submit"
                className="h-9 w-36 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center transition-colors"
              >
                Save Policy
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Joined Clubs Directory Grid */}
      <section aria-label="Joined Clubs" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">
            {isSiteAdmin
              ? `All Platform Clubs (${clubs.length})`
              : `Your Clubs (${userJoinedClubs.length})`}
          </h2>
          <span className="text-xs text-slate-400">
            Select a club to switch workspace
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(isSiteAdmin ? clubs : userJoinedClubs).map((club) => {
            const isSelected = club.id === activeClub.id;
            const isOwnedByMe =
              activePlayer && club.clubOwnerPlayerId === activePlayer.id;
            const memberCount = players.filter((p) =>
              hasPlayerJoinedClub(p, club.id)
            ).length;
            const upcomingCount = sessions.filter(
              (s) => s.clubId === club.id && s.bookingStatus !== 'completed'
            ).length;
            const clubPay =
              club.paymentDetails ||
              parseClubPaymentDetails(
                club.paymentInfo,
                club.clubOwnerName || 'Alex Tan'
              );

            return (
              <div
                key={club.id}
                onClick={() => onSelectClub(club.id)}
                className={`bg-white rounded-xl border p-5 transition-all cursor-pointer flex flex-col justify-between gap-4 ${
                  isSelected
                    ? 'border-slate-900 ring-2 ring-slate-900/5'
                    : 'border-slate-200/80 hover:border-slate-300'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      {club.name}
                    </h3>
                    {isSelected ? (
                      <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Active
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-slate-400 hover:text-slate-900 shrink-0">
                        Switch
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">
                    {club.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-2 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-[11px] text-slate-600">
                    <span className="font-sans font-medium text-slate-800">
                      Owner: {club.clubOwnerName || 'Alex Tan'}
                      {isOwnedByMe ? ' (You)' : ''}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{memberCount} members</span>
                    <span aria-hidden="true">·</span>
                    <span>{upcomingCount} upcoming</span>
                  </div>

                  {/* Structured Payment Info Summary on Club Card */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 font-mono tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-400" />
                      <span>{clubPay.phoneNumber}</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="w-3 h-3 text-slate-400" />
                      <span>
                        {clubPay.bankName} {clubPay.bankAccountNumber}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Available Clubs to Join */}
      {unjoinedClubs.length > 0 && (
        <section aria-label="Discover Clubs" className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900">
            Available to Join ({unjoinedClubs.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {unjoinedClubs.map((club) => (
              <div
                key={club.id}
                className="bg-white rounded-xl border border-slate-200/80 p-5 flex items-center justify-between gap-4"
              >
                <div className="min-w-0 space-y-1">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    {club.name}
                  </h3>
                  <p className="text-xs text-slate-500 line-clamp-1">
                    {club.description}
                  </p>
                  <p className="text-[11px] font-mono tabular-nums text-slate-400">
                    Owner: {club.clubOwnerName || 'Chloe Lim'} · Free cancel &gt;{club.freeCancelHours}h
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onJoinClub(club.id)}
                  className="h-9 w-28 px-3.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Join</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active Club Roster (Clean — Style and Hand removed across site) */}
      <section
        aria-label="Club Roster"
        className="bg-white rounded-xl border border-slate-200/80 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-bold text-slate-900">
              {activeClub.name} Roster ({clubMembers.length})
            </h2>
          </div>

          {canManageActiveClub && onAdminAddMemberToClub && (
            <button
              type="button"
              onClick={() => setShowAddMember(!showAddMember)}
              className="h-8 w-32 px-3 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showAddMember ? 'Close' : 'Add Member'}</span>
            </button>
          )}
        </div>

        {/* Club Owner / Site Admin Quick Add Member Row */}
        {canManageActiveClub && showAddMember && (
          <form
            onSubmit={handleAddMemberSubmit}
            className="p-4 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row gap-3 items-end"
          >
            <div className="flex-1 w-full">
              <StyledInput
                label="Member Name"
                required
                maxLength={80}
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="e.g. Lucas Lim"
              />
            </div>
            <button
              type="submit"
              className="h-10 w-40 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center shrink-0"
            >
              Add to Roster
            </button>
          </form>
        )}

        {/* Desktop Roster Table (md+) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-medium text-slate-400">
                <th className="py-2.5 px-5">Member</th>
                <th className="py-2.5 px-5">Role</th>
                <th className="py-2.5 px-5">Credits, Passes & Waiver</th>
                <th className="py-2.5 px-5 text-right">W–L Record</th>
                <th className="py-2.5 px-5 text-right">Games</th>
                <th className="py-2.5 px-5 text-right">Rating</th>
                {canManageActiveClub && onUpdatePlayerWallet && (
                  <th className="py-2.5 px-5 text-right">Perks</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {clubMembers.map((m) => {
                const isSelf = m.id === activePlayer?.id;
                const isOwner = m.id === activeClub.clubOwnerPlayerId;
                const creditBal = Math.max(0, Number(m.creditBalance || 0));
                const freePasses = Math.max(0, Math.floor(Number(m.freeSessionPasses || 0)));
                const isWaived = Boolean(m.waiveAllFees);
                const isEditingWallet = editingRosterWalletPlayerId === m.id;

                return (
                  <React.Fragment key={m.id}>
                    <tr className="hover:bg-slate-50/60">
                      <td className="py-3 px-5">
                        <span className="font-semibold text-slate-900">
                          {m.name}
                        </span>
                        <span className="font-mono text-slate-400 ml-1.5">
                          {m.playerTag}
                        </span>
                        {isSelf && (
                          <span className="ml-2 text-[11px] font-medium text-emerald-700">
                            · You
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-5">
                        {isOwner ? (
                          <span className="font-semibold text-slate-900">
                            Club Owner
                          </span>
                        ) : (
                          <span className="text-slate-400">Member</span>
                        )}
                      </td>
                      <td className="py-3 px-5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isWaived && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200 text-[10px] font-semibold">
                              <Sparkles className="w-2.5 h-2.5" />
                              All Fees Waived
                            </span>
                          )}
                          {freePasses > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-semibold">
                              <Ticket className="w-2.5 h-2.5" />
                              {freePasses} Free {freePasses === 1 ? 'Session' : 'Sessions'}
                            </span>
                          )}
                          {creditBal > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200 text-[10px] font-semibold tabular-nums">
                              ${creditBal.toFixed(2)} Credit
                            </span>
                          )}
                          {!isWaived && freePasses === 0 && creditBal === 0 && (
                            <span className="text-[11px] text-slate-400">Standard</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-5 text-right font-mono tabular-nums text-slate-600">
                        {m.wins}W – {m.losses}L
                      </td>
                      <td className="py-3 px-5 text-right font-mono tabular-nums text-slate-600">
                        {m.gamesPlayed}
                      </td>
                      <td className="py-3 px-5 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {m.ratingScore}
                      </td>
                      {canManageActiveClub && onUpdatePlayerWallet && (
                        <td className="py-3 px-5 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditingWallet) {
                                setEditingRosterWalletPlayerId(null);
                              } else {
                                setEditingRosterWalletPlayerId(m.id);
                                setRosterTopUpInput('20');
                              }
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                              isEditingWallet
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <Gift className="w-3 h-3 text-emerald-600" />
                            {isEditingWallet ? 'Close' : 'Top Up / Waive'}
                          </button>
                        </td>
                      )}
                    </tr>
                    {isEditingWallet && canManageActiveClub && onUpdatePlayerWallet && (
                      <tr className="bg-slate-50/90">
                        <td colSpan={7} className="px-5 py-3.5 border-b border-slate-200/80">
                          <div className="space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                                <Gift className="w-3.5 h-3.5 text-emerald-600" />
                                Manage Credit Balance, Free Session Passes & Waiver — {m.name}
                              </span>
                              {rosterWalletSavedNotice && (
                                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                                  {rosterWalletSavedNotice}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              {/* Credit Balance */}
                              <div className="bg-white rounded-lg border border-slate-200/90 p-3 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-600 font-medium">Prepaid Club Credit</span>
                                  <span className="font-bold text-sky-700 font-mono tabular-nums">
                                    ${creditBal.toFixed(2)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {[10, 20, 50].map((amt) => (
                                    <button
                                      key={amt}
                                      type="button"
                                      onClick={() => {
                                        const next = Math.round((creditBal + amt) * 100) / 100;
                                        onUpdatePlayerWallet(m.id, { creditBalance: next });
                                        setRosterWalletSavedNotice(`Added +$${amt} credit to ${m.name}`);
                                        setTimeout(() => setRosterWalletSavedNotice(null), 2200);
                                      }}
                                      className="flex-1 py-1 rounded bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200/80 text-[11px] font-semibold"
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
                                    value={rosterTopUpInput}
                                    onChange={(e) => setRosterTopUpInput(e.target.value)}
                                    className="w-full h-7 px-2 rounded border border-slate-200 text-xs text-slate-900"
                                    placeholder="Custom $"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const parsed = Number(rosterTopUpInput);
                                      if (!Number.isFinite(parsed) || parsed <= 0) return;
                                      const next = Math.round((creditBal + parsed) * 100) / 100;
                                      onUpdatePlayerWallet(m.id, { creditBalance: next });
                                      setRosterWalletSavedNotice(`Added +$${parsed.toFixed(2)} credit`);
                                      setTimeout(() => setRosterWalletSavedNotice(null), 2200);
                                    }}
                                    className="px-2.5 h-7 rounded bg-slate-900 text-white text-[11px] font-semibold shrink-0"
                                  >
                                    Add
                                  </button>
                                  {creditBal > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => onUpdatePlayerWallet(m.id, { creditBalance: 0 })}
                                      className="px-2 h-7 rounded border border-slate-200 text-slate-500 hover:text-rose-600 text-[11px]"
                                    >
                                      Reset
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Free Session Passes */}
                              <div className="bg-white rounded-lg border border-slate-200/90 p-3 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-600 font-medium">Free Session Passes</span>
                                  <span className="font-bold text-emerald-700 font-mono tabular-nums">
                                    {freePasses} {freePasses === 1 ? 'session' : 'sessions'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUpdatePlayerWallet(m.id, {
                                        freeSessionPasses: Math.max(0, freePasses - 1),
                                      })
                                    }
                                    disabled={freePasses === 0}
                                    className="px-2.5 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 text-[11px] font-semibold"
                                  >
                                    -1
                                  </button>
                                  {[1, 3, 5].map((cnt) => (
                                    <button
                                      key={cnt}
                                      type="button"
                                      onClick={() => {
                                        onUpdatePlayerWallet(m.id, {
                                          freeSessionPasses: freePasses + cnt,
                                        });
                                        setRosterWalletSavedNotice(
                                          `Granted +${cnt} free session${cnt > 1 ? 's' : ''} to ${m.name}`
                                        );
                                        setTimeout(() => setRosterWalletSavedNotice(null), 2200);
                                      }}
                                      className="flex-1 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 text-[11px] font-semibold"
                                    >
                                      +{cnt} Free
                                    </button>
                                  ))}
                                </div>
                                <p className="text-[10px] text-slate-400 leading-tight">
                                  Automatically waives the next {freePasses || 'N'} session fee(s) when joining or finalizing attendance.
                                </p>
                              </div>

                              {/* Complete Fee Waiver */}
                              <div className="bg-white rounded-lg border border-slate-200/90 p-3 flex flex-col justify-between gap-2">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-600 font-medium">Complete Fee Waiver</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onUpdatePlayerWallet(m.id, { waiveAllFees: !isWaived });
                                      setRosterWalletSavedNotice(
                                        !isWaived
                                          ? `VIP Complete Waiver enabled for ${m.name}`
                                          : `VIP Complete Waiver turned off`
                                      );
                                      setTimeout(() => setRosterWalletSavedNotice(null), 2200);
                                    }}
                                    className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                                      isWaived
                                        ? 'bg-purple-600 text-white border-purple-600'
                                        : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                                    }`}
                                  >
                                    {isWaived ? 'Waiver Active' : 'Enable Waiver'}
                                  </button>
                                </div>
                                <p className="text-[10px] text-slate-400 leading-tight">
                                  Exempts {m.name} from all current unpaid and future session fees indefinitely.
                                </p>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Roster List (< md) */}
        <div className="md:hidden divide-y divide-slate-100 text-xs">
          {clubMembers.map((m) => {
            const isSelf = m.id === activePlayer?.id;
            const isOwner = m.id === activeClub.clubOwnerPlayerId;
            const creditBal = Math.max(0, Number(m.creditBalance || 0));
            const freePasses = Math.max(0, Math.floor(Number(m.freeSessionPasses || 0)));
            const isWaived = Boolean(m.waiveAllFees);
            const isEditingWallet = editingRosterWalletPlayerId === m.id;

            return (
              <div key={m.id} className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-900 truncate">
                        {m.name}
                      </span>
                      <span className="font-mono text-slate-400">
                        {m.playerTag}
                      </span>
                      {isSelf && (
                        <span className="text-[11px] font-semibold text-emerald-700">
                          · You
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                      <span className={isOwner ? 'font-semibold text-slate-800' : ''}>
                        {isOwner ? 'Club Owner' : 'Member'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {m.wins}W–{m.losses}L ({m.gamesPlayed}g)
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {isWaived && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200 text-[10px] font-semibold">
                          <Sparkles className="w-2.5 h-2.5" />
                          Fees Waived
                        </span>
                      )}
                      {freePasses > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-semibold">
                          <Ticket className="w-2.5 h-2.5" />
                          {freePasses} Free {freePasses === 1 ? 'Session' : 'Sessions'}
                        </span>
                      )}
                      {creditBal > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200 text-[10px] font-semibold tabular-nums">
                          ${creditBal.toFixed(2)} Credit
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="text-right font-mono tabular-nums">
                      <span className="text-sm font-bold text-slate-900 block">
                        {m.ratingScore}
                      </span>
                      <span className="text-[10px] font-sans text-slate-400">
                        Rating
                      </span>
                    </div>
                    {canManageActiveClub && onUpdatePlayerWallet && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingRosterWalletPlayerId(
                            isEditingWallet ? null : m.id
                          )
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border ${
                          isEditingWallet
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200'
                        }`}
                      >
                        <Gift className="w-2.5 h-2.5 text-emerald-600" />
                        {isEditingWallet ? 'Close' : 'Perks'}
                      </button>
                    )}
                  </div>
                </div>

                {isEditingWallet && canManageActiveClub && onUpdatePlayerWallet && (
                  <div className="pt-2.5 border-t border-slate-200/80 bg-slate-50 rounded-lg p-2.5 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-700">Club Credit (${creditBal.toFixed(2)})</span>
                      <div className="flex items-center gap-1">
                        {[10, 20, 50].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() =>
                              onUpdatePlayerWallet(m.id, {
                                creditBalance: Math.round((creditBal + amt) * 100) / 100,
                              })
                            }
                            className="px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 text-[10px] font-semibold"
                          >
                            +${amt}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-700">Free Sessions ({freePasses})</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdatePlayerWallet(m.id, {
                              freeSessionPasses: Math.max(0, freePasses - 1),
                            })
                          }
                          disabled={freePasses === 0}
                          className="px-2 py-0.5 rounded border border-slate-200 text-slate-600 text-[10px] font-semibold disabled:opacity-40"
                        >
                          -1
                        </button>
                        {[1, 3, 5].map((cnt) => (
                          <button
                            key={cnt}
                            type="button"
                            onClick={() =>
                              onUpdatePlayerWallet(m.id, {
                                freeSessionPasses: freePasses + cnt,
                              })
                            }
                            className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold"
                          >
                            +{cnt}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-700">Always Waive Fees</span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdatePlayerWallet(m.id, { waiveAllFees: !isWaived })
                        }
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          isWaived
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-white text-slate-600 border-slate-200'
                        }`}
                      >
                        {isWaived ? 'Enabled (VIP)' : 'Off'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
