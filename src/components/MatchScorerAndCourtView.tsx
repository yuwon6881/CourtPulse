import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Minus,
  Plus,
  RefreshCw,
  Shuffle,
  Sparkles,
  Swords,
  Trash2,
  User,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import {
  BadmintonMatch,
  CourtPairingOption,
  MatchFormat,
  MatchmakingStrategy,
  Player,
  RankedPlayer,
  Session,
  SessionRsvp,
  TierRank,
} from '../types';
import {
  computePlayerLeaderboardAndTiers,
  computeSessionPlayerQueueMetrics,
  generateSmartCourtMatchups,
  parseCourtNamesFromSession,
} from '../utils/badmintonLogic';
import {
  SegmentedControl,
  StyledInput,
  StyledSelect,
} from './ui/FormControls';

interface MatchScorerAndCourtViewProps {
  sessions: Session[];
  selectedSessionId: string;
  onSelectSession: (id: string) => void;
  players: (Player | RankedPlayer)[];
  rsvps?: SessionRsvp[];
  matches: BadmintonMatch[];
  activePlayer: Player | null;
  isAdmin: boolean;
  onRecordMatch: (matchData: {
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
  onDeleteMatch: (matchId: string) => Promise<void>;
  onOpenStandingsView?: () => void;
  onOpenProfileView?: (playerId?: string) => void;
}

const TIER_BADGE_CLASS: Record<TierRank, string> = {
  S: 'bg-amber-50 text-amber-900 border-amber-300',
  A: 'bg-emerald-50 text-emerald-900 border-emerald-300',
  B: 'bg-sky-50 text-sky-900 border-sky-300',
  C: 'bg-slate-100 text-slate-700 border-slate-300',
};

export const MatchScorerAndCourtView: React.FC<MatchScorerAndCourtViewProps> = ({
  sessions,
  selectedSessionId,
  onSelectSession,
  players,
  rsvps = [],
  matches,
  activePlayer,
  isAdmin,
  onRecordMatch,
  onDeleteMatch,
  onOpenStandingsView,
  onOpenProfileView,
}) => {
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('doubles');
  const [teamA1Id, setTeamA1Id] = useState<string>(players[0]?.id || '');
  const [teamA2Id, setTeamA2Id] = useState<string>(players[2]?.id || '');
  const [teamB1Id, setTeamB1Id] = useState<string>(players[1]?.id || '');
  const [teamB2Id, setTeamB2Id] = useState<string>(players[3]?.id || '');
  const [finalScoreA, setFinalScoreA] = useState<string>('21');
  const [finalScoreB, setFinalScoreB] = useState<string>('17');
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [loadedCourtNotice, setLoadedCourtNotice] = useState<string | null>(
    null
  );
  const [matchFilter, setMatchFilter] = useState<'all' | 'mine'>('all');
  const [sessionFilter, setSessionFilter] = useState<string>(
    selectedSessionId || sessions[0]?.id || 'all'
  );

  // Smart Court Queue & Matchmaker State
  const [showSmartQueue, setShowSmartQueue] = useState<boolean>(true);
  const [strategy, setStrategy] =
    useState<MatchmakingStrategy>('balanced_elo');

  // Configurable Court Count (1 to N courts, defaults to session's court count)
  const [courtCount, setCourtCount] = useState<number>(2);

  // Players subbed out for the current draw (automatically cleared when a match is saved)
  const [skippedThisDrawIds, setSkippedThisDrawIds] = useState<string[]>([]);
  // Players currently flagged on the generated court cards to be subbed out on click of "Regenerate"
  const [flaggedOnCourtIds, setFlaggedOnCourtIds] = useState<string[]>([]);
  // Variation index for 1-click "Regenerate / Redraw" even when no players are flagged
  const [variationIndex, setVariationIndex] = useState<number>(0);

  const [customPoolIds, setCustomPoolIds] = useState<string[] | null>(null);
  const [showPoolCustomizer, setShowPoolCustomizer] = useState<boolean>(false);
  // Per-court selected pairing option index (0 = Recommended, 1 = Alt A, 2 = Alt B)
  const [selectedPairingOptionByCourt, setSelectedPairingOptionByCourt] =
    useState<Record<number, number>>({});

  const activeSessionForScore =
    sessions.find(
      (s) =>
        s.id === (sessionFilter !== 'all' ? sessionFilter : selectedSessionId)
    ) ||
    sessions[0] ||
    null;

  // Ensure rankedPlayers always have rank/tier metadata
  const rankedPlayers = useMemo<RankedPlayer[]>(() => {
    const first = players[0] as RankedPlayer | undefined;
    if (first && typeof first.tier === 'string' && typeof first.rank === 'number') {
      return players as RankedPlayer[];
    }
    return computePlayerLeaderboardAndTiers(players, matches);
  }, [players, matches]);

  const sessionCourtLabels = useMemo(() => {
    return parseCourtNamesFromSession(
      activeSessionForScore?.courtNumbers || 'Court 1'
    );
  }, [activeSessionForScore]);

  // Reset custom pool, flags & initialize courtCount from session when switching active session
  useEffect(() => {
    setCustomPoolIds(null);
    setSkippedThisDrawIds([]);
    setFlaggedOnCourtIds([]);
    setVariationIndex(0);
    setSelectedPairingOptionByCourt({});
    setCourtCount(Math.max(1, sessionCourtLabels.length));
  }, [activeSessionForScore?.id, sessionCourtLabels.length]);

  // Build effective court labels for 1..courtCount (expanding beyond sessionCourtLabels if user increased courtCount)
  const effectiveCourtLabels = useMemo(() => {
    const labels: string[] = [];
    for (let i = 0; i < Math.max(1, courtCount); i++) {
      if (sessionCourtLabels[i]) {
        labels.push(sessionCourtLabels[i]);
      } else {
        labels.push(`Court ${i + 1}`);
      }
    }
    return labels;
  }, [courtCount, sessionCourtLabels]);

  // Default rotation pool: players who RSVPed 'going' (and not 'no_show') for activeSessionForScore
  const defaultSessionPoolIds = useMemo<string[]>(() => {
    if (!activeSessionForScore) {
      return rankedPlayers.map((p) => p.id);
    }
    const goingIds = rsvps
      .filter(
        (r) =>
          r.sessionId === activeSessionForScore.id &&
          r.status === 'going' &&
          r.attendanceOutcome !== 'no_show'
      )
      .map((r) => r.playerId);

    const validIds = goingIds.filter((id) =>
      rankedPlayers.some((p) => p.id === id)
    );
    // If session has at least 2 confirmed attendees, use them; otherwise default to all club players
    return validIds.length >= 2 ? validIds : rankedPlayers.map((p) => p.id);
  }, [activeSessionForScore, rsvps, rankedPlayers]);

  const effectivePoolIds = customPoolIds ?? defaultSessionPoolIds;

  // Past matches strictly within the selected session (for court time, rest streak, partner & enemy history)
  const activeSessionMatches = useMemo(() => {
    if (!activeSessionForScore) return matches;
    return matches.filter((m) => m.sessionId === activeSessionForScore.id);
  }, [matches, activeSessionForScore]);

  const queueMetrics = useMemo(() => {
    return computeSessionPlayerQueueMetrics(
      rankedPlayers,
      activeSessionMatches,
      effectivePoolIds,
      skippedThisDrawIds
    );
  }, [
    rankedPlayers,
    activeSessionMatches,
    effectivePoolIds,
    skippedThisDrawIds,
  ]);

  const generatedCourts = useMemo(() => {
    return generateSmartCourtMatchups({
      queueMetrics,
      sessionMatches: activeSessionMatches,
      allClubMatches: matches,
      matchFormat,
      strategy,
      courtsToFill: Math.max(1, courtCount),
      courtLabels: effectiveCourtLabels,
      variationIndex,
    });
  }, [
    queueMetrics,
    activeSessionMatches,
    matches,
    matchFormat,
    strategy,
    courtCount,
    effectiveCourtLabels,
    variationIndex,
  ]);

  const handleSelectSessionFilter = (val: string) => {
    setSessionFilter(val);
    if (val !== 'all') {
      onSelectSession(val);
    }
  };

  // Toggle flagging a player right on the generated court card
  const handleToggleFlagOnCourtPlayer = (playerId: string) => {
    setFlaggedOnCourtIds((prev) =>
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId]
    );
  };

  // Sub out all flagged players (or regenerate fresh variation if none flagged)
  const handleRegenerateLineup = () => {
    if (flaggedOnCourtIds.length > 0) {
      setSkippedThisDrawIds((prev) =>
        Array.from(new Set([...prev, ...flaggedOnCourtIds]))
      );
      setFlaggedOnCourtIds([]);
      setSelectedPairingOptionByCourt({});
    } else {
      setVariationIndex((prev) => prev + 1);
      setSelectedPairingOptionByCourt({});
    }
  };

  // Restore a single skipped player back into the current draw
  const handleRestoreSkippedPlayer = (playerId: string) => {
    setSkippedThisDrawIds((prev) => prev.filter((id) => id !== playerId));
    setSelectedPairingOptionByCourt({});
  };

  // Restore all skipped players back into the current draw
  const handleRestoreAllSkippedPlayers = () => {
    setSkippedThisDrawIds([]);
    setFlaggedOnCourtIds([]);
    setSelectedPairingOptionByCourt({});
  };

  const handleTogglePoolPlayer = (playerId: string) => {
    const base = customPoolIds ?? defaultSessionPoolIds;
    if (base.includes(playerId)) {
      if (base.length <= 2) return; // Keep at least 2 players
      setCustomPoolIds(base.filter((id) => id !== playerId));
    } else {
      setCustomPoolIds([...base, playerId]);
    }
    setFlaggedOnCourtIds([]);
    setSelectedPairingOptionByCourt({});
  };

  const handleLoadPairingIntoScorer = (
    courtLabel: string,
    pairing: CourtPairingOption,
    format: MatchFormat
  ) => {
    setMatchFormat(format);
    setTeamA1Id(pairing.teamAPlayer1.id);
    if (format === 'doubles' && pairing.teamAPlayer2) {
      setTeamA2Id(pairing.teamAPlayer2.id);
    }
    setTeamB1Id(pairing.teamBPlayer1.id);
    if (format === 'doubles' && pairing.teamBPlayer2) {
      setTeamB2Id(pairing.teamBPlayer2.id);
    }
    if (activeSessionForScore && sessionFilter === 'all') {
      setSessionFilter(activeSessionForScore.id);
    }
    setLoadedCourtNotice(`Loaded ${courtLabel} lineup into scorer`);
    setTimeout(() => setLoadedCourtNotice(null), 2600);
  };

  const teamA1 =
    rankedPlayers.find((p) => p.id === teamA1Id) || rankedPlayers[0];
  const teamA2 =
    matchFormat === 'doubles'
      ? rankedPlayers.find((p) => p.id === teamA2Id) ||
        rankedPlayers[2] ||
        rankedPlayers[0]
      : null;
  const teamB1 =
    rankedPlayers.find((p) => p.id === teamB1Id) ||
    rankedPlayers[1] ||
    rankedPlayers[0];
  const teamB2 =
    matchFormat === 'doubles'
      ? rankedPlayers.find((p) => p.id === teamB2Id) ||
        rankedPlayers[3] ||
        rankedPlayers[1]
      : null;

  const handleSubmitFinalScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !activeSessionForScore || !teamA1 || !teamB1) return;

    const parsedA = Math.max(0, Math.min(500, parseInt(finalScoreA, 10) || 0));
    const parsedB = Math.max(0, Math.min(500, parseInt(finalScoreB, 10) || 0));

    setIsSaving(true);
    try {
      await onRecordMatch({
        sessionId: activeSessionForScore.id,
        matchFormat,
        teamAPlayer1: teamA1,
        teamAPlayer2: matchFormat === 'doubles' ? teamA2 : null,
        teamBPlayer1: teamB1,
        teamBPlayer2: matchFormat === 'doubles' ? teamB2 : null,
        scoreTeamA: parsedA,
        scoreTeamB: parsedB,
        setScoresText: `${parsedA}-${parsedB}`,
      });
      // Automatically restore any players skipped for the previous draw so next round is fresh
      setSkippedThisDrawIds([]);
      setFlaggedOnCourtIds([]);
      setVariationIndex(0);
      setSelectedPairingOptionByCourt({});
      setSavedNotice(`Saved ${parsedA}–${parsedB} · Queue rotated`);
      setTimeout(() => setSavedNotice(null), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const sessionScopedMatches =
    sessionFilter === 'all'
      ? matches
      : matches.filter((m) => m.sessionId === sessionFilter);

  const filteredMatches = sessionScopedMatches.filter((m) => {
    if (matchFilter === 'all' || !activePlayer) return true;
    return (
      m.teamAPlayer1Id === activePlayer.id ||
      m.teamAPlayer2Id === activePlayer.id ||
      m.teamBPlayer1Id === activePlayer.id ||
      m.teamBPlayer2Id === activePlayer.id
    );
  });

  // Fairness summary across available players in pool
  const activeUnpausedMetrics = queueMetrics.filter((m) => !m.isPaused);
  const minSessionGames =
    activeUnpausedMetrics.length > 0
      ? Math.min(...activeUnpausedMetrics.map((m) => m.sessionGamesPlayed))
      : 0;
  const maxSessionGames =
    activeUnpausedMetrics.length > 0
      ? Math.max(...activeUnpausedMetrics.map((m) => m.sessionGamesPlayed))
      : 0;
  const gamesSpread = maxSessionGames - minSessionGames;

  const playersPerCourt = matchFormat === 'doubles' ? 4 : 2;
  const maxPossibleCourtsForPool = Math.max(
    1,
    Math.floor(activeUnpausedMetrics.length / playersPerCourt)
  );

  const getMetricForPlayerId = (id: string) =>
    queueMetrics.find((m) => m.player.id === id);

  return (
    <div className="space-y-6">
      {/* Page Header & Competitive Hub Switcher */}
      <div className="flex flex-col gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Match Results, Court Queue &amp; Scorer
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Smart court-time rotation, partner &amp; enemy history balancing,
              and live session score logging.
            </p>
          </div>

          {(onOpenStandingsView || onOpenProfileView) && (
            <div className="flex items-center gap-2 self-start sm:self-auto overflow-x-auto max-w-full">
              <div className="inline-flex items-center bg-slate-100/90 p-1 rounded-lg border border-slate-200/70">
                {onOpenStandingsView && (
                  <button
                    type="button"
                    onClick={onOpenStandingsView}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md text-slate-500 hover:text-slate-900 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>Standings</span>
                  </button>
                )}
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-white text-slate-900 shadow-2xs ring-1 ring-slate-900/5 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Swords className="w-3.5 h-3.5 text-slate-700" />
                  <span>Matches &amp; Scorer</span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500">
                    {matches.length}
                  </span>
                </button>
                {onOpenProfileView && (
                  <button
                    type="button"
                    onClick={() => onOpenProfileView(activePlayer?.id)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md text-slate-500 hover:text-slate-900 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>My Profile</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="w-full sm:w-80">
            <StyledSelect
              aria-label="Filter matches by session"
              value={sessionFilter}
              onChange={(e) => handleSelectSessionFilter(e.target.value)}
              className="h-9 text-xs"
            >
              <option value="all">All Sessions ({matches.length})</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.sessionDate} · {s.title} ({s.courtNumbers})
                </option>
              ))}
            </StyledSelect>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setShowSmartQueue((prev) => !prev)}
              className={`h-9 px-3 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                showSmartQueue
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Smart Court Queue</span>
              {showSmartQueue ? (
                <ChevronUp className="w-3.5 h-3.5 text-emerald-700" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>

            <SegmentedControl
              options={[
                {
                  value: 'all',
                  label: 'All Matches',
                  count: sessionScopedMatches.length,
                },
                { value: 'mine', label: 'My Matches' },
              ]}
              value={matchFilter}
              onChange={setMatchFilter}
            />
          </div>
        </div>
      </div>

      {/* SMART COURT QUEUE & AUTO-MATCHMAKER PANEL */}
      {showSmartQueue && activeSessionForScore && (
        <section className="bg-white rounded-xl border border-slate-200/90 overflow-hidden shadow-2xs">
          {/* Panel Header & Configurable Court / Format Controls */}
          <div className="px-4 sm:px-6 py-4 bg-slate-50/70 border-b border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
                  <Shuffle className="w-4 h-4 text-emerald-600" />
                  <span>Smart Court Queue &amp; Matchmaker</span>
                </span>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80">
                  Priority #1: Equal Court Time
                </span>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  · {activeSessionForScore.title} (
                  {activeSessionMatches.length} session match
                  {activeSessionMatches.length === 1 ? '' : 'es'} logged)
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Generates balanced partners &amp; opponents from session history.
                If someone on a generated court isn&rsquo;t ready, tap{' '}
                <strong className="text-slate-700">Flag Unavailable</strong> on
                their card and click{' '}
                <strong className="text-slate-700">Regenerate</strong>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Format Toggle */}
              <SegmentedControl
                size="sm"
                options={[
                  { value: 'doubles', label: 'Doubles (2v2)' },
                  { value: 'singles', label: 'Singles (1v1)' },
                ]}
                value={matchFormat}
                onChange={(fmt) => {
                  setMatchFormat(fmt);
                  setFlaggedOnCourtIds([]);
                  setSelectedPairingOptionByCourt({});
                }}
              />

              {/* Configurable Court Count Stepper (1 to N courts) */}
              <div
                className="inline-flex items-center h-8 rounded-lg bg-white border border-slate-200/90 px-1.5 gap-1"
                title="Configure how many courts to generate matchups for simultaneously"
              >
                <span className="text-[11px] font-semibold text-slate-500 pl-1">
                  Courts:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCourtCount((c) => Math.max(1, c - 1));
                    setSelectedPairingOptionByCourt({});
                  }}
                  disabled={courtCount <= 1}
                  className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
                  aria-label="Decrease court count"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={12}
                  aria-label="Number of courts"
                  value={courtCount}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    if (!Number.isNaN(parsed)) {
                      setCourtCount(Math.max(1, Math.min(12, parsed)));
                      setSelectedPairingOptionByCourt({});
                    }
                  }}
                  className="w-8 text-center font-mono text-xs font-bold text-slate-900 bg-transparent focus:outline-none tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => {
                    setCourtCount((c) => Math.min(12, c + 1));
                    setSelectedPairingOptionByCourt({});
                  }}
                  disabled={courtCount >= 12}
                  className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
                  aria-label="Increase court count"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowPoolCustomizer((prev) => !prev)}
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  showPoolCustomizer
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
                title="Add walk-in players or adjust who attended this session"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Session Pool ({queueMetrics.length})</span>
              </button>
            </div>
          </div>

          {/* Matchmaking Strategy Bar */}
          <div className="px-4 sm:px-6 py-3 bg-white border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 font-medium">
                Pairing Strategy:
              </span>
              <SegmentedControl
                size="sm"
                options={[
                  {
                    value: 'balanced_elo',
                    label: 'Equal Time + Balanced ELO',
                  },
                  {
                    value: 'strict_tier_competitive',
                    label: 'Tier Showdown',
                  },
                  {
                    value: 'social_variety_mixer',
                    label: 'Fresh Partners & Enemies',
                  },
                ]}
                value={strategy}
                onChange={(val) => {
                  setStrategy(val);
                  setVariationIndex(0);
                  setSelectedPairingOptionByCourt({});
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Court-Time Spread:{' '}
                  <strong
                    className={`font-mono ${
                      gamesSpread <= 1 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {gamesSpread === 0
                      ? 'Perfectly Equal (0G diff)'
                      : `±${gamesSpread} game${gamesSpread === 1 ? '' : 's'}`}
                  </strong>
                </span>
              </span>
              {loadedCourtNotice && (
                <span className="text-emerald-700 font-semibold inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {loadedCourtNotice}
                </span>
              )}
            </div>
          </div>

          {/* Optional Session Pool Customizer (Add Walk-Ins or Reset to Going RSVPs) */}
          {showPoolCustomizer && (
            <div className="px-4 sm:px-6 py-3.5 bg-slate-50 border-b border-slate-200/70 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">
                  Session Attendance Pool (Defaults to Going RSVPs — tap to add
                  walk-ins or remove absentees)
                </p>
                {customPoolIds !== null && (
                  <button
                    type="button"
                    onClick={() => setCustomPoolIds(null)}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Reset to Going RSVPs</span>
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rankedPlayers.map((p) => {
                  const inPool = effectivePoolIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleTogglePoolPlayer(p.id)}
                      className={`h-8 px-2.5 rounded-md text-xs font-medium border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                        inPool
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-semibold'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      <span>{p.name}</span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {p.ratingScore}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Generated Court Matchup Cards + Read-Only Rotation Standings */}
          <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 7 Cols: Recommended Next Matchup(s) with Direct Flag & Regenerate */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-900">
                    Generated Court Lineup ({generatedCourts.length} of{' '}
                    {courtCount} {courtCount === 1 ? 'Court' : 'Courts'} filled)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Tap any player below to flag them if unavailable, then click{' '}
                    <span className="font-semibold text-slate-700">
                      Regenerate
                    </span>
                    .
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {flaggedOnCourtIds.length > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setFlaggedOnCourtIds([])}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-600 cursor-pointer"
                      >
                        Clear Flag ({flaggedOnCourtIds.length})
                      </button>
                      <button
                        type="button"
                        onClick={handleRegenerateLineup}
                        className="h-8 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>
                          Sub Out Flagged ({flaggedOnCourtIds.length}) &amp;
                          Regenerate
                        </span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRegenerateLineup}
                      className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Cycle to an alternative balanced court draw"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Regenerate Lineup</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Notice if courtCount exceeds available pool capacity */}
              {courtCount > maxPossibleCourtsForPool && (
                <div className="px-3.5 py-2.5 rounded-lg bg-amber-50/80 border border-amber-200/90 flex items-center justify-between gap-2 text-xs text-amber-950">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Configured for <strong>{courtCount} courts</strong> (
                      {courtCount * playersPerCourt} players needed), but only{' '}
                      <strong>
                        {activeUnpausedMetrics.length} available players
                      </strong>{' '}
                      are in the current draw (filling{' '}
                      {generatedCourts.length}{' '}
                      {generatedCourts.length === 1 ? 'court' : 'courts'}).
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPoolCustomizer(true)}
                    className="px-2.5 py-1 rounded bg-white border border-amber-300 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 shrink-0 cursor-pointer"
                  >
                    Edit Pool
                  </button>
                </div>
              )}

              {/* Skipped / Subbed Out Players Strip for Current Draw */}
              {skippedThisDrawIds.length > 0 && (
                <div className="px-3.5 py-2.5 rounded-lg bg-slate-100/90 border border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-slate-600">
                      Subbed out for this draw ({skippedThisDrawIds.length}):
                    </span>
                    {skippedThisDrawIds.map((id) => {
                      const p = rankedPlayers.find((item) => item.id === id);
                      if (!p) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => handleRestoreSkippedPlayer(id)}
                          title="Click to put player back into this draw"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[11px] font-medium text-slate-700 hover:border-emerald-300 hover:text-emerald-800 transition-colors cursor-pointer"
                        >
                          <span>{p.name}</span>
                          <X className="w-3 h-3 text-slate-400" />
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={handleRestoreAllSkippedPlayers}
                    className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                  >
                    Restore All
                  </button>
                </div>
              )}

              {generatedCourts.length === 0 ? (
                <div className="p-6 rounded-lg border border-slate-200/80 bg-slate-50 text-center space-y-2 text-xs text-slate-500">
                  <p>
                    Not enough available players to fill a {matchFormat} court (
                    need at least {playersPerCourt} available players).
                  </p>
                  {skippedThisDrawIds.length > 0 && (
                    <button
                      type="button"
                      onClick={handleRestoreAllSkippedPlayers}
                      className="h-8 px-3 rounded-lg bg-slate-900 text-white font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>
                        Restore Subbed-Out Players ({skippedThisDrawIds.length})
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {generatedCourts.map((court) => {
                    const selectedOptIdx =
                      selectedPairingOptionByCourt[court.courtIndex] ?? 0;
                    const activePairing =
                      court.alternativePairings[selectedOptIdx] ||
                      court.alternativePairings[0];

                    const a1Metric = getMetricForPlayerId(
                      activePairing.teamAPlayer1.id
                    );
                    const a2Metric = activePairing.teamAPlayer2
                      ? getMetricForPlayerId(activePairing.teamAPlayer2.id)
                      : undefined;
                    const b1Metric = getMetricForPlayerId(
                      activePairing.teamBPlayer1.id
                    );
                    const b2Metric = activePairing.teamBPlayer2
                      ? getMetricForPlayerId(activePairing.teamBPlayer2.id)
                      : undefined;

                    const renderCourtPlayerSlot = (
                      p: RankedPlayer,
                      metric: ReturnType<typeof getMetricForPlayerId>
                    ) => {
                      const isFlagged = flaggedOnCourtIds.includes(p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => handleToggleFlagOnCourtPlayer(p.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleToggleFlagOnCourtPlayer(p.id);
                            }
                          }}
                          title={
                            isFlagged
                              ? 'Flagged as unavailable — click Sub Out & Regenerate above, or click again to unflag'
                              : 'Tap if this player is unavailable / resting to sub them out'
                          }
                          className={`flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-md border transition-colors cursor-pointer ${
                            isFlagged
                              ? 'bg-amber-50 border-amber-300 text-amber-950'
                              : 'bg-white border-slate-200/60 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border shrink-0 ${
                                TIER_BADGE_CLASS[p.tier]
                              }`}
                            >
                              {p.tier}
                            </span>
                            <span
                              className={`font-semibold truncate ${
                                isFlagged
                                  ? 'line-through text-amber-900'
                                  : 'text-slate-900'
                              }`}
                            >
                              {p.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isFlagged ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-950 text-[10px] font-bold">
                                Flagged
                              </span>
                            ) : (
                              <>
                                <span className="font-mono text-[11px] tabular-nums text-slate-500">
                                  {metric?.sessionGamesPlayed ?? 0}G
                                </span>
                                <span className="text-slate-300 font-mono text-[10px]">
                                  ·
                                </span>
                                <span className="text-slate-400 hover:text-amber-700 inline-flex items-center gap-0.5 text-[10px] font-semibold">
                                  <UserMinus className="w-3 h-3" />
                                  <span className="hidden sm:inline">Flag</span>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    };

                    return (
                      <div
                        key={court.courtIndex}
                        className="rounded-xl border border-slate-200/90 bg-white overflow-hidden"
                      >
                        {/* Court Card Top Header */}
                        <div className="px-4 py-2.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-bold tracking-tight">
                              {court.courtLabel}
                            </span>
                            <span className="text-slate-400">·</span>
                            <span className="font-mono text-[11px] text-emerald-300 font-semibold">
                              {activePairing.balanceScorePercent}% ELO Balance (Δ{' '}
                              {activePairing.eloDiff})
                            </span>
                          </div>

                          {/* 3-Way Partner Rotation Switcher for Doubles */}
                          {court.matchFormat === 'doubles' &&
                            court.alternativePairings.length > 1 && (
                              <div className="inline-flex items-center gap-1 bg-slate-800 p-0.5 rounded-md">
                                {court.alternativePairings.map((opt, idx) => (
                                  <button
                                    key={opt.optionIndex}
                                    type="button"
                                    onClick={() =>
                                      setSelectedPairingOptionByCourt(
                                        (prev) => ({
                                          ...prev,
                                          [court.courtIndex]: idx,
                                        })
                                      )
                                    }
                                    className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                                      selectedOptIdx === idx
                                        ? 'bg-emerald-600 text-white'
                                        : 'text-slate-300 hover:text-white'
                                    }`}
                                    title={`Team ELO diff: ${opt.eloDiff} · Prior partner games: ${opt.repeatPartnerCount}`}
                                  >
                                    {idx === 0
                                      ? 'Best Pair'
                                      : `Swap ${idx}`}
                                  </button>
                                ))}
                              </div>
                            )}
                        </div>

                        {/* Side A vs Side B Lineup */}
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-11 gap-3 items-center">
                          {/* Side A Box */}
                          <div className="sm:col-span-5 p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-bold text-slate-700">
                                Side A
                              </span>
                              <span className="font-mono tabular-nums font-semibold text-slate-600">
                                Avg {activePairing.teamAAvgElo} ELO
                              </span>
                            </div>

                            {[
                              {
                                player: activePairing.teamAPlayer1,
                                metric: a1Metric,
                              },
                              ...(activePairing.teamAPlayer2
                                ? [
                                    {
                                      player: activePairing.teamAPlayer2,
                                      metric: a2Metric,
                                    },
                                  ]
                                : []),
                            ].map(({ player: p, metric }) =>
                              renderCourtPlayerSlot(p, metric)
                            )}
                          </div>

                          {/* VS Divider */}
                          <div className="sm:col-span-1 flex items-center justify-center">
                            <span className="px-2 py-1 rounded-md bg-slate-100 text-[11px] font-mono font-bold text-slate-500">
                              VS
                            </span>
                          </div>

                          {/* Side B Box */}
                          <div className="sm:col-span-5 p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-2">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-bold text-slate-700">
                                Side B
                              </span>
                              <span className="font-mono tabular-nums font-semibold text-slate-600">
                                Avg {activePairing.teamBAvgElo} ELO
                              </span>
                            </div>

                            {[
                              {
                                player: activePairing.teamBPlayer1,
                                metric: b1Metric,
                              },
                              ...(activePairing.teamBPlayer2
                                ? [
                                    {
                                      player: activePairing.teamBPlayer2,
                                      metric: b2Metric,
                                    },
                                  ]
                                : []),
                            ].map(({ player: p, metric }) =>
                              renderCourtPlayerSlot(p, metric)
                            )}
                          </div>
                        </div>

                        {/* Matchup Reasons & 1-Tap Load Action Footer */}
                        <div className="px-4 py-3 bg-slate-50/70 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                            <span className="px-2 py-0.5 rounded bg-white border border-slate-200/80 font-medium">
                              {activePairing.repeatPartnerCount === 0
                                ? '0 repeat partners this session'
                                : `${activePairing.repeatPartnerCount}x partnered earlier`}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-white border border-slate-200/80 font-medium">
                              {activePairing.repeatOpponentCount === 0
                                ? 'Fresh cross-court enemies'
                                : `${activePairing.repeatOpponentCount}x cross-court clashes`}
                            </span>
                          </div>

                          {isAdmin ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleLoadPairingIntoScorer(
                                  court.courtLabel,
                                  activePairing,
                                  court.matchFormat
                                )
                              }
                              className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors shrink-0 cursor-pointer"
                            >
                              <span>Load into Scorer</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">
                              Next up on {court.courtLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right 5 Cols: Clean Read-Only Session Court-Time & Rotation Queue Table */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900">
                  Session Court-Time &amp; Queue ({queueMetrics.length})
                </h3>
                <span className="text-[11px] text-slate-400">
                  Auto-ranked by equal play time
                </span>
              </div>

              <div className="border border-slate-200/80 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white max-h-[540px] overflow-y-auto">
                {queueMetrics.map((item) => {
                  const assignedCourt = generatedCourts.find(
                    (c) =>
                      c.teamAPlayer1.id === item.player.id ||
                      c.teamAPlayer2?.id === item.player.id ||
                      c.teamBPlayer1.id === item.player.id ||
                      c.teamBPlayer2?.id === item.player.id
                  );

                  return (
                    <div
                      key={item.player.id}
                      className={`px-3.5 py-2.5 text-xs flex items-center justify-between gap-2.5 ${
                        item.isPaused
                          ? 'bg-slate-50/80 opacity-60'
                          : assignedCourt
                          ? 'bg-emerald-50/35'
                          : 'bg-white'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-slate-400 w-5 shrink-0">
                            #{item.queueOrderRank}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 text-[10px] font-mono font-bold rounded border shrink-0 ${
                              TIER_BADGE_CLASS[item.player.tier]
                            }`}
                          >
                            {item.player.tier}
                          </span>
                          <span className="font-semibold text-slate-900 truncate">
                            {item.player.name}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500 pl-5">
                          <span className="font-mono tabular-nums font-semibold text-slate-700">
                            {item.sessionGamesPlayed}G played (~
                            {item.estimatedCourtMinutes}m)
                          </span>
                          <span>·</span>
                          <span>
                            {item.sessionGamesPlayed === 0
                              ? 'Awaiting 1st game'
                              : item.justPlayedLastMatch
                              ? 'Just played last game'
                              : `Waited ${item.gamesSatOutConsecutively}G`}
                          </span>
                          {item.sessionPartners.length > 0 && (
                            <>
                              <span>·</span>
                              <span className="truncate max-w-44 text-slate-400">
                                w/{' '}
                                {item.sessionPartners
                                  .slice(0, 2)
                                  .map(
                                    (sp) =>
                                      `${sp.playerName.split(' ')[0]}${
                                        sp.count > 1 ? `(${sp.count})` : ''
                                      }`
                                  )
                                  .join(', ')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Clean Status Badge (No manual Active/Resting toggles needed) */}
                      <div className="shrink-0">
                        {item.isPaused ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleRestoreSkippedPlayer(item.player.id)
                            }
                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200 transition-colors cursor-pointer"
                            title="Click to restore to current draw"
                          >
                            Skipped · Undo
                          </button>
                        ) : assignedCourt ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-900">
                            {assignedCourt.courtLabel}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                            Next in Queue
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Strictly Admin-Only Score Entry Form */}
        {isAdmin && (
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200/80 p-5 sm:p-6">
            <form onSubmit={handleSubmitFinalScore} className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Log Match Score
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Pick players manually or click &ldquo;Load into Scorer&rdquo;
                    above
                  </p>
                </div>
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

              <StyledSelect
                label="Session"
                value={activeSessionForScore?.id || ''}
                onChange={(e) => handleSelectSessionFilter(e.target.value)}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sessionDate} · {s.title}
                  </option>
                ))}
              </StyledSelect>

              {/* Side A */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Side A
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <StyledSelect
                    value={teamA1Id}
                    onChange={(e) => setTeamA1Id(e.target.value)}
                  >
                    {rankedPlayers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.ratingScore})
                      </option>
                    ))}
                  </StyledSelect>
                  {matchFormat === 'doubles' && (
                    <StyledSelect
                      value={teamA2Id}
                      onChange={(e) => setTeamA2Id(e.target.value)}
                    >
                      {rankedPlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.ratingScore})
                        </option>
                      ))}
                    </StyledSelect>
                  )}
                </div>
              </div>

              {/* Side B */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Side B
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <StyledSelect
                    value={teamB1Id}
                    onChange={(e) => setTeamB1Id(e.target.value)}
                  >
                    {rankedPlayers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.ratingScore})
                      </option>
                    ))}
                  </StyledSelect>
                  {matchFormat === 'doubles' && (
                    <StyledSelect
                      value={teamB2Id}
                      onChange={(e) => setTeamB2Id(e.target.value)}
                    >
                      {rankedPlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.ratingScore})
                        </option>
                      ))}
                    </StyledSelect>
                  )}
                </div>
              </div>

              {/* Final Score Inputs */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <StyledInput
                  label="Side A Score"
                  type="number"
                  min={0}
                  max={500}
                  required
                  value={finalScoreA}
                  onChange={(e) => setFinalScoreA(e.target.value)}
                  className="font-mono tabular-nums font-bold text-sm"
                />
                <StyledInput
                  label="Side B Score"
                  type="number"
                  min={0}
                  max={500}
                  required
                  value={finalScoreB}
                  onChange={(e) => setFinalScoreB(e.target.value)}
                  className="font-mono tabular-nums font-bold text-sm"
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                {savedNotice ? (
                  <span className="text-xs font-medium text-emerald-700 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {savedNotice}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">
                    Updates standings &amp; rotates court queue
                  </span>
                )}
                <button
                  type="submit"
                  disabled={isSaving}
                  className="h-10 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  Save Result
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Completed Match Results Table / Responsive Scoreboard Cards */}
        <div
          className={`${
            isAdmin ? 'lg:col-span-7' : 'lg:col-span-12'
          } bg-white rounded-xl border border-slate-200/80 overflow-hidden`}
        >
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              Match Log ({filteredMatches.length})
            </h2>
            <span className="text-xs text-slate-400 truncate">
              {sessionFilter === 'all'
                ? 'All Sessions'
                : activeSessionForScore?.title || 'Selected Session'}
            </span>
          </div>

          {filteredMatches.length === 0 ? (
            <p className="text-xs text-slate-500 py-10 text-center">
              No matches recorded for this session filter.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredMatches.map((m) => {
                const matchSession = sessions.find((s) => s.id === m.sessionId);
                const sideANames =
                  m.matchFormat === 'doubles'
                    ? `${m.teamAPlayer1Name} & ${m.teamAPlayer2Name}`
                    : m.teamAPlayer1Name;
                const sideBNames =
                  m.matchFormat === 'doubles'
                    ? `${m.teamBPlayer1Name} & ${m.teamBPlayer2Name}`
                    : m.teamBPlayer1Name;

                const isUserInMatch =
                  activePlayer &&
                  (m.teamAPlayer1Id === activePlayer.id ||
                    m.teamAPlayer2Id === activePlayer.id ||
                    m.teamBPlayer1Id === activePlayer.id ||
                    m.teamBPlayer2Id === activePlayer.id);

                return (
                  <div
                    key={m.id}
                    className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/60"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        {matchSession && (
                          <>
                            <span className="font-mono tabular-nums">
                              {matchSession.sessionDate}
                            </span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span className="capitalize font-medium text-slate-500">
                          {m.matchFormat}
                        </span>
                        {isUserInMatch && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-emerald-700">
                              You Played
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2 text-xs">
                        <span
                          className={`truncate ${
                            m.winnerSide === 'A'
                              ? 'font-bold text-slate-900'
                              : 'text-slate-500'
                          }`}
                        >
                          {sideANames}
                        </span>
                        <span className="text-[11px] text-slate-400 hidden sm:inline">
                          vs
                        </span>
                        <span
                          className={`truncate ${
                            m.winnerSide === 'B'
                              ? 'font-bold text-slate-900'
                              : 'text-slate-500'
                          }`}
                        >
                          <span className="sm:hidden text-slate-400 font-normal mr-1">
                            vs
                          </span>
                          {sideBNames}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/70 font-mono tabular-nums font-bold text-slate-900 text-xs">
                        <span
                          className={
                            m.winnerSide === 'A'
                              ? 'text-slate-900'
                              : 'text-slate-400 font-medium'
                          }
                        >
                          {m.scoreTeamA}
                        </span>
                        <span className="mx-1 text-slate-300">–</span>
                        <span
                          className={
                            m.winnerSide === 'B'
                              ? 'text-slate-900'
                              : 'text-slate-400 font-medium'
                          }
                        >
                          {m.scoreTeamB}
                        </span>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => onDeleteMatch(m.id)}
                          className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          aria-label="Delete match"
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
      </div>
    </div>
  );
};
