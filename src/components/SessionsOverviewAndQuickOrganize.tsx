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
  Users,
  X,
} from 'lucide-react';
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

const UNIFORM_BTN_BASE =
  'h-9 w-full sm:w-auto px-3 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer select-none';

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 pb-4 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Court Sessions
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAllClubsFilter
              ? `All Clubs (${clubs.length}) · Showing court sessions across your clubs`
              : `${activeClub.name} · Free cancel >${activeClub.freeCancelHours}h · Lock <${activeClub.lockCancelHours}h`}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
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
                  label: 'My Joined',
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
              className="h-9 px-3.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Session</span>
            </button>
          )}
        </div>
      </div>

      {/* Admin-Only Session Organizer Modal */}
      {isAdmin && showOrganizerForm && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowOrganizerForm(false)}
        >
          <section
            ref={showQuickOrganizerRef}
            aria-label="Organize Session"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-5"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Schedule Court Session
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Type a quick summary or edit individual court fields below.
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
                    label="Quick Parse"
                    hint="Auto-fills fields"
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

                <div className="grid grid-cols-2 gap-2">
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

                <div className="grid grid-cols-3 gap-1.5">
                  <StyledInput
                    label="Date"
                    type="date"
                    value={parsed.sessionDate}
                    onChange={(e) =>
                      setParsed({ ...parsed, sessionDate: e.target.value })
                    }
                    className="font-mono px-2"
                  />
                  <StyledInput
                    label="Start"
                    type="text"
                    value={parsed.startTime}
                    onChange={(e) =>
                      setParsed({ ...parsed, startTime: e.target.value })
                    }
                    className="font-mono text-center px-1.5"
                  />
                  <StyledInput
                    label="End"
                    type="text"
                    value={parsed.endTime}
                    onChange={(e) =>
                      setParsed({ ...parsed, endTime: e.target.value })
                    }
                    className="font-mono text-center px-1.5"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
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

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowOrganizerForm(false)}
                  className="h-9 px-4 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-9 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Publish Session</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* UPCOMING SESSIONS VIEW */}
      {viewSection === 'upcoming' && (
        <section aria-label="Upcoming Sessions" className="space-y-4">
          {displayedFutureSessions.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center space-y-2">
              <p className="text-xs font-medium text-slate-600">
                {futureFilter === 'joined_only'
                  ? 'You have not joined any upcoming sessions.'
                  : 'No upcoming sessions scheduled.'}
              </p>
              {futureFilter === 'joined_only' && (
                <button
                  type="button"
                  onClick={() => setFutureFilter('all')}
                  className="text-xs font-semibold text-slate-900 underline underline-offset-4"
                >
                  View all upcoming sessions
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {displayedFutureSessions.map((session) => {
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

                return (
                  <article
                    key={session.id}
                    className={`bg-white rounded-xl border p-4 sm:p-5 space-y-4 transition-colors ${
                      isUserGoing
                        ? 'border-slate-300 shadow-2xs'
                        : 'border-slate-200/85'
                    }`}
                  >
                    {/* Row 1: Session Title, Club Context & Action Bar */}
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          {isUserGoing ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Going</span>
                            </span>
                          ) : isUserLateOut ? (
                            <span className="font-semibold text-amber-700">
                              Late Out ({myRsvp?.penaltyPercentApplied}%)
                            </span>
                          ) : (
                            <span className="text-slate-500 font-medium">
                              Open to Join
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
                          <span className="text-slate-600 font-medium truncate">
                            {sessionClub.name}
                          </span>
                        </div>

                        <h2 className="text-base font-bold text-slate-900 tracking-tight truncate">
                          {session.title}
                        </h2>
                      </div>

                      {/* Responsive Action Controls: Clean 3-column grid on mobile, inline flex on sm+ */}
                      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 shrink-0">
                        <div className="grid grid-cols-3 sm:flex items-center gap-2">
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
                                  className={`${UNIFORM_BTN_BASE} bg-slate-900 text-white hover:bg-slate-800`}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>Join</span>
                                </button>
                              ) : policy.canTapOut ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onTapRsvp(
                                      session.id,
                                      activePlayer,
                                      policy.isPenaltyWindow ? 'late_out' : 'out',
                                      policy.penaltyPercent
                                    )
                                  }
                                  title={
                                    policy.isPenaltyWindow
                                      ? `Late withdrawal window: ${policy.penaltyPercent}% court fee applies`
                                      : 'Free tap-out window'
                                  }
                                  className={`${UNIFORM_BTN_BASE} ${
                                    policy.isPenaltyWindow
                                      ? 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                                      : 'bg-slate-100 text-slate-700 border border-slate-200/80 hover:bg-slate-200'
                                  }`}
                                >
                                  {policy.isPenaltyWindow && (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                  )}
                                  <span>
                                    {policy.isPenaltyWindow
                                      ? `Out ${policy.penaltyPercent}%`
                                      : 'Tap Out'}
                                  </span>
                                </button>
                              ) : (
                                <span
                                  className={`${UNIFORM_BTN_BASE} bg-slate-100 text-slate-400 border border-slate-200/60 cursor-not-allowed`}
                                >
                                  <Lock className="w-3.5 h-3.5 shrink-0" />
                                  <span>Locked</span>
                                </span>
                              )}
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => onOpenTapRsvpForSession(session.id)}
                            className={`${UNIFORM_BTN_BASE} text-slate-700 bg-white border border-slate-200 hover:bg-slate-50`}
                          >
                            <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>Roster</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyInviteSnippet(session)}
                            className={`${UNIFORM_BTN_BASE} text-slate-700 bg-white border border-slate-200 hover:bg-slate-50`}
                          >
                            {copiedId === session.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span>Share</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Strictly Admin-Only Operational Controls — 3-col grid on mobile */}
                        {isAdmin && (
                          <div className="grid grid-cols-3 sm:flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                onOpenFeeSplitForSession(session.id, false)
                              }
                              className={`${UNIFORM_BTN_BASE} text-slate-800 bg-slate-100 border border-slate-200/80 hover:bg-slate-200`}
                            >
                              <span>Settle</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onOpenMatchScorerForSession(session.id)
                              }
                              className={`${UNIFORM_BTN_BASE} text-slate-700 bg-white border border-slate-200 hover:bg-slate-50`}
                            >
                              <span>Log Score</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onCloneNextWeekSession(session)}
                              title="Clone session for next week"
                              className={`${UNIFORM_BTN_BASE} text-slate-600 bg-white border border-slate-200 hover:bg-slate-50`}
                            >
                              <Repeat className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>Clone +7d</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row 2: Organized 4-Column Session Details Grid */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3.5 border-t border-slate-100 text-xs">
                      <div className="space-y-0.5">
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>Date &amp; Time</span>
                        </span>
                        <p className="font-mono tabular-nums font-semibold text-slate-900">
                          {session.sessionDate} · {session.startTime}–
                          {session.endTime}
                        </p>
                      </div>

                      <div className="space-y-0.5 min-w-0">
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          <span>Venue &amp; Courts</span>
                        </span>
                        <p className="font-medium text-slate-800 truncate">
                          {session.venue} ·{' '}
                          <span className="text-slate-600">
                            {session.courtNumbers}
                          </span>
                        </p>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <Users className="w-3 h-3 text-slate-400" />
                          <span>Capacity &amp; Court Fee</span>
                        </span>
                        <p className="font-mono tabular-nums text-slate-800">
                          <span className="font-bold text-slate-900">
                            {goingRsvps.length}/{session.maxPlayers}
                          </span>{' '}
                          ({spotsLeft} left) ·{' '}
                          <span className="font-semibold text-slate-900">
                            ${session.courtFee.toFixed(2)}
                          </span>
                        </p>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <ShieldAlert className="w-3 h-3 text-slate-400" />
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

                    {/* Row 3: Clean Lineup & Host Footer */}
                    <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="font-semibold text-slate-700 shrink-0">
                          Lineup ({goingRsvps.length}):
                        </span>
                        <span className="truncate text-slate-600">
                          {goingRsvps.length === 0
                            ? 'No confirmed players yet'
                            : goingRsvps.map((r) => r.playerName).join(', ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400 shrink-0">
                        <span>Host: {session.organizerName}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* PAST SESSION HISTORIES VIEW */}
      {viewSection === 'history' && (
        <section aria-label="Session History" className="space-y-4">
          {displayedPastSessions.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center">
              <p className="text-xs text-slate-500">
                {futureFilter === 'joined_only'
                  ? 'You have not joined any completed sessions in this club yet.'
                  : 'No completed sessions recorded yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {displayedPastSessions.map((session) => {
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
                  (myRsvp.status === 'going' || myRsvp.status === 'late_out');

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
                  <article
                    key={session.id}
                    className="bg-white rounded-xl border border-slate-200/85 p-4 sm:p-5 space-y-4"
                  >
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
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
                            <span className="text-slate-400">Did Not Join</span>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-700 font-medium">
                            Completed
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-600 font-medium">
                            {sessionClub.name}
                          </span>
                        </div>

                        <h3 className="text-base font-bold text-slate-900">
                          {session.title}
                        </h3>
                      </div>

                      <div
                        className={`grid ${
                          canPayShare ? 'grid-cols-3' : 'grid-cols-2'
                        } sm:flex items-center gap-2 shrink-0`}
                      >
                        {canPayShare && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenFeeSplitForSession(session.id, true)
                            }
                            className={`${UNIFORM_BTN_BASE} bg-slate-900 text-white hover:bg-slate-800`}
                          >
                            <CreditCard className="w-3.5 h-3.5 shrink-0" />
                            <span>Pay ${myRsvp.feeShare.toFixed(2)}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            onOpenFeeSplitForSession(session.id, false)
                          }
                          className={`${UNIFORM_BTN_BASE} text-slate-700 bg-white border border-slate-200 hover:bg-slate-50`}
                        >
                          <span>Fee Split</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenMatchScorerForSession(session.id)}
                          className={`${UNIFORM_BTN_BASE} text-slate-700 bg-white border border-slate-200 hover:bg-slate-50`}
                        >
                          <span>Matches ({sessionMatches.length})</span>
                        </button>
                      </div>
                    </div>

                    {/* Structured 4-Column Summary Grid */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3.5 border-t border-slate-100 text-xs">
                      <div className="space-y-0.5">
                        <span className="text-[11px] text-slate-400 block">
                          Date &amp; Venue
                        </span>
                        <p className="font-mono tabular-nums font-medium text-slate-800 truncate">
                          {session.sessionDate} · {session.venue}
                        </p>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[11px] text-slate-400 block">
                          Session Total
                        </span>
                        <p className="font-mono tabular-nums font-semibold text-slate-900">
                          ${finalTotal.toFixed(2)} ({session.shuttlesUsed}{' '}
                          shuttles · {goingRsvps.length}p)
                        </p>
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[11px] text-slate-400 block">
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
                          <p className="text-slate-400">—</p>
                        )}
                      </div>

                      <div className="space-y-0.5">
                        <span className="text-[11px] text-slate-400 block">
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
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
