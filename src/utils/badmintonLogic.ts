import {
  BadmintonMatch,
  BookingStatus,
  CachedPlayerIdentity,
  Club,
  ClubPaymentDetails,
  OutstandingDebtItem,
  PaidStatus,
  ParsedQuickSession,
  Player,
  PlayerBenefitWallet,
  RankedPlayer,
  Session,
  SessionRsvp,
  TapOutPolicyEvaluation,
  TierRank,
} from '../types';

export const CACHED_PLAYER_STORAGE_KEY = 'courtpulse_auth_account_v3';
export const LOCAL_STATE_STORAGE_KEY = 'courtpulse_club_state_v5';
export const CLUB_OWNER_MAP_STORAGE_KEY = 'courtpulse_club_owners_v3';
export const CLUB_PAYMENT_DETAILS_STORAGE_KEY = 'courtpulse_club_payments_v1';
export const CLUB_BILLING_RULES_STORAGE_KEY = 'courtpulse_club_billing_rules_v1';
export const PLAYER_WALLETS_STORAGE_KEY = 'courtpulse_player_wallets_v1';
export const ADMIN_EMAIL = 'yuwon6881@gmail.com';

export function formatClubPaymentInfo(details: ClubPaymentDetails): string {
  const parts: string[] = [];
  if (details.phoneNumber.trim()) {
    parts.push(`Phone: ${details.phoneNumber.trim()}`);
  }
  if (details.bankName.trim() || details.bankAccountNumber.trim()) {
    const bankPart = [details.bankName.trim(), details.bankAccountNumber.trim()]
      .filter(Boolean)
      .join(' ');
    parts.push(`Bank: ${bankPart}`);
  }
  if (details.recipientName.trim()) {
    parts.push(`To: ${details.recipientName.trim()}`);
  }
  if (details.paymentNotes.trim()) {
    parts.push(`Note: ${details.paymentNotes.trim()}`);
  }
  const combined = parts.join(' · ');
  return (combined || 'Phone: +65 9123 4567 · Bank: DBS 018-902341-2').slice(
    0,
    160
  );
}

export function parseClubPaymentDetails(
  paymentInfo: string,
  fallbackRecipient = 'Alex Tan'
): ClubPaymentDetails {
  const raw = (paymentInfo || '').trim();

  // Check if formatted with our structured labels
  const phoneLabelMatch = raw.match(/Phone:\s*([^·|]+)/i);
  const bankLabelMatch = raw.match(/Bank:\s*([^·|]+)/i);
  const toLabelMatch = raw.match(/To:\s*([^·|]+)/i);
  const noteLabelMatch = raw.match(/Note:\s*([^·|]+)/i);

  if (phoneLabelMatch || bankLabelMatch) {
    const bankRaw = bankLabelMatch ? bankLabelMatch[1].trim() : '';
    const acctMatch = bankRaw.match(/(\d[\d-\s]{5,}\d)/);
    const bankAccountNumber = acctMatch ? acctMatch[1].trim() : '';
    const bankName = acctMatch
      ? bankRaw.replace(acctMatch[0], '').replace(/[()]/g, '').trim() || 'DBS Bank'
      : bankRaw || 'DBS Bank';

    return {
      recipientName: toLabelMatch ? toLabelMatch[1].trim() : fallbackRecipient,
      phoneNumber: phoneLabelMatch ? phoneLabelMatch[1].trim() : '+65 9123 4567',
      bankName,
      bankAccountNumber: bankAccountNumber || '018-902341-2',
      paymentNotes: noteLabelMatch
        ? noteLabelMatch[1].trim()
        : 'Include your name & session date in transfer reference',
    };
  }

  // Fallback extraction for legacy free-text paymentInfo strings
  const phoneDigitsMatch = raw.match(/(\+?\d[\d\s-]{6,}\d)/);
  const isChloe =
    raw.toLowerCase().includes('chloe') ||
    fallbackRecipient.toLowerCase().includes('chloe');

  return {
    recipientName: isChloe ? 'Chloe Lim' : fallbackRecipient,
    phoneNumber: phoneDigitsMatch
      ? phoneDigitsMatch[1].trim()
      : isChloe
      ? '+65 8234 5678'
      : '+65 9123 4567',
    bankName: isChloe ? 'OCBC Bank' : 'DBS Bank',
    bankAccountNumber: isChloe ? '542-881902-1' : '018-902341-2',
    paymentNotes:
      raw || 'Include your name & session date in transfer reference',
  };
}

export function loadClubPaymentDetailsMap(): Record<string, ClubPaymentDetails> {
  const defaults: Record<string, ClubPaymentDetails> = {
    club_bintang_prime: {
      recipientName: 'Alex Tan',
      phoneNumber: '+65 9123 4567',
      bankName: 'DBS Bank',
      bankAccountNumber: '018-902341-2',
      paymentNotes: 'PayNow to mobile or transfer to DBS account. Ref: Name + Date',
    },
    club_metro_smash: {
      recipientName: 'Chloe Lim',
      phoneNumber: '+65 8234 5678',
      bankName: 'OCBC Bank',
      bankAccountNumber: '542-881902-1',
      paymentNotes: 'PayNow to mobile or OCBC transfer. Ref: Metro + Name',
    },
  };
  try {
    const raw = localStorage.getItem(CLUB_PAYMENT_DETAILS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, ClubPaymentDetails>;
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore
  }
  return defaults;
}

export function saveClubPaymentDetails(
  clubId: string,
  details: ClubPaymentDetails
): Record<string, ClubPaymentDetails> {
  const next = {
    ...loadClubPaymentDetailsMap(),
    [clubId]: details,
  };
  try {
    localStorage.setItem(CLUB_PAYMENT_DETAILS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export const INITIAL_CLUBS: Club[] = [
  {
    id: 'club_bintang_prime',
    name: 'Bintang Prime Badminton Club',
    description: 'Thursday & Friday evening competitive rotations at Bintang Hall.',
    paymentInfo:
      'Phone: +65 9123 4567 · Bank: DBS Bank 018-902341-2 · To: Alex Tan',
    paymentDetails: {
      recipientName: 'Alex Tan',
      phoneNumber: '+65 9123 4567',
      bankName: 'DBS Bank',
      bankAccountNumber: '018-902341-2',
      paymentNotes: 'PayNow to phone or DBS Bank transfer. Ref: Name + Session Date',
    },
    freeCancelHours: 24,
    lockCancelHours: 4,
    lateCancelFeePercent: 50,
    noShowFeePercent: 100,
    excludeOwnerFromBilling: false,
    ownerId: 'local_club',
    clubOwnerPlayerId: 'player_alex',
    clubOwnerName: 'Alex Tan',
  },
  {
    id: 'club_metro_smash',
    name: 'Metro Weekend Smashers',
    description: 'Sunday morning high-intensity doubles and singles drills at Metro Hall.',
    paymentInfo:
      'Phone: +65 8234 5678 · Bank: OCBC Bank 542-881902-1 · To: Chloe Lim',
    paymentDetails: {
      recipientName: 'Chloe Lim',
      phoneNumber: '+65 8234 5678',
      bankName: 'OCBC Bank',
      bankAccountNumber: '542-881902-1',
      paymentNotes: 'PayNow to phone or OCBC Bank transfer. Ref: Metro + Name',
    },
    freeCancelHours: 18,
    lockCancelHours: 3,
    lateCancelFeePercent: 50,
    noShowFeePercent: 100,
    excludeOwnerFromBilling: false,
    ownerId: 'local_club',
    clubOwnerPlayerId: 'player_chloe',
    clubOwnerName: 'Chloe Lim',
  },
];

export function loadClubBillingRulesMap(): Record<string, { excludeOwnerFromBilling: boolean }> {
  const defaults: Record<string, { excludeOwnerFromBilling: boolean }> = {
    club_bintang_prime: { excludeOwnerFromBilling: false },
    club_metro_smash: { excludeOwnerFromBilling: false },
  };
  try {
    const raw = localStorage.getItem(CLUB_BILLING_RULES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, { excludeOwnerFromBilling: boolean }>;
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore
  }
  return defaults;
}

export function saveClubBillingRule(
  clubId: string,
  excludeOwnerFromBilling: boolean
): Record<string, { excludeOwnerFromBilling: boolean }> {
  const next = {
    ...loadClubBillingRulesMap(),
    [clubId]: { excludeOwnerFromBilling: Boolean(excludeOwnerFromBilling) },
  };
  try {
    localStorage.setItem(CLUB_BILLING_RULES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function loadClubOwnerMap(): Record<
  string,
  { playerId: string; playerName: string }
> {
  const defaults: Record<string, { playerId: string; playerName: string }> = {
    club_bintang_prime: { playerId: 'player_alex', playerName: 'Alex Tan' },
    club_metro_smash: { playerId: 'player_chloe', playerName: 'Chloe Lim' },
  };
  try {
    const raw = localStorage.getItem(CLUB_OWNER_MAP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<
        string,
        { playerId: string; playerName: string }
      >;
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore
  }
  return defaults;
}

export function saveClubOwnerAssignment(
  clubId: string,
  playerId: string,
  playerName: string
): Record<string, { playerId: string; playerName: string }> {
  const next = {
    ...loadClubOwnerMap(),
    [clubId]: { playerId, playerName },
  };
  try {
    localStorage.setItem(CLUB_OWNER_MAP_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export const INITIAL_PLAYERS: Player[] = [
  {
    id: 'player_alex',
    name: 'Alex Tan',
    playerTag: 'alex#101',
    joinedClubIdsCsv: 'club_bintang_prime,club_metro_smash',
    wins: 14,
    losses: 4,
    gamesPlayed: 18,
    pointsScored: 368,
    pointsConceded: 294,
    singlesWins: 6,
    singlesLosses: 1,
    doublesWins: 8,
    doublesLosses: 3,
    ratingScore: 1465,
    ownerId: 'local_club',
  },
  {
    id: 'player_kevin',
    name: 'Kevin Lee',
    playerTag: 'kevin#204',
    joinedClubIdsCsv: 'club_bintang_prime',
    wins: 12,
    losses: 5,
    gamesPlayed: 17,
    pointsScored: 344,
    pointsConceded: 301,
    singlesWins: 4,
    singlesLosses: 2,
    doublesWins: 8,
    doublesLosses: 3,
    ratingScore: 1392,
    ownerId: 'local_club',
  },
  {
    id: 'player_chloe',
    name: 'Chloe Lim',
    playerTag: 'chloe#308',
    joinedClubIdsCsv: 'club_bintang_prime,club_metro_smash',
    wins: 13,
    losses: 5,
    gamesPlayed: 18,
    pointsScored: 361,
    pointsConceded: 302,
    singlesWins: 3,
    singlesLosses: 2,
    doublesWins: 10,
    doublesLosses: 3,
    ratingScore: 1430,
    ownerId: 'local_club',
  },
  {
    id: 'player_marcus',
    name: 'Marcus Chen',
    playerTag: 'marcus#412',
    joinedClubIdsCsv: 'club_bintang_prime',
    wins: 9,
    losses: 8,
    gamesPlayed: 17,
    pointsScored: 325,
    pointsConceded: 322,
    singlesWins: 3,
    singlesLosses: 4,
    doublesWins: 6,
    doublesLosses: 4,
    ratingScore: 1278,
    ownerId: 'local_club',
  },
  {
    id: 'player_samantha',
    name: 'Samantha Wong',
    playerTag: 'sam#519',
    joinedClubIdsCsv: 'club_bintang_prime,club_metro_smash',
    wins: 10,
    losses: 7,
    gamesPlayed: 17,
    pointsScored: 332,
    pointsConceded: 315,
    singlesWins: 4,
    singlesLosses: 2,
    doublesWins: 6,
    doublesLosses: 5,
    ratingScore: 1318,
    ownerId: 'local_club',
  },
  {
    id: 'player_ryan',
    name: 'Ryan Koh',
    playerTag: 'ryan#625',
    joinedClubIdsCsv: 'club_bintang_prime',
    wins: 7,
    losses: 9,
    gamesPlayed: 16,
    pointsScored: 298,
    pointsConceded: 318,
    singlesWins: 2,
    singlesLosses: 4,
    doublesWins: 5,
    doublesLosses: 5,
    ratingScore: 1210,
    ownerId: 'local_club',
  },
  {
    id: 'player_daniel',
    name: 'Daniel Ng',
    playerTag: 'daniel#730',
    joinedClubIdsCsv: 'club_bintang_prime,club_metro_smash',
    wins: 6,
    losses: 10,
    gamesPlayed: 16,
    pointsScored: 284,
    pointsConceded: 326,
    singlesWins: 1,
    singlesLosses: 4,
    doublesWins: 5,
    doublesLosses: 6,
    ratingScore: 1164,
    ownerId: 'local_club',
  },
  {
    id: 'player_hannah',
    name: 'Hannah Goh',
    playerTag: 'hannah#841',
    joinedClubIdsCsv: 'club_bintang_prime',
    wins: 4,
    losses: 11,
    gamesPlayed: 15,
    pointsScored: 256,
    pointsConceded: 309,
    singlesWins: 1,
    singlesLosses: 5,
    doublesWins: 3,
    doublesLosses: 6,
    ratingScore: 1098,
    ownerId: 'local_club',
  },
];

export const INITIAL_SESSIONS: Session[] = [
  {
    id: 'session_oct22_upcoming',
    clubId: 'club_bintang_prime',
    title: 'Upcoming Thursday Club Session',
    venue: 'Bintang Badminton Hall',
    courtNumbers: 'Court 3, Court 4',
    sessionDate: '2026-10-22',
    startTime: '20:00',
    endTime: '22:00',
    bookingStatus: 'booked',
    courtFee: 72,
    shuttlesUsed: 0,
    shuttleUnitCost: 3.0,
    shuttleFee: 0,
    maxPlayers: 8,
    organizerName: 'Alex Tan',
    paymentInfo: 'PayNow / Venmo @AlexTan-Shuttle',
    feeSplitFinalized: false,
    ownerId: 'local_club',
  },
  {
    id: 'session_oct17_penalty_window',
    clubId: 'club_bintang_prime',
    title: 'Tomorrow Night Friday Sparring',
    venue: 'Bintang Badminton Hall',
    courtNumbers: 'Court 1',
    sessionDate: '2026-10-17',
    startTime: '14:00',
    endTime: '16:00',
    bookingStatus: 'booked',
    courtFee: 40,
    shuttlesUsed: 0,
    shuttleUnitCost: 3.0,
    shuttleFee: 0,
    maxPlayers: 6,
    organizerName: 'Alex Tan',
    paymentInfo: 'PayNow / Venmo @AlexTan-Shuttle',
    feeSplitFinalized: false,
    ownerId: 'local_club',
  },
  {
    id: 'session_oct15_completed',
    clubId: 'club_bintang_prime',
    title: 'Oct 15 Thursday Session',
    venue: 'Bintang Badminton Hall',
    courtNumbers: 'Court 2, Court 3',
    sessionDate: '2026-10-15',
    startTime: '20:00',
    endTime: '22:00',
    bookingStatus: 'completed',
    courtFee: 70,
    shuttlesUsed: 6,
    shuttleUnitCost: 3.0,
    shuttleFee: 18,
    maxPlayers: 8,
    organizerName: 'Alex Tan',
    paymentInfo: 'PayNow / Venmo @AlexTan-Shuttle',
    feeSplitFinalized: true,
    ownerId: 'local_club',
  },
  {
    id: 'session_oct08_completed',
    clubId: 'club_bintang_prime',
    title: 'Oct 8 Thursday Session',
    venue: 'Bintang Badminton Hall',
    courtNumbers: 'Court 1, Court 2',
    sessionDate: '2026-10-08',
    startTime: '20:00',
    endTime: '22:00',
    bookingStatus: 'completed',
    courtFee: 68,
    shuttlesUsed: 5,
    shuttleUnitCost: 3.0,
    shuttleFee: 15,
    maxPlayers: 8,
    organizerName: 'Alex Tan',
    paymentInfo: 'PayNow / Venmo @AlexTan-Shuttle',
    feeSplitFinalized: true,
    ownerId: 'local_club',
  },
  {
    id: 'session_metro_oct25',
    clubId: 'club_metro_smash',
    title: 'Metro Sunday Morning Doubles',
    venue: 'Metro Sports Hall',
    courtNumbers: 'Court 5, Court 6',
    sessionDate: '2026-10-25',
    startTime: '10:00',
    endTime: '12:00',
    bookingStatus: 'booked',
    courtFee: 64,
    shuttlesUsed: 0,
    shuttleUnitCost: 3.0,
    shuttleFee: 0,
    maxPlayers: 8,
    organizerName: 'Chloe Lim',
    paymentInfo: 'PayNow / Zelle @ChloeLim-Metro',
    feeSplitFinalized: false,
    ownerId: 'local_club',
  },
];

export const INITIAL_RSVPS: SessionRsvp[] = [
  // Oct 15 completed session (Kevin Lee attended, unpaid $11.00; Ryan Koh was a No-Show!)
  {
    id: 'rsvp_oct15_alex',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct15_completed',
    playerId: 'player_alex',
    playerName: 'Alex Tan',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 11.25,
    paidStatus: 'paid',
    paidMethod: 'Club Owner',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct15_kevin',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct15_completed',
    playerId: 'player_kevin',
    playerName: 'Kevin Lee',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 11.25,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct15_chloe',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct15_completed',
    playerId: 'player_chloe',
    playerName: 'Chloe Lim',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 11.25,
    paidStatus: 'paid',
    paidMethod: 'Received',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct15_marcus',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct15_completed',
    playerId: 'player_marcus',
    playerName: 'Marcus Chen',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 11.25,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct15_samantha',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct15_completed',
    playerId: 'player_samantha',
    playerName: 'Samantha Wong',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 11.25,
    paidStatus: 'paid',
    paidMethod: 'Received',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct15_ryan',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct15_completed',
    playerId: 'player_ryan',
    playerName: 'Ryan Koh',
    status: 'going',
    attendanceOutcome: 'no_show',
    penaltyPercentApplied: 100,
    feeShare: 8.75, // Charged court share for No-Show (no shuttle share)
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct15_daniel',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct15_completed',
    playerId: 'player_daniel',
    playerName: 'Daniel Ng',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 11.25,
    paidStatus: 'paid',
    paidMethod: 'Received',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct15_hannah',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct15_completed',
    playerId: 'player_hannah',
    playerName: 'Hannah Goh',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 11.25,
    paidStatus: 'paid',
    paidMethod: 'Received',
    ownerId: 'local_club',
  },

  // Oct 08 completed session: Kevin Lee also has an unpaid $10.50 from Oct 8 (accumulates to $21.75!)
  // Note: Chloe Lim did NOT join Oct 8, so when Kevin views Oct 8 it shows "You Joined & Attended", whereas for Oct 8 other non-attendees see they didn't join.
  {
    id: 'rsvp_oct08_alex',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct08_completed',
    playerId: 'player_alex',
    playerName: 'Alex Tan',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 13.83,
    paidStatus: 'paid',
    paidMethod: 'Organizer',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct08_kevin',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct08_completed',
    playerId: 'player_kevin',
    playerName: 'Kevin Lee',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 13.83,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct08_marcus',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct08_completed',
    playerId: 'player_marcus',
    playerName: 'Marcus Chen',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 13.83,
    paidStatus: 'paid',
    paidMethod: 'Received',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct08_samantha',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct08_completed',
    playerId: 'player_samantha',
    playerName: 'Samantha Wong',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 13.83,
    paidStatus: 'paid',
    paidMethod: 'Received',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct08_daniel',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct08_completed',
    playerId: 'player_daniel',
    playerName: 'Daniel Ng',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 13.83,
    paidStatus: 'paid',
    paidMethod: 'Received',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct08_hannah',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct08_completed',
    playerId: 'player_hannah',
    playerName: 'Hannah Goh',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 13.83,
    paidStatus: 'paid',
    paidMethod: 'Received',
    ownerId: 'local_club',
  },

  // Upcoming Oct 22 session (Kevin Lee has joined!)
  {
    id: 'rsvp_oct22_alex',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct22_upcoming',
    playerId: 'player_alex',
    playerName: 'Alex Tan',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct22_kevin',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct22_upcoming',
    playerId: 'player_kevin',
    playerName: 'Kevin Lee',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct22_chloe',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct22_upcoming',
    playerId: 'player_chloe',
    playerName: 'Chloe Lim',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct22_samantha',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct22_upcoming',
    playerId: 'player_samantha',
    playerName: 'Samantha Wong',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct22_marcus',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct22_upcoming',
    playerId: 'player_marcus',
    playerName: 'Marcus Chen',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },

  // Tomorrow Oct 17 session (Within 24h penalty window! Kevin Lee joined)
  {
    id: 'rsvp_oct17_alex',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct17_penalty_window',
    playerId: 'player_alex',
    playerName: 'Alex Tan',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct17_kevin',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct17_penalty_window',
    playerId: 'player_kevin',
    playerName: 'Kevin Lee',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct17_chloe',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct17_penalty_window',
    playerId: 'player_chloe',
    playerName: 'Chloe Lim',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct17_ryan',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct17_penalty_window',
    playerId: 'player_ryan',
    playerName: 'Ryan Koh',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },

  // Metro Club Session
  {
    id: 'rsvp_metro_chloe',
    clubId: 'club_metro_smash',
    sessionId: 'session_metro_oct25',
    playerId: 'player_chloe',
    playerName: 'Chloe Lim',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_metro_alex',
    clubId: 'club_metro_smash',
    sessionId: 'session_metro_oct25',
    playerId: 'player_alex',
    playerName: 'Alex Tan',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
];

export const INITIAL_MATCHES: BadmintonMatch[] = [
  {
    id: 'match_101',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct15_completed',
    matchFormat: 'doubles',
    teamAPlayer1Id: 'player_alex',
    teamAPlayer1Name: 'Alex Tan',
    teamAPlayer2Id: 'player_chloe',
    teamAPlayer2Name: 'Chloe Lim',
    teamBPlayer1Id: 'player_kevin',
    teamBPlayer1Name: 'Kevin Lee',
    teamBPlayer2Id: 'player_marcus',
    teamBPlayer2Name: 'Marcus Chen',
    scoreTeamA: 21,
    scoreTeamB: 17,
    setScoresText: '21-17',
    winnerSide: 'A',
    ownerId: 'local_club',
  },
  {
    id: 'match_102',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct15_completed',
    matchFormat: 'singles',
    teamAPlayer1Id: 'player_kevin',
    teamAPlayer1Name: 'Kevin Lee',
    teamAPlayer2Id: 'NONE',
    teamAPlayer2Name: 'None',
    teamBPlayer1Id: 'player_samantha',
    teamBPlayer1Name: 'Samantha Wong',
    teamBPlayer2Id: 'NONE',
    teamBPlayer2Name: 'None',
    scoreTeamA: 21,
    scoreTeamB: 14,
    setScoresText: '21-14',
    winnerSide: 'A',
    ownerId: 'local_club',
  },
  {
    id: 'match_103',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct08_completed',
    matchFormat: 'doubles',
    teamAPlayer1Id: 'player_samantha',
    teamAPlayer1Name: 'Samantha Wong',
    teamAPlayer2Id: 'player_kevin',
    teamAPlayer2Name: 'Kevin Lee',
    teamBPlayer1Id: 'player_daniel',
    teamBPlayer1Name: 'Daniel Ng',
    teamBPlayer2Id: 'player_hannah',
    teamBPlayer2Name: 'Hannah Goh',
    scoreTeamA: 21,
    scoreTeamB: 15,
    setScoresText: '21-15',
    winnerSide: 'A',
    ownerId: 'local_club',
  },
  {
    id: 'match_104',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct08_completed',
    matchFormat: 'singles',
    teamAPlayer1Id: 'player_alex',
    teamAPlayer1Name: 'Alex Tan',
    teamAPlayer2Id: 'NONE',
    teamAPlayer2Name: 'None',
    teamBPlayer1Id: 'player_marcus',
    teamBPlayer1Name: 'Marcus Chen',
    teamBPlayer2Id: 'NONE',
    teamBPlayer2Name: 'None',
    scoreTeamA: 21,
    scoreTeamB: 19,
    setScoresText: '21-19',
    winnerSide: 'A',
    ownerId: 'local_club',
  },
];

export function getPlayerJoinedClubIds(player: Player | null): string[] {
  if (!player || !player.joinedClubIdsCsv) return [];
  return player.joinedClubIdsCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function hasPlayerJoinedClub(player: Player | null, clubId: string): boolean {
  return getPlayerJoinedClubIds(player).includes(clubId);
}

/**
 * Evaluates whether a player can tap out of a future session based on the Club's configurable
 * freeCancelHours, lockCancelHours, and lateCancelFeePercent.
 */
export function evaluateTapOutWindow(
  session: Session,
  club: Club
): TapOutPolicyEvaluation {
  // Reference current time (2026-10-16T20:52:00)
  const nowMs = new Date('2026-10-16T20:52:00').getTime();
  const sessionStartMs = new Date(
    `${session.sessionDate}T${session.startTime || '20:00'}:00`
  ).getTime();

  const diffHours = Number.isNaN(sessionStartMs)
    ? 48
    : Math.max(0, (sessionStartMs - nowMs) / (1000 * 3600));

  if (diffHours < club.lockCancelHours) {
    return {
      hoursUntilStart: diffHours,
      canTapOut: false,
      isPenaltyWindow: true,
      penaltyPercent: 100,
      policySummary: `Locked (${diffHours.toFixed(1)}h before match; cutoff is ${club.lockCancelHours}h prior)`,
    };
  }

  if (diffHours < club.freeCancelHours) {
    return {
      hoursUntilStart: diffHours,
      canTapOut: true,
      isPenaltyWindow: true,
      penaltyPercent: club.lateCancelFeePercent,
      policySummary: `Late Tap-Out Window (${diffHours.toFixed(1)}h left · <${club.freeCancelHours}h incurs ${club.lateCancelFeePercent}% court fee)`,
    };
  }

  return {
    hoursUntilStart: diffHours,
    canTapOut: true,
    isPenaltyWindow: false,
    penaltyPercent: 0,
    policySummary: `Free Tap-Out (${Math.round(diffHours)}h until match · >${club.freeCancelHours}h is 0% fee)`,
  };
}

/**
 * Calculates individual fee shares when a session ends, factoring in:
 * - Present players (100% court weight + 100% shuttlecock share)
 * - No-Show players (club.noShowFeePercent% court weight, 0% shuttlecock share)
 * - Late Tap-Out players (rsvp.penaltyPercentApplied% court weight, 0% shuttlecock share)
 * - Optional Club Owner exclusion (`excludeOwnerFromBilling`): when enabled, the club owner is excluded from fee calculations ($0 share, 0 weight).
 */
export function computeWeightedSessionSplits(
  courtFee: number,
  shuttleFee: number,
  sessionRsvps: SessionRsvp[],
  noShowFeePercent: number,
  options?: {
    clubOwnerPlayerId?: string;
    excludeOwnerFromBilling?: boolean;
  }
): Map<string, { feeShare: number; penaltyPercentApplied: number }> {
  const result = new Map<string, { feeShare: number; penaltyPercentApplied: number }>();

  const excludedOwnerId =
    options?.excludeOwnerFromBilling && options?.clubOwnerPlayerId
      ? options.clubOwnerPlayerId
      : null;

  const activeRsvps = sessionRsvps.filter(
    (r) =>
      r.playerId !== excludedOwnerId &&
      (r.status === 'going' || (r.status === 'late_out' && r.penaltyPercentApplied > 0))
  );

  // Determine court weight for each RSVP
  let totalCourtWeight = 0;
  let presentCount = 0;

  const weights = activeRsvps.map((r) => {
    let weight = 0;
    let pct = 0;
    if (r.status === 'going') {
      if (r.attendanceOutcome === 'present') {
        weight = 1.0;
        pct = 100;
        presentCount += 1;
      } else if (r.attendanceOutcome === 'no_show') {
        pct = noShowFeePercent;
        weight = pct / 100;
      } else {
        weight = 0;
        pct = 0;
      }
    } else if (r.status === 'late_out') {
      pct = r.penaltyPercentApplied;
      weight = pct / 100;
    }
    totalCourtWeight += weight;
    return { rsvp: r, weight, pct };
  });

  const shuttlePerPresent = presentCount > 0 ? shuttleFee / presentCount : 0;

  sessionRsvps.forEach((r) => {
    if (excludedOwnerId && r.playerId === excludedOwnerId) {
      result.set(r.id, { feeShare: 0, penaltyPercentApplied: 0 });
      return;
    }
    const found = weights.find((w) => w.rsvp.id === r.id);
    if (!found || found.weight <= 0) {
      result.set(r.id, { feeShare: 0, penaltyPercentApplied: 0 });
      return;
    }
    const courtPortion =
      totalCourtWeight > 0 ? courtFee * (found.weight / totalCourtWeight) : 0;
    const shuttlePortion =
      r.status === 'going' && r.attendanceOutcome === 'present'
        ? shuttlePerPresent
        : 0;
    const totalShare = Number((courtPortion + shuttlePortion).toFixed(2));
    result.set(r.id, {
      feeShare: totalShare,
      penaltyPercentApplied: found.pct,
    });
  });

  return result;
}

export function parseQuickSessionInput(input: string): ParsedQuickSession {
  const raw = input.trim();

  let title = 'Weekly Badminton Session';
  let venue = 'Bintang Badminton Hall';
  let courtNumbers = 'Court 1, Court 2';
  let sessionDate = '2026-10-23';
  let startTime = '20:00';
  let endTime = '22:00';
  let courtFee = 72;
  let maxPlayers = 8;
  let bookingStatus: 'pending' | 'booked' = 'booked';

  if (!raw) {
    return {
      title,
      venue,
      courtNumbers,
      sessionDate,
      startTime,
      endTime,
      courtFee,
      maxPlayers,
      bookingStatus,
    };
  }

  if (/\b(pending|unbooked|tbd|not booked)\b/i.test(raw)) {
    bookingStatus = 'pending';
  }

  const courtMatch = raw.match(
    /\bcourts?\s*([0-9]+(?:\s*(?:&|,|and|-|to)\s*[0-9]+)*)/i
  );
  if (courtMatch) {
    courtNumbers = `Court ${courtMatch[1].replace(/\s+/g, ' ').trim()}`;
  }

  const maxMatch =
    raw.match(/\bmax\s*(\d{1,2})\b/i) ||
    raw.match(/\b(\d{1,2})\s*(?:players|pax|spots|people)\b/i);
  if (maxMatch) {
    const parsedMax = parseInt(maxMatch[1], 10);
    if (parsedMax >= 2 && parsedMax <= 32) {
      maxPlayers = parsedMax;
    }
  }

  const anyDollar = raw.match(/\$(\d+(?:\.\d{1,2})?)/);
  if (anyDollar) {
    courtFee = parseFloat(anyDollar[1]);
  }

  const timeRangeMatch = raw.match(
    /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|–)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i
  );
  if (timeRangeMatch) {
    const convertTo24Hr = (timeStr: string, fallbackMeridiem?: string): string => {
      const cleaned = timeStr.trim().toLowerCase();
      const m = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
      if (!m) return '20:00';
      let hr = parseInt(m[1], 10);
      const min = m[2] || '00';
      const mer = m[3] || fallbackMeridiem || 'pm';
      if (mer === 'pm' && hr < 12) hr += 12;
      if (mer === 'am' && hr === 12) hr = 0;
      return `${String(hr).padStart(2, '0')}:${min}`;
    };
    const endMeridiemMatch = timeRangeMatch[2].toLowerCase().match(/(am|pm)/);
    const fallbackMer = endMeridiemMatch ? endMeridiemMatch[1] : 'pm';
    startTime = convertTo24Hr(timeRangeMatch[1], fallbackMer);
    endTime = convertTo24Hr(timeRangeMatch[2], fallbackMer);
  }

  const dayMap: Record<string, { date: string; label: string }> = {
    fri: { date: '2026-10-16', label: 'Friday' },
    friday: { date: '2026-10-16', label: 'Friday' },
    sat: { date: '2026-10-17', label: 'Saturday' },
    saturday: { date: '2026-10-17', label: 'Saturday' },
    sun: { date: '2026-10-18', label: 'Sunday' },
    sunday: { date: '2026-10-18', label: 'Sunday' },
    mon: { date: '2026-10-19', label: 'Monday' },
    monday: { date: '2026-10-19', label: 'Monday' },
    tue: { date: '2026-10-20', label: 'Tuesday' },
    tuesday: { date: '2026-10-20', label: 'Tuesday' },
    wed: { date: '2026-10-21', label: 'Wednesday' },
    wednesday: { date: '2026-10-21', label: 'Wednesday' },
    thu: { date: '2026-10-22', label: 'Thursday' },
    thurs: { date: '2026-10-22', label: 'Thursday' },
    thursday: { date: '2026-10-22', label: 'Thursday' },
  };

  let detectedDayLabel = 'Club';
  for (const [key, info] of Object.entries(dayMap)) {
    const regex = new RegExp(`\\b${key}\\b`, 'i');
    if (regex.test(raw)) {
      sessionDate = info.date;
      detectedDayLabel = info.label;
      break;
    }
  }

  const venueMatch = raw.match(/(?:@|\bat\b)\s+([^,$]+?)(?=\s+\bcourts?\b|,|\$|$)/i);
  if (venueMatch && venueMatch[1].trim().length > 1) {
    venue = venueMatch[1].trim();
  }

  title = `${detectedDayLabel} Session · ${venue}`;

  return {
    title: title.slice(0, 120),
    venue: venue.slice(0, 120),
    courtNumbers: courtNumbers.slice(0, 60),
    sessionDate,
    startTime,
    endTime,
    courtFee,
    maxPlayers,
    bookingStatus,
  };
}

export function computePlayerLeaderboardAndTiers(
  players: Player[],
  matches: BadmintonMatch[]
): RankedPlayer[] {
  const recentFormMap = new Map<string, ('W' | 'L')[]>();
  players.forEach((p) => recentFormMap.set(p.id, []));

  matches.forEach((m) => {
    const teamAIds = [m.teamAPlayer1Id, m.teamAPlayer2Id].filter(
      (id) => id && id !== 'NONE'
    );
    const teamBIds = [m.teamBPlayer1Id, m.teamBPlayer2Id].filter(
      (id) => id && id !== 'NONE'
    );
    const aWon = m.winnerSide === 'A';

    teamAIds.forEach((id) => {
      const arr = recentFormMap.get(id) || [];
      arr.push(aWon ? 'W' : 'L');
      recentFormMap.set(id, arr.slice(-5));
    });
    teamBIds.forEach((id) => {
      const arr = recentFormMap.get(id) || [];
      arr.push(!aWon ? 'W' : 'L');
      recentFormMap.set(id, arr.slice(-5));
    });
  });

  const enriched = players.map((player) => {
    const games = Math.max(player.gamesPlayed, player.wins + player.losses);
    const winRate = games > 0 ? (player.wins / games) * 100 : 0;
    const avgPointDiff =
      games > 0 ? (player.pointsScored - player.pointsConceded) / games : 0;
    const totalPoints = player.pointsScored + player.pointsConceded;
    const pointsShare =
      totalPoints > 0 ? (player.pointsScored / totalPoints) * 100 : 50;

    const calculatedRating =
      games > 0
        ? Math.round(
            1050 + winRate * 3.8 + avgPointDiff * 14 + Math.min(games, 25) * 4
          )
        : player.ratingScore;

    const finalRating = Math.max(
      900,
      Math.round((player.ratingScore + calculatedRating) / 2)
    );

    let tier: TierRank = 'C';
    let tierTitle = 'Rising Shuttle';
    if (finalRating >= 1400 || (winRate >= 72 && games >= 5)) {
      tier = 'S';
      tierTitle = 'Court Apex';
    } else if (finalRating >= 1290 || (winRate >= 58 && games >= 4)) {
      tier = 'A';
      tierTitle = 'Smash Vanguard';
    } else if (finalRating >= 1160 || winRate >= 42) {
      tier = 'B';
      tierTitle = 'Rally Tactician';
    }

    const pointDiff = player.pointsScored - player.pointsConceded;

    return {
      ...player,
      gamesPlayed: games,
      ratingScore: finalRating,
      rank: 0,
      winRate,
      pointDiff,
      avgPointDiff,
      pointsShare,
      tier,
      tierTitle,
      recentForm: recentFormMap.get(player.id) || ['W', 'W', 'L'],
    };
  });

  enriched.sort((a, b) => {
    if (b.ratingScore !== a.ratingScore) return b.ratingScore - a.ratingScore;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.avgPointDiff - a.avgPointDiff;
  });

  return enriched.map((p, index) => ({
    ...p,
    rank: index + 1,
  }));
}

/**
 * Finds all accumulated unpaid balances for a player across ended sessions in their joined clubs.
 */
export function calculateOutstandingBalancesForPlayer(
  playerId: string,
  sessions: Session[],
  rsvps: SessionRsvp[],
  clubIdFilter?: string,
  clubs?: Club[]
): OutstandingDebtItem[] {
  if (!playerId) return [];
  const sessionMap = new Map<string, Session>();
  sessions.forEach((s) => sessionMap.set(s.id, s));
  const clubOwnerByClubId = new Map<string, string>();
  if (clubs) {
    clubs.forEach((c) => {
      if (c.clubOwnerPlayerId) {
        clubOwnerByClubId.set(c.id, c.clubOwnerPlayerId);
      }
    });
  }

  return rsvps
    .filter(
      (r) =>
        r.playerId === playerId &&
        r.paidStatus !== 'paid' &&
        r.feeShare > 0 &&
        (!clubIdFilter || r.clubId === clubIdFilter) &&
        clubOwnerByClubId.get(r.clubId) !== playerId
    )
    .map((rsvp) => {
      const session = sessionMap.get(rsvp.sessionId);
      if (!session) return null;
      if (!session.feeSplitFinalized || session.bookingStatus !== 'completed') {
        return null;
      }
      return { rsvp, session };
    })
    .filter((item): item is OutstandingDebtItem => item !== null);
}

export function buildShareableClubAndSessionUrl(
  clubId: string,
  sessionOrId?: string | Session
): string {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const params = new URLSearchParams();
  params.set('club', clubId);
  if (typeof sessionOrId === 'string' && sessionOrId) {
    params.set('session', sessionOrId);
  } else if (sessionOrId && typeof sessionOrId === 'object') {
    params.set('session', sessionOrId.id);
    params.set('title', sessionOrId.title);
    params.set('date', sessionOrId.sessionDate);
    params.set('start', sessionOrId.startTime);
    params.set('end', sessionOrId.endTime);
    params.set('venue', sessionOrId.venue);
    params.set('courts', sessionOrId.courtNumbers);
    params.set('fee', String(sessionOrId.courtFee));
    params.set('max', String(sessionOrId.maxPlayers));
    params.set('org', sessionOrId.organizerName);
    params.set('status', sessionOrId.bookingStatus);
  }
  return `${baseUrl}?${params.toString()}`;
}

export function parseSharedSessionFromUrlParams(params: URLSearchParams): {
  clubId: string | null;
  sessionId: string | null;
  hydratedSession: Session | null;
} {
  const clubId = params.get('club');
  const sessionId = params.get('session');
  if (!sessionId) {
    return { clubId, sessionId: null, hydratedSession: null };
  }

  const title = params.get('title');
  const sessionDate = params.get('date');
  const venue = params.get('venue');

  // If the link includes session details (or even minimal session parameters), hydrate a fallback Session object
  // so that newly created sessions shared across tabs/accounts immediately load on the RSVP Join screen.
  const hydratedSession: Session | null =
    title || sessionDate || venue
      ? {
          id: sessionId,
          clubId: clubId || 'club_bintang_prime',
          title: title || 'Shared Club Session',
          venue: venue || 'Badminton Hall',
          courtNumbers: params.get('courts') || 'Court 1',
          sessionDate: sessionDate || '2026-10-22',
          startTime: params.get('start') || '20:00',
          endTime: params.get('end') || '22:00',
          bookingStatus:
            (params.get('status') as BookingStatus) || 'booked',
          courtFee: Number(params.get('fee')) || 60,
          shuttlesUsed: 0,
          shuttleUnitCost: 3.0,
          shuttleFee: 0,
          maxPlayers: Number(params.get('max')) || 8,
          organizerName: params.get('org') || 'Club Organizer',
          paymentInfo: 'PayNow',
          feeSplitFinalized: false,
          ownerId: 'local_club',
        }
      : null;

  return { clubId, sessionId, hydratedSession };
}

export function buildGroupChatSnippet(
  club: Club,
  session: Session,
  sessionRsvps: SessionRsvp[]
): string {
  const goingList = sessionRsvps.filter((r) => r.status === 'going');
  const rosterLines =
    goingList.length > 0
      ? goingList.map((r, i) => `${i + 1}. ${r.playerName}`).join('\n')
      : '1. (Sign in via link to join)';

  const shareUrl = buildShareableClubAndSessionUrl(club.id, session);

  return [
    `[${club.name}] ${session.title}`,
    `${session.sessionDate} · ${session.startTime}–${session.endTime}`,
    `${session.venue} (${session.courtNumbers})`,
    `Court Fee: $${session.courtFee.toFixed(2)} (+ shuttles split after session ends)`,
    `Tap-Out Policy: Free >${club.freeCancelHours}h prior · ${club.lateCancelFeePercent}% fee <${club.freeCancelHours}h · Locked <${club.lockCancelHours}h`,
    `Going (${goingList.length}/${session.maxPlayers}):`,
    rosterLines,
    ``,
    `Direct RSVP Link (Tap to Join or Pass):`,
    shareUrl,
  ].join('\n');
}

export function loadPlayerWalletsMap(): Record<string, PlayerBenefitWallet> {
  const defaults: Record<string, PlayerBenefitWallet> = {
    player_samantha: {
      creditBalance: 15.0,
      freeSessionPasses: 1,
      waiveAllFees: false,
    },
  };
  try {
    const raw = localStorage.getItem(PLAYER_WALLETS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, PlayerBenefitWallet>;
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore
  }
  return defaults;
}

export function savePlayerWalletsMap(
  wallets: Record<string, PlayerBenefitWallet>
): Record<string, PlayerBenefitWallet> {
  try {
    localStorage.setItem(PLAYER_WALLETS_STORAGE_KEY, JSON.stringify(wallets));
  } catch {
    // ignore
  }
  return wallets;
}

/**
 * Applies each player's active Wallet Benefits (Waive All Fees -> Free Session Passes -> Credit Balance)
 * when a session's fee split is finalized or updated.
 */
export function applyWalletsToFinalizedSessionRsvps(params: {
  sessionRsvps: SessionRsvp[];
  splits: Map<string, { feeShare: number; penaltyPercentApplied: number }>;
  walletsMap: Record<string, PlayerBenefitWallet>;
  finalizeSplit: boolean;
  clubOwnerPlayerId?: string;
  excludeOwnerFromBilling?: boolean;
}): {
  updatedSessionRsvps: SessionRsvp[];
  updatedWalletsMap: Record<string, PlayerBenefitWallet>;
} {
  const {
    sessionRsvps,
    splits,
    walletsMap,
    finalizeSplit,
    clubOwnerPlayerId,
    excludeOwnerFromBilling,
  } = params;
  const nextWallets: Record<string, PlayerBenefitWallet> = { ...walletsMap };

  const updatedSessionRsvps = sessionRsvps.map((r) => {
    const calc = splits.get(r.id) || {
      feeShare: 0,
      penaltyPercentApplied: 0,
    };

    // Club Owner handling: never require redundant self-approval ("Received")
    if (clubOwnerPlayerId && r.playerId === clubOwnerPlayerId) {
      if (excludeOwnerFromBilling) {
        return {
          ...r,
          feeShare: 0,
          penaltyPercentApplied: 0,
          paidStatus: finalizeSplit ? ('paid' as const) : r.paidStatus,
          paidMethod: finalizeSplit ? 'Owner Excluded' : r.paidMethod,
        };
      }
      if (finalizeSplit && calc.feeShare > 0) {
        return {
          ...r,
          feeShare: calc.feeShare,
          penaltyPercentApplied: calc.penaltyPercentApplied,
          paidStatus: 'paid' as const,
          paidMethod: 'Club Owner',
        };
      }
    }

    if (!finalizeSplit || calc.feeShare <= 0) {
      return {
        ...r,
        feeShare: calc.feeShare,
        penaltyPercentApplied: calc.penaltyPercentApplied,
      };
    }

    // If already paid/waived earlier, keep paid status and update feeShare
    if (r.paidStatus === 'paid') {
      return {
        ...r,
        feeShare: calc.feeShare,
        penaltyPercentApplied: calc.penaltyPercentApplied,
      };
    }

    const wallet: PlayerBenefitWallet = nextWallets[r.playerId]
      ? { ...nextWallets[r.playerId] }
      : {
          creditBalance: 0,
          freeSessionPasses: 0,
          waiveAllFees: false,
        };

    let nextPaidStatus: PaidStatus = r.paidStatus;
    let nextPaidMethod = r.paidMethod;
    let finalFeeShare = calc.feeShare;

    // Priority 1: Complete Fee Waiver (VIP / Exempt)
    if (wallet.waiveAllFees) {
      nextPaidStatus = 'paid';
      nextPaidMethod = 'Fee Waived (VIP)';
    }
    // Priority 2: Free Session Pass (1 pass covers 1 session fee share)
    else if (wallet.freeSessionPasses > 0) {
      wallet.freeSessionPasses = Math.max(0, wallet.freeSessionPasses - 1);
      nextPaidStatus = 'paid';
      nextPaidMethod = 'Free Session Pass';
      nextWallets[r.playerId] = wallet;
    }
    // Priority 3: Dollar Credit Balance
    else if (wallet.creditBalance > 0) {
      if (wallet.creditBalance >= calc.feeShare) {
        wallet.creditBalance = Number(
          (wallet.creditBalance - calc.feeShare).toFixed(2)
        );
        nextPaidStatus = 'paid';
        nextPaidMethod = `Credit ($${calc.feeShare.toFixed(2)})`;
        nextWallets[r.playerId] = wallet;
      } else {
        // Partial credit reduces the remaining feeShare owed
        const applied = Number(wallet.creditBalance.toFixed(2));
        finalFeeShare = Number((calc.feeShare - applied).toFixed(2));
        wallet.creditBalance = 0;
        nextPaidStatus = 'unpaid';
        nextPaidMethod = `Credit -$${applied.toFixed(2)}`;
        nextWallets[r.playerId] = wallet;
      }
    }

    return {
      ...r,
      feeShare: finalFeeShare,
      penaltyPercentApplied: calc.penaltyPercentApplied,
      paidStatus: nextPaidStatus,
      paidMethod: nextPaidMethod,
    };
  });

  return {
    updatedSessionRsvps,
    updatedWalletsMap: nextWallets,
  };
}

/**
 * Immediately applies a player's newly updated wallet (Waiver, Free Session Passes, or Credit Balance)
 * against any existing finalized unpaid RSVPs (oldest session first) so their current debt is settled automatically,
 * while preserving remaining passes/credits for future sessions.
 */
export function settlePlayerExistingUnpaidRsvpsWithWallet(params: {
  playerId: string;
  wallet: PlayerBenefitWallet;
  rsvps: SessionRsvp[];
  sessions: Session[];
}): {
  updatedRsvps: SessionRsvp[];
  remainingWallet: PlayerBenefitWallet;
  modifiedRsvps: SessionRsvp[];
} {
  const { playerId, wallet, rsvps, sessions } = params;
  const workingWallet: PlayerBenefitWallet = {
    creditBalance: Math.max(0, Number((wallet.creditBalance || 0).toFixed(2))),
    freeSessionPasses: Math.max(0, Math.floor(wallet.freeSessionPasses || 0)),
    waiveAllFees: Boolean(wallet.waiveAllFees),
  };

  const sessionMap = new Map<string, Session>();
  sessions.forEach((s) => sessionMap.set(s.id, s));

  // Find all finalized unpaid RSVPs for this player, sorted oldest session first
  const candidateRsvps = rsvps
    .filter((r) => {
      if (r.playerId !== playerId || r.paidStatus === 'paid' || r.feeShare <= 0) {
        return false;
      }
      const sess = sessionMap.get(r.sessionId);
      return Boolean(sess && sess.bookingStatus === 'completed' && sess.feeSplitFinalized);
    })
    .sort((a, b) => {
      const sA = sessionMap.get(a.sessionId)?.sessionDate || '';
      const sB = sessionMap.get(b.sessionId)?.sessionDate || '';
      return sA.localeCompare(sB);
    });

  const modifiedMap = new Map<string, SessionRsvp>();

  candidateRsvps.forEach((r) => {
    if (workingWallet.waiveAllFees) {
      modifiedMap.set(r.id, {
        ...r,
        paidStatus: 'paid',
        paidMethod: 'Fee Waived (VIP)',
      });
    } else if (workingWallet.freeSessionPasses > 0) {
      workingWallet.freeSessionPasses -= 1;
      modifiedMap.set(r.id, {
        ...r,
        paidStatus: 'paid',
        paidMethod: 'Free Session Pass',
      });
    } else if (workingWallet.creditBalance > 0) {
      if (workingWallet.creditBalance >= r.feeShare) {
        workingWallet.creditBalance = Number(
          (workingWallet.creditBalance - r.feeShare).toFixed(2)
        );
        modifiedMap.set(r.id, {
          ...r,
          paidStatus: 'paid',
          paidMethod: `Credit ($${r.feeShare.toFixed(2)})`,
        });
      } else {
        const applied = Number(workingWallet.creditBalance.toFixed(2));
        const nextShare = Number((r.feeShare - applied).toFixed(2));
        workingWallet.creditBalance = 0;
        modifiedMap.set(r.id, {
          ...r,
          feeShare: nextShare,
          paidStatus: 'unpaid',
          paidMethod: `Credit -$${applied.toFixed(2)}`,
        });
      }
    }
  });

  const updatedRsvps = rsvps.map((r) => modifiedMap.get(r.id) || r);

  return {
    updatedRsvps,
    remainingWallet: workingWallet,
    modifiedRsvps: Array.from(modifiedMap.values()),
  };
}

export function loadCachedPlayerIdentity(): CachedPlayerIdentity | null {
  try {
    const raw = localStorage.getItem(CACHED_PLAYER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPlayerIdentity;
    if (parsed && parsed.playerId && parsed.name) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCachedPlayerIdentity(
  identity: CachedPlayerIdentity | null
): void {
  try {
    if (!identity) {
      localStorage.removeItem(CACHED_PLAYER_STORAGE_KEY);
    } else {
      localStorage.setItem(CACHED_PLAYER_STORAGE_KEY, JSON.stringify(identity));
    }
  } catch {
    // ignore storage errors
  }
}
