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
  User,
  Users,
  X,
} from 'lucide-react';
import {
  AttendanceOutcome,
  BookingStatus,
  Club,
  ClubPaymentDetails,
  PermissionTier,
  Player,
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
  onAcceptOrClearSingleRsvp: (rsvpId: string, method: string) => Promise<void>;
  onRejectPaymentForRsvp: (rsvpId: string) => Promise<void>;
  onOpenUsersView?: () => void;
}

const PAYMENT_METHODS = [
  'Phone / PayNow',
  'Bank Account Transfer',
  'Cash',
];

const ACTION_BTN =
  'h-8 px-3 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer select-none';

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
  onAcceptOrClearSingleRsvp,
  onRejectPaymentForRsvp,
  onOpenUsersView,
}) => {
  const [localSessionId, setLocalSessionId] = useState<string>(
    selectedSessionId || sessions[0]?.id || ''
  );

  // Payment Info Panel State — opens when user clicks "Pay Share" or "Payment Info"
  const [showPaymentInfoTab, setShowPaymentInfoTab] = useState<boolean>(
    Boolean(initialOpenPayInfo)
  );
  const [payingTargetRsvpId, setPayingTargetRsvpId] = useState<string | null>(
    null
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

  const visibleSessions = useMemo(() => {
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

  const activeSessionId = selectedSessionId || localSessionId;
  const activeSession =
    visibleSessions.find((s) => s.id === activeSessionId) ||
    visibleSessions[0] ||
    null;

  const activeSessionIndex = activeSession
    ? visibleSessions.findIndex((s) => s.id === activeSession.id)
    : -1;

  const handleChangeSession = (nextId: string) => {
    setLocalSessionId(nextId);
    onSelectSession?.(nextId);
    setPayingTargetRsvpId(null);
    setPaymentSubmittedBanner(null);
  };

  const handleOpenPaymentTabForRsvp = (rsvpId: string) => {
    setPayingTargetRsvpId(rsvpId);
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

  // Current session RSVP for the signed-in user (used for single-session payment submission)
  const myActiveSessionRsvp = useMemo(() => {
    if (!activeSession || !activePlayer) return null;
    return (
      rsvps.find(
        (r) => r.sessionId === activeSession.id && r.playerId === activePlayer.id
      ) || null
    );
  }, [activeSession, activePlayer, rsvps]);

  const targetRsvpForPayment = useMemo(() => {
    if (payingTargetRsvpId) {
      return rsvps.find((r) => r.id === payingTargetRsvpId) || null;
    }
    if (
      myActiveSessionRsvp &&
      myActiveSessionRsvp.paidStatus === 'unpaid' &&
      myActiveSessionRsvp.feeShare > 0
    ) {
      return myActiveSessionRsvp;
    }
    return null;
  }, [payingTargetRsvpId, rsvps, myActiveSessionRsvp]);

  const handleConfirmUserPaymentSent = async () => {
    if (!targetRsvpForPayment) return;
    await onNotifyPaymentSentForRsvp(
      targetRsvpForPayment.id,
      selectedTransferMethod
    );
    setPaymentSubmittedBanner(
      `Submitted $${targetRsvpForPayment.feeShare.toFixed(2)} for this session via ${selectedTransferMethod}. Waiting for Admin / Club Owner confirmation.`
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Session Fee Split &amp; Ledger
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {canManageClub
              ? 'Calculate court and shuttlecock splits for the selected session and verify session payments.'
              : 'View your fee breakdown for the selected session and submit payment details.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canManageClub && onOpenUsersView && (
            <button
              type="button"
              onClick={onOpenUsersView}
              className="h-9 px-3.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>Member Balances &amp; Credits →</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowPaymentInfoTab(!showPaymentInfoTab)}
            className={`h-9 px-3.5 text-xs font-semibold rounded-lg border inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showPaymentInfoTab
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5 shrink-0" />
            <span>
              {showPaymentInfoTab ? 'Hide Payment Info' : 'Payment Info'}
            </span>
          </button>
        </div>
      </div>

      {/* PAYMENT METHOD INFO PANEL (Phone Number & Bank Account Fields + Session Payment Submission) */}
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
                Use the Phone Number (PayNow / Mobile Transfer) or Bank Account below to make payment for this session.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {canManageClub && onUpdateClubPaymentDetails && (
                <button
                  type="button"
                  onClick={() => setEditingPaymentConfig(!editingPaymentConfig)}
                  className="h-8 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {editingPaymentConfig ? 'Cancel Edit' : 'Edit Details'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPaymentInfoTab(false)}
                className="h-8 px-2.5 text-xs font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                <span>Close</span>
              </button>
            </div>
          </div>

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
                  className="h-10 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center whitespace-nowrap shrink-0 transition-colors cursor-pointer"
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
                  className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  {copiedField === 'phone' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
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
                  className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  {copiedField === 'bank' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
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

          {/* User Action Bar to Submit Payment Notice for This Session */}
          {activePlayer && targetRsvpForPayment && (
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-800 block">
                  Paying Session Share (${targetRsvpForPayment.feeShare.toFixed(2)})
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
                  className="h-10 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    I Have Paid (${targetRsvpForPayment.feeShare.toFixed(2)})
                  </span>
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Focused Single-Session Selector & Breakdown */}
      <section className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <span className="text-xs font-semibold text-slate-700 shrink-0">
              Select Session:
            </span>
            <div className="w-full sm:w-96">
              <StyledSelect
                aria-label="Select session to view or settle"
                value={activeSession?.id || ''}
                onChange={(e) => handleChangeSession(e.target.value)}
                disabled={visibleSessions.length === 0}
              >
                {visibleSessions.length === 0 ? (
                  <option value="">No sessions available</option>
                ) : (
                  visibleSessions.map((s) => {
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

            {visibleSessions.length > 1 && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={activeSessionIndex <= 0}
                  onClick={() => {
                    if (activeSessionIndex > 0) {
                      handleChangeSession(
                        visibleSessions[activeSessionIndex - 1].id
                      );
                    }
                  }}
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40 cursor-pointer"
                  aria-label="Previous session"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={
                    activeSessionIndex < 0 ||
                    activeSessionIndex >= visibleSessions.length - 1
                  }
                  onClick={() => {
                    if (
                      activeSessionIndex >= 0 &&
                      activeSessionIndex < visibleSessions.length - 1
                    ) {
                      handleChangeSession(
                        visibleSessions[activeSessionIndex + 1].id
                      );
                    }
                  }}
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40 cursor-pointer"
                  aria-label="Next session"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <span className="text-[11px] font-mono tabular-nums text-slate-400 pl-1">
                  {activeSessionIndex + 1}/{visibleSessions.length}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Single Focused Session Breakdown Card */}
        {!activeSession ? (
          <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center">
            <p className="text-xs text-slate-500">
              No sessions recorded yet for this club.
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
            // Normal users ONLY see their own RSVP row; Club Owners & Site Admins see all chargeable RSVPs for this session
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

            // Session-scoped collection metrics (strictly for this selected session)
            const sessionCollectedTotal = isCompleted
              ? chargeableRsvps
                  .filter((r) => r.paidStatus === 'paid')
                  .reduce((sum, r) => sum + r.feeShare, 0)
              : 0;
            const sessionUnpaidTotal = isCompleted
              ? chargeableRsvps
                  .filter((r) => r.paidStatus !== 'paid')
                  .reduce((sum, r) => sum + r.feeShare, 0)
              : 0;
            const sessionPaidCount = isCompleted
              ? chargeableRsvps.filter((r) => r.paidStatus === 'paid').length
              : 0;

            return (
              <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-5">
                {/* Session Header & Session-Scoped KPIs */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span
                        className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                          isCompleted
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {isCompleted ? 'Settled Session' : 'Open Session'}
                      </span>
                      <span className="font-mono tabular-nums font-medium text-slate-700">
                        {session.sessionDate}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {session.venue} ({session.courtNumbers})
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-slate-900 mt-1.5">
                      {session.title}
                    </h2>
                  </div>

                  {/* Session-Only Summary Strip */}
                  <div className="grid grid-cols-2 sm:flex sm:items-center gap-4 sm:gap-6 font-mono tabular-nums">
                    <div>
                      <span className="text-[11px] font-sans text-slate-400 block">
                        Session Total
                      </span>
                      <span className="text-sm font-bold text-slate-900">
                        ${totalSessionFee.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-sans text-slate-400 block">
                        {canManageClub ? 'Per Present Player' : 'Your Session Share'}
                      </span>
                      <span className="text-sm font-bold text-slate-900">
                        $
                        {canManageClub
                          ? samplePresentShare.toFixed(2)
                          : myShareAmount.toFixed(2)}
                      </span>
                    </div>
                    {canManageClub && isCompleted && (
                      <>
                        <div>
                          <span className="text-[11px] font-sans text-slate-400 block">
                            Session Received ({sessionPaidCount}/{chargeableRsvps.length})
                          </span>
                          <span className="text-sm font-bold text-emerald-700">
                            ${sessionCollectedTotal.toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] font-sans text-slate-400 block">
                            Session Due
                          </span>
                          <span
                            className={`text-sm font-bold ${
                              sessionUnpaidTotal > 0
                                ? 'text-amber-700'
                                : 'text-slate-400'
                            }`}
                          >
                            ${sessionUnpaidTotal.toFixed(2)}
                          </span>
                        </div>
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
                          ? 'Adjust Session Court & Shuttle Costs'
                          : 'Finalize Session Court & Shuttle Costs'}
                      </span>
                      <span className="text-slate-500 font-mono tabular-nums">
                        Court ${displayCourtFee.toFixed(2)} + Shuttles $
                        {computedShuttleFee.toFixed(2)} = $
                        {totalSessionFee.toFixed(2)} ({chargeableRsvps.length}{' '}
                        players)
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
                          className="w-full h-10 px-3 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {isCompleted
                            ? `Recalculate ($${totalSessionFee.toFixed(2)})`
                            : `Finalize Split ($${totalSessionFee.toFixed(2)})`}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Session Attendee Split Rows */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <h3 className="font-bold text-slate-900">
                      {canManageClub
                        ? `Session Participant Shares (${visibleRsvpRows.length})`
                        : 'Your Session Fee Breakdown'}
                    </h3>
                    {canManageClub && !isCompleted && (
                      <span className="text-slate-400">
                        Mark any no-shows before clicking Finalize Split
                      </span>
                    )}
                  </div>

                  {visibleRsvpRows.length === 0 ? (
                    <p className="text-xs text-slate-400 py-6 text-center border border-slate-200/70 rounded-lg">
                      No fee share recorded for this session.
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
                            className="px-4 py-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                          >
                            {/* Left: Player Name & Session Attendance / Perk Context */}
                            <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2 min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                <span className="font-semibold text-slate-900 truncate">
                                  {rsvp.playerName}
                                </span>
                                {isSelf && (
                                  <span className="text-[11px] font-medium text-emerald-700 shrink-0">
                                    · You
                                  </span>
                                )}
                                {rsvp.attendanceOutcome === 'no_show' ? (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
                                    No-Show ({activeClub.noShowFeePercent}%)
                                  </span>
                                ) : rsvp.status === 'late_out' ? (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
                                    Late Out ({rsvp.penaltyPercentApplied}%)
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400 shrink-0">
                                    · Present
                                  </span>
                                )}
                                {rsvpPlayer?.waiveAllFees && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                                    VIP Fee Waived
                                  </span>
                                )}
                                {!rsvpPlayer?.waiveAllFees &&
                                  (rsvpPlayer?.freeSessionPasses || 0) > 0 && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                                      {rsvpPlayer?.freeSessionPasses} Free Pass
                                      {rsvpPlayer?.freeSessionPasses === 1
                                        ? ''
                                        : 'es'}
                                    </span>
                                  )}
                                {!rsvpPlayer?.waiveAllFees &&
                                  (rsvpPlayer?.creditBalance || 0) > 0 && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-50 text-sky-800 border border-sky-200 shrink-0">
                                      ${(rsvpPlayer?.creditBalance || 0).toFixed(2)}{' '}
                                      Credit
                                    </span>
                                  )}
                              </div>

                              {/* Mobile Share Amount */}
                              <span className="sm:hidden font-mono tabular-nums text-slate-900 font-bold shrink-0">
                                ${displayShare.toFixed(2)}
                              </span>
                            </div>

                            {/* Right: Attendance (when open) or Payment Verification Actions (when settled) */}
                            <div className="flex flex-wrap items-center justify-end gap-2.5 shrink-0 font-mono tabular-nums">
                              {/* Before session is settled: allow marking Present vs No-Show */}
                              {canManageClub &&
                                !isCompleted &&
                                rsvp.status === 'going' && (
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

                              <span className="hidden sm:inline text-slate-900 font-bold text-xs">
                                ${displayShare.toFixed(2)}
                              </span>

                              {isCompleted && (canManageClub || isSelf) && (
                                <div className="flex flex-wrap items-center justify-end gap-2 font-sans">
                                  {rsvp.paidStatus === 'paid' ? (
                                    <span className="text-emerald-700 font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0">
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
                                    <span className="text-blue-700 font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                                      <Clock className="w-3.5 h-3.5 shrink-0" />
                                      <span>Pending ({rsvp.paidMethod})</span>
                                    </span>
                                  ) : isRejected ? (
                                    <span className="text-red-600 font-semibold whitespace-nowrap shrink-0">
                                      Not Received
                                    </span>
                                  ) : (
                                    <span className="text-amber-700 font-semibold whitespace-nowrap shrink-0">
                                      {rsvp.paidMethod?.startsWith('Credit -')
                                        ? `Unpaid (${rsvp.paidMethod})`
                                        : 'Unpaid'}
                                    </span>
                                  )}

                                  {/* Club Owner / Site Admin Single-Line Action Buttons */}
                                  {canManageClub &&
                                    rsvp.paidStatus !== 'paid' && (
                                      <>
                                        {rsvp.paidStatus ===
                                        'pending_approval' ? (
                                          <div className="inline-flex items-center gap-1.5 shrink-0">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onAcceptOrClearSingleRsvp(
                                                  rsvp.id,
                                                  rsvp.paidMethod || 'Received'
                                                )
                                              }
                                              className={`${ACTION_BTN} text-white bg-emerald-700 hover:bg-emerald-800`}
                                            >
                                              <Check className="w-3.5 h-3.5 shrink-0" />
                                              <span>Received</span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onRejectPaymentForRsvp(rsvp.id)
                                              }
                                              className={`${ACTION_BTN} text-slate-700 bg-slate-100 hover:bg-slate-200`}
                                            >
                                              <X className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                              <span>Not Recv</span>
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="inline-flex items-center gap-1.5 shrink-0">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onAcceptOrClearSingleRsvp(
                                                  rsvp.id,
                                                  'Received'
                                                )
                                              }
                                              className={`${ACTION_BTN} text-white bg-slate-900 hover:bg-slate-800`}
                                            >
                                              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
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
                                              className={`${ACTION_BTN} text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200`}
                                              title="Waive this session fee completely"
                                            >
                                              <Gift className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                              <span>Waive</span>
                                            </button>
                                          </div>
                                        )}
                                      </>
                                    )}

                                  {/* Normal User: Pay Share for This Session */}
                                  {!canManageClub &&
                                    isSelf &&
                                    rsvp.paidStatus === 'unpaid' && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleOpenPaymentTabForRsvp(rsvp.id)
                                        }
                                        className={`${ACTION_BTN} text-white bg-slate-900 hover:bg-slate-800`}
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
    </div>
  );
};
