import React, { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Lock,
  MapPin,
  Plus,
  Repeat,
  ShieldAlert,
  Swords,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BadmintonMatch,
  BookingStatus,
  Club,
  ParsedQuickSession,
  Player,
  RsvpStatus,
  Session,
  SessionRsvp,
} from '../types';
import {
  buildGroupChatSnippet,
  evaluateTapOutWindow,
  parseQuickSessionInput,
} from '../utils/badmintonLogic';
import {
  ConfirmModal,
  SegmentedControl,
  StyledInput,
  StyledSelect,
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
  onCreateSession: (
    sessionData: Omit<Session, 'id' | 'ownerId'>
  ) => Promise<Session>;
  onTapRsvp: (
    sessionId: string,
    player: Player,
    status: RsvpStatus,
    penaltyPercent?: number
  ) => Promise<void>;
  onOpenTapRsvpForSession: (sessionId: string) => void;
  onOpenMatchScorerForSession: (sessionId: string) => void;
  onOpenFeeSplitForSession: (sessionId: string, openPayInfo?: boolean) => void;
  onCloneNextWeekSession: (session: Session) => Promise<void>;
  showQuickOrganizerRef?: React.RefObject<HTMLDivElement | null>;
}

const DEFAULT_PROMPT =
  'Thu 8pm-10pm at Bintang Badminton Hall Court 3 & 4, $72 court, max 8';

const QUICK_TEMPLATES = [
  {
    label: 'Thu Evening · 2 Courts ($72)',
    prompt: 'Thu 8pm-10pm at Bintang Badminton Hall Court 3 & 4, $72 court, max 8',
  },
  {
    label: 'Sat Morning Peak · 2 Courts ($96)',
    prompt: 'Sat 10am-12pm at OCBC Arena Hall 2 Court 5 & 6, $96 court, max 10',
  },
  {
    label: 'Sun Social · 3 Courts ($108)',
    prompt: 'Sun 4pm-6pm at Clementi Sports Hall Court 1, 2 & 3, $108 court, max 12',
  },
];

const UNIFORM_BTN_BASE =
  'h-9 w-full sm:w-auto px-3.5 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer select-none';

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
  onCreateSession,
  onTapRsvp,
  onOpenTapRsvpForSession,
  onOpenMatchScorerForSession,
  onOpenFeeSplitForSession,
  onCloneNextWeekSession,
  showQuickOrganizerRef,
}) => {
  const [showOrganizerForm, setShowOrganizerForm] = useState<boolean>(false);
  const [targetClubId, setTargetClubId] = useState<string>(activeClub.id);
  const [quickText, setQuickText] = useState<string>(DEFAULT_PROMPT);
  const [parsed, setParsed] = useState<ParsedQuickSession>(() =>
    parseQuickSessionInput(DEFAULT_PROMPT)
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [pendingTapOut, setPendingTapOut] = useState<{
    session: Session;
    status: RsvpStatus;
    penaltyPercent: number;
    isPenaltyWindow: boolean;
  } | null>(null);
  const [pendingCloneSession, setPendingCloneSession] =
    useState<Session | null>(null);
  const [viewSection, setViewSection] = useState<'upcoming' | 'history'>(
    'upcoming'
  );
  const [futureFilter, setFutureFilter] = useState<'all' | 'joined_only'>('all');

  const handleQuickTextChange = (val: string) => {
    setQuickText(val);
    setParsed(parseQuickSessionInput(val));
  };

  const getClubForSession = (session: Session): Club => {
    return clubs.find((c) => c.id === session.clubId) || activeClub;
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const chosenClub =
      clubs.find((c) => c.id === targetClubId) || activeClub;
    await onCreateSession({
      clubId: chosenClub.id,
      title: parsed.title.trim() || 'Club Session',
      venue: parsed.venue.trim() || chosenClub.name,
      courtNumbers: parsed.courtNumbers.trim() || 'Court 1',
      sessionDate: parsed.sessionDate || '2026-10-22',
      startTime: parsed.startTime || '20:00',
      endTime: parsed.endTime || '22:00',
      bookingStatus: parsed.bookingStatus,
      courtFee: parsed.courtFee,
      shuttlesUsed: 0,
      shuttleUnitCost: 3.0,
      shuttleFee: 0,
      maxPlayers: parsed.maxPlayers,
      organizerName: activePlayer?.name || 'Alex Tan',
      paymentInfo: chosenClub.paymentInfo,
      feeSplitFinalized: false,
    });
    setShowOrganizerForm(false);
  };

  const handleCopyInviteSnippet = async (session: Session) => {
    const sessionRsvps = rsvps.filter((r) => r.sessionId === session.id);
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

  const futureSessions = sessions.filter(
    (s) => s.bookingStatus !== 'completed'
  );
  const pastSessions = sessions.filter((s) => s.bookingStatus === 'completed');

  const displayedFutureSessions = futureSessions.filter((s) => {
    if (futureFilter === 'all' || !activePlayer) return true;
    const myRsvp = rsvps.find(
      (r) => r.sessionId === s.id && r.playerId === activePlayer.id
    );
    return myRsvp?.status === 'going';
  });

  const displayedPastSessions = pastSessions.filter((s) => {
    if (futureFilter === 'all' || !activePlayer) return true;
    const myRsvp = rsvps.find(
      (r) => r.sessionId === s.id && r.playerId === activePlayer.id
    );
    return myRsvp?.status === 'going' || myRsvp?.status === 'late_out';
  });

  return (
    <div className="space-y-6">
      {/* Clean Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Court Sessions &amp; Schedule
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {isAllClubsFilter
              ? `All Joined Clubs (${clubs.length}) · One-tap RSVP, live court rosters, and automated fee splits`
              : `${activeClub.name} · Free cancel >${activeClub.freeCancelHours}h · Lock <${activeClub.lockCancelHours}h · Late ${activeClub.lateCancelFeePercent}%`}
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

          {/* Admin-Only Session Creation Trigger */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowOrganizerForm(!showOrganizerForm)}
              className="h-9 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-2xs rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Schedule Session</span>
            </button>
          )}
        </div>
      </div>

      {/* Admin-Only Session Organizer Modal */}
      <AnimatePresence>
        {isAdmin && showOrganizerForm && (
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
                  <h2 className="text-base font-bold text-slate-900">
                    Schedule Court Session
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pick a preset template, type a natural-language summary, or customize court fields below.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowOrganizerForm(false)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Quick Templates Bar */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                  <Wand2 className="w-3 h-3 text-emerald-600" />
                  <span>One-Tap Session Templates</span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {QUICK_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.label}
                      type="button"
                      onClick={() => handleQuickTextChange(tpl.prompt)}
                      className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                        quickText === tpl.prompt
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-semibold'
                          : 'bg-slate-50 border-slate-200/90 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
                  {clubs.length > 1 && (
                    <div className="lg:col-span-4">
                      <StyledSelect
                        label="Club Workspace"
                        value={targetClubId}
                        onChange={(e) => setTargetClubId(e.target.value)}
                      >
                        {clubs.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </StyledSelect>
                    </div>
                  )}
                  <div
                    className={
                      clubs.length > 1 ? 'lg:col-span-8' : 'lg:col-span-12'
                    }
                  >
                    <StyledInput
                      id="quick-input"
                      label="Smart Session Parser"
                      hint="Updates fields live"
                      type="text"
                      value={quickText}
                      onChange={(e) => handleQuickTextChange(e.target.value)}
                      placeholder="e.g. Thu 8pm-10pm at Bintang Court 3 & 4, $72 court, max 8"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <StyledInput
                    label="Venue"
                    type="text"
                    required
                    maxLength={120}
                    value={parsed.venue}
                    onChange={(e) =>
                      setParsed({ ...parsed, venue: e.target.value })
                    }
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <StyledInput
                      label="Courts"
                      type="text"
                      required
                      maxLength={60}
                      value={parsed.courtNumbers}
                      onChange={(e) =>
                        setParsed({ ...parsed, courtNumbers: e.target.value })
                      }
                    />
                    <StyledSelect
                      label="Status"
                      value={parsed.bookingStatus}
                      onChange={(e) =>
                        setParsed({
                          ...parsed,
                          bookingStatus: e.target.value as BookingStatus,
                        })
                      }
                    >
                      <option value="booked">Booked</option>
                      <option value="pending">Pending</option>
                    </StyledSelect>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <div className="sm:col-span-1 lg:col-span-2">
                    <StyledInput
                      label="Session Date"
                      type="date"
                      value={parsed.sessionDate}
                      onChange={(e) =>
                        setParsed({ ...parsed, sessionDate: e.target.value })
                      }
                      className="font-mono"
                    />
                  </div>
                  <StyledInput
                    label="Start Time"
                    type="text"
                    value={parsed.startTime}
                    onChange={(e) =>
                      setParsed({ ...parsed, startTime: e.target.value })
                    }
                    className="font-mono"
                  />
                  <StyledInput
                    label="End Time"
                    type="text"
                    value={parsed.endTime}
                    onChange={(e) =>
                      setParsed({ ...parsed, endTime: e.target.value })
                    }
                    className="font-mono"
                  />
                  <div className="grid grid-cols-2 sm:col-span-3 lg:col-span-1 gap-3">
                    <StyledInput
                      label="Court Fee"
                      prefixText="$"
                      type="number"
                      min={0}
                      value={parsed.courtFee}
                      onChange={(e) =>
                        setParsed({
                          ...parsed,
                          courtFee: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="font-mono tabular-nums"
                    />
                    <StyledInput
                      label="Max Players"
                      type="number"
                      min={2}
                      max={32}
                      value={parsed.maxPlayers}
                      onChange={(e) =>
                        setParsed({
                          ...parsed,
                          maxPlayers: parseInt(e.target.value, 10) || 8,
                        })
                      }
                      className="font-mono tabular-nums"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowOrganizerForm(false)}
                    className="h-10 px-4 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-10 px-5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Publish Session</span>
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
            className="space-y-4"
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
              <div className="space-y-4">
                {displayedFutureSessions.map((session, idx) => {
                  const sessionClub = getClubForSession(session);
                  const sessionRsvps = rsvps.filter(
                    (r) => r.sessionId === session.id
                  );
                  const goingRsvps = sessionRsvps.filter(
                    (r) => r.status === 'going'
                  );
                  const myRsvp = activePlayer
                    ? sessionRsvps.find((r) => r.playerId === activePlayer.id)
                    : undefined;
                  const isUserGoing = myRsvp?.status === 'going';
                  const isUserLateOut = myRsvp?.status === 'late_out';
                  const policy = evaluateTapOutWindow(session, sessionClub);
                  const spotsLeft = Math.max(
                    0,
                    session.maxPlayers - goingRsvps.length
                  );
                  const fillPercent = Math.min(
                    100,
                    Math.round(
                      (goingRsvps.length / Math.max(1, session.maxPlayers)) *
                        100
                    )
                  );

                  return (
                    <motion.article
                      key={session.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.18,
                        delay: Math.min(idx * 0.03, 0.15),
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className={`bg-white rounded-2xl border p-5 sm:p-6 space-y-4 transition-all ${
                        isUserGoing
                          ? 'border-emerald-500/70 shadow-xs hover:shadow-lg hover:shadow-emerald-900/5'
                          : 'border-slate-200/90 shadow-2xs hover:border-slate-300 hover:shadow-md hover:shadow-slate-900/5'
                      }`}
                    >
                      {/* Row 1: Session Title, Club Context & Action Bar */}
                      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            {isUserGoing ? (
                              <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>You Are Going</span>
                              </span>
                            ) : isUserLateOut ? (
                              <span className="font-semibold text-amber-700">
                                Late Out ({myRsvp?.penaltyPercentApplied}%)
                              </span>
                            ) : spotsLeft === 0 ? (
                              <span className="font-semibold text-amber-700">
                                Roster Full
                              </span>
                            ) : (
                              <span className="text-emerald-700 font-semibold">
                                Open · {spotsLeft} {spotsLeft === 1 ? 'spot' : 'spots'} left
                              </span>
                            )}
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span
                              className={
                                session.bookingStatus === 'booked'
                                  ? 'text-slate-700 font-medium'
                                  : 'text-amber-700 font-medium'
                              }
                            >
                              {session.bookingStatus === 'booked'
                                ? 'Court Booked'
                                : 'Pending Booking'}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="text-slate-700 font-semibold break-words">
                              {sessionClub.name}
                            </span>
                          </div>

                          <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight break-words">
                            {session.title}
                          </h2>
                        </div>

                        {/* Balanced Primary Action Controls (Max 3 in Header) */}
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {activePlayer && (
                            <>
                              {!isUserGoing ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onTapRsvp(
                                      session.id,
                                      activePlayer,
                                      'going',
                                      100
                                    )
                                  }
                                  className={`${UNIFORM_BTN_BASE} bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs`}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>Join</span>
                                </button>
                              ) : policy.canTapOut ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPendingTapOut({
                                      session,
                                      status: policy.isPenaltyWindow
                                        ? 'late_out'
                                        : 'out',
                                      penaltyPercent: policy.penaltyPercent,
                                      isPenaltyWindow: policy.isPenaltyWindow,
                                    })
                                  }
                                  title={
                                    policy.isPenaltyWindow
                                      ? `Late withdrawal window: ${policy.penaltyPercent}% court fee applies`
                                      : 'Free tap-out window'
                                  }
                                  className={`${UNIFORM_BTN_BASE} ${
                                    policy.isPenaltyWindow
                                      ? 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                                      : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                                  }`}
                                >
                                  {policy.isPenaltyWindow && (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                  )}
                                  <span>
                                    {policy.isPenaltyWindow
                                      ? `Out (${policy.penaltyPercent}%)`
                                      : 'Out'}
                                  </span>
                                </button>
                              ) : (
                                <span
                                  className={`${UNIFORM_BTN_BASE} bg-slate-100 text-slate-500 border border-slate-200/80 cursor-not-allowed`}
                                >
                                  <Lock className="w-3.5 h-3.5 shrink-0" />
                                  <span>Locked</span>
                                </span>
                              )}
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              onOpenTapRsvpForSession(session.id)
                            }
                            className={`${UNIFORM_BTN_BASE} text-slate-800 bg-white border border-slate-300 hover:bg-slate-50`}
                          >
                            <Users className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            <span>Roster &amp; RSVP</span>
                          </button>

                          {isAdmin ? (
                            <button
                              type="button"
                              onClick={() =>
                                onOpenFeeSplitForSession(session.id, false)
                              }
                              className={`${UNIFORM_BTN_BASE} text-white bg-slate-900 hover:bg-slate-800`}
                            >
                              <CreditCard className="w-3.5 h-3.5 shrink-0" />
                              <span>Settle Split</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleCopyInviteSnippet(session)}
                              className={`${UNIFORM_BTN_BASE} ${
                                copiedId === session.id
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                                  : 'text-slate-800 bg-white border border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              {copiedId === session.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <span>Copied Invite</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                                  <span>Copy Invite</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Organized 4-Column Session Details Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-3.5 border-t border-slate-100 text-xs">
                        <div className="space-y-0.5">
                          <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-500" />
                            <span>Date &amp; Time</span>
                          </span>
                          <p className="font-mono tabular-nums font-semibold text-slate-900">
                            {session.sessionDate} · {session.startTime}–
                            {session.endTime}
                          </p>
                        </div>

                        <div className="space-y-0.5 min-w-0">
                          <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-slate-500" />
                            <span>Venue &amp; Courts</span>
                          </span>
                          <p className="font-semibold text-slate-900 break-words">
                            {session.venue} ·{' '}
                            <span className="text-slate-700 font-medium">
                              {session.courtNumbers}
                            </span>
                          </p>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3 text-slate-500" />
                              <span>Capacity &amp; Court Fee</span>
                            </span>
                            <span className="font-mono tabular-nums text-slate-800 font-bold">
                              ${session.courtFee.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  spotsLeft === 0
                                    ? 'bg-amber-600'
                                    : 'bg-emerald-600'
                                }`}
                                style={{ width: `${fillPercent}%` }}
                              />
                            </div>
                            <span className="font-mono tabular-nums font-bold text-slate-900 text-xs shrink-0">
                              {goingRsvps.length}/{session.maxPlayers}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3 text-slate-500" />
                            <span>Withdrawal Policy</span>
                          </span>
                          <p
                            className={`font-medium ${
                              policy.isPenaltyWindow
                                ? 'text-amber-700'
                                : 'text-slate-700'
                            }`}
                          >
                            {policy.isPenaltyWindow
                              ? policy.canTapOut
                                ? `Late window (${policy.penaltyPercent}% fee)`
                                : `Locked (<${sessionClub.lockCancelHours}h cutoff)`
                              : `Free cancel (>${sessionClub.freeCancelHours}h prior)`}
                          </p>
                        </div>
                      </div>

                      {/* Row 3: Clean Lineup & Secondary Utilities Footer */}
                      <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-slate-600">
                        <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-slate-800 shrink-0">
                            Confirmed Lineup ({goingRsvps.length}):
                          </span>
                          <span className="break-words text-slate-700">
                            {goingRsvps.length === 0
                              ? 'No confirmed players yet — tap Join Session to take the first spot'
                              : goingRsvps.map((r) => r.playerName).join(', ')}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-600 shrink-0">
                          <span>Organizer: {session.organizerName}</span>
                          {isAdmin && (
                            <div className="flex flex-wrap items-center gap-1.5 ml-1">
                              <button
                                type="button"
                                onClick={() => handleCopyInviteSnippet(session)}
                                className="h-7 px-2.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/90 text-slate-700 hover:text-slate-950 font-semibold shadow-2xs inline-flex items-center gap-1 transition-all cursor-pointer"
                              >
                                {copiedId === session.id ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    <span className="text-emerald-700">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3 text-slate-500" />
                                    <span>Copy Invite</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={cloningId === session.id}
                                onClick={() => setPendingCloneSession(session)}
                                title="Clone session for next week (+7 days)"
                                className="h-7 px-2.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/90 text-slate-700 hover:text-slate-950 font-semibold shadow-2xs inline-flex items-center gap-1 transition-all cursor-pointer"
                              >
                                <Repeat
                                  className={`w-3 h-3 text-slate-500 ${
                                    cloningId === session.id ? 'animate-spin' : ''
                                  }`}
                                />
                                <span>
                                  {cloningId === session.id
                                    ? 'Cloned!'
                                    : 'Clone +7d'}
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
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
            className="space-y-4"
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
              <div className="space-y-4">
                {displayedPastSessions.map((session, idx) => {
                  const sessionClub = getClubForSession(session);
                  const sessionRsvps = rsvps.filter(
                    (r) => r.sessionId === session.id
                  );
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

                  const sessionMatches = matches.filter(
                    (m) => m.sessionId === session.id
                  );
                  const myMatches = activePlayer
                    ? sessionMatches.filter(
                        (m) =>
                          m.teamAPlayer1Id === activePlayer.id ||
                          m.teamAPlayer2Id === activePlayer.id ||
                          m.teamBPlayer1Id === activePlayer.id ||
                          m.teamBPlayer2Id === activePlayer.id
                      )
                    : [];
                  const myWins = activePlayer
                    ? myMatches.filter((m) => {
                        const inA =
                          m.teamAPlayer1Id === activePlayer.id ||
                          m.teamAPlayer2Id === activePlayer.id;
                        return (
                          (inA && m.winnerSide === 'A') ||
                          (!inA && m.winnerSide === 'B')
                        );
                      }).length
                    : 0;
                  const myLosses = myMatches.length - myWins;
                  const finalTotal = session.courtFee + session.shuttleFee;
                  const canPayShare =
                    didUserJoin &&
                    myRsvp &&
                    myRsvp.feeShare > 0 &&
                    myRsvp.paidStatus === 'unpaid';

                  return (
                    <motion.article
                      key={session.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.18,
                        delay: Math.min(idx * 0.03, 0.15),
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 space-y-4 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
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
                            <span className="text-slate-700 font-medium">
                              Completed
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-700 font-semibold break-words">
                              {sessionClub.name}
                            </span>
                          </div>

                          <h3 className="text-base sm:text-lg font-bold text-slate-900 break-words">
                            {session.title}
                          </h3>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {canPayShare ? (
                            <button
                              type="button"
                              onClick={() =>
                                onOpenFeeSplitForSession(session.id, true)
                              }
                              className={`${UNIFORM_BTN_BASE} bg-emerald-600 text-white hover:bg-emerald-700`}
                            >
                              <CreditCard className="w-3.5 h-3.5 shrink-0" />
                              <span>Pay ${myRsvp.feeShare.toFixed(2)}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                onOpenFeeSplitForSession(session.id, false)
                              }
                              className={`${UNIFORM_BTN_BASE} text-slate-800 bg-white border border-slate-300 hover:bg-slate-50`}
                            >
                              <CreditCard className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                              <span>Fee Split</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              onOpenMatchScorerForSession(session.id)
                            }
                            className={`${UNIFORM_BTN_BASE} text-slate-800 bg-white border border-slate-300 hover:bg-slate-50`}
                          >
                            <Swords className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            <span>Matches ({sessionMatches.length})</span>
                          </button>
                        </div>
                      </div>

                      {/* Structured 4-Column Summary Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-3.5 border-t border-slate-100 text-xs">
                        <div className="space-y-0.5">
                          <span className="text-[11px] font-semibold text-slate-600 block">
                            Date &amp; Venue
                          </span>
                          <p className="font-mono tabular-nums font-medium text-slate-800 break-words">
                            {session.sessionDate} · {session.venue}
                          </p>
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[11px] font-semibold text-slate-600 block">
                            Session Total
                          </span>
                          <p className="font-mono tabular-nums font-semibold text-slate-900">
                            ${finalTotal.toFixed(2)} ({session.shuttlesUsed}{' '}
                            shuttles · {goingRsvps.length}p)
                          </p>
                        </div>

                        <div className="space-y-0.5">
                          <span className="text-[11px] font-semibold text-slate-600 block">
                            Your Fee Share
                          </span>
                          {didUserJoin && myRsvp ? (
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
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* Confirmation Modal: Withdraw / Unjoin from Session */}
      <ConfirmModal
        open={Boolean(pendingTapOut && activePlayer)}
        title={
          pendingTapOut?.isPenaltyWindow
            ? `Late Withdrawal (${pendingTapOut.penaltyPercent}% Fee Applies)`
            : 'Withdraw from Session?'
        }
        description={
          pendingTapOut ? (
            <div className="space-y-1.5">
              <p>
                Are you sure you want to leave{' '}
                <strong className="font-semibold text-slate-900">
                  {pendingTapOut.session.title}
                </strong>{' '}
                ({pendingTapOut.session.sessionDate} ·{' '}
                {pendingTapOut.session.startTime}–
                {pendingTapOut.session.endTime})?
              </p>
              {pendingTapOut.isPenaltyWindow ? (
                <p className="text-amber-800 font-medium">
                  This session is within the late withdrawal window. You will
                  still be billed {pendingTapOut.penaltyPercent}% of your share
                  when the session split is finalized.
                </p>
              ) : (
                <p className="text-slate-600">
                  Your confirmed court spot will be released immediately at no
                  charge.
                </p>
              )}
            </div>
          ) : null
        }
        confirmLabel={
          pendingTapOut?.isPenaltyWindow
            ? `Confirm Late Out (${pendingTapOut.penaltyPercent}%)`
            : 'Confirm Withdraw'
        }
        variant={pendingTapOut?.isPenaltyWindow ? 'warning' : 'danger'}
        onCancel={() => setPendingTapOut(null)}
        onConfirm={async () => {
          if (!pendingTapOut || !activePlayer) return;
          const target = pendingTapOut;
          setPendingTapOut(null);
          await onTapRsvp(
            target.session.id,
            activePlayer,
            target.status,
            target.penaltyPercent
          );
        }}
      />

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
