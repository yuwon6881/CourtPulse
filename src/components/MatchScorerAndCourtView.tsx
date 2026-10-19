import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Minus,
  Plus,
  Swords,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BadmintonMatch,
  MatchFormat,
  Player,
  RankedPlayer,
  Session,
} from '../types';
import {
  computePlayerLeaderboardAndTiers,
  getSessionDateDisplay,
} from '../utils/badmintonLogic';
import {
  ConfirmModal,
  SegmentedControl,
  StyledInput,
  StyledSelect,
} from './ui/FormControls';

interface MatchScorerAndCourtViewProps {
  sessions: Session[];
  selectedSessionId: string;
  onSelectSession: (id: string) => void;
  players: (Player | RankedPlayer)[];
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
  onOpenProfileView?: (playerId?: string) => void;
}

export const MatchScorerAndCourtView: React.FC<MatchScorerAndCourtViewProps> = ({
  sessions,
  selectedSessionId,
  onSelectSession,
  players,
  matches,
  activePlayer,
  isAdmin,
  onRecordMatch,
  onDeleteMatch,
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
  const [matchFilter, setMatchFilter] = useState<'all' | 'mine'>('all');
  const [sessionFilter, setSessionFilter] = useState<string>(
    selectedSessionId || sessions[0]?.id || 'all'
  );
  const [pendingDeleteMatch, setPendingDeleteMatch] =
    useState<BadmintonMatch | null>(null);

  const activeSessionForScore =
    sessions.find(
      (s) =>
        s.id === (sessionFilter !== 'all' ? sessionFilter : selectedSessionId)
    ) ||
    sessions[0] ||
    null;

  const rankedPlayers = useMemo<RankedPlayer[]>(() => {
    const first = players[0] as RankedPlayer | undefined;
    if (
      first &&
      typeof first.tier === 'string' &&
      typeof first.rank === 'number'
    ) {
      return players as RankedPlayer[];
    }
    return computePlayerLeaderboardAndTiers(players, matches);
  }, [players, matches]);

  const handleSelectSessionFilter = (val: string) => {
    setSessionFilter(val);
    if (val !== 'all') {
      onSelectSession(val);
    }
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

  const handleSwapSides = () => {
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

  const adjustScore = (side: 'A' | 'B', delta: number) => {
    if (side === 'A') {
      const cur = parseInt(finalScoreA, 10) || 0;
      setFinalScoreA(String(Math.max(0, Math.min(500, cur + delta))));
    } else {
      const cur = parseInt(finalScoreB, 10) || 0;
      setFinalScoreB(String(Math.max(0, Math.min(500, cur + delta))));
    }
  };

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
      setSavedNotice(`Saved ${parsedA}–${parsedB} · Standings updated`);
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

  const numScoreA = parseInt(finalScoreA, 10) || 0;
  const numScoreB = parseInt(finalScoreB, 10) || 0;

  return (
    <div className="space-y-6">
      {/* Clean Page Header & Session Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 pb-4 border-b border-slate-200/80">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Matches &amp; Live Court Scorer
        </h1>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-full sm:w-72">
            <StyledSelect
              aria-label="Filter matches by session"
              value={sessionFilter}
              onChange={(e) => handleSelectSessionFilter(e.target.value)}
              className="h-9 text-xs"
            >
              <option value="all">All Sessions ({matches.length})</option>
              {sessions.map((s) => {
                const d = getSessionDateDisplay(s.sessionDate);
                return (
                  <option key={s.id} value={s.id}>
                    {d.compactLabel} · {s.title} ({s.courtNumbers})
                  </option>
                );
              })}
            </StyledSelect>
          </div>

          <SegmentedControl
            size="sm"
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Admin / Club Owner Score Entry Form */}
        {isAdmin && (
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-2xs">
            <form onSubmit={handleSubmitFinalScore} className="space-y-4">
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Swords className="w-4 h-4 text-emerald-600" />
                  <span>Log Match Score</span>
                </h2>
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
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-800">
                    Side A {numScoreA > numScoreB ? '· Leading' : ''}
                  </label>
                  <button
                    type="button"
                    onClick={handleSwapSides}
                    className="h-7 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300/90 text-[11px] font-semibold text-slate-700 hover:text-slate-950 shadow-2xs inline-flex items-center gap-1.5 transition-all cursor-pointer active:scale-[0.98]"
                    title="Swap Side A and Side B players & scores"
                  >
                    <ArrowLeftRight className="w-3 h-3 text-slate-600" />
                    <span>Swap Sides</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <StyledSelect
                    value={teamA1?.id || ''}
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
                      value={teamA2?.id || ''}
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
                <label className="block text-xs font-semibold text-slate-800">
                  Side B {numScoreB > numScoreA ? '· Leading' : ''}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <StyledSelect
                    value={teamB1?.id || ''}
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
                      value={teamB2?.id || ''}
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

              {/* Final Score Inputs with +/- Steppers */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div className="space-y-1.5">
                  <StyledInput
                    label="Side A Points"
                    type="number"
                    min={0}
                    max={500}
                    required
                    value={finalScoreA}
                    onChange={(e) => setFinalScoreA(e.target.value)}
                    className="font-mono tabular-nums font-bold text-base text-center"
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => adjustScore('A', -1)}
                      className="h-8 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold shadow-2xs inline-flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-[0.98]"
                    >
                      <Minus className="w-3 h-3" />
                      <span>1</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustScore('A', 1)}
                      className="h-8 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold shadow-2xs inline-flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-[0.98]"
                    >
                      <Plus className="w-3 h-3" />
                      <span>1</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <StyledInput
                    label="Side B Points"
                    type="number"
                    min={0}
                    max={500}
                    required
                    value={finalScoreB}
                    onChange={(e) => setFinalScoreB(e.target.value)}
                    className="font-mono tabular-nums font-bold text-base text-center"
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => adjustScore('B', -1)}
                      className="h-8 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold shadow-2xs inline-flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-[0.98]"
                    >
                      <Minus className="w-3 h-3" />
                      <span>1</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustScore('B', 1)}
                      className="h-8 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold shadow-2xs inline-flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-[0.98]"
                    >
                      <Plus className="w-3 h-3" />
                      <span>1</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
                {savedNotice ? (
                  <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {savedNotice}
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={isSaving}
                  className="h-10 px-5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-2xs rounded-xl transition-all whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Save Match Result
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Completed Match Results List */}
        <div
          className={`${
            isAdmin ? 'lg:col-span-7' : 'lg:col-span-12'
          } bg-white rounded-2xl border border-slate-200/90 overflow-hidden`}
        >
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              Recorded Match Log ({filteredMatches.length})
            </h2>
            <span className="text-xs text-slate-500 truncate">
              {sessionFilter === 'all'
                ? 'All Sessions'
                : activeSessionForScore?.title || 'Selected Session'}
            </span>
          </div>

          {filteredMatches.length === 0 ? (
            <p className="text-xs text-slate-500 py-12 text-center">
              No matches recorded for this filter.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              <AnimatePresence initial={false}>
                {filteredMatches.map((m) => {
                  const matchSession = sessions.find(
                    (s) => s.id === m.sessionId
                  );
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
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.14 }}
                      className="px-5 py-3.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                          {matchSession && (
                            <>
                              <span className="font-mono tabular-nums text-slate-600 font-medium">
                                {matchSession.sessionDate}
                              </span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          <span className="capitalize font-semibold text-slate-700">
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
                            className={`break-words sm:truncate ${
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
                          <span className="text-[11px] text-slate-500 font-medium hidden sm:inline">
                            vs
                          </span>
                          <span
                            className={`break-words sm:truncate ${
                              m.winnerSide === 'B'
                                ? 'font-bold text-slate-900'
                                : 'text-slate-600 font-medium'
                            }`}
                          >
                            <span className="sm:hidden text-slate-500 font-normal mr-1">
                              vs
                            </span>
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
                        <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/90 font-mono tabular-nums font-bold text-slate-900 text-xs whitespace-nowrap">
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

                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteMatch(m)}
                            className="h-8 w-8 flex items-center justify-center text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            aria-label="Delete match"
                            title="Delete match"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal: Delete Recorded Match */}
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
    </div>
  );
};
