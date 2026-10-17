import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Lock,
  Sparkles,
  Ticket,
  Users,
} from 'lucide-react';
import {
  AttendanceOutcome,
  Club,
  Player,
  RsvpStatus,
  Session,
  SessionRsvp,
} from '../types';
import {
  buildGroupChatSnippet,
  buildShareableClubAndSessionUrl,
  evaluateTapOutWindow,
} from '../utils/badmintonLogic';
import {
  SegmentedControl,
  StyledInput,
  StyledSelect,
} from './ui/FormControls';

interface TapRsvpPortalProps {
  activeClub: Club;
  sessions: Session[];
  selectedSessionId: string;
  onSelectSession: (id: string) => void;
  rsvps: SessionRsvp[];
  activePlayer: Player | null;
  isAdmin: boolean;
  onTapRsvp: (
    sessionId: string,
    player: Player,
    status: RsvpStatus,
    penaltyPercent?: number
  ) => Promise<void>;
  onMarkAttendanceOutcome: (
    rsvpId: string,
    outcome: AttendanceOutcome
  ) => Promise<void>;
  onBackToSessions?: () => void;
}

export const TapRsvpPortal: React.FC<TapRsvpPortalProps> = ({
  activeClub,
  sessions,
  selectedSessionId,
  onSelectSession,
  rsvps,
  activePlayer,
  isAdmin,
  onTapRsvp,
  onMarkAttendanceOutcome,
  onBackToSessions,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedChat, setCopiedChat] = useState(false);

  const session =
    sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null;

  if (!session) {
    return (
      <div className="p-10 text-center bg-white rounded-xl border border-slate-200/80">
        <p className="text-xs text-slate-500">
          No session scheduled for {activeClub.name}.
        </p>
      </div>
    );
  }

  const sessionRsvps = rsvps.filter((r) => r.sessionId === session.id);
  const goingRsvps = sessionRsvps.filter((r) => r.status === 'going');
  const lateOutRsvps = sessionRsvps.filter((r) => r.status === 'late_out');
  const outRsvps = sessionRsvps.filter((r) => r.status === 'out');

  const currentRsvp = activePlayer
    ? sessionRsvps.find((r) => r.playerId === activePlayer.id)
    : undefined;

  const isCompleted =
    session.bookingStatus === 'completed' && session.feeSplitFinalized;
  const policy = evaluateTapOutWindow(session, activeClub);

  const shareUrl = buildShareableClubAndSessionUrl(activeClub.id, session);
  const groupChatText = buildGroupChatSnippet(
    activeClub,
    session,
    sessionRsvps
  );

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleCopyChat = async () => {
    try {
      await navigator.clipboard.writeText(groupChatText);
      setCopiedChat(true);
      setTimeout(() => setCopiedChat(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          {onBackToSessions && (
            <button
              type="button"
              onClick={onBackToSessions}
              className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 shrink-0 cursor-pointer"
              aria-label="Back to sessions"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Session Roster &amp; Instant RSVP
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeClub.name} · {session.sessionDate} ({session.startTime}–
              {session.endTime})
            </p>
          </div>
        </div>

        <div className="w-full sm:w-72">
          <StyledSelect
            aria-label="Select session"
            value={session.id}
            onChange={(e) => onSelectSession(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sessionDate} · {s.title}
              </option>
            ))}
          </StyledSelect>
        </div>
      </div>

      {/* Prominent Instant RSVP Action Card (Shown immediately when navigating to a shared session URL) */}
      {!isCompleted && activePlayer && (
        <div
          className={`rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            currentRsvp?.status === 'going'
              ? 'bg-emerald-50/60 border-emerald-200/90'
              : currentRsvp?.status === 'out' ||
                currentRsvp?.status === 'late_out'
              ? 'bg-slate-100/80 border-slate-200'
              : 'bg-white border-slate-300 shadow-2xs'
          }`}
        >
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                  currentRsvp?.status === 'going'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : currentRsvp?.status === 'out' ||
                      currentRsvp?.status === 'late_out'
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-amber-50 text-amber-900 border-amber-300'
                }`}
              >
                {currentRsvp?.status === 'going'
                  ? 'You Are Going'
                  : currentRsvp?.status === 'out' ||
                    currentRsvp?.status === 'late_out'
                  ? 'Not Going / Tapped Out'
                  : 'Action Required · RSVP Open'}
              </span>
              <span className="text-xs font-semibold text-slate-900">
                {session.title}
              </span>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                · {session.sessionDate} ({session.startTime}–{session.endTime})
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {session.venue} ({session.courtNumbers}) · Court Fee:{' '}
              <span className="font-mono font-semibold text-slate-900">
                ${session.courtFee.toFixed(2)}
              </span>{' '}
              · {policy.policySummary}
            </p>
            {(Boolean(activePlayer.waiveAllFees) ||
              Number(activePlayer.freeSessionPasses || 0) > 0 ||
              Number(activePlayer.creditBalance || 0) > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {Boolean(activePlayer.waiveAllFees) ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200 text-[11px] font-semibold">
                    <Sparkles className="w-3 h-3" />
                    Your Session Fee is Waived (VIP Exemption)
                  </span>
                ) : Number(activePlayer.freeSessionPasses || 0) > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-semibold">
                    <Ticket className="w-3 h-3" />
                    {Math.floor(Number(activePlayer.freeSessionPasses || 0))} Free Session{' '}
                    {Math.floor(Number(activePlayer.freeSessionPasses || 0)) === 1
                      ? 'Pass'
                      : 'Passes'}{' '}
                    Available — Fee Waived Automatically
                  </span>
                ) : null}
                {Number(activePlayer.creditBalance || 0) > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200 text-[11px] font-semibold tabular-nums">
                    ${Number(activePlayer.creditBalance || 0).toFixed(2)} Club Credit Available (Auto-Applied to Split)
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onTapRsvp(session.id, activePlayer, 'going', 100)}
              className={`h-10 px-4 rounded-lg font-semibold text-xs transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                currentRsvp?.status === 'going'
                  ? 'bg-emerald-700 text-white ring-2 ring-emerald-700/20'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                {currentRsvp?.status === 'going'
                  ? 'Joined (Going)'
                  : 'Join Session'}
              </span>
            </button>

            {policy.canTapOut ? (
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
                className={`h-10 px-4 rounded-lg font-semibold text-xs transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  currentRsvp?.status === 'out' ||
                  currentRsvp?.status === 'late_out'
                    ? 'bg-slate-800 text-white'
                    : policy.isPenaltyWindow
                    ? 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {policy.isPenaltyWindow && (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                )}
                <span>
                  {currentRsvp?.status === 'out' ||
                  currentRsvp?.status === 'late_out'
                    ? 'Marked Not Going'
                    : policy.isPenaltyWindow
                    ? `Late Out (${policy.penaltyPercent}%)`
                    : 'Not Going / Tap Out'}
                </span>
              </button>
            ) : (
              <span className="h-10 px-3.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>Tap-Out Locked</span>
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Attendance & Roster */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200/80 p-4 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 pb-4 border-b border-slate-100">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <span className="font-semibold text-slate-800">
                  {isCompleted ? 'Completed' : 'Upcoming'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {session.venue} · {session.courtNumbers}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Court ${session.courtFee.toFixed(2)}
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mt-1">
                {session.title}
              </h2>
            </div>
          </div>

          {/* Confirmed Roster */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-900 inline-flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                Going ({goingRsvps.length}/{session.maxPlayers})
              </span>
              <span className="text-slate-400 font-mono tabular-nums">
                {Math.max(0, session.maxPlayers - goingRsvps.length)} spots open
              </span>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200/70 rounded-lg overflow-hidden">
              {goingRsvps.map((rsvp, idx) => (
                <div
                  key={rsvp.id}
                  className="px-3.5 sm:px-4 py-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono tabular-nums text-slate-400 shrink-0">
                      {idx + 1}.
                    </span>
                    <span className="font-semibold text-slate-900 truncate">
                      {rsvp.playerName}
                    </span>
                    {rsvp.playerId === activePlayer?.id && (
                      <span className="text-[11px] font-medium text-emerald-700 shrink-0">
                        · You
                      </span>
                    )}
                    {rsvp.attendanceOutcome === 'no_show' && (
                      <span className="text-[11px] font-medium text-amber-700 shrink-0">
                        · No-Show ({activeClub.noShowFeePercent}%)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3">
                    {isCompleted &&
                      (isAdmin || rsvp.playerId === activePlayer?.id) && (
                        <span className="font-mono tabular-nums text-slate-600">
                          ${rsvp.feeShare.toFixed(2)} ·{' '}
                          {rsvp.paidStatus === 'paid'
                            ? 'Cleared'
                            : rsvp.paidStatus === 'pending_approval'
                            ? 'Pending'
                            : 'Unpaid'}
                        </span>
                      )}

                    {/* Strictly Admin Only: Mark Present vs No-Show */}
                    {isAdmin && (
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
                  </div>
                </div>
              ))}
            </div>

            {lateOutRsvps.length > 0 && (
              <p className="text-xs text-amber-800 pt-1">
                <span className="font-semibold">Late Tap-Out:</span>{' '}
                {lateOutRsvps
                  .map(
                    (r) =>
                      `${r.playerName} (${r.penaltyPercentApplied}%${
                        isCompleted &&
                        (isAdmin || r.playerId === activePlayer?.id)
                          ? ` · $${r.feeShare.toFixed(2)}`
                          : ''
                      })`
                  )
                  .join(', ')}
              </p>
            )}

            {outRsvps.length > 0 && (
              <p className="text-xs text-slate-400">
                Tapped out: {outRsvps.map((r) => r.playerName).join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* Right 5 Cols: Share Link & Group Chat Text */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200/80 p-4 sm:p-6 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Group Chat Invite
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Share this link or formatted roster message to your group chat.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <StyledInput
              type="text"
              readOnly
              value={shareUrl}
              className="font-mono text-slate-600 bg-slate-50"
            />
            <button
              type="button"
              onClick={handleCopyUrl}
              className="h-10 w-28 px-3 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {copiedLink ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
            </button>
          </div>

          <pre className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/70 text-slate-700 text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto">
            {groupChatText}
          </pre>

          <button
            type="button"
            onClick={handleCopyChat}
            className="h-10 w-full px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
          >
            {copiedChat ? 'Copied to Clipboard' : 'Copy Chat Snippet'}
          </button>
        </div>
      </div>
    </div>
  );
};
