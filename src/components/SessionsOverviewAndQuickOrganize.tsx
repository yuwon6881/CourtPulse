import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  MapPin,
  Plus,
  Repeat,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { BadmintonMatchIcon } from './ui/BadmintonIcons';
import { AnimatePresence, motion } from 'motion/react';
import {
  BadmintonMatch,
  BookingStatus,
  CloneSessionOverrides,
  Club,
  ParsedQuickSession,
  PaymentTiming,
  PermissionTier,
  Player,
  RsvpStatus,
  Session,
  SessionRsvp,
} from '../types';
import {
  describePaymentTiming,
  PAYMENT_TIMING_OPTIONS,
} from '../utils/paymentTiming';
import { describeWalletPaidMethod } from '../utils/walletPreview';
import {
  evaluateJoinWindow,
  evaluateTapOutWindow,
  getPlayerSideInMatch,
  getRsvpGuestCount,
  getSessionDateDisplay,
  getSessionEndTimestampMs,
  getSessionGoingHeadcount,
  isPlayerInMatch,
  isSessionCompletedOrPast,
  formatClubCurrency,
  getClubCurrencySymbol,
  parseQuickSessionInput,
  TapRsvpResult,
} from '../utils/badmintonLogic';
import {
  copyTextReliable,
  createOrReuseShortInviteUrl,
} from '../utils/shortInvite';
import { getTimeZoneShortLabel, resolveClubTimeZone } from '../utils/clubTime';
import {
  buildSessionDefaultsFromHistory,
  suggestCourtFeeFromHistory,
} from '../utils/sessionDefaults';
import {
  buildCloneSessionDraft,
  computeEndTimeFromDuration,
  computeSessionCollectionSummary,
  doesPastSessionNeedAction,
  filterPastSessions,
  getDurationMinutes,
  HistoryFilterMode,
  isClubMatchHistoryAndStandingsEnabled,
} from '../utils/sessionFlowHelpers';
import {
  ConfirmModal,
  SegmentedControl,
  StyledInput,
  StyledTimePicker,
} from './ui/FormControls';
import { backdropClose } from '../utils/backdropClose';
import { ActionResult } from '../utils/walletLedger';

interface SessionsOverviewAndQuickOrganizeProps {
  activeClub: Club;
  clubs?: Club[];
  isAllClubsFilter?: boolean;
  sessions: Session[];
  rsvps: SessionRsvp[];
  matches: BadmintonMatch[];
  activePlayer: Player | null;
  isAdmin: boolean;
  permissionTier?: PermissionTier;
  onCreateSession: (
    sessionData: Omit<Session, 'id' | 'ownerId'>
  ) => Promise<Session>;
  onTapRsvp?: (
    sessionId: string,
    player: Player,
    status: RsvpStatus,
    penaltyPercent?: number,
    guestCount?: number
  ) => Promise<TapRsvpResult>;
  onOpenSessionDetail: (sessionId: string, openPayInfo?: boolean) => void;
  onOpenMatchScorerForSession: (sessionId: string) => void;
  onCloneNextWeekSession: (
    session: Session,
    overrides?: CloneSessionOverrides
  ) => Promise<Session | void>;
  onDeleteSession?: (sessionId: string) => Promise<ActionResult | void>;
  showQuickOrganizerRef?: React.RefObject<HTMLDivElement | null>;
}

const QUICK_PROMPT_EXAMPLE = 'e.g. Sat 7pm-9pm, $90 court, max 12';

export const SessionsOverviewAndQuickOrganize: React.FC<
  SessionsOverviewAndQuickOrganizeProps
> = ({
  activeClub,
  clubs = [],
  isAllClubsFilter = false,
  sessions,
  rsvps,
  matches,
  activePlayer,
  isAdmin,
  permissionTier = 'user',
  onCreateSession,
  onTapRsvp,
  onOpenSessionDetail,
  onOpenMatchScorerForSession,
  onCloneNextWeekSession,
  onDeleteSession,
  showQuickOrganizerRef,
}) => {
  // Club Owners (for their owned club) and Site Admins (in Admin view) can schedule or clone sessions.
  const canManageClub = (club: Club): boolean => {
    if (!activePlayer || permissionTier === 'user') return false;
    if (permissionTier === 'admin' || isAdmin) return true;
    return club.clubOwnerPlayerId === activePlayer.id;
  };

  const ownedClub: Club | null = useMemo(() => {
    if (!activePlayer || permissionTier === 'user') return null;
    if (permissionTier === 'admin') {
      return activeClub;
    }
    return (
      clubs.find((c) => c.clubOwnerPlayerId === activePlayer.id) ||
      (activeClub.clubOwnerPlayerId === activePlayer.id ? activeClub : null)
    );
  }, [clubs, activeClub, activePlayer, permissionTier]);

  const canScheduleSession = Boolean(
    ownedClub &&
      (permissionTier === 'admin' ||
        isAllClubsFilter ||
        activeClub.id === ownedClub.id)
  );

  const [showOrganizerForm, setShowOrganizerForm] = useState<boolean>(false);
  const [quickText, setQuickText] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedQuickSession>(() =>
    parseQuickSessionInput('')
  );
  // Once the organizer types a fee, stop replacing it with the history estimate.
  const [feeTouched, setFeeTouched] = useState(false);
  const [paymentTiming, setPaymentTiming] = useState<PaymentTiming>('after');
  const [formErrors, setFormErrors] = useState<{
    venue?: string;
    courtNumbers?: string;
    sessionDate?: string;
    startTime?: string;
    endTime?: string;
    courtFee?: string;
    maxPlayers?: string;
  }>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [cloneSourceSession, setCloneSourceSession] =
    useState<Session | null>(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);
  const [pendingDeleteSession, setPendingDeleteSession] =
    useState<Session | null>(null);
  const [deleteSessionError, setDeleteSessionError] = useState<string | null>(
    null
  );
  const [recentlyPublishedSession, setRecentlyPublishedSession] =
    useState<Session | null>(null);
  const [quickJoinBusyId, setQuickJoinBusyId] = useState<string | null>(null);
  const [quickJoinError, setQuickJoinError] = useState<string | null>(null);
  const [viewSection, setViewSection] = useState<'upcoming' | 'history'>(
    'upcoming'
  );
  const [futureFilter, setFutureFilter] = useState<'all' | 'joined_only'>('all');
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterMode>('all');

  const [visibleUpcomingCount, setVisibleUpcomingCount] = useState(12);
  const [visiblePastCount, setVisiblePastCount] = useState(12);

  // Pre-index clubs, RSVPs, and matches by sessionId in O(C + R + M)
  const { clubByIdMap, rsvpsBySessionIdMap, matchesBySessionIdMap } =
    useMemo(() => {
      const cMap = new Map<string, Club>();
      for (let i = 0; i < clubs.length; i++) {
        cMap.set(clubs[i].id, clubs[i]);
      }

      const rMap = new Map<string, SessionRsvp[]>();
      for (let i = 0; i < rsvps.length; i++) {
        const r = rsvps[i];
        const list = rMap.get(r.sessionId);
        if (list) list.push(r);
        else rMap.set(r.sessionId, [r]);
      }

      const mMap = new Map<string, BadmintonMatch[]>();
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const list = mMap.get(m.sessionId);
        if (list) list.push(m);
        else mMap.set(m.sessionId, [m]);
      }

      return {
        clubByIdMap: cMap,
        rsvpsBySessionIdMap: rMap,
        matchesBySessionIdMap: mMap,
      };
    }, [clubs, rsvps, matches]);

  const chosenClubId = ownedClub?.id || activeClub.id;
  const historyDefaults = useMemo(
    () =>
      buildSessionDefaultsFromHistory(
        sessions,
        chosenClubId,
        undefined,
        resolveClubTimeZone(ownedClub?.timezone || activeClub.timezone)
      ),
    [sessions, chosenClubId, ownedClub?.timezone, activeClub.timezone]
  );

  const feeSuggestionFor = (draft: ParsedQuickSession, clubId: string) =>
    suggestCourtFeeFromHistory(sessions, { clubId, ...draft });

  const withSuggestedFee = (
    draft: ParsedQuickSession,
    clubId: string = chosenClubId,
    touched: boolean = feeTouched
  ): ParsedQuickSession => {
    if (touched || draft.courtFeeFromText) return draft;
    const suggestion = feeSuggestionFor(draft, clubId);
    return suggestion ? { ...draft, courtFee: suggestion.courtFee } : draft;
  };

  const updateParsed = (patch: Partial<ParsedQuickSession>) =>
    setParsed((prev) => withSuggestedFee({ ...prev, ...patch }));

  const resetOrganizerForClub = (clubId: string) => {
    const club = clubByIdMap.get(clubId) || activeClub;
    const defaults =
      buildSessionDefaultsFromHistory(
        sessions,
        clubId,
        undefined,
        resolveClubTimeZone(club.timezone)
      ) ?? {};
    setQuickText('');
    setFeeTouched(false);
    setPaymentTiming('after');
    setFormErrors({});
    setParsed(
      withSuggestedFee(
        parseQuickSessionInput('', defaults, new Date(), resolveClubTimeZone(club.timezone)),
        clubId,
        false
      )
    );
  };

  const handleOpenOrganizer = () => {
    if (showOrganizerForm && !cloneSourceSession) {
      setShowOrganizerForm(false);
      return;
    }
    setCloneSourceSession(null);
    resetOrganizerForClub(chosenClubId);
    setShowOrganizerForm(true);
  };

  const handleOpenCloneModal = (session: Session) => {
    const draft = buildCloneSessionDraft(session);
    setCloneSourceSession(session);
    setQuickText('');
    setFeeTouched(true);
    setPaymentTiming(draft.paymentTiming);
    setFormErrors({});
    setParsed(draft);
    setShowOrganizerForm(true);
  };

  const closeSessionModal = () => {
    setShowOrganizerForm(false);
    setCloneSourceSession(null);
    setFormErrors({});
  };

  const handleQuickTextChange = (val: string) => {
    setQuickText(val);
    const next = parseQuickSessionInput(
      val,
      historyDefaults ?? {},
      new Date(),
      resolveClubTimeZone(ownedClub?.timezone || activeClub.timezone)
    );
    if (next.courtFeeFromText) setFeeTouched(false);
    setParsed((prev) =>
      feeTouched && !next.courtFeeFromText
        ? { ...next, courtFee: prev.courtFee }
        : withSuggestedFee(next, chosenClubId, false)
    );
  };

  const feeSuggestion = feeSuggestionFor(parsed, chosenClubId);
  const feeHint =
    parsed.courtFeeFromText || feeTouched
      ? feeSuggestion
        ? `Avg ${formatClubCurrency(feeSuggestion.courtFee, ownedClub)}`
        : undefined
      : feeSuggestion
      ? `Est. ${feeSuggestion.courts}c × ${feeSuggestion.hours}h`
      : undefined;

  const getClubForSession = (session: Session): Club => {
    return clubByIdMap.get(session.clubId) || activeClub;
  };

  const modalTargetClub = cloneSourceSession
    ? getClubForSession(cloneSourceSession)
    : ownedClub;

  const canSubmitModal = Boolean(
    modalTargetClub &&
      (cloneSourceSession
        ? canManageClub(modalTargetClub)
        : canScheduleSession)
  );

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitModal || !modalTargetClub || isSubmittingModal) return;
    const chosenClub = modalTargetClub;

    const nextErrors: typeof formErrors = {};
    if (!parsed.venue.trim()) {
      nextErrors.venue = 'Please enter a venue name.';
    }
    if (parsed.bookingStatus !== 'pending' && !parsed.courtNumbers.trim()) {
      nextErrors.courtNumbers = 'Enter booked court numbers or switch status to Proposed.';
    }
    if (!parsed.sessionDate) {
      nextErrors.sessionDate = 'Please select a session date.';
    }
    if (!parsed.startTime.trim()) {
      nextErrors.startTime = 'Enter a start time (e.g. 20:00).';
    }
    if (!parsed.endTime.trim()) {
      nextErrors.endTime = 'Enter an end time (e.g. 22:00).';
    }
    if (Number.isNaN(parsed.courtFee) || parsed.courtFee < 0) {
      nextErrors.courtFee = `Court fee must be ${formatClubCurrency(0, chosenClub)} or more.`;
    }
    if (
      Number.isNaN(parsed.maxPlayers) ||
      parsed.maxPlayers < 2 ||
      parsed.maxPlayers > 32
    ) {
      nextErrors.maxPlayers = 'Max players must be between 2 and 32.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors);
      return;
    }

    setFormErrors({});
    setIsSubmittingModal(true);
    try {
      if (cloneSourceSession) {
        setCloningId(cloneSourceSession.id);
        const created = await onCloneNextWeekSession(cloneSourceSession, {
          title: parsed.title.trim() || cloneSourceSession.title,
          venue: parsed.venue.trim() || chosenClub.name,
          courtNumbers:
            parsed.bookingStatus === 'pending'
              ? 'TBD'
              : parsed.courtNumbers.trim() || 'Court 1',
          sessionDate: parsed.sessionDate,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          bookingStatus: parsed.bookingStatus,
          courtFee: parsed.courtFee,
          maxPlayers: parsed.maxPlayers,
          paymentTiming,
        });
        setTimeout(() => setCloningId(null), 800);
        closeSessionModal();
        setViewSection('upcoming');
        setFutureFilter('all');
        if (created) {
          setRecentlyPublishedSession(created);
        }
        return;
      }

      const created = await onCreateSession({
        clubId: chosenClub.id,
        title: parsed.title.trim() || 'Club Session',
        venue: parsed.venue.trim() || chosenClub.name,
        courtNumbers:
          parsed.bookingStatus === 'pending'
            ? 'TBD'
            : parsed.courtNumbers.trim() || 'Court 1',
        sessionDate: parsed.sessionDate || '2026-10-22',
        startTime: parsed.startTime || '20:00',
        endTime: parsed.endTime || '22:00',
        bookingStatus: parsed.bookingStatus,
        courtFee: parsed.courtFee,
        shuttlesUsed: 0,
        shuttleUnitCost: historyDefaults?.shuttleUnitCost ?? 3.0,
        shuttleFee: 0,
        maxPlayers: parsed.maxPlayers,
        organizerName: activePlayer?.name || 'Organizer',
        paymentInfo: chosenClub.paymentInfo,
        feeSplitFinalized: false,
        paymentTiming,
      });
      closeSessionModal();
      setViewSection('upcoming');
      setFutureFilter('all');
      setRecentlyPublishedSession(created);
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const handleQuickJoinSession = async (
    e: React.MouseEvent,
    session: Session
  ) => {
    e.stopPropagation();
    if (!onTapRsvp || !activePlayer || quickJoinBusyId) return;
    setQuickJoinError(null);
    setQuickJoinBusyId(session.id);
    try {
      const res = await onTapRsvp(session.id, activePlayer, 'going', 100, 0);
      if (!res.ok) {
        setQuickJoinError(res.reason);
      }
    } finally {
      setQuickJoinBusyId(null);
    }
  };

  const handleCopyInviteSnippet = async (
    e: React.MouseEvent,
    session: Session
  ) => {
    e.stopPropagation();
    // Just the link: the full group-chat message lives on the session page
    const sessionClub = getClubForSession(session);
    const ok = await copyTextReliable(
      createOrReuseShortInviteUrl({
        clubId: sessionClub.id,
        session,
        club: sessionClub,
      })
    );
    if (ok) {
      setCopiedId(session.id);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Session times are wall-clock in the session's CLUB zone, not the viewer's device zone
  const zoneOfSession = (s: Session): string =>
    resolveClubTimeZone(clubByIdMap.get(s.clubId)?.timezone);
  const futureSessions = useMemo(
    () =>
      sessions
        .filter((s) => !isSessionCompletedOrPast(s, nowMs, zoneOfSession(s)))
        .sort((a, b) => {
          const tA = getSessionEndTimestampMs(a, zoneOfSession(a));
          const tB = getSessionEndTimestampMs(b, zoneOfSession(b));
          if (tA !== null && tB !== null && tA !== tB) return tA - tB;
          return a.sessionDate.localeCompare(b.sessionDate);
        }),
    [sessions, nowMs, clubByIdMap]
  );
  const pastSessions = useMemo(
    () =>
      sessions
        .filter((s) => isSessionCompletedOrPast(s, nowMs, zoneOfSession(s)))
        .sort((a, b) => {
          const tA = getSessionEndTimestampMs(a, zoneOfSession(a));
          const tB = getSessionEndTimestampMs(b, zoneOfSession(b));
          if (tA !== null && tB !== null && tA !== tB) return tB - tA;
          return b.sessionDate.localeCompare(a.sessionDate);
        }),
    [sessions, nowMs, clubByIdMap]
  );

  const displayedFutureSessions = useMemo(() => {
    return futureSessions.filter((s) => {
      if (futureFilter === 'all' || !activePlayer) return true;
      const sessRsvps = rsvpsBySessionIdMap.get(s.id) || [];
      const myRsvp = sessRsvps.find((r) => r.playerId === activePlayer.id);
      return myRsvp?.status === 'going';
    });
  }, [futureSessions, futureFilter, activePlayer, rsvpsBySessionIdMap]);

  const historyNeedsActionCount = useMemo(
    () =>
      pastSessions.filter((s) =>
        doesPastSessionNeedAction(s, {
          activePlayerId: activePlayer?.id ?? null,
          rsvpsBySessionId: rsvpsBySessionIdMap,
          clubById: clubByIdMap,
          canManageClub,
          fallbackClub: activeClub,
        })
      ).length,
    [pastSessions, activePlayer?.id, rsvpsBySessionIdMap, clubByIdMap, activeClub, permissionTier, isAdmin]
  );

  const displayedPastSessions = useMemo(() => {
    return filterPastSessions(pastSessions, {
      query: historySearch,
      filter: historyFilter,
      activePlayerId: activePlayer?.id ?? null,
      rsvpsBySessionId: rsvpsBySessionIdMap,
      clubById: clubByIdMap,
      canManageClub,
      fallbackClub: activeClub,
    });
  }, [
    pastSessions,
    historySearch,
    historyFilter,
    activePlayer?.id,
    rsvpsBySessionIdMap,
    clubByIdMap,
    activeClub,
    permissionTier,
    isAdmin,
  ]);

  const visibleFutureSessions = useMemo(
    () => displayedFutureSessions.slice(0, visibleUpcomingCount),
    [displayedFutureSessions, visibleUpcomingCount]
  );

  const visiblePastSessions = useMemo(
    () => displayedPastSessions.slice(0, visiblePastCount),
    [displayedPastSessions, visiblePastCount]
  );

  const latestClubSessionForPreset = useMemo(() => {
    const clubOnly = sessions.filter((s) => s.clubId === chosenClubId);
    if (clubOnly.length === 0) return null;
    return [...clubOnly].sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))[0];
  }, [sessions, chosenClubId]);

  const activeDurationMinutes = getDurationMinutes(parsed.startTime, parsed.endTime);
  const estShareAtFullCapacity =
    parsed.courtFee > 0 && parsed.maxPlayers > 0
      ? parsed.courtFee / parsed.maxPlayers
      : 0;

  return (
    <div className="space-y-6">
      {/* Clean Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-200/80 dark:border-slate-800/90">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-display">
            Court Sessions
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {isAllClubsFilter
              ? `All Joined Clubs (${clubs.length})`
              : activeClub.name}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-2.5">
          <div className="w-full sm:w-auto min-w-0">
            <SegmentedControl
              size="sm"
              fullWidth
              options={[
                {
                  value: 'upcoming_all',
                  label: 'Upcoming',
                  count: futureSessions.length,
                },
                {
                  value: 'upcoming_joined',
                  label: 'Going',
                  count: futureSessions.filter((s) =>
                    rsvps.some(
                      (r) =>
                        r.sessionId === s.id &&
                        r.playerId === activePlayer?.id &&
                        r.status === 'going'
                    )
                  ).length,
                },
                {
                  value: 'history',
                  label: 'Completed',
                  count: pastSessions.length,
                },
              ]}
              value={
                viewSection === 'history'
                  ? 'history'
                  : futureFilter === 'joined_only'
                  ? 'upcoming_joined'
                  : 'upcoming_all'
              }
              onChange={(val) => {
                if (val === 'history') {
                  setViewSection('history');
                  setFutureFilter('all');
                } else if (val === 'upcoming_joined') {
                  setViewSection('upcoming');
                  setFutureFilter('joined_only');
                } else {
                  setViewSection('upcoming');
                  setFutureFilter('all');
                }
              }}
            />
          </div>

          {/* Club Owner-Only Session Creation Trigger */}
          {canScheduleSession && ownedClub && (
            <button
              type="button"
              onClick={handleOpenOrganizer}
              className="w-full sm:w-auto h-10 sm:h-9 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 shadow-xs rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-all duration-150 active:scale-[0.97] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Schedule Session</span>
            </button>
          )}
        </div>
      </div>

      {/* Club Owner-Only Session Organizer / Clone (+7d) Modal */}
      <AnimatePresence>
        {canSubmitModal && modalTargetClub && showOrganizerForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            {...backdropClose(closeSessionModal)}
          >
            <motion.section
              ref={showQuickOrganizerRef}
              aria-label={cloneSourceSession ? 'Clone Session (+7d)' : 'Organize Session'}
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16, transition: { duration: 0.12, ease: 'easeIn' } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border-t sm:border border-slate-200/90 dark:border-slate-800 shadow-2xl shadow-slate-950/20 dark:shadow-black/60 w-full sm:max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden"
            >
              {/* Mobile Drag Handle */}
              <div className="sm:hidden flex justify-center pt-2.5 pb-0.5 shrink-0" aria-hidden="true">
                <span className="w-9 h-1 rounded-full bg-slate-300/90 dark:bg-slate-700" />
              </div>

              <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800/90 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white font-display leading-snug">
                    {cloneSourceSession ? 'Clone Session (+7d)' : 'Schedule Session'}
                  </h2>
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mt-0.5 truncate">
                    {modalTargetClub.name}
                    {cloneSourceSession
                      ? ` · From ${cloneSourceSession.sessionDate}`
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeSessionModal}
                  className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 shrink-0 cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form
                noValidate
                onSubmit={handleCreateSubmit}
                className="flex flex-col flex-1 min-h-0"
              >
                <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-4">
                {cloneSourceSession ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 rounded-xl px-3.5 py-2.5">
                    Defaulted to <strong className="font-semibold text-slate-900 dark:text-white">Proposed</strong> (not yet booked). Fill in any uncertain details below—typing court numbers switches the session to Booked.
                  </p>
                ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="quick-input"
                      className="text-xs font-semibold text-slate-800 dark:text-slate-200"
                    >
                      Quick Summary
                    </label>
                    {latestClubSessionForPreset && (
                      <button
                        type="button"
                        onClick={() => {
                          const src = latestClubSessionForPreset;
                          setFeeTouched(true);
                          setParsed((prev) => ({
                            ...prev,
                            title: src.title,
                            venue: src.venue,
                            courtNumbers:
                              src.bookingStatus === 'booked' ? src.courtNumbers : prev.courtNumbers,
                            startTime: src.startTime,
                            endTime: src.endTime,
                            courtFee: src.courtFee,
                            maxPlayers: src.maxPlayers,
                            bookingStatus:
                              src.bookingStatus === 'booked' ? 'booked' : 'pending',
                          }));
                        }}
                        className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Repeat className="w-3 h-3" />
                        <span>Reuse last session setup</span>
                      </button>
                    )}
                  </div>
                  <StyledInput
                    id="quick-input"
                    type="text"
                    value={quickText}
                    onChange={(e) => handleQuickTextChange(e.target.value)}
                    placeholder={QUICK_PROMPT_EXAMPLE}
                  />
                </div>
                )}

                {/* Title + Booking Status Toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 sm:gap-4 items-end">
                  <div className="sm:col-span-7">
                    <StyledInput
                      label="Session Title"
                      type="text"
                      maxLength={80}
                      placeholder="e.g. Thursday Evening Rotation"
                      value={parsed.title}
                      onChange={(e) => updateParsed({ title: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-5 space-y-1.5">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Booking Status
                    </span>
                    <SegmentedControl
                      size="sm"
                      fullWidth
                      options={[
                        { value: 'booked', label: 'Booked' },
                        { value: 'pending', label: 'Proposed' },
                      ]}
                      value={parsed.bookingStatus}
                      onChange={(val) => {
                        const nextStatus = val as BookingStatus;
                        updateParsed({
                          bookingStatus: nextStatus,
                          courtNumbers:
                            nextStatus === 'pending' ? '' : parsed.courtNumbers,
                        });
                        if (nextStatus === 'pending' && formErrors.courtNumbers) {
                          setFormErrors((prev) => ({
                            ...prev,
                            courtNumbers: undefined,
                          }));
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 sm:gap-4">
                  <div className="sm:col-span-7">
                    <StyledInput
                      label="Venue"
                      type="text"
                      maxLength={120}
                      value={parsed.venue}
                      error={formErrors.venue}
                      onChange={(e) => {
                        updateParsed({ venue: e.target.value });
                        if (formErrors.venue)
                          setFormErrors((prev) => ({ ...prev, venue: undefined }));
                      }}
                    />
                  </div>

                  <div className="sm:col-span-5 space-y-1">
                    <StyledInput
                      label="Courts"
                      type="text"
                      maxLength={60}
                      placeholder={
                        parsed.bookingStatus === 'pending'
                          ? 'TBD (enter courts if booked)'
                          : cloneSourceSession &&
                              cloneSourceSession.courtNumbers &&
                              cloneSourceSession.courtNumbers !== 'TBD'
                            ? `e.g. ${cloneSourceSession.courtNumbers}`
                            : 'e.g. Courts 1 & 2'
                      }
                      value={
                        parsed.bookingStatus === 'pending'
                          ? ''
                          : parsed.courtNumbers
                      }
                      error={
                        parsed.bookingStatus === 'pending'
                          ? undefined
                          : formErrors.courtNumbers
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        updateParsed({
                          courtNumbers: val,
                          ...(val.trim() && parsed.bookingStatus === 'pending'
                            ? { bookingStatus: 'booked' as BookingStatus }
                            : {}),
                        });
                        if (formErrors.courtNumbers)
                          setFormErrors((prev) => ({
                            ...prev,
                            courtNumbers: undefined,
                          }));
                      }}
                    />
                    {cloneSourceSession &&
                      cloneSourceSession.courtNumbers &&
                      cloneSourceSession.courtNumbers !== 'TBD' &&
                      parsed.courtNumbers.trim() !== cloneSourceSession.courtNumbers && (
                        <button
                          type="button"
                          onClick={() => {
                            updateParsed({
                              bookingStatus: 'booked',
                              courtNumbers: cloneSourceSession.courtNumbers,
                            });
                            if (formErrors.courtNumbers)
                              setFormErrors((prev) => ({
                                ...prev,
                                courtNumbers: undefined,
                              }));
                          }}
                          className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                        >
                          Use previous ({cloneSourceSession.courtNumbers})
                        </button>
                      )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-12 gap-3 sm:gap-4">
                  <div className="col-span-2 sm:col-span-4">
                    <StyledInput
                      label="Session Date"
                      hint={getSessionDateDisplay(parsed.sessionDate).weekdayLong}
                      type="date"
                      value={parsed.sessionDate}
                      error={formErrors.sessionDate}
                      onChange={(e) => {
                        updateParsed({ sessionDate: e.target.value });
                        if (formErrors.sessionDate)
                          setFormErrors((prev) => ({
                            ...prev,
                            sessionDate: undefined,
                          }));
                      }}
                      className="font-mono"
                    />
                  </div>

                  <div className="col-span-1 sm:col-span-4">
                    <StyledTimePicker
                      label="Start Time"
                      value={parsed.startTime}
                      error={formErrors.startTime}
                      onChange={(e) => {
                        const nextStart = e.target.value;
                        const preservedDuration = activeDurationMinutes || 120;
                        updateParsed({
                          startTime: nextStart,
                          endTime: computeEndTimeFromDuration(
                            nextStart,
                            preservedDuration
                          ),
                        });
                        if (formErrors.startTime)
                          setFormErrors((prev) => ({
                            ...prev,
                            startTime: undefined,
                          }));
                      }}
                    />
                  </div>

                  <div className="col-span-1 sm:col-span-4 space-y-1.5">
                    <StyledTimePicker
                      label="End Time"
                      value={parsed.endTime}
                      error={formErrors.endTime}
                      onChange={(e) => {
                        updateParsed({ endTime: e.target.value });
                        if (formErrors.endTime)
                          setFormErrors((prev) => ({
                            ...prev,
                            endTime: undefined,
                          }));
                      }}
                    />
                    <div className="flex items-center gap-1">
                      {[
                        { label: '1.5h', mins: 90 },
                        { label: '2h', mins: 120 },
                        { label: '3h', mins: 180 },
                      ].map((preset) => {
                        const isSelected = activeDurationMinutes === preset.mins;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() =>
                              updateParsed({
                                endTime: computeEndTimeFromDuration(
                                  parsed.startTime,
                                  preset.mins
                                ),
                              })
                            }
                            className={`flex-1 h-6 rounded-md text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-600 text-white shadow-2xs'
                                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-12 gap-3 sm:gap-4">
                  <div className="col-span-1 sm:col-span-6">
                    <StyledInput
                      label="Court Fee"
                      hint={feeHint}
                      prefixText={getClubCurrencySymbol(modalTargetClub)}
                      type="number"
                      min={0}
                      value={parsed.courtFee}
                      error={formErrors.courtFee}
                      onChange={(e) => {
                        setFeeTouched(true);
                        setParsed({
                          ...parsed,
                          courtFee: parseFloat(e.target.value) || 0,
                        });
                        if (formErrors.courtFee)
                          setFormErrors((prev) => ({
                            ...prev,
                            courtFee: undefined,
                          }));
                      }}
                      className="font-mono tabular-nums"
                    />
                  </div>

                  <div className="col-span-1 sm:col-span-6 space-y-1.5">
                    <StyledInput
                      label="Max Players"
                      type="number"
                      min={2}
                      max={32}
                      value={parsed.maxPlayers}
                      error={formErrors.maxPlayers}
                      onChange={(e) => {
                        updateParsed({
                          maxPlayers: parseInt(e.target.value, 10) || 0,
                        });
                        if (formErrors.maxPlayers)
                          setFormErrors((prev) => ({
                            ...prev,
                            maxPlayers: undefined,
                          }));
                      }}
                      className="font-mono tabular-nums"
                    />
                    <div className="flex items-center gap-1">
                      {[6, 8, 12, 16].map((cap) => (
                        <button
                          key={cap}
                          type="button"
                          onClick={() => updateParsed({ maxPlayers: cap })}
                          className={`flex-1 h-6 rounded-md text-[11px] font-mono font-semibold transition-colors cursor-pointer ${
                            parsed.maxPlayers === cap
                              ? 'bg-emerald-600 text-white shadow-2xs'
                              : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {cap}p
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Collect Payment
                  </label>
                  <SegmentedControl
                    size="sm"
                    fullWidth
                    value={paymentTiming}
                    onChange={setPaymentTiming}
                    options={PAYMENT_TIMING_OPTIONS}
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {describePaymentTiming(paymentTiming)}
                  </p>
                </div>

                {/* Live Cost Split Preview */}
                {parsed.maxPlayers > 0 && (
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600 dark:text-slate-400">
                      Est. court share at full roster ({parsed.maxPlayers} players)
                    </span>
                    <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                      {estShareAtFullCapacity > 0
                        ? `~${formatClubCurrency(estShareAtFullCapacity, modalTargetClub)} / player`
                        : 'Fee TBD'}
                    </span>
                  </div>
                )}
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 px-4 sm:px-6 py-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-slate-100 dark:border-slate-800/90 bg-slate-50/75 dark:bg-slate-950/60 shrink-0">
                  <button
                    type="button"
                    onClick={closeSessionModal}
                    className="w-full sm:w-auto h-11 sm:h-10 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 sm:bg-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 sm:border-transparent rounded-xl inline-flex items-center justify-center transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingModal}
                    className="w-full sm:w-auto h-11 sm:h-10 px-5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 border border-emerald-700/20 dark:border-emerald-500/40 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/20 shadow-[0_1px_2px_rgba(6,78,59,0.22),inset_0_1px_0_rgba(255,255,255,0.16)] dark:shadow-xs cursor-pointer disabled:opacity-60"
                  >
                    {cloneSourceSession ? (
                      <Repeat className="w-4 h-4" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    <span>
                      {cloneSourceSession
                        ? parsed.bookingStatus === 'pending'
                          ? 'Clone Proposed Session (+7d)'
                          : 'Clone Session (+7d)'
                        : parsed.bookingStatus === 'pending'
                        ? 'Publish Proposed Session'
                        : 'Publish Session'}
                    </span>
                  </button>
                </div>
              </form>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Post-Publish Quick Action Banner */}
      <AnimatePresence>
        {recentlyPublishedSession && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            role="status"
            className="rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/50 border border-emerald-300/80 dark:border-emerald-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-start sm:items-center gap-2.5 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
              <div className="min-w-0">
                <p className="font-bold text-emerald-950 dark:text-emerald-100 truncate">
                  Published: {recentlyPublishedSession.title}
                </p>
                <p className="text-emerald-800 dark:text-emerald-300 font-mono tabular-nums text-[11px]">
                  {recentlyPublishedSession.sessionDate} · {recentlyPublishedSession.startTime}–
                  {recentlyPublishedSession.endTime} · {recentlyPublishedSession.venue}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={(e) => handleCopyInviteSnippet(e, recentlyPublishedSession)}
                className="h-8 px-3 rounded-lg bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:bg-emerald-100/70 dark:hover:bg-emerald-900/50"
              >
                {copiedId === recentlyPublishedSession.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Invite Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Invite</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetId = recentlyPublishedSession.id;
                  setRecentlyPublishedSession(null);
                  onOpenSessionDetail(targetId);
                }}
                className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer shadow-2xs"
              >
                <span>Open Session</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Dismiss published notice"
                onClick={() => setRecentlyPublishedSession(null)}
                className="h-8 w-8 rounded-lg hover:bg-emerald-200/60 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 inline-flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {quickJoinError && (
        <div
          role="alert"
          className="rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 px-3.5 py-2.5 text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2"
        >
          <span>{quickJoinError}</span>
          <button
            type="button"
            onClick={() => setQuickJoinError(null)}
            className="text-rose-600 dark:text-rose-300 hover:underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* UPCOMING SESSIONS VIEW */}
      <AnimatePresence mode="wait">
        {viewSection === 'upcoming' ? (
          <motion.section
            key={`upcoming-${futureFilter}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            aria-label="Upcoming Sessions"
            className="space-y-3.5"
          >
            {displayedFutureSessions.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-8 sm:p-10 text-center space-y-3 shadow-xs">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 font-display">
                  {futureFilter === 'joined_only'
                    ? 'You have not joined any upcoming sessions yet.'
                    : 'No upcoming sessions scheduled.'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  {futureFilter === 'joined_only'
                    ? 'Switch to All Upcoming to browse open sessions and tap Join.'
                    : canScheduleSession
                    ? isAllClubsFilter || isClubMatchHistoryAndStandingsEnabled(activeClub)
                      ? 'Schedule your next court booking or review past sessions to finalize splits and log matches.'
                      : 'Schedule your next court booking or review past sessions to finalize splits.'
                    : 'Check back soon for new sessions, or browse completed sessions for fee receipts.'}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {futureFilter === 'joined_only' && futureSessions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setFutureFilter('all')}
                      className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer shadow-2xs"
                    >
                      Show All Upcoming ({futureSessions.length})
                    </button>
                  )}
                  {canScheduleSession && ownedClub && (
                    <button
                      type="button"
                      onClick={handleOpenOrganizer}
                      className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Schedule Session</span>
                    </button>
                  )}
                  {pastSessions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setViewSection('history');
                        setFutureFilter('all');
                      }}
                      className="h-9 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer"
                    >
                      View Completed ({pastSessions.length})
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3.5">
                {visibleFutureSessions.map((session, idx) => {
                  const sessionClub = getClubForSession(session);
                  const canManageThisSession = canManageClub(sessionClub);
                  const matchHistoryEnabled =
                    isClubMatchHistoryAndStandingsEnabled(sessionClub);
                  const sessionRsvps =
                    rsvpsBySessionIdMap.get(session.id) || [];
                  const goingRsvps = sessionRsvps.filter(
                    (r) => r.status === 'going'
                  );
                  const goingHeadcount = getSessionGoingHeadcount(sessionRsvps);
                  const myRsvp = activePlayer
                    ? sessionRsvps.find((r) => r.playerId === activePlayer.id)
                    : undefined;
                  const myGuestCount = getRsvpGuestCount(myRsvp);
                  const isUserGoing = myRsvp?.status === 'going';
                  const isUserLateOut = myRsvp?.status === 'late_out';
                  const isUserOut = myRsvp?.status === 'out';
                  const sessionZone = resolveClubTimeZone(sessionClub.timezone);
                  const policy = evaluateTapOutWindow(
                    session,
                    sessionClub,
                    nowMs,
                    sessionZone
                  );
                  const joinWindow = evaluateJoinWindow(session, nowMs, sessionZone);
                  const spotsLeft = Math.max(
                    0,
                    session.maxPlayers - goingHeadcount
                  );
                  const canQuickJoin = Boolean(
                    onTapRsvp &&
                      activePlayer &&
                      !isUserGoing &&
                      spotsLeft > 0 &&
                      (canManageThisSession || (joinWindow.canJoin && !isUserLateOut))
                  );
                  const fillPercent = Math.min(
                    100,
                    Math.round(
                      (goingHeadcount / Math.max(1, session.maxPlayers)) * 100
                    )
                  );
                  const dateInfo = getSessionDateDisplay(session.sessionDate);

                  return (
                    <motion.article
                      key={session.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenSessionDetail(session.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenSessionDetail(session.id);
                        }
                      }}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.18,
                        delay: Math.min(idx * 0.03, 0.15),
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className={`group bg-white dark:bg-slate-900 rounded-2xl border p-4 sm:p-6 space-y-3.5 sm:space-y-4 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                        isUserGoing
                          ? 'border-emerald-500/70 dark:border-emerald-600/70 shadow-xs hover:border-emerald-600 dark:hover:border-emerald-500 hover:shadow-md hover:shadow-emerald-900/5 dark:hover:shadow-black/30'
                          : 'border-slate-200/90 dark:border-slate-800 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md hover:shadow-slate-900/5 dark:hover:shadow-black/30'
                      }`}
                    >
                      {/* Row 1: Date tile, what/when/where, and clean open chevron */}
                      <div className="flex items-start sm:items-center justify-between gap-3 sm:gap-4">
                        <div className="flex items-start gap-3 sm:gap-3.5 min-w-0 flex-1">
                          <div
                            className={`w-13 h-13 sm:w-14 sm:h-14 rounded-xl border flex flex-col items-center justify-center shrink-0 select-none ${
                              isUserGoing
                                ? 'bg-emerald-50/70 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                                : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200/90 dark:border-slate-700 text-slate-900 dark:text-white'
                            }`}
                            aria-label={dateInfo.fullLabel}
                          >
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider leading-none ${
                                isUserGoing
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {dateInfo.weekdayShort}
                            </span>
                            <span className="text-base font-bold font-mono tabular-nums leading-none mt-1">
                              {dateInfo.dayNum}
                            </span>
                            <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400 leading-none mt-0.5">
                              {dateInfo.monthShort}
                            </span>
                          </div>

                          <div className="space-y-1 min-w-0 flex-1">
                            <h2 className="text-[15px] sm:text-lg font-bold text-slate-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors tracking-tight break-words leading-snug font-display">
                              {session.title}
                            </h2>
                            <p className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <Clock
                                className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                                {session.startTime}–{session.endTime}{' '}
                                <span className="font-sans text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                  {getTimeZoneShortLabel(sessionZone, nowMs)}
                                </span>
                              </span>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                                ·
                              </span>
                              <MapPin
                                className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="break-words">
                                {session.venue}
                                {session.bookingStatus === 'booked' &&
                                session.courtNumbers
                                  ? ` · ${session.courtNumbers}`
                                  : ''}
                              </span>
                              {isAllClubsFilter && (
                                <>
                                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                                    ·
                                  </span>
                                  <span className="font-semibold text-slate-700 dark:text-slate-300 break-words">
                                    {sessionClub.name}
                                  </span>
                                </>
                              )}
                            </p>
                            <p className="text-xs flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              {isUserGoing ? (
                                <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    Going
                                    {myGuestCount > 0
                                      ? ` (+${myGuestCount})`
                                      : ''}
                                  </span>
                                </span>
                              ) : isUserLateOut ? (
                                <span className="font-semibold text-amber-700 dark:text-amber-400">
                                  Late out ({myRsvp?.penaltyPercentApplied}%)
                                </span>
                              ) : isUserOut ? (
                                <span className="font-medium text-slate-500 dark:text-slate-400">
                                  Not going
                                </span>
                              ) : spotsLeft === 0 ? (
                                <span className="font-semibold text-amber-700 dark:text-amber-400">
                                  Full
                                </span>
                              ) : (
                                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                  {spotsLeft}{' '}
                                  {spotsLeft === 1 ? 'spot' : 'spots'} left
                                </span>
                              )}
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                                ·
                              </span>
                              <span
                                className={
                                  session.bookingStatus === 'booked'
                                    ? 'text-slate-500 dark:text-slate-400'
                                    : 'text-amber-700 dark:text-amber-400 font-semibold'
                                }
                              >
                                {session.bookingStatus === 'booked'
                                  ? 'Booked'
                                  : 'Unbooked'}
                              </span>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                                ·
                              </span>
                              <span
                                className={
                                  policy.isPenaltyWindow
                                    ? 'text-amber-700 dark:text-amber-400 font-medium'
                                    : 'text-slate-500 dark:text-slate-400'
                                }
                              >
                                {policy.policySummary}
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* Right: 1-Tap Quick Join or Clean Open Affordance */}
                        <div className="flex items-center gap-2 shrink-0">
                          {canQuickJoin ? (
                            <button
                              type="button"
                              disabled={quickJoinBusyId === session.id}
                              onClick={(e) => void handleQuickJoinSession(e, session)}
                              className="h-9 sm:h-8 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-150 active:scale-[0.97] cursor-pointer shadow-xs disabled:opacity-60"
                            >
                              <UserPlus className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                {quickJoinBusyId === session.id
                                  ? 'Joining…'
                                  : 'Quick Join'}
                              </span>
                            </button>
                          ) : (
                            <span className="hidden sm:inline text-xs font-semibold text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                              {canManageThisSession
                                ? 'Manage'
                                : isUserGoing
                                ? 'Details'
                                : 'View'}
                            </span>
                          )}
                          <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 group-hover:bg-slate-900 dark:group-hover:bg-emerald-600 group-hover:text-white text-slate-600 dark:text-slate-300 flex items-center justify-center transition-all duration-150 shrink-0">
                            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" />
                          </div>
                        </div>
                      </div>

                      {/* Row 2: Roster fill, lineup, fee, and quick utilities */}
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-22 shrink-0 space-y-1">
                            <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                              {goingHeadcount}/{session.maxPlayers}
                              <span className="font-sans font-medium text-slate-500 dark:text-slate-400">
                                {' '}
                                going
                              </span>
                            </span>
                            <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  spotsLeft === 0
                                    ? 'bg-amber-600'
                                    : 'bg-emerald-600'
                                }`}
                                style={{ width: `${fillPercent}%` }}
                              />
                            </div>
                          </div>
                          <p className="min-w-0 line-clamp-2 sm:line-clamp-1 break-words text-slate-600 dark:text-slate-300">
                            {goingRsvps.length === 0
                              ? 'Be the first to join'
                              : goingRsvps
                                  .map((r) => {
                                    const g = getRsvpGuestCount(r);
                                    return g > 0
                                      ? `${r.playerName} (+${g})`
                                      : r.playerName;
                                  })
                                  .join(', ')}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-x-3 gap-y-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>
                              <span className="font-mono tabular-nums font-bold text-slate-800 dark:text-slate-200">
                                {session.courtFee > 0
                                  ? formatClubCurrency(session.courtFee, sessionClub)
                                  : 'Fee TBD'}
                              </span>
                              {session.courtFee > 0 && (
                                <span className="text-slate-500 dark:text-slate-400">
                                  {' '}
                                  (~
                                  {formatClubCurrency(
                                    session.courtFee /
                                      Math.max(
                                        1,
                                        goingHeadcount || session.maxPlayers
                                      ),
                                    sessionClub
                                  )}
                                  /p)
                                </span>
                              )}
                            </span>
                            {session.paymentTiming === 'before' &&
                              !session.feeSplitFinalized && (
                                <>
                                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                                    ·
                                  </span>
                                  <span
                                    className="text-amber-700 dark:text-amber-400 font-semibold"
                                    title="The host collects each player's estimated share before the match"
                                  >
                                    Pay before match
                                  </span>
                                </>
                              )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={(e) =>
                                handleCopyInviteSnippet(e, session)
                              }
                              className="h-9 sm:h-7 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200/90 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white font-semibold shadow-2xs inline-flex items-center gap-1 transition-all duration-150 active:scale-[0.97] cursor-pointer"
                            >
                              {copiedId === session.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                  <span className="text-emerald-700 dark:text-emerald-400">
                                    Copied
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                                  <span>Invite</span>
                                </>
                              )}
                            </button>
                            {canManageThisSession && (
                              <button
                                type="button"
                                disabled={cloningId === session.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenCloneModal(session);
                                }}
                                title="Clone session for next week (+7 days)"
                                className="h-9 sm:h-7 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200/90 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white font-semibold shadow-2xs inline-flex items-center gap-1 transition-all duration-150 active:scale-[0.97] cursor-pointer"
                              >
                                <Repeat
                                  className={`w-3 h-3 text-slate-500 dark:text-slate-400 ${
                                    cloningId === session.id
                                      ? 'animate-spin'
                                      : ''
                                  }`}
                                />
                                <span>
                                  {cloningId === session.id
                                    ? 'Cloned!'
                                    : '+7d'}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
                {displayedFutureSessions.length > visibleUpcomingCount && (
                  <div className="pt-2 flex justify-center">
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleUpcomingCount((prev) => prev + 12)
                      }
                      className="h-9 px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer shadow-2xs"
                    >
                      Show More Upcoming Sessions (
                      {displayedFutureSessions.length - visibleUpcomingCount}{' '}
                      remaining)
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.section>
        ) : (
          /* PAST SESSION HISTORIES VIEW */
          <motion.section
            key="history"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            aria-label="Session History"
            className="space-y-3.5"
          >
            {/* Search & Status Filter Bar for Session History */}
            {pastSessions.length > 0 && (
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3 shadow-2xs">
                <div className="w-full md:w-72">
                  <StyledInput
                    icon={<Search className="w-3.5 h-3.5" />}
                    placeholder="Search title, venue, date..."
                    aria-label="Search completed sessions"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                </div>
                <div className="w-full md:w-auto overflow-x-auto">
                  <SegmentedControl
                    size="sm"
                    fullWidth
                    className="md:w-auto"
                    options={[
                      { value: 'all', label: 'All', count: pastSessions.length },
                      { value: 'played', label: 'Played' },
                      {
                        value: 'needs_action',
                        label: canScheduleSession ? 'Needs Action' : 'Unpaid',
                        count: historyNeedsActionCount,
                      },
                      { value: 'finalized', label: 'Finalized' },
                    ]}
                    value={historyFilter}
                    onChange={(v) => setHistoryFilter(v as HistoryFilterMode)}
                  />
                </div>
              </div>
            )}

            {displayedPastSessions.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-10 text-center space-y-2.5">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {historySearch.trim() || historyFilter !== 'all'
                    ? 'No completed sessions match this filter.'
                    : 'No completed sessions recorded yet.'}
                </p>
                {(historySearch.trim() || historyFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistorySearch('');
                      setHistoryFilter('all');
                    }}
                    className="h-8 px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3.5">
                {visiblePastSessions.map((session, idx) => {
                  const sessionClub = getClubForSession(session);
                  const canManageThisSession = canManageClub(sessionClub);
                  const matchHistoryEnabled =
                    isClubMatchHistoryAndStandingsEnabled(sessionClub);
                  const sessionRsvps =
                    rsvpsBySessionIdMap.get(session.id) || [];
                  const goingHeadcount = getSessionGoingHeadcount(sessionRsvps);
                  const collectionSummary = computeSessionCollectionSummary(
                    session,
                    sessionRsvps,
                    sessionClub
                  );
                  const myRsvp = activePlayer
                    ? sessionRsvps.find((r) => r.playerId === activePlayer.id)
                    : undefined;
                  const didUserJoin =
                    myRsvp &&
                    (myRsvp.status === 'going' ||
                      myRsvp.status === 'late_out');

                  const sessionMatches =
                    matchesBySessionIdMap.get(session.id) || [];
                  const myMatches = activePlayer
                    ? sessionMatches.filter((m) =>
                        isPlayerInMatch(m, activePlayer.id)
                      )
                    : [];
                  const myWins = activePlayer
                    ? myMatches.filter((m) => {
                        const inA =
                          getPlayerSideInMatch(m, activePlayer.id) === 'A';
                        return (
                          (inA && m.winnerSide === 'A') ||
                          (!inA && m.winnerSide === 'B')
                        );
                      }).length
                    : 0;
                  const myLosses = myMatches.length - myWins;
                  const finalTotal = session.courtFee + session.shuttleFee;
                  const estPerPlayer =
                    finalTotal > 0 && goingHeadcount > 0
                      ? finalTotal / goingHeadcount
                      : 0;
                  const dateInfo = getSessionDateDisplay(session.sessionDate);

                  return (
                    <motion.article
                      key={session.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenSessionDetail(session.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenSessionDetail(session.id);
                        }
                      }}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.18,
                        delay: Math.min(idx * 0.03, 0.15),
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 sm:p-6 space-y-3.5 sm:space-y-4 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md hover:shadow-slate-900/5 dark:hover:shadow-black/30 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-3.5">
                        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                          <div
                            className="w-14 h-14 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-white flex flex-col items-center justify-center shrink-0 select-none"
                            aria-label={dateInfo.fullLabel}
                          >
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 leading-none">
                              {dateInfo.weekdayShort}
                            </span>
                            <span className="text-base font-bold font-mono tabular-nums leading-none mt-1">
                              {dateInfo.dayNum}
                            </span>
                            <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400 leading-none mt-0.5">
                              {dateInfo.monthShort}
                            </span>
                          </div>

                          <div className="space-y-1 min-w-0">
                            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors break-words leading-snug font-display">
                              {session.title}
                            </h3>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                              <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-300">
                                {session.startTime}–{session.endTime}
                              </span>
                              <span aria-hidden="true">·</span>
                              {didUserJoin ? (
                                <span className="font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {myRsvp.attendanceOutcome === 'no_show'
                                    ? 'No-Show'
                                    : myRsvp.status === 'late_out'
                                    ? 'Late Out'
                                    : 'Played'}
                                </span>
                              ) : (
                                <span className="text-slate-600 dark:text-slate-400 font-medium">
                                  Did Not Join
                                </span>
                              )}
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  !session.feeSplitFinalized
                                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                    : collectionSummary.isAllSettled
                                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                    : 'text-blue-700 dark:text-blue-400 font-semibold'
                                }
                              >
                                {!session.feeSplitFinalized
                                  ? 'Pending Fee Split'
                                  : collectionSummary.isAllSettled
                                  ? 'All Settled'
                                  : `${collectionSummary.paidCount}/${collectionSummary.totalBillable} Paid`}
                              </span>
                              {session.feeSplitFinalized &&
                                canManageThisSession &&
                                collectionSummary.pendingCount > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-semibold text-blue-700 dark:text-blue-400">
                                      {collectionSummary.pendingCount} awaiting check
                                    </span>
                                  </>
                                )}
                              <span aria-hidden="true">·</span>
                              <span className="break-words">
                                {session.venue}
                              </span>
                              {isAllClubsFilter && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-slate-700 dark:text-slate-300 font-semibold break-words">
                                    {sessionClub.name}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                          {canManageThisSession && !session.feeSplitFinalized && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenSessionDetail(session.id);
                              }}
                              className="h-9 sm:h-8 px-3 text-xs font-semibold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 inline-flex items-center gap-1 transition-all duration-150 active:scale-[0.97] whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                            >
                              <span>Finalize Split</span>
                            </button>
                          )}

                          {matchHistoryEnabled && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenMatchScorerForSession(session.id);
                              }}
                              className="h-9 sm:h-8 px-3 text-xs font-semibold rounded-xl text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center gap-1.5 transition-all duration-150 active:scale-[0.97] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <BadmintonMatchIcon className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                              <span>Matches ({sessionMatches.length})</span>
                            </button>
                          )}

                          {permissionTier === 'admin' && onDeleteSession && (
                            <button
                              type="button"
                              title="Remove completed session from history"
                              aria-label={`Remove ${session.title} from history`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteSessionError(null);
                                setPendingDeleteSession(session);
                              }}
                              className="h-9 sm:h-8 px-2.5 text-xs font-semibold rounded-xl text-rose-700 dark:text-rose-400 bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200/90 dark:border-rose-800/70 hover:bg-rose-100 dark:hover:bg-rose-950/80 inline-flex items-center gap-1 transition-all duration-150 active:scale-[0.97] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5 shrink-0" />
                              <span className="hidden sm:inline">Remove</span>
                            </button>
                          )}

                          <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 group-hover:bg-slate-900 dark:group-hover:bg-emerald-600 group-hover:text-white text-slate-600 dark:text-slate-300 flex items-center justify-center transition-all duration-150 shrink-0">
                            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" />
                          </div>
                        </div>
                      </div>

                      {/* Structured Summary Grid */}
                      <div
                        className={`grid grid-cols-2 ${
                          matchHistoryEnabled ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
                        } gap-3 pt-3 border-t border-slate-100 dark:border-slate-800/90 text-xs`}
                      >
                        <div className="space-y-0.5 col-span-2 sm:col-span-1">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                            Total Cost
                          </span>
                          <p className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                            {formatClubCurrency(finalTotal, sessionClub)} ({goingHeadcount}p)
                          </p>
                          <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            Court {formatClubCurrency(session.courtFee, sessionClub)} + {session.shuttlesUsed} shuttles
                          </p>
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block">
                            {canManageThisSession && session.feeSplitFinalized
                              ? 'Collection Status'
                              : 'Your Fee Share'}
                          </span>
                          {canManageThisSession && session.feeSplitFinalized ? (
                            <>
                              <p
                                className={`font-mono tabular-nums font-bold ${
                                  collectionSummary.isAllSettled
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-slate-900 dark:text-white'
                                }`}
                              >
                                {collectionSummary.paidCount}/{collectionSummary.totalBillable} settled
                                {collectionSummary.unpaidAmount > 0 && (
                                  <span className="text-amber-700 dark:text-amber-400 font-semibold">
                                    {' '}
                                    · {formatClubCurrency(collectionSummary.unpaidAmount, sessionClub)} due
                                  </span>
                                )}
                              </p>
                              <div className="flex items-center gap-2 pt-0.5">
                                <div className="w-20 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      collectionSummary.isAllSettled
                                        ? 'bg-emerald-600'
                                        : 'bg-blue-600'
                                    }`}
                                    style={{ width: `${collectionSummary.collectionPercent}%` }}
                                  />
                                </div>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                  {collectionSummary.collectionPercent}%
                                </span>
                              </div>
                            </>
                          ) : didUserJoin && myRsvp ? (
                            !session.feeSplitFinalized ? (
                              <>
                                <p className="font-mono tabular-nums font-bold text-amber-700 dark:text-amber-400">
                                  Pending Split
                                </p>
                                <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                  {canManageThisSession
                                    ? 'Tap to finalize fee split'
                                    : estPerPlayer > 0
                                    ? `Est. ~${formatClubCurrency(estPerPlayer, sessionClub)}/player`
                                    : `Host (${sessionClub.clubOwnerName || 'Owner'}) hasn't finalized yet`}
                                </p>
                              </>
                            ) : sessionClub.clubOwnerPlayerId === activePlayer?.id ? (
                              <>
                                <p className="font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                                  {sessionClub.excludeOwnerFromBilling
                                    ? `${formatClubCurrency(0, sessionClub)} · Owner Exempt`
                                    : `${formatClubCurrency(myRsvp.feeShare, sessionClub)} · Club Owner`}
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  You are the organizer of this club
                                </p>
                              </>
                            ) : (
                              <>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                                    {formatClubCurrency(myRsvp.feeShare, sessionClub)} ·{' '}
                                    <span
                                      className={
                                        myRsvp.paidStatus === 'paid'
                                          ? 'text-emerald-700 dark:text-emerald-400 font-sans font-semibold'
                                          : myRsvp.paidStatus === 'pending_approval'
                                          ? 'text-blue-700 dark:text-blue-400 font-sans font-semibold'
                                          : 'text-amber-700 dark:text-amber-400 font-sans font-semibold'
                                      }
                                    >
                                      {myRsvp.paidStatus === 'paid'
                                        ? 'Received'
                                        : myRsvp.paidStatus === 'pending_approval'
                                        ? 'Pending'
                                        : 'Unpaid'}
                                    </span>
                                  </p>
                                  {myRsvp.paidStatus === 'unpaid' &&
                                    myRsvp.feeShare > 0 && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onOpenSessionDetail(session.id, true);
                                        }}
                                        className="h-7 sm:h-6 px-2.5 sm:px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
                                      >
                                        Pay Now
                                      </button>
                                    )}
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {myRsvp.penaltyPercentApplied < 100 &&
                                  myRsvp.penaltyPercentApplied > 0
                                    ? `${myRsvp.penaltyPercentApplied}% late-cancel share`
                                    : myRsvp.paidStatus === 'paid' &&
                                      myRsvp.paidMethod &&
                                      myRsvp.paidMethod !== 'pending'
                                    ? `Settled (${describeWalletPaidMethod(myRsvp.paidMethod, (n) =>
                                        formatClubCurrency(n, sessionClub)
                                      )})`
                                    : `Payable to ${sessionClub.clubOwnerName || 'Club Owner'}`}
                                </p>
                              </>
                            )
                          ) : (
                            <p className="text-slate-600 dark:text-slate-400">—</p>
                          )}
                        </div>

                        {matchHistoryEnabled && (
                          <div className="space-y-0.5">
                            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block">
                              Your Match Record
                            </span>
                            <p className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                              {didUserJoin
                                ? myMatches.length > 0
                                  ? `${myWins}W – ${myLosses}L`
                                  : 'Attended'
                                : '—'}
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.article>
                  );
                })}
                {displayedPastSessions.length > visiblePastCount && (
                  <div className="pt-2 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setVisiblePastCount((prev) => prev + 12)}
                      className="h-9 px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer shadow-2xs"
                    >
                      Show More Past Sessions (
                      {displayedPastSessions.length - visiblePastCount}{' '}
                      remaining)
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* Confirmation Modal: Admin Remove Completed Session from History */}
      {permissionTier === 'admin' && onDeleteSession && (
        <ConfirmModal
          open={Boolean(pendingDeleteSession)}
          title="Remove Session from History?"
          description={
            pendingDeleteSession ? (
              <div className="space-y-1.5">
                <p>
                  Permanently remove{' '}
                  <strong className="font-semibold text-slate-900 dark:text-white">
                    {pendingDeleteSession.title}
                  </strong>{' '}
                  ({pendingDeleteSession.sessionDate} ·{' '}
                  {pendingDeleteSession.venue}) from session histories?
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  All RSVPs and recorded matches for this session will be
                  deleted, and any affected player ratings, free passes, or
                  prepaid credits will be rolled back automatically.
                </p>
                {deleteSessionError && (
                  <p
                    role="alert"
                    className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 px-2.5 py-1.5 font-medium text-rose-700 dark:text-rose-300"
                  >
                    {deleteSessionError}
                  </p>
                )}
              </div>
            ) : null
          }
          confirmLabel="Remove Session"
          variant="danger"
          onCancel={() => {
            setPendingDeleteSession(null);
            setDeleteSessionError(null);
          }}
          onConfirm={async () => {
            if (!pendingDeleteSession) return;
            setDeleteSessionError(null);
            const result = await onDeleteSession(pendingDeleteSession.id);
            if (result && !result.ok) {
              setDeleteSessionError(result.reason);
              return;
            }
            setPendingDeleteSession(null);
          }}
        />
      )}
    </div>
  );
};
