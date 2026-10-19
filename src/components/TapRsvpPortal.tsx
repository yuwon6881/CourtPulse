import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Edit3,
  Gift,
  Lock,
  Minus,
  Phone,
  Plus,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Ticket,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AttendanceOutcome,
  BadmintonMatch,
  BookingStatus,
  Club,
  ClubPaymentDetails,
  MatchFormat,
  PermissionTier,
  Player,
  RankedPlayer,
  RsvpStatus,
  Session,
  SessionRsvp,
} from '../types';
import {
  buildGroupChatSnippet,
  buildShareableClubAndSessionUrl,
  computePlayerLeaderboardAndTiers,
  computeWeightedSessionSplits,
  evaluateTapOutWindow,
  formatMatchSideLabel,
  getPlayerClubWallet,
  getRsvpGuestCount,
  getRsvpPartySize,
  getSessionDateDisplay,
  getSessionGoingHeadcount,
  isPlayerInMatch,
  isSessionCompletedOrPast,
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
  FormAlertBanner,
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
  players: Player[];
  activePlayer: Player | null;
  isAdmin: boolean;
  permissionTier?: PermissionTier;
  canManageClub?: boolean;
  initialOpenPayInfo?: boolean;
  onConsumeInitialOpenPayInfo?: () => void;
  onTapRsvp: (
    sessionId: string,
    player: Player,
    status: RsvpStatus,
    penaltyPercent?: number,
    guestCount?: number
  ) => Promise<void>;
  onMarkAttendanceOutcome: (
    rsvpId: string,
    outcome: AttendanceOutcome
  ) => Promise<void>;
  onUpdateSessionBooking?: (
    sessionId: string,
    updates: {
      bookingStatus: BookingStatus;
      courtFee: number;
      courtNumbers: string;
      maxPlayers: number;
    }
  ) => Promise<void>;
  onUpdateClubPaymentDetails?: (
    clubId: string,
    details: ClubPaymentDetails
  ) => Promise<void>;
  onFinalizeSessionShuttleAndSplit?: (
    sessionId: string,
    bookingStatus: BookingStatus,
    courtFee: number,
    shuttlesUsed: number,
    shuttleUnitCost: number,
    courtNumbers: string,
    finalizeSplit: boolean
  ) => Promise<void>;
  onNotifyPaymentSentForRsvp?: (
    rsvpId: string,
    method?: string
  ) => Promise<void>;
  onAcceptOrClearSingleRsvp?: (
    rsvpId: string,
    method?: string
  ) => Promise<void>;
  onRejectPaymentForRsvp?: (rsvpId: string) => Promise<void>;
  onOpenMatchScorerForSession?: (sessionId: string) => void;
  onBackToSessions?: () => void;
  matches?: BadmintonMatch[];
  rankedPlayers?: (Player | RankedPlayer)[];
  onRecordMatch?: (matchData: {
    sessionId: string;
    matchFormat: MatchFormat;
    teamAPlayer1: Player;
    teamAPlayer2: Player | null;
    teamBPlayer1: Player;
    teamBPlayer2: Player | null;
    scoreTeamA: number;
    scoreTeamB: number;
    setScoresText: string;
  }) => Promise<void>;
  onDeleteMatch?: (matchId: string) => Promise<void>;
  onOpenProfileView?: (playerId?: string) => void;
  initialSessionSubTab?: 'roster' | 'matches';
  onConsumeInitialSessionSubTab?: () => void;
}

export const TapRsvpPortal: React.FC<TapRsvpPortalProps> = ({
  activeClub,
  sessions,
  selectedSessionId,
  onSelectSession,
  rsvps,
  players = [],
  activePlayer,
  isAdmin,
  canManageClub: canManageClubProp,
  initialOpenPayInfo = false,
  onConsumeInitialOpenPayInfo,
  onTapRsvp,
  onMarkAttendanceOutcome,
  onUpdateClubPaymentDetails,
  onFinalizeSessionShuttleAndSplit,
  onNotifyPaymentSentForRsvp,
  onAcceptOrClearSingleRsvp,
  onRejectPaymentForRsvp,
  onOpenMatchScorerForSession,
  onBackToSessions,
  matches = [],
  rankedPlayers: rankedPlayersProp,
  onRecordMatch,
  onDeleteMatch,
  onOpenProfileView,
  initialSessionSubTab,
  onConsumeInitialSessionSubTab,
}) => {
  const canManageClub =
    canManageClubProp !== undefined
      ? canManageClubProp
      : Boolean(
          isAdmin ||
            (activePlayer && activeClub.clubOwnerPlayerId === activePlayer.id)
        );

  const [sessionSubTab, setSessionSubTab] = useState<'roster' | 'matches'>(
    initialSessionSubTab || 'roster'
  );
  const [showCostEditor, setShowCostEditor] = useState(false);
  const [showLogMatchDrawer, setShowLogMatchDrawer] = useState(false);
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('doubles');
  const [teamA1Id, setTeamA1Id] = useState<string>('');
  const [teamA2Id, setTeamA2Id] = useState<string>('');
  const [teamB1Id, setTeamB1Id] = useState<string>('');
  const [teamB2Id, setTeamB2Id] = useState<string>('');
  const clubTargetPoints = activeClub.defaultMatchTargetPoints ?? 21;
  const [matchTargetPoints, setMatchTargetPoints] =
    useState<number>(clubTargetPoints);
  const [finalScoreA, setFinalScoreA] = useState<string>(
    String(clubTargetPoints)
  );
  const [finalScoreB, setFinalScoreB] = useState<string>(
    String(Math.max(0, clubTargetPoints - 4))
  );
  const [isSavingMatch, setIsSavingMatch] = useState(false);
  const [savedMatchNotice, setSavedMatchNotice] = useState<string | null>(null);
  const [matchScoreError, setMatchScoreError] = useState<string | null>(null);
  const [matchFilter, setMatchFilter] = useState<'all' | 'mine'>('all');
  const [pendingDeleteMatch, setPendingDeleteMatch] =
    useState<BadmintonMatch | null>(null);

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedChat, setCopiedChat] = useState(false);
  const [confirmTapOutOpen, setConfirmTapOutOpen] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showPaymentInfoModal, setShowPaymentInfoModal] = useState<boolean>(
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
  const [paymentConfigErrors, setPaymentConfigErrors] = useState<{
    recipient?: string;
    phone?: string;
    bankName?: string;
    bankAccount?: string;
  }>({});
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
      setShowPaymentInfoModal(true);
      onConsumeInitialOpenPayInfo?.();
    }
  }, [initialOpenPayInfo, onConsumeInitialOpenPayInfo]);

  useEffect(() => {
    const nextTarget = activeClub.defaultMatchTargetPoints ?? 21;
    setMatchTargetPoints(nextTarget);
    setFinalScoreA(String(nextTarget));
    setFinalScoreB(String(Math.max(0, nextTarget - 4)));
  }, [activeClub.id, activeClub.defaultMatchTargetPoints]);

  useEffect(() => {
    if (initialSessionSubTab) {
      setSessionSubTab(initialSessionSubTab);
      if (initialSessionSubTab === 'matches') {
        setShowLogMatchDrawer(true);
      }
      onConsumeInitialSessionSubTab?.();
    }
  }, [initialSessionSubTab, onConsumeInitialSessionSubTab]);

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

  const playerById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of players) {
      map.set(p.id, p);
    }
    return map;
  }, [players]);

  const rankedPlayers = useMemo<RankedPlayer[]>(() => {
    const source =
      rankedPlayersProp && rankedPlayersProp.length > 0
        ? rankedPlayersProp
        : players;
    const first = source[0] as RankedPlayer | undefined;
    if (
      first &&
      typeof first.tier === 'string' &&
      typeof first.rank === 'number'
    ) {
      return source as RankedPlayer[];
    }
    return computePlayerLeaderboardAndTiers(players, matches);
  }, [rankedPlayersProp, players, matches]);

  const session =
    sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null;

  const activeSessionIndex = session
    ? sessions.findIndex((s) => s.id === session.id)
    : -1;

  // Keep default player selections synced with the current session's going roster
  useEffect(() => {
    if (!session) return;
    const goingIds = new Set(
      rsvps
        .filter((r) => r.sessionId === session.id && r.status === 'going')
        .map((r) => r.playerId)
    );
    const pool = rankedPlayers.filter((p) => goingIds.has(p.id));
    const keepOr = (prev: string, fallback?: string) =>
      prev && goingIds.has(prev) ? prev : fallback || '';
    setTeamA1Id((prev) => keepOr(prev, pool[0]?.id));
    setTeamB1Id((prev) => keepOr(prev, pool[1]?.id));
    setTeamA2Id((prev) => keepOr(prev, pool[2]?.id));
    setTeamB2Id((prev) => keepOr(prev, pool[3]?.id));
  }, [session?.id, rankedPlayers, rsvps]);

  if (!session) {
    return (
      <div className="p-10 text-center bg-white rounded-2xl border border-slate-200/80 space-y-3">
        <p className="text-xs text-slate-500">
          No session scheduled for {activeClub.name}.
        </p>
        {onBackToSessions && (
          <button
            type="button"
            onClick={onBackToSessions}
            className="h-9 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Sessions</span>
          </button>
        )}
      </div>
    );
  }

  const getDraft = (s: Session) => {
    return (
      drafts[s.id] || {
        courtFee: s.courtFee,
        shuttlesUsed: s.shuttlesUsed > 0 ? s.shuttlesUsed : 6,
        shuttleUnitCost: s.shuttleUnitCost > 0 ? s.shuttleUnitCost : 3.0,
        courtNumbers: s.courtNumbers,
      }
    );
  };

  const updateDraft = (
    s: Session,
    patch: Partial<ReturnType<typeof getDraft>>
  ) => {
    const current = getDraft(s);
    setDrafts((prev) => ({
      ...prev,
      [s.id]: {
        ...current,
        ...prev[s.id],
        ...patch,
      },
    }));
  };

  const draft = getDraft(session);
  const sessionRsvps = rsvps.filter((r) => r.sessionId === session.id);
  const goingRsvps = sessionRsvps.filter((r) => r.status === 'going');
  const lateOutRsvps = sessionRsvps.filter((r) => r.status === 'late_out');
  const outRsvps = sessionRsvps.filter((r) => r.status === 'out');
  const chargeableRsvps = sessionRsvps.filter(
    (r) =>
      r.status === 'going' ||
      (r.status === 'late_out' && r.penaltyPercentApplied > 0)
  );

  // Roster rows to display:
  // Going players + Late Out players with penalty share
  const rosterParticipantRows = [
    ...goingRsvps,
    ...lateOutRsvps.filter((r) => r.penaltyPercentApplied > 0),
  ];

  const isCompleted =
    session.bookingStatus === 'completed' && session.feeSplitFinalized;
  const isPastOrCompleted = session.bookingStatus === 'completed';
  const isProposedUnbooked =
    !isPastOrCompleted && session.bookingStatus === 'pending';
  const policy = evaluateTapOutWindow(session, activeClub);

  const currentRsvp = activePlayer
    ? sessionRsvps.find((r) => r.playerId === activePlayer.id)
    : undefined;

  const computedShuttleFee = isCompleted
    ? session.shuttleFee
    : Number((draft.shuttlesUsed * draft.shuttleUnitCost).toFixed(2));
  const displayCourtFee = isCompleted ? session.courtFee : draft.courtFee;
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

  const goingHeadcount = getSessionGoingHeadcount(sessionRsvps);
  const totalGuestsCount = goingRsvps.reduce(
    (sum, r) => sum + getRsvpGuestCount(r),
    0
  );
  const myGuestCount = getRsvpGuestCount(currentRsvp);

  const myShareAmount = currentRsvp
    ? activeClub.excludeOwnerFromBilling &&
      currentRsvp.playerId === activeClub.clubOwnerPlayerId &&
      myGuestCount === 0
      ? 0
      : isCompleted
      ? currentRsvp.feeShare
      : previewSplits.get(currentRsvp.id)?.feeShare || 0
    : 0;

  const presentSample = sessionRsvps.find(
    (r) =>
      r.status === 'going' &&
      r.attendanceOutcome === 'present' &&
      (!activeClub.excludeOwnerFromBilling ||
        r.playerId !== activeClub.clubOwnerPlayerId)
  );
  const samplePresentShare = presentSample
    ? Number(
        (
          (previewSplits.get(presentSample.id)?.feeShare || 0) /
          Math.max(1, getRsvpPartySize(presentSample))
        ).toFixed(2)
      )
    : 0;

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

  const dateLabel = getSessionDateDisplay(session.sessionDate).fullLabel;
  const shareUrl = buildShareableClubAndSessionUrl(activeClub.id, session);
  const groupChatText = buildGroupChatSnippet(
    activeClub,
    session,
    sessionRsvps
  );

  const spotsOpen = Math.max(0, session.maxPlayers - goingHeadcount);
  // A booked session is capped at maxPlayers; a proposed one can still add courts
  const isRosterCapped = session.bookingStatus !== 'pending' && !canManageClub;
  const isRosterFull = isRosterCapped && spotsOpen <= 0;
  const fillPct = Math.min(
    100,
    Math.round((goingHeadcount / Math.max(1, session.maxPlayers)) * 100)
  );

  const targetRsvpForPayment = payingTargetRsvpId
    ? rsvps.find((r) => r.id === payingTargetRsvpId) || null
    : currentRsvp &&
      currentRsvp.paidStatus === 'unpaid' &&
      currentRsvp.feeShare > 0
    ? currentRsvp
    : null;

  const handleChangeSession = (nextId: string) => {
    onSelectSession(nextId);
    setPayingTargetRsvpId(null);
    setPaymentSubmittedBanner(null);
  };

  const handleOpenPaymentModalForRsvp = (rsvpId: string) => {
    setPayingTargetRsvpId(rsvpId);
    setShowPaymentInfoModal(true);
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
    const nextErrors: typeof paymentConfigErrors = {};
    if (!editRecipient.trim()) {
      nextErrors.recipient = 'Please enter the recipient / account holder name.';
    }
    if (!editPhone.trim()) {
      nextErrors.phone = 'Please enter a PayNow or mobile transfer number.';
    }
    if (!editBankName.trim()) {
      nextErrors.bankName = 'Please enter a bank name.';
    }
    if (!editBankAccount.trim()) {
      nextErrors.bankAccount = 'Please enter a bank account number.';
    }
    if (Object.keys(nextErrors).length > 0) {
      setPaymentConfigErrors(nextErrors);
      return;
    }
    setPaymentConfigErrors({});
    await onUpdateClubPaymentDetails(activeClub.id, {
      recipientName: editRecipient.trim(),
      phoneNumber: editPhone.trim(),
      bankName: editBankName.trim(),
      bankAccountNumber: editBankAccount.trim(),
      paymentNotes:
        editPaymentNotes.trim() ||
        'Include your name & session date in transfer reference',
    });
    setEditingPaymentConfig(false);
    setSavedPaymentConfigNotice(true);
    setTimeout(() => setSavedPaymentConfigNotice(false), 2000);
  };

  const handleConfirmUserPaymentSent = async () => {
    if (!targetRsvpForPayment || !onNotifyPaymentSentForRsvp) return;
    await onNotifyPaymentSentForRsvp(targetRsvpForPayment.id, 'Submitted');
    setPaymentSubmittedBanner(
      `Submitted $${targetRsvpForPayment.feeShare.toFixed(2)} for this session. Waiting for Admin / Club Owner confirmation.`
    );
  };

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

  // Session-scoped matches and player pools
  const sessionMatches = matches.filter((m) => m.sessionId === session.id);

  const filteredSessionMatches = sessionMatches.filter((m) => {
    if (matchFilter === 'all' || !activePlayer) return true;
    return isPlayerInMatch(m, activePlayer.id);
  });

  const goingPlayerIdSet = new Set(goingRsvps.map((r) => r.playerId));
  const rankedById = new Map<string, RankedPlayer>(
    rankedPlayers.map((p) => [p.id, p])
  );
  const sessionGoingPlayers: RankedPlayer[] = [
    ...rankedPlayers.filter((p) => goingPlayerIdSet.has(p.id)),
    ...goingRsvps
      .filter((r) => !rankedById.has(r.playerId))
      .map(
        (r, idx): RankedPlayer => ({
          id: r.playerId,
          name: r.playerName,
          playerTag: `#${r.playerId.slice(-4).toUpperCase()}`,
          joinedClubIdsCsv: session.clubId,
          wins: 0,
          losses: 0,
          gamesPlayed: 0,
          pointsScored: 0,
          pointsConceded: 0,
          singlesWins: 0,
          singlesLosses: 0,
          doublesWins: 0,
          doublesLosses: 0,
          ratingScore: 1200,
          ownerId: r.ownerId,
          winRate: 0,
          pointDiff: 0,
          avgPointDiff: 0,
          pointsShare: 0,
          tier: 'C',
          tierTitle: 'Rising Shuttle',
          rank: rankedPlayers.length + idx + 1,
          recentForm: [],
        })
      ),
  ];
  // Only players who joined (RSVP'd going to) this session can be logged in its matches.
  const allMatchPlayerOptions = sessionGoingPlayers;
  const requiredMatchPlayers = matchFormat === 'doubles' ? 4 : 2;
  const hasEnoughMatchPlayers =
    allMatchPlayerOptions.length >= requiredMatchPlayers;

  const teamA1 =
    allMatchPlayerOptions.find((p) => p.id === teamA1Id) ||
    allMatchPlayerOptions[0];
  const teamA2 =
    matchFormat === 'doubles'
      ? allMatchPlayerOptions.find((p) => p.id === teamA2Id) ||
        allMatchPlayerOptions[2] ||
        allMatchPlayerOptions[0]
      : null;
  const teamB1 =
    allMatchPlayerOptions.find((p) => p.id === teamB1Id) ||
    allMatchPlayerOptions[1] ||
    allMatchPlayerOptions[0];
  const teamB2 =
    matchFormat === 'doubles'
      ? allMatchPlayerOptions.find((p) => p.id === teamB2Id) ||
        allMatchPlayerOptions[3] ||
        allMatchPlayerOptions[1]
      : null;

  const selectedMatchPlayerIds = [teamA1, teamA2, teamB1, teamB2]
    .filter((p): p is RankedPlayer => Boolean(p))
    .map((p) => p.id);
  const hasDuplicateMatchPlayers =
    new Set(selectedMatchPlayerIds).size !== selectedMatchPlayerIds.length;

  const numScoreA = parseInt(finalScoreA, 10) || 0;
  const numScoreB = parseInt(finalScoreB, 10) || 0;

  const handleSwapMatchSides = () => {
    const prevA1 = teamA1?.id || teamA1Id;
    const prevA2 = teamA2?.id || teamA2Id;
    const prevB1 = teamB1?.id || teamB1Id;
    const prevB2 = teamB2?.id || teamB2Id;
    setTeamA1Id(prevB1);
    setTeamA2Id(prevB2);
    setTeamB1Id(prevA1);
    setTeamB2Id(prevA2);
    const prevScoreA = finalScoreA;
    setFinalScoreA(finalScoreB);
    setFinalScoreB(prevScoreA);
  };

  const adjustMatchScore = (side: 'A' | 'B', delta: number) => {
    if (side === 'A') {
      const cur = parseInt(finalScoreA, 10);
      const base = Number.isNaN(cur) ? 0 : cur;
      setFinalScoreA(String(Math.max(0, Math.min(500, base + delta))));
    } else {
      const cur = parseInt(finalScoreB, 10);
      const base = Number.isNaN(cur) ? 0 : cur;
      setFinalScoreB(String(Math.max(0, Math.min(500, base + delta))));
    }
  };

  const handleApplyTargetPreset = (pts: number) => {
    setMatchTargetPoints(pts);
    const curA = parseInt(finalScoreA, 10) || 0;
    const curB = parseInt(finalScoreB, 10) || 0;
    if (curB > curA) {
      setFinalScoreB(String(pts));
      setFinalScoreA(String(Math.min(Math.max(0, pts - 4), curA)));
    } else {
      setFinalScoreA(String(pts));
      setFinalScoreB(String(Math.min(Math.max(0, pts - 4), curB)));
    }
    if (matchScoreError) setMatchScoreError(null);
  };

  const handleSubmitSessionMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageClub || !onRecordMatch || !teamA1 || !teamB1) return;
    if (!hasEnoughMatchPlayers || hasDuplicateMatchPlayers) return;

    const rawA = Number(finalScoreA);
    const rawB = Number(finalScoreB);
    if (
      finalScoreA.trim() === '' ||
      finalScoreB.trim() === '' ||
      Number.isNaN(rawA) ||
      Number.isNaN(rawB) ||
      rawA < 0 ||
      rawA > 500 ||
      rawB < 0 ||
      rawB > 500
    ) {
      setMatchScoreError('Scores must be valid numbers between 0 and 500.');
      return;
    }
    const parsedA = Math.round(rawA);
    const parsedB = Math.round(rawB);
    if (parsedA === parsedB) {
      setMatchScoreError('A match needs a winner: scores cannot be tied.');
      return;
    }
    setMatchScoreError(null);

    setIsSavingMatch(true);
    try {
      await onRecordMatch({
        sessionId: session.id,
        matchFormat,
        teamAPlayer1: teamA1,
        teamAPlayer2: matchFormat === 'doubles' ? teamA2 : null,
        teamBPlayer1: teamB1,
        teamBPlayer2: matchFormat === 'doubles' ? teamB2 : null,
        scoreTeamA: parsedA,
        scoreTeamB: parsedB,
        setScoresText: `${parsedA}-${parsedB}`,
      });
      setSavedMatchNotice(`Logged ${parsedA}–${parsedB} · Standings updated`);
      setTimeout(() => setSavedMatchNotice(null), 2500);
    } finally {
      setIsSavingMatch(false);
    }
  };

  const renderPlayerOptions = () => (
    <>
      {allMatchPlayerOptions.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.ratingScore})
        </option>
      ))}
    </>
  );

  return (
    <div className="space-y-6">
      {/* Top Session Dedicated Header — Structured 2-Tier Responsive Layout for All Screen Widths */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 space-y-3.5 shadow-2xs">
        {/* Tier 1: Back Navigation, Status Context & Session Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            {onBackToSessions && (
              <button
                type="button"
                onClick={onBackToSessions}
                className="h-9 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer shadow-2xs transition-colors"
                aria-label="Back to sessions"
              >
                <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                <span>All Sessions</span>
              </button>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center gap-1.5 font-bold ${
                  isCompleted
                    ? 'text-emerald-700'
                    : isPastOrCompleted
                    ? 'text-slate-700'
                    : isProposedUnbooked
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isCompleted
                      ? 'bg-emerald-600'
                      : isPastOrCompleted
                      ? 'bg-slate-500'
                      : isProposedUnbooked
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                />
                <span>
                  {isCompleted
                    ? 'Settled Session'
                    : isPastOrCompleted
                    ? 'Completed Session (Pending Split)'
                    : isProposedUnbooked
                    ? 'Proposed (Court Not Booked)'
                    : 'Upcoming Session'}
                </span>
              </span>

              {sessions.length > 1 && activeSessionIndex >= 0 && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-slate-500 font-medium">
                    Session {activeSessionIndex + 1} of {sessions.length}
                  </span>
                </>
              )}
            </div>
          </div>

          {sessions.length > 1 && (
            <div className="flex items-center gap-1.5 w-full sm:w-auto shrink-0">
              <button
                type="button"
                disabled={activeSessionIndex <= 0}
                onClick={() => {
                  if (activeSessionIndex > 0) {
                    handleChangeSession(sessions[activeSessionIndex - 1].id);
                  }
                }}
                className="h-9 w-9 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 disabled:opacity-40 cursor-pointer shrink-0 shadow-2xs"
                aria-label="Previous session"
                title="Previous session"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex-1 sm:w-60 md:w-64 min-w-0">
                <StyledSelect
                  aria-label="Switch session"
                  value={session.id}
                  onChange={(e) => handleChangeSession(e.target.value)}
                  className="h-9 text-xs"
                >
                  {sessions.map((s) => {
                    const d = getSessionDateDisplay(s.sessionDate);
                    const settled =
                      s.bookingStatus === 'completed' && s.feeSplitFinalized;
                    return (
                      <option key={s.id} value={s.id}>
                        {d.compactLabel} · {s.title} (
                        {settled ? 'Settled' : 'Open'})
                      </option>
                    );
                  })}
                </StyledSelect>
              </div>
              <button
                type="button"
                disabled={
                  activeSessionIndex < 0 ||
                  activeSessionIndex >= sessions.length - 1
                }
                onClick={() => {
                  if (
                    activeSessionIndex >= 0 &&
                    activeSessionIndex < sessions.length - 1
                  ) {
                    handleChangeSession(sessions[activeSessionIndex + 1].id);
                  }
                }}
                className="h-9 w-9 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 disabled:opacity-40 cursor-pointer shrink-0 shadow-2xs"
                aria-label="Next session"
                title="Next session"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Tier 2: Session Title, Date/Time/Venue Metadata & Primary Action Toolbar */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3.5">
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight break-words font-display leading-snug">
              {session.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">{dateLabel}</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="font-mono tabular-nums font-semibold text-slate-800">
                {session.startTime}–{session.endTime}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>
                {session.venue}
                {session.courtNumbers ? ` (${session.courtNumbers})` : ''}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>Organized by {session.organizerName}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowInviteModal(true)}
              className="flex-1 sm:flex-initial h-9 px-3.5 text-xs font-semibold rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
            >
              <Share2 className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>Share Invite</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (onRecordMatch) {
                  setSessionSubTab('matches');
                  setShowLogMatchDrawer(true);
                } else if (onOpenMatchScorerForSession) {
                  onOpenMatchScorerForSession(session.id);
                }
              }}
              className={`flex-1 sm:flex-initial h-9 px-3.5 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs ${
                sessionSubTab === 'matches'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-800'
              }`}
            >
              <Swords className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>
                {canManageClub && onRecordMatch
                  ? `Log Match (${sessionMatches.length})`
                  : `Matches (${sessionMatches.length})`}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowPaymentInfoModal(true)}
              className="flex-1 sm:flex-initial h-9 px-4 text-xs font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <CreditCard className="w-3.5 h-3.5 shrink-0" />
              <span>Payment Info</span>
            </button>
          </div>
        </div>
      </div>

      {/* Prominent Instant RSVP & +1 Guest Action Card (Join / +1 Guest / Out inside the dedicated session view for upcoming sessions only) */}
      {!isPastOrCompleted && activePlayer && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className={`rounded-2xl border px-4 py-3.5 sm:px-5 sm:py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
            currentRsvp?.status === 'going'
              ? 'bg-emerald-50/40 border-emerald-300/90'
              : currentRsvp?.status === 'out' ||
                currentRsvp?.status === 'late_out'
              ? 'bg-slate-100/70 border-slate-200'
              : 'bg-white border-slate-300 shadow-2xs'
          }`}
        >
          <div className="space-y-1">
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
                  ? myGuestCount > 0
                    ? `You Are Going (+${myGuestCount} Guest · ${1 + myGuestCount} Spots)`
                    : 'You Are Going'
                  : currentRsvp?.status === 'out' ||
                    currentRsvp?.status === 'late_out'
                  ? 'Marked Not Going / Tapped Out'
                  : 'RSVP Open — Tap Join to Reserve Your Court Spot'}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="font-mono tabular-nums font-semibold text-slate-700">
                {goingHeadcount}/{session.maxPlayers} going
                {totalGuestsCount > 0
                  ? ` (incl. ${totalGuestsCount} ${
                      totalGuestsCount === 1 ? 'guest' : 'guests'
                    })`
                  : ''}{' '}
                ({spotsOpen} {spotsOpen === 1 ? 'spot' : 'spots'} left)
              </span>
              <span aria-hidden="true" className="text-slate-300 hidden sm:inline">
                ·
              </span>
              <span className="text-slate-600">{policy.policySummary}</span>
            </div>

            {currentRsvp?.status === 'going' && myGuestCount > 0 && (
              <p className="text-xs text-emerald-800 font-medium">
                Bringing +{myGuestCount}{' '}
                {myGuestCount === 1 ? 'guest' : 'guests'} (no account required) —
                guest court &amp; shuttle share is billed to your account.
              </p>
            )}

            {(() => {
              const myClubWallet = getPlayerClubWallet(
                activePlayer,
                session.clubId || activeClub.id
              );
              if (
                !myClubWallet.waiveAllFees &&
                myClubWallet.freeSessionPasses <= 0 &&
                myClubWallet.creditBalance <= 0
              ) {
                return null;
              }
              return (
                <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
                  {myClubWallet.waiveAllFees ? (
                    <span className="inline-flex items-center gap-1 text-purple-800 font-semibold">
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      Your {activeClub.name} Fee is Waived (VIP Exemption)
                    </span>
                  ) : myClubWallet.freeSessionPasses > 0 ? (
                    <span className="inline-flex items-center gap-1 text-emerald-800 font-semibold">
                      <Ticket className="w-3.5 h-3.5 text-emerald-600" />
                      {myClubWallet.freeSessionPasses} Free Session{' '}
                      {myClubWallet.freeSessionPasses === 1 ? 'Pass' : 'Passes'}{' '}
                      Available in {activeClub.name} (Auto-Applied)
                    </span>
                  ) : null}
                  {myClubWallet.creditBalance > 0 && (
                    <span className="text-sky-800 font-semibold font-mono tabular-nums">
                      · ${myClubWallet.creditBalance.toFixed(2)}{' '}
                      {activeClub.name} Credit Available
                    </span>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 w-full lg:w-auto">
            {currentRsvp?.status !== 'going' ? (
              <>
                <button
                  type="button"
                  disabled={isRosterFull}
                  onClick={() =>
                    onTapRsvp(session.id, activePlayer, 'going', 100, 0)
                  }
                  className="h-9 px-4 rounded-xl font-semibold text-xs transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs flex-1 sm:flex-initial"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{isRosterFull ? 'Session Full' : 'Join Session'}</span>
                </button>
                <button
                  type="button"
                  disabled={isRosterCapped && spotsOpen < 2}
                  onClick={() =>
                    onTapRsvp(session.id, activePlayer, 'going', 100, 1)
                  }
                  className="h-9 px-3.5 rounded-xl font-semibold text-xs transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-white text-emerald-800 border border-emerald-300 hover:bg-emerald-50 shadow-2xs flex-1 sm:flex-initial"
                  title="Join and bring +1 guest (no account needed; guest share billed to you)"
                >
                  <UserPlus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Join +1 Guest</span>
                </button>
              </>
            ) : (
              <>
                {/* +1 Guest Toggle / Stepper Control (Billed to Host Player) */}
                {myGuestCount === 0 ? (
                  <button
                    type="button"
                    disabled={isRosterFull}
                    onClick={() =>
                      onTapRsvp(session.id, activePlayer, 'going', 100, 1)
                    }
                    className="h-9 px-3.5 rounded-xl font-semibold text-xs transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-white text-emerald-800 border border-emerald-300 hover:bg-emerald-50 shadow-2xs flex-1 sm:flex-initial"
                    title="Bring a +1 guest without an account (guest fee billed to you)"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Bring +1 Guest</span>
                  </button>
                ) : (
                  <div className="h-9 px-2.5 rounded-xl bg-white border border-emerald-300 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900 shadow-2xs">
                    <UserPlus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>
                      +{myGuestCount} {myGuestCount === 1 ? 'Guest' : 'Guests'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onTapRsvp(
                          session.id,
                          activePlayer,
                          'going',
                          100,
                          Math.max(0, myGuestCount - 1)
                        )
                      }
                      className="h-6 w-6 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
                      aria-label="Remove 1 guest"
                      title="Remove 1 guest"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={spotsOpen <= 0 || myGuestCount >= 4}
                      onClick={() =>
                        onTapRsvp(
                          session.id,
                          activePlayer,
                          'going',
                          100,
                          Math.min(4, myGuestCount + 1)
                        )
                      }
                      className="h-6 w-6 rounded-lg bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 flex items-center justify-center text-emerald-800 cursor-pointer"
                      aria-label="Add another guest"
                      title="Add another guest"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  disabled={!policy.canTapOut}
                  title={policy.canTapOut ? undefined : policy.policySummary}
                  onClick={() => setConfirmTapOutOpen(true)}
                  className={`h-9 px-3.5 rounded-xl font-semibold text-xs transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-1 sm:flex-initial ${
                    policy.isPenaltyWindow
                      ? 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                      : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-2xs'
                  }`}
                >
                  {policy.isPenaltyWindow && (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  )}
                  <span>
                    {!policy.canTapOut
                      ? 'Cancellation Locked'
                      : policy.isPenaltyWindow
                      ? `Leave (${policy.penaltyPercent}% Late Fee)`
                      : 'Leave Session (Out)'}
                  </span>
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}

      {/* Unified Session Card: Clean Tabbed Organization (Roster & Fee Split | Session Matches) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-6 space-y-4 shadow-2xs">
        {/* Session Workspace Header: Sub-Tab Switcher + Compact KPI Summary */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 pb-3.5 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              size="sm"
              options={[
                {
                  value: 'roster',
                  label: `Roster & Split (${goingHeadcount}/${session.maxPlayers})`,
                },
                {
                  value: 'matches',
                  label: `Session Matches (${sessionMatches.length})`,
                },
              ]}
              value={sessionSubTab}
              onChange={(val) => setSessionSubTab(val)}
            />
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    spotsOpen === 0 ? 'bg-amber-600' : 'bg-emerald-600'
                  }`}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
              <span className="text-[11px] font-medium text-slate-500">
                {spotsOpen === 0 ? 'Full' : `${spotsOpen} open`}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 sm:gap-6 font-mono tabular-nums text-xs">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-sans font-medium text-slate-500">
                Pool:
              </span>
              <span className="text-sm font-bold text-slate-900">
                ${totalSessionFee.toFixed(2)}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-sans font-medium text-slate-500">
                {canManageClub ? 'Est./Player:' : 'Your Share:'}
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
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[11px] font-sans font-medium text-slate-500">
                    Collected ({sessionPaidCount}/{chargeableRsvps.length}):
                  </span>
                  <span className="text-sm font-bold text-emerald-700">
                    ${sessionCollectedTotal.toFixed(2)}
                  </span>
                </div>
                {sessionUnpaidTotal > 0 && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11px] font-sans font-medium text-slate-500">
                      Due:
                    </span>
                    <span className="text-sm font-bold text-amber-700">
                      ${sessionUnpaidTotal.toFixed(2)}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {sessionSubTab === 'roster' ? (
          <div className="space-y-4">
            {/* Compact, Lightweight Court & Shuttlecock Split Bar (Expandable on demand) */}
            {canManageClub && onFinalizeSessionShuttleAndSplit && (
              <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-3.5 py-2.5 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                  {/* Left: Scannable 1-line cost formula + quick inline shuttle stepper */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-slate-700">
                    <span className="font-semibold text-slate-900">
                      Split:
                    </span>
                    <span className="font-mono tabular-nums">
                      Court{' '}
                      <strong className="text-slate-900">
                        ${displayCourtFee.toFixed(2)}
                      </strong>
                      {draft.courtNumbers ? ` (${draft.courtNumbers})` : ''}
                    </span>
                    <span className="text-slate-300">+</span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <span>Shuttles</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft(session, {
                            shuttlesUsed: Math.max(0, draft.shuttlesUsed - 1),
                          })
                        }
                        className="h-5 w-5 rounded bg-white border border-slate-300 hover:bg-slate-100 flex items-center justify-center text-slate-700 cursor-pointer"
                        title="Decrease shuttles by 1"
                      >
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                      <strong className="text-slate-900 px-0.5">
                        {draft.shuttlesUsed}
                      </strong>
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft(session, {
                            shuttlesUsed: draft.shuttlesUsed + 1,
                          })
                        }
                        className="h-5 w-5 rounded bg-white border border-slate-300 hover:bg-slate-100 flex items-center justify-center text-slate-700 cursor-pointer"
                        title="Increase shuttles by 1"
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                      <span className="text-slate-500">
                        × ${draft.shuttleUnitCost.toFixed(2)} ={' '}
                        <strong className="text-slate-900">
                          ${computedShuttleFee.toFixed(2)}
                        </strong>
                      </span>
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      Total ${totalSessionFee.toFixed(2)} (
                      {chargeableRsvps.length} billed)
                    </span>
                  </div>

                  {/* Right: Compact Edit Costs Toggle + Finalize Split Button */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowCostEditor((prev) => !prev)}
                      className={`h-8 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                        showCostEditor
                          ? 'bg-slate-200/80 border-slate-300 text-slate-900'
                          : 'bg-white border-slate-300 hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600" />
                      <span>{showCostEditor ? 'Hide Inputs' : 'Edit Costs'}</span>
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${
                          showCostEditor ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmFinalizeOpen(true)}
                      className="h-8 px-3.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
                    >
                      {isCompleted
                        ? `Recalculate ($${totalSessionFee.toFixed(2)})`
                        : `Finalize Split ($${totalSessionFee.toFixed(2)})`}
                    </button>
                  </div>
                </div>

                {/* Expandable Compact 4-Column Inputs Row */}
                <AnimatePresence initial={false}>
                  {showCostEditor && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="pt-2.5 border-t border-slate-200/70 grid grid-cols-2 sm:grid-cols-4 gap-2.5 items-end">
                        <StyledInput
                          label="Court Fee"
                          prefixText="$"
                          type="number"
                          min={0}
                          step={1}
                          value={draft.courtFee}
                          onChange={(e) =>
                            updateDraft(session, {
                              courtFee: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="font-mono tabular-nums h-8 text-xs"
                        />

                        <StyledInput
                          label="Courts"
                          type="text"
                          maxLength={60}
                          placeholder="e.g. Court 3 & 4"
                          value={draft.courtNumbers}
                          onChange={(e) =>
                            updateDraft(session, {
                              courtNumbers: e.target.value,
                            })
                          }
                          className="h-8 text-xs"
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
                            updateDraft(session, {
                              shuttlesUsed: parseInt(e.target.value, 10) || 0,
                            })
                          }
                          className="font-mono tabular-nums font-bold h-8 text-xs"
                        />

                        <StyledInput
                          label="Shuttle Price"
                          prefixText="$"
                          type="number"
                          min={0}
                          step={0.5}
                          value={draft.shuttleUnitCost}
                          onChange={(e) =>
                            updateDraft(session, {
                              shuttleUnitCost: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="font-mono tabular-nums h-8 text-xs"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Ultra-Compact Single-Line Court Suggestion (when proposed/pending) */}
                {session.bookingStatus === 'pending' &&
                  (() => {
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

            {/* Unified Roster & Fee Split Table */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <h3 className="font-bold text-slate-900">
                  Participant Roster &amp; Fee Shares ({rosterParticipantRows.length})
                </h3>
                {canManageClub && !isCompleted && (
                  <span className="text-slate-500">
                    Mark any no-shows before finalizing split
                  </span>
                )}
              </div>

              {rosterParticipantRows.length === 0 ? (
                <div className="p-8 text-center rounded-xl border border-slate-200/70 bg-slate-50/50 text-xs text-slate-600">
                  No confirmed players yet. Use the Join Session button above to
                  reserve the first spot.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden bg-white">
                  {/* Desktop Column Alignment Header */}
                  <div className="hidden sm:flex items-center justify-between gap-3 px-4 py-2 bg-slate-50/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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

              {rosterParticipantRows.map((rsvp, idx) => {
                const isSelf = rsvp.playerId === activePlayer?.id;
                const guestCount = getRsvpGuestCount(rsvp);
                const partySize = getRsvpPartySize(rsvp);
                const isClubOwnerRow =
                  Boolean(activeClub.clubOwnerPlayerId) &&
                  rsvp.playerId === activeClub.clubOwnerPlayerId;
                const isOwnerExcluded =
                  isClubOwnerRow &&
                  Boolean(activeClub.excludeOwnerFromBilling) &&
                  guestCount === 0;
                const rsvpPlayer = playerById.get(rsvp.playerId);
                const rsvpClubWallet = getPlayerClubWallet(
                  rsvpPlayer,
                  session.clubId || activeClub.id
                );
                const displayShare = isOwnerExcluded
                  ? 0
                  : isCompleted
                  ? rsvp.feeShare
                  : previewSplits.get(rsvp.id)?.feeShare || 0;
                const effectivePaidStatus = isOwnerExcluded
                  ? 'paid'
                  : rsvp.paidStatus;
                const isRejected =
                  effectivePaidStatus === 'unpaid' &&
                  rsvp.paidMethod === 'Rejected';

                // Normal users see their own payment status and share, or preview shares;
                // Admins / Club Owners see everyone's payment status and controls.
                const canInspectFinancials = canManageClub || isSelf;

                const paidSubtitle = isOwnerExcluded
                  ? 'Owner Excluded'
                  : isClubOwnerRow && guestCount === 0
                  ? 'Club Owner'
                  : rsvp.paidMethod &&
                    (rsvp.paidMethod.startsWith('Fee Waived') ||
                      rsvp.paidMethod.startsWith('Free Session') ||
                      rsvp.paidMethod.startsWith('Credit'))
                  ? rsvp.paidMethod
                  : guestCount > 0
                  ? `Includes +${guestCount} Guest`
                  : null;

                return (
                  <div
                    key={rsvp.id}
                    className="px-4 py-3.5 bg-white hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    {/* Left: Player Name & Attendance / Perks */}
                    <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="font-mono tabular-nums text-slate-400 font-medium w-5 shrink-0">
                          {idx + 1}.
                        </span>
                        <span className="font-semibold text-slate-900 break-words">
                          {rsvp.playerName}
                        </span>
                        {isSelf && (
                          <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                            · You
                          </span>
                        )}
                        {guestCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200/90 text-[11px] font-semibold text-emerald-800 shrink-0">
                            <UserPlus className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>
                              +{guestCount} {guestCount === 1 ? 'Guest' : 'Guests'} ({partySize} spots)
                            </span>
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
                            · Going
                          </span>
                        )}
                        {canInspectFinancials && rsvpClubWallet.waiveAllFees && (
                          <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                            · VIP Fee Waived
                          </span>
                        )}
                        {canInspectFinancials &&
                          !rsvpClubWallet.waiveAllFees &&
                          rsvpClubWallet.freeSessionPasses > 0 && (
                            <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                              · {rsvpClubWallet.freeSessionPasses} Free Pass
                              {rsvpClubWallet.freeSessionPasses === 1 ? '' : 'es'}
                            </span>
                          )}
                        {canInspectFinancials &&
                          !rsvpClubWallet.waiveAllFees &&
                          rsvpClubWallet.creditBalance > 0 && (
                            <span className="text-[11px] font-mono font-semibold text-sky-700 shrink-0">
                              · ${rsvpClubWallet.creditBalance.toFixed(2)}{' '}
                              Credit
                            </span>
                          )}
                      </div>

                      {/* Mobile Share Amount */}
                      <span className="sm:hidden font-mono tabular-nums text-slate-900 font-bold text-sm shrink-0">
                        ${displayShare.toFixed(2)}
                      </span>
                    </div>

                    {/* Right: Actions + Payment Status + Share */}
                    <div className="flex flex-wrap sm:flex-nowrap items-center justify-between sm:justify-end gap-3 shrink-0">
                      {/* COLUMN 1: Interactive Action Controls */}
                      <div className="flex items-center justify-end gap-1.5 order-2 sm:order-1 shrink-0">
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
                          onAcceptOrClearSingleRsvp &&
                          !isClubOwnerRow &&
                          effectivePaidStatus !== 'paid' && (
                            <>
                              {effectivePaidStatus === 'pending_approval' ? (
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
                                    onClick={() => setPendingRejectRsvp(rsvp)}
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
                                    onClick={() => setPendingWaiveRsvp(rsvp)}
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
                                handleOpenPaymentModalForRsvp(rsvp.id)
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
                            <span className="text-slate-700 font-semibold whitespace-nowrap">
                              {guestCount > 0 ? `${partySize}× Split` : 'Est. Split'}
                            </span>
                            <span className="text-[11px] text-slate-500 truncate max-w-full">
                              {isOwnerExcluded
                                ? 'Owner Excluded'
                                : guestCount > 0
                                ? `Player + ${guestCount} Guest`
                                : 'Preview share'}
                            </span>
                          </>
                        ) : !canInspectFinancials ? (
                          <span className="text-slate-500 font-medium whitespace-nowrap">
                            Settled
                          </span>
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
                        ) : effectivePaidStatus === 'pending_approval' ? (
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
                            <span className="text-amber-700 font-semibold whitespace-nowrap">
                              Unpaid
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

          {outRsvps.length > 0 && (
            <p className="text-xs text-slate-600 pt-1">
              Tapped out (no charge):{' '}
              {outRsvps.map((r) => r.playerName).join(', ')}
            </p>
          )}

          {/* Compact Footer Link to Session Matches */}
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <Swords className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {sessionMatches.length === 0
                  ? 'No matches logged for this session yet.'
                  : `${sessionMatches.length} ${
                      sessionMatches.length === 1 ? 'match' : 'matches'
                    } recorded in this session.`}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setSessionSubTab('matches');
                if (sessionMatches.length === 0 && canManageClub) {
                  setShowLogMatchDrawer(true);
                }
              }}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>
                {canManageClub
                  ? 'Log or View Session Matches →'
                  : 'View Session Matches →'}
              </span>
            </button>
          </div>
        </div>
          </div>
        ) : (
          /* SESSION MATCHES & COMPACT SCORE LOGGER VIEW */
          <div className="space-y-4">
            {/* Matches Sub-Toolbar: Filter + Log Match Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  size="sm"
                  options={[
                    {
                      value: 'all',
                      label: 'All Matches',
                      count: sessionMatches.length,
                    },
                    { value: 'mine', label: 'My Matches' },
                  ]}
                  value={matchFilter}
                  onChange={setMatchFilter}
                />
                {savedMatchNotice && (
                  <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{savedMatchNotice}</span>
                  </span>
                )}
              </div>

              {canManageClub && onRecordMatch && (
                <button
                  type="button"
                  onClick={() => setShowLogMatchDrawer((prev) => !prev)}
                  className={`h-8 px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                    showLogMatchDrawer
                      ? 'bg-slate-200 text-slate-900'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs'
                  }`}
                >
                  <Plus
                    className={`w-3.5 h-3.5 transition-transform ${
                      showLogMatchDrawer ? 'rotate-45' : ''
                    }`}
                  />
                  <span>
                    {showLogMatchDrawer ? 'Close Logger' : 'Log Match Score'}
                  </span>
                </button>
              )}
            </div>

            {/* Clean, Compact Horizontal Scoreboard Match Logger (Pre-bound to this session) */}
            <AnimatePresence initial={false}>
              {canManageClub &&
                onRecordMatch &&
                (showLogMatchDrawer || sessionMatches.length === 0) && (
                  <motion.form
                    noValidate
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.16 }}
                    onSubmit={handleSubmitSessionMatch}
                    className="rounded-xl bg-slate-50 border border-slate-200/90 p-3.5 sm:p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <Swords className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="font-bold text-slate-900">
                          Log Match · {session.title}
                        </span>
                        <span className="text-slate-500 hidden sm:inline">
                          ({sessionGoingPlayers.length} joined{' '}
                          {sessionGoingPlayers.length === 1 ? 'player' : 'players'})
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSwapMatchSides}
                          className="h-7 px-2.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                          title="Swap Side A and Side B"
                        >
                          <ArrowLeftRight className="w-3 h-3 text-slate-500" />
                          <span>Swap</span>
                        </button>
                        <SegmentedControl
                          size="sm"
                          options={[
                            { value: 'doubles', label: 'Doubles' },
                            { value: 'singles', label: 'Singles' },
                          ]}
                          value={matchFormat}
                          onChange={setMatchFormat}
                        />
                      </div>
                    </div>

                    {/* Compact Scoreboard Grid: Side A | Score A vs Score B | Side B */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
                      {/* Side A Players */}
                      <div className="lg:col-span-4 space-y-1.5">
                        <span className="text-[11px] font-semibold text-slate-600 block">
                          Side A {numScoreA > numScoreB ? '· Winner' : ''}
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-1.5">
                          <StyledSelect
                            aria-label="Side A Player 1"
                            value={teamA1?.id || ''}
                            onChange={(e) => setTeamA1Id(e.target.value)}
                            className="h-8 text-xs"
                          >
                            {renderPlayerOptions()}
                          </StyledSelect>
                          {matchFormat === 'doubles' && (
                            <StyledSelect
                              aria-label="Side A Player 2"
                              value={teamA2?.id || ''}
                              onChange={(e) => setTeamA2Id(e.target.value)}
                              className="h-8 text-xs"
                            >
                              {renderPlayerOptions()}
                            </StyledSelect>
                          )}
                        </div>
                      </div>

                      {/* Center Score Steppers & Target Point Presets */}
                      <div className="lg:col-span-4 flex flex-col items-center justify-center gap-2 bg-white rounded-xl border border-slate-200/90 px-3 py-2.5 shadow-2xs">
                        <div className="flex items-center justify-center gap-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                adjustMatchScore('A', -1);
                                if (matchScoreError) setMatchScoreError(null);
                              }}
                              className="h-7 w-7 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
                              aria-label="Decrease Side A score"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={500}
                              aria-label="Side A score"
                              value={finalScoreA}
                              onChange={(e) => {
                                setFinalScoreA(e.target.value);
                                if (matchScoreError) setMatchScoreError(null);
                              }}
                              className={`w-12 h-8 text-center font-mono tabular-nums font-bold text-sm rounded-lg border bg-white text-slate-900 focus:outline-none focus:ring-2 ${
                                matchScoreError
                                  ? 'border-rose-400 focus:ring-rose-500/20'
                                  : 'border-slate-300 focus:ring-emerald-600'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                adjustMatchScore('A', 1);
                                if (matchScoreError) setMatchScoreError(null);
                              }}
                              className="h-7 w-7 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
                              aria-label="Increase Side A score"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>

                          <span className="text-xs font-bold text-slate-400 px-0.5">
                            :
                          </span>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                adjustMatchScore('B', -1);
                                if (matchScoreError) setMatchScoreError(null);
                              }}
                              className="h-7 w-7 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
                              aria-label="Decrease Side B score"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={500}
                              aria-label="Side B score"
                              value={finalScoreB}
                              onChange={(e) => {
                                setFinalScoreB(e.target.value);
                                if (matchScoreError) setMatchScoreError(null);
                              }}
                              className={`w-12 h-8 text-center font-mono tabular-nums font-bold text-sm rounded-lg border bg-white text-slate-900 focus:outline-none focus:ring-2 ${
                                matchScoreError
                                  ? 'border-rose-400 focus:ring-rose-500/20'
                                  : 'border-slate-300 focus:ring-emerald-600'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                adjustMatchScore('B', 1);
                                if (matchScoreError) setMatchScoreError(null);
                              }}
                              className="h-7 w-7 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
                              aria-label="Increase Side B score"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Quick Game Point Target Selector (11 / 15 / 21 / 30 or Custom < 21) */}
                        <div className="flex flex-wrap items-center justify-center gap-1 pt-1 border-t border-slate-100 w-full">
                          <span className="text-[10px] font-semibold text-slate-500 mr-0.5">
                            Game to:
                          </span>
                          {Array.from(
                            new Set([11, 15, 21, 30, clubTargetPoints])
                          )
                            .sort((a, b) => a - b)
                            .map((pts) => {
                              const isActivePreset =
                                matchTargetPoints === pts &&
                                (numScoreA === pts || numScoreB === pts);
                              return (
                                <button
                                  key={pts}
                                  type="button"
                                  onClick={() => handleApplyTargetPreset(pts)}
                                  className={`h-5 px-1.5 rounded text-[10px] font-mono font-semibold transition-colors cursor-pointer ${
                                    isActivePreset
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                  }`}
                                  title={`Set winning score to ${pts} points (or type any custom score below 21)`}
                                >
                                  {pts}pt
                                </button>
                              );
                            })}
                          <span className="text-[10px] text-slate-400 ml-0.5">
                            (any score allowed)
                          </span>
                        </div>
                      </div>

                      {/* Side B Players */}
                      <div className="lg:col-span-4 space-y-1.5">
                        <span className="text-[11px] font-semibold text-slate-600 block">
                          Side B {numScoreB > numScoreA ? '· Winner' : ''}
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-1.5">
                          <StyledSelect
                            aria-label="Side B Player 1"
                            value={teamB1?.id || ''}
                            onChange={(e) => setTeamB1Id(e.target.value)}
                            className="h-8 text-xs"
                          >
                            {renderPlayerOptions()}
                          </StyledSelect>
                          {matchFormat === 'doubles' && (
                            <StyledSelect
                              aria-label="Side B Player 2"
                              value={teamB2?.id || ''}
                              onChange={(e) => setTeamB2Id(e.target.value)}
                              className="h-8 text-xs"
                            >
                              {renderPlayerOptions()}
                            </StyledSelect>
                          )}
                        </div>
                      </div>
                    </div>

                    <FormAlertBanner
                      message={matchScoreError}
                      variant="error"
                      onDismiss={() => setMatchScoreError(null)}
                    />

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      {!hasEnoughMatchPlayers ? (
                        <span className="text-[11px] font-medium text-amber-700 mr-auto">
                          {matchFormat === 'doubles' ? 'Doubles' : 'Singles'}{' '}
                          needs at least {requiredMatchPlayers} players who
                          joined this session ({allMatchPlayerOptions.length}{' '}
                          joined so far).
                        </span>
                      ) : hasDuplicateMatchPlayers ? (
                        <span className="text-[11px] font-medium text-amber-700 mr-auto">
                          Each player can only appear once in a match.
                        </span>
                      ) : null}
                      <button
                        type="submit"
                        disabled={
                          isSavingMatch ||
                          !hasEnoughMatchPlayers ||
                          hasDuplicateMatchPlayers
                        }
                        className="h-8 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer shadow-2xs"
                      >
                        {isSavingMatch ? 'Saving...' : 'Save Match Result'}
                      </button>
                    </div>
                  </motion.form>
                )}
            </AnimatePresence>

            {/* Recorded Matches List for This Session */}
            {filteredSessionMatches.length === 0 ? (
              <div className="p-8 text-center rounded-xl border border-slate-200/70 bg-slate-50/50 text-xs text-slate-600">
                {sessionMatches.length === 0
                  ? 'No matches recorded for this session yet.'
                  : 'No matches found for this filter.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden bg-white">
                {filteredSessionMatches.map((m, idx) => {
                  const sideANames = formatMatchSideLabel(m, 'A');
                  const sideBNames = formatMatchSideLabel(m, 'B');

                  const isUserInMatch = Boolean(
                    activePlayer && isPlayerInMatch(m, activePlayer.id)
                  );

                  return (
                    <div
                      key={m.id}
                      className="px-4 py-3 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 shrink-0">
                          <span className="font-mono tabular-nums">
                            #{filteredSessionMatches.length - idx}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize font-medium text-slate-600">
                            {m.matchFormat}
                          </span>
                          {isUserInMatch && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-emerald-700">
                                You
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                          <span
                            className={`break-words ${
                              m.winnerSide === 'A'
                                ? 'font-bold text-slate-900'
                                : 'text-slate-600 font-medium'
                            }`}
                          >
                            {onOpenProfileView ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenProfileView(m.teamAPlayer1Id)
                                  }
                                  className="hover:text-emerald-700 hover:underline cursor-pointer"
                                >
                                  {m.teamAPlayer1Name}
                                </button>
                                {m.matchFormat === 'doubles' &&
                                  m.teamAPlayer2Id &&
                                  m.teamAPlayer2Id !== 'NONE' && (
                                    <>
                                      <span> &amp; </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onOpenProfileView(m.teamAPlayer2Id)
                                        }
                                        className="hover:text-emerald-700 hover:underline cursor-pointer"
                                      >
                                        {m.teamAPlayer2Name}
                                      </button>
                                    </>
                                  )}
                              </>
                            ) : (
                              sideANames
                            )}
                          </span>
                          <span className="text-[11px] text-slate-400 font-medium">
                            vs
                          </span>
                          <span
                            className={`break-words ${
                              m.winnerSide === 'B'
                                ? 'font-bold text-slate-900'
                                : 'text-slate-600 font-medium'
                            }`}
                          >
                            {onOpenProfileView ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenProfileView(m.teamBPlayer1Id)
                                  }
                                  className="hover:text-emerald-700 hover:underline cursor-pointer"
                                >
                                  {m.teamBPlayer1Name}
                                </button>
                                {m.matchFormat === 'doubles' &&
                                  m.teamBPlayer2Id &&
                                  m.teamBPlayer2Id !== 'NONE' && (
                                    <>
                                      <span> &amp; </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onOpenProfileView(m.teamBPlayer2Id)
                                        }
                                        className="hover:text-emerald-700 hover:underline cursor-pointer"
                                      >
                                        {m.teamBPlayer2Name}
                                      </button>
                                    </>
                                  )}
                              </>
                            ) : (
                              sideBNames
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200/90 font-mono tabular-nums font-bold text-slate-900 text-xs whitespace-nowrap">
                          <span
                            className={
                              m.winnerSide === 'A'
                                ? 'text-emerald-700'
                                : 'text-slate-600 font-semibold'
                            }
                          >
                            {m.scoreTeamA}
                          </span>
                          <span className="mx-1 text-slate-400">–</span>
                          <span
                            className={
                              m.winnerSide === 'B'
                                ? 'text-emerald-700'
                                : 'text-slate-600 font-semibold'
                            }
                          >
                            {m.scoreTeamB}
                          </span>
                        </div>

                        {canManageClub && onDeleteMatch && (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteMatch(m)}
                            className="h-7 w-7 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            aria-label="Delete match"
                            title="Delete match"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* SHARE INVITE & GROUP CHAT MODAL */}
      <AnimatePresence>
        {showInviteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShowInviteModal(false)}
          >
            <motion.section
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-5 sm:p-6 space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-display">
                    Group Chat Invite &amp; Direct Link
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Share this direct link or formatted roster message to
                    WhatsApp, Telegram, or WeChat.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
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
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PAYMENT METHOD INFO MODAL */}
      <AnimatePresence>
        {showPaymentInfoModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShowPaymentInfoModal(false)}
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
                      Payment Methods &amp; Bank Account Info —{' '}
                      {activeClub.name}
                    </h2>
                    {savedPaymentConfigNotice && (
                      <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        Saved
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Use the Phone Number (PayNow / Mobile Transfer) or Bank
                    Account below to make payment for this session.
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
                    onClick={() => setShowPaymentInfoModal(false)}
                    className="h-9 px-3.5 text-xs font-semibold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-xl inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <X className="w-4 h-4 shrink-0" />
                    <span>Close</span>
                  </button>
                </div>
              </div>

              {canManageClub && editingPaymentConfig ? (
                <form
                  noValidate
                  onSubmit={handleSavePaymentConfig}
                  className="p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <StyledInput
                      label="Recipient / Account Holder"
                      maxLength={60}
                      value={editRecipient}
                      error={paymentConfigErrors.recipient}
                      onChange={(e) => {
                        setEditRecipient(e.target.value);
                        if (paymentConfigErrors.recipient)
                          setPaymentConfigErrors((prev) => ({
                            ...prev,
                            recipient: undefined,
                          }));
                      }}
                      placeholder="e.g. Alex Tan"
                    />
                    <StyledInput
                      label="Phone Number (PayNow / Mobile)"
                      maxLength={40}
                      value={editPhone}
                      error={paymentConfigErrors.phone}
                      onChange={(e) => {
                        setEditPhone(e.target.value);
                        if (paymentConfigErrors.phone)
                          setPaymentConfigErrors((prev) => ({
                            ...prev,
                            phone: undefined,
                          }));
                      }}
                      placeholder="e.g. +65 9123 4567"
                      className="font-mono tabular-nums"
                    />
                    <StyledInput
                      label="Bank Name"
                      maxLength={40}
                      value={editBankName}
                      error={paymentConfigErrors.bankName}
                      onChange={(e) => {
                        setEditBankName(e.target.value);
                        if (paymentConfigErrors.bankName)
                          setPaymentConfigErrors((prev) => ({
                            ...prev,
                            bankName: undefined,
                          }));
                      }}
                      placeholder="e.g. DBS Bank / OCBC"
                    />
                    <StyledInput
                      label="Bank Account Number"
                      maxLength={40}
                      value={editBankAccount}
                      error={paymentConfigErrors.bankAccount}
                      onChange={(e) => {
                        setEditBankAccount(e.target.value);
                        if (paymentConfigErrors.bankAccount)
                          setPaymentConfigErrors((prev) => ({
                            ...prev,
                            bankAccount: undefined,
                          }));
                      }}
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
                          Recipient:{' '}
                          <span className="font-semibold text-slate-900">
                            {resolvedDetails.recipientName}
                          </span>
                        </p>
                      </div>
                    </div>

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
                          Account Holder:{' '}
                          <span className="font-semibold text-slate-900">
                            {resolvedDetails.recipientName}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <User className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>Transfer Instructions &amp; Reference</span>
                      </span>
                      <p className="text-xs sm:text-sm text-slate-700">
                        Pay to{' '}
                        <span className="font-bold text-slate-950">
                          {resolvedDetails.recipientName}
                        </span>{' '}
                        · {resolvedDetails.paymentNotes}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activePlayer && targetRsvpForPayment && (
                <div className="pt-4 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 block">
                      Paying Session Share ($
                      {targetRsvpForPayment.feeShare.toFixed(2)})
                    </span>
                    <p className="text-xs text-slate-600">
                      Once you have transferred the amount via Phone or Bank
                      Account, submit below so the Admin/Owner can confirm
                      receipt.
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
                        I Have Paid ($
                        {targetRsvpForPayment.feeShare.toFixed(2)})
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Confirmation Modal: Finalize or Recalculate Session Split */}
      {onFinalizeSessionShuttleAndSplit && (
        <ConfirmModal
          open={confirmFinalizeOpen}
          title={
            isCompleted
              ? 'Recalculate Session Fee Split?'
              : 'Finalize Session Fee Split?'
          }
          description={(() => {
            const shuttleTotal = Number(
              (draft.shuttlesUsed * draft.shuttleUnitCost).toFixed(2)
            );
            const poolTotal = draft.courtFee + shuttleTotal;
            return (
              <div className="space-y-1.5">
                <p>
                  {isCompleted
                    ? 'Update the finalized court and shuttle costs for '
                    : 'Lock attendance and calculate individual fee shares for '}
                  <strong className="font-semibold text-slate-900">
                    {session.title}
                  </strong>{' '}
                  ({session.sessionDate})?
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
            isCompleted ? 'Confirm Recalculate' : 'Finalize Split'
          }
          variant="primary"
          onCancel={() => setConfirmFinalizeOpen(false)}
          onConfirm={async () => {
            setConfirmFinalizeOpen(false);
            await onFinalizeSessionShuttleAndSplit(
              session.id,
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
      {onRejectPaymentForRsvp && (
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
      )}

      {/* Confirmation Modal: Waive Session Fee */}
      {onAcceptOrClearSingleRsvp && (
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

      {/* Confirmation Modal: Delete Recorded Match */}
      {onDeleteMatch && (
        <ConfirmModal
          open={Boolean(pendingDeleteMatch)}
          title="Delete Recorded Match?"
          description={
            pendingDeleteMatch ? (
              <div className="space-y-1.5">
                <p>
                  Are you sure you want to permanently delete this match result?
                </p>
                <p className="font-semibold text-slate-900">
                  {pendingDeleteMatch.matchFormat === 'doubles'
                    ? `${pendingDeleteMatch.teamAPlayer1Name} & ${pendingDeleteMatch.teamAPlayer2Name} vs ${pendingDeleteMatch.teamBPlayer1Name} & ${pendingDeleteMatch.teamBPlayer2Name}`
                    : `${pendingDeleteMatch.teamAPlayer1Name} vs ${pendingDeleteMatch.teamBPlayer1Name}`}{' '}
                  ({pendingDeleteMatch.scoreTeamA}–{pendingDeleteMatch.scoreTeamB})
                </p>
                <p className="text-slate-600">
                  Player win/loss records and rating scores will be recalculated
                  automatically.
                </p>
              </div>
            ) : null
          }
          confirmLabel="Delete Match"
          variant="danger"
          onCancel={() => setPendingDeleteMatch(null)}
          onConfirm={async () => {
            if (!pendingDeleteMatch) return;
            const target = pendingDeleteMatch;
            setPendingDeleteMatch(null);
            await onDeleteMatch(target.id);
          }}
        />
      )}
    </div>
  );
};
