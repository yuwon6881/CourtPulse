export type BookingStatus = 'pending' | 'booked' | 'in_play' | 'completed';
export type RsvpStatus = 'going' | 'out' | 'late_out';
export type AttendanceOutcome = 'present' | 'no_show' | 'excused';
export type PaidStatus = 'unpaid' | 'pending_approval' | 'paid';
export type MatchFormat = 'singles' | 'doubles';
export type WinnerSide = 'A' | 'B';
export type TierRank = 'S' | 'A' | 'B' | 'C';
export type PermissionTier = 'user' | 'club_owner' | 'admin';
export type ClubVisibility = 'public' | 'private';

export interface ClubPaymentDetails {
  recipientName: string;
  phoneNumber: string;
  bankName: string;
  bankAccountNumber: string;
  paymentNotes: string;
}

export interface Club {
  id: string;
  name: string;
  description: string;
  paymentInfo: string;
  paymentDetails?: ClubPaymentDetails;
  paymentDetailsJson?: string;
  freeCancelHours: number;
  lockCancelHours: number;
  lateCancelFeePercent: number;
  noShowFeePercent: number;
  excludeOwnerFromBilling?: boolean;
  /** Default target points per match for this club (e.g. 11, 15, 21, 30). Matches with lower or custom scores can always be logged. */
  defaultMatchTargetPoints?: number;
  /** Public clubs can be joined instantly; private clubs require owner approval. */
  visibility?: ClubVisibility;
  /**
   * IANA timezone the club's session times and cancel deadlines are read in (1..64 chars).
   * Missing means DEFAULT_CLUB_TIMEZONE ('Asia/Singapore').
   */
  timezone?: string;
  ownerId: string;
  /** Player who owns the club (stored in Firestore; enforced by the rules). */
  ownerPlayerId?: string;
  clubOwnerPlayerId?: string;
  clubOwnerName?: string;
  currency?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClubJoinRequest {
  id: string;
  clubId: string;
  playerId: string;
  playerName: string;
  playerTag: string;
  requestedAt: string;
}

export type PaymentTiming = 'before' | 'after';

export interface Session {
  id: string;
  clubId: string;
  title: string;
  venue: string;
  courtNumbers: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  bookingStatus: BookingStatus;
  courtFee: number;
  shuttlesUsed: number;
  shuttleUnitCost: number;
  shuttleFee: number;
  maxPlayers: number;
  organizerName: string;
  paymentInfo: string;
  feeSplitFinalized: boolean;
  /**
   * When the host collects payment: 'before' the match (players pay their estimated share up
   * front) or 'after' it (the default; shares are only billed once the split is finalized).
   * Absent on older sessions, which read as 'after'.
   */
  paymentTiming?: PaymentTiming;
  /**
   * Exact UTC start instant (sessionDate + startTime read in the CLUB timezone). Written by managers
   * only; the Firestore rules measure join/cancel windows from it and deny player self-actions when
   * it is missing. Held in memory as a Date (or epoch ms / Timestamp-like); written as a Timestamp.
   */
  startsAt?: Date | number | { toMillis(): number } | null;
  /** startsAt - club.lockCancelHours: last instant a (late) cancel is accepted. Manager-written. */
  lateCancelUntil?: Date | number | { toMillis(): number } | null;
  /**
   * startsAt - club.freeCancelHours: last instant a FREE cancel is accepted. Absent when the club
   * has no free-cancel period (freeCancelHours 0). Manager-written.
   */
  freeCancelUntil?: Date | number | { toMillis(): number } | null;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PlayerBenefitWallet {
  creditBalance: number;
  freeSessionPasses: number;
  waiveAllFees: boolean;
}

export interface ClubWalletDoc {
  id: string;
  clubId: string;
  playerId: string;
  creditBalance: number;
  freeSessionPasses: number;
  waiveAllFees: boolean;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Player {
  id: string;
  name: string;
  playerTag: string;
  joinedClubIdsCsv: string;
  wins: number;
  losses: number;
  gamesPlayed: number;
  pointsScored: number;
  pointsConceded: number;
  singlesWins: number;
  singlesLosses: number;
  doublesWins: number;
  doublesLosses: number;
  ratingScore: number;
  /** Firebase Auth uid of the account this profile belongs to ('' / absent = not linked yet). */
  authUid?: string;
  /** Club context of the last membership change or owner edit (checked by the Firestore rules). */
  actingClubId?: string;
  /** Match whose result last updated this player's stats (checked by the Firestore rules). */
  lastMatchId?: string;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SessionRsvp {
  id: string;
  clubId: string;
  sessionId: string;
  playerId: string;
  playerName: string;
  guestCount?: number;
  guestNames?: string;
  status: RsvpStatus;
  attendanceOutcome: AttendanceOutcome;
  penaltyPercentApplied: number;
  feeShare: number;
  grossFeeShare?: number;
  walletCreditApplied?: number;
  walletPassApplied?: boolean;
  walletWaiverApplied?: boolean;
  paidStatus: PaidStatus;
  paidMethod: string;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BadmintonMatch {
  id: string;
  clubId: string;
  sessionId: string;
  matchFormat: MatchFormat;
  teamAPlayer1Id: string;
  teamAPlayer1Name: string;
  teamAPlayer2Id: string;
  teamAPlayer2Name: string;
  teamBPlayer1Id: string;
  teamBPlayer1Name: string;
  teamBPlayer2Id: string;
  teamBPlayer2Name: string;
  scoreTeamA: number;
  scoreTeamB: number;
  setScoresText: string;
  winnerSide: WinnerSide;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CachedPlayerIdentity {
  playerId: string;
  name: string;
  playerTag: string;
  linkedAccountEmail?: string;
  isAdminAccount?: boolean;
  permissionTier?: PermissionTier;
  lastRecognizedAt: string;
}

export interface RankedPlayer extends Player {
  rank: number;
  winRate: number;
  pointDiff: number;
  avgPointDiff: number;
  pointsShare: number;
  singlesPointsScored?: number;
  singlesPointsConceded?: number;
  doublesPointsScored?: number;
  doublesPointsConceded?: number;
  tier: TierRank;
  tierTitle: string;
  recentForm: ('W' | 'L')[];
}

export interface OutstandingDebtItem {
  rsvp: SessionRsvp;
  session: Session;
}

export interface ParsedQuickSession {
  title: string;
  venue: string;
  courtNumbers: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  courtFee: number;
  /** True when the court fee was typed in the summary rather than taken from defaults. */
  courtFeeFromText: boolean;
  maxPlayers: number;
  bookingStatus: BookingStatus;
}

/** Where "now" sits relative to a session's cancel windows (see evaluateTapOutWindow). */
export type CancelPhase = 'free' | 'late' | 'locked' | 'started' | 'unavailable';

export interface TapOutPolicyEvaluation {
  hoursUntilStart: number;
  canTapOut: boolean;
  isPenaltyWindow: boolean;
  penaltyPercent: number;
  policySummary: string;
  phase: CancelPhase;
  /** True only in the free window: a free cancel and a +1 guest decrease are allowed. */
  canFreeCancel: boolean;
  /** Session start instant used for the windows (the stored startsAt); null when unknown. */
  startMs: number | null;
  /** Last instant a FREE cancel is accepted; null when the club has no free window. */
  freeDeadlineMs: number | null;
  /** Last instant any cancel is accepted; null when the start is unknown. */
  lockDeadlineMs: number | null;
  /** Club timezone the deadlines should be displayed in. */
  timeZone: string;
}

export type RotationPace = 'competitive' | 'standard' | 'social';

export * from './types/equipment';

