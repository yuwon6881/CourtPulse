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
  Swords,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BadmintonMatch,
  BookingStatus,
  Club,
  ParsedQuickSession,
  PermissionTier,
  Player,
  Session,
  SessionRsvp,
} from '../types';
import {
  buildGroupChatSnippet,
  evaluateTapOutWindow,
  getPlayerSideInMatch,
  getRsvpGuestCount,
  getSessionDateDisplay,
  getSessionEndTimestampMs,
  getSessionGoingHeadcount,
  isPlayerInMatch,
  isSessionCompletedOrPast,
  parseQuickSessionInput,
} from '../utils/badmintonLogic';
import {
  buildSessionDefaultsFromHistory,
  suggestCourtFeeFromHistory,
} from '../utils/sessionDefaults';
import { formatCourtCount } from '../utils/courtAdvice';
import {
  ConfirmModal,
  SegmentedControl,
  StyledInput,
  StyledSelect,
  StyledTimePicker,
} from './ui/FormControls';

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
  onOpenSessionDetail: (sessionId: string, openPayInfo?: boolean) => void;
  onOpenMatchScorerForSession: (sessionId: string) => void;
  onCloneNextWeekSession: (session: Session) => Promise<void>;
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
  onOpenSessionDetail,
  onOpenMatchScorerForSession,
  onCloneNextWeekSession,
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
  const [pendingCloneSession, setPendingCloneSession] =
    useState<Session | null>(null);
  const [viewSection, setViewSection] = useState<'upcoming' | 'history'>(
    'upcoming'
  );
  const [futureFilter, setFutureFilter] = useState<'all' | 'joined_only'>('all');

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
    () => buildSessionDefaultsFromHistory(sessions, chosenClubId),
    [sessions, chosenClubId]
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
    const defaults = buildSessionDefaultsFromHistory(sessions, clubId) ?? {};
    setQuickText('');
    setFeeTouched(false);
    setFormErrors({});
    setParsed(
      withSuggestedFee(parseQuickSessionInput('', defaults), clubId, false)
    );
  };

  const handleOpenOrganizer = () => {
    if (showOrganizerForm) {
      setShowOrganizerForm(false);
      return;
    }
    resetOrganizerForClub(chosenClubId);
    setShowOrganizerForm(true);
  };

  const handleQuickTextChange = (val: string) => {
    setQuickText(val);
    const next = parseQuickSessionInput(val, historyDefaults ?? {});
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
        ? `History suggests $${feeSuggestion.courtFee.toFixed(2)}`
        : undefined
      : feeSuggestion
      ? `Estimated · ${formatCourtCount(feeSuggestion.courts)} × ${feeSuggestion.hours}h`
      : 'No past prices yet';

  const getClubForSession = (session: Session): Club => {
    return clubByIdMap.get(session.clubId) || activeClub;
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canScheduleSession || !ownedClub) return;
    const chosenClub = ownedClub;

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
      nextErrors.courtFee = 'Court fee must be $0 or more.';
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
    await onCreateSession({
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
      organizerName: activePlayer?.name || 'Alex Tan',
      paymentInfo: chosenClub.paymentInfo,
      feeSplitFinalized: false,
    });
    setShowOrganizerForm(false);
  };

  const handleCopyInviteSnippet = async (
    e: React.MouseEvent,
    session: Session
  ) => {
    e.stopPropagation();
    const sessionRsvps = rsvpsBySessionIdMap.get(session.id) || [];
    const sessionClub = getClubForSession(session);
    const snippet = buildGroupChatSnippet(sessionClub, session, sessionRsvps);
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedId(session.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore
    }
  };

  const handleCloneSessionClick = async (session: Session) => {
    setCloningId(session.id);
    try {
      await onCloneNextWeekSession(session);
    } finally {
      setTimeout(() => setCloningId(null), 800);
    }
  };

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const futureSessions = useMemo(
    () =>
      sessions
        .filter((s) => !isSessionCompletedOrPast(s, nowMs))
        .sort((a, b) => {
          const tA = getSessionEndTimestampMs(a);
          const tB = getSessionEndTimestampMs(b);
          if (tA !== null && tB !== null && tA !== tB) return tA - tB;
          return a.sessionDate.localeCompare(b.sessionDate);
        }),
    [sessions, nowMs]
  );
  const pastSessions = useMemo(
    () =>
      sessions
        .filter((s) => isSessionCompletedOrPast(s, nowMs))
        .sort((a, b) => {
          const tA = getSessionEndTimestampMs(a);
          const tB = getSessionEndTimestampMs(b);
          if (tA !== null && tB !== null && tA !== tB) return tB - tA;
          return b.sessionDate.localeCompare(a.sessionDate);
        }),
    [sessions, nowMs]
  );

  const displayedFutureSessions = useMemo(() => {
    return futureSessions.filter((s) => {
      if (futureFilter === 'all' || !activePlayer) return true;
      const sessRsvps = rsvpsBySessionIdMap.get(s.id) || [];
      const myRsvp = sessRsvps.find((r) => r.playerId === activePlayer.id);
      return myRsvp?.status === 'going';
    });
  }, [futureSessions, futureFilter, activePlayer, rsvpsBySessionIdMap]);

  const displayedPastSessions = useMemo(() => {
    return pastSessions.filter((s) => {
      if (futureFilter === 'all' || !activePlayer) return true;
      const sessRsvps = rsvpsBySessionIdMap.get(s.id) || [];
      const myRsvp = sessRsvps.find((r) => r.playerId === activePlayer.id);
      return myRsvp?.status === 'going' || myRsvp?.status === 'late_out';
    });
  }, [pastSessions, futureFilter, activePlayer, rsvpsBySessionIdMap]);

  const visibleFutureSessions = useMemo(
    () => displayedFutureSessions.slice(0, visibleUpcomingCount),
    [displayedFutureSessions, visibleUpcomingCount]
  );

  const visiblePastSessions = useMemo(
    () => displayedPastSessions.slice(0, visiblePastCount),
    [displayedPastSessions, visiblePastCount]
  );

  return (
    <div className="space-y-6">
      {/* Clean Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display">
            Court Sessions &amp; Schedule
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {isAllClubsFilter
              ? `All Joined Clubs (${clubs.length}) · Select any session to manage RSVP, court roster, and fee split`
              : `${activeClub.name} · Select any session to view roster, join/leave, or settle fees`}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5">
          <div className="flex items-center gap-2 overflow-x-auto">
            <SegmentedControl
              size="sm"
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
              className="h-9 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-2xs rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Schedule Session</span>
            </button>
          )}
        </div>
      </div>

      {/* Club Owner-Only Session Organizer Modal (Always bound to the owner's single club) */}
      <AnimatePresence>
        {canScheduleSession && ownedClub && showOrganizerForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShowOrganizerForm(false)}
          >
            <motion.section
              ref={showQuickOrganizerRef}
              aria-label="Organize Session"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-5"
            >
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">
                      Schedule Court Session
                    </h2>
                    <span className="text-xs font-semibold text-emerald-700">
                      · {ownedClub.name}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {historyDefaults
                      ? `Pre-filled from your last session (${historyDefaults.venue}, ${getSessionDateDisplay(historyDefaults.sessionDate).weekdayLong}s ${historyDefaults.startTime}–${historyDefaults.endTime}). Change only what's different.`
                      : 'Type a quick summary or fill in the fields below.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowOrganizerForm(false)}
                  className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form
                noValidate
                onSubmit={handleCreateSubmit}
                className="space-y-4"
              >
                <div>
                  <StyledInput
                    id="quick-input"
                    label="Quick Summary"
                    hint="Optional · fills the fields below"
                    type="text"
                    value={quickText}
                    onChange={(e) => handleQuickTextChange(e.target.value)}
                    placeholder={QUICK_PROMPT_EXAMPLE}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                  <div className="sm:col-span-4">
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

                  <div className="sm:col-span-4">
                    <StyledInput
                      label="Courts"
                      type="text"
                      disabled={parsed.bookingStatus === 'pending'}
                      maxLength={60}
                      placeholder={
                        parsed.bookingStatus === 'pending'
                          ? 'TBD (Proposed)'
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
                        updateParsed({ courtNumbers: e.target.value });
                        if (formErrors.courtNumbers)
                          setFormErrors((prev) => ({
                            ...prev,
                            courtNumbers: undefined,
                          }));
                      }}
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <StyledSelect
                      label="Status"
                      value={parsed.bookingStatus}
                      onChange={(e) => {
                        const nextStatus = e.target.value as BookingStatus;
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
                    >
                      <option value="pending">Proposed (Not Booked Yet)</option>
                      <option value="booked">Court Booked</option>
                    </StyledSelect>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                  <div className="sm:col-span-4">
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

                  <div className="sm:col-span-4">
                    <StyledTimePicker
                      label="Start Time"
                      value={parsed.startTime}
                      error={formErrors.startTime}
                      onChange={(e) => {
                        updateParsed({ startTime: e.target.value });
                        if (formErrors.startTime)
                          setFormErrors((prev) => ({
                            ...prev,
                            startTime: undefined,
                          }));
                      }}
                    />
                  </div>

                  <div className="sm:col-span-4">
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
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                  <div className="sm:col-span-6">
                    <StyledInput
                      label="Court Fee"
                      hint={feeHint}
                      prefixText="$"
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

                  <div className="sm:col-span-6">
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
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowOrganizerForm(false)}
                    className="h-10 px-4 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-10 px-5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/20 shadow-xs cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>
                      {parsed.bookingStatus === 'pending'
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
              <div className="bg-white rounded-2xl border border-slate-200/90 p-10 text-center">
                <p className="text-sm font-semibold text-slate-700">
                  {futureFilter === 'joined_only'
                    ? 'You have not joined any upcoming sessions yet.'
                    : 'No upcoming sessions scheduled.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {visibleFutureSessions.map((session, idx) => {
                  const sessionClub = getClubForSession(session);
                  const canManageThisSession = canManageClub(sessionClub);
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
                  const policy = evaluateTapOutWindow(session, sessionClub);
                  const spotsLeft = Math.max(
                    0,
                    session.maxPlayers - goingHeadcount
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
                      className={`group bg-white rounded-2xl border p-5 sm:p-6 space-y-4 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                        isUserGoing
                          ? 'border-emerald-500/70 shadow-xs hover:border-emerald-600 hover:shadow-md hover:shadow-emerald-900/5'
                          : 'border-slate-200/90 shadow-2xs hover:border-slate-300 hover:shadow-md hover:shadow-slate-900/5'
                      }`}
                    >
                      {/* Row 1: Date tile, what/when/where, and status chevron */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3.5 min-w-0">
                          <div
                            className={`w-14 h-14 rounded-xl border flex flex-col items-center justify-center shrink-0 select-none ${
                              isUserGoing
                                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                                : 'bg-slate-50 border-slate-200/90 text-slate-900'
                            }`}
                            aria-label={dateInfo.fullLabel}
                          >
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider leading-none ${
                                isUserGoing
                                  ? 'text-emerald-700'
                                  : 'text-slate-600'
                              }`}
                            >
                              {dateInfo.weekdayShort}
                            </span>
                            <span className="text-base font-bold font-mono tabular-nums leading-none mt-1">
                              {dateInfo.dayNum}
                            </span>
                            <span className="text-[10px] font-semibold uppercase text-slate-500 leading-none mt-0.5">
                              {dateInfo.monthShort}
                            </span>
                          </div>

                          <div className="space-y-1 min-w-0">
                            <h2 className="text-base sm:text-lg font-bold text-slate-900 group-hover:text-emerald-700 transition-colors tracking-tight break-words leading-snug">
                              {session.title}
                            </h2>
                            <p className="text-xs text-slate-600 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <Clock
                                className="w-3 h-3 text-slate-500 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="font-mono tabular-nums font-semibold text-slate-800">
                                {session.startTime}–{session.endTime}
                              </span>
                              <span
                                aria-hidden="true"
                                className="text-slate-300"
                              >
                                ·
                              </span>
                              <MapPin
                                className="w-3 h-3 text-slate-500 shrink-0"
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
                                  <span
                                    aria-hidden="true"
                                    className="text-slate-300"
                                  >
                                    ·
                                  </span>
                                  <span className="font-semibold text-slate-700 break-words">
                                    {sessionClub.name}
                                  </span>
                                </>
                              )}
                            </p>
                            <p className="text-xs flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              {isUserGoing ? (
                                <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    You&rsquo;re going
                                    {myGuestCount > 0
                                      ? ` (+${myGuestCount} Guest)`
                                      : ''}
                                  </span>
                                </span>
                              ) : isUserLateOut ? (
                                <span className="font-semibold text-amber-700">
                                  Late out ({myRsvp?.penaltyPercentApplied}%)
                                </span>
                              ) : isUserOut ? (
                                <span className="font-medium text-slate-500">
                                  Not going
                                </span>
                              ) : spotsLeft === 0 ? (
                                <span className="font-semibold text-amber-700">
                                  Roster full
                                </span>
                              ) : (
                                <span className="text-emerald-700 font-semibold">
                                  {spotsLeft}{' '}
                                  {spotsLeft === 1 ? 'spot' : 'spots'} left
                                </span>
                              )}
                              <span
                                aria-hidden="true"
                                className="text-slate-300"
                              >
                                ·
                              </span>
                              <span
                                className={
                                  session.bookingStatus === 'booked'
                                    ? 'text-slate-600'
                                    : 'text-amber-700 font-semibold'
                                }
                              >
                                {session.bookingStatus === 'booked'
                                  ? 'Court booked'
                                  : 'Court not booked yet'}
                              </span>
                              <span
                                aria-hidden="true"
                                className="text-slate-300"
                              >
                                ·
                              </span>
                              <span
                                className={
                                  policy.isPenaltyWindow
                                    ? 'text-amber-700 font-medium'
                                    : 'text-slate-600'
                                }
                              >
                                {policy.isPenaltyWindow
                                  ? policy.canTapOut
                                    ? `Late cancel: ${policy.penaltyPercent}% fee`
                                    : `Cancellation locked (<${sessionClub.lockCancelHours}h)`
                                  : `Free cancel until ${sessionClub.freeCancelHours}h before`}
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* Right: Clean open session affordance */}
                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                          <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 transition-colors">
                            {canManageThisSession
                              ? 'Manage Roster & Split'
                              : isUserGoing
                              ? 'View Session & Status'
                              : 'Open to Join'}
                          </span>
                          <div className="w-8 h-8 rounded-xl bg-slate-100 group-hover:bg-slate-900 group-hover:text-white text-slate-600 flex items-center justify-center transition-colors shrink-0">
                            <ChevronRight className="w-4 h-4" />
                          </div>
                        </div>
                      </div>

                      {/* Row 2: Roster fill, lineup, fee, and quick utilities */}
                      <div className="pt-3 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs text-slate-600">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-24 shrink-0 space-y-1">
                            <span className="font-mono tabular-nums font-bold text-slate-900">
                              {goingHeadcount}/{session.maxPlayers}
                              <span className="font-sans font-medium text-slate-600">
                                {' '}
                                going
                              </span>
                            </span>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
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
                          <p className="min-w-0 break-words text-slate-700">
                            {goingRsvps.length === 0
                              ? 'No one yet — tap this session to join.'
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

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-medium text-slate-600 shrink-0">
                          <span>
                            Court fee{' '}
                            <span className="font-mono tabular-nums font-bold text-slate-800">
                              {session.courtFee > 0
                                ? `$${session.courtFee.toFixed(2)}`
                                : 'not set'}
                            </span>
                            {session.courtFee > 0 && (
                              <span className="text-slate-500">
                                {' '}
                                (~$
                                {(
                                  session.courtFee /
                                  Math.max(
                                    1,
                                    goingHeadcount || session.maxPlayers
                                  )
                                ).toFixed(2)}
                                /player + shuttles)
                              </span>
                            )}
                          </span>
                          <span>By {session.organizerName}</span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) =>
                                handleCopyInviteSnippet(e, session)
                              }
                              className="h-7 px-2.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/90 text-slate-700 hover:text-slate-950 font-semibold shadow-2xs inline-flex items-center gap-1 transition-all cursor-pointer"
                            >
                              {copiedId === session.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span className="text-emerald-700">
                                    Copied
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-slate-500" />
                                  <span>Copy Invite</span>
                                </>
                              )}
                            </button>
                            {canManageThisSession && (
                              <button
                                type="button"
                                disabled={cloningId === session.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingCloneSession(session);
                                }}
                                title="Clone session for next week (+7 days)"
                                className="h-7 px-2.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/90 text-slate-700 hover:text-slate-950 font-semibold shadow-2xs inline-flex items-center gap-1 transition-all cursor-pointer"
                              >
                                <Repeat
                                  className={`w-3 h-3 text-slate-500 ${
                                    cloningId === session.id
                                      ? 'animate-spin'
                                      : ''
                                  }`}
                                />
                                <span>
                                  {cloningId === session.id
                                    ? 'Cloned!'
                                    : 'Clone +7d'}
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
                      className="h-9 px-4 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shadow-2xs"
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
            {displayedPastSessions.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200/90 p-10 text-center">
                <p className="text-xs text-slate-600">
                  {futureFilter === 'joined_only'
                    ? 'You have not joined any completed sessions in this club yet.'
                    : 'No completed sessions recorded yet.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {visiblePastSessions.map((session, idx) => {
                  const sessionClub = getClubForSession(session);
                  const sessionRsvps =
                    rsvpsBySessionIdMap.get(session.id) || [];
                  const goingRsvps = sessionRsvps.filter(
                    (r) => r.status === 'going'
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
                      className="group bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 space-y-4 hover:border-slate-300 hover:shadow-md hover:shadow-slate-900/5 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
                        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                          <div
                            className="w-14 h-14 rounded-xl border border-slate-200/90 bg-slate-50 text-slate-900 flex flex-col items-center justify-center shrink-0 select-none"
                            aria-label={dateInfo.fullLabel}
                          >
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 leading-none">
                              {dateInfo.weekdayShort}
                            </span>
                            <span className="text-base font-bold font-mono tabular-nums leading-none mt-1">
                              {dateInfo.dayNum}
                            </span>
                            <span className="text-[10px] font-semibold uppercase text-slate-500 leading-none mt-0.5">
                              {dateInfo.monthShort}
                            </span>
                          </div>

                          <div className="space-y-1 min-w-0">
                            <h3 className="text-base sm:text-lg font-bold text-slate-900 group-hover:text-emerald-700 transition-colors break-words leading-snug">
                              {session.title}
                            </h3>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                              <span className="font-mono tabular-nums font-medium text-slate-700">
                                {session.startTime}–{session.endTime}
                              </span>
                              <span aria-hidden="true">·</span>
                              {didUserJoin ? (
                                <span className="font-semibold text-emerald-700 inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {myRsvp.attendanceOutcome === 'no_show'
                                    ? 'No-Show'
                                    : myRsvp.status === 'late_out'
                                    ? 'Late Out'
                                    : 'Played'}
                                </span>
                              ) : (
                                <span className="text-slate-600 font-medium">
                                  Did Not Join
                                </span>
                              )}
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  session.feeSplitFinalized
                                    ? 'text-emerald-700 font-semibold'
                                    : 'text-amber-700 font-semibold'
                                }
                              >
                                {session.feeSplitFinalized
                                  ? 'Split Finalized'
                                  : 'Pending Fee Split'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="break-words">
                                {session.venue}
                              </span>
                              {isAllClubsFilter && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-slate-700 font-semibold break-words">
                                    {sessionClub.name}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenMatchScorerForSession(session.id);
                            }}
                            className="h-8 px-3 text-xs font-semibold rounded-xl text-slate-800 bg-slate-50 border border-slate-200/90 hover:bg-slate-100 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Swords className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            <span>Matches ({sessionMatches.length})</span>
                          </button>

                          <div className="w-8 h-8 rounded-xl bg-slate-100 group-hover:bg-slate-900 group-hover:text-white text-slate-600 flex items-center justify-center transition-colors shrink-0">
                            <ChevronRight className="w-4 h-4" />
                          </div>
                        </div>
                      </div>

                      {/* Structured 3-Column Summary Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-3.5 border-t border-slate-100 text-xs">
                        <div className="space-y-0.5">
                          <span className="text-[11px] font-semibold text-slate-600 block">
                            Session Cost Breakdown
                          </span>
                          <p className="font-mono tabular-nums font-semibold text-slate-900">
                            ${finalTotal.toFixed(2)} total ({goingRsvps.length}p)
                          </p>
                          <p className="text-[11px] font-mono tabular-nums text-slate-500">
                            Court ${session.courtFee.toFixed(2)} + Shuttles $
                            {session.shuttleFee.toFixed(2)} (
                            {session.shuttlesUsed} used)
                          </p>
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[11px] font-semibold text-slate-600 block">
                            Your Fee Share
                          </span>
                          {didUserJoin && myRsvp ? (
                            sessionClub.clubOwnerPlayerId === activePlayer?.id ? (
                              <>
                                <p className="font-mono tabular-nums font-bold text-emerald-700">
                                  {sessionClub.excludeOwnerFromBilling
                                    ? '$0.00 · Owner Exempt'
                                    : `$${myRsvp.feeShare.toFixed(2)} · Club Owner`}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {session.feeSplitFinalized
                                    ? 'You are the organizer of this club'
                                    : 'Tap session to finalize fee split'}
                                </p>
                              </>
                            ) : (
                              <>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-mono tabular-nums font-bold text-slate-900">
                                    ${myRsvp.feeShare.toFixed(2)} ·{' '}
                                    <span
                                      className={
                                        myRsvp.paidStatus === 'paid'
                                          ? 'text-emerald-700 font-sans font-semibold'
                                          : myRsvp.paidStatus === 'pending_approval'
                                          ? 'text-blue-700 font-sans font-semibold'
                                          : 'text-amber-700 font-sans font-semibold'
                                      }
                                    >
                                      {myRsvp.paidStatus === 'paid'
                                        ? 'Received'
                                        : myRsvp.paidStatus === 'pending_approval'
                                        ? 'Pending'
                                        : 'Unpaid'}
                                    </span>
                                  </p>
                                  {session.feeSplitFinalized &&
                                    myRsvp.paidStatus === 'unpaid' &&
                                    myRsvp.feeShare > 0 && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onOpenSessionDetail(session.id, true);
                                        }}
                                        className="h-6 px-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-sans text-[11px] font-semibold transition-colors cursor-pointer"
                                      >
                                        Pay Now
                                      </button>
                                    )}
                                </div>
                                <p className="text-[11px] text-slate-500">
                                  {myRsvp.penaltyPercentApplied < 100 &&
                                  myRsvp.penaltyPercentApplied > 0
                                    ? `${myRsvp.penaltyPercentApplied}% late-cancel share`
                                    : myRsvp.paidStatus === 'paid' &&
                                      myRsvp.paidMethod &&
                                      myRsvp.paidMethod !== 'pending'
                                    ? `Settled (${myRsvp.paidMethod})`
                                    : `Payable to ${sessionClub.clubOwnerName || 'Club Owner'}`}
                                </p>
                              </>
                            )
                          ) : (
                            <p className="text-slate-600">—</p>
                          )}
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[11px] font-semibold text-slate-600 block">
                            Your Match Record
                          </span>
                          <p className="font-mono tabular-nums font-semibold text-slate-900">
                            {didUserJoin
                              ? myMatches.length > 0
                                ? `${myWins}W – ${myLosses}L`
                                : 'Attended'
                              : '—'}
                          </p>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
                {displayedPastSessions.length > visiblePastCount && (
                  <div className="pt-2 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setVisiblePastCount((prev) => prev + 12)}
                      className="h-9 px-4 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shadow-2xs"
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

      {/* Confirmation Modal: Clone Session for Next Week */}
      <ConfirmModal
        open={Boolean(pendingCloneSession)}
        title="Clone Session for Next Week?"
        description={
          pendingCloneSession ? (
            <p>
              Create a new session based on{' '}
              <strong className="font-semibold text-slate-900">
                {pendingCloneSession.title}
              </strong>{' '}
              ({pendingCloneSession.venue} · {pendingCloneSession.courtNumbers})
              scheduled 7 days later?
            </p>
          ) : null
        }
        confirmLabel="Clone Session (+7d)"
        variant="primary"
        onCancel={() => setPendingCloneSession(null)}
        onConfirm={async () => {
          if (!pendingCloneSession) return;
          const target = pendingCloneSession;
          setPendingCloneSession(null);
          await handleCloneSessionClick(target);
        }}
      />
    </div>
  );
};
