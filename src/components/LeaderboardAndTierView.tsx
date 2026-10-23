import React, { useMemo, useState } from 'react';
import { ArrowDownUp, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BadmintonMatch,
  Player,
  RankedPlayer,
  Session,
} from '../types';
import {
  computeRating,
  formatMatchSideLabel,
  getPlayerSideInMatch,
  isPlayerInMatch,
  sortMatchesNewestFirst,
} from '../utils/badmintonLogic';
import { SegmentedControl, StyledInput } from './ui/FormControls';
import { backdropClose } from '../utils/backdropClose';

interface LeaderboardAndTierViewProps {
  rankedPlayers: RankedPlayer[];
  matches?: BadmintonMatch[];
  sessions?: Session[];
  activePlayer?: Player | null;
  activeClubName?: string;
  onOpenProfileView?: (playerId?: string) => void;
}

type OrderDirection = 'top_first' | 'bottom_first';
type StandingsFormatFilter = 'all' | 'doubles' | 'singles';

interface StandingsRowPlayer extends RankedPlayer {
  displayWins: number;
  displayLosses: number;
  displayGames: number;
  displayWinRate: number;
  displayPointDiff: number;
  displayRating: number;
}

export const LeaderboardAndTierView: React.FC<LeaderboardAndTierViewProps> = ({
  rankedPlayers,
  matches = [],
  sessions = [],
  activePlayer = null,
  activeClubName,
  onOpenProfileView,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [formatFilter, setFormatFilter] =
    useState<StandingsFormatFilter>('all');
  const [orderDirection, setOrderDirection] =
    useState<OrderDirection>('top_first');
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);

  // Compute canonical #1 (top) to #N (bottom) standings for the selected format ('all' | 'doubles' | 'singles')
  const orderedTopToBottom = useMemo<StandingsRowPlayer[]>(() => {
    const rows: StandingsRowPlayer[] = rankedPlayers.map((p) => {
      if (formatFilter === 'all') {
        const wins = (p.singlesWins || 0) + (p.doublesWins || 0);
        const losses = (p.singlesLosses || 0) + (p.doublesLosses || 0);
        const games = wins + losses;
        const winRate = games > 0 ? (wins / games) * 100 : 0;
        return {
          ...p,
          displayWins: wins,
          displayLosses: losses,
          displayGames: games,
          displayWinRate: winRate,
          displayPointDiff: p.pointDiff,
          displayRating: p.ratingScore,
        };
      }

      const isDoubles = formatFilter === 'doubles';
      const wins = isDoubles ? p.doublesWins || 0 : p.singlesWins || 0;
      const losses = isDoubles ? p.doublesLosses || 0 : p.singlesLosses || 0;
      const games = wins + losses;
      const winRate = games > 0 ? (wins / games) * 100 : 0;

      const recordedPtsFor = isDoubles
        ? p.doublesPointsScored ?? 0
        : p.singlesPointsScored ?? 0;
      const recordedPtsAgainst = isDoubles
        ? p.doublesPointsConceded ?? 0
        : p.singlesPointsConceded ?? 0;

      const pointDiff = recordedPtsFor - recordedPtsAgainst;
      const formatRating = computeRating({
        wins,
        losses,
        pointsScored: recordedPtsFor,
        pointsConceded: recordedPtsAgainst,
      });

      return {
        ...p,
        displayWins: wins,
        displayLosses: losses,
        displayGames: games,
        displayWinRate: winRate,
        displayPointDiff: pointDiff,
        displayRating: formatRating,
      };
    });

    rows.sort((a, b) => {
      if (formatFilter !== 'all') {
        if (b.displayRating !== a.displayRating) {
          return b.displayRating - a.displayRating;
        }
        if (b.displayWins !== a.displayWins) {
          return b.displayWins - a.displayWins;
        }
        if (b.displayWinRate !== a.displayWinRate) {
          return b.displayWinRate - a.displayWinRate;
        }
        if (b.displayPointDiff !== a.displayPointDiff) {
          return b.displayPointDiff - a.displayPointDiff;
        }
        return a.name.localeCompare(b.name);
      }
      return a.rank - b.rank;
    });

    return rows.map((row, idx) => ({
      ...row,
      rank: idx + 1,
    }));
  }, [rankedPlayers, formatFilter]);

  const totalPlayers = orderedTopToBottom.length;

  const topPlayers = useMemo(
    () => orderedTopToBottom.slice(0, 3),
    [orderedTopToBottom]
  );

  // Bottom 3 players in standing sequence
  const bottomPlayers = useMemo(() => {
    if (totalPlayers < 4) return [];
    const count = Math.min(3, totalPlayers - 3);
    return orderedTopToBottom.slice(totalPlayers - count);
  }, [orderedTopToBottom, totalPlayers]);

  const myRankedProfile = useMemo(
    () =>
      activePlayer
        ? orderedTopToBottom.find((p) => p.id === activePlayer.id) || null
        : null,
    [orderedTopToBottom, activePlayer]
  );

  const displayedPlayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = orderedTopToBottom.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.playerTag.toLowerCase().includes(q)
      );
    });

    if (orderDirection === 'bottom_first') {
      return [...filtered].reverse();
    }
    return filtered;
  }, [orderedTopToBottom, searchQuery, orderDirection]);

  const getPlayerRecentMatches = (playerId: string) => {
    return sortMatchesNewestFirst(
      matches.filter((m) => {
        if (!isPlayerInMatch(m, playerId)) return false;
        if (formatFilter !== 'all' && m.matchFormat !== formatFilter) {
          return false;
        }
        return true;
      }),
      sessions
    ).slice(0, 5);
  };

  const getPositionLabel = (rank: number): string | null => {
    if (totalPlayers < 4) {
      if (rank === 1) return 'Top';
      if (rank === totalPlayers && totalPlayers > 1) return 'Bottom';
      return null;
    }
    if (rank === 1) return '1st · Top';
    if (rank === 2) return '2nd · Top 3';
    if (rank === 3) return '3rd · Top 3';
    if (rank === totalPlayers) return 'Last · Bottom';
    if (totalPlayers >= 6 && rank >= totalPlayers - 2) return 'Bottom 3';
    return null;
  };

  const formatLabel =
    formatFilter === 'all'
      ? 'Overall (Singles & Doubles)'
      : formatFilter === 'doubles'
      ? 'Doubles Only'
      : 'Singles Only';

  return (
    <div className="space-y-5">
      {/* Clean Header with Page-Wide Format Switcher & Your Standing */}
      <div className="flex flex-col gap-3.5 pb-4 border-b border-slate-200/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display">
              {activeClubName ? `${activeClubName} · Standings` : 'Club Standings'}
            </h1>
            <p className="text-xs text-slate-600 mt-0.5">
              {totalPlayers} {totalPlayers === 1 ? 'player' : 'players'} ranked
              from #1 at the top to #{totalPlayers || 1} at the bottom ·{' '}
              <span className="font-medium text-slate-800">{formatLabel}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <SegmentedControl
              size="sm"
              options={[
                { value: 'all', label: 'All Matches' },
                { value: 'doubles', label: 'Doubles' },
                { value: 'singles', label: 'Singles' },
              ]}
              value={formatFilter}
              onChange={setFormatFilter}
            />
          </div>
        </div>

        {myRankedProfile && (
          <div className="flex items-center justify-between gap-3 bg-white border border-slate-200/90 rounded-xl px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-600 font-medium">Your Club Standing:</span>
              <span className="font-mono tabular-nums font-bold text-emerald-700">
                #{myRankedProfile.rank} of {totalPlayers}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="font-mono tabular-nums font-bold text-slate-900">
                {myRankedProfile.displayRating} pts
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="font-mono tabular-nums text-slate-600">
                {myRankedProfile.displayWins}W–{myRankedProfile.displayLosses}L (
                {myRankedProfile.displayWinRate.toFixed(0)}%) · D:{' '}
                {myRankedProfile.doublesWins}–{myRankedProfile.doublesLosses} · S:{' '}
                {myRankedProfile.singlesWins}–{myRankedProfile.singlesLosses}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setExpandedPlayerId(myRankedProfile.id)}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 whitespace-nowrap cursor-pointer shrink-0"
            >
              Details →
            </button>
          </div>
        )}
      </div>

      {/* Top vs. Bottom At-a-Glance Comparison */}
      {!searchQuery.trim() && totalPlayers >= 4 && (
        <section
          aria-label="Top and Bottom Standings Snapshot"
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {/* Top of the Table */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h2 className="text-xs font-bold text-slate-900 tracking-tight">
                Top of the Table
              </h2>
              <span className="text-[11px] text-emerald-700 font-medium font-mono tabular-nums">
                #1 – #{topPlayers.length}
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {topPlayers.map((p) => {
                const isSelf = activePlayer?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setExpandedPlayerId(p.id)}
                    className="w-full py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 transition-colors rounded-lg px-1.5 -mx-1.5 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-7 text-xs font-mono tabular-nums font-bold text-emerald-700 shrink-0">
                        #{p.rank}
                      </span>
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-900 truncate block">
                          {p.name}
                          {isSelf && (
                            <span className="ml-1.5 text-[11px] font-semibold text-emerald-700">
                              · You
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums text-xs">
                      <span className="text-slate-600">
                        {p.displayWins}W–{p.displayLosses}L
                      </span>
                      <span className="font-bold text-slate-900 w-10 text-right">
                        {p.displayRating}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom of the Table */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h2 className="text-xs font-bold text-slate-900 tracking-tight">
                Bottom of the Table
              </h2>
              <span className="text-[11px] text-slate-600 font-medium font-mono tabular-nums">
                #{bottomPlayers[0]?.rank} – #
                {bottomPlayers[bottomPlayers.length - 1]?.rank}
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {bottomPlayers.map((p) => {
                const isSelf = activePlayer?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setExpandedPlayerId(p.id)}
                    className="w-full py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 transition-colors rounded-lg px-1.5 -mx-1.5 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-7 text-xs font-mono tabular-nums font-semibold text-slate-500 shrink-0">
                        #{p.rank}
                      </span>
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-900 truncate block">
                          {p.name}
                          {isSelf && (
                            <span className="ml-1.5 text-[11px] font-semibold text-emerald-700">
                              · You
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums text-xs">
                      <span className="text-slate-600">
                        {p.displayWins}W–{p.displayLosses}L
                      </span>
                      <span className="font-bold text-slate-900 w-10 text-right">
                        {p.displayRating}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Full Standings Table Section */}
      <section aria-label="Full Standings List" className="space-y-3">
        {/* Search & Top/Bottom Order Controls (single toggle row without overlapping double toggles) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="w-full sm:w-72">
            <StyledInput
              icon={<Search className="w-4 h-4" />}
              placeholder="Search player name or #tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 text-xs"
            />
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2">
            <span className="text-xs font-medium text-slate-600 inline-flex items-center gap-1">
              <ArrowDownUp className="w-3.5 h-3.5 text-slate-500" />
              <span>Order:</span>
            </span>
            <SegmentedControl
              size="sm"
              options={[
                { value: 'top_first', label: 'Top First (#1 ↓)' },
                {
                  value: 'bottom_first',
                  label: `Bottom First (#${totalPlayers || 1} ↑)`,
                },
              ]}
              value={orderDirection}
              onChange={setOrderDirection}
            />
          </div>
        </div>

        {displayedPlayers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/90 p-10 text-center">
            <p className="text-xs font-medium text-slate-600">
              No players match your search.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden">
            {/* Desktop & Tablet Table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-slate-50/60 text-[11px] font-semibold text-slate-600">
                    <th className="py-3 px-4 w-36">Rank</th>
                    <th className="py-3 px-4">Player</th>
                    <th className="py-3 px-4 text-right">
                      {formatFilter === 'all'
                        ? 'Record (W–L)'
                        : formatFilter === 'doubles'
                        ? 'Doubles (W–L)'
                        : 'Singles (W–L)'}
                    </th>
                    {formatFilter === 'all' && (
                      <th className="py-3 px-4 text-right">
                        Singles / Doubles
                      </th>
                    )}
                    <th className="py-3 px-4 text-right">Win %</th>
                    <th className="py-3 px-4 text-right">Pt Diff</th>
                    <th className="py-3 px-4 text-right">Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {displayedPlayers.map((p) => {
                    const isSelf = activePlayer?.id === p.id;
                    const isTopThree = p.rank <= 3;
                    const isBottomThree =
                      totalPlayers >= 6
                        ? p.rank >= totalPlayers - 2
                        : totalPlayers >= 2 && p.rank === totalPlayers;
                    const posLabel = getPositionLabel(p.rank);

                    return (
                      <tr
                        key={p.id}
                        onClick={() => setExpandedPlayerId(p.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelf
                            ? 'bg-emerald-50/40 hover:bg-emerald-50/70'
                            : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={`font-bold ${
                              isTopThree
                                ? 'text-emerald-700'
                                : isBottomThree
                                ? 'text-slate-500'
                                : 'text-slate-800'
                            }`}
                          >
                            #{p.rank}
                          </span>
                          {posLabel && (
                            <span
                              className={`ml-2 font-sans text-[11px] ${
                                isTopThree
                                  ? 'font-semibold text-emerald-700'
                                  : 'font-medium text-slate-500'
                              }`}
                            >
                              {posLabel}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-900">
                            {p.name}
                          </span>
                          <span className="text-slate-500 font-mono ml-1.5">
                            {p.playerTag}
                          </span>
                          {isSelf && (
                            <span className="ml-1.5 text-[11px] font-semibold text-emerald-700">
                              · You
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          <span className="font-medium">
                            {p.displayWins}W–{p.displayLosses}L
                          </span>{' '}
                          <span className="text-[11px] text-slate-400">
                            ({p.displayGames}g)
                          </span>
                        </td>

                        {formatFilter === 'all' && (
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-[11px] text-slate-600 whitespace-nowrap">
                            <span>
                              S {p.singlesWins}–{p.singlesLosses}
                            </span>
                            <span aria-hidden="true" className="mx-1.5 text-slate-300">
                              ·
                            </span>
                            <span>
                              D {p.doublesWins}–{p.doublesLosses}
                            </span>
                          </td>
                        )}

                        <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-800 whitespace-nowrap">
                          {p.displayWinRate.toFixed(0)}%
                        </td>

                        <td
                          className={`py-3 px-4 text-right font-mono tabular-nums font-medium whitespace-nowrap ${
                            p.displayPointDiff > 0
                              ? 'text-emerald-700'
                              : p.displayPointDiff < 0
                              ? 'text-rose-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {p.displayPointDiff > 0
                            ? `+${p.displayPointDiff}`
                            : p.displayPointDiff}
                        </td>

                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                          {p.displayRating}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Compact List (< sm) */}
            <div className="sm:hidden divide-y divide-slate-100">
              {displayedPlayers.map((p) => {
                const isSelf = activePlayer?.id === p.id;
                const isTopThree = p.rank <= 3;
                const posLabel = getPositionLabel(p.rank);

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setExpandedPlayerId(p.id)}
                    className={`w-full px-4 py-3 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      isSelf ? 'bg-emerald-50/40' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-8 text-xs font-mono tabular-nums font-bold shrink-0 ${
                          isTopThree ? 'text-emerald-700' : 'text-slate-700'
                        }`}
                      >
                        #{p.rank}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {p.name}
                          </span>
                          {isSelf && (
                            <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                              · You
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 mt-0.5 font-mono tabular-nums">
                          {posLabel && (
                            <>
                              <span
                                className={`font-sans ${
                                  isTopThree
                                    ? 'font-semibold text-emerald-700'
                                    : 'text-slate-500'
                                }`}
                              >
                                {posLabel}
                              </span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          <span>
                            {p.displayWins}W–{p.displayLosses}L (
                            {p.displayWinRate.toFixed(0)}%)
                          </span>
                          {formatFilter === 'all' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-slate-500">
                                S {p.singlesWins}–{p.singlesLosses} / D{' '}
                                {p.doublesWins}–{p.doublesLosses}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <span className="text-sm font-bold text-slate-900 block leading-tight">
                        {p.displayRating}
                      </span>
                      <span
                        className={`text-[11px] ${
                          p.displayPointDiff > 0
                            ? 'text-emerald-700'
                            : p.displayPointDiff < 0
                            ? 'text-rose-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {p.displayPointDiff > 0
                          ? `+${p.displayPointDiff}`
                          : p.displayPointDiff}{' '}
                        diff
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Player Match Breakdown Modal */}
      <AnimatePresence>
        {expandedPlayerId &&
          (() => {
            const p = orderedTopToBottom.find(
              (item) => item.id === expandedPlayerId
            );
            if (!p) return null;
            const recentMatches = getPlayerRecentMatches(p.id);
            const singlesTotal = (p.singlesWins || 0) + (p.singlesLosses || 0);
            const singlesWinPct =
              singlesTotal > 0
                ? Math.round(((p.singlesWins || 0) / singlesTotal) * 100)
                : 0;
            const doublesTotal = (p.doublesWins || 0) + (p.doublesLosses || 0);
            const doublesWinPct =
              doublesTotal > 0
                ? Math.round(((p.doublesWins || 0) / doublesTotal) * 100)
                : 0;

            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
                {...backdropClose(() => setExpandedPlayerId(null))}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-xl w-full max-h-[88vh] flex flex-col overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono tabular-nums font-bold text-emerald-700">
                          Rank #{p.rank} of {totalPlayers}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <h3 className="text-base font-bold text-slate-900">
                          {p.name}
                        </h3>
                        <span className="text-xs font-mono text-slate-500">
                          {p.playerTag}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5 font-mono tabular-nums">
                        Rating {p.displayRating} · {p.displayWins}W–
                        {p.displayLosses}L ({p.displayWinRate.toFixed(0)}%)
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedPlayerId(null)}
                      className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-5 overflow-y-auto flex-1 space-y-4">
                    <div className="grid grid-cols-3 gap-3 bg-slate-50 rounded-xl border border-slate-200/80 p-3.5 font-mono tabular-nums">
                      <div>
                        <span className="text-[11px] font-sans font-medium text-slate-600 block">
                          Overall ({p.gamesPlayed}g)
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {p.wins}W–{p.losses}L ({p.winRate.toFixed(0)}%)
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] font-sans font-medium text-slate-600 block">
                          Singles ({singlesTotal}g)
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {p.singlesWins}W–{p.singlesLosses}L ({singlesWinPct}%)
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] font-sans font-medium text-slate-600 block">
                          Doubles ({doublesTotal}g)
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {p.doublesWins}W–{p.doublesLosses}L ({doublesWinPct}%)
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-xs font-bold text-slate-800 block">
                        Recent Matches ({recentMatches.length})
                      </span>

                      {recentMatches.length === 0 ? (
                        <p className="text-xs text-slate-600 py-4 text-center border border-slate-200/70 rounded-xl">
                          No recorded matches for {p.name} yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden">
                          {recentMatches.map((m) => {
                            const side = getPlayerSideInMatch(m, p.id);
                            const inA = side === 'A';
                            const won =
                              (inA && m.winnerSide === 'A') ||
                              (!inA && m.winnerSide === 'B');
                            const sideA = formatMatchSideLabel(m, 'A');
                            const sideB = formatMatchSideLabel(m, 'B');
                            const matchSession = sessions.find(
                              (s) => s.id === m.sessionId
                            );
                            return (
                              <div
                                key={m.id}
                                className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs bg-white"
                              >
                                <div className="min-w-0 truncate">
                                  <span
                                    className={`font-semibold ${
                                      won ? 'text-emerald-700' : 'text-slate-600'
                                    }`}
                                  >
                                    {won ? 'Won' : 'Lost'}
                                  </span>
                                  <span
                                    aria-hidden="true"
                                    className="mx-1.5 text-slate-300"
                                  >
                                    ·
                                  </span>
                                  <span className="text-slate-500 capitalize">
                                    {m.matchFormat}
                                  </span>
                                  <span
                                    aria-hidden="true"
                                    className="mx-1.5 text-slate-300"
                                  >
                                    ·
                                  </span>
                                  <span className="text-slate-800">
                                    {sideA} vs {sideB}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                                  {matchSession && (
                                    <span className="text-[11px] text-slate-600">
                                      {matchSession.sessionDate}
                                    </span>
                                  )}
                                  <span className="font-bold text-slate-900">
                                    {m.scoreTeamA}–{m.scoreTeamB}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                    {onOpenProfileView ? (
                      <button
                        type="button"
                        onClick={() => {
                          const targetId = p.id;
                          setExpandedPlayerId(null);
                          onOpenProfileView(targetId);
                        }}
                        className="h-9 px-3.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-semibold cursor-pointer"
                      >
                        View Full Profile
                      </button>
                    ) : (
                      <div />
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedPlayerId(null)}
                      className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            );
          })()}
      </AnimatePresence>
    </div>
  );
};
