import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Edit3,
  Gift,
  Phone,
  ShieldCheck,
  Sparkles,
  Ticket,
  User,
  X,
} from 'lucide-react';
import {
  AttendanceOutcome,
  BookingStatus,
  Club,
  ClubPaymentDetails,
  PermissionTier,
  Player,
  PlayerBenefitWallet,
  Session,
  SessionRsvp,
} from '../types';
import {
  computeWeightedSessionSplits,
  parseClubPaymentDetails,
} from '../utils/badmintonLogic';
import {
  SegmentedControl,
  StyledInput,
  StyledSelect,
} from './ui/FormControls';

interface FeeLedgerAndSplitViewProps {
  activeClub: Club;
  sessions: Session[];
  selectedSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  rsvps: SessionRsvp[];
  players: Player[];
  activePlayer: Player | null;
  permissionTier: PermissionTier;
  canManageClub: boolean;
  initialOpenPayInfo?: boolean;
  onConsumeInitialOpenPayInfo?: () => void;
  onUpdateClubPaymentDetails?: (
    clubId: string,
    details: ClubPaymentDetails
  ) => Promise<void>;
  onFinalizeSessionShuttleAndSplit: (
    sessionId: string,
    bookingStatus: BookingStatus,
    courtFee: number,
    shuttlesUsed: number,
    shuttleUnitCost: number,
    courtNumbers: string,
    finalizeSplit: boolean
  ) => Promise<void>;
  onMarkAttendanceOutcome: (
    rsvpId: string,
    outcome: AttendanceOutcome
  ) => Promise<void>;
  onNotifyPaymentSentForRsvp: (rsvpId: string, method: string) => Promise<void>;
  onNotifyPaymentSentAllForPlayer: (
    playerId: string,
    method: string
  ) => Promise<void>;
  onAcceptOrClearSingleRsvp: (rsvpId: string, method: string) => Promise<void>;
  onRejectPaymentForRsvp: (rsvpId: string) => Promise<void>;
  onAcceptOrClearAllForPlayer: (
    playerId: string,
    method: string
  ) => Promise<void>;
  onRejectAllForPlayer: (playerId: string) => Promise<void>;
  onUpdatePlayerWallet?: (
    playerId: string,
    wallet: PlayerBenefitWallet
  ) => Promise<void>;
}

const PAYMENT_METHODS = [
  'Phone / PayNow',
  'Bank Account Transfer',
  'Cash',
];

const UNIFORM_ACTION_BTN =
  'h-8 w-28 px-2.5 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer select-none';

export const FeeLedgerAndSplitView: React.FC<FeeLedgerAndSplitViewProps> = ({
  activeClub,
  sessions,
  selectedSessionId,
  onSelectSession,
  rsvps,
  players,
  activePlayer,
  canManageClub,
  initialOpenPayInfo = false,
  onConsumeInitialOpenPayInfo,
  onUpdateClubPaymentDetails,
  onFinalizeSessionShuttleAndSplit,
  onMarkAttendanceOutcome,
  onNotifyPaymentSentForRsvp,
  onNotifyPaymentSentAllForPlayer,
  onAcceptOrClearSingleRsvp,
  onRejectPaymentForRsvp,
  onAcceptOrClearAllForPlayer,
  onRejectAllForPlayer,
  onUpdatePlayerWallet,
}) => {
  const [localSessionId, setLocalSessionId] = useState<string>(
    selectedSessionId || sessions[0]?.id || ''
  );
  const [editingWalletPlayerId, setEditingWalletPlayerId] = useState<
    string | null
  >(null);
  const [draftCredit, setDraftCredit] = useState<string>('0');
  const [draftPasses, setDraftPasses] = useState<number>(0);
  const [draftWaiveAll, setDraftWaiveAll] = useState<boolean>(false);
  const [walletSavedBanner, setWalletSavedBanner] = useState<string | null>(
    null
  );

  const handleOpenWalletEditor = (player: Player) => {
    if (editingWalletPlayerId === player.id) {
      setEditingWalletPlayerId(null);
      return;
    }
    setEditingWalletPlayerId(player.id);
    setDraftCredit((player.creditBalance || 0).toFixed(2));
    setDraftPasses(player.freeSessionPasses || 0);
    setDraftWaiveAll(Boolean(player.waiveAllFees));
  };

  const handleSaveWalletForPlayer = async (player: Player) => {
    if (!onUpdatePlayerWallet) return;
    const cleanCredit = Math.max(0, Number(parseFloat(draftCredit || '0').toFixed(2)));
    const cleanPasses = Math.max(0, Math.floor(draftPasses || 0));
    await onUpdatePlayerWallet(player.id, {
      creditBalance: cleanCredit,
      freeSessionPasses: cleanPasses,
      waiveAllFees: draftWaiveAll,
    });
    setEditingWalletPlayerId(null);
    setWalletSavedBanner(
      `Updated ${player.name}'s benefits (${
        draftWaiveAll
          ? 'All Fees Waived'
          : `${cleanPasses} free pass${cleanPasses === 1 ? '' : 'es'} · $${cleanCredit.toFixed(2)} credit`
      })`
    );
    setTimeout(() => setWalletSavedBanner(null), 3000);
  };
  const [sessionStatusFilter, setSessionStatusFilter] = useState<
    'all' | 'open' | 'settled'
  >('all');
  const [memberBalanceFilter, setMemberBalanceFilter] = useState<
    'all' | 'owing' | 'cleared'
  >('all');

  // Payment Info Tab State — opens when user clicks "Pay" anywhere
  const [showPaymentInfoTab, setShowPaymentInfoTab] = useState<boolean>(
    Boolean(initialOpenPayInfo)
  );
  const [payingTargetRsvpId, setPayingTargetRsvpId] = useState<string | 'ALL'>(
    'ALL'
  );
  const [selectedTransferMethod, setSelectedTransferMethod] =
    useState<string>('Phone / PayNow');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [paymentSubmittedBanner, setPaymentSubmittedBanner] = useState<
    string | null
  >(null);

  // Admin Edit Payment Method Info State
  const resolvedDetails = useMemo(
    () =>
      activeClub.paymentDetails ||
      parseClubPaymentDetails(
        activeClub.paymentInfo,
        activeClub.clubOwnerName || 'Alex Tan'
      ),
    [activeClub]
  );

  const [editingPaymentConfig, setEditingPaymentConfig] =
    useState<boolean>(false);
  const [editRecipient, setEditRecipient] = useState<string>(
    resolvedDetails.recipientName
  );
  const [editPhone, setEditPhone] = useState<string>(
    resolvedDetails.phoneNumber
  );
  const [editBankName, setEditBankName] = useState<string>(
    resolvedDetails.bankName
  );
  const [editBankAccount, setEditBankAccount] = useState<string>(
    resolvedDetails.bankAccountNumber
  );
  const [editPaymentNotes, setEditPaymentNotes] = useState<string>(
    resolvedDetails.paymentNotes
  );
  const [savedPaymentConfigNotice, setSavedPaymentConfigNotice] =
    useState<boolean>(false);

  const paymentInfoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setEditRecipient(resolvedDetails.recipientName);
    setEditPhone(resolvedDetails.phoneNumber);
    setEditBankName(resolvedDetails.bankName);
    setEditBankAccount(resolvedDetails.bankAccountNumber);
    setEditPaymentNotes(resolvedDetails.paymentNotes);
  }, [resolvedDetails]);

  useEffect(() => {
    if (initialOpenPayInfo) {
      setShowPaymentInfoTab(true);
      onConsumeInitialOpenPayInfo?.();
      setTimeout(() => {
        paymentInfoRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }, 60);
    }
  }, [initialOpenPayInfo, onConsumeInitialOpenPayInfo]);

  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        courtFee: number;
        shuttlesUsed: number;
        shuttleUnitCost: number;
        courtNumbers: string;
      }
    >
  >({});

  const activeSessionId = selectedSessionId || localSessionId;
  const handleChangeSession = (nextId: string) => {
    setLocalSessionId(nextId);
    onSelectSession?.(nextId);
  };

  const handleOpenPaymentTabFor = (target: string | 'ALL') => {
    setPayingTargetRsvpId(target);
    setShowPaymentInfoTab(true);
    setPaymentSubmittedBanner(null);
    setTimeout(() => {
      paymentInfoRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }, 50);
  };

  const handleCopyField = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 1600);
    } catch {
      // ignore
    }
  };

  const handleSavePaymentConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageClub || !onUpdateClubPaymentDetails) return;
    await onUpdateClubPaymentDetails(activeClub.id, {
      recipientName: editRecipient.trim() || 'Alex Tan',
      phoneNumber: editPhone.trim() || '+65 9123 4567',
      bankName: editBankName.trim() || 'DBS Bank',
      bankAccountNumber: editBankAccount.trim() || '018-902341-2',
      paymentNotes:
        editPaymentNotes.trim() ||
        'Include your name & session date in transfer reference',
    });
    setEditingPaymentConfig(false);
    setSavedPaymentConfigNotice(true);
    setTimeout(() => setSavedPaymentConfigNotice(false), 2000);
  };

  const getDraft = (session: Session) => {
    return (
      drafts[session.id] || {
        courtFee: session.courtFee,
        shuttlesUsed: session.shuttlesUsed > 0 ? session.shuttlesUsed : 6,
        shuttleUnitCost:
          session.shuttleUnitCost > 0 ? session.shuttleUnitCost : 3.0,
        courtNumbers: session.courtNumbers,
      }
    );
  };

  const updateDraft = (
    session: Session,
    field: 'courtFee' | 'shuttlesUsed' | 'shuttleUnitCost' | 'courtNumbers',
    value: number | string
  ) => {
    const current = getDraft(session);
    setDrafts((prev) => ({
      ...prev,
      [session.id]: {
        ...current,
        [field]: value,
      },
    }));
  };

  const playerBalances = useMemo(
    () =>
      players.map((p) => {
        const unpaidRsvps = rsvps.filter((r) => {
          if (r.playerId !== p.id || r.paidStatus === 'paid' || r.feeShare <= 0)
            return false;
          const s = sessions.find((sess) => sess.id === r.sessionId);
          return Boolean(
            s && s.feeSplitFinalized && s.bookingStatus === 'completed'
          );
        });
        const paidRsvps = rsvps.filter((r) => {
          if (r.playerId !== p.id || r.paidStatus !== 'paid' || r.feeShare <= 0)
            return false;
          return sessions.some((sess) => sess.id === r.sessionId);
        });
        const unpaidTotal = unpaidRsvps.reduce((sum, r) => sum + r.feeShare, 0);
        const paidTotal = paidRsvps.reduce((sum, r) => sum + r.feeShare, 0);
        const hasPendingApproval = unpaidRsvps.some(
          (r) => r.paidStatus === 'pending_approval'
        );
        const hasRejected = unpaidRsvps.some(
          (r) => r.paidStatus === 'unpaid' && r.paidMethod === 'Rejected'
        );
        return {
          player: p,
          unpaidRsvps,
          unpaidCount: unpaidRsvps.length,
          unpaidTotal,
          paidTotal,
          hasPendingApproval,
          hasRejected,
        };
      }),
    [players, rsvps, sessions]
  );

  const filteredPlayerBalances = useMemo(() => {
    return playerBalances.filter((b) => {
      if (memberBalanceFilter === 'owing') return b.unpaidTotal > 0;
      if (memberBalanceFilter === 'cleared') return b.unpaidTotal <= 0;
      return true;
    });
  }, [playerBalances, memberBalanceFilter]);

  const owingMembersCount = playerBalances.filter(
    (b) => b.unpaidTotal > 0
  ).length;
  const clearedMembersCount = playerBalances.length - owingMembersCount;

  const selfBalance = activePlayer
    ? playerBalances.find((b) => b.player.id === activePlayer.id) || null
    : null;

  const targetRsvpForPayment =
    payingTargetRsvpId !== 'ALL'
      ? rsvps.find((r) => r.id === payingTargetRsvpId) || null
      : null;

  const amountBeingPaid = targetRsvpForPayment
    ? targetRsvpForPayment.feeShare
    : selfBalance?.unpaidTotal || 0;

  const handleConfirmUserPaymentSent = async () => {
    if (!activePlayer) return;
    if (targetRsvpForPayment) {
      await onNotifyPaymentSentForRsvp(
        targetRsvpForPayment.id,
        selectedTransferMethod
      );
      setPaymentSubmittedBanner(
        `Submitted $${targetRsvpForPayment.feeShare.toFixed(2)} via ${selectedTransferMethod}. Waiting for Admin / Club Owner confirmation.`
      );
    } else {
      await onNotifyPaymentSentAllForPlayer(
        activePlayer.id,
        selectedTransferMethod
      );
      setPaymentSubmittedBanner(
        `Submitted $${amountBeingPaid.toFixed(2)} via ${selectedTransferMethod}. Waiting for Admin / Club Owner confirmation.`
      );
    }
  };

  const baseVisibleSessions = useMemo(() => {
    if (canManageClub) return sessions;
    return sessions.filter((s) =>
      rsvps.some(
        (r) =>
          r.sessionId === s.id &&
          r.playerId === activePlayer?.id &&
          (r.status === 'going' ||
            (r.status === 'late_out' && r.penaltyPercentApplied > 0))
      )
    );
  }, [canManageClub, sessions, rsvps, activePlayer]);

  const filteredSessions = useMemo(() => {
    return baseVisibleSessions.filter((s) => {
      const isSettled = s.bookingStatus === 'completed' && s.feeSplitFinalized;
      if (sessionStatusFilter === 'open') return !isSettled;
      if (sessionStatusFilter === 'settled') return isSettled;
      return true;
    });
  }, [baseVisibleSessions, sessionStatusFilter]);

  const activeSession =
    filteredSessions.find((s) => s.id === activeSessionId) ||
    filteredSessions[0] ||
    null;

  const activeSessionIndex = activeSession
    ? filteredSessions.findIndex((s) => s.id === activeSession.id)
    : -1;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Fee Ledger &amp; Splits
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {canManageClub
              ? 'Configure payment methods, settle session shuttle costs, and confirm whether member payments were received.'
              : 'View your session fee shares, open payment method details (phone or bank account), and submit payment for approval.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPaymentInfoTab(!showPaymentInfoTab)}
            className={`h-9 w-40 px-3 text-xs font-semibold rounded-lg border inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showPaymentInfoTab
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5 shrink-0" />
            <span>
              {showPaymentInfoTab ? 'Hide Payment Info' : 'Payment Info Tab'}
            </span>
          </button>
        </div>
      </div>

      {/* For Normal Users: Clean Personal Balance Summary — Clicking "Pay Now" opens the Payment Info Tab */}
      {!canManageClub && selfBalance && (
        <div className="bg-white rounded-xl border border-slate-200/85 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs text-slate-400">Your Personal Balance</p>
            <div className="flex items-baseline gap-3 font-mono tabular-nums">
              <span className="text-xl font-bold text-slate-900">
                ${selfBalance.unpaidTotal.toFixed(2)} Due
              </span>
              <span className="text-xs text-slate-500">
                · ${selfBalance.paidTotal.toFixed(2)} Received &amp; Cleared
              </span>
            </div>
            {selfBalance.hasRejected && (
              <p className="text-xs text-red-600 font-medium">
                Previous payment notice was marked Not Received by the Club Owner/Admin. Please verify the phone/bank account below and resubmit.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selfBalance.unpaidTotal <= 0 ? (
              <span className="h-9 px-3.5 rounded-lg bg-emerald-50 text-emerald-700 inline-flex items-center gap-1.5 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>All Bills Settled</span>
              </span>
            ) : selfBalance.hasPendingApproval ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-blue-700 inline-flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  <span>Pending Admin/Owner Verification</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleOpenPaymentTabFor('ALL')}
                  className="h-9 w-36 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span>View Bank Info</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleOpenPaymentTabFor('ALL')}
                className="h-9 w-40 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <CreditCard className="w-3.5 h-3.5 shrink-0" />
                <span>Pay Now (${selfBalance.unpaidTotal.toFixed(2)})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* PAYMENT METHOD INFO TAB / PANEL (Phone Number & Bank Account Fields + Payment Submission) */}
      {showPaymentInfoTab && (
        <section
          ref={paymentInfoRef}
          aria-label="Payment Method Information"
          className="bg-white rounded-xl border border-slate-300 shadow-2xs p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">
                  Payment Methods &amp; Bank Account Info — {activeClub.name}
                </h2>
                {savedPaymentConfigNotice && (
                  <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    Saved
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Use the Phone Number (PayNow / Mobile Transfer) or Bank Account below to make payment. The Club Owner / Admin will verify and mark as received.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {canManageClub && onUpdateClubPaymentDetails && (
                <button
                  type="button"
                  onClick={() => setEditingPaymentConfig(!editingPaymentConfig)}
                  className="h-8 w-32 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>
                    {editingPaymentConfig ? 'Cancel Edit' : 'Edit Details'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPaymentInfoTab(false)}
                className="h-8 w-24 px-2.5 text-xs font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Close</span>
              </button>
            </div>
          </div>

          {/* Admin / Club Owner: Edit Phone Number & Bank Account Form */}
          {canManageClub && editingPaymentConfig ? (
            <form
              onSubmit={handleSavePaymentConfig}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <StyledInput
                  label="Recipient / Account Holder"
                  required
                  maxLength={60}
                  value={editRecipient}
                  onChange={(e) => setEditRecipient(e.target.value)}
                  placeholder="e.g. Alex Tan"
                />
                <StyledInput
                  label="Phone Number (PayNow / Mobile)"
                  required
                  maxLength={40}
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="e.g. +65 9123 4567"
                  className="font-mono tabular-nums"
                />
                <StyledInput
                  label="Bank Name"
                  required
                  maxLength={40}
                  value={editBankName}
                  onChange={(e) => setEditBankName(e.target.value)}
                  placeholder="e.g. DBS Bank / OCBC"
                />
                <StyledInput
                  label="Bank Account Number"
                  required
                  maxLength={40}
                  value={editBankAccount}
                  onChange={(e) => setEditBankAccount(e.target.value)}
                  placeholder="e.g. 018-902341-2"
                  className="font-mono tabular-nums"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div className="flex-1">
                  <StyledInput
                    label="Transfer Reference / Instructions"
                    maxLength={80}
                    value={editPaymentNotes}
                    onChange={(e) => setEditPaymentNotes(e.target.value)}
                    placeholder="e.g. Include player name and session date"
                  />
                </div>
                <button
                  type="submit"
                  className="h-10 w-40 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center shrink-0 transition-colors"
                >
                  Save Payment Info
                </button>
              </div>
            </form>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card 1: Phone Number */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>Phone Number (PayNow / Mobile)</span>
                  </span>
                  <p className="font-mono tabular-nums text-base font-bold text-slate-900 truncate">
                    {resolvedDetails.phoneNumber}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    Recipient: {resolvedDetails.recipientName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyField('phone', resolvedDetails.phoneNumber)
                  }
                  className="h-9 w-24 px-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
                >
                  {copiedField === 'phone' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Card 2: Bank Account */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>Bank Account ({resolvedDetails.bankName})</span>
                  </span>
                  <p className="font-mono tabular-nums text-base font-bold text-slate-900 truncate">
                    {resolvedDetails.bankAccountNumber}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    Holder: {resolvedDetails.recipientName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyField(
                      'bank',
                      resolvedDetails.bankAccountNumber
                    )
                  }
                  className="h-9 w-24 px-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
                >
                  {copiedField === 'bank' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Card 3: Recipient & Reference Note */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col justify-between gap-2">
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    <span>Transfer Instructions</span>
                  </span>
                  <p className="text-xs font-semibold text-slate-900">
                    Pay to: {resolvedDetails.recipientName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {resolvedDetails.paymentNotes}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* User Action Bar to Submit Payment Notice to Admin/Owner */}
          {activePlayer && amountBeingPaid > 0 && (
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-800 block">
                  {targetRsvpForPayment
                    ? `Paying Single Session Share ($${targetRsvpForPayment.feeShare.toFixed(2)})`
                    : `Paying Total Outstanding Balance ($${amountBeingPaid.toFixed(2)})`}
                </span>
                <p className="text-xs text-slate-500">
                  Once you have transferred the amount via Phone or Bank Account, submit below so the Admin/Owner can confirm receipt.
                </p>
                {paymentSubmittedBanner && (
                  <p className="text-xs font-semibold text-emerald-700 pt-1">
                    {paymentSubmittedBanner}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-2.5 shrink-0">
                <div className="w-48">
                  <StyledSelect
                    label="Method Used"
                    value={selectedTransferMethod}
                    onChange={(e) => setSelectedTransferMethod(e.target.value)}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </StyledSelect>
                </div>

                <button
                  type="button"
                  onClick={handleConfirmUserPaymentSent}
                  className="h-10 w-52 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    I Have Paid (${amountBeingPaid.toFixed(2)})
                  </span>
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Focused Single-Session Selector & Calculator */}
      <section className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <span className="text-xs font-semibold text-slate-700 shrink-0">
              Session:
            </span>
            <div className="w-full sm:w-80">
              <StyledSelect
                aria-label="Select session to view or settle"
                value={activeSession?.id || ''}
                onChange={(e) => handleChangeSession(e.target.value)}
                disabled={filteredSessions.length === 0}
              >
                {filteredSessions.length === 0 ? (
                  <option value="">No sessions in this filter</option>
                ) : (
                  filteredSessions.map((s) => {
                    const settled =
                      s.bookingStatus === 'completed' && s.feeSplitFinalized;
                    return (
                      <option key={s.id} value={s.id}>
                        {s.sessionDate} · {s.title} (
                        {settled ? 'Settled' : 'Open'})
                      </option>
                    );
                  })
                )}
              </StyledSelect>
            </div>

            {filteredSessions.length > 1 && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={activeSessionIndex <= 0}
                  onClick={() => {
                    if (activeSessionIndex > 0) {
                      handleChangeSession(
                        filteredSessions[activeSessionIndex - 1].id
                      );
                    }
                  }}
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40"
                  aria-label="Previous session"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={
                    activeSessionIndex < 0 ||
                    activeSessionIndex >= filteredSessions.length - 1
                  }
                  onClick={() => {
                    if (
                      activeSessionIndex >= 0 &&
                      activeSessionIndex < filteredSessions.length - 1
                    ) {
                      handleChangeSession(
                        filteredSessions[activeSessionIndex + 1].id
                      );
                    }
                  }}
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40"
                  aria-label="Next session"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <span className="text-[11px] font-mono tabular-nums text-slate-400 pl-1">
                  {activeSessionIndex + 1}/{filteredSessions.length}
                </span>
              </div>
            )}
          </div>

          <SegmentedControl
            options={[
              {
                value: 'all',
                label: 'All',
                count: baseVisibleSessions.length,
              },
              {
                value: 'open',
                label: 'Open',
                count: baseVisibleSessions.filter(
                  (s) =>
                    !(s.bookingStatus === 'completed' && s.feeSplitFinalized)
                ).length,
              },
              {
                value: 'settled',
                label: 'Settled',
                count: baseVisibleSessions.filter(
                  (s) => s.bookingStatus === 'completed' && s.feeSplitFinalized
                ).length,
              },
            ]}
            value={sessionStatusFilter}
            onChange={setSessionStatusFilter}
          />
        </div>

        {/* Single Focused Session Breakdown Card */}
        {!activeSession ? (
          <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center">
            <p className="text-xs text-slate-500">
              No sessions match the selected filter.
            </p>
          </div>
        ) : (
          (() => {
            const session = activeSession;
            const draft = getDraft(session);
            const sessionRsvps = rsvps.filter(
              (r) => r.sessionId === session.id
            );
            const chargeableRsvps = sessionRsvps.filter(
              (r) =>
                r.status === 'going' ||
                (r.status === 'late_out' && r.penaltyPercentApplied > 0)
            );
            // Normal users ONLY see their own RSVP row; Club Owners & Site Admins see all chargeable RSVPs
            const visibleRsvpRows = canManageClub
              ? chargeableRsvps
              : chargeableRsvps.filter((r) => r.playerId === activePlayer?.id);

            const isCompleted =
              session.bookingStatus === 'completed' &&
              session.feeSplitFinalized;

            const computedShuttleFee = isCompleted
              ? session.shuttleFee
              : Number((draft.shuttlesUsed * draft.shuttleUnitCost).toFixed(2));
            const displayCourtFee = isCompleted
              ? session.courtFee
              : draft.courtFee;
            const totalSessionFee = displayCourtFee + computedShuttleFee;

            const previewSplits = computeWeightedSessionSplits(
              displayCourtFee,
              computedShuttleFee,
              sessionRsvps,
              activeClub.noShowFeePercent
            );

            const myRsvp = activePlayer
              ? chargeableRsvps.find((r) => r.playerId === activePlayer.id)
              : undefined;
            const myShareAmount = myRsvp
              ? isCompleted
                ? myRsvp.feeShare
                : previewSplits.get(myRsvp.id)?.feeShare || 0
              : 0;

            const presentSample = sessionRsvps.find(
              (r) => r.status === 'going' && r.attendanceOutcome === 'present'
            );
            const samplePresentShare = presentSample
              ? previewSplits.get(presentSample.id)?.feeShare || 0
              : 0;

            return (
              <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-800">
                        {isCompleted ? 'Settled' : 'Open'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {session.sessionDate}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {session.venue} ({session.courtNumbers})
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-slate-900 mt-1">
                      {session.title}
                    </h2>
                  </div>

                  <div className="text-right font-mono tabular-nums">
                    {canManageClub ? (
                      <>
                        <span className="text-[11px] text-slate-400 block">
                          {isCompleted ? 'Per Present Player' : 'Court Fee'}
                        </span>
                        <span className="text-base font-bold text-slate-900">
                          $
                          {isCompleted
                            ? samplePresentShare.toFixed(2)
                            : session.courtFee.toFixed(2)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[11px] text-slate-400 block">
                          Your Share
                        </span>
                        <span className="text-base font-bold text-slate-900">
                          ${myShareAmount.toFixed(2)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Club Owner & Site Admin: Session Settlement & Shuttlecock Calculator */}
                {canManageClub && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-900">
                        {isCompleted
                          ? 'Adjust Session Settlement'
                          : 'Settle Session Fees'}
                      </span>
                      <span className="text-slate-500 font-mono tabular-nums">
                        Total ${totalSessionFee.toFixed(2)} · Per Player $
                        {samplePresentShare.toFixed(2)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <StyledInput
                        label="Court Fee"
                        prefixText="$"
                        type="number"
                        min={0}
                        step={1}
                        value={draft.courtFee}
                        onChange={(e) =>
                          updateDraft(
                            session,
                            'courtFee',
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="font-mono tabular-nums"
                      />
                      <StyledInput
                        label="Shuttles Used"
                        suffixText="pcs"
                        type="number"
                        min={0}
                        max={200}
                        step={1}
                        value={draft.shuttlesUsed}
                        onChange={(e) =>
                          updateDraft(
                            session,
                            'shuttlesUsed',
                            parseInt(e.target.value, 10) || 0
                          )
                        }
                        className="font-mono tabular-nums font-bold"
                      />
                      <StyledInput
                        label="Unit Price"
                        prefixText="$"
                        type="number"
                        min={0}
                        step={0.5}
                        value={draft.shuttleUnitCost}
                        onChange={(e) =>
                          updateDraft(
                            session,
                            'shuttleUnitCost',
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="font-mono tabular-nums"
                      />
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() =>
                            onFinalizeSessionShuttleAndSplit(
                              session.id,
                              'completed',
                              draft.courtFee,
                              draft.shuttlesUsed,
                              draft.shuttleUnitCost,
                              draft.courtNumbers,
                              true
                            )
                          }
                          className="w-full h-10 px-3 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
                        >
                          {isCompleted
                            ? `Update ($${totalSessionFee.toFixed(2)})`
                            : `Finalize ($${totalSessionFee.toFixed(2)})`}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Session Split Rows */}
                <div className="space-y-2.5">
                  {isCompleted && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 font-mono tabular-nums">
                      <span>
                        Court ${session.courtFee.toFixed(2)} +{' '}
                        {session.shuttlesUsed} shuttles ($
                        {session.shuttleFee.toFixed(2)}) ·{' '}
                        {chargeableRsvps.length} players
                      </span>
                      <span className="font-semibold text-slate-800">
                        Session Total ${totalSessionFee.toFixed(2)}
                      </span>
                    </div>
                  )}

                  {visibleRsvpRows.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center border border-slate-200/70 rounded-lg">
                      No fee share recorded for your account in this session.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-lg overflow-hidden">
                      {visibleRsvpRows.map((rsvp) => {
                        const isSelf = rsvp.playerId === activePlayer?.id;
                        const rsvpPlayer = players.find(
                          (p) => p.id === rsvp.playerId
                        );
                        const displayShare = isCompleted
                          ? rsvp.feeShare
                          : previewSplits.get(rsvp.id)?.feeShare || 0;
                        const isRejected =
                          rsvp.paidStatus === 'unpaid' &&
                          rsvp.paidMethod === 'Rejected';

                        return (
                          <div
                            key={rsvp.id}
                            className="px-3.5 sm:px-4 py-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                          >
                            <div className="flex flex-wrap items-center justify-between sm:justify-start gap-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold text-slate-900">
                                  {rsvp.playerName}
                                </span>
                                {isSelf && (
                                  <span className="text-[11px] font-medium text-emerald-700">
                                    · You
                                  </span>
                                )}
                                {rsvp.attendanceOutcome === 'no_show' && (
                                  <span className="text-[11px] font-medium text-amber-700">
                                    · No-Show ({activeClub.noShowFeePercent}%)
                                  </span>
                                )}
                                {rsvp.status === 'late_out' && (
                                  <span className="text-[11px] font-medium text-amber-700">
                                    · Late Out ({rsvp.penaltyPercentApplied}%)
                                  </span>
                                )}
                                {rsvpPlayer?.waiveAllFees && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    VIP Fee Waived
                                  </span>
                                )}
                                {!rsvpPlayer?.waiveAllFees &&
                                  (rsvpPlayer?.freeSessionPasses || 0) > 0 && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                      {rsvpPlayer?.freeSessionPasses} Free Pass
                                      {rsvpPlayer?.freeSessionPasses === 1
                                        ? ''
                                        : 'es'}
                                    </span>
                                  )}
                                {!rsvpPlayer?.waiveAllFees &&
                                  (rsvpPlayer?.creditBalance || 0) > 0 && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-50 text-sky-800 border border-sky-200">
                                      ${(rsvpPlayer?.creditBalance || 0).toFixed(2)}{' '}
                                      Credit
                                    </span>
                                  )}
                              </div>

                              {/* Mobile-inline share preview */}
                              {isCompleted && (canManageClub || isSelf) && (
                                <span className="sm:hidden font-mono tabular-nums text-slate-900 font-bold">
                                  ${displayShare.toFixed(2)}
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 sm:gap-3 font-mono tabular-nums">
                              {canManageClub && rsvp.status === 'going' && (
                                <SegmentedControl
                                  size="sm"
                                  options={[
                                    { value: 'present', label: 'Present' },
                                    { value: 'no_show', label: 'No-Show' },
                                  ]}
                                  value={
                                    rsvp.attendanceOutcome === 'no_show'
                                      ? 'no_show'
                                      : 'present'
                                  }
                                  onChange={(val) =>
                                    onMarkAttendanceOutcome(rsvp.id, val)
                                  }
                                />
                              )}

                              {isCompleted && (canManageClub || isSelf) && (
                                <div className="flex flex-wrap items-center gap-2 ml-auto sm:ml-0">
                                  <span className="hidden sm:inline text-slate-900 font-bold">
                                    ${displayShare.toFixed(2)}
                                  </span>
                                  {rsvp.paidStatus === 'paid' ? (
                                    <span className="text-emerald-700 font-sans font-semibold inline-flex items-center gap-1 sm:justify-end">
                                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                      <span>
                                        {rsvp.paidMethod &&
                                        rsvp.paidMethod !== 'pending' &&
                                        rsvp.paidMethod !== 'Approved' &&
                                        rsvp.paidMethod !== 'Received'
                                          ? rsvp.paidMethod
                                          : 'Received'}
                                      </span>
                                    </span>
                                  ) : rsvp.paidStatus === 'pending_approval' ? (
                                    <span className="text-blue-700 font-sans font-semibold inline-flex items-center gap-1">
                                      <Clock className="w-3.5 h-3.5" />
                                      <span>Pending ({rsvp.paidMethod})</span>
                                    </span>
                                  ) : isRejected ? (
                                    <span className="text-red-600 font-sans font-semibold">
                                      Not Received
                                    </span>
                                  ) : (
                                    <span className="text-amber-700 font-sans font-semibold">
                                      {rsvp.paidMethod?.startsWith('Credit -')
                                        ? `Unpaid (${rsvp.paidMethod})`
                                        : 'Unpaid'}
                                    </span>
                                  )}

                                  {/* Club Owner / Site Admin: Decide whether payment was received or Waive */}
                                  {canManageClub &&
                                    rsvp.paidStatus !== 'paid' && (
                                      <>
                                        {rsvp.paidStatus ===
                                        'pending_approval' ? (
                                          <div className="inline-flex items-center gap-1.5 font-sans">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onAcceptOrClearSingleRsvp(
                                                  rsvp.id,
                                                  rsvp.paidMethod || 'Received'
                                                )
                                              }
                                              className={`${UNIFORM_ACTION_BTN} text-white bg-emerald-700 hover:bg-emerald-800`}
                                            >
                                              <Check className="w-3.5 h-3.5" />
                                              <span>Received</span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onRejectPaymentForRsvp(rsvp.id)
                                              }
                                              className={`${UNIFORM_ACTION_BTN} text-slate-700 bg-slate-100 hover:bg-slate-200`}
                                            >
                                              <X className="w-3.5 h-3.5 text-red-600" />
                                              <span>Not Recv</span>
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="inline-flex items-center gap-1.5 font-sans">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onAcceptOrClearSingleRsvp(
                                                  rsvp.id,
                                                  'Received'
                                                )
                                              }
                                              className="h-8 px-2.5 text-xs font-semibold rounded-lg text-white bg-slate-900 hover:bg-slate-800 inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
                                            >
                                              <ShieldCheck className="w-3.5 h-3.5" />
                                              <span>Mark Recv</span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onAcceptOrClearSingleRsvp(
                                                  rsvp.id,
                                                  'Fee Waived'
                                                )
                                              }
                                              className="h-8 px-2.5 text-xs font-semibold rounded-lg text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
                                              title="Waive this session fee completely"
                                            >
                                              <Gift className="w-3.5 h-3.5 text-emerald-700" />
                                              <span>Waive</span>
                                            </button>
                                          </div>
                                        )}
                                      </>
                                    )}

                                  {/* Normal User: Clicking "Pay Share" opens the Payment Info Tab! */}
                                  {!canManageClub &&
                                    isSelf &&
                                    rsvp.paidStatus === 'unpaid' && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleOpenPaymentTabFor(rsvp.id)
                                        }
                                        className={`${UNIFORM_ACTION_BTN} font-sans text-white bg-slate-900 hover:bg-slate-800`}
                                      >
                                        <CreditCard className="w-3.5 h-3.5 shrink-0" />
                                        <span>
                                          {isRejected
                                            ? 'Pay Again'
                                            : 'Pay Share'}
                                        </span>
                                      </button>
                                    )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()
        )}
      </section>

      {/* For Club Owner & Site Admin ONLY: Member Balance Ledger with Credit, Pass & Waiver Management */}
      {canManageClub && (
        <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Member Balances, Credits, Session Passes &amp; Waivers
              </h2>
              <p className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                Verify payments, top up member credits, grant free session passes, or waive fees completely
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {walletSavedBanner && (
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {walletSavedBanner}
                </span>
              )}
              <SegmentedControl
                size="sm"
                options={[
                  {
                    value: 'all',
                    label: 'All',
                    count: playerBalances.length,
                  },
                  {
                    value: 'owing',
                    label: 'Unpaid / Pending',
                    count: owingMembersCount,
                  },
                  {
                    value: 'cleared',
                    label: 'Received',
                    count: clearedMembersCount,
                  },
                ]}
                value={memberBalanceFilter}
                onChange={setMemberBalanceFilter}
              />
            </div>
          </div>

          {/* Desktop Table (md+) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-medium text-slate-400">
                  <th className="py-2.5 px-5">Player</th>
                  <th className="py-2.5 px-5">Credits &amp; Passes</th>
                  <th className="py-2.5 px-5">Payment Status</th>
                  <th className="py-2.5 px-5 text-right">Due</th>
                  <th className="py-2.5 px-5 text-right">Received</th>
                  <th className="py-2.5 px-5 text-right">Actions &amp; Benefits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredPlayerBalances.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-8 text-center text-xs text-slate-400"
                    >
                      No members match this balance filter.
                    </td>
                  </tr>
                ) : (
                  filteredPlayerBalances.map(
                    ({
                      player,
                      unpaidCount,
                      unpaidTotal,
                      paidTotal,
                      hasPendingApproval,
                    }) => {
                      const isSelf = activePlayer?.id === player.id;
                      const isEditingWallet =
                        editingWalletPlayerId === player.id;
                      const hasWalletPerk =
                        Boolean(player.waiveAllFees) ||
                        (player.freeSessionPasses || 0) > 0 ||
                        (player.creditBalance || 0) > 0;

                      return (
                        <React.Fragment key={player.id}>
                          <tr className="hover:bg-slate-50/60">
                            <td className="py-3 px-5 font-medium text-slate-900">
                              {player.name}{' '}
                              <span className="font-mono text-slate-400">
                                {player.playerTag}
                              </span>
                              {isSelf && (
                                <span className="ml-1.5 text-[11px] text-emerald-700 font-medium">
                                  · You
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {player.waiveAllFees ? (
                                  <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                                    <Sparkles className="w-3 h-3 text-emerald-600" />
                                    <span>All Fees Waived</span>
                                  </span>
                                ) : (
                                  <>
                                    {(player.freeSessionPasses || 0) > 0 && (
                                      <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                                        <Ticket className="w-3 h-3 text-emerald-600" />
                                        <span>
                                          {player.freeSessionPasses} Free Pass
                                          {player.freeSessionPasses === 1
                                            ? ''
                                            : 'es'}
                                        </span>
                                      </span>
                                    )}
                                    {(player.creditBalance || 0) > 0 && (
                                      <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-sky-50 text-sky-900 border border-sky-200">
                                        ${(player.creditBalance || 0).toFixed(2)}{' '}
                                        Credit
                                      </span>
                                    )}
                                    {!hasWalletPerk && (
                                      <span className="text-slate-400 text-[11px]">
                                        Standard
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-5 text-slate-500">
                              {unpaidCount === 0 ? (
                                <span className="text-slate-400">
                                  All Received / Waived
                                </span>
                              ) : hasPendingApproval ? (
                                <span className="text-blue-700 font-semibold inline-flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5" />
                                  Awaiting Verification ({unpaidCount})
                                </span>
                              ) : (
                                <span className="text-amber-700 font-mono tabular-nums font-medium">
                                  {unpaidCount} unpaid bill
                                  {unpaidCount === 1 ? '' : 's'}
                                </span>
                              )}
                            </td>
                            <td
                              className={`py-3 px-5 text-right font-mono tabular-nums font-bold ${
                                unpaidTotal > 0
                                  ? 'text-amber-700'
                                  : 'text-slate-400'
                              }`}
                            >
                              ${unpaidTotal.toFixed(2)}
                            </td>
                            <td className="py-3 px-5 text-right font-mono tabular-nums text-slate-600">
                              ${paidTotal.toFixed(2)}
                            </td>
                            <td className="py-3 px-5 text-right">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                {onUpdatePlayerWallet && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenWalletEditor(player)
                                    }
                                    className={`h-8 px-2.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition-colors cursor-pointer ${
                                      isEditingWallet
                                        ? 'bg-slate-900 text-white border-slate-900'
                                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                    }`}
                                    title="Top up credit, add free session passes, or toggle complete fee waiver"
                                  >
                                    <Gift className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>Credits / Passes</span>
                                  </button>
                                )}

                                {unpaidTotal <= 0 ? (
                                  <span className="inline-flex items-center justify-end gap-1 text-emerald-700 font-semibold px-2">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Cleared</span>
                                  </span>
                                ) : hasPendingApproval ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onAcceptOrClearAllForPlayer(
                                          player.id,
                                          'Received'
                                        )
                                      }
                                      className="h-8 px-2.5 rounded-lg text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Received</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onRejectAllForPlayer(player.id)
                                      }
                                      className="h-8 px-2.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5 text-red-600" />
                                      <span>Not Recv</span>
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onAcceptOrClearAllForPlayer(
                                          player.id,
                                          'Received'
                                        )
                                      }
                                      className="h-8 px-2.5 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <ShieldCheck className="w-3.5 h-3.5" />
                                      <span>Mark Recv</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onAcceptOrClearAllForPlayer(
                                          player.id,
                                          'Fee Waived'
                                        )
                                      }
                                      className="h-8 px-2.5 rounded-lg text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 inline-flex items-center gap-1 cursor-pointer"
                                      title="Waive all current unpaid bills for this player"
                                    >
                                      <Gift className="w-3.5 h-3.5 text-emerald-700" />
                                      <span>Waive Due</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Inline Wallet, Session Pass & Waiver Editor Row */}
                          {isEditingWallet && (
                            <tr className="bg-slate-50/90 border-b border-slate-200/80">
                              <td colSpan={6} className="p-4 sm:px-5">
                                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
                                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                                    <div>
                                      <h4 className="text-xs font-bold text-slate-900">
                                        Configure Credits, Free Session Passes &amp; Fee Waiver · {player.name}
                                      </h4>
                                      <p className="text-[11px] text-slate-500 mt-0.5">
                                        Automatically waives or deducts from existing unpaid sessions first, then applies to upcoming sessions they join.
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingWalletPlayerId(null)
                                      }
                                      className="text-xs text-slate-400 hover:text-slate-700"
                                    >
                                      Close
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                                    {/* 1. Credit Balance Top-Up */}
                                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70 space-y-2.5">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-slate-800">
                                          1. Wallet Credit ($)
                                        </span>
                                        <span className="font-mono text-xs font-bold text-sky-800">
                                          ${parseFloat(draftCredit || '0').toFixed(2)}
                                        </span>
                                      </div>
                                      <StyledInput
                                        type="number"
                                        step="0.50"
                                        min={0}
                                        max={5000}
                                        value={draftCredit}
                                        onChange={(e) =>
                                          setDraftCredit(e.target.value)
                                        }
                                        className="h-8 text-xs font-mono tabular-nums"
                                      />
                                      <div className="flex flex-wrap gap-1.5">
                                        {[10, 20, 50].map((amt) => (
                                          <button
                                            key={amt}
                                            type="button"
                                            onClick={() =>
                                              setDraftCredit((prev) =>
                                                (
                                                  (parseFloat(prev || '0') ||
                                                    0) + amt
                                                ).toFixed(2)
                                              )
                                            }
                                            className="h-7 px-2 rounded bg-white border border-slate-200 hover:bg-slate-100 text-[11px] font-mono font-semibold text-slate-700 cursor-pointer"
                                          >
                                            +${amt}
                                          </button>
                                        ))}
                                        <button
                                          type="button"
                                          onClick={() => setDraftCredit('0.00')}
                                          className="h-7 px-2 rounded bg-white border border-slate-200 hover:bg-slate-100 text-[11px] text-slate-500 cursor-pointer"
                                        >
                                          Reset $0
                                        </button>
                                      </div>
                                    </div>

                                    {/* 2. Free Session Passes */}
                                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70 space-y-2.5">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-slate-800">
                                          2. Free Session Passes
                                        </span>
                                        <span className="font-mono text-xs font-bold text-emerald-800">
                                          {draftPasses} session
                                          {draftPasses === 1 ? '' : 's'}
                                        </span>
                                      </div>
                                      <StyledInput
                                        type="number"
                                        step="1"
                                        min={0}
                                        max={100}
                                        value={draftPasses}
                                        onChange={(e) =>
                                          setDraftPasses(
                                            Math.max(
                                              0,
                                              parseInt(e.target.value, 10) || 0
                                            )
                                          )
                                        }
                                        className="h-8 text-xs font-mono tabular-nums"
                                      />
                                      <div className="flex flex-wrap gap-1.5">
                                        {[1, 3, 5].map((cnt) => (
                                          <button
                                            key={cnt}
                                            type="button"
                                            onClick={() =>
                                              setDraftPasses(
                                                (prev) => (prev || 0) + cnt
                                              )
                                            }
                                            className="h-7 px-2 rounded bg-white border border-slate-200 hover:bg-slate-100 text-[11px] font-mono font-semibold text-emerald-800 cursor-pointer"
                                          >
                                            +{cnt} Pass{cnt > 1 ? 'es' : ''}
                                          </button>
                                        ))}
                                        <button
                                          type="button"
                                          onClick={() => setDraftPasses(0)}
                                          className="h-7 px-2 rounded bg-white border border-slate-200 hover:bg-slate-100 text-[11px] text-slate-500 cursor-pointer"
                                        >
                                          Reset 0
                                        </button>
                                      </div>
                                    </div>

                                    {/* 3. Complete Fee Waiver Toggle */}
                                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70 space-y-2.5">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-slate-800">
                                          3. Complete Fee Waiver
                                        </span>
                                        <span
                                          className={`text-[11px] font-semibold ${
                                            draftWaiveAll
                                              ? 'text-emerald-700'
                                              : 'text-slate-400'
                                          }`}
                                        >
                                          {draftWaiveAll
                                            ? 'Active (100% Waived)'
                                            : 'Off'}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-slate-500 leading-relaxed">
                                        When enabled, {player.name} is exempt from all session court &amp; shuttle fees automatically.
                                      </p>
                                      <SegmentedControl
                                        size="sm"
                                        options={[
                                          { value: 'off', label: 'Standard' },
                                          {
                                            value: 'waive',
                                            label: 'Waive All Fees',
                                          },
                                        ]}
                                        value={draftWaiveAll ? 'waive' : 'off'}
                                        onChange={(val) =>
                                          setDraftWaiveAll(val === 'waive')
                                        }
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingWalletPlayerId(null)
                                      }
                                      className="h-8 px-3 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleSaveWalletForPlayer(player)
                                      }
                                      className="h-8 px-4 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 inline-flex items-center gap-1.5 cursor-pointer"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Save &amp; Apply Benefits</span>
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    }
                  )
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Member Balance Verification Cards (< md) */}
          <div className="md:hidden divide-y divide-slate-100 text-xs">
            {filteredPlayerBalances.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                No members match this balance filter.
              </p>
            ) : (
              filteredPlayerBalances.map(
                ({
                  player,
                  unpaidCount,
                  unpaidTotal,
                  paidTotal,
                  hasPendingApproval,
                }) => {
                  const isSelf = activePlayer?.id === player.id;
                  const isEditingWallet = editingWalletPlayerId === player.id;
                  return (
                    <div
                      key={player.id}
                      className="p-4 flex flex-col gap-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-slate-900 text-sm">
                              {player.name}
                            </span>
                            <span className="font-mono text-slate-400">
                              {player.playerTag}
                            </span>
                            {isSelf && (
                              <span className="text-[11px] text-emerald-700 font-semibold">
                                · You
                              </span>
                            )}
                          </div>

                          {/* Active Wallet / Pass Badges on Mobile */}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {player.waiveAllFees && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                All Fees Waived
                              </span>
                            )}
                            {!player.waiveAllFees &&
                              (player.freeSessionPasses || 0) > 0 && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  {player.freeSessionPasses} Free Pass
                                  {player.freeSessionPasses === 1 ? '' : 'es'}
                                </span>
                              )}
                            {!player.waiveAllFees &&
                              (player.creditBalance || 0) > 0 && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-50 text-sky-900 border border-sky-200">
                                  ${(player.creditBalance || 0).toFixed(2)} Credit
                                </span>
                              )}
                          </div>

                          <div className="mt-1.5">
                            {unpaidCount === 0 ? (
                              <span className="text-slate-400">
                                All bills received / waived
                              </span>
                            ) : hasPendingApproval ? (
                              <span className="text-blue-700 font-semibold inline-flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                Awaiting Verification ({unpaidCount})
                              </span>
                            ) : (
                              <span className="text-amber-700 font-mono tabular-nums font-medium">
                                {unpaidCount} unpaid bill
                                {unpaidCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right font-mono tabular-nums shrink-0">
                          <span
                            className={`text-sm font-bold block ${
                              unpaidTotal > 0
                                ? 'text-amber-800'
                                : 'text-slate-400'
                            }`}
                          >
                            ${unpaidTotal.toFixed(2)} Due
                          </span>
                          <span className="text-[11px] text-slate-400">
                            ${paidTotal.toFixed(2)} Recv
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {onUpdatePlayerWallet && (
                          <button
                            type="button"
                            onClick={() => handleOpenWalletEditor(player)}
                            className={`h-9 px-3 rounded-lg text-xs font-semibold border inline-flex items-center justify-center gap-1.5 flex-1 ${
                              isEditingWallet
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-200'
                            }`}
                          >
                            <Gift className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Credits &amp; Passes</span>
                          </button>
                        )}

                        {unpaidTotal > 0 && (
                          <>
                            {hasPendingApproval ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onAcceptOrClearAllForPlayer(
                                      player.id,
                                      'Received'
                                    )
                                  }
                                  className="h-9 px-3 rounded-lg text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 inline-flex items-center justify-center gap-1 flex-1"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Received</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onRejectAllForPlayer(player.id)}
                                  className="h-9 px-3 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 inline-flex items-center justify-center gap-1"
                                >
                                  <X className="w-3.5 h-3.5 text-red-600" />
                                  <span>Reject</span>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onAcceptOrClearAllForPlayer(
                                      player.id,
                                      'Received'
                                    )
                                  }
                                  className="h-9 px-3 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 inline-flex items-center justify-center gap-1 flex-1"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>Mark Recv</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onAcceptOrClearAllForPlayer(
                                      player.id,
                                      'Fee Waived'
                                    )
                                  }
                                  className="h-9 px-3 rounded-lg text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 inline-flex items-center justify-center gap-1"
                                >
                                  <Gift className="w-3.5 h-3.5 text-emerald-700" />
                                  <span>Waive</span>
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>

                      {/* Mobile Inline Wallet Editor */}
                      {isEditingWallet && (
                        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3 mt-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900">
                              Credits, Passes &amp; Waiver
                            </span>
                            <button
                              type="button"
                              onClick={() => setEditingWalletPlayerId(null)}
                              className="text-slate-400"
                            >
                              Close
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5">
                            <StyledInput
                              label="Credit ($)"
                              type="number"
                              step="0.50"
                              min={0}
                              value={draftCredit}
                              onChange={(e) => setDraftCredit(e.target.value)}
                              className="font-mono"
                            />
                            <StyledInput
                              label="Free Passes"
                              type="number"
                              step="1"
                              min={0}
                              value={draftPasses}
                              onChange={(e) =>
                                setDraftPasses(
                                  Math.max(0, parseInt(e.target.value, 10) || 0)
                                )
                              }
                              className="font-mono"
                            />
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setDraftCredit((prev) =>
                                  ((parseFloat(prev || '0') || 0) + 10).toFixed(2)
                                )
                              }
                              className="h-7 px-2 rounded bg-white border border-slate-200 text-[11px] font-mono font-semibold text-sky-800"
                            >
                              +$10 Credit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDraftCredit((prev) =>
                                  ((parseFloat(prev || '0') || 0) + 25).toFixed(2)
                                )
                              }
                              className="h-7 px-2 rounded bg-white border border-slate-200 text-[11px] font-mono font-semibold text-sky-800"
                            >
                              +$25 Credit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDraftPasses((prev) => (prev || 0) + 1)
                              }
                              className="h-7 px-2 rounded bg-white border border-slate-200 text-[11px] font-mono font-semibold text-emerald-800"
                            >
                              +1 Free Pass
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDraftPasses((prev) => (prev || 0) + 3)
                              }
                              className="h-7 px-2 rounded bg-white border border-slate-200 text-[11px] font-mono font-semibold text-emerald-800"
                            >
                              +3 Passes
                            </button>
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs font-medium text-slate-700">
                              Waive All Fees:
                            </span>
                            <SegmentedControl
                              size="sm"
                              options={[
                                { value: 'off', label: 'Standard' },
                                { value: 'waive', label: 'Waive All' },
                              ]}
                              value={draftWaiveAll ? 'waive' : 'off'}
                              onChange={(val) =>
                                setDraftWaiveAll(val === 'waive')
                              }
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => handleSaveWalletForPlayer(player)}
                            className="h-9 w-full rounded-lg bg-emerald-600 text-white font-semibold text-xs flex items-center justify-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Save &amp; Apply Benefits</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};
