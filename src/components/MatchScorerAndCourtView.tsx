import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Trash2,
  User,
} from 'lucide-react';
import {
  BadmintonMatch,
  MatchFormat,
  Player,
  RankedPlayer,
  Session,
} from '../types';
import {
  computePlayerLeaderboardAndTiers,
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

  return (
    <div className="space-y-6">
      {/* Clean Page Header & Session Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 pb-4 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Matches &amp; Score Log
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Record singles and doubles match scores and review session results.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-full sm:w-72">
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
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200/80 p-5 sm:p-6">
            <form onSubmit={handleSubmitFinalScore} className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Log Match Score
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Select players and enter final game points
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
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    {savedNotice}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">
                    Automatically updates player ratings &amp; standings
                  </span>
                )}
                <button
                  type="submit"
                  disabled={isSaving}
                  className="h-10 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Save Result
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Completed Match Results List */}
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
              No matches recorded for this filter.
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
                      <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/70 font-mono tabular-nums font-bold text-slate-900 text-xs whitespace-nowrap">
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
                      {onOpenProfileView && (
                        <button
                          type="button"
                          onClick={() => onOpenProfileView(m.teamAPlayer1Id)}
                          className="hidden sm:inline-flex h-8 w-8 items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                          title={`Inspect ${m.teamAPlayer1Name}`}
                        >
                          <User className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => onDeleteMatch(m.id)}
                          className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
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
