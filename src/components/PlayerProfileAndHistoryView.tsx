import React, { useMemo, useState } from 'react';
import {
  Briefcase,
  CheckCircle2,
  Gift,
  Handshake,
  Search,
  Swords,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BadmintonMatch,
  Club,
  Player,
  PlayerBenefitWallet,
  RankedPlayer,
  RsvpStatus,
  Session,
  SessionRsvp,
} from '../types';
import {
  evaluateTapOutWindow,
  getPlayerClubWallet,
  getPlayerJoinedClubIds,
} from '../utils/badmintonLogic';
import { ConfirmModal, SegmentedControl, StyledInput } from './ui/FormControls';
import { Button } from './ui/Button';

interface PlayerProfileAndHistoryViewProps {
  activePlayer: Player;
  inspectedPlayerId?: string | null;
  onSelectInspectedPlayer?: (playerId: string) => void;
  rankedPlayers: RankedPlayer[];
  allPlayers: Player[];
  clubs: Club[];
  activeClub: Club;
  sessions: Session[];
  rsvps: SessionRsvp[];
  matches: BadmintonMatch[];
  canManageClub: boolean;
  onUpdateOwnProfile: (updates: {
    name: string;
  }) => Promise<void>;
  onTapRsvp: (
    sessionId: string,
    player: Player,
    status: RsvpStatus,
    penaltyPercent?: number
  ) => Promise<void>;
  onNotifyPaymentSentForRsvp: (rsvpId: string, method?: string) => Promise<void>;
  onNotifyPaymentSentAllForPlayer: (
    playerId: string,
    method?: string
  ) => Promise<void>;
  onUpdatePlayerWallet?: (
    playerId: string,
    updates: Partial<PlayerBenefitWallet>,
    clubId?: string
  ) => void;
  onOpenGearLocker?: (playerId: string) => void;
}

type ProfileSectionTab = 'overview' | 'matches' | 'wallet' | 'settings';

interface PartnerRecord {
  partnerId: string;
  partnerName: string;
  partnerTag: string;
  partnerTier: string;
  gamesTogether: number;
  wins: number;
  losses: number;
  winRate: number;
  netPointDiff: number;
}

interface RivalRecord {
  opponentId: string;
  opponentName: string;
  opponentTag: string;
  opponentTier: string;
  gamesAgainst: number;
  winsAgainst: number;
  lossesAgainst: number;
  winRateAgainst: number;
  netPointDiff: number;
}

export const PlayerProfileAndHistoryView: React.FC<
  PlayerProfileAndHistoryViewProps
> = ({
  activePlayer,
  inspectedPlayerId,
  rankedPlayers,
  allPlayers,
  clubs,
  activeClub,
  sessions,
  rsvps,
  matches,
  canManageClub,
  onUpdateOwnProfile,
  onTapRsvp,
  onNotifyPaymentSentForRsvp,
  onNotifyPaymentSentAllForPlayer,
  onUpdatePlayerWallet,
  onOpenGearLocker,
}) => {
  const targetId = inspectedPlayerId || activePlayer.id;

  const targetRankedPlayer = useMemo<RankedPlayer>(() => {
    const found = rankedPlayers.find((p) => p.id === targetId);
    if (found) return found;
    const raw =
      allPlayers.find((p) => p.id === targetId) || activePlayer;
    return {
      ...raw,
      rank: rankedPlayers.length + 1,
      winRate:
        raw.gamesPlayed > 0
          ? Math.round((raw.wins / raw.gamesPlayed) * 100)
          : 0,
      pointDiff: raw.pointsScored - raw.pointsConceded,
      avgPointDiff:
        raw.gamesPlayed > 0
          ? (raw.pointsScored - raw.pointsConceded) / raw.gamesPlayed
          : 0,
      pointsShare:
        raw.pointsScored + raw.pointsConceded > 0
          ? (raw.pointsScored / (raw.pointsScored + raw.pointsConceded)) * 100
          : 50,
      tier: 'B',
      tierTitle: 'Rally Tactician',
      recentForm: [],
    };
  }, [rankedPlayers, allPlayers, targetId, activePlayer]);

  const isSelf = targetRankedPlayer.id === activePlayer.id;

  const [sectionTab, setSectionTab] = useState<ProfileSectionTab>('overview');
  const [matchFormatFilter, setMatchFormatFilter] = useState<
    'all' | 'doubles' | 'singles'
  >('all');
  const [matchOutcomeFilter, setMatchOutcomeFilter] = useState<
    'all' | 'won' | 'lost'
  >('all');
  const [matchSearchQuery, setMatchSearchQuery] = useState('');

  const [adminTopUpInput, setAdminTopUpInput] = useState('20');
  const preferredPaymentMethod = 'Reported Paid';

  // Inline Profile & Preferences Editor State (for signed-in user)
  const [editName, setEditName] = useState(activePlayer.name);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [savedProfileToast, setSavedProfileToast] = useState(false);

  // Confirmation modal states
  const [pendingTapOutSession, setPendingTapOutSession] = useState<{
    session: Session;
    status: RsvpStatus;
    penaltyPercent: number;
    isPenaltyWindow: boolean;
  } | null>(null);
  const [confirmMarkAllPaidOpen, setConfirmMarkAllPaidOpen] = useState(false);
  const [confirmToggleWaiverOpen, setConfirmToggleWaiverOpen] = useState(false);

  const handleSaveOwnProfileInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    setIsSavingProfile(true);
    try {
      await onUpdateOwnProfile({
        name: editName.trim(),
      });
      setSavedProfileToast(true);
      setTimeout(() => setSavedProfileToast(false), 2400);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Map sessions and clubs by ID for fast lookup
  const sessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    sessions.forEach((s) => map.set(s.id, s));
    return map;
  }, [sessions]);

  const clubMap = useMemo(() => {
    const map = new Map<string, Club>();
    clubs.forEach((c) => map.set(c.id, c));
    return map;
  }, [clubs]);

  const playerLookup = useMemo(() => {
    const map = new Map<string, RankedPlayer>();
    rankedPlayers.forEach((p) => map.set(p.id, p));
    return map;
  }, [rankedPlayers]);

  // All matches involving the inspected player (sorted newest first)
  const playerMatches = useMemo(() => {
    return matches
      .filter(
        (m) =>
          m.teamAPlayer1Id === targetRankedPlayer.id ||
          m.teamAPlayer2Id === targetRankedPlayer.id ||
          m.teamBPlayer1Id === targetRankedPlayer.id ||
          m.teamBPlayer2Id === targetRankedPlayer.id
      )
      .sort((a, b) => {
        const dateA = sessionMap.get(a.sessionId)?.sessionDate || '';
        const dateB = sessionMap.get(b.sessionId)?.sessionDate || '';
        return dateB.localeCompare(dateA);
      });
  }, [matches, targetRankedPlayer.id, sessionMap]);

  // Compute current streak & recent form (last 5 games)
  const formSummary = useMemo(() => {
    const outcomes = playerMatches.map((m) => {
      const inA =
        m.teamAPlayer1Id === targetRankedPlayer.id ||
        m.teamAPlayer2Id === targetRankedPlayer.id;
      const won =
        (inA && m.winnerSide === 'A') || (!inA && m.winnerSide === 'B');
      return won ? 'W' : 'L';
    });

    let streakCount = 0;
    const firstOutcome = outcomes[0];
    if (firstOutcome) {
      for (const o of outcomes) {
        if (o === firstOutcome) streakCount += 1;
        else break;
      }
    }

    const streakLabel =
      streakCount > 0 ? `${streakCount}${firstOutcome} Streak` : 'No games yet';

    return {
      recentFive: outcomes.slice(0, 5),
      streakLabel,
      isWinningStreak: firstOutcome === 'W' && streakCount > 0,
    };
  }, [playerMatches, targetRankedPlayer.id]);

  // Compute Doubles Partner Chemistry & Head-to-Head Rivalries
  const { partnerRecords, rivalRecords, headToHeadVsActive } = useMemo(() => {
    const partners = new Map<string, PartnerRecord>();
    const rivals = new Map<string, RivalRecord>();

    let togetherWins = 0;
    let togetherLosses = 0;
    let vsWins = 0;
    let vsLosses = 0;

    playerMatches.forEach((m) => {
      const inA =
        m.teamAPlayer1Id === targetRankedPlayer.id ||
        m.teamAPlayer2Id === targetRankedPlayer.id;
      const won =
        (inA && m.winnerSide === 'A') || (!inA && m.winnerSide === 'B');
      const myScore = inA ? m.scoreTeamA : m.scoreTeamB;
      const oppScore = inA ? m.scoreTeamB : m.scoreTeamA;
      const diff = myScore - oppScore;

      // Partner tracking for doubles
      if (m.matchFormat === 'doubles') {
        const partnerId = inA
          ? m.teamAPlayer1Id === targetRankedPlayer.id
            ? m.teamAPlayer2Id
            : m.teamAPlayer1Id
          : m.teamBPlayer1Id === targetRankedPlayer.id
          ? m.teamBPlayer2Id
          : m.teamBPlayer1Id;

        const partnerName = inA
          ? m.teamAPlayer1Id === targetRankedPlayer.id
            ? m.teamAPlayer2Name
            : m.teamAPlayer1Name
          : m.teamBPlayer1Id === targetRankedPlayer.id
          ? m.teamBPlayer2Name
          : m.teamBPlayer1Name;

        if (partnerId && partnerName) {
          const pInfo = playerLookup.get(partnerId);
          const existing = partners.get(partnerId) || {
            partnerId,
            partnerName,
            partnerTag: pInfo?.playerTag || '',
            partnerTier: pInfo?.tier || 'B',
            gamesTogether: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            netPointDiff: 0,
          };
          existing.gamesTogether += 1;
          if (won) existing.wins += 1;
          else existing.losses += 1;
          existing.netPointDiff += diff;
          existing.winRate = Math.round(
            (existing.wins / existing.gamesTogether) * 100
          );
          partners.set(partnerId, existing);

          if (!isSelf && partnerId === activePlayer.id) {
            if (won) togetherWins += 1;
            else togetherLosses += 1;
          }
        }
      }

      // Opponent tracking (both singles and doubles)
      const oppIds = inA
        ? [m.teamBPlayer1Id, m.teamBPlayer2Id].filter(Boolean)
        : [m.teamAPlayer1Id, m.teamAPlayer2Id].filter(Boolean);
      const oppNames = inA
        ? [m.teamBPlayer1Name, m.teamBPlayer2Name].filter(Boolean)
        : [m.teamAPlayer1Name, m.teamAPlayer2Name].filter(Boolean);

      oppIds.forEach((oppId, idx) => {
        if (!oppId) return;
        const oppName = oppNames[idx] || 'Opponent';
        const oInfo = playerLookup.get(oppId);
        const existing = rivals.get(oppId) || {
          opponentId: oppId,
          opponentName: oppName,
          opponentTag: oInfo?.playerTag || '',
          opponentTier: oInfo?.tier || 'B',
          gamesAgainst: 0,
          winsAgainst: 0,
          lossesAgainst: 0,
          winRateAgainst: 0,
          netPointDiff: 0,
        };
        existing.gamesAgainst += 1;
        if (won) existing.winsAgainst += 1;
        else existing.lossesAgainst += 1;
        existing.netPointDiff += diff;
        existing.winRateAgainst = Math.round(
          (existing.winsAgainst / existing.gamesAgainst) * 100
        );
        rivals.set(oppId, existing);

        if (!isSelf && oppId === activePlayer.id) {
          if (won) vsWins += 1;
          else vsLosses += 1;
        }
      });
    });

    const sortedPartners = Array.from(partners.values()).sort((a, b) => {
      if (b.gamesTogether !== a.gamesTogether)
        return b.gamesTogether - a.gamesTogether;
      return b.winRate - a.winRate;
    });

    const sortedRivals = Array.from(rivals.values()).sort((a, b) => {
      if (b.gamesAgainst !== a.gamesAgainst)
        return b.gamesAgainst - a.gamesAgainst;
      return b.winsAgainst - a.winsAgainst;
    });

    return {
      partnerRecords: sortedPartners,
      rivalRecords: sortedRivals,
      headToHeadVsActive: {
        togetherWins,
        togetherLosses,
        vsWins,
        vsLosses,
      },
    };
  }, [playerMatches, targetRankedPlayer.id, playerLookup, isSelf, activePlayer.id]);

  // Filtered match list for Match History tab
  const filteredPlayerMatches = useMemo(() => {
    return playerMatches.filter((m) => {
      if (matchFormatFilter !== 'all' && m.matchFormat !== matchFormatFilter) {
        return false;
      }
      const inA =
        m.teamAPlayer1Id === targetRankedPlayer.id ||
        m.teamAPlayer2Id === targetRankedPlayer.id;
      const won =
        (inA && m.winnerSide === 'A') || (!inA && m.winnerSide === 'B');
      if (matchOutcomeFilter === 'won' && !won) return false;
      if (matchOutcomeFilter === 'lost' && won) return false;

      if (matchSearchQuery.trim()) {
        const q = matchSearchQuery.trim().toLowerCase();
        const sess = sessionMap.get(m.sessionId);
        const text = [
          m.teamAPlayer1Name,
          m.teamAPlayer2Name,
          m.teamBPlayer1Name,
          m.teamBPlayer2Name,
          sess?.title,
          sess?.venue,
          sess?.sessionDate,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [
    playerMatches,
    matchFormatFilter,
    matchOutcomeFilter,
    matchSearchQuery,
    targetRankedPlayer.id,
    sessionMap,
  ]);

  // Session Attendance & RSVP History for this player
  const {
    upcomingSessionsWithRsvp,
    pastSessionRecords,
    attendanceStats,
    financialStats,
  } = useMemo(() => {
    const playerRsvpBySession = new Map<string, SessionRsvp>();
    rsvps
      .filter((r) => r.playerId === targetRankedPlayer.id)
      .forEach((r) => playerRsvpBySession.set(r.sessionId, r));

    const sortedSessions = [...sessions].sort((a, b) =>
      b.sessionDate.localeCompare(a.sessionDate)
    );

    const upcoming = sortedSessions
      .filter((s) => s.bookingStatus !== 'completed')
      .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
      .map((s) => ({
        session: s,
        rsvp: playerRsvpBySession.get(s.id) || null,
      }));

    const completedSessions = sortedSessions.filter(
      (s) => s.bookingStatus === 'completed'
    );

    const pastRecords = completedSessions
      .map((s) => ({
        session: s,
        rsvp: playerRsvpBySession.get(s.id) || null,
      }))
      .filter(
        (item) =>
          item.rsvp !== null ||
          playerMatches.some((m) => m.sessionId === item.session.id)
      );

    let attendedCount = 0;
    let lateOutCount = 0;
    let noShowCount = 0;
    let totalPaidAmount = 0;
    let totalUnpaidAmount = 0;
    let totalPendingAmount = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let pendingCount = 0;
    let waivedOrPassSessionsCount = 0;

    pastRecords.forEach(({ session, rsvp }) => {
      if (!rsvp) {
        attendedCount += 1;
        return;
      }
      if (rsvp.status === 'going' && rsvp.attendanceOutcome === 'present') {
        attendedCount += 1;
      } else if (rsvp.status === 'late_out') {
        lateOutCount += 1;
      } else if (rsvp.attendanceOutcome === 'no_show') {
        noShowCount += 1;
      }

      const sessionClub = clubMap.get(session.clubId);
      const isClubOwner =
        sessionClub?.clubOwnerPlayerId === targetRankedPlayer.id;

      if (session.feeSplitFinalized && (rsvp.feeShare > 0 || isClubOwner)) {
        if (isClubOwner || rsvp.paidStatus === 'paid') {
          paidCount += 1;
          if (
            isClubOwner ||
            rsvp.paidMethod.includes('Waived') ||
            rsvp.paidMethod.includes('Free Session') ||
            rsvp.paidMethod.includes('Club Owner')
          ) {
            waivedOrPassSessionsCount += 1;
          } else {
            totalPaidAmount += rsvp.feeShare;
          }
        } else if (rsvp.paidStatus === 'pending_approval') {
          pendingCount += 1;
          totalPendingAmount += rsvp.feeShare;
        } else {
          unpaidCount += 1;
          totalUnpaidAmount += rsvp.feeShare;
        }
      }
    });

    const totalCommitted = attendedCount + lateOutCount + noShowCount;
    const reliabilityRate =
      totalCommitted > 0
        ? Math.round((attendedCount / totalCommitted) * 100)
        : 100;

    return {
      upcomingSessionsWithRsvp: upcoming,
      pastSessionRecords: pastRecords,
      attendanceStats: {
        attendedCount,
        lateOutCount,
        noShowCount,
        reliabilityRate,
      },
      financialStats: {
        totalPaidAmount,
        totalUnpaidAmount,
        totalPendingAmount,
        paidCount,
        unpaidCount,
        pendingCount,
        waivedOrPassSessionsCount,
      },
    };
  }, [sessions, rsvps, targetRankedPlayer.id, playerMatches, clubMap]);

  // Next tier milestone progress
  const tierMilestone = useMemo(() => {
    const score = targetRankedPlayer.ratingScore;
    if (score >= 1400) {
      return {
        currentLabel: 'Tier S · Court Apex',
        nextLabel: 'Top Division Reached',
        pointsNeeded: 0,
        progressPct: 100,
      };
    }
    if (score >= 1290) {
      const pct = Math.round(((score - 1290) / (1400 - 1290)) * 100);
      return {
        currentLabel: 'Tier A · Smash Vanguard',
        nextLabel: 'Tier S (1400)',
        pointsNeeded: 1400 - score,
        progressPct: Math.min(100, Math.max(6, pct)),
      };
    }
    if (score >= 1160) {
      const pct = Math.round(((score - 1160) / (1290 - 1160)) * 100);
      return {
        currentLabel: 'Tier B · Rally Tactician',
        nextLabel: 'Tier A (1290)',
        pointsNeeded: 1290 - score,
        progressPct: Math.min(100, Math.max(6, pct)),
      };
    }
    const pct = Math.round(((score - 950) / (1160 - 950)) * 100);
    return {
      currentLabel: 'Tier C · Rising Shuttle',
      nextLabel: 'Tier B (1160)',
      pointsNeeded: 1160 - score,
      progressPct: Math.min(100, Math.max(8, pct)),
    };
  }, [targetRankedPlayer.ratingScore]);

  const joinedClubNames = useMemo(() => {
    const ids = getPlayerJoinedClubIds(targetRankedPlayer);
    return clubs.filter((c) => ids.includes(c.id)).map((c) => c.name);
  }, [targetRankedPlayer, clubs]);

  const activeClubWallet = getPlayerClubWallet(
    targetRankedPlayer,
    activeClub.id
  );
  const creditBal = Math.max(0, Number(activeClubWallet.creditBalance || 0));
  const freePasses = Math.max(
    0,
    Math.floor(Number(activeClubWallet.freeSessionPasses || 0))
  );
  const isWaived = Boolean(activeClubWallet.waiveAllFees);
  // Only the player themselves or the actual owner of activeClub can view/manage member balances & wallets
  const canViewWalletAndLedger = isSelf || canManageClub;

  return (
    <div className="space-y-6">
      {/* Unified Competitive & Personal Dossier Header */}
      <div className="flex flex-col gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display">
            {isSelf ? 'My Player Profile & Personal Ledger' : `${targetRankedPlayer.name} · Player Profile`}
          </h1>
        </div>

        {/* Clean Profile Section Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap pb-0.5 sm:pb-0">
            <SegmentedControl
              size="sm"
              options={[
                { value: 'overview', label: 'Overview & Chemistry' },
                {
                  value: 'matches',
                  label: 'Match History',
                  count: playerMatches.length,
                },
                ...(canViewWalletAndLedger
                  ? [
                      {
                        value: 'wallet' as const,
                        label: `Fees, Wallet & Sessions (${activeClub.name})`,
                        count:
                          upcomingSessionsWithRsvp.length +
                          pastSessionRecords.length,
                      },
                    ]
                  : []),
                ...(isSelf
                  ? [{ value: 'settings' as const, label: 'Edit Profile' }]
                  : []),
              ]}
              value={
                (!isSelf && sectionTab === 'settings') ||
                (!canViewWalletAndLedger && sectionTab === 'wallet')
                  ? 'overview'
                  : sectionTab
              }
              onChange={setSectionTab}
            />
          </div>
        </div>
      </div>

      {/* Hero Dossier Card */}
      <motion.section
        key={targetRankedPlayer.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 space-y-5 shadow-2xs"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          {/* Left: Avatar Badge, Name, Tag, PlayStyle, Handedness, Clubs */}
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white font-display font-bold text-base flex flex-col items-center justify-center shrink-0 font-mono tabular-nums shadow-xs">
              <span className="text-[10px] font-sans text-slate-400 leading-none">
                RANK
              </span>
              <span className="mt-0.5">#{targetRankedPlayer.rank}</span>
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 truncate font-display">
                  {targetRankedPlayer.name}
                </h2>
                <span className="text-xs font-mono text-slate-500 font-medium">
                  {targetRankedPlayer.playerTag}
                </span>
                {isSelf && (
                  <span className="text-xs font-semibold text-emerald-700">
                    · Signed-In Profile
                  </span>
                )}
              </div>

              {/* Clean Unboxed Metadata Row */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-900">
                  Tier {targetRankedPlayer.tier} ({targetRankedPlayer.tierTitle})
                </span>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span
                  className={`font-semibold ${
                    formSummary.isWinningStreak
                      ? 'text-emerald-700'
                      : 'text-slate-600'
                  }`}
                >
                  {formSummary.streakLabel}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span>
                  Clubs:{' '}
                  <strong className="font-medium text-slate-800">
                    {joinedClubNames.length > 0
                      ? joinedClubNames.join(', ')
                      : activeClub.name}
                  </strong>
                </span>
                {canViewWalletAndLedger &&
                  (isWaived || freePasses > 0 || creditBal > 0) && (
                    <>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-semibold text-emerald-700">
                        {activeClub.name} Perks:{' '}
                        {[
                          isWaived ? 'VIP Fee Waiver' : null,
                          freePasses > 0
                            ? `${freePasses} Free ${
                                freePasses === 1 ? 'Session' : 'Sessions'
                              }`
                            : null,
                          creditBal > 0
                            ? `$${creditBal.toFixed(2)} Credit`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' + ')}
                      </span>
                    </>
                  )}
              </div>
            </div>
          </div>

          {/* Right: Recent 5 Form Sequence */}
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between lg:justify-end gap-4 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100 shrink-0">
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-slate-600 block">
                Recent Form (Last 5)
              </span>
              <div className="flex items-center gap-1.5 font-mono text-xs">
                {formSummary.recentFive.length === 0 ? (
                  <span className="text-slate-600 text-xs font-sans">
                    No matches logged
                  </span>
                ) : (
                  formSummary.recentFive.map((res, idx) => (
                    <span
                      key={idx}
                      className={`w-6 h-6 rounded-md font-bold flex items-center justify-center text-[11px] ${
                        res === 'W'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {res}
                    </span>
                  ))
                )}
              </div>
            </div>

            {isSelf && onOpenGearLocker && (
              <Button
                onClick={() => onOpenGearLocker(targetRankedPlayer.id)}
              >
                <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                <span>Gear Locker</span>
              </Button>
            )}
          </div>
        </div>

        {/* Direct Head-to-Head Callout when inspecting another club member */}
        {!isSelf && (
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-700">
              <Handshake className="w-4 h-4 text-slate-600 shrink-0" />
              <span>
                Your Direct History with{' '}
                <strong className="text-slate-900">
                  {targetRankedPlayer.name}
                </strong>
                :
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
              <span>
                As Doubles Partners:{' '}
                <strong className="text-slate-900">
                  {headToHeadVsActive.togetherWins}W–
                  {headToHeadVsActive.togetherLosses}L
                </strong>
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>
                As Opponents (their record vs you):{' '}
                <strong className="text-slate-900">
                  {headToHeadVsActive.vsWins}W–{headToHeadVsActive.vsLosses}L
                </strong>
              </span>
            </div>
          </div>
        )}

        {/* 4-Column Quantitative KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-2 border-t border-slate-100">
          {/* Metric 1: Rating & Next Division Progress */}
          <div className="bg-slate-50/70 rounded-xl border border-slate-200/70 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 font-semibold">Club Rating</span>
              <span className="font-mono tabular-nums text-[11px] text-slate-600">
                {tierMilestone.pointsNeeded > 0
                  ? `${tierMilestone.pointsNeeded} pts to ${tierMilestone.nextLabel}`
                  : tierMilestone.nextLabel}
              </span>
            </div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-2xl font-bold text-slate-900">
                {targetRankedPlayer.ratingScore}
              </span>
              <span className="text-xs font-semibold text-slate-700">
                Tier {targetRankedPlayer.tier}
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${tierMilestone.progressPct}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="h-full bg-slate-900 rounded-full"
              />
            </div>
          </div>

          {/* Metric 2: Career Win Rate & Format Split */}
          <div className="bg-slate-50/70 rounded-xl border border-slate-200/70 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 font-semibold">Career Record</span>
              <span className="font-mono tabular-nums text-slate-700 font-semibold">
                {targetRankedPlayer.gamesPlayed} Games
              </span>
            </div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-2xl font-bold text-slate-900">
                {targetRankedPlayer.winRate.toFixed(0)}%
              </span>
              <span className="text-xs font-semibold text-slate-700">
                {targetRankedPlayer.wins}W–{targetRankedPlayer.losses}L
              </span>
            </div>
            <p className="text-[11px] text-slate-600 font-mono tabular-nums">
              Doubles {targetRankedPlayer.doublesWins}–
              {targetRankedPlayer.doublesLosses} · Singles{' '}
              {targetRankedPlayer.singlesWins}–{targetRankedPlayer.singlesLosses}
            </p>
          </div>

          {/* Metric 3: Point Differential & Rally Efficiency */}
          <div className="bg-slate-50/70 rounded-xl border border-slate-200/70 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 font-semibold">
                Avg Point Diff / Game
              </span>
              <span className="font-mono tabular-nums text-slate-600 text-[11px]">
                Net{' '}
                {targetRankedPlayer.pointDiff >= 0
                  ? `+${targetRankedPlayer.pointDiff}`
                  : targetRankedPlayer.pointDiff}
              </span>
            </div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span
                className={`text-2xl font-bold ${
                  targetRankedPlayer.avgPointDiff >= 0
                    ? 'text-emerald-700'
                    : 'text-slate-700'
                }`}
              >
                {targetRankedPlayer.avgPointDiff >= 0
                  ? `+${targetRankedPlayer.avgPointDiff.toFixed(1)}`
                  : targetRankedPlayer.avgPointDiff.toFixed(1)}
              </span>
              <span className="text-xs text-slate-600">pts/game</span>
            </div>
            <p className="text-[11px] text-slate-600 font-mono tabular-nums">
              {targetRankedPlayer.pointsScored} scored ·{' '}
              {targetRankedPlayer.pointsConceded} conceded
            </p>
          </div>

          {/* Metric 4: Attendance & Wallet Balance Summary */}
          <div className="bg-slate-50/70 rounded-xl border border-slate-200/70 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 font-semibold">
                Sessions &amp; Balance
              </span>
              <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                {attendanceStats.reliabilityRate}% Reliable
              </span>
            </div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-2xl font-bold text-slate-900">
                {attendanceStats.attendedCount}
              </span>
              <span className="text-xs font-semibold text-slate-700">
                {financialStats.totalUnpaidAmount > 0
                  ? `Owes $${financialStats.totalUnpaidAmount.toFixed(2)}`
                  : creditBal > 0
                  ? `$${creditBal.toFixed(2)} Credit`
                  : '$0.00 Owed'}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 font-mono tabular-nums">
              {freePasses > 0
                ? `${freePasses} Free Pass${freePasses > 1 ? 'es' : ''} · `
                : isWaived
                ? 'VIP Fee Waiver · '
                : ''}
              Paid ${financialStats.totalPaidAmount.toFixed(2)} lifetime
            </p>
          </div>
        </div>
      </motion.section>

      <AnimatePresence mode="wait">
        {/* SECTION 1: OVERVIEW & PARTNER / RIVAL CHEMISTRY */}
        {sectionTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="space-y-6"
          >
            {/* 2-Column Partner Chemistry & Head-to-Head Rivalries */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
              {/* Doubles Partner Chemistry Card */}
              <section className="bg-white rounded-2xl border border-slate-200/90 p-5 flex flex-col justify-between space-y-4 shadow-2xs">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 font-display">
                      <Users className="w-4 h-4 text-slate-600" />
                      <span>Doubles Partner Chemistry</span>
                    </h3>
                    <span className="text-xs font-mono tabular-nums text-slate-600 font-medium">
                      {partnerRecords.length}{' '}
                      {partnerRecords.length === 1 ? 'partner' : 'partners'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Historical doubles pairings ranked by games played together
                    and win rate.
                  </p>
                </div>

                {partnerRecords.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-600">
                    No doubles matches recorded for {targetRankedPlayer.name} yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {partnerRecords.map((pr, idx) => (
                      <div
                        key={pr.partnerId}
                        className="py-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-900 truncate">
                              {pr.partnerName}
                            </span>
                            <span className="font-mono text-slate-500 text-[11px]">
                              {pr.partnerTag}
                            </span>
                            {idx === 0 && pr.winRate >= 50 && (
                              <span className="text-[11px] font-semibold text-emerald-700">
                                · Top Synergy
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mt-0.5 font-mono tabular-nums">
                            <span>Tier {pr.partnerTier}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {pr.gamesTogether}{' '}
                              {pr.gamesTogether === 1 ? 'match' : 'matches'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              Net diff{' '}
                              {pr.netPointDiff >= 0
                                ? `+${pr.netPointDiff}`
                                : pr.netPointDiff}
                            </span>
                          </div>
                        </div>

                        <div className="text-right font-mono tabular-nums shrink-0">
                          <span className="font-bold text-slate-900 block">
                            {pr.wins}W–{pr.losses}L ({pr.winRate}%)
                          </span>
                          <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1 ml-auto">
                            <div
                              className="h-full bg-slate-900 rounded-full"
                              style={{
                                width: `${Math.min(100, Math.max(6, pr.winRate))}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Head-to-Head Opponents & Rivals Card */}
              <section className="bg-white rounded-2xl border border-slate-200/90 p-5 flex flex-col justify-between space-y-4 shadow-2xs">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 font-display">
                      <Swords className="w-4 h-4 text-slate-600" />
                      <span>Head-to-Head Rivals &amp; Opponents</span>
                    </h3>
                    <span className="text-xs font-mono tabular-nums text-slate-600 font-medium">
                      {rivalRecords.length}{' '}
                      {rivalRecords.length === 1 ? 'rival' : 'rivals'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Win–loss record and point differential against frequent court
                    opponents.
                  </p>
                </div>

                {rivalRecords.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-600">
                    No opponent history recorded for {targetRankedPlayer.name}{' '}
                    yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {rivalRecords.slice(0, 6).map((rr) => {
                      const isNemesis =
                        rr.gamesAgainst >= 2 && rr.winRateAgainst < 50;
                      const isDominated =
                        rr.gamesAgainst >= 2 && rr.winRateAgainst >= 65;

                      return (
                        <div
                          key={rr.opponentId}
                          className="py-3 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900 truncate">
                                vs {rr.opponentName}
                              </span>
                              <span className="font-mono text-slate-500 text-[11px]">
                                {rr.opponentTag}
                              </span>
                              {isNemesis && (
                                <span className="text-[11px] font-semibold text-amber-800">
                                  · Tough Rival
                                </span>
                              )}
                              {isDominated && (
                                <span className="text-[11px] font-semibold text-emerald-700">
                                  · Favorable Matchup
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mt-0.5 font-mono tabular-nums">
                              <span>Tier {rr.opponentTier}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {rr.gamesAgainst}{' '}
                                {rr.gamesAgainst === 1 ? 'encounter' : 'encounters'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                Diff{' '}
                                {rr.netPointDiff >= 0
                                  ? `+${rr.netPointDiff}`
                                  : rr.netPointDiff}
                              </span>
                            </div>
                          </div>

                          <div className="text-right font-mono tabular-nums shrink-0">
                            <span className="font-bold text-slate-900 block">
                              {rr.winsAgainst}W–{rr.lossesAgainst}L (
                              {rr.winRateAgainst}%)
                            </span>
                            <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1 ml-auto">
                              <div
                                className="h-full bg-slate-900 rounded-full"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    Math.max(6, rr.winRateAgainst)
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            {/* Combined Snapshot: Recent Matches + Recent Sessions & Fee Status */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Recent 5 Matches Preview */}
              <section className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-2xs">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 font-display">
                    Recent Match Results
                  </h3>
                  <p className="text-xs text-slate-600">
                    Latest court results logged across club sessions.
                  </p>
                </div>

                {playerMatches.length === 0 ? (
                  <p className="text-xs text-slate-600 py-4">
                    No matches recorded yet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {playerMatches.slice(0, 5).map((m) => {
                      const inA =
                        m.teamAPlayer1Id === targetRankedPlayer.id ||
                        m.teamAPlayer2Id === targetRankedPlayer.id;
                      const won =
                        (inA && m.winnerSide === 'A') ||
                        (!inA && m.winnerSide === 'B');
                      const sess = sessionMap.get(m.sessionId);
                      const sideA =
                        m.matchFormat === 'doubles'
                          ? `${m.teamAPlayer1Name} & ${m.teamAPlayer2Name}`
                          : m.teamAPlayer1Name;
                      const sideB =
                        m.matchFormat === 'doubles'
                          ? `${m.teamBPlayer1Name} & ${m.teamBPlayer2Name}`
                          : m.teamBPlayer1Name;

                      return (
                        <div
                          key={m.id}
                          className="py-3 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`font-bold ${
                                  won ? 'text-emerald-700' : 'text-slate-600'
                                }`}
                              >
                                {won ? 'Won' : 'Lost'}
                              </span>
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                              <span className="font-medium text-slate-900 truncate">
                                {sideA} vs {sideB}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mt-0.5">
                              <span className="capitalize">{m.matchFormat}</span>
                              {sess && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    {sess.sessionDate} ({sess.title})
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <span className="font-mono tabular-nums font-bold text-sm text-slate-900 shrink-0">
                            {m.scoreTeamA}–{m.scoreTeamB}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Recent Session Attendance & Fee Ledger Preview */}
              <section className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-2xs">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 font-display">
                    Session &amp; Fee History
                  </h3>
                  <p className="text-xs text-slate-600">
                    Attendance &amp; split status.
                  </p>
                </div>

                {pastSessionRecords.length === 0 ? (
                  <p className="text-xs text-slate-600 py-4">
                    No completed sessions recorded yet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {pastSessionRecords.slice(0, 5).map(({ session, rsvp }) => (
                      <div
                        key={session.id}
                        className="py-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">
                            {session.title}
                          </p>
                          <p className="text-[11px] text-slate-600 font-mono tabular-nums mt-0.5">
                            {session.sessionDate} ·{' '}
                            {rsvp
                              ? rsvp.status === 'late_out'
                                ? `Late Out (${rsvp.penaltyPercentApplied}%)`
                                : rsvp.attendanceOutcome === 'no_show'
                                ? 'No-Show'
                                : 'Attended'
                              : 'Played'}
                          </p>
                        </div>

                        <div className="text-right font-mono tabular-nums shrink-0">
                          {rsvp && session.feeSplitFinalized ? (
                            <>
                              <span className="font-bold text-slate-900 block">
                                ${rsvp.feeShare.toFixed(2)}
                              </span>
                              <span
                                className={`text-[11px] font-sans font-semibold ${
                                  rsvp.paidStatus === 'paid'
                                    ? 'text-emerald-700'
                                    : rsvp.paidStatus === 'pending_approval'
                                    ? 'text-blue-700'
                                    : 'text-amber-800'
                                }`}
                              >
                                {rsvp.paidStatus === 'paid'
                                  ? rsvp.paidMethod || 'Paid'
                                  : rsvp.paidStatus === 'pending_approval'
                                  ? 'Pending Approval'
                                  : 'Unpaid'}
                              </span>
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-600 font-sans">
                              Unfinalized
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </motion.div>
        )}

        {/* SECTION 2: FULL PERSONAL MATCH HISTORY */}
        {sectionTab === 'matches' && (
          <motion.section
            key="matches"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-2xs"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900 font-display">
                  Complete Match History ({filteredPlayerMatches.length})
                </h3>
                <p className="text-xs text-slate-600">
                  Every singles and doubles game recorded for{' '}
                  {targetRankedPlayer.name}.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="w-full sm:w-52">
                  <StyledInput
                    icon={<Search className="w-3.5 h-3.5" />}
                    placeholder="Search partner, rival, session..."
                    value={matchSearchQuery}
                    onChange={(e) => setMatchSearchQuery(e.target.value)}
                  />
                </div>

                <SegmentedControl
                  size="sm"
                  options={[
                    { value: 'all', label: 'All Formats' },
                    { value: 'doubles', label: 'Doubles' },
                    { value: 'singles', label: 'Singles' },
                  ]}
                  value={matchFormatFilter}
                  onChange={setMatchFormatFilter}
                />

                <SegmentedControl
                  size="sm"
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'won', label: 'Wins' },
                    { value: 'lost', label: 'Losses' },
                  ]}
                  value={matchOutcomeFilter}
                  onChange={setMatchOutcomeFilter}
                />
              </div>
            </div>

            {filteredPlayerMatches.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-600">
                No matches found matching your filter criteria.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredPlayerMatches.map((m) => {
                  const inA =
                    m.teamAPlayer1Id === targetRankedPlayer.id ||
                    m.teamAPlayer2Id === targetRankedPlayer.id;
                  const won =
                    (inA && m.winnerSide === 'A') ||
                    (!inA && m.winnerSide === 'B');
                  const myScore = inA ? m.scoreTeamA : m.scoreTeamB;
                  const oppScore = inA ? m.scoreTeamB : m.scoreTeamA;
                  const diff = myScore - oppScore;
                  const sess = sessionMap.get(m.sessionId);

                  const myTeamLabel =
                    m.matchFormat === 'doubles'
                      ? inA
                        ? `${m.teamAPlayer1Name} & ${m.teamAPlayer2Name}`
                        : `${m.teamBPlayer1Name} & ${m.teamBPlayer2Name}`
                      : inA
                      ? m.teamAPlayer1Name
                      : m.teamBPlayer1Name;

                  const oppTeamLabel =
                    m.matchFormat === 'doubles'
                      ? inA
                        ? `${m.teamBPlayer1Name} & ${m.teamBPlayer2Name}`
                        : `${m.teamAPlayer1Name} & ${m.teamAPlayer2Name}`
                      : inA
                      ? m.teamBPlayer1Name
                      : m.teamAPlayer1Name;

                  return (
                    <div
                      key={m.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`font-bold ${
                              won ? 'text-emerald-700' : 'text-slate-600'
                            }`}
                          >
                            {won ? 'Victory' : 'Defeat'}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="font-semibold text-slate-900">
                            {myTeamLabel}
                          </span>
                          <span className="text-slate-500">vs</span>
                          <span className="font-medium text-slate-700">
                            {oppTeamLabel}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                          <span className="capitalize">{m.matchFormat}</span>
                          {sess && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {sess.sessionDate}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {sess.title} ({sess.venue})
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 font-mono tabular-nums shrink-0">
                        <span
                          className={`text-xs font-semibold ${
                            diff >= 0 ? 'text-emerald-700' : 'text-slate-600'
                          }`}
                        >
                          {diff >= 0 ? `+${diff}` : diff} diff
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {myScore}–{oppScore}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.section>
        )}

        {/* SECTION 3: PERSONAL FEES, WALLET & SESSIONS */}
        {sectionTab === 'wallet' && (
          <motion.div
            key="wallet"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="space-y-6"
          >
            {/* Member Balance Summary Strip (Due, Paid/Received, Pending, Reliability) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-600 block">
                  Unpaid / Due Total
                </span>
                <span
                  className={`font-mono tabular-nums text-lg font-bold block ${
                    financialStats.totalUnpaidAmount > 0
                      ? 'text-amber-700'
                      : 'text-slate-900'
                  }`}
                >
                  ${financialStats.totalUnpaidAmount.toFixed(2)}
                </span>
                <span className="text-[11px] text-slate-600 block">
                  {financialStats.unpaidCount === 0
                    ? 'All settled'
                    : `${financialStats.unpaidCount} unpaid session${
                        financialStats.unpaidCount === 1 ? '' : 's'
                      }`}
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-600 block">
                  Paid / Received Total
                </span>
                <span className="font-mono tabular-nums text-lg font-bold text-emerald-700 block">
                  ${financialStats.totalPaidAmount.toFixed(2)}
                </span>
                <span className="text-[11px] text-slate-600 block">
                  {financialStats.paidCount} cleared session
                  {financialStats.paidCount === 1 ? '' : 's'}
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-600 block">
                  Pending Confirmation
                </span>
                <span className="font-mono tabular-nums text-lg font-bold text-blue-700 block">
                  ${financialStats.totalPendingAmount.toFixed(2)}
                </span>
                <span className="text-[11px] text-slate-600 block">
                  {financialStats.pendingCount} awaiting check
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-600 block">
                  Attendance &amp; Reliability
                </span>
                <span className="font-mono tabular-nums text-lg font-bold text-slate-900 block">
                  {attendanceStats.attendedCount} Attended
                </span>
                <span className="text-[11px] text-slate-600 block">
                  {attendanceStats.reliabilityRate}% reliable ·{' '}
                  {attendanceStats.noShowCount} no-show
                </span>
              </div>
            </div>

            {/* Upcoming Club Sessions with Direct 1-Tap RSVP */}
            {upcomingSessionsWithRsvp.length > 0 && (
              <section className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-2xs">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 font-display">
                    Upcoming Sessions &amp; Active RSVPs (
                    {upcomingSessionsWithRsvp.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isSelf
                      ? 'Manage your upcoming session attendance directly from your profile.'
                      : `Upcoming session schedule for ${targetRankedPlayer.name}.`}
                  </p>
                </div>

                <div className="divide-y divide-slate-100">
                  {upcomingSessionsWithRsvp.map(({ session, rsvp }) => {
                    const policy = evaluateTapOutWindow(session, activeClub);
                    const isGoing = rsvp?.status === 'going';
                    const isOut =
                      rsvp?.status === 'out' || rsvp?.status === 'late_out';

                    return (
                      <div
                        key={session.id}
                        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-slate-900">
                              {session.title}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="font-mono tabular-nums text-slate-600">
                              {session.sessionDate} ({session.startTime}–
                              {session.endTime})
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span
                              className={`font-semibold ${
                                isGoing
                                  ? 'text-emerald-700'
                                  : isOut
                                  ? 'text-slate-500'
                                  : 'text-amber-800'
                              }`}
                            >
                              {isGoing
                                ? 'Going'
                                : isOut
                                ? 'Tapped Out'
                                : 'Not Responded'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {session.venue} ({session.courtNumbers}) · Court Fee $
                            {session.courtFee.toFixed(2)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {isSelf && (
                            <>
                              {!isGoing ? (
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
                                  className="h-8 px-3.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap shrink-0 transition-colors cursor-pointer shadow-2xs"
                                >
                                  Join
                                </button>
                              ) : policy.canTapOut ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPendingTapOutSession({
                                      session,
                                      status: policy.isPenaltyWindow
                                        ? 'late_out'
                                        : 'out',
                                      penaltyPercent: policy.penaltyPercent,
                                      isPenaltyWindow: policy.isPenaltyWindow,
                                    })
                                  }
                                  className={`h-8 px-3.5 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer shadow-2xs ${
                                    policy.isPenaltyWindow
                                      ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                                      : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  {policy.isPenaltyWindow
                                    ? `Out (${policy.penaltyPercent}%)`
                                    : 'Out'}
                                </button>
                              ) : (
                                <span className="h-8 px-3 rounded-xl bg-slate-100 border border-slate-200/80 text-slate-500 text-xs font-semibold inline-flex items-center">
                                  Locked
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Active Member Wallet & Perks Card */}
            <section className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 font-display">
                    <Gift className="w-4 h-4 text-emerald-600" />
                    <span>
                      Member Credits, Free Session Passes &amp; Fee Waivers
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Automatically applied in priority order (Complete Waiver →
                    Free Session Pass → Club Credit) when session splits are
                    finalized.
                  </p>
                </div>

                {isSelf && financialStats.totalUnpaidAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmMarkAllPaidOpen(true)}
                    className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      Mark All Unpaid Sent ($
                      {financialStats.totalUnpaidAmount.toFixed(2)})
                    </span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Card 1: Prepaid Club Credit */}
                <div className="bg-slate-50/70 rounded-xl border border-slate-200/80 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium">
                      {activeClub.name} Credit
                    </span>
                    <span className="font-mono tabular-nums text-lg font-bold text-sky-700">
                      ${creditBal.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Deducts dollar-for-dollar against finalized court &amp;
                    shuttle fee splits in {activeClub.name}.
                  </p>
                  {canManageClub && onUpdatePlayerWallet && (
                    <div className="pt-2 border-t border-slate-200/70 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        {[10, 20, 50].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() =>
                              onUpdatePlayerWallet(
                                targetRankedPlayer.id,
                                {
                                  creditBalance:
                                    Math.round((creditBal + amt) * 100) / 100,
                                },
                                activeClub.id
                              )
                            }
                            className="flex-1 py-1.5 rounded-lg bg-white hover:bg-sky-50 text-sky-800 border border-slate-200 text-[11px] font-semibold cursor-pointer"
                          >
                            +${amt}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={adminTopUpInput}
                          onChange={(e) => setAdminTopUpInput(e.target.value)}
                          className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 font-mono tabular-nums"
                          placeholder="Amount"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const val = Number(adminTopUpInput);
                            if (!Number.isFinite(val) || val <= 0) return;
                            onUpdatePlayerWallet(
                              targetRankedPlayer.id,
                              {
                                creditBalance:
                                  Math.round((creditBal + val) * 100) / 100,
                              },
                              activeClub.id
                            );
                          }}
                          className="px-3 h-8 rounded-lg bg-slate-900 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
                        >
                          Top Up
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card 2: Free Session Passes */}
                <div className="bg-slate-50/70 rounded-xl border border-slate-200/80 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium">
                      Free Session Passes
                    </span>
                    <span className="font-mono tabular-nums text-lg font-bold text-emerald-700">
                      {freePasses} {freePasses === 1 ? 'Pass' : 'Passes'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Each pass waives 1 full session fee share upon session
                    completion in {activeClub.name}.
                  </p>
                  {canManageClub && onUpdatePlayerWallet && (
                    <div className="pt-2 border-t border-slate-200/70 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdatePlayerWallet(
                            targetRankedPlayer.id,
                            {
                              freeSessionPasses: Math.max(0, freePasses - 1),
                            },
                            activeClub.id
                          )
                        }
                        disabled={freePasses === 0}
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 disabled:opacity-40 text-[11px] font-semibold cursor-pointer"
                      >
                        -1
                      </button>
                      {[1, 3, 5].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() =>
                            onUpdatePlayerWallet(
                              targetRankedPlayer.id,
                              {
                                freeSessionPasses: freePasses + cnt,
                              },
                              activeClub.id
                            )
                          }
                          className="flex-1 py-1.5 rounded-lg bg-white hover:bg-emerald-50 text-emerald-800 border border-slate-200 text-[11px] font-semibold cursor-pointer"
                        >
                          +{cnt} Free
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Card 3: Complete Fee Waiver */}
                <div className="bg-slate-50/70 rounded-xl border border-slate-200/80 p-4 flex flex-col justify-between space-y-2">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">
                        VIP Complete Waiver
                      </span>
                      <span
                        className={`font-semibold ${
                          isWaived ? 'text-purple-700' : 'text-slate-400'
                        }`}
                      >
                        {isWaived ? 'Active (Exempt)' : 'Standard Member'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Exempts member from all unpaid and future session fees.
                    </p>
                  </div>

                  {canManageClub && onUpdatePlayerWallet && (
                    <div className="pt-2 border-t border-slate-200/70">
                      <button
                        type="button"
                        onClick={() => setConfirmToggleWaiverOpen(true)}
                        className={`w-full py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                          isWaived
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {isWaived
                          ? 'Disable VIP Fee Waiver'
                          : 'Enable Complete Fee Waiver'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Chronological Personal Fee & Settlement Ledger */}
            <section className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 font-display">
                    Personal Session Fee &amp; Receipt Ledger
                  </h3>
                  <p className="text-xs text-slate-500">
                    Lifetime Paid: ${financialStats.totalPaidAmount.toFixed(2)} ·
                    Waived/Pass Sessions:{' '}
                    {financialStats.waivedOrPassSessionsCount} · Unpaid: $
                    {financialStats.totalUnpaidAmount.toFixed(2)}
                  </p>
                </div>
              </div>

              {pastSessionRecords.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">
                  No session fee records found.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {pastSessionRecords.map(({ session, rsvp }) => {
                    if (!rsvp) return null;
                    const sessionClub = clubMap.get(session.clubId);
                    const isClubOwner =
                      sessionClub?.clubOwnerPlayerId === targetRankedPlayer.id;
                    const isPaid = isClubOwner || rsvp.paidStatus === 'paid';
                    const isPending =
                      !isClubOwner && rsvp.paidStatus === 'pending_approval';

                    return (
                      <div
                        key={rsvp.id}
                        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-slate-900">
                              {session.title}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="font-mono tabular-nums text-slate-500">
                              {session.sessionDate}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="text-slate-600">
                              {isClubOwner &&
                              Boolean(sessionClub?.excludeOwnerFromBilling)
                                ? 'Owner Excluded (0%)'
                                : `Weight ${rsvp.penaltyPercentApplied}%`}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            {session.venue} · Total Session Pool: $
                            {(session.courtFee + session.shuttleFee).toFixed(2)}
                          </p>
                        </div>

                        <div className="flex items-center justify-end gap-3 shrink-0 font-mono tabular-nums">
                          {isSelf &&
                            !isPaid &&
                            !isPending &&
                            rsvp.feeShare > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  onNotifyPaymentSentForRsvp(
                                    rsvp.id,
                                    preferredPaymentMethod
                                  )
                                }
                                className="h-8 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-semibold cursor-pointer shadow-2xs"
                              >
                                Mark Paid
                              </button>
                            )}

                          <div className="text-right min-w-[110px]">
                            <span className="text-sm font-bold text-slate-900 block">
                              ${rsvp.feeShare.toFixed(2)}
                            </span>
                            <span
                              className={`text-[11px] font-sans font-semibold ${
                                isPaid
                                  ? 'text-emerald-700'
                                  : isPending
                                  ? 'text-blue-700'
                                  : 'text-amber-800'
                              }`}
                            >
                              {isClubOwner
                                ? Boolean(sessionClub?.excludeOwnerFromBilling)
                                  ? 'Cleared · Owner ($0)'
                                  : 'Cleared · Owner'
                                : isPaid
                                ? `Cleared · ${rsvp.paidMethod || 'Paid'}`
                                : isPending
                                ? `Pending · ${rsvp.paidMethod}`
                                : 'Unpaid'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </motion.div>
        )}

        {/* SECTION 4: INLINE PERSONAL PROFILE & PREFERENCES EDITOR */}
        {isSelf && sectionTab === 'settings' && (
          <motion.section
            key="settings"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 space-y-5 shadow-2xs"
          >
            <div className="pb-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 font-display">
                  Personal Profile Identity
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update your display name shown across rosters, matches, and standings.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500 font-medium">
                Player ID: {activePlayer.playerTag}
              </span>
            </div>

            <form onSubmit={handleSaveOwnProfileInline} className="space-y-4">
              <div className="max-w-md">
                <StyledInput
                  label="Display Name"
                  type="text"
                  required
                  maxLength={80}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                {savedProfileToast ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Profile saved</span>
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">
                    Changes sync immediately across rosters, matches, and standings
                  </span>
                )}
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="h-10 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                >
                  {isSavingProfile ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Confirmation Modal: Leave / Tap Out of Joined Session */}
      <ConfirmModal
        open={Boolean(pendingTapOutSession)}
        title={
          pendingTapOutSession?.isPenaltyWindow
            ? `Confirm Late Withdrawal (${pendingTapOutSession.penaltyPercent}% Penalty)?`
            : 'Leave Joined Session?'
        }
        description={
          pendingTapOutSession ? (
            pendingTapOutSession.isPenaltyWindow ? (
              <span>
                You are withdrawing from{' '}
                <strong className="text-slate-900">
                  {pendingTapOutSession.session.title}
                </strong>{' '}
                ({pendingTapOutSession.session.sessionDate}) inside the late
                cancellation window. A{' '}
                <strong className="text-amber-800">
                  {pendingTapOutSession.penaltyPercent}% court fee weight
                </strong>{' '}
                will still apply to your session split.
              </span>
            ) : (
              <span>
                Are you sure you want to withdraw from{' '}
                <strong className="text-slate-900">
                  {pendingTapOutSession.session.title}
                </strong>{' '}
                on {pendingTapOutSession.session.sessionDate} (
                {pendingTapOutSession.session.startTime}–
                {pendingTapOutSession.session.endTime})? You are within the free
                cancellation window ($0 fee).
              </span>
            )
          ) : null
        }
        confirmLabel={
          pendingTapOutSession?.isPenaltyWindow
            ? `Withdraw (${pendingTapOutSession.penaltyPercent}% Fee)`
            : 'Confirm Withdrawal'
        }
        variant={pendingTapOutSession?.isPenaltyWindow ? 'warning' : 'danger'}
        onCancel={() => setPendingTapOutSession(null)}
        onConfirm={async () => {
          if (!pendingTapOutSession) return;
          await onTapRsvp(
            pendingTapOutSession.session.id,
            activePlayer,
            pendingTapOutSession.status,
            pendingTapOutSession.penaltyPercent
          );
          setPendingTapOutSession(null);
        }}
      />

      {/* Confirmation Modal: Mark All Unpaid Sent */}
      <ConfirmModal
        open={confirmMarkAllPaidOpen}
        title="Mark All Unpaid Sessions as Paid?"
        description={
          <span>
            Notify the club owner/admin that you have transferred{' '}
            <strong className="text-slate-900 font-mono">
              ${financialStats.totalUnpaidAmount.toFixed(2)}
            </strong>{' '}
            across {financialStats.unpaidCount} unpaid session
            {financialStats.unpaidCount === 1 ? '' : 's'}?
          </span>
        }
        confirmLabel={`Confirm Sent ($${financialStats.totalUnpaidAmount.toFixed(2)})`}
        variant="primary"
        onCancel={() => setConfirmMarkAllPaidOpen(false)}
        onConfirm={async () => {
          await onNotifyPaymentSentAllForPlayer(
            activePlayer.id,
            preferredPaymentMethod
          );
          setConfirmMarkAllPaidOpen(false);
        }}
      />

      {/* Confirmation Modal: Toggle VIP Fee Waiver */}
      <ConfirmModal
        open={confirmToggleWaiverOpen}
        title={
          isWaived
            ? 'Disable VIP Complete Fee Waiver?'
            : 'Enable VIP Complete Fee Waiver?'
        }
        description={
          isWaived ? (
            <span>
              Disable VIP fee exemption for{' '}
              <strong className="text-slate-900">
                {targetRankedPlayer.name}
              </strong>
              ? Future finalized sessions will be billed normally.
            </span>
          ) : (
            <span>
              Enable complete VIP fee exemption for{' '}
              <strong className="text-slate-900">
                {targetRankedPlayer.name}
              </strong>
              ? All current unpaid and future session fees will be waived at $0.00.
            </span>
          )
        }
        confirmLabel={isWaived ? 'Disable Waiver' : 'Enable Waiver'}
        variant={isWaived ? 'warning' : 'primary'}
        onCancel={() => setConfirmToggleWaiverOpen(false)}
        onConfirm={() => {
          if (onUpdatePlayerWallet) {
            onUpdatePlayerWallet(
              targetRankedPlayer.id,
              {
                waiveAllFees: !isWaived,
              },
              activeClub.id
            );
          }
          setConfirmToggleWaiverOpen(false);
        }}
      />
    </div>
  );
};
