import React, { useEffect, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
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

  // Quick Add Member State
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
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Badminton Clubs &amp; Policies
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isSiteAdmin
              ? 'Create clubs, configure payment phone/bank details, and assign club owners.'
              : isClubOwnerTier
              ? 'Manage your club policy, payment method details, and roster.'
              : 'Switch your active club workspace, review court policies, or invite players.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyClubInvite}
            className="h-9 px-3.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
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
              className={`h-9 px-3.5 text-xs font-semibold rounded-lg border inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                showPolicyEditor
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span>{showPolicyEditor ? 'Close Settings' : 'Club Settings'}</span>
            </button>
          )}

          {canCreateClub ? (
            <button
              type="button"
              onClick={() => {
                setShowNewClubForm(!showNewClubForm);
                setShowPolicyEditor(false);
              }}
              className="h-9 px-3.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>{showNewClubForm ? 'Close Form' : 'Create Club'}</span>
            </button>
          ) : isClubOwnerTier && clubOwnerReachedLimit ? (
            <span
              title="One Club Owner can only create one club"
              className="h-9 px-3 text-xs font-semibold text-slate-400 bg-slate-100 border border-slate-200/70 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 select-none"
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
              className="h-9 px-4 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-9 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center whitespace-nowrap shrink-0 cursor-pointer"
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
            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
              <button
                type="button"
                onClick={() => onTriggerClubJoinPromptPreview(activeClub.id)}
                className="h-8 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                <span>Preview Invite</span>
              </button>

              {isSiteAdmin && clubs.length > 1 && onDeleteClub && (
                <button
                  type="button"
                  onClick={() => onDeleteClub(activeClub.id)}
                  className="h-8 px-3 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
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

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {savedBanner ? (
              <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Saved policy &amp; payment details
              </span>
            ) : (
              <span className="text-xs text-slate-400 font-mono tabular-nums">
                Free &gt;{freeCancelHours || 0}h · {lateCancelFeePercent || 0}% fee &lt;{freeCancelHours || 0}h · Lock &lt;{lockCancelHours || 0}h · No-show {noShowFeePercent || 0}%
              </span>
            )}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowPolicyEditor(false)}
                className="h-9 px-4 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center whitespace-nowrap shrink-0 cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                className="h-9 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
                      <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        Active
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-slate-400 hover:text-slate-900 whitespace-nowrap shrink-0">
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
                      <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                      <span>{clubPay.phoneNumber}</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
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
                  className="h-9 px-3.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5 shrink-0" />
                  <span>Join</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active Club Roster */}
      <section
        aria-label="Club Roster"
        className="bg-white rounded-xl border border-slate-200/80 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-400 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900">
              {activeClub.name} Roster ({clubMembers.length})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canManageActiveClub && onOpenUsersDirectory && (
              <button
                type="button"
                onClick={onOpenUsersDirectory}
                className="h-8 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>Manage Member Balances &amp; Perks →</span>
              </button>
            )}

            {canManageActiveClub && onAdminAddMemberToClub && (
              <button
                type="button"
                onClick={() => setShowAddMember(!showAddMember)}
                className="h-8 px-3 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{showAddMember ? 'Close' : 'Add Member'}</span>
              </button>
            )}
          </div>
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
              className="h-10 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center whitespace-nowrap shrink-0 cursor-pointer"
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
                <th className="py-2.5 px-5">Active Perks</th>
                <th className="py-2.5 px-5 text-right">W–L Record</th>
                <th className="py-2.5 px-5 text-right">Games</th>
                <th className="py-2.5 px-5 text-right">Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {clubMembers.map((m) => {
                const isSelf = m.id === activePlayer?.id;
                const isOwner = m.id === activeClub.clubOwnerPlayerId;
                const creditBal = Math.max(0, Number(m.creditBalance || 0));
                const freePasses = Math.max(
                  0,
                  Math.floor(Number(m.freeSessionPasses || 0))
                );
                const isWaived = Boolean(m.waiveAllFees);

                return (
                  <tr key={m.id} className="hover:bg-slate-50/60">
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
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200 text-[10px] font-semibold whitespace-nowrap">
                            <Sparkles className="w-2.5 h-2.5 shrink-0" />
                            All Fees Waived
                          </span>
                        )}
                        {freePasses > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-semibold whitespace-nowrap">
                            <Ticket className="w-2.5 h-2.5 shrink-0" />
                            {freePasses} Free{' '}
                            {freePasses === 1 ? 'Session' : 'Sessions'}
                          </span>
                        )}
                        {creditBal > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200 text-[10px] font-semibold tabular-nums whitespace-nowrap">
                            ${creditBal.toFixed(2)} Credit
                          </span>
                        )}
                        {!isWaived && freePasses === 0 && creditBal === 0 && (
                          <span className="text-[11px] text-slate-400">
                            Standard
                          </span>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Roster Stack (< md) */}
        <div className="md:hidden divide-y divide-slate-100">
          {clubMembers.map((m) => {
            const isSelf = m.id === activePlayer?.id;
            const isOwner = m.id === activeClub.clubOwnerPlayerId;
            return (
              <div
                key={m.id}
                className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-900 truncate">
                      {m.name}
                    </span>
                    <span className="font-mono text-slate-400 shrink-0">
                      {m.playerTag}
                    </span>
                    {isSelf && (
                      <span className="text-[11px] font-medium text-emerald-700 shrink-0">
                        · You
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span>{isOwner ? 'Club Owner' : 'Member'}</span>
                    {m.waiveAllFees && (
                      <span className="text-[10px] font-semibold text-purple-700">
                        · VIP Waived
                      </span>
                    )}
                    {!m.waiveAllFees && (m.freeSessionPasses || 0) > 0 && (
                      <span className="text-[10px] font-semibold text-emerald-700">
                        · {m.freeSessionPasses} Free Pass
                      </span>
                    )}
                    {!m.waiveAllFees && (m.creditBalance || 0) > 0 && (
                      <span className="text-[10px] font-mono font-semibold text-sky-700">
                        · ${(m.creditBalance || 0).toFixed(2)} Credit
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right font-mono tabular-nums shrink-0">
                  <span className="font-semibold text-slate-900 block">
                    {m.ratingScore} pts
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {m.wins}W–{m.losses}L ({m.gamesPlayed}G)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
