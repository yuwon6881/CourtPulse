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
import { motion } from 'motion/react';
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
  ConfirmModal,
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
  const [confirmTapOutOpen, setConfirmTapOutOpen] = useState(false);
  const [pendingNoShowRsvp, setPendingNoShowRsvp] =
    useState<SessionRsvp | null>(null);

  const session =
    sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null;

  if (!session) {
    return (
      <div className="p-10 text-center bg-white rounded-2xl border border-slate-200/80">
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

  const spotsOpen = Math.max(0, session.maxPlayers - goingRsvps.length);
  const fillPct = Math.min(
    100,
    Math.round((goingRsvps.length / Math.max(1, session.maxPlayers)) * 100)
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
              className="h-10 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer"
              aria-label="Back to sessions"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Sessions</span>
            </button>
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Session Roster &amp; Instant RSVP
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeClub.name} · {session.sessionDate} ({session.startTime}–
              {session.endTime})
            </p>
          </div>
        </div>

        <div className="w-full sm:w-80">
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

      {/* Prominent Instant RSVP Action Card */}
      {!isCompleted && activePlayer && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className={`rounded-2xl border p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5 ${
            currentRsvp?.status === 'going'
              ? 'bg-emerald-50/40 border-emerald-300/90'
              : currentRsvp?.status === 'out' ||
                currentRsvp?.status === 'late_out'
              ? 'bg-slate-100/70 border-slate-200'
              : 'bg-white border-slate-300 shadow-2xs'
          }`}
        >
          <div className="space-y-1.5">
            {/* Unboxed Metadata Row (Zero-Pill Discipline) */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`font-bold inline-flex items-center gap-1 ${
                  currentRsvp?.status === 'going'
                    ? 'text-emerald-700'
                    : currentRsvp?.status === 'out' ||
                      currentRsvp?.status === 'late_out'
                    ? 'text-slate-600'
                    : 'text-amber-700'
                }`}
              >
                {currentRsvp?.status === 'going' && (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                )}
                {currentRsvp?.status === 'going'
                  ? 'You Are Going'
                  : currentRsvp?.status === 'out' ||
                    currentRsvp?.status === 'late_out'
                  ? 'Marked Not Going / Tapped Out'
                  : 'RSVP Open · Tap Below to Join'}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="font-semibold text-slate-900">
                {session.title}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="text-slate-500 font-mono tabular-nums">
                {session.sessionDate} ({session.startTime}–{session.endTime})
              </span>
            </div>

            <p className="text-xs text-slate-600">
              {session.venue} ({session.courtNumbers}) · Court Fee:{' '}
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                ${session.courtFee.toFixed(2)}
              </span>{' '}
              · {policy.policySummary}
            </p>

            {(Boolean(activePlayer.waiveAllFees) ||
              Number(activePlayer.freeSessionPasses || 0) > 0 ||
              Number(activePlayer.creditBalance || 0) > 0) && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                {Boolean(activePlayer.waiveAllFees) ? (
                  <span className="inline-flex items-center gap-1 text-purple-800 font-semibold">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                    Your Session Fee is Waived (VIP Exemption)
                  </span>
                ) : Number(activePlayer.freeSessionPasses || 0) > 0 ? (
                  <span className="inline-flex items-center gap-1 text-emerald-800 font-semibold">
                    <Ticket className="w-3.5 h-3.5 text-emerald-600" />
                    {Math.floor(Number(activePlayer.freeSessionPasses || 0))}{' '}
                    Free Session{' '}
                    {Math.floor(Number(activePlayer.freeSessionPasses || 0)) ===
                    1
                      ? 'Pass'
                      : 'Passes'}{' '}
                    Available (Auto-Applied)
                  </span>
                ) : null}
                {Number(activePlayer.creditBalance || 0) > 0 && (
                  <span className="text-sky-800 font-semibold font-mono tabular-nums">
                    · ${Number(activePlayer.creditBalance || 0).toFixed(2)} Club
                    Credit Available
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0 w-full lg:w-auto">
            {currentRsvp?.status !== 'going' ? (
              <button
                type="button"
                onClick={() => onTapRsvp(session.id, activePlayer, 'going', 100)}
                className="h-10 px-5 rounded-xl font-semibold text-xs transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs w-full sm:w-auto"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Join</span>
              </button>
            ) : policy.canTapOut ? (
              <button
                type="button"
                onClick={() => setConfirmTapOutOpen(true)}
                className={`h-10 px-5 rounded-xl font-semibold text-xs transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer w-full sm:w-auto ${
                  policy.isPenaltyWindow
                    ? 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                    : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-2xs'
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
              <span className="h-10 px-4 rounded-xl bg-slate-100 text-slate-600 text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>Locked</span>
              </span>
            )}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Attendance & Roster */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 pb-4 border-b border-slate-100">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                <span className="font-semibold text-slate-800">
                  {isCompleted ? 'Completed Session' : 'Upcoming Session'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {session.venue} · {session.courtNumbers}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums font-medium text-slate-700">
                  Court ${session.courtFee.toFixed(2)}
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mt-1">
                {session.title}
              </h2>
            </div>

            <div className="w-full sm:w-40 space-y-1">
              <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                <span className="text-slate-600 font-sans font-medium">Capacity</span>
                <span className="font-bold text-slate-900">
                  {goingRsvps.length}/{session.maxPlayers}
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    spotsOpen === 0 ? 'bg-amber-600' : 'bg-emerald-600'
                  }`}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Confirmed Roster */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-900 inline-flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-600" />
                Confirmed Players ({goingRsvps.length}/{session.maxPlayers})
              </span>
              <span className="text-slate-600 font-mono tabular-nums font-medium">
                {spotsOpen} {spotsOpen === 1 ? 'spot' : 'spots'} open
              </span>
            </div>

            {goingRsvps.length === 0 ? (
              <div className="p-8 text-center rounded-xl border border-slate-200/70 bg-slate-50/50 text-xs text-slate-600">
                No confirmed players yet. Use the button above to join this session.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden">
                {goingRsvps.map((rsvp, idx) => (
                  <motion.div
                    key={rsvp.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.14,
                      delay: Math.min(idx * 0.02, 0.12),
                    }}
                    className="px-4 py-3 bg-white hover:bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono tabular-nums text-slate-500 font-medium w-5 shrink-0">
                        {idx + 1}.
                      </span>
                      <span className="font-semibold text-slate-900 truncate">
                        {rsvp.playerName}
                      </span>
                      {rsvp.playerId === activePlayer?.id && (
                        <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                          · You
                        </span>
                      )}
                      {rsvp.attendanceOutcome === 'no_show' && (
                        <span className="text-[11px] font-semibold text-amber-700 shrink-0">
                          · No-Show ({activeClub.noShowFeePercent}%)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
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
                          onChange={(val) => {
                            if (val === 'no_show' && rsvp.attendanceOutcome !== 'no_show') {
                              setPendingNoShowRsvp(rsvp);
                            } else {
                              onMarkAttendanceOutcome(rsvp.id, val);
                            }
                          }}
                        />
                      )}

                      {isCompleted &&
                        (isAdmin || rsvp.playerId === activePlayer?.id) && (
                          <div className="flex items-center justify-end gap-2 shrink-0">
                            <span
                              className={
                                rsvp.paidStatus === 'paid'
                                  ? 'text-emerald-700 font-sans font-semibold'
                                  : rsvp.paidStatus === 'pending_approval'
                                  ? 'text-blue-700 font-sans font-semibold'
                                  : 'text-amber-700 font-sans font-semibold'
                              }
                            >
                              {rsvp.paidStatus === 'paid'
                                ? 'Received'
                                : rsvp.paidStatus === 'pending_approval'
                                ? 'Pending'
                                : 'Unpaid'}
                            </span>
                            <span className="w-20 text-right font-mono tabular-nums font-bold text-slate-900 text-sm shrink-0">
                              ${rsvp.feeShare.toFixed(2)}
                            </span>
                          </div>
                        )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

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
              <p className="text-xs text-slate-600">
                Tapped out: {outRsvps.map((r) => r.playerName).join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* Right 5 Cols: Share Link & Group Chat Text */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Group Chat Invite &amp; Direct RSVP Link
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Share this direct link or formatted roster message to WhatsApp, Telegram, or WeChat.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <StyledInput
              type="text"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs text-slate-700 bg-slate-50"
              containerClassName="flex-1"
            />
            <button
              type="button"
              onClick={handleCopyUrl}
              className={`h-10 px-3.5 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                copiedLink
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                  : 'text-slate-800 bg-slate-100 hover:bg-slate-200'
              }`}
            >
              {copiedLink ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{copiedLink ? 'Copied!' : 'Copy URL'}</span>
            </button>
          </div>

          <pre className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-800 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed overflow-hidden">
            {groupChatText}
          </pre>

          <button
            type="button"
            onClick={handleCopyChat}
            className="h-10 w-full px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            {copiedChat ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Copied Group Chat Snippet!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy Group Chat Snippet</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Confirmation Modal: Withdraw / Unjoin from Session */}
      {activePlayer && (
        <ConfirmModal
          open={confirmTapOutOpen}
          title={
            policy.isPenaltyWindow
              ? `Late Withdrawal (${policy.penaltyPercent}% Fee Applies)`
              : 'Withdraw from Session?'
          }
          description={
            <div className="space-y-1.5">
              <p>
                Are you sure you want to withdraw from{' '}
                <strong className="font-semibold text-slate-900">
                  {session.title}
                </strong>{' '}
                ({session.sessionDate} · {session.startTime}–{session.endTime})?
              </p>
              {policy.isPenaltyWindow ? (
                <p className="text-amber-800 font-medium">
                  This session is within the late withdrawal window. You will
                  still be billed {policy.penaltyPercent}% of your share when
                  the session split is finalized.
                </p>
              ) : (
                <p className="text-slate-600">
                  Your confirmed court spot will be released immediately at no
                  charge.
                </p>
              )}
            </div>
          }
          confirmLabel={
            policy.isPenaltyWindow
              ? `Confirm Late Out (${policy.penaltyPercent}%)`
              : 'Confirm Withdraw'
          }
          variant={policy.isPenaltyWindow ? 'warning' : 'danger'}
          onCancel={() => setConfirmTapOutOpen(false)}
          onConfirm={async () => {
            setConfirmTapOutOpen(false);
            await onTapRsvp(
              session.id,
              activePlayer,
              policy.isPenaltyWindow ? 'late_out' : 'out',
              policy.penaltyPercent
            );
          }}
        />
      )}

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
              as a No-Show for{' '}
              <strong className="font-semibold text-slate-900">
                {session.title}
              </strong>
              ? Under club policy, No-Show players are billed{' '}
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
