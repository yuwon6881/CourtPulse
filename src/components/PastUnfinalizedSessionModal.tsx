import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  MapPin,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { BookingStatus, Club, Session, SessionRsvp } from '../types';
import {
  checkSessionFeeInputs,
  computeSessionSplitDetails,
  evaluateFinalizeReadiness,
  formatClubCurrency,
  getClubCurrencySymbol,
  getSessionDateDisplay,
  getSessionGoingHeadcount,
} from '../utils/badmintonLogic';
import { getTimeZoneShortLabel, resolveClubTimeZone } from '../utils/clubTime';
import { backdropClose } from '../utils/backdropClose';
import { ActionResult } from '../utils/walletLedger';
import { StyledInput } from './ui/FormControls';

export interface PastUnfinalizedSessionModalProps {
  open: boolean;
  sessions: Session[];
  clubs: Club[];
  rsvps: SessionRsvp[];
  onFinalizeSession: (
    sessionId: string,
    bookingStatus: BookingStatus,
    courtFee: number,
    shuttlesUsed: number,
    shuttleUnitCost: number,
    courtNumbers: string,
    finalizeSplit: boolean,
    options?: { acknowledgeUnallocated?: boolean }
  ) => Promise<ActionResult>;
  onReviewSession: (sessionId: string) => void;
  onDismiss: () => void;
}

export const PastUnfinalizedSessionModal: React.FC<
  PastUnfinalizedSessionModalProps
> = ({
  open,
  sessions,
  clubs,
  rsvps,
  onFinalizeSession,
  onReviewSession,
  onDismiss,
}) => {
  const [selectedId, setSelectedId] = useState<string>(sessions[0]?.id ?? '');
  const [courtFee, setCourtFee] = useState<number>(0);
  const [shuttlesUsed, setShuttlesUsed] = useState<number>(0);
  const [shuttleUnitCost, setShuttleUnitCost] = useState<number>(3);
  const [ackUnallocated, setAckUnallocated] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeSession = useMemo(() => {
    if (sessions.length === 0) return null;
    return sessions.find((s) => s.id === selectedId) || sessions[0];
  }, [sessions, selectedId]);

  const clubById = useMemo(() => {
    const map = new Map<string, Club>();
    for (const c of clubs) map.set(c.id, c);
    return map;
  }, [clubs]);

  const activeClub = activeSession
    ? clubById.get(activeSession.clubId) || null
    : null;

  // Keep draft inputs synced whenever the selected session changes or modal opens
  useEffect(() => {
    if (!open || !activeSession) return;
    setSelectedId(activeSession.id);
    setCourtFee(activeSession.courtFee);
    setShuttlesUsed(activeSession.shuttlesUsed);
    setShuttleUnitCost(activeSession.shuttleUnitCost);
    setAckUnallocated(false);
    setErrorMsg(null);
  }, [
    open,
    activeSession?.id,
    activeSession?.courtFee,
    activeSession?.shuttlesUsed,
    activeSession?.shuttleUnitCost,
  ]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onDismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, submitting, onDismiss]);

  const sessionRsvps = useMemo(() => {
    if (!activeSession) return [];
    return rsvps.filter((r) => r.sessionId === activeSession.id);
  }, [rsvps, activeSession]);

  const goingHeadcount = useMemo(
    () => getSessionGoingHeadcount(sessionRsvps),
    [sessionRsvps]
  );

  const feeCheck = useMemo(
    () => checkSessionFeeInputs(courtFee, shuttlesUsed, shuttleUnitCost),
    [courtFee, shuttlesUsed, shuttleUnitCost]
  );

  const splitDetails = useMemo(() => {
    if (!activeClub) return null;
    return computeSessionSplitDetails(
      feeCheck.courtFee,
      feeCheck.shuttleFee,
      sessionRsvps,
      activeClub.noShowFeePercent,
      {
        clubOwnerPlayerId: activeClub.clubOwnerPlayerId,
        excludeOwnerFromBilling: activeClub.excludeOwnerFromBilling,
      }
    );
  }, [feeCheck.courtFee, feeCheck.shuttleFee, sessionRsvps, activeClub]);

  const clubTimeZone = resolveClubTimeZone(activeClub?.timezone);
  const readiness = useMemo(() => {
    if (!activeSession) return { canFinalize: false, reason: null };
    return evaluateFinalizeReadiness(activeSession, Date.now(), clubTimeZone);
  }, [activeSession, clubTimeZone]);

  const money = (amount: number) => formatClubCurrency(amount, activeClub);

  const handleConfirmFinalize = async () => {
    if (!activeSession || submitting) return;
    setErrorMsg(null);

    if (!readiness.canFinalize) {
      setErrorMsg(
        readiness.reason || 'This session cannot be finalized yet.'
      );
      return;
    }
    if (!feeCheck.ok) {
      setErrorMsg(feeCheck.error);
      return;
    }
    if (splitDetails?.hasUnallocated && !ackUnallocated) {
      setErrorMsg(
        'Part of the cost is not charged to anyone. Tick the confirmation box above to finalize anyway.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await onFinalizeSession(
        activeSession.id,
        'completed',
        feeCheck.courtFee,
        feeCheck.shuttlesUsed,
        feeCheck.shuttleUnitCost,
        activeSession.courtNumbers,
        true,
        { acknowledgeUnallocated: ackUnallocated }
      );
      if (!result.ok) {
        setErrorMsg(result.reason);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const chargedShares = useMemo(() => {
    if (!splitDetails) return [];
    return Array.from(splitDetails.splits.values())
      .map((entry) => entry.feeShare)
      .filter((amt) => amt > 0);
  }, [splitDetails]);

  const poolTotal = Number(
    (feeCheck.courtFee + feeCheck.shuttleFee).toFixed(2)
  );
  const dateInfo = activeSession
    ? getSessionDateDisplay(activeSession.sessionDate)
    : null;

  return (
    <AnimatePresence>
      {open && activeSession && dateInfo && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="past-unfinalized-modal-title"
          {...backdropClose(() => {
            if (!submitting) onDismiss();
          })}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: 0.96,
              y: 16,
              transition: { duration: 0.12, ease: 'easeIn' },
            }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border-t sm:border border-slate-200/90 dark:border-slate-800 shadow-2xl shadow-slate-950/20 dark:shadow-black/60 w-full sm:max-w-lg max-h-[90dvh] flex flex-col overflow-hidden"
          >
            {/* Mobile Drag Handle */}
            <div
              className="sm:hidden pt-2.5 pb-0.5 flex justify-center shrink-0"
              aria-hidden="true"
            >
              <div className="w-9 h-1 rounded-full bg-slate-300/90 dark:bg-slate-700" />
            </div>

            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800/90 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl border border-amber-200/80 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <CalendarClock className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="past-unfinalized-modal-title"
                    className="text-base font-bold text-slate-900 dark:text-white font-display leading-snug"
                  >
                    {sessions.length > 1
                      ? `Finalize Past Sessions (${sessions.length})`
                      : 'Finalize Past Session?'}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    This session&apos;s scheduled time has passed and its fee
                    split is still pending.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={onDismiss}
                className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all active:scale-95 cursor-pointer shrink-0 disabled:opacity-50"
                aria-label="Close finalize prompt"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-4">
              {/* Session switcher when multiple past sessions are pending */}
              {sessions.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {sessions.map((s) => {
                    const isActive = s.id === activeSession.id;
                    const sDate = getSessionDateDisplay(s.sessionDate);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={submitting}
                        onClick={() => setSelectedId(s.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap border transition-colors cursor-pointer shrink-0 ${
                          isActive
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-400 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
                            : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {sDate.monthShort} {sDate.dayNum} · {s.title}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Session summary card */}
              <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-950/60 p-3.5 flex items-start gap-3">
                <div
                  className="w-12 h-12 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white flex flex-col items-center justify-center shrink-0 select-none"
                  aria-label={dateInfo.fullLabel}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-none">
                    {dateInfo.weekdayShort}
                  </span>
                  <span className="text-sm font-bold font-mono tabular-nums leading-none mt-1">
                    {dateInfo.dayNum}
                  </span>
                  <span className="text-[9px] font-semibold uppercase text-slate-500 dark:text-slate-400 leading-none mt-0.5">
                    {dateInfo.monthShort}
                  </span>
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white font-display leading-snug break-words">
                    {activeSession.title}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      <Clock className="w-3 h-3 shrink-0 text-slate-400" />
                      {activeSession.startTime}–{activeSession.endTime}{' '}
                      <span className="font-sans text-[10px] text-slate-500 dark:text-slate-400">
                        {getTimeZoneShortLabel(clubTimeZone)}
                      </span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 break-words">
                      <MapPin className="w-3 h-3 shrink-0 text-slate-400" />
                      {activeSession.venue}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                      <Users className="w-3 h-3 shrink-0 text-slate-400" />
                      {goingHeadcount} going
                    </span>
                    {activeClub && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{activeClub.name}</span>
                      </>
                    )}
                    {activeSession.bookingStatus === 'pending' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-700 dark:text-amber-400 font-semibold">
                          Proposed (Unbooked)
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Cost confirmation inputs */}
              {readiness.canFinalize ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2.5">
                    <StyledInput
                      label="Court Fee"
                      prefixText={getClubCurrencySymbol(activeClub)}
                      type="number"
                      min={0}
                      step="0.01"
                      value={courtFee}
                      disabled={submitting}
                      onChange={(e) =>
                        setCourtFee(parseFloat(e.target.value) || 0)
                      }
                      className="font-mono tabular-nums"
                    />
                    <StyledInput
                      label="Shuttles"
                      type="number"
                      min={0}
                      max={1000}
                      step={1}
                      value={shuttlesUsed}
                      disabled={submitting}
                      onChange={(e) =>
                        setShuttlesUsed(
                          Math.max(0, parseInt(e.target.value, 10) || 0)
                        )
                      }
                      className="font-mono tabular-nums"
                    />
                    <StyledInput
                      label="Unit Cost"
                      prefixText={getClubCurrencySymbol(activeClub)}
                      type="number"
                      min={0}
                      step="0.01"
                      value={shuttleUnitCost}
                      disabled={submitting}
                      onChange={(e) =>
                        setShuttleUnitCost(parseFloat(e.target.value) || 0)
                      }
                      className="font-mono tabular-nums"
                    />
                  </div>

                  {/* Live split preview */}
                  <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/40 px-3.5 py-2.5 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
                      <span className="text-emerald-900 dark:text-emerald-200 font-semibold">
                        Total Pool
                      </span>
                      <span className="font-bold text-emerald-950 dark:text-emerald-100">
                        {money(poolTotal)}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono tabular-nums text-emerald-800 dark:text-emerald-300">
                      {chargedShares.length}{' '}
                      {chargedShares.length === 1
                        ? 'participant'
                        : 'participants'}{' '}
                      billed
                      {chargedShares.length > 0
                        ? ` · est. ${money(chargedShares[0])}/player`
                        : ''}
                    </p>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Finalizing locks attendance, calculates each player&apos;s
                    fee share, and automatically applies eligible VIP waivers,
                    free passes, and club credits. Need to mark a no-show first?
                    Tap <strong>Review Session</strong>.
                  </p>

                  {feeCheck.notice && (
                    <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                      {feeCheck.notice}
                    </p>
                  )}

                  {!feeCheck.ok && (
                    <p
                      role="alert"
                      className="text-xs text-rose-700 dark:text-rose-400 font-semibold"
                    >
                      {feeCheck.error}
                    </p>
                  )}

                  {feeCheck.ok && splitDetails?.hasUnallocated && (
                    <label className="flex items-start gap-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ackUnallocated}
                        onChange={(e) => setAckUnallocated(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        {money(splitDetails.unallocatedAmount)} of this cost
                        will not be charged to anyone (nobody is marked present
                        or billable). Tick to finalize anyway.
                      </span>
                    </label>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/50 px-3.5 py-3 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    {readiness.reason ||
                      'Review this session to confirm court booking before finalizing its fee split.'}
                  </p>
                </div>
              )}

              {errorMsg && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300"
                >
                  {errorMsg}
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="shrink-0 px-4 sm:px-6 py-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-slate-100 dark:border-slate-800/90 bg-slate-50/75 dark:bg-slate-950/60 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={onDismiss}
                className="w-full sm:w-auto min-h-[42px] sm:min-h-[36px] px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
              >
                Not Now
              </button>

              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => onReviewSession(activeSession.id)}
                  className="w-full sm:w-auto min-h-[42px] sm:min-h-[36px] px-3.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1 transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                >
                  <span>Review Session</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>

                {readiness.canFinalize && (
                  <button
                    type="button"
                    disabled={submitting || !feeCheck.ok}
                    onClick={() => void handleConfirmFinalize()}
                    className="w-full sm:w-auto min-h-[42px] sm:min-h-[36px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer shadow-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{submitting ? 'Finalizing...' : 'Finalize Split'}</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
