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
  Minus,
  Phone,
  Plus,
  ShieldCheck,
  User,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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
  countCourts,
  evaluateCourtBookingAdvice,
  formatCourtCount,
} from '../utils/courtAdvice';
import { CourtSuggestion } from './CourtSuggestion';
import {
  ConfirmModal,
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
  onNotifyPaymentSentForRsvp: (rsvpId: string, method?: string) => Promise<void>;
  onAcceptOrClearSingleRsvp: (rsvpId: string, method?: string) => Promise<void>;
  onRejectPaymentForRsvp: (rsvpId: string) => Promise<void>;
  onOpenUsersView?: () => void;
}

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
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [paymentSubmittedBanner, setPaymentSubmittedBanner] = useState<
    string | null
  >(null);
  const [confirmFinalizeOpen, setConfirmFinalizeOpen] = useState(false);
  const [pendingRejectRsvp, setPendingRejectRsvp] =
    useState<SessionRsvp | null>(null);
  const [pendingWaiveRsvp, setPendingWaiveRsvp] =
    useState<SessionRsvp | null>(null);
  const [pendingNoShowRsvp, setPendingNoShowRsvp] =
    useState<SessionRsvp | null>(null);

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

  const rsvpsBySessionId = useMemo(() => {
    const map = new Map<string, SessionRsvp[]>();
    for (const r of rsvps) {
      const list = map.get(r.sessionId);
      if (list) list.push(r);
      else map.set(r.sessionId, [r]);
    }
    return map;
  }, [rsvps]);

  const playerById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) {
      map.set(p.id, p);
    }
    return map;
  }, [players]);

  const visibleSessions = useMemo(() => {
    if (canManageClub) return sessions;
    if (!activePlayer) return [];
    const myChargeableSessionIds = new Set<string>();
    for (const r of rsvps) {
      if (
        r.playerId === activePlayer.id &&
        (r.status === 'going' ||
          (r.status === 'late_out' && r.penaltyPercentApplied > 0))
      ) {
        myChargeableSessionIds.add(r.sessionId);
      }
    }
    return sessions.filter((s) => myChargeableSessionIds.has(s.id));
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
    patch: Partial<ReturnType<typeof getDraft>>
  ) => {
    const current = getDraft(session);
    setDrafts((prev) => ({
      ...prev,
      [session.id]: {
        ...current,
        ...prev[session.id],
        ...patch,
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
      'Submitted'
    );
    setPaymentSubmittedBanner(
      `Submitted $${targetRsvpForPayment.feeShare.toFixed(2)} for this session. Waiting for Admin / Club Owner confirmation.`
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display">
            Session Fee Split &amp; Ledger
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {canManageClub
              ? 'Calculate court and shuttlecock splits for the selected session and verify session payments.'
              : 'View your fee breakdown for the selected session and submit payment details.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowPaymentInfoTab(true)}
            className="h-10 px-4 text-xs font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
          >
            <CreditCard className="w-4 h-4 shrink-0" />
            <span>Payment Info &amp; PayNow</span>
          </button>
        </div>
      </div>

      {/* PAYMENT METHOD INFO MODAL */}
      <AnimatePresence>
        {showPaymentInfoTab && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShowPaymentInfoTab(false)}
          >
            <motion.section
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              ref={paymentInfoRef}
              aria-label="Payment Method Information"
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-7 space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-200/80">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base sm:text-lg font-bold text-slate-950 font-display">
                      Payment Methods &amp; Bank Account Info — {activeClub.name}
                    </h2>
                    {savedPaymentConfigNotice && (
                      <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        Saved
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Use the Phone Number (PayNow / Mobile Transfer) or Bank Account below to make payment for this session.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {canManageClub && onUpdateClubPaymentDetails && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditingPaymentConfig(!editingPaymentConfig)
                      }
                      className="h-9 px-3.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
                    className="h-9 px-3.5 text-xs font-semibold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-xl inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <X className="w-4 h-4 shrink-0" />
                    <span>Close</span>
                  </button>
                </div>
              </div>

              {canManageClub && editingPaymentConfig ? (
                <form
                  onSubmit={handleSavePaymentConfig}
                  className="p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      className="h-10 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center justify-center whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                    >
                      Save Payment Info
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Card 1: Phone Number */}
                    <div className="p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <Phone className="w-4 h-4 text-emerald-700 shrink-0" />
                          <span>Phone Number (PayNow / Mobile)</span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyField('phone', resolvedDetails.phoneNumber)
                          }
                          className="h-8 px-3 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer shadow-2xs"
                        >
                          {copiedField === 'phone' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="space-y-1">
                        <p className="font-mono tabular-nums text-lg sm:text-xl font-bold text-slate-950 tracking-tight break-all">
                          {resolvedDetails.phoneNumber}
                        </p>
                        <p className="text-xs font-medium text-slate-700 break-words">
                          Recipient: <span className="font-semibold text-slate-900">{resolvedDetails.recipientName}</span>
                        </p>
                      </div>
                    </div>

                    {/* Card 2: Bank Account */}
                    <div className="p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <Building2 className="w-4 h-4 text-emerald-700 shrink-0" />
                          <span>Bank Account ({resolvedDetails.bankName})</span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyField(
                              'bank',
                              resolvedDetails.bankAccountNumber
                            )
                          }
                          className="h-8 px-3 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer shadow-2xs"
                        >
                          {copiedField === 'bank' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="space-y-1">
                        <p className="font-mono tabular-nums text-lg sm:text-xl font-bold text-slate-950 tracking-tight break-all">
                          {resolvedDetails.bankAccountNumber}
                        </p>
                        <p className="text-xs font-medium text-slate-700 break-words">
                          Account Holder: <span className="font-semibold text-slate-900">{resolvedDetails.recipientName}</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Recipient & Reference Note */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <User className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>Transfer Instructions &amp; Reference</span>
                      </span>
                      <p className="text-xs sm:text-sm text-slate-700">
                        Pay to <span className="font-bold text-slate-950">{resolvedDetails.recipientName}</span> · {resolvedDetails.paymentNotes}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* User Action Bar to Submit Payment Notice for This Session */}
              {activePlayer && targetRsvpForPayment && (
                <div className="pt-4 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 block">
                      Paying Session Share (${targetRsvpForPayment.feeShare.toFixed(2)})
                    </span>
                    <p className="text-xs text-slate-600">
                      Once you have transferred the amount via Phone or Bank Account, submit below so the Admin/Owner can confirm receipt.
                    </p>
                    {paymentSubmittedBanner && (
                      <p className="text-xs font-semibold text-emerald-700 pt-1">
                        {paymentSubmittedBanner}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-end gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleConfirmUserPaymentSent}
                      className="w-full sm:w-auto h-10 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer shadow-xs"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        I Have Paid (${targetRsvpForPayment.feeShare.toFixed(2)})
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Focused Single-Session Selector & Breakdown */}
      <section className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <span className="text-xs font-semibold text-slate-800 shrink-0">
              Select Session:
            </span>
            <div className="w-full sm:w-80 md:w-96 flex-1 max-w-full">
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
              <div className="inline-flex items-center gap-1.5 shrink-0">
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
                  className="h-10 w-10 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 disabled:opacity-40 cursor-pointer shadow-2xs"
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
                  className="h-10 w-10 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 disabled:opacity-40 cursor-pointer shadow-2xs"
                  aria-label="Next session"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono tabular-nums font-medium text-slate-600 pl-1">
                  {activeSessionIndex + 1}/{visibleSessions.length}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Single Focused Session Breakdown Card */}
        {!activeSession ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center">
            <p className="text-xs text-slate-600">
              No sessions recorded yet for this club.
            </p>
          </div>
        ) : (
          (() => {
            const session = activeSession;
            const draft = getDraft(session);
            const sessionRsvps = rsvpsBySessionId.get(session.id) || [];
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
              activeClub.noShowFeePercent,
              {
                clubOwnerPlayerId: activeClub.clubOwnerPlayerId,
                excludeOwnerFromBilling: activeClub.excludeOwnerFromBilling,
              }
            );

            const myRsvp = activePlayer
              ? chargeableRsvps.find((r) => r.playerId === activePlayer.id)
              : undefined;
            const myShareAmount = myRsvp
              ? activeClub.excludeOwnerFromBilling &&
                myRsvp.playerId === activeClub.clubOwnerPlayerId
                ? 0
                : isCompleted
                ? myRsvp.feeShare
                : previewSplits.get(myRsvp.id)?.feeShare || 0
              : 0;

            const presentSample = sessionRsvps.find(
              (r) =>
                r.status === 'going' &&
                r.attendanceOutcome === 'present' &&
                (!activeClub.excludeOwnerFromBilling ||
                  r.playerId !== activeClub.clubOwnerPlayerId)
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
              <motion.div
                key={session.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 space-y-5 shadow-2xs"
              >
                {/* Session Header & Session-Scoped KPIs (Zero-Pill Metadata) */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span
                        className={`font-bold ${
                          isCompleted ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {isCompleted ? '● Settled Session' : '● Open Session'}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-slate-800">
                        {session.sessionDate}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-medium text-slate-700">
                        {session.venue} ({session.courtNumbers})
                      </span>
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 mt-1 font-display">
                      {session.title}
                    </h2>
                  </div>

                  {/* Session-Only Summary Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:flex lg:items-center gap-4 sm:gap-6 font-mono tabular-nums">
                    <div>
                      <span className="text-[11px] font-sans font-semibold text-slate-600 block">
                        Session Total
                      </span>
                      <span className="text-base font-bold text-slate-900">
                        ${totalSessionFee.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] font-sans font-semibold text-slate-600 block">
                        {canManageClub ? 'Per Present Player' : 'Your Session Share'}
                      </span>
                      <span className="text-base font-bold text-slate-900">
                        $
                        {canManageClub
                          ? samplePresentShare.toFixed(2)
                          : myShareAmount.toFixed(2)}
                      </span>
                    </div>
                    {canManageClub && isCompleted && (
                      <>
                        <div>
                          <span className="text-[11px] font-sans font-semibold text-slate-600 block">
                            Session Received ({sessionPaidCount}/{chargeableRsvps.length})
                          </span>
                          <span className="text-base font-bold text-emerald-700">
                            ${sessionCollectedTotal.toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] font-sans font-semibold text-slate-600 block">
                            Session Due
                          </span>
                          <span
                            className={`text-base font-bold ${
                              sessionUnpaidTotal > 0
                                ? 'text-amber-700'
                                : 'text-slate-500'
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
                  <div className="p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-900">
                        {isCompleted
                          ? 'Adjust Session Court & Shuttle Costs'
                          : 'Finalize Session Court & Shuttle Costs'}
                      </span>
                      <span className="text-slate-700 font-mono tabular-nums font-semibold">
                        Court ${displayCourtFee.toFixed(2)} + Shuttles $
                        {computedShuttleFee.toFixed(2)} = $
                        {totalSessionFee.toFixed(2)} ({chargeableRsvps.length}{' '}
                        players)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 items-end">
                      <StyledInput
                        label="Court Fee"
                        hint="Total for all courts"
                        prefixText="$"
                        type="number"
                        min={0}
                        step={1}
                        value={draft.courtFee}
                        onChange={(e) =>
                          updateDraft(session, { courtFee: parseFloat(e.target.value) || 0 })
                        }
                        className="font-mono tabular-nums"
                      />

                      <StyledInput
                        label="Courts"
                        hint={(() => {
                          const count = countCourts(draft.courtNumbers);
                          return count === null ? 'Count unknown' : formatCourtCount(count);
                        })()}
                        type="text"
                        maxLength={60}
                        placeholder="e.g. Court 3 & 4"
                        value={draft.courtNumbers}
                        onChange={(e) =>
                          updateDraft(session, { courtNumbers: e.target.value })
                        }
                      />

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-800">
                            Shuttles Used (pcs)
                          </span>
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                updateDraft(session, { shuttlesUsed: Math.max(0, draft.shuttlesUsed - 1) })
                              }
                              className="h-6 w-6 rounded-md bg-white border border-slate-300 hover:bg-slate-100 hover:border-slate-400 shadow-2xs flex items-center justify-center text-slate-700 cursor-pointer active:scale-95 transition-all"
                              title="Decrease shuttles by 1"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateDraft(session, { shuttlesUsed: draft.shuttlesUsed + 1 })
                              }
                              className="h-6 w-6 rounded-md bg-white border border-slate-300 hover:bg-slate-100 hover:border-slate-400 shadow-2xs flex items-center justify-center text-slate-700 cursor-pointer active:scale-95 transition-all"
                              title="Increase shuttles by 1"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <StyledInput
                          suffixText="pcs"
                          type="number"
                          min={0}
                          max={200}
                          step={1}
                          value={draft.shuttlesUsed}
                          onChange={(e) =>
                            updateDraft(session, { shuttlesUsed: parseInt(e.target.value, 10) || 0 })
                          }
                          className="font-mono tabular-nums font-bold"
                        />
                      </div>

                      <StyledInput
                        label="Unit Price"
                        prefixText="$"
                        type="number"
                        min={0}
                        step={0.5}
                        value={draft.shuttleUnitCost}
                        onChange={(e) =>
                          updateDraft(session, { shuttleUnitCost: parseFloat(e.target.value) || 0 })
                        }
                        className="font-mono tabular-nums"
                      />

                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => setConfirmFinalizeOpen(true)}
                          className="w-full h-10 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                        >
                          {isCompleted
                            ? `Recalculate ($${totalSessionFee.toFixed(2)})`
                            : `Finalize Split ($${totalSessionFee.toFixed(2)})`}
                        </button>
                      </div>
                    </div>

                    {session.bookingStatus === 'pending' &&
                      (() => {
                        // Advice reads the draft so edits to fee or courts update it immediately.
                        const advice = evaluateCourtBookingAdvice(
                          {
                            ...session,
                            courtFee: draft.courtFee,
                            courtNumbers: draft.courtNumbers,
                          },
                          sessionRsvps,
                          activeClub,
                          { history: sessions }
                        );
                        return (
                          <CourtSuggestion
                            advice={advice}
                            currentFee={draft.courtFee}
                            applied={
                              advice.totalCost === draft.courtFee &&
                              countCourts(draft.courtNumbers) ===
                                advice.recommendedCourts
                            }
                            onApply={(courts, totalCost) =>
                              updateDraft(session, {
                                courtFee: totalCost,
                                courtNumbers:
                                  countCourts(draft.courtNumbers) === courts
                                    ? draft.courtNumbers
                                    : formatCourtCount(courts),
                              })
                            }
                          />
                        );
                      })()}
                  </div>
                )}

                {/* Session Attendee Split Rows */}
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <h3 className="font-bold text-slate-900">
                      {canManageClub
                        ? `Session Participant Shares (${visibleRsvpRows.length})`
                        : 'Your Session Fee Breakdown'}
                    </h3>
                    {canManageClub && !isCompleted && (
                      <span className="text-slate-600 font-medium">
                        Mark any no-shows before clicking Finalize Split
                      </span>
                    )}
                  </div>

                  {visibleRsvpRows.length === 0 ? (
                    <p className="text-xs text-slate-600 py-6 text-center border border-slate-200/70 rounded-xl">
                      No fee share recorded for this session.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden bg-white">
                      {/* Desktop Column Alignment Header */}
                      <div className="hidden sm:flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <span className="flex-1 min-w-0">
                          Participant &amp; Attendance
                        </span>
                        <div className="flex items-center justify-end gap-3 shrink-0">
                          <span className="text-right">Actions</span>
                          <span className="w-40 pl-3.5 border-l border-slate-200/70 text-left">
                            {isCompleted ? 'Payment Status' : 'Split Status'}
                          </span>
                          <span className="w-20 text-right">Share</span>
                        </div>
                      </div>

                      {visibleRsvpRows.map((rsvp) => {
                        const isSelf = rsvp.playerId === activePlayer?.id;
                        const isClubOwnerRow =
                          Boolean(activeClub.clubOwnerPlayerId) &&
                          rsvp.playerId === activeClub.clubOwnerPlayerId;
                        const isOwnerExcluded =
                          isClubOwnerRow &&
                          Boolean(activeClub.excludeOwnerFromBilling);
                        const rsvpPlayer = playerById.get(rsvp.playerId);
                        const displayShare = isOwnerExcluded
                          ? 0
                          : isCompleted
                          ? rsvp.feeShare
                          : previewSplits.get(rsvp.id)?.feeShare || 0;
                        const effectivePaidStatus = isClubOwnerRow
                          ? 'paid'
                          : rsvp.paidStatus;
                        const isRejected =
                          effectivePaidStatus === 'unpaid' &&
                          rsvp.paidMethod === 'Rejected';

                        const paidSubtitle = isOwnerExcluded
                          ? 'Owner Excluded'
                          : isClubOwnerRow
                          ? 'Club Owner'
                          : rsvp.paidMethod &&
                            (rsvp.paidMethod.startsWith('Fee Waived') ||
                              rsvp.paidMethod.startsWith('Free Session') ||
                              rsvp.paidMethod.startsWith('Credit'))
                          ? rsvp.paidMethod
                          : null;

                        return (
                          <div
                            key={rsvp.id}
                            className="px-4 py-3.5 bg-white hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                          >
                            {/* Left: Player Name & Session Attendance / Perk Context (Zero-Pill Inline Typography) */}
                            <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2 min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                <span className="font-semibold text-slate-900 break-words">
                                  {rsvp.playerName}
                                </span>
                                {isSelf && (
                                  <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                                    · You
                                  </span>
                                )}
                                {isClubOwnerRow && (
                                  <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                                    ·{' '}
                                    {isOwnerExcluded
                                      ? 'Club Owner (Excluded $0)'
                                      : 'Club Owner'}
                                  </span>
                                )}
                                {rsvp.attendanceOutcome === 'no_show' ? (
                                  <span className="text-[11px] font-semibold text-amber-700 shrink-0">
                                    · No-Show ({activeClub.noShowFeePercent}%)
                                  </span>
                                ) : rsvp.status === 'late_out' ? (
                                  <span className="text-[11px] font-semibold text-amber-700 shrink-0">
                                    · Late Out ({rsvp.penaltyPercentApplied}%)
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-medium text-slate-600 shrink-0">
                                    · Present
                                  </span>
                                )}
                                {rsvpPlayer?.waiveAllFees && (
                                  <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                                    · VIP Fee Waived
                                  </span>
                                )}
                                {!rsvpPlayer?.waiveAllFees &&
                                  (rsvpPlayer?.freeSessionPasses || 0) > 0 && (
                                    <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                                      · {rsvpPlayer?.freeSessionPasses} Free Pass
                                      {rsvpPlayer?.freeSessionPasses === 1
                                        ? ''
                                        : 'es'}
                                    </span>
                                  )}
                                {!rsvpPlayer?.waiveAllFees &&
                                  (rsvpPlayer?.creditBalance || 0) > 0 && (
                                    <span className="text-[11px] font-mono font-semibold text-sky-700 shrink-0">
                                      · ${(rsvpPlayer?.creditBalance || 0).toFixed(2)}{' '}
                                      Credit
                                    </span>
                                  )}
                              </div>

                              {/* Mobile Share Amount */}
                              <span className="sm:hidden font-mono tabular-nums text-slate-900 font-bold text-sm shrink-0">
                                ${displayShare.toFixed(2)}
                              </span>
                            </div>

                            {/* Right: Actions Column (Left) + Fixed-Width Aligned Status Column (Middle) + Share Amount Column (Right) */}
                            <div className="flex flex-wrap sm:flex-nowrap items-center justify-between sm:justify-end gap-3 shrink-0">
                              {/* COLUMN 1: Interactive Action Controls (placed BEFORE Status so buttons never push Status alignment) */}
                              <div className="flex items-center justify-end gap-1.5 order-2 sm:order-1 shrink-0">
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
                                      onChange={(val) => {
                                        if (
                                          val === 'no_show' &&
                                          rsvp.attendanceOutcome !== 'no_show'
                                        ) {
                                          setPendingNoShowRsvp(rsvp);
                                        } else {
                                          onMarkAttendanceOutcome(rsvp.id, val);
                                        }
                                      }}
                                    />
                                  )}

                                {/* Club Owner / Site Admin Action Buttons when settled */}
                                {isCompleted &&
                                  canManageClub &&
                                  !isClubOwnerRow &&
                                  effectivePaidStatus !== 'paid' && (
                                    <>
                                      {effectivePaidStatus ===
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
                                            className="h-8 px-3 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer select-none shadow-2xs text-white bg-emerald-600 hover:bg-emerald-700"
                                          >
                                            <Check className="w-3.5 h-3.5 shrink-0" />
                                            <span>Received</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setPendingRejectRsvp(rsvp)
                                            }
                                            className="h-8 px-3 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer select-none shadow-2xs text-slate-700 bg-slate-100 hover:bg-slate-200"
                                          >
                                            <X className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                            <span>Not Received</span>
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
                                            className="h-8 px-3 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer select-none shadow-2xs text-white bg-slate-900 hover:bg-slate-800"
                                          >
                                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                                            <span>Received</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setPendingWaiveRsvp(rsvp)
                                            }
                                            className="h-8 px-3 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer select-none shadow-2xs text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200"
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
                                {isCompleted &&
                                  !canManageClub &&
                                  !isClubOwnerRow &&
                                  isSelf &&
                                  effectivePaidStatus === 'unpaid' && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleOpenPaymentTabForRsvp(rsvp.id)
                                      }
                                      className="h-8 px-3 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer select-none shadow-2xs text-white bg-emerald-600 hover:bg-emerald-700"
                                    >
                                      <CreditCard className="w-3.5 h-3.5 shrink-0" />
                                      <span>
                                        {isRejected ? 'Pay Again' : 'Pay Share'}
                                      </span>
                                    </button>
                                  )}
                              </div>

                              {/* COLUMN 2: Vertically Aligned Payment Status Column */}
                              <div className="order-1 sm:order-2 sm:w-40 sm:pl-3.5 sm:border-l sm:border-slate-100 flex flex-col items-start justify-center font-sans shrink-0">
                                {!isCompleted ? (
                                  <>
                                    <span className="text-slate-700 font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                                      <span>Open Split</span>
                                    </span>
                                    <span className="text-[11px] text-slate-500 truncate max-w-full">
                                      {isOwnerExcluded
                                        ? 'Owner Excluded'
                                        : 'Preview share'}
                                    </span>
                                  </>
                                ) : effectivePaidStatus === 'paid' ? (
                                  <>
                                    <span className="text-emerald-700 font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                      <span>Received</span>
                                    </span>
                                    {paidSubtitle && (
                                      <span className="text-[11px] text-slate-500 font-medium truncate max-w-full">
                                        {paidSubtitle}
                                      </span>
                                    )}
                                  </>
                                ) : effectivePaidStatus ===
                                  'pending_approval' ? (
                                  <>
                                    <span className="text-blue-700 font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                                      <Clock className="w-3.5 h-3.5 shrink-0" />
                                      <span>Pending</span>
                                    </span>
                                    <span className="text-[11px] text-slate-500 truncate max-w-full">
                                      Awaiting verification
                                    </span>
                                  </>
                                ) : isRejected ? (
                                  <>
                                    <span className="text-red-600 font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                                      <X className="w-3.5 h-3.5 shrink-0" />
                                      <span>Not Received</span>
                                    </span>
                                    <span className="text-[11px] text-red-500 truncate max-w-full">
                                      Please verify transfer
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-amber-700 font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                                      <span>Unpaid</span>
                                    </span>
                                    {rsvp.paidMethod?.startsWith('Credit -') && (
                                      <span className="text-[11px] text-sky-700 font-medium truncate max-w-full">
                                        {rsvp.paidMethod}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>

                              {/* COLUMN 3: Vertically Aligned Share Amount Column */}
                              <span className="hidden sm:inline-block sm:order-3 w-20 text-right font-mono tabular-nums text-slate-900 font-bold text-sm shrink-0">
                                ${displayShare.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })()
        )}
      </section>

      {/* Confirmation Modal: Finalize or Recalculate Session Split */}
      {activeSession && (
        <ConfirmModal
          open={confirmFinalizeOpen}
          title={
            activeSession.bookingStatus === 'completed' &&
            activeSession.feeSplitFinalized
              ? 'Recalculate Session Fee Split?'
              : 'Finalize Session Fee Split?'
          }
          description={(() => {
            const draft = getDraft(activeSession);
            const shuttleTotal = Number(
              (draft.shuttlesUsed * draft.shuttleUnitCost).toFixed(2)
            );
            const poolTotal = draft.courtFee + shuttleTotal;
            return (
              <div className="space-y-1.5">
                <p>
                  {activeSession.bookingStatus === 'completed' &&
                  activeSession.feeSplitFinalized
                    ? 'Update the finalized court and shuttle costs for '
                    : 'Lock attendance and calculate individual fee shares for '}
                  <strong className="font-semibold text-slate-900">
                    {activeSession.title}
                  </strong>{' '}
                  ({activeSession.sessionDate})?
                </p>
                <p className="font-mono tabular-nums text-slate-800 font-semibold">
                  Court ${draft.courtFee.toFixed(2)} + Shuttles $
                  {shuttleTotal.toFixed(2)} ({draft.shuttlesUsed} pcs) = Total $
                  {poolTotal.toFixed(2)}
                </p>
                <p className="text-slate-600">
                  Eligible VIP waivers, free session passes, and prepaid club
                  credits will be applied automatically.
                </p>
              </div>
            );
          })()}
          confirmLabel={
            activeSession.bookingStatus === 'completed' &&
            activeSession.feeSplitFinalized
              ? 'Confirm Recalculate'
              : 'Finalize Split'
          }
          variant="primary"
          onCancel={() => setConfirmFinalizeOpen(false)}
          onConfirm={async () => {
            const draft = getDraft(activeSession);
            setConfirmFinalizeOpen(false);
            await onFinalizeSessionShuttleAndSplit(
              activeSession.id,
              'completed',
              draft.courtFee,
              draft.shuttlesUsed,
              draft.shuttleUnitCost,
              draft.courtNumbers,
              true
            );
          }}
        />
      )}

      {/* Confirmation Modal: Reject Pending Payment */}
      <ConfirmModal
        open={Boolean(pendingRejectRsvp)}
        title="Mark Payment as Not Received?"
        description={
          pendingRejectRsvp ? (
            <p>
              Return{' '}
              <strong className="font-semibold text-slate-900">
                {pendingRejectRsvp.playerName}
              </strong>
              &rsquo;s{' '}
              <strong className="font-mono font-semibold text-slate-900">
                ${pendingRejectRsvp.feeShare.toFixed(2)}
              </strong>{' '}
              session share to Unpaid status? They will be notified to submit
              payment again.
            </p>
          ) : null
        }
        confirmLabel="Mark Not Received"
        variant="danger"
        onCancel={() => setPendingRejectRsvp(null)}
        onConfirm={async () => {
          if (!pendingRejectRsvp) return;
          const target = pendingRejectRsvp;
          setPendingRejectRsvp(null);
          await onRejectPaymentForRsvp(target.id);
        }}
      />

      {/* Confirmation Modal: Waive Session Fee */}
      <ConfirmModal
        open={Boolean(pendingWaiveRsvp)}
        title="Waive Session Fee Share?"
        description={
          pendingWaiveRsvp ? (
            <p>
              Waive{' '}
              <strong className="font-semibold text-slate-900">
                {pendingWaiveRsvp.playerName}
              </strong>
              &rsquo;s{' '}
              <strong className="font-mono font-semibold text-slate-900">
                ${pendingWaiveRsvp.feeShare.toFixed(2)}
              </strong>{' '}
              fee share for this session and mark it as settled?
            </p>
          ) : null
        }
        confirmLabel="Confirm Waive Fee"
        variant="warning"
        onCancel={() => setPendingWaiveRsvp(null)}
        onConfirm={async () => {
          if (!pendingWaiveRsvp) return;
          const target = pendingWaiveRsvp;
          setPendingWaiveRsvp(null);
          await onAcceptOrClearSingleRsvp(target.id, 'Fee Waived');
        }}
      />

      {/* Confirmation Modal: Mark Player as No-Show */}
      <ConfirmModal
        open={Boolean(pendingNoShowRsvp)}
        title="Mark Player as No-Show?"
        description={
          pendingNoShowRsvp ? (
            <p>
              Mark{' '}
              <strong className="font-semibold text-slate-900">
                {pendingNoShowRsvp.playerName}
              </strong>{' '}
              as a No-Show for this session? Under club policy, No-Show players
              are billed{' '}
              <strong className="font-semibold text-slate-900">
                {activeClub.noShowFeePercent}%
              </strong>{' '}
              of a court share.
            </p>
          ) : null
        }
        confirmLabel="Confirm No-Show"
        variant="warning"
        onCancel={() => setPendingNoShowRsvp(null)}
        onConfirm={async () => {
          if (!pendingNoShowRsvp) return;
          const target = pendingNoShowRsvp;
          setPendingNoShowRsvp(null);
          await onMarkAttendanceOutcome(target.id, 'no_show');
        }}
      />
    </div>
  );
};
