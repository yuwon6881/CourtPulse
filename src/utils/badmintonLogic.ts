import {
  BadmintonMatch,
  BookingStatus,
  CachedPlayerIdentity,
  Club,
  ClubJoinRequest,
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
import { evaluateCourtBookingAdvice, formatCourtCount } from './courtAdvice';
import { nextDateForWeekday, toIsoDate } from './sessionDefaults';

export const CACHED_PLAYER_STORAGE_KEY = 'courtpulse_auth_account_v3';
export const LOCAL_STATE_STORAGE_KEY = 'courtpulse_club_state_v6';
export const CLUB_OWNER_MAP_STORAGE_KEY = 'courtpulse_club_owners_v3';
export const CLUB_PAYMENT_DETAILS_STORAGE_KEY = 'courtpulse_club_payments_v1';
export const CLUB_BILLING_RULES_STORAGE_KEY = 'courtpulse_club_billing_rules_v1';
export const CLUB_JOIN_REQUESTS_STORAGE_KEY = 'courtpulse_club_join_requests_v1';
export const PLAYER_WALLETS_STORAGE_KEY = 'courtpulse_player_wallets_v1';
export const RSVP_GUESTS_STORAGE_KEY = 'courtpulse_rsvp_guests_v1';
export const ADMIN_EMAIL = 'yuwon6881@gmail.com';
/** Bootstrap Site Admin accounts — keep in sync with isAdmin() in firestore.rules. */
export const ADMIN_EMAILS = [ADMIN_EMAIL, 'ywc4724@gmail.com'];

/** Appends a club to a raw joinedClubIdsCsv exactly the way the Firestore rules expect. */
export function appendClubToCsv(rawCsv: string, clubId: string): string {
  const current = (rawCsv || '').trim();
  if (!current) return clubId;
  if (current.split(',').map((s) => s.trim()).includes(clubId)) return current;
  return `${current},${clubId}`;
}

export function getRsvpGuestCount(
  rsvp: Pick<SessionRsvp, 'guestCount'> | null | undefined
): number {
  return Math.max(0, Math.floor(Number(rsvp?.guestCount || 0)));
}

export function getRsvpPartySize(
  rsvp: Pick<SessionRsvp, 'guestCount'> | null | undefined
): number {
  return 1 + getRsvpGuestCount(rsvp);
}

export function getSessionGoingHeadcount(sessionRsvps: SessionRsvp[]): number {
  return sessionRsvps
    .filter((r) => r.status === 'going')
    .reduce((sum, r) => sum + getRsvpPartySize(r), 0);
}

export function loadRsvpGuestsMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RSVP_GUESTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return {};
}

export function saveRsvpGuestsMap(
  guestsMap: Record<string, number>
): Record<string, number> {
  try {
    localStorage.setItem(RSVP_GUESTS_STORAGE_KEY, JSON.stringify(guestsMap));
  } catch {
    // ignore
  }
  return guestsMap;
}

export interface SessionDateDisplay {
  weekdayLong: string;
  weekdayShort: string;
  monthShort: string;
  dayNum: string;
  dayInt: number;
  year: string;
  fullLabel: string;
  compactLabel: string;
  isoWithWeekday: string;
}

export function getSessionDateDisplay(dateIso: string): SessionDateDisplay {
  const cleaned = (dateIso || '').trim();
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const yearNum = parseInt(match[1], 10);
    const monthIdx = parseInt(match[2], 10) - 1;
    const dayInt = parseInt(match[3], 10);
    const dt = new Date(yearNum, monthIdx, dayInt, 12, 0, 0);
    if (!Number.isNaN(dt.getTime())) {
      const weekdayLong = dt.toLocaleDateString('en-US', { weekday: 'long' });
      const weekdayShort = dt.toLocaleDateString('en-US', { weekday: 'short' });
      const monthShort = dt.toLocaleDateString('en-US', { month: 'short' });
      const dayNum = String(dayInt).padStart(2, '0');
      const year = String(yearNum);
      return {
        weekdayLong,
        weekdayShort,
        monthShort,
        dayNum,
        dayInt,
        year,
        fullLabel: `${weekdayLong}, ${monthShort} ${dayInt}, ${year}`,
        compactLabel: `${weekdayShort}, ${monthShort} ${dayInt}`,
        isoWithWeekday: `${weekdayLong} · ${cleaned}`,
      };
    }
  }
  return {
    weekdayLong: 'Session Day',
    weekdayShort: 'Day',
    monthShort: 'Date',
    dayNum: '--',
    dayInt: 0,
    year: '',
    fullLabel: cleaned || 'TBD',
    compactLabel: cleaned || 'TBD',
    isoWithWeekday: cleaned || 'TBD',
  };
}

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
    defaultMatchTargetPoints: 21,
    currency: 'USD',
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
    defaultMatchTargetPoints: 21,
    currency: 'USD',
    ownerId: 'local_club',
    clubOwnerPlayerId: 'player_chloe',
    clubOwnerName: 'Chloe Lim',
  },
];

export interface ClubCurrencyOption {
  code: string;
  symbol: string;
  label: string;
}

export const CLUB_CURRENCY_OPTIONS: ClubCurrencyOption[] = [
  { code: 'USD', symbol: '$', label: 'USD ($) — US Dollar' },
  { code: 'MYR', symbol: 'RM', label: 'MYR (RM) — Malaysian Ringgit' },
  { code: 'SGD', symbol: 'S$', label: 'SGD (S$) — Singapore Dollar' },
  { code: 'GBP', symbol: '£', label: 'GBP (£) — British Pound' },
  { code: 'EUR', symbol: '€', label: 'EUR (€) — Euro' },
  { code: 'AUD', symbol: 'A$', label: 'AUD (A$) — Australian Dollar' },
  { code: 'CAD', symbol: 'C$', label: 'CAD (C$) — Canadian Dollar' },
  { code: 'HKD', symbol: 'HK$', label: 'HKD (HK$) — Hong Kong Dollar' },
  { code: 'TWD', symbol: 'NT$', label: 'TWD (NT$) — New Taiwan Dollar' },
  { code: 'THB', symbol: '฿', label: 'THB (฿) — Thai Baht' },
  { code: 'IDR', symbol: 'Rp', label: 'IDR (Rp) — Indonesian Rupiah' },
  { code: 'PHP', symbol: '₱', label: 'PHP (₱) — Philippine Peso' },
  { code: 'INR', symbol: '₹', label: 'INR (₹) — Indian Rupee' },
  { code: 'JPY', symbol: '¥', label: 'JPY (¥) — Japanese Yen' },
];

export function getClubCurrencyCode(
  clubOrCode?: { currency?: string } | string | null
): string {
  const raw =
    typeof clubOrCode === 'string'
      ? clubOrCode
      : clubOrCode?.currency || 'USD';
  const normalized = raw.trim().toUpperCase();
  const found = CLUB_CURRENCY_OPTIONS.find((c) => c.code === normalized);
  return found ? found.code : 'USD';
}

export function getClubCurrencySymbol(
  clubOrCode?: { currency?: string } | string | null
): string {
  const code = getClubCurrencyCode(clubOrCode);
  const found = CLUB_CURRENCY_OPTIONS.find((c) => c.code === code);
  return found ? found.symbol : '$';
}

export function formatClubCurrency(
  amount: number,
  clubOrCode?: { currency?: string } | string | null,
  decimals = 2
): string {
  const sym = getClubCurrencySymbol(clubOrCode);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `${sym}${safeAmount.toFixed(decimals)}`;
}

export interface ClubLocalRules {
  excludeOwnerFromBilling: boolean;
  defaultMatchTargetPoints?: number;
  currency?: string;
}

export function loadClubBillingRulesMap(): Record<string, ClubLocalRules> {
  const defaults: Record<string, ClubLocalRules> = {
    club_bintang_prime: {
      excludeOwnerFromBilling: false,
      defaultMatchTargetPoints: 21,
      currency: 'USD',
    },
    club_metro_smash: {
      excludeOwnerFromBilling: false,
      defaultMatchTargetPoints: 21,
      currency: 'USD',
    },
  };
  try {
    const raw = localStorage.getItem(CLUB_BILLING_RULES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, ClubLocalRules>;
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore
  }
  return defaults;
}

export function saveClubBillingRule(
  clubId: string,
  excludeOwnerFromBilling: boolean,
  defaultMatchTargetPoints?: number,
  currency?: string
): Record<string, ClubLocalRules> {
  const current = loadClubBillingRulesMap();
  const prevEntry = current[clubId];
  const resolvedTargetPoints =
    defaultMatchTargetPoints !== undefined
      ? Math.max(1, Math.min(100, Math.round(defaultMatchTargetPoints)))
      : prevEntry?.defaultMatchTargetPoints ?? 21;
  const resolvedCurrency =
    currency !== undefined
      ? getClubCurrencyCode(currency)
      : prevEntry?.currency || 'USD';
  const next: Record<string, ClubLocalRules> = {
    ...current,
    [clubId]: {
      excludeOwnerFromBilling: Boolean(excludeOwnerFromBilling),
      defaultMatchTargetPoints: resolvedTargetPoints,
      currency: resolvedCurrency,
    },
  };
  try {
    localStorage.setItem(CLUB_BILLING_RULES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function isClubPrivate(club: Pick<Club, 'visibility'> | null | undefined): boolean {
  return club?.visibility === 'private';
}

export function loadClubJoinRequests(): ClubJoinRequest[] {
  try {
    const raw = localStorage.getItem(CLUB_JOIN_REQUESTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (r): r is ClubJoinRequest =>
            Boolean(r) &&
            typeof (r as ClubJoinRequest).id === 'string' &&
            typeof (r as ClubJoinRequest).clubId === 'string' &&
            typeof (r as ClubJoinRequest).playerId === 'string'
        );
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveClubJoinRequests(requests: ClubJoinRequest[]): void {
  try {
    localStorage.setItem(CLUB_JOIN_REQUESTS_STORAGE_KEY, JSON.stringify(requests));
  } catch {
    // ignore
  }
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
  const current = loadClubOwnerMap();
  const next: Record<string, { playerId: string; playerName: string }> = {};
  for (const [existingClubId, entry] of Object.entries(current)) {
    // Enforce: 1 club per owner — a player cannot own more than one club
    if (existingClubId !== clubId && entry.playerId === playerId) {
      continue;
    }
    next[existingClubId] = entry;
  }
  next[clubId] = { playerId, playerName };
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
    pointsConceded: 304,
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
    pointsScored: 356,
    pointsConceded: 268,
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
    wins: 11,
    losses: 2,
    gamesPlayed: 13,
    pointsScored: 271,
    pointsConceded: 229,
    singlesWins: 3,
    singlesLosses: 1,
    doublesWins: 8,
    doublesLosses: 1,
    ratingScore: 1430,
    ownerId: 'local_club',
  },
  {
    id: 'player_marcus',
    name: 'Marcus Chen',
    playerTag: 'marcus#412',
    joinedClubIdsCsv: 'club_bintang_prime',
    wins: 13,
    losses: 11,
    gamesPlayed: 24,
    pointsScored: 462,
    pointsConceded: 454,
    singlesWins: 5,
    singlesLosses: 5,
    doublesWins: 8,
    doublesLosses: 6,
    ratingScore: 1278,
    ownerId: 'local_club',
  },
  {
    id: 'player_samantha',
    name: 'Samantha Wong',
    playerTag: 'sam#519',
    joinedClubIdsCsv: 'club_bintang_prime,club_metro_smash',
    wins: 10,
    losses: 5,
    gamesPlayed: 15,
    pointsScored: 308,
    pointsConceded: 284,
    singlesWins: 4,
    singlesLosses: 1,
    doublesWins: 6,
    doublesLosses: 4,
    ratingScore: 1318,
    ownerId: 'local_club',
  },
  {
    id: 'player_ryan',
    name: 'Ryan Koh',
    playerTag: 'ryan#625',
    joinedClubIdsCsv: 'club_bintang_prime',
    wins: 9,
    losses: 11,
    gamesPlayed: 20,
    pointsScored: 392,
    pointsConceded: 376,
    singlesWins: 3,
    singlesLosses: 5,
    doublesWins: 6,
    doublesLosses: 6,
    ratingScore: 1210,
    ownerId: 'local_club',
  },
  {
    id: 'player_daniel',
    name: 'Daniel Ng',
    playerTag: 'daniel#730',
    joinedClubIdsCsv: 'club_bintang_prime,club_metro_smash',
    wins: 8,
    losses: 14,
    gamesPlayed: 22,
    pointsScored: 384,
    pointsConceded: 438,
    singlesWins: 2,
    singlesLosses: 6,
    doublesWins: 6,
    doublesLosses: 8,
    ratingScore: 1164,
    ownerId: 'local_club',
  },
  {
    id: 'player_hannah',
    name: 'Hannah Goh',
    playerTag: 'hannah#841',
    joinedClubIdsCsv: 'club_bintang_prime',
    wins: 4,
    losses: 10,
    gamesPlayed: 14,
    pointsScored: 236,
    pointsConceded: 289,
    singlesWins: 1,
    singlesLosses: 4,
    doublesWins: 3,
    doublesLosses: 6,
    ratingScore: 1098,
    ownerId: 'local_club',
  },
];

export const INITIAL_SESSIONS: Session[] = [
  {
    id: 'session_oct24_proposed',
    clubId: 'club_bintang_prime',
    title: 'Saturday Proposed Club Session',
    venue: 'Bintang Badminton Hall',
    courtNumbers: 'Court 1, Court 2 (TBD)',
    sessionDate: '2026-10-24',
    startTime: '18:00',
    endTime: '20:00',
    bookingStatus: 'pending',
    courtFee: 72,
    shuttlesUsed: 0,
    shuttleUnitCost: 3.0,
    shuttleFee: 0,
    maxPlayers: 12,
    organizerName: 'Alex Tan',
    paymentInfo: 'PayNow / Venmo @AlexTan-Shuttle',
    feeSplitFinalized: false,
    ownerId: 'local_club',
  },
  {
    id: 'session_oct22_upcoming',
    clubId: 'club_bintang_prime',
    title: 'Evening Club Rotation',
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
    title: 'Afternoon Competitive Sparring',
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
    title: 'Evening Club Rotation',
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
    title: 'Prime Doubles & Singles Night',
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
    title: 'Morning High-Intensity Doubles',
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

  // Proposed Oct 24 session (Court not yet booked — 7 players confirmed so far!)
  {
    id: 'rsvp_oct24_alex',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct24_proposed',
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
    id: 'rsvp_oct24_kevin',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct24_proposed',
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
    id: 'rsvp_oct24_chloe',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct24_proposed',
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
    id: 'rsvp_oct24_samantha',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct24_proposed',
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
    id: 'rsvp_oct24_marcus',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct24_proposed',
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
  {
    id: 'rsvp_oct24_daniel',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct24_proposed',
    playerId: 'player_daniel',
    playerName: 'Daniel Ng',
    status: 'going',
    attendanceOutcome: 'present',
    penaltyPercentApplied: 100,
    feeShare: 0,
    paidStatus: 'unpaid',
    paidMethod: 'pending',
    ownerId: 'local_club',
  },
  {
    id: 'rsvp_oct24_hannah',
    clubId: 'club_bintang_prime',
    sessionId: 'session_oct24_proposed',
    playerId: 'player_hannah',
    playerName: 'Hannah Goh',
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

export function parseSessionTimeMinutes(
  timeStr: string | undefined,
  fallbackHours = 20,
  fallbackMinutes = 0
): { hours: number; minutes: number } {
  const cleaned = (timeStr || '').trim().toLowerCase();
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) {
    return { hours: fallbackHours, minutes: fallbackMinutes };
  }
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3];
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (Number.isNaN(hours) || hours < 0 || hours > 23) hours = fallbackHours;
  return {
    hours,
    minutes: Number.isNaN(minutes) || minutes < 0 || minutes > 59 ? 0 : minutes,
  };
}

export function getSessionStartTimestampMs(
  session: Pick<Session, 'sessionDate' | 'startTime'>
): number | null {
  const cleanedDate = (session.sessionDate || '').trim();
  const dateMatch = cleanedDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return null;
  const year = parseInt(dateMatch[1], 10);
  const monthIdx = parseInt(dateMatch[2], 10) - 1;
  const day = parseInt(dateMatch[3], 10);
  const { hours, minutes } = parseSessionTimeMinutes(session.startTime, 20, 0);
  const dt = new Date(year, monthIdx, day, hours, minutes, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

export function getSessionEndTimestampMs(
  session: Pick<Session, 'sessionDate' | 'startTime' | 'endTime'>
): number | null {
  const cleanedDate = (session.sessionDate || '').trim();
  const dateMatch = cleanedDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return null;
  const year = parseInt(dateMatch[1], 10);
  const monthIdx = parseInt(dateMatch[2], 10) - 1;
  const day = parseInt(dateMatch[3], 10);
  const start = parseSessionTimeMinutes(session.startTime, 20, 0);
  const end = session.endTime?.trim()
    ? parseSessionTimeMinutes(session.endTime, 22, 0)
    : { hours: Math.min(23, start.hours + 2), minutes: start.minutes };
  const startTotalMins = start.hours * 60 + start.minutes;
  const endTotalMins = end.hours * 60 + end.minutes;
  // If end time wraps past midnight (e.g. 23:00 to 01:00), roll forward 1 day
  const extraDays = endTotalMins < startTotalMins ? 1 : 0;
  const dt = new Date(year, monthIdx, day + extraDays, end.hours, end.minutes, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

/**
 * Returns true if the session is marked 'completed' OR if its scheduled end date/time
 * has already passed relative to `now`.
 */
export function isSessionCompletedOrPast(
  session: Pick<Session, 'bookingStatus' | 'sessionDate' | 'startTime' | 'endTime'>,
  now: Date | number = Date.now()
): boolean {
  if (session.bookingStatus === 'completed') return true;
  const endMs = getSessionEndTimestampMs(session);
  if (endMs === null) return false;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return nowMs >= endMs;
}

/**
 * Evaluates whether a player can tap out of a future session based on the Club's configurable
 * freeCancelHours, lockCancelHours, and lateCancelFeePercent.
 */
export function evaluateTapOutWindow(
  session: Session,
  club: Club,
  now: Date | number = Date.now()
): TapOutPolicyEvaluation {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const sessionStartMs = getSessionStartTimestampMs(session);

  const diffHours =
    sessionStartMs === null
      ? 48
      : Math.max(0, (sessionStartMs - nowMs) / (1000 * 3600));

  // Once the session has started, or inside the club's lock cutoff, the spot can no
  // longer be released: an absent player is marked a no-show by the organizer instead.
  const hasStarted = sessionStartMs !== null && nowMs >= sessionStartMs;
  const lockHours = Math.max(0, Number(club.lockCancelHours) || 0);
  if (hasStarted || diffHours < lockHours) {
    return {
      hoursUntilStart: diffHours,
      canTapOut: false,
      isPenaltyWindow: true,
      penaltyPercent: club.lateCancelFeePercent,
      policySummary: hasStarted
        ? 'Cancellation closed (session has started)'
        : `Cancellation locked (<${lockHours}h before start)`,
    };
  }

  if (diffHours < club.freeCancelHours) {
    const timeLeftLabel =
      diffHours > 0 ? `${diffHours.toFixed(1)}h left · ` : '';
    return {
      hoursUntilStart: diffHours,
      canTapOut: true,
      isPenaltyWindow: true,
      penaltyPercent: club.lateCancelFeePercent,
      policySummary: `Late Tap-Out Window (${timeLeftLabel}<${club.freeCancelHours}h incurs ${club.lateCancelFeePercent}% court fee)`,
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

  const activeRsvps = sessionRsvps.filter((r) => {
    const guestCount = getRsvpGuestCount(r);
    if (r.playerId === excludedOwnerId && guestCount === 0) {
      return false;
    }
    return (
      r.status === 'going' ||
      (r.status === 'late_out' && r.penaltyPercentApplied > 0)
    );
  });

  // Determine court weight & headcount for each RSVP (including any +1 guests billed to the host player)
  let totalCourtWeight = 0;
  let presentHeadcount = 0;

  const weights = activeRsvps.map((r) => {
    const guestCount = getRsvpGuestCount(r);
    const isExcludedOwner = Boolean(excludedOwnerId && r.playerId === excludedOwnerId);
    // If owner is excluded from billing, their own 1 spot is free, but any +1 guest they bring is still 1 billable spot
    const billablePartySize = isExcludedOwner ? guestCount : 1 + guestCount;

    let weight = 0;
    let pct = 0;
    if (billablePartySize > 0) {
      if (r.status === 'going') {
        if (r.attendanceOutcome === 'present') {
          weight = 1.0 * billablePartySize;
          pct = 100;
          presentHeadcount += billablePartySize;
        } else if (r.attendanceOutcome === 'no_show') {
          pct = noShowFeePercent;
          weight = (pct / 100) * billablePartySize;
        } else {
          weight = 0;
          pct = 0;
        }
      } else if (r.status === 'late_out') {
        pct = r.penaltyPercentApplied;
        weight = (pct / 100) * billablePartySize;
      }
    }
    totalCourtWeight += weight;
    return { rsvp: r, weight, pct, billablePartySize };
  });

  const shuttlePerPresentHead =
    presentHeadcount > 0 ? shuttleFee / presentHeadcount : 0;

  sessionRsvps.forEach((r) => {
    const found = weights.find((w) => w.rsvp.id === r.id);
    if (!found || found.weight <= 0) {
      result.set(r.id, { feeShare: 0, penaltyPercentApplied: 0 });
      return;
    }
    const courtPortion =
      totalCourtWeight > 0 ? courtFee * (found.weight / totalCourtWeight) : 0;
    const shuttlePortion =
      r.status === 'going' && r.attendanceOutcome === 'present'
        ? shuttlePerPresentHead * found.billablePartySize
        : 0;
    const totalShare = Number((courtPortion + shuttlePortion).toFixed(2));
    result.set(r.id, {
      feeShare: totalShare,
      penaltyPercentApplied: found.pct,
    });
  });

  return result;
}

export type QuickSessionDefaults = Partial<
  Pick<
    ParsedQuickSession,
    'title' | 'venue' | 'sessionDate' | 'startTime' | 'endTime' | 'maxPlayers' | 'courtFee'
  >
>;

const WEEKDAY_KEYWORDS: [RegExp, number][] = [
  [/\b(sun|sunday)\b/i, 0],
  [/\b(mon|monday)\b/i, 1],
  [/\b(tue|tues|tuesday)\b/i, 2],
  [/\b(wed|wednesday)\b/i, 3],
  [/\b(thu|thur|thurs|thursday)\b/i, 4],
  [/\b(fri|friday)\b/i, 5],
  [/\b(sat|saturday)\b/i, 6],
];

/**
 * Parses a one-line session summary. Anything the text does not mention comes from
 * `defaults` (normally the club's previous session), and weekday names resolve to the
 * next such day on or after `today`.
 */
export function parseQuickSessionInput(
  input: string,
  defaults: QuickSessionDefaults = {},
  today: Date = new Date()
): ParsedQuickSession {
  const raw = input.trim();

  const defaultVenue = defaults.venue ?? '';
  let venue = defaultVenue;
  let courtNumbers = '';
  let sessionDate =
    defaults.sessionDate ?? toIsoDate(new Date(today.getTime() + 86400000));
  let startTime = defaults.startTime ?? '20:00';
  let endTime = defaults.endTime ?? '22:00';
  let courtFee = defaults.courtFee ?? 0;
  let courtFeeFromText = false;
  let maxPlayers = defaults.maxPlayers ?? 8;
  let bookingStatus: 'pending' | 'booked' = 'pending';

  const isExplicitlyUnbooked = /\b(pending|unbooked|tbd|not\s+booked|proposed)\b/i.test(raw);
  const isExplicitlyBooked = !isExplicitlyUnbooked && /\bbooked\b/i.test(raw);
  if (isExplicitlyBooked) {
    bookingStatus = 'booked';
  }

  const courtMatch = raw.match(
    /\bcourts?\s*([0-9]+(?:\s*(?:&|,|and|-|to)\s*[0-9]+)*)/i
  );
  if (courtMatch && bookingStatus === 'booked') {
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
    courtFeeFromText = true;
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

  const weekday = WEEKDAY_KEYWORDS.find(([re]) => re.test(raw));
  if (weekday) {
    sessionDate = nextDateForWeekday(weekday[1], today, true);
  }

  const venueMatch = raw.match(/(?:@|\bat\b)\s+([^,$]+?)(?=\s+\bcourts?\b|,|\$|$)/i);
  if (venueMatch && venueMatch[1].trim().length > 1) {
    venue = venueMatch[1].trim();
  }

  const title =
    venue && venue !== defaultVenue
      ? `Court Session · ${venue}`
      : defaults.title || 'Weekly Badminton Session';

  return {
    title: title.slice(0, 120),
    venue: venue.slice(0, 120),
    courtNumbers: bookingStatus === 'pending' ? '' : courtNumbers.slice(0, 60),
    sessionDate,
    startTime,
    endTime,
    courtFee,
    courtFeeFromText,
    maxPlayers,
    bookingStatus,
  };
}

export function isValidMatchPlayerId(id: string | null | undefined): boolean {
  if (!id) return false;
  const cleaned = id.trim();
  return cleaned.length > 0 && cleaned.toUpperCase() !== 'NONE';
}

export function isValidMatchPlayerName(
  name: string | null | undefined
): boolean {
  if (!name) return false;
  const cleaned = name.trim();
  return cleaned.length > 0 && cleaned.toLowerCase() !== 'none';
}

export function getMatchSidePlayers(
  match: BadmintonMatch,
  side: 'A' | 'B'
): { id: string; name: string }[] {
  const p1Id = side === 'A' ? match.teamAPlayer1Id : match.teamBPlayer1Id;
  const p1Name = side === 'A' ? match.teamAPlayer1Name : match.teamBPlayer1Name;
  const p2Id = side === 'A' ? match.teamAPlayer2Id : match.teamBPlayer2Id;
  const p2Name = side === 'A' ? match.teamAPlayer2Name : match.teamBPlayer2Name;

  const list: { id: string; name: string }[] = [];
  if (isValidMatchPlayerId(p1Id) && isValidMatchPlayerName(p1Name)) {
    list.push({ id: p1Id.trim(), name: p1Name.trim() });
  }
  if (
    match.matchFormat === 'doubles' &&
    isValidMatchPlayerId(p2Id) &&
    isValidMatchPlayerName(p2Name)
  ) {
    list.push({ id: p2Id.trim(), name: p2Name.trim() });
  }
  return list;
}

export function getPlayerSideInMatch(
  match: BadmintonMatch,
  playerId: string
): 'A' | 'B' | null {
  if (!isValidMatchPlayerId(playerId)) return null;
  if (getMatchSidePlayers(match, 'A').some((p) => p.id === playerId)) {
    return 'A';
  }
  if (getMatchSidePlayers(match, 'B').some((p) => p.id === playerId)) {
    return 'B';
  }
  return null;
}

export function isPlayerInMatch(
  match: BadmintonMatch,
  playerId: string
): boolean {
  return getPlayerSideInMatch(match, playerId) !== null;
}

export function formatMatchSideLabel(
  match: BadmintonMatch,
  side: 'A' | 'B'
): string {
  const playersOnSide = getMatchSidePlayers(match, side);
  if (playersOnSide.length === 0) {
    return side === 'A' ? match.teamAPlayer1Name : match.teamBPlayer1Name;
  }
  return playersOnSide.map((p) => p.name).join(' & ');
}

export function computePlayerLeaderboardAndTiers(
  players: Player[],
  matches: BadmintonMatch[]
): RankedPlayer[] {
  const recentFormMap = new Map<string, ('W' | 'L')[]>();
  players.forEach((p) => recentFormMap.set(p.id, []));

  // Tally actual recorded matches per player (both singles and doubles)
  const matchTallies = new Map<
    string,
    {
      singlesWins: number;
      singlesLosses: number;
      singlesPointsScored: number;
      singlesPointsConceded: number;
      doublesWins: number;
      doublesLosses: number;
      doublesPointsScored: number;
      doublesPointsConceded: number;
      pointsScored: number;
      pointsConceded: number;
    }
  >();

  matches.forEach((m) => {
    const teamAIds = getMatchSidePlayers(m, 'A').map((p) => p.id);
    const teamBIds = getMatchSidePlayers(m, 'B').map((p) => p.id);
    const aWon = m.winnerSide === 'A';
    const isDoubles = m.matchFormat === 'doubles';

    teamAIds.forEach((id) => {
      const arr = recentFormMap.get(id) || [];
      arr.push(aWon ? 'W' : 'L');
      recentFormMap.set(id, arr.slice(-5));

      const t = matchTallies.get(id) || {
        singlesWins: 0,
        singlesLosses: 0,
        singlesPointsScored: 0,
        singlesPointsConceded: 0,
        doublesWins: 0,
        doublesLosses: 0,
        doublesPointsScored: 0,
        doublesPointsConceded: 0,
        pointsScored: 0,
        pointsConceded: 0,
      };
      if (isDoubles) {
        if (aWon) t.doublesWins += 1;
        else t.doublesLosses += 1;
        t.doublesPointsScored += m.scoreTeamA;
        t.doublesPointsConceded += m.scoreTeamB;
      } else {
        if (aWon) t.singlesWins += 1;
        else t.singlesLosses += 1;
        t.singlesPointsScored += m.scoreTeamA;
        t.singlesPointsConceded += m.scoreTeamB;
      }
      t.pointsScored += m.scoreTeamA;
      t.pointsConceded += m.scoreTeamB;
      matchTallies.set(id, t);
    });

    teamBIds.forEach((id) => {
      const arr = recentFormMap.get(id) || [];
      arr.push(!aWon ? 'W' : 'L');
      recentFormMap.set(id, arr.slice(-5));

      const t = matchTallies.get(id) || {
        singlesWins: 0,
        singlesLosses: 0,
        singlesPointsScored: 0,
        singlesPointsConceded: 0,
        doublesWins: 0,
        doublesLosses: 0,
        doublesPointsScored: 0,
        doublesPointsConceded: 0,
        pointsScored: 0,
        pointsConceded: 0,
      };
      if (isDoubles) {
        if (!aWon) t.doublesWins += 1;
        else t.doublesLosses += 1;
        t.doublesPointsScored += m.scoreTeamB;
        t.doublesPointsConceded += m.scoreTeamA;
      } else {
        if (!aWon) t.singlesWins += 1;
        else t.singlesLosses += 1;
        t.singlesPointsScored += m.scoreTeamB;
        t.singlesPointsConceded += m.scoreTeamA;
      }
      t.pointsScored += m.scoreTeamB;
      t.pointsConceded += m.scoreTeamA;
      matchTallies.set(id, t);
    });
  });

  const enriched = players.map((player) => {
    const tally = matchTallies.get(player.id);

    // Strictly recount standings from the provided (club-scoped) matches
    // so switching clubs recounts from scratch instead of carrying forward records.
    const singlesWins = tally?.singlesWins ?? 0;
    const singlesLosses = tally?.singlesLosses ?? 0;
    const doublesWins = tally?.doublesWins ?? 0;
    const doublesLosses = tally?.doublesLosses ?? 0;

    const wins = singlesWins + doublesWins;
    const losses = singlesLosses + doublesLosses;
    const games = wins + losses;

    const pointsScored = tally?.pointsScored ?? 0;
    const pointsConceded = tally?.pointsConceded ?? 0;

    const singlesPointsScored = tally?.singlesPointsScored ?? 0;
    const singlesPointsConceded = tally?.singlesPointsConceded ?? 0;
    const doublesPointsScored = tally?.doublesPointsScored ?? 0;
    const doublesPointsConceded = tally?.doublesPointsConceded ?? 0;

    const winRate = games > 0 ? (wins / games) * 100 : 0;
    const avgPointDiff =
      games > 0 ? (pointsScored - pointsConceded) / games : 0;
    const totalPoints = pointsScored + pointsConceded;
    const pointsShare =
      totalPoints > 0 ? (pointsScored / totalPoints) * 100 : 50;

    const baseRating = 1200;

    const calculatedRating =
      games > 0
        ? Math.round(
            1050 + winRate * 3.8 + avgPointDiff * 14 + Math.min(games, 25) * 4
          )
        : baseRating;

    const finalRating =
      games > 0
        ? Math.max(900, Math.round((baseRating + calculatedRating) / 2))
        : baseRating;

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

    const pointDiff = pointsScored - pointsConceded;

    return {
      ...player,
      wins,
      losses,
      singlesWins,
      singlesLosses,
      doublesWins,
      doublesLosses,
      gamesPlayed: games,
      pointsScored,
      pointsConceded,
      singlesPointsScored,
      singlesPointsConceded,
      doublesPointsScored,
      doublesPointsConceded,
      ratingScore: finalRating,
      rank: 0,
      winRate,
      pointDiff,
      avgPointDiff,
      pointsShare,
      tier,
      tierTitle,
      recentForm: recentFormMap.get(player.id) || [],
    };
  });

  enriched.sort((a, b) => {
    if (b.ratingScore !== a.ratingScore) return b.ratingScore - a.ratingScore;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    return a.name.localeCompare(b.name);
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

/**
 * Computes accumulated unpaid balances for all players in a single O(S + C + R) pass
 * instead of O(P * (S + C + R)), preventing lag on large member rosters.
 */
export function calculateOutstandingBalancesByPlayerMap(
  sessions: Session[],
  rsvps: SessionRsvp[],
  clubIdFilter?: string,
  clubs?: Club[]
): Map<string, OutstandingDebtItem[]> {
  const result = new Map<string, OutstandingDebtItem[]>();
  const finalizedSessionMap = new Map<string, Session>();
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    if (s.feeSplitFinalized && s.bookingStatus === 'completed') {
      finalizedSessionMap.set(s.id, s);
    }
  }

  const clubOwnerByClubId = new Map<string, string>();
  if (clubs) {
    for (let i = 0; i < clubs.length; i++) {
      const c = clubs[i];
      if (c.clubOwnerPlayerId) {
        clubOwnerByClubId.set(c.id, c.clubOwnerPlayerId);
      }
    }
  }

  for (let i = 0; i < rsvps.length; i++) {
    const r = rsvps[i];
    if (
      r.paidStatus === 'paid' ||
      r.feeShare <= 0 ||
      (clubIdFilter && r.clubId !== clubIdFilter) ||
      clubOwnerByClubId.get(r.clubId) === r.playerId
    ) {
      continue;
    }
    const session = finalizedSessionMap.get(r.sessionId);
    if (!session) continue;

    const existing = result.get(r.playerId);
    if (existing) {
      existing.push({ rsvp: r, session });
    } else {
      result.set(r.playerId, [{ rsvp: r, session }]);
    }
  }

  return result;
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
  const goingHeadcount = getSessionGoingHeadcount(sessionRsvps);
  const rosterLines =
    goingList.length > 0
      ? goingList
          .map((r, i) => {
            const guests = getRsvpGuestCount(r);
            return `${i + 1}. ${r.playerName}${
              guests > 0
                ? ` (+${guests} ${guests === 1 ? 'Guest' : 'Guests'})`
                : ''
            }`;
          })
          .join('\n')
      : '1. (Sign in via link to join)';

  const shareUrl = buildShareableClubAndSessionUrl(club.id, session);
  const dateDisplay = getSessionDateDisplay(session.sessionDate);
  const isProposed = session.bookingStatus === 'pending';
  const advice = isProposed
    ? evaluateCourtBookingAdvice(session, sessionRsvps, club)
    : null;

  return [
    `[${club.name}] ${session.title}${isProposed ? ' (PROPOSED · COURT NOT YET BOOKED)' : ''}`,
    `${dateDisplay.fullLabel} · ${session.startTime}–${session.endTime}`,
    `${session.venue} (${session.courtNumbers})`,
    !advice
      ? `Court Fee: ${formatClubCurrency(session.courtFee, club)} (+ shuttles split after session ends)`
      : advice.totalCost === null
      ? `Est. Court Cost: to be confirmed (${formatCourtCount(advice.recommendedCourts)} planned)`
      : `Est. Court Cost: ${formatClubCurrency(advice.totalCost, club)} for ${formatCourtCount(advice.recommendedCourts)}${
          advice.costPerPlayer === null
            ? ''
            : ` · ~${formatClubCurrency(advice.costPerPlayer, club)}/person with ${advice.billableCount} going`
        }`,
    `Tap-Out Policy: Free >${club.freeCancelHours}h prior · ${club.lateCancelFeePercent}% fee <${club.freeCancelHours}h · No-Show ${club.noShowFeePercent}%`,
    `Going (${goingHeadcount}/${session.maxPlayers}):`,
    rosterLines,
    ``,
    `Direct RSVP Link (Tap to Join or Pass):`,
    shareUrl,
  ].join('\n');
}

export function makeClubWalletKey(clubId: string, playerId: string): string {
  return `${clubId}::${playerId}`;
}

export function getPlayerClubWallet(
  player: Player | null | undefined,
  clubId?: string | null,
  walletsMap?: Record<string, PlayerBenefitWallet>
): PlayerBenefitWallet {
  const emptyWallet: PlayerBenefitWallet = {
    creditBalance: 0,
    freeSessionPasses: 0,
    waiveAllFees: false,
  };
  if (!player) return emptyWallet;

  if (clubId && clubId !== 'all') {
    const compositeKey = makeClubWalletKey(clubId, player.id);
    if (walletsMap && walletsMap[compositeKey]) {
      const w = walletsMap[compositeKey];
      return {
        creditBalance: Math.max(0, Number((w.creditBalance || 0).toFixed(2))),
        freeSessionPasses: Math.max(0, Math.floor(Number(w.freeSessionPasses || 0))),
        waiveAllFees: Boolean(w.waiveAllFees),
      };
    }
    if (player.clubWallets && player.clubWallets[clubId]) {
      const w = player.clubWallets[clubId];
      return {
        creditBalance: Math.max(0, Number((w.creditBalance || 0).toFixed(2))),
        freeSessionPasses: Math.max(0, Math.floor(Number(w.freeSessionPasses || 0))),
        waiveAllFees: Boolean(w.waiveAllFees),
      };
    }
    // If clubWallets map is present on the player, any club not in it has an empty wallet
    if (player.clubWallets || walletsMap) {
      return emptyWallet;
    }
  }

  return {
    creditBalance: Math.max(0, Number((player.creditBalance || 0).toFixed(2))),
    freeSessionPasses: Math.max(0, Math.floor(Number(player.freeSessionPasses || 0))),
    waiveAllFees: Boolean(player.waiveAllFees),
  };
}

export function loadPlayerWalletsMap(): Record<string, PlayerBenefitWallet> {
  const defaultClubKey = makeClubWalletKey('club_bintang_prime', 'player_samantha');
  const defaults: Record<string, PlayerBenefitWallet> = {
    [defaultClubKey]: {
      creditBalance: 15.0,
      freeSessionPasses: 1,
      waiveAllFees: false,
    },
  };
  try {
    const raw = localStorage.getItem(PLAYER_WALLETS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, PlayerBenefitWallet>;
      const migrated: Record<string, PlayerBenefitWallet> = { ...defaults };
      for (const [k, v] of Object.entries(parsed)) {
        if (!v || typeof v !== 'object') continue;
        if (k.includes('::')) {
          migrated[k] = v;
        } else {
          // Migrate legacy global playerId key to default club (Bintang Prime)
          const scopedKey = makeClubWalletKey('club_bintang_prime', k);
          if (!parsed[scopedKey]) {
            migrated[scopedKey] = v;
          }
        }
      }
      return migrated;
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

/** Credit already taken from a wallet by an earlier finalize ("Credit -$12.50"), else 0. */
export function parsePartialCreditApplied(paidMethod: string): number {
  const match = /^Credit -\$(\d+(?:\.\d+)?)$/.exec(paidMethod || '');
  return match ? Number(match[1]) : 0;
}

/**
 * Applies each player's active Club Wallet Benefits (Waive All Fees -> Free Session Passes -> Credit Balance)
 * scoped to the session's clubId when a session's fee split is finalized or updated.
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
        // The owner's own spot is free, but any +1 guests they bring were counted as
        // billable weight in the split, so keep that share on the owner's row (covered
        // by the owner) instead of dropping it and leaving the session under-collected.
        return {
          ...r,
          feeShare: calc.feeShare,
          penaltyPercentApplied: calc.penaltyPercentApplied,
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

    const clubWalletKey = makeClubWalletKey(r.clubId, r.playerId);
    const existingWallet = nextWallets[clubWalletKey];
    const wallet: PlayerBenefitWallet = existingWallet
      ? { ...existingWallet }
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
      nextWallets[clubWalletKey] = wallet;
    }
    // Priority 3: Dollar Credit Balance
    else if (wallet.creditBalance > 0) {
      if (wallet.creditBalance >= calc.feeShare) {
        wallet.creditBalance = Number(
          (wallet.creditBalance - calc.feeShare).toFixed(2)
        );
        nextPaidStatus = 'paid';
        nextPaidMethod = `Credit ($${calc.feeShare.toFixed(2)})`;
        nextWallets[clubWalletKey] = wallet;
      } else {
        // Partial credit reduces the remaining feeShare owed
        const applied = Number(wallet.creditBalance.toFixed(2));
        finalFeeShare = Number((calc.feeShare - applied).toFixed(2));
        wallet.creditBalance = 0;
        nextPaidStatus = 'unpaid';
        nextPaidMethod = `Credit -$${applied.toFixed(2)}`;
        nextWallets[clubWalletKey] = wallet;
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
 * Immediately applies a player's newly updated club wallet (Waiver, Free Session Passes, or Credit Balance)
 * against any existing finalized unpaid RSVPs in that specific club (oldest session first) so their current debt
 * in that club is settled automatically, while preserving remaining passes/credits for future sessions in that club.
 */
export function settlePlayerExistingUnpaidRsvpsWithWallet(params: {
  playerId: string;
  clubId?: string;
  wallet: PlayerBenefitWallet;
  rsvps: SessionRsvp[];
  sessions: Session[];
}): {
  updatedRsvps: SessionRsvp[];
  remainingWallet: PlayerBenefitWallet;
  modifiedRsvps: SessionRsvp[];
} {
  const { playerId, clubId, wallet, rsvps, sessions } = params;
  const workingWallet: PlayerBenefitWallet = {
    creditBalance: Math.max(0, Number((wallet.creditBalance || 0).toFixed(2))),
    freeSessionPasses: Math.max(0, Math.floor(wallet.freeSessionPasses || 0)),
    waiveAllFees: Boolean(wallet.waiveAllFees),
  };

  const sessionMap = new Map<string, Session>();
  sessions.forEach((s) => sessionMap.set(s.id, s));

  // Find all finalized unpaid RSVPs for this player in this club, sorted oldest session first
  const candidateRsvps = rsvps
    .filter((r) => {
      if (
        r.playerId !== playerId ||
        (clubId && r.clubId !== clubId) ||
        r.paidStatus === 'paid' ||
        r.feeShare <= 0
      ) {
        return false;
      }
      const sess = sessionMap.get(r.sessionId);
      return Boolean(
        sess &&
          sess.bookingStatus === 'completed' &&
          sess.feeSplitFinalized &&
          (!clubId || sess.clubId === clubId)
      );
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
