import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronDown,
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
  formatMatchSideLabel,
  getMatchSidePlayers,
  getPlayerClubWallet,
  getPlayerJoinedClubIds,
  getPlayerSideInMatch,
  getRsvpWalletLedger,
  isPlayerInMatch,
  sortMatchesNewestFirst,
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
  walletsMap?: Record<string, PlayerBenefitWallet>;
  canManageClub: boolean;
  isOwnerOfClubById?: (clubId?: string | null) => boolean;
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
    method?: string,
    clubId?: string
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
  singlesWinsAgainst: number;
  singlesLossesAgainst: number;
  doublesWinsAgainst: number;
  doublesLossesAgainst: number;
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
  walletsMap,
  canManageClub,
  isOwnerOfClubById,
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
  const [selectedWalletClubId, setSelectedWalletClubId] = useState<string>(
    activeClub.id
  );

  useEffect(() => {
    setSelectedWalletClubId(activeClub.id);
  }, [activeClub.id]);

  // Inline Profile & Preferences Editor State (for signed-in user)
  const [editName, setEditName] = useState(activePlayer.name);
  const [profileNameError, setProfileNameError] = useState<string | undefined>(
    undefined
  );
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [savedProfileToast, setSavedProfileToast] = useState(false);

  useEffect(() => {
    setEditName(activePlayer.name);
    setProfileNameError(undefined);
  }, [activePlayer.id]);

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
    if (!editName.trim()) {
      setProfileNameError('Please enter your display name.');
      return;
    }
    setProfileNameError(undefined);
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
    return sortMatchesNewestFirst(
      matches.filter((m) => isPlayerInMatch(m, targetRankedPlayer.id)),
      sessions
    );
  }, [matches, targetRankedPlayer.id, sessions]);

  // Compute current streak & recent form (last 5 games)
  const formSummary = useMemo(() => {
    const outcomes = playerMatches.map((m) => {
      const side = getPlayerSideInMatch(m, targetRankedPlayer.id);
      const inA = side === 'A';
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

  // Compute Singles vs. Doubles format-specific performance stats
  const formatBreakdown = useMemo(() => {
    const singlesWins = targetRankedPlayer.singlesWins || 0;
    const singlesLosses = targetRankedPlayer.singlesLosses || 0;
    const singlesGames = singlesWins + singlesLosses;
    const singlesWinRate =
      singlesGames > 0 ? Math.round((singlesWins / singlesGames) * 100) : 0;

    const doublesWins = targetRankedPlayer.doublesWins || 0;
    const doublesLosses = targetRankedPlayer.doublesLosses || 0;
    const doublesGames = doublesWins + doublesLosses;
    const doublesWinRate =
      doublesGames > 0 ? Math.round((doublesWins / doublesGames) * 100) : 0;

    let singlesPtsFor = targetRankedPlayer.singlesPointsScored ?? 0;
    let singlesPtsAgainst = targetRankedPlayer.singlesPointsConceded ?? 0;
    let doublesPtsFor = targetRankedPlayer.doublesPointsScored ?? 0;
    let doublesPtsAgainst = targetRankedPlayer.doublesPointsConceded ?? 0;

    if (
      singlesPtsFor + singlesPtsAgainst + doublesPtsFor + doublesPtsAgainst ===
        0 &&
      playerMatches.length > 0
    ) {
      playerMatches.forEach((m) => {
        const inA = getPlayerSideInMatch(m, targetRankedPlayer.id) === 'A';
        const myScore = inA ? m.scoreTeamA : m.scoreTeamB;
        const oppScore = inA ? m.scoreTeamB : m.scoreTeamA;
        if (m.matchFormat === 'doubles') {
          doublesPtsFor += myScore;
          doublesPtsAgainst += oppScore;
        } else {
          singlesPtsFor += myScore;
          singlesPtsAgainst += oppScore;
        }
      });
    }

    return {
      singlesGames,
      singlesWins,
      singlesLosses,
      singlesWinRate,
      singlesDiff: singlesPtsFor - singlesPtsAgainst,
      doublesGames,
      doublesWins,
      doublesLosses,
      doublesWinRate,
      doublesDiff: doublesPtsFor - doublesPtsAgainst,
    };
  }, [targetRankedPlayer, playerMatches]);

  // Compute Doubles Partner Chemistry & Head-to-Head Rivalries (accounting for both Singles & Doubles)
  const { partnerRecords, rivalRecords, headToHeadVsActive } = useMemo(() => {
    const partners = new Map<string, PartnerRecord>();
    const rivals = new Map<string, RivalRecord>();

    let togetherWins = 0;
    let togetherLosses = 0;
    let vsWins = 0;
    let vsLosses = 0;
    let singlesVsWins = 0;
    let singlesVsLosses = 0;
    let doublesVsWins = 0;
    let doublesVsLosses = 0;

    playerMatches.forEach((m) => {
      const mySide = getPlayerSideInMatch(m, targetRankedPlayer.id);
      if (!mySide) return;
      const inA = mySide === 'A';
      const oppSide: 'A' | 'B' = inA ? 'B' : 'A';
      const won =
        (inA && m.winnerSide === 'A') || (!inA && m.winnerSide === 'B');
      const myScore = inA ? m.scoreTeamA : m.scoreTeamB;
      const oppScore = inA ? m.scoreTeamB : m.scoreTeamA;
      const diff = myScore - oppScore;
      const isDoubles = m.matchFormat === 'doubles';

      // Partner tracking strictly for doubles matches using validated side players
      if (isDoubles) {
        const mySidePlayers = getMatchSidePlayers(m, mySide);
        const partner = mySidePlayers.find(
          (p) => p.id !== targetRankedPlayer.id
        );

        if (partner) {
          const pInfo = playerLookup.get(partner.id);
          const existing = partners.get(partner.id) || {
            partnerId: partner.id,
            partnerName: pInfo?.name || partner.name,
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
          partners.set(partner.id, existing);

          if (!isSelf && partner.id === activePlayer.id) {
            if (won) togetherWins += 1;
            else togetherLosses += 1;
          }
        }
      }

      // Opponent tracking for both singles (1 opponent) and doubles (2 opponents), never 'NONE'
      const opponents = getMatchSidePlayers(m, oppSide);

      opponents.forEach((opp) => {
        const oInfo = playerLookup.get(opp.id);
        const existing = rivals.get(opp.id) || {
          opponentId: opp.id,
          opponentName: oInfo?.name || opp.name,
          opponentTag: oInfo?.playerTag || '',
          opponentTier: oInfo?.tier || 'B',
          gamesAgainst: 0,
          winsAgainst: 0,
          lossesAgainst: 0,
          singlesWinsAgainst: 0,
          singlesLossesAgainst: 0,
          doublesWinsAgainst: 0,
          doublesLossesAgainst: 0,
          winRateAgainst: 0,
          netPointDiff: 0,
        };
        existing.gamesAgainst += 1;
        if (won) {
          existing.winsAgainst += 1;
          if (isDoubles) existing.doublesWinsAgainst += 1;
          else existing.singlesWinsAgainst += 1;
        } else {
          existing.lossesAgainst += 1;
          if (isDoubles) existing.doublesLossesAgainst += 1;
          else existing.singlesLossesAgainst += 1;
        }
        existing.netPointDiff += diff;
        existing.winRateAgainst = Math.round(
          (existing.winsAgainst / existing.gamesAgainst) * 100
        );
        rivals.set(opp.id, existing);

        if (!isSelf && opp.id === activePlayer.id) {
          if (won) {
            vsWins += 1;
            if (isDoubles) doublesVsWins += 1;
            else singlesVsWins += 1;
          } else {
            vsLosses += 1;
            if (isDoubles) doublesVsLosses += 1;
            else singlesVsLosses += 1;
          }
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
        singlesVsWins,
        singlesVsLosses,
        doublesVsWins,
        doublesVsLosses,
      },
    };
  }, [playerMatches, targetRankedPlayer.id, playerLookup, isSelf, activePlayer.id]);

  // Filtered match list for Match History tab
  const filteredPlayerMatches = useMemo(() => {
    return playerMatches.filter((m) => {
      if (matchFormatFilter !== 'all' && m.matchFormat !== matchFormatFilter) {
        return false;
      }
      const inA = getPlayerSideInMatch(m, targetRankedPlayer.id) === 'A';
      const won =
        (inA && m.winnerSide === 'A') || (!inA && m.winnerSide === 'B');
      if (matchOutcomeFilter === 'won' && !won) return false;
      if (matchOutcomeFilter === 'lost' && won) return false;

      if (matchSearchQuery.trim()) {
        const q = matchSearchQuery.trim().toLowerCase();
        const sess = sessionMap.get(m.sessionId);
        const text = [
          formatMatchSideLabel(m, 'A'),
          formatMatchSideLabel(m, 'B'),
          m.matchFormat,
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

      const ledger = getRsvpWalletLedger(rsvp);
      const hadChargeableShare =
        rsvp.feeShare > 0 ||
        ledger.grossFeeShare > 0 ||
        ledger.walletCreditApplied > 0 ||
        ledger.walletPassApplied ||
        ledger.walletWaiverApplied;

      if (session.feeSplitFinalized && (hadChargeableShare || isClubOwner)) {
        if (isClubOwner || rsvp.paidStatus === 'paid') {
          paidCount += 1;
          if (
            isClubOwner ||
            ledger.walletPassApplied ||
            ledger.walletWaiverApplied ||
            rsvp.paidMethod.includes('Waived') ||
            rsvp.paidMethod.includes('Free Session') ||
            rsvp.paidMethod.includes('Club Owner')
          ) {
            waivedOrPassSessionsCount += 1;
          } else {
            totalPaidAmount += rsvp.feeShare;
            if (ledger.walletCreditApplied > 0 && rsvp.feeShare === 0) {
              waivedOrPassSessionsCount += 1;
            }
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

  const playerJoinedClubs = useMemo(() => {
    const joinedSet = new Set(getPlayerJoinedClubIds(targetRankedPlayer));
    if (walletsMap) {
      const prefix = `${targetRankedPlayer.id}::`;
      Object.keys(walletsMap).forEach((key) => {
        if (key.startsWith(prefix)) {
          const cid = key.slice(prefix.length);
          if (cid) joinedSet.add(cid);
        }
      });
    }
    rsvps.forEach((r) => {
      if (r.playerId === targetRankedPlayer.id) {
        const s = sessionMap.get(r.sessionId);
        if (s?.clubId) joinedSet.add(s.clubId);
      }
    });
    const list = clubs.filter(
      (c) =>
        joinedSet.has(c.id) || c.clubOwnerPlayerId === targetRankedPlayer.id
    );
    return list.length > 0 ? list : [activeClub];
  }, [targetRankedPlayer, walletsMap, rsvps, sessionMap, clubs, activeClub]);

  const joinedClubNames = useMemo(
    () => playerJoinedClubs.map((c) => c.name),
    [playerJoinedClubs]
  );

  const selectedWalletClub = useMemo(
    () =>
      playerJoinedClubs.find((c) => c.id === selectedWalletClubId) ||
      playerJoinedClubs.find((c) => c.id === activeClub.id) ||
      playerJoinedClubs[0] ||
      activeClub,
    [playerJoinedClubs, selectedWalletClubId, activeClub]
  );

  const canManageSelectedWalletClub = isOwnerOfClubById
    ? isOwnerOfClubById(selectedWalletClub.id)
    : canManageClub && selectedWalletClub.id === activeClub.id;

  const activeClubWallet = getPlayerClubWallet(
    targetRankedPlayer,
    selectedWalletClub.id,
    walletsMap
  );
  const creditBal = Math.max(0, Number(activeClubWallet.creditBalance || 0));
  const freePasses = Math.max(
    0,
    Math.floor(Number(activeClubWallet.freeSessionPasses || 0))
  );
  const isWaived = Boolean(activeClubWallet.waiveAllFees);

  const selectedClubUnpaidRecords = useMemo(
    () =>
      pastSessionRecords.filter(({ session, rsvp }) => {
        if (!rsvp || session.clubId !== selectedWalletClub.id) return false;
        const sessionClub = clubMap.get(session.clubId);
        const isClubOwner =
          sessionClub?.clubOwnerPlayerId === targetRankedPlayer.id;
        return (
          session.feeSplitFinalized &&
          !isClubOwner &&
          rsvp.paidStatus === 'unpaid' &&
          rsvp.feeShare > 0
        );
      }),
    [pastSessionRecords, selectedWalletClub.id, clubMap, targetRankedPlayer.id]
  );

  const selectedClubUnpaidAmount = useMemo(
    () =>
      selectedClubUnpaidRecords.reduce(
        (sum, item) => sum + (item.rsvp?.feeShare || 0),
        0
      ),
    [selectedClubUnpaidRecords]
  );

  // Scoped metrics, sessions, and ledger records for the selected club in Fees, Wallet & Sessions tab
  const {
    selectedClubUpcomingSessions,
    selectedClubPastSessionRecords,
    selectedClubAttendanceStats,
    selectedClubFinancialStats,
    perClubSummaryMap,
  } = useMemo(() => {
    const computeForClub = (clubId: string) => {
      const clubUpcoming = upcomingSessionsWithRsvp.filter(
        ({ session }) => session.clubId === clubId
      );
      const clubPast = pastSessionRecords.filter(
        ({ session }) => session.clubId === clubId
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

      clubPast.forEach(({ session, rsvp }) => {
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

        const ledger = getRsvpWalletLedger(rsvp);
        const hadChargeableShare =
          rsvp.feeShare > 0 ||
          ledger.grossFeeShare > 0 ||
          ledger.walletCreditApplied > 0 ||
          ledger.walletPassApplied ||
          ledger.walletWaiverApplied;

        if (session.feeSplitFinalized && (hadChargeableShare || isClubOwner)) {
          if (isClubOwner || rsvp.paidStatus === 'paid') {
            paidCount += 1;
            if (
              isClubOwner ||
              ledger.walletPassApplied ||
              ledger.walletWaiverApplied ||
              rsvp.paidMethod.includes('Waived') ||
              rsvp.paidMethod.includes('Free Session') ||
              rsvp.paidMethod.includes('Club Owner')
            ) {
              waivedOrPassSessionsCount += 1;
            } else {
              totalPaidAmount += rsvp.feeShare;
              if (ledger.walletCreditApplied > 0 && rsvp.feeShare === 0) {
                waivedOrPassSessionsCount += 1;
              }
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
        clubUpcoming,
        clubPast,
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
    };

    const summaryMap = new Map<
      string,
      ReturnType<typeof computeForClub>
    >();
    playerJoinedClubs.forEach((c) => {
      summaryMap.set(c.id, computeForClub(c.id));
    });

    const current =
      summaryMap.get(selectedWalletClub.id) ||
      computeForClub(selectedWalletClub.id);

    return {
      selectedClubUpcomingSessions: current.clubUpcoming,
      selectedClubPastSessionRecords: current.clubPast,
      selectedClubAttendanceStats: current.attendanceStats,
      selectedClubFinancialStats: current.financialStats,
      perClubSummaryMap: summaryMap,
    };
  }, [
    upcomingSessionsWithRsvp,
    pastSessionRecords,
    clubMap,
    targetRankedPlayer.id,
    playerJoinedClubs,
    selectedWalletClub.id,
  ]);

  // Only the player themselves or an authorized club owner/admin can view/manage member balances & wallets
  const canViewWalletAndLedger =
    isSelf || canManageClub || canManageSelectedWalletClub;

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
                        label: 'Fees, Wallet & Sessions',
                        count:
                          selectedClubUpcomingSessions.length +
                          selectedClubPastSessionRecords.length,
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
                </strong>{' '}
                <span className="text-slate-500 text-[11px]">
                  (S {headToHeadVsActive.singlesVsWins}–
                  {headToHeadVsActive.singlesVsLosses} · D{' '}
                  {headToHeadVsActive.doublesVsWins}–
                  {headToHeadVsActive.doublesVsLosses})
                </span>
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
            {/* Singles & Doubles Format Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex items-center justify-between gap-4 shadow-2xs">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-900 block font-display">
                    Singles Record
                  </span>
                  <span className="text-[11px] text-slate-600 font-mono tabular-nums block">
                    {formatBreakdown.singlesGames}{' '}
                    {formatBreakdown.singlesGames === 1 ? 'match' : 'matches'} ·
                    Net diff{' '}
                    {formatBreakdown.singlesDiff >= 0
                      ? `+${formatBreakdown.singlesDiff}`
                      : formatBreakdown.singlesDiff}
                  </span>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <span className="text-base font-bold text-slate-900 block">
                    {formatBreakdown.singlesWins}W–
                    {formatBreakdown.singlesLosses}L
                  </span>
                  <span className="text-[11px] text-emerald-700 font-semibold">
                    {formatBreakdown.singlesWinRate}% win rate
                  </span>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 flex items-center justify-between gap-4 shadow-2xs">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-900 block font-display">
                    Doubles Record
                  </span>
                  <span className="text-[11px] text-slate-600 font-mono tabular-nums block">
                    {formatBreakdown.doublesGames}{' '}
                    {formatBreakdown.doublesGames === 1 ? 'match' : 'matches'} ·
                    Net diff{' '}
                    {formatBreakdown.doublesDiff >= 0
                      ? `+${formatBreakdown.doublesDiff}`
                      : formatBreakdown.doublesDiff}
                  </span>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <span className="text-base font-bold text-slate-900 block">
                    {formatBreakdown.doublesWins}W–
                    {formatBreakdown.doublesLosses}L
                  </span>
                  <span className="text-[11px] text-emerald-700 font-semibold">
                    {formatBreakdown.doublesWinRate}% win rate
                  </span>
                </div>
              </div>
            </div>

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
                    Win–loss record and point differential against singles and
                    doubles court opponents.
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
                      const playedSingles =
                        rr.singlesWinsAgainst + rr.singlesLossesAgainst > 0;
                      const playedDoubles =
                        rr.doublesWinsAgainst + rr.doublesLossesAgainst > 0;
                      const formatSummaryText =
                        playedSingles && playedDoubles
                          ? `S ${rr.singlesWinsAgainst}–${rr.singlesLossesAgainst} · D ${rr.doublesWinsAgainst}–${rr.doublesLossesAgainst}`
                          : playedSingles
                          ? `Singles ${rr.singlesWinsAgainst}–${rr.singlesLossesAgainst}`
                          : `Doubles ${rr.doublesWinsAgainst}–${rr.doublesLossesAgainst}`;

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
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 mt-0.5 font-mono tabular-nums">
                              <span>Tier {rr.opponentTier}</span>
                              <span aria-hidden="true">·</span>
                              <span>{formatSummaryText}</span>
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
                        getPlayerSideInMatch(m, targetRankedPlayer.id) === 'A';
                      const won =
                        (inA && m.winnerSide === 'A') ||
                        (!inA && m.winnerSide === 'B');
                      const sess = sessionMap.get(m.sessionId);
                      const sideA = formatMatchSideLabel(m, 'A');
                      const sideB = formatMatchSideLabel(m, 'B');

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
                    getPlayerSideInMatch(m, targetRankedPlayer.id) === 'A';
                  const won =
                    (inA && m.winnerSide === 'A') ||
                    (!inA && m.winnerSide === 'B');
                  const myScore = inA ? m.scoreTeamA : m.scoreTeamB;
                  const oppScore = inA ? m.scoreTeamB : m.scoreTeamA;
                  const diff = myScore - oppScore;
                  const sess = sessionMap.get(m.sessionId);

                  const myTeamLabel = formatMatchSideLabel(m, inA ? 'A' : 'B');
                  const oppTeamLabel = formatMatchSideLabel(m, inA ? 'B' : 'A');

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
            {/* Inside-Section Club Selector Bar */}
            <section className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      Club Ledger &amp; Session Scope
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Select a club to view its court fee balances, member benefit wallet, upcoming sessions, and attendance ledger.
                  </p>
                </div>

                <div className="flex flex-col sm:items-end gap-1.5 shrink-0">
                  <label
                    htmlFor="profile-section-club-dropdown"
                    className="text-[11px] font-semibold text-slate-600"
                  >
                    Viewing Club ({playerJoinedClubs.length}{' '}
                    {playerJoinedClubs.length === 1 ? 'Club' : 'Clubs'} Joined)
                  </label>
                  <div className="relative min-w-[240px] sm:min-w-[280px]">
                    <select
                      id="profile-section-club-dropdown"
                      aria-label="Select Club for Fees, Wallet & Sessions"
                      value={selectedWalletClub.id}
                      onChange={(e) => setSelectedWalletClubId(e.target.value)}
                      className="w-full h-10 pl-3.5 pr-9 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-300 text-xs sm:text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-600 transition-colors appearance-none cursor-pointer"
                    >
                      {playerJoinedClubs.map((clubItem) => {
                        const stats = perClubSummaryMap.get(clubItem.id);
                        const unpaid =
                          stats?.financialStats.totalUnpaidAmount || 0;
                        const upcomingCnt = stats?.clubUpcoming.length || 0;
                        const suffixParts: string[] = [];
                        if (unpaid > 0) {
                          suffixParts.push(`$${unpaid.toFixed(2)} due`);
                        }
                        if (upcomingCnt > 0) {
                          suffixParts.push(`${upcomingCnt} upcoming`);
                        }
                        const suffix =
                          suffixParts.length > 0
                            ? ` (${suffixParts.join(' · ')})`
                            : '';
                        return (
                          <option key={clubItem.id} value={clubItem.id}>
                            {clubItem.name}
                            {suffix}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-500 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span>
                    Owner:{' '}
                    <strong className="font-semibold text-slate-800">
                      {selectedWalletClub.clubOwnerName || 'Club Organizer'}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Access:{' '}
                    <strong className="font-semibold text-slate-800">
                      {selectedWalletClub.visibility === 'private'
                        ? 'Private Club'
                        : 'Public Club'}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Withdrawal Policy:{' '}
                    <strong className="font-semibold text-slate-800">
                      Free &gt;{selectedWalletClub.freeCancelHours}h prior ·{' '}
                      {selectedWalletClub.lateCancelFeePercent}% fee &lt;
                      {selectedWalletClub.freeCancelHours}h · No-Show{' '}
                      {selectedWalletClub.noShowFeePercent}%
                    </strong>
                  </span>
                </div>

                {financialStats.totalUnpaidAmount >
                  selectedClubFinancialStats.totalUnpaidAmount && (
                  <span className="font-semibold text-amber-800 bg-amber-50 border border-amber-200/80 px-2.5 py-0.5 rounded-lg">
                    +$
                    {(
                      financialStats.totalUnpaidAmount -
                      selectedClubFinancialStats.totalUnpaidAmount
                    ).toFixed(2)}{' '}
                    unpaid in other clubs
                  </span>
                )}
              </div>
            </section>

            {/* Member Balance Summary Strip (Scoped to Selected Club) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-600 block">
                  Unpaid / Due ({selectedWalletClub.name})
                </span>
                <span
                  className={`font-mono tabular-nums text-lg font-bold block ${
                    selectedClubFinancialStats.totalUnpaidAmount > 0
                      ? 'text-amber-700'
                      : 'text-slate-900'
                  }`}
                >
                  ${selectedClubFinancialStats.totalUnpaidAmount.toFixed(2)}
                </span>
                <span className="text-[11px] text-slate-600 block">
                  {selectedClubFinancialStats.unpaidCount === 0
                    ? `All settled in ${selectedWalletClub.name}`
                    : `${selectedClubFinancialStats.unpaidCount} unpaid session${
                        selectedClubFinancialStats.unpaidCount === 1 ? '' : 's'
                      }`}
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-600 block">
                  Paid / Received ({selectedWalletClub.name})
                </span>
                <span className="font-mono tabular-nums text-lg font-bold text-emerald-700 block">
                  ${selectedClubFinancialStats.totalPaidAmount.toFixed(2)}
                </span>
                <span className="text-[11px] text-slate-600 block">
                  {selectedClubFinancialStats.paidCount} cleared session
                  {selectedClubFinancialStats.paidCount === 1 ? '' : 's'}
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-600 block">
                  Pending Confirmation
                </span>
                <span className="font-mono tabular-nums text-lg font-bold text-blue-700 block">
                  ${selectedClubFinancialStats.totalPendingAmount.toFixed(2)}
                </span>
                <span className="text-[11px] text-slate-600 block">
                  {selectedClubFinancialStats.pendingCount} awaiting check
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-1 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-600 block">
                  Attendance &amp; Reliability
                </span>
                <span className="font-mono tabular-nums text-lg font-bold text-slate-900 block">
                  {selectedClubAttendanceStats.attendedCount} Attended
                </span>
                <span className="text-[11px] text-slate-600 block">
                  {selectedClubAttendanceStats.reliabilityRate}% reliable ·{' '}
                  {selectedClubAttendanceStats.noShowCount} no-show
                </span>
              </div>
            </div>

            {/* Upcoming Club Sessions with Direct 1-Tap RSVP (Scoped to Selected Club) */}
            <section className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-2xs">
              <div>
                <h3 className="text-sm font-bold text-slate-900 font-display">
                  {selectedWalletClub.name} · Upcoming Sessions &amp; Active RSVPs (
                  {selectedClubUpcomingSessions.length})
                </h3>
                <p className="text-xs text-slate-500">
                  {isSelf
                    ? `Manage your upcoming ${selectedWalletClub.name} session attendance directly from your profile. Late withdrawals incur a ${selectedWalletClub.lateCancelFeePercent}% court fee penalty instead of a full ${selectedWalletClub.noShowFeePercent}% no-show charge.`
                    : `Upcoming ${selectedWalletClub.name} session schedule for ${targetRankedPlayer.name}.`}
                </p>
              </div>

              {selectedClubUpcomingSessions.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  No upcoming uncompleted sessions scheduled in{' '}
                  {selectedWalletClub.name}.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {selectedClubUpcomingSessions.map(({ session, rsvp }) => {
                    const sessionClub =
                      clubMap.get(session.clubId) || selectedWalletClub;
                    const policy = evaluateTapOutWindow(session, sessionClub);
                    const isGoing = rsvp?.status === 'going';
                    const isLateOut = rsvp?.status === 'late_out';
                    const isOut = rsvp?.status === 'out' || isLateOut;

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
                                  : isLateOut
                                  ? 'text-amber-800'
                                  : isOut
                                  ? 'text-slate-500'
                                  : 'text-amber-800'
                              }`}
                            >
                              {isGoing
                                ? 'Going'
                                : isLateOut
                                ? `Tapped Out (${
                                    rsvp?.penaltyPercentApplied ??
                                    sessionClub.lateCancelFeePercent
                                  }% Penalty)`
                                : isOut
                                ? 'Tapped Out'
                                : 'Not Responded'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {session.venue} ({session.courtNumbers}) · Court Fee $
                            {session.courtFee.toFixed(2)} ·{' '}
                            <span
                              className={
                                policy.isPenaltyWindow
                                  ? 'text-amber-700 font-medium'
                                  : 'text-slate-500'
                              }
                            >
                              {policy.policySummary}
                            </span>
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
                              ) : (
                                <button
                                  type="button"
                                  disabled={!policy.canTapOut}
                                  title={
                                    policy.canTapOut
                                      ? undefined
                                      : policy.policySummary
                                  }
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
                                  className={`h-8 px-3.5 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs ${
                                    policy.isPenaltyWindow
                                      ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                                      : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  {!policy.canTapOut
                                    ? 'Locked'
                                    : policy.isPenaltyWindow
                                    ? `Leave (${policy.penaltyPercent}% Penalty)`
                                    : 'Leave (Free)'}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Active Member Wallet & Perks Card (Scoped per Joined Club) */}
            <section className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 font-display">
                    <Gift className="w-4 h-4 text-emerald-600" />
                    <span>
                      {selectedWalletClub.name} · Member Credits, Free Passes &amp; Fee Waivers
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Each club maintains its own separate wallet and balance. Perks apply automatically when {selectedWalletClub.name} session splits are finalized.
                  </p>
                </div>

                {isSelf && selectedClubUnpaidAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmMarkAllPaidOpen(true)}
                    className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      Mark {selectedWalletClub.name} Unpaid Sent ($
                      {selectedClubUnpaidAmount.toFixed(2)})
                    </span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Card 1: Prepaid Club Credit */}
                <div className="bg-slate-50/70 rounded-xl border border-slate-200/80 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium">
                      {selectedWalletClub.name} Credit
                    </span>
                    <span className="font-mono tabular-nums text-lg font-bold text-sky-700">
                      ${creditBal.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Deducts dollar-for-dollar against finalized court &amp;
                    shuttle fee splits in {selectedWalletClub.name}.
                  </p>
                  {canManageSelectedWalletClub && onUpdatePlayerWallet && (
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
                                selectedWalletClub.id
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
                              selectedWalletClub.id
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
                    completion in {selectedWalletClub.name}.
                  </p>
                  {canManageSelectedWalletClub && onUpdatePlayerWallet && (
                    <div className="pt-2 border-t border-slate-200/70 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdatePlayerWallet(
                            targetRankedPlayer.id,
                            {
                              freeSessionPasses: Math.max(0, freePasses - 1),
                            },
                            selectedWalletClub.id
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
                              selectedWalletClub.id
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
                      Exempts member from all unpaid and future session fees in {selectedWalletClub.name}.
                    </p>
                  </div>

                  {canManageSelectedWalletClub && onUpdatePlayerWallet && (
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

            {/* Chronological Personal Fee & Settlement Ledger (Scoped to Selected Club) */}
            <section className="bg-white rounded-2xl border border-slate-200/90 p-5 space-y-4 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 font-display">
                    {selectedWalletClub.name} · Personal Session Fee &amp; Receipt Ledger ({selectedClubPastSessionRecords.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    {selectedWalletClub.name} Paid: $
                    {selectedClubFinancialStats.totalPaidAmount.toFixed(2)} ·
                    Waived/Pass Sessions:{' '}
                    {selectedClubFinancialStats.waivedOrPassSessionsCount} ·
                    Unpaid: $
                    {selectedClubFinancialStats.totalUnpaidAmount.toFixed(2)}
                  </p>
                </div>
              </div>

              {selectedClubPastSessionRecords.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">
                  No completed session fee records found in{' '}
                  {selectedWalletClub.name}.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {selectedClubPastSessionRecords.map(({ session, rsvp }) => {
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
                            {sessionClub && (
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200/80 text-[11px] font-semibold text-slate-700">
                                {sessionClub.name}
                              </span>
                            )}
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

            <form
              noValidate
              onSubmit={handleSaveOwnProfileInline}
              className="space-y-4"
            >
              <div className="max-w-md">
                <StyledInput
                  label="Display Name"
                  type="text"
                  maxLength={80}
                  value={editName}
                  error={profileNameError}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    if (profileNameError) setProfileNameError(undefined);
                  }}
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

      {/* Confirmation Modal: Mark All Unpaid Sent (Scoped to Selected Club) */}
      <ConfirmModal
        open={confirmMarkAllPaidOpen}
        title={`Mark ${selectedWalletClub.name} Unpaid Sessions as Paid?`}
        description={
          <span>
            Notify <strong className="text-slate-900">{selectedWalletClub.name}</strong>&apos;s club owner that you have transferred{' '}
            <strong className="text-slate-900 font-mono">
              ${selectedClubUnpaidAmount.toFixed(2)}
            </strong>{' '}
            across {selectedClubUnpaidRecords.length} unpaid session
            {selectedClubUnpaidRecords.length === 1 ? '' : 's'} in{' '}
            <strong className="text-slate-900">{selectedWalletClub.name}</strong>?
          </span>
        }
        confirmLabel={`Confirm Sent ($${selectedClubUnpaidAmount.toFixed(2)})`}
        variant="primary"
        onCancel={() => setConfirmMarkAllPaidOpen(false)}
        onConfirm={async () => {
          await onNotifyPaymentSentAllForPlayer(
            activePlayer.id,
            preferredPaymentMethod,
            selectedWalletClub.id
          );
          setConfirmMarkAllPaidOpen(false);
        }}
      />

      {/* Confirmation Modal: Toggle VIP Fee Waiver */}
      <ConfirmModal
        open={confirmToggleWaiverOpen}
        title={
          isWaived
            ? `Disable VIP Complete Fee Waiver in ${selectedWalletClub.name}?`
            : `Enable VIP Complete Fee Waiver in ${selectedWalletClub.name}?`
        }
        description={
          isWaived ? (
            <span>
              Disable VIP fee exemption for{' '}
              <strong className="text-slate-900">
                {targetRankedPlayer.name}
              </strong>{' '}
              in <strong className="text-slate-900">{selectedWalletClub.name}</strong>
              ? Future finalized sessions in this club will be billed normally.
            </span>
          ) : (
            <span>
              Enable complete VIP fee exemption for{' '}
              <strong className="text-slate-900">
                {targetRankedPlayer.name}
              </strong>{' '}
              in <strong className="text-slate-900">{selectedWalletClub.name}</strong>
              ? All current unpaid and future session fees in this club will be waived at $0.00.
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
              selectedWalletClub.id
            );
          }
          setConfirmToggleWaiverOpen(false);
        }}
      />
    </div>
  );
};
