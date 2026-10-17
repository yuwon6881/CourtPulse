import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Award,
  ChevronDown,
  ChevronUp,
  Search,
  Swords,
  TrendingUp,
  User,
} from 'lucide-react';
import { BadmintonMatch, Player, RankedPlayer, Session, TierRank } from '../types';
import { SegmentedControl, StyledInput, StyledSelect } from './ui/FormControls';

interface LeaderboardAndTierViewProps {
  rankedPlayers: RankedPlayer[];
  matches?: BadmintonMatch[];
  sessions?: Session[];
  activePlayer?: Player | null;
  onOpenMatchesView?: () => void;
  onOpenProfileView?: (playerId?: string) => void;
}

type SortField = 'rating' | 'winRate' | 'pointDiff' | 'games';

const TIERS: {
  tier: TierRank;
  name: string;
  desc: string;
  minRating: string;
  badgeBg: string;
  accentBar: string;
}[] = [
  {
    tier: 'S',
    name: 'Court Apex',
    desc: 'Elite club seeds',
    minRating: '≥ 1400',
    badgeBg: 'bg-slate-900 text-white',
    accentBar: 'bg-slate-900',
  },
  {
    tier: 'A',
    name: 'Smash Vanguard',
    desc: 'Upper division',
    minRating: '1290–1399',
    badgeBg: 'bg-emerald-800 text-white',
    accentBar: 'bg-emerald-600',
  },
  {
    tier: 'B',
    name: 'Rally Tactician',
    desc: 'Core rotation',
    minRating: '1160–1289',
    badgeBg: 'bg-slate-700 text-white',
    accentBar: 'bg-slate-500',
  },
  {
    tier: 'C',
    name: 'Rising Shuttle',
    desc: 'Developing challengers',
    minRating: '< 1160',
    badgeBg: 'bg-slate-200 text-slate-800',
    accentBar: 'bg-slate-300',
  },
];

export const LeaderboardAndTierView: React.FC<LeaderboardAndTierViewProps> = ({
  rankedPlayers,
  matches = [],
  sessions = [],
  activePlayer = null,
  onOpenMatchesView,
  onOpenProfileView,
}) => {
  const [filterTier, setFilterTier] = useState<'ALL' | TierRank>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortField>('rating');
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);

  const displayedPlayers = useMemo(() => {
    const filtered = rankedPlayers.filter((p) => {
      const matchesTier = filterTier === 'ALL' ? true : p.tier === filterTier;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.playerTag.toLowerCase().includes(q) ||
        p.tierTitle.toLowerCase().includes(q);
      return matchesTier && matchesSearch;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'winRate') {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return b.ratingScore - a.ratingScore;
      }
      if (sortBy === 'pointDiff') {
        if (b.avgPointDiff !== a.avgPointDiff)
          return b.avgPointDiff - a.avgPointDiff;
        return b.ratingScore - a.ratingScore;
      }
      if (sortBy === 'games') {
        if (b.gamesPlayed !== a.gamesPlayed)
          return b.gamesPlayed - a.gamesPlayed;
        return b.ratingScore - a.ratingScore;
      }
      return a.rank - b.rank;
    });
  }, [rankedPlayers, filterTier, searchQuery, sortBy]);

  const topThreePlayers = useMemo(
    () => rankedPlayers.slice(0, 3),
    [rankedPlayers]
  );

  const myRankedProfile = useMemo(
    () =>
      activePlayer
        ? rankedPlayers.find((p) => p.id === activePlayer.id) || null
        : null,
    [rankedPlayers, activePlayer]
  );

  const getPlayerRecentMatches = (playerId: string) => {
    return matches
      .filter(
        (m) =>
          m.teamAPlayer1Id === playerId ||
          m.teamAPlayer2Id === playerId ||
          m.teamBPlayer1Id === playerId ||
          m.teamBPlayer2Id === playerId
      )
      .slice(0, 4);
  };

  return (
    <div className="space-y-6">
      {/* Competitive Hub Sub-Navigation & Page Header */}
      <div className="flex flex-col gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Standings &amp; Tiers
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Club rankings calibrated by match rating, win percentage, and per-game point differential.
            </p>
          </div>

          {/* Seamless Competitive View Switcher (Standings <-> Matches <-> My Profile) */}
          {(onOpenMatchesView || onOpenProfileView) && (
            <div className="flex items-center gap-2 self-start sm:self-auto overflow-x-auto max-w-full">
              <div className="inline-flex items-center bg-slate-100/90 p-1 rounded-lg border border-slate-200/70">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-white text-slate-900 shadow-2xs ring-1 ring-slate-900/5 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Award className="w-3.5 h-3.5 text-slate-700" />
                  <span>Standings</span>
                </button>
                {onOpenMatchesView && (
                  <button
                    type="button"
                    onClick={onOpenMatchesView}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md text-slate-500 hover:text-slate-900 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
                  >
                    <Swords className="w-3.5 h-3.5" />
                    <span>Matches &amp; Scorer</span>
                    {matches.length > 0 && (
                      <span className="font-mono text-[11px] tabular-nums text-slate-400">
                        {matches.length}
                      </span>
                    )}
                  </button>
                )}
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

        {/* Search, Sort & Tier Filter Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
            <div className="w-full sm:w-64">
              <StyledInput
                icon={<Search className="w-4 h-4" />}
                placeholder="Search player or #tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="w-full sm:w-48">
              <StyledSelect
                aria-label="Sort standings by metric"
                icon={<ArrowUpDown className="w-3.5 h-3.5" />}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortField)}
                className="h-9 text-xs"
              >
                <option value="rating">Sort: Rating (Default)</option>
                <option value="winRate">Sort: Win Percentage</option>
                <option value="pointDiff">Sort: Point Differential</option>
                <option value="games">Sort: Games Played</option>
              </StyledSelect>
            </div>
          </div>

          <div className="overflow-x-auto pb-0.5 sm:pb-0">
            <SegmentedControl
              size="sm"
              options={[
                { value: 'ALL', label: 'All Tiers', count: rankedPlayers.length },
                { value: 'S', label: 'Tier S' },
                { value: 'A', label: 'Tier A' },
                { value: 'B', label: 'Tier B' },
                { value: 'C', label: 'Tier C' },
              ]}
              value={filterTier}
              onChange={setFilterTier}
            />
          </div>
        </div>
      </div>

      {/* Personal Standing Callout Bar (Quick Self-Anchor) */}
      {myRankedProfile && (
        <div className="bg-white rounded-xl border border-slate-200/85 px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-slate-900 text-white font-display font-bold text-xs flex items-center justify-center shrink-0 font-mono tabular-nums">
              #{myRankedProfile.rank}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-bold text-slate-900 truncate">
                  {myRankedProfile.name}
                </span>
                <span className="font-mono text-slate-400">
                  {myRankedProfile.playerTag}
                </span>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="font-semibold text-emerald-700">
                  Your Club Standing
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Tier {myRankedProfile.tier} ({myRankedProfile.tierTitle}) ·{' '}
                <span className="font-mono tabular-nums font-medium text-slate-700">
                  {myRankedProfile.wins}W–{myRankedProfile.losses}L
                </span>{' '}
                overall
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-right font-mono tabular-nums">
            <div>
              <span className="text-[11px] font-sans text-slate-400 block">
                Rating
              </span>
              <span className="text-sm font-bold text-slate-900">
                {myRankedProfile.ratingScore}
              </span>
            </div>
            <div>
              <span className="text-[11px] font-sans text-slate-400 block">
                Win Rate
              </span>
              <span className="text-sm font-bold text-slate-900">
                {myRankedProfile.winRate.toFixed(0)}%
              </span>
            </div>
            <div>
              <span className="text-[11px] font-sans text-slate-400 block">
                Avg Diff
              </span>
              <span
                className={`text-sm font-bold ${
                  myRankedProfile.avgPointDiff >= 0
                    ? 'text-emerald-700'
                    : 'text-slate-600'
                }`}
              >
                {myRankedProfile.avgPointDiff >= 0
                  ? `+${myRankedProfile.avgPointDiff.toFixed(1)}`
                  : myRankedProfile.avgPointDiff.toFixed(1)}
              </span>
            </div>
            {onOpenProfileView && (
              <button
                type="button"
                onClick={() => onOpenProfileView(myRankedProfile.id)}
                className="h-8 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-sans text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
              >
                <User className="w-3.5 h-3.5" />
                <span>My Profile &amp; History</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Interactive 4-Column Tier Distribution Grid */}
      <section aria-label="Club Tier Distribution" className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight">
            Tier Divisions
          </h2>
          <span className="text-[11px] text-slate-400">
            Click a division card to filter standings
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {TIERS.map((t) => {
            const members = rankedPlayers.filter((p) => p.tier === t.tier);
            const isSelected = filterTier === t.tier;
            const sharePct =
              rankedPlayers.length > 0
                ? Math.round((members.length / rankedPlayers.length) * 100)
                : 0;

            return (
              <button
                key={t.tier}
                type="button"
                onClick={() =>
                  setFilterTier((prev) => (prev === t.tier ? 'ALL' : t.tier))
                }
                className={`text-left bg-white rounded-xl border p-4 transition-all flex flex-col justify-between gap-3.5 cursor-pointer ${
                  isSelected
                    ? 'border-slate-900 ring-2 ring-slate-900/5'
                    : 'border-slate-200/80 hover:border-slate-300'
                }`}
              >
                <div className="space-y-2.5 w-full">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-lg font-display font-bold text-xs flex items-center justify-center shrink-0 ${t.badgeBg}`}
                      >
                        {t.tier}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900">
                          {t.name}
                        </p>
                        <p className="text-[11px] font-mono tabular-nums text-slate-400">
                          Rating {t.minRating}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono tabular-nums font-semibold text-slate-500">
                      {members.length}p
                    </span>
                  </div>

                  {/* Subtle Population Bar */}
                  <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${t.accentBar}`}
                      style={{ width: `${Math.max(sharePct, members.length > 0 ? 12 : 0)}%` }}
                    />
                  </div>
                </div>

                {/* Ranked Roster Preview Inside Tier */}
                <div className="pt-2.5 border-t border-slate-100 w-full space-y-1.5">
                  {members.length === 0 ? (
                    <p className="text-[11px] text-slate-400">
                      No players in Tier {t.tier}
                    </p>
                  ) : (
                    members.slice(0, 3).map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-medium text-slate-800 truncate">
                          <span className="font-mono tabular-nums text-slate-400 mr-1.5">
                            #{m.rank}
                          </span>
                          {m.name}
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900 shrink-0">
                          {m.ratingScore}
                        </span>
                      </div>
                    ))
                  )}
                  {members.length > 3 && (
                    <p className="text-[11px] text-slate-400 font-medium pt-0.5">
                      +{members.length - 3} more in division
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Top 3 Club Podium Spotlight (Shown when viewing All Tiers & no search query) */}
      {filterTier === 'ALL' && !searchQuery.trim() && topThreePlayers.length >= 3 && (
        <section aria-label="Club Podium Leaders" className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-900 tracking-tight inline-flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-slate-500" />
              <span>Top 3 Club Podium</span>
            </h2>
            <span className="text-[11px] text-slate-400">
              Current season leaders
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {topThreePlayers.map((leader, idx) => {
              const isFirst = idx === 0;
              const isSelf = activePlayer?.id === leader.id;
              return (
                <div
                  key={leader.id}
                  onClick={() =>
                    setExpandedPlayerId((prev) =>
                      prev === leader.id ? null : leader.id
                    )
                  }
                  className={`bg-white rounded-xl border p-4 sm:p-5 transition-colors cursor-pointer flex flex-col justify-between gap-4 ${
                    isFirst
                      ? 'border-slate-300 shadow-2xs'
                      : 'border-slate-200/80 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`font-mono tabular-nums font-bold ${
                            isFirst ? 'text-slate-900' : 'text-slate-500'
                          }`}
                        >
                          #{leader.rank} Seed
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="text-slate-600 font-medium">
                          Tier {leader.tier} ({leader.tierTitle})
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 truncate">
                        {leader.name}
                        {isSelf && (
                          <span className="ml-1.5 text-xs font-medium text-emerald-700">
                            · You
                          </span>
                        )}
                      </h3>
                      <p className="text-[11px] font-mono text-slate-400">
                        {leader.playerTag}
                      </p>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <span className="text-xl font-bold text-slate-900 block leading-none">
                        {leader.ratingScore}
                      </span>
                      <span className="text-[11px] text-slate-400 font-sans mt-1 block">
                        Rating
                      </span>
                    </div>
                  </div>

                  {/* Win Rate Progress Bar + Split Metrics */}
                  <div className="space-y-2.5 pt-3 border-t border-slate-100">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">
                          Win Rate ({leader.wins}W–{leader.losses}L)
                        </span>
                        <span className="font-mono tabular-nums font-bold text-slate-900">
                          {leader.winRate.toFixed(0)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-slate-900 rounded-full"
                          style={{
                            width: `${Math.min(100, Math.max(4, leader.winRate))}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums pt-0.5">
                      <span>
                        Singles {leader.singlesWins}–{leader.singlesLosses}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Doubles {leader.doublesWins}–{leader.doublesLosses}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-semibold ${
                          leader.avgPointDiff >= 0
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {leader.avgPointDiff >= 0
                          ? `+${leader.avgPointDiff.toFixed(1)}`
                          : leader.avgPointDiff.toFixed(1)}{' '}
                        diff
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Standings Leaderboard — Desktop Table (md+) & Mobile Ergonomic Cards (< md) */}
      <section aria-label="Full Club Leaderboard" className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight">
            {filterTier === 'ALL'
              ? `All Ranked Players (${displayedPlayers.length})`
              : `Tier ${filterTier} Standings (${displayedPlayers.length})`}
          </h2>
          <span className="text-[11px] text-slate-400">
            Select any player to inspect match breakdown
          </span>
        </div>

        {displayedPlayers.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center space-y-2">
            <p className="text-xs font-medium text-slate-600">
              No players match your current filter.
            </p>
            {filterTier !== 'ALL' && (
              <button
                type="button"
                onClick={() => setFilterTier('ALL')}
                className="text-xs font-semibold text-slate-900 underline underline-offset-4"
              >
                Reset tier filter
              </button>
            )}
          </div>
        ) : (
          <>
            {/* DESKTOP TABLE (md and up) */}
            <div className="hidden md:block bg-white rounded-xl border border-slate-200/80 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-medium text-slate-400">
                    <th className="py-3 px-5">Rank</th>
                    <th className="py-3 px-5">Player</th>
                    <th className="py-3 px-5">Division</th>
                    <th className="py-3 px-5 text-right">Rating</th>
                    <th className="py-3 px-5 text-right">W–L</th>
                    <th className="py-3 px-5 text-right">Win Rate</th>
                    <th className="py-3 px-5 text-right">Singles</th>
                    <th className="py-3 px-5 text-right">Doubles</th>
                    <th className="py-3 px-5 text-right">Avg Diff</th>
                    <th className="py-3 px-4 text-right w-10" aria-label="Details" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {displayedPlayers.map((p) => {
                    const isSelf = activePlayer?.id === p.id;
                    const isExpanded = expandedPlayerId === p.id;
                    const recentMatches = isExpanded
                      ? getPlayerRecentMatches(p.id)
                      : [];

                    return (
                      <React.Fragment key={p.id}>
                        <tr
                          onClick={() =>
                            setExpandedPlayerId((prev) =>
                              prev === p.id ? null : p.id
                            )
                          }
                          className={`cursor-pointer transition-colors ${
                            isExpanded
                              ? 'bg-slate-50/90'
                              : isSelf
                              ? 'bg-emerald-50/25 hover:bg-emerald-50/50'
                              : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="py-3.5 px-5 font-mono tabular-nums font-semibold text-slate-500">
                            #{p.rank}
                          </td>
                          <td className="py-3.5 px-5">
                            <span className="font-semibold text-slate-900">
                              {p.name}
                            </span>
                            <span className="text-slate-400 font-mono ml-1.5">
                              {p.playerTag}
                            </span>
                            {isSelf && (
                              <span className="ml-1.5 text-[11px] font-semibold text-emerald-700">
                                · You
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-5 text-slate-600">
                            <span className="font-bold text-slate-900">
                              {p.tier}
                            </span>{' '}
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>{' '}
                            <span>{p.tierTitle}</span>
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono tabular-nums font-bold text-slate-900">
                            {p.ratingScore}
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono tabular-nums text-slate-600">
                            {p.wins}–{p.losses}
                          </td>
                          <td className="py-3.5 px-5 text-right">
                            <div className="inline-flex items-center justify-end gap-2">
                              <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-slate-900 rounded-full"
                                  style={{
                                    width: `${Math.min(100, Math.max(5, p.winRate))}%`,
                                  }}
                                />
                              </div>
                              <span className="font-mono tabular-nums font-semibold text-slate-900 w-9 text-right">
                                {p.winRate.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono tabular-nums text-slate-500">
                            {p.singlesWins}–{p.singlesLosses}
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono tabular-nums text-slate-500">
                            {p.doublesWins}–{p.doublesLosses}
                          </td>
                          <td
                            className={`py-3.5 px-5 text-right font-mono tabular-nums font-semibold ${
                              p.avgPointDiff >= 0
                                ? 'text-emerald-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {p.avgPointDiff >= 0
                              ? `+${p.avgPointDiff.toFixed(1)}`
                              : p.avgPointDiff.toFixed(1)}
                          </td>
                          <td className="py-3.5 px-4 text-right text-slate-400">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 inline" />
                            ) : (
                              <ChevronDown className="w-4 h-4 inline" />
                            )}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={10} className="px-5 py-4">
                              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                                <div className="lg:col-span-5 grid grid-cols-3 gap-3 bg-white rounded-lg border border-slate-200/70 p-3.5 font-mono tabular-nums">
                                  <div>
                                    <span className="text-[11px] font-sans text-slate-400 block">
                                      Games Played
                                    </span>
                                    <span className="text-sm font-bold text-slate-900">
                                      {p.gamesPlayed}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-[11px] font-sans text-slate-400 block">
                                      Pts Scored / Conceded
                                    </span>
                                    <span className="text-sm font-bold text-slate-900">
                                      {p.pointsScored} / {p.pointsConceded}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-[11px] font-sans text-slate-400 block">
                                      Net Point Diff
                                    </span>
                                    <span
                                      className={`text-sm font-bold ${
                                        p.pointDiff >= 0
                                          ? 'text-emerald-700'
                                          : 'text-slate-600'
                                      }`}
                                    >
                                      {p.pointDiff >= 0
                                        ? `+${p.pointDiff}`
                                        : p.pointDiff}
                                    </span>
                                  </div>
                                </div>

                                <div className="lg:col-span-7 bg-white rounded-lg border border-slate-200/70 p-3.5 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-semibold text-slate-700">
                                      Recent Recorded Matches ({recentMatches.length})
                                    </span>
                                    <div className="flex items-center gap-3">
                                      {onOpenProfileView && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onOpenProfileView(p.id);
                                          }}
                                          className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                                        >
                                          Full Profile &amp; History →
                                        </button>
                                      )}
                                      {onOpenMatchesView && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onOpenMatchesView();
                                          }}
                                          className="text-[11px] font-semibold text-slate-900 hover:underline cursor-pointer"
                                        >
                                          Open Match Log →
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {recentMatches.length === 0 ? (
                                    <p className="text-xs text-slate-400">
                                      No logged matches for {p.name} in this filter yet.
                                    </p>
                                  ) : (
                                    <div className="divide-y divide-slate-100">
                                      {recentMatches.map((m) => {
                                        const inA =
                                          m.teamAPlayer1Id === p.id ||
                                          m.teamAPlayer2Id === p.id;
                                        const won =
                                          (inA && m.winnerSide === 'A') ||
                                          (!inA && m.winnerSide === 'B');
                                        const sideA =
                                          m.matchFormat === 'doubles'
                                            ? `${m.teamAPlayer1Name} & ${m.teamAPlayer2Name}`
                                            : m.teamAPlayer1Name;
                                        const sideB =
                                          m.matchFormat === 'doubles'
                                            ? `${m.teamBPlayer1Name} & ${m.teamBPlayer2Name}`
                                            : m.teamBPlayer1Name;
                                        const matchSession = sessions.find(
                                          (s) => s.id === m.sessionId
                                        );
                                        return (
                                          <div
                                            key={m.id}
                                            className="py-1.5 flex items-center justify-between gap-3 text-xs"
                                          >
                                            <div className="min-w-0 truncate">
                                              <span
                                                className={`font-semibold ${
                                                  won
                                                    ? 'text-emerald-700'
                                                    : 'text-slate-500'
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
                                              <span className="text-slate-700">
                                                {sideA} vs {sideB}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                                              {matchSession && (
                                                <span className="text-[11px] text-slate-400">
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
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBILE ERGONOMIC CARD LIST (< md) */}
            <div className="md:hidden space-y-2.5">
              {displayedPlayers.map((p) => {
                const isSelf = activePlayer?.id === p.id;
                const isExpanded = expandedPlayerId === p.id;
                const recentMatches = isExpanded
                  ? getPlayerRecentMatches(p.id)
                  : [];

                return (
                  <div
                    key={p.id}
                    className={`bg-white rounded-xl border transition-colors overflow-hidden ${
                      isSelf
                        ? 'border-slate-300 shadow-2xs'
                        : 'border-slate-200/85'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedPlayerId((prev) =>
                          prev === p.id ? null : p.id
                        )
                      }
                      className="w-full p-4 text-left flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-900 font-mono tabular-nums font-bold text-xs flex items-center justify-center shrink-0">
                          #{p.rank}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-slate-900 truncate">
                              {p.name}
                            </span>
                            {isSelf && (
                              <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                                · You
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                            <span className="font-semibold text-slate-800">
                              Tier {p.tier}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{p.tierTitle}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {p.wins}W–{p.losses}L
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <div className="text-right font-mono tabular-nums">
                          <span className="text-base font-bold text-slate-900 block leading-tight">
                            {p.ratingScore}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {p.winRate.toFixed(0)}% ·{' '}
                            <span
                              className={
                                p.avgPointDiff >= 0
                                  ? 'text-emerald-700 font-semibold'
                                  : 'text-slate-500'
                              }
                            >
                              {p.avgPointDiff >= 0
                                ? `+${p.avgPointDiff.toFixed(1)}`
                                : p.avgPointDiff.toFixed(1)}
                            </span>
                          </span>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50/60 space-y-3 text-xs">
                        <div className="grid grid-cols-3 gap-2 font-mono tabular-nums bg-white p-3 rounded-lg border border-slate-200/70">
                          <div>
                            <span className="text-[10px] font-sans text-slate-400 block">
                              Singles
                            </span>
                            <span className="font-bold text-slate-900">
                              {p.singlesWins}W–{p.singlesLosses}L
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] font-sans text-slate-400 block">
                              Doubles
                            </span>
                            <span className="font-bold text-slate-900">
                              {p.doublesWins}W–{p.doublesLosses}L
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] font-sans text-slate-400 block">
                              Points S/C
                            </span>
                            <span className="font-bold text-slate-900">
                              {p.pointsScored}/{p.pointsConceded}
                            </span>
                          </div>
                        </div>

                        {recentMatches.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[11px] font-semibold text-slate-600 block">
                              Recent Matches
                            </span>
                            {recentMatches.map((m) => {
                              const inA =
                                m.teamAPlayer1Id === p.id ||
                                m.teamAPlayer2Id === p.id;
                              const won =
                                (inA && m.winnerSide === 'A') ||
                                (!inA && m.winnerSide === 'B');
                              return (
                                <div
                                  key={m.id}
                                  className="flex items-center justify-between gap-2 text-xs bg-white px-3 py-2 rounded-lg border border-slate-200/60"
                                >
                                  <span className="truncate text-slate-700">
                                    <span
                                      className={`font-semibold mr-1.5 ${
                                        won
                                          ? 'text-emerald-700'
                                          : 'text-slate-500'
                                      }`}
                                    >
                                      {won ? 'W' : 'L'}
                                    </span>
                                    {m.teamAPlayer1Name} vs {m.teamBPlayer1Name}
                                  </span>
                                  <span className="font-mono tabular-nums font-bold text-slate-900 shrink-0">
                                    {m.scoreTeamA}–{m.scoreTeamB}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {onOpenProfileView && (
                          <div className="pt-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => onOpenProfileView(p.id)}
                              className="h-8 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <User className="w-3.5 h-3.5" />
                              <span>Full Profile &amp; History →</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
};
