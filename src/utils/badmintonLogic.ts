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

/** Removes a club from a raw joinedClubIdsCsv while preserving remaining club IDs in order. */
export function removeClubFromCsv(rawCsv: string, clubId: string): string {
  const current = (rawCsv || '').trim();
  if (!current) return '';
  return current
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== clubId)
    .join(',');
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

  if (sessionStartMs === null) {
    return {
      hoursUntilStart: 0,
      canTapOut: false,
      isPenaltyWindow: true,
      penaltyPercent: club.lateCancelFeePercent,
      policySummary: 'Cancellation locked (invalid session start time)',
    };
  }

  const diffHours = Math.max(0, (sessionStartMs - nowMs) / (1000 * 3600));

  // Once the session has started, or inside the club's lock cutoff, the spot can no
  // longer be released: an absent player is marked a no-show by the organizer instead.
  const hasStarted = nowMs >= sessionStartMs;
  const lockHours = Math.max(0, Number(club.lockCancelHours) || 0);
  if (hasStarted || diffHours <= lockHours) {
    return {
      hoursUntilStart: diffHours,
      canTapOut: false,
      isPenaltyWindow: true,
      penaltyPercent: club.lateCancelFeePercent,
      policySummary: hasStarted
        ? 'Cancellation closed (session has started)'
        : `Cancellation locked (<=${lockHours}h before start)`,
    };
  }

  const freeCancelHours = Math.max(0, Number(club.freeCancelHours) || 0);
  if (freeCancelHours <= 0 || diffHours <= freeCancelHours) {
    const timeLeftLabel =
      diffHours > 0 ? `${diffHours.toFixed(1)}h left · ` : '';
    return {
      hoursUntilStart: diffHours,
      canTapOut: true,
      isPenaltyWindow: true,
      penaltyPercent: club.lateCancelFeePercent,
      policySummary: `Late Tap-Out Window (${timeLeftLabel}<=${freeCancelHours}h incurs ${club.lateCancelFeePercent}% court fee)`,
    };
  }

  return {
    hoursUntilStart: diffHours,
    canTapOut: true,
    isPenaltyWindow: false,
    penaltyPercent: 0,
    policySummary: `Free Tap-Out (${Math.round(diffHours)}h until match · >${freeCancelHours}h is 0% fee)`,
  };
}

/**
 * Allocates an integer number of cents across weighted buckets using the
 * largest-remainder method so the integer shares always sum to `totalCents`
 * whenever `totalWeight > 0`.
 */
function allocateLargestRemainderCents(
  totalCents: number,
  items: { id: string; weight: number }[]
): Map<string, number> {
  const allocated = new Map<string, number>();
  items.forEach((item) => allocated.set(item.id, 0));

  const cleanTotalCents = Math.max(0, Math.round(totalCents));
  if (cleanTotalCents === 0 || items.length === 0) {
    return allocated;
  }

  const positiveItems = items.filter((item) => item.weight > 0);
  const totalWeight = positiveItems.reduce((acc, item) => acc + item.weight, 0);
  if (totalWeight <= 0) {
    return allocated;
  }

  const work = positiveItems.map((item) => {
    const exact = (cleanTotalCents * item.weight) / totalWeight;
    const floored = Math.floor(exact);
    const remainder = exact - floored;
    return {
      id: item.id,
      weight: item.weight,
      cents: floored,
      remainder,
    };
  });

  const sumFloored = work.reduce((acc, w) => acc + w.cents, 0);
  let leftover = cleanTotalCents - sumFloored;

  work.sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) {
      return b.remainder - a.remainder;
    }
    if (b.weight !== a.weight) {
      return b.weight - a.weight;
    }
    return a.id.localeCompare(b.id);
  });

  for (let i = 0; i < work.length && leftover > 0; i += 1) {
    work[i].cents += 1;
    leftover -= 1;
  }

  work.forEach((w) => allocated.set(w.id, w.cents));
  return allocated;
}

/**
 * Calculates individual fee shares when a session ends, factoring in:
 * - Present players (100% court weight + 100% shuttlecock share)
 * - No-Show players (club.noShowFeePercent% court weight, 0% shuttlecock share)
 * - Late Tap-Out players (rsvp.penaltyPercentApplied% court weight, 0% shuttlecock share)
 * - Optional Club Owner exclusion (`excludeOwnerFromBilling`): when enabled, the club owner is excluded from fee calculations ($0 share, 0 weight).
 * Uses the largest-remainder method in integer cents so allocated shares sum to the exact total.
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

  const weights = activeRsvps.map((r) => {
    const guestCount = getRsvpGuestCount(r);
    const isExcludedOwner = Boolean(excludedOwnerId && r.playerId === excludedOwnerId);
    // If owner is excluded from billing, their own 1 spot is free, but any +1 guest they bring is still 1 billable spot
    const billablePartySize = isExcludedOwner ? guestCount : 1 + guestCount;

    let courtWeight = 0;
    let shuttleWeight = 0;
    let pct = 0;
    if (billablePartySize > 0) {
      if (r.status === 'going') {
        if (r.attendanceOutcome === 'present') {
          courtWeight = 1.0 * billablePartySize;
          shuttleWeight = billablePartySize;
          pct = 100;
        } else if (r.attendanceOutcome === 'no_show') {
          pct = noShowFeePercent;
          courtWeight = (pct / 100) * billablePartySize;
        }
      } else if (r.status === 'late_out') {
        pct = r.penaltyPercentApplied;
        courtWeight = (pct / 100) * billablePartySize;
      }
    }
    return { rsvp: r, courtWeight, shuttleWeight, pct };
  });

  const courtFeeCents = Math.max(0, Math.round((Number(courtFee) || 0) * 100));
  const shuttleFeeCents = Math.max(0, Math.round((Number(shuttleFee) || 0) * 100));

  const courtAllocations = allocateLargestRemainderCents(
    courtFeeCents,
    weights.map((w) => ({ id: w.rsvp.id, weight: w.courtWeight }))
  );
  const shuttleAllocations = allocateLargestRemainderCents(
    shuttleFeeCents,
    weights.map((w) => ({ id: w.rsvp.id, weight: w.shuttleWeight }))
  );

  sessionRsvps.forEach((r) => {
    const found = weights.find((w) => w.rsvp.id === r.id);
    if (!found || found.courtWeight <= 0) {
      result.set(r.id, { feeShare: 0, penaltyPercentApplied: 0 });
      return;
    }
    const courtCents = courtAllocations.get(r.id) ?? 0;
    const shuttleCents = shuttleAllocations.get(r.id) ?? 0;
    const totalShare = Number(((courtCents + shuttleCents) / 100).toFixed(2));
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

export function validateBadmintonMatchScores(
  scoreTeamA: number,
  scoreTeamB: number,
  targetPoints: number = 21
): string | null {
  const a = Number(scoreTeamA);
  const b = Number(scoreTeamB);
  const target = Math.max(11, Math.min(100, Math.round(Number(targetPoints) || 21)));
  const maxPts = Math.min(500, target + 9);

  if (
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    a < 0 ||
    b < 0 ||
    a > 500 ||
    b > 500
  ) {
    return 'Scores must be whole numbers between 0 and 500.';
  }
  if (a === b) {
    return 'Badminton games cannot end in a tie.';
  }

  const winner = Math.max(a, b);
  const loser = Math.min(a, b);

  if (winner < target) {
    return `Winning score must reach at least ${target} points.`;
  }
  if (winner > maxPts) {
    return `Winning score cannot exceed the cap of ${maxPts} points (for a ${target}-point game).`;
  }
  if (winner === target && winner - loser < 2) {
    return `At ${target}-${loser}, a team must win by 2 points (e.g. ${target + 1}-${target - 1}).`;
  }
  if (winner > target && winner < maxPts && winner - loser !== 2) {
    return `Deuce games ending between ${target + 1} and ${maxPts - 1} must be won by exactly 2 points (got ${winner}-${loser}).`;
  }
  if (winner === maxPts && winner - loser !== 1 && winner - loser !== 2) {
    return `Cap games at ${maxPts} points must end ${maxPts}-${maxPts - 2} or ${maxPts}-${maxPts - 1} (got ${winner}-${loser}).`;
  }

  return null;
}

export function getMatchTimestampMs(match: BadmintonMatch): number {
  const rawCreatedAt = (match as BadmintonMatch & { createdAt?: unknown }).createdAt;
  if (rawCreatedAt && typeof rawCreatedAt === 'object') {
    const maybeTs = rawCreatedAt as { toMillis?: () => number; seconds?: number };
    if (typeof maybeTs.toMillis === 'function') {
      const ms = maybeTs.toMillis();
      if (Number.isFinite(ms)) return ms;
    }
    if (typeof maybeTs.seconds === 'number' && Number.isFinite(maybeTs.seconds)) {
      return maybeTs.seconds * 1000;
    }
  }
  if (typeof rawCreatedAt === 'number' && Number.isFinite(rawCreatedAt)) {
    return rawCreatedAt;
  }
  if (typeof rawCreatedAt === 'string') {
    const parsed = Date.parse(rawCreatedAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const idMatch = (match.id || '').match(/(\d+)/);
  if (idMatch) {
    return Number(idMatch[1]) || 0;
  }
  return 0;
}

/**
 * Returns matches sorted chronologically (oldest -> newest) by session start time (when available),
 * then createdAt / match ID timestamp, then match ID so streak/recent-form calculations are
 * independent of Firestore query or array insertion order.
 */
export function sortMatchesChronologically(
  matches: BadmintonMatch[],
  sessions?: Session[]
): BadmintonMatch[] {
  const sessionStartById = new Map<string, number>();
  if (sessions) {
    for (const s of sessions) {
      const ms = getSessionStartTimestampMs(s);
      if (ms !== null) {
        sessionStartById.set(s.id, ms);
      }
    }
  }

  return [...matches].sort((a, b) => {
    const sA = sessionStartById.get(a.sessionId);
    const sB = sessionStartById.get(b.sessionId);
    if (sA !== undefined && sB !== undefined && sA !== sB) {
      return sA - sB;
    }
    const tA = getMatchTimestampMs(a);
    const tB = getMatchTimestampMs(b);
    if (tA !== tB) return tA - tB;
    return (a.id || '').localeCompare(b.id || '');
  });
}

/**
 * Returns matches sorted newest -> oldest for match history displays.
 */
export function sortMatchesNewestFirst(
  matches: BadmintonMatch[],
  sessions?: Session[]
): BadmintonMatch[] {
  return sortMatchesChronologically(matches, sessions).reverse();
}

export function computePlayerLeaderboardAndTiers(
  players: Player[],
  matches: BadmintonMatch[],
  sessions?: Session[]
): RankedPlayer[] {
  const recentFormMap = new Map<string, ('W' | 'L')[]>();
  players.forEach((p) => recentFormMap.set(p.id, []));

  // Tally actual recorded matches per player (both singles and doubles) in chronological order
  const orderedMatches = sortMatchesChronologically(matches, sessions);
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

  orderedMatches.forEach((m) => {
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
    const rawAvgPointDiff =
      games > 0 ? (pointsScored - pointsConceded) / games : 0;
    const avgPointDiff = Math.max(-30, Math.min(30, rawAvgPointDiff));
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
      avgPointDiff: rawAvgPointDiff,
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

export function makeClubWalletDocId(clubId: string, playerId: string): string {
  return `wallet_${clubId}_${playerId}`;
}

export function parseClubWalletKey(
  compositeKey: string
): { clubId: string; playerId: string } | null {
  const parts = compositeKey.split('::');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { clubId: parts[0], playerId: parts[1] };
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
  if (!player || !clubId || clubId === 'all' || !walletsMap) {
    return emptyWallet;
  }

  const compositeKey = makeClubWalletKey(clubId, player.id);
  const w = walletsMap[compositeKey];
  if (!w) {
    return emptyWallet;
  }
  return {
    creditBalance: Math.max(0, Number((w.creditBalance || 0).toFixed(2))),
    freeSessionPasses: Math.max(0, Math.floor(Number(w.freeSessionPasses || 0))),
    waiveAllFees: Boolean(w.waiveAllFees),
  };
}

export function loadPlayerWalletsMap(): Record<string, PlayerBenefitWallet> {
  return {};
}

export function savePlayerWalletsMap(
  wallets: Record<string, PlayerBenefitWallet>
): Record<string, PlayerBenefitWallet> {
  return wallets;
}

/** Credit already taken from a wallet by an earlier finalize ("Credit -$12.50"), else 0. */
export function parsePartialCreditApplied(paidMethod: string): number {
  const match = /^Credit -\$(\d+(?:\.\d+)?)$/.exec(paidMethod || '');
  return match ? Number(match[1]) : 0;
}

/** Full credit taken from a wallet by an earlier finalize ("Credit ($12.50)"), else 0. */
export function parseFullCreditApplied(paidMethod: string): number {
  const match = /^Credit \(\$(\d+(?:\.\d+)?)\)$/.exec(paidMethod || '');
  return match ? Number(match[1]) : 0;
}

/**
 * Extracts prior wallet ledger values from an RSVP, falling back to legacy paidMethod
 * strings when reading pre-migration documents.
 */
export function getRsvpWalletLedger(rsvp: SessionRsvp): {
  grossFeeShare: number;
  walletCreditApplied: number;
  walletPassApplied: boolean;
  walletWaiverApplied: boolean;
} {
  const walletCreditApplied =
    typeof rsvp.walletCreditApplied === 'number'
      ? Math.max(0, Number(rsvp.walletCreditApplied.toFixed(2)))
      : rsvp.paidStatus === 'paid'
      ? parseFullCreditApplied(rsvp.paidMethod)
      : parsePartialCreditApplied(rsvp.paidMethod);

  const walletPassApplied =
    typeof rsvp.walletPassApplied === 'boolean'
      ? rsvp.walletPassApplied
      : rsvp.paidStatus === 'paid' && rsvp.paidMethod === 'Free Session Pass';

  const walletWaiverApplied =
    typeof rsvp.walletWaiverApplied === 'boolean'
      ? rsvp.walletWaiverApplied
      : rsvp.paidStatus === 'paid' && rsvp.paidMethod === 'Fee Waived (VIP)';

  const grossFeeShare =
    typeof rsvp.grossFeeShare === 'number'
      ? Math.max(0, Number(rsvp.grossFeeShare.toFixed(2)))
      : Number((Math.max(0, rsvp.feeShare) + walletCreditApplied).toFixed(2));

  return {
    grossFeeShare,
    walletCreditApplied,
    walletPassApplied,
    walletWaiverApplied,
  };
}

/**
 * Pure, idempotent wallet application for a single RSVP row.
 * Step 1: Reverse any previous wallet benefit recorded on `rsvp` back into `wallet`:
 *   wallet.creditBalance += rsvp.walletCreditApplied
 *   wallet.freeSessionPasses += (rsvp.walletPassApplied ? 1 : 0)
 * Step 2: Re-apply `wallet` to the new `grossFeeShare` in priority order:
 *   waiver -> free pass -> credit balance.
 * Also handles cash/PayNow rows: untouched if `grossFeeShare` did not change, or
 * reset to `unpaid` / `'Adjustment Due'` if `grossFeeShare` changed after finalize (P1-3).
 */
export function applyWalletToSingleRsvp(params: {
  rsvp: SessionRsvp;
  grossFeeShare: number;
  penaltyPercentApplied: number;
  wallet: PlayerBenefitWallet;
  finalizeSplit: boolean;
  clubOwnerPlayerId?: string;
  excludeOwnerFromBilling?: boolean;
}): {
  updatedRsvp: SessionRsvp;
  updatedWallet: PlayerBenefitWallet;
} {
  const {
    rsvp,
    grossFeeShare,
    penaltyPercentApplied,
    wallet,
    finalizeSplit,
    clubOwnerPlayerId,
    excludeOwnerFromBilling,
  } = params;

  const gross = Math.max(0, Number((Number(grossFeeShare) || 0).toFixed(2)));
  const prevLedger = getRsvpWalletLedger(rsvp);

  // Step 1: Reverse any previous wallet benefit recorded on this RSVP
  const workingWallet: PlayerBenefitWallet = {
    creditBalance: Math.max(
      0,
      Number(((wallet.creditBalance || 0) + prevLedger.walletCreditApplied).toFixed(2))
    ),
    freeSessionPasses: Math.max(
      0,
      Math.floor(wallet.freeSessionPasses || 0) + (prevLedger.walletPassApplied ? 1 : 0)
    ),
    waiveAllFees: Boolean(wallet.waiveAllFees),
  };

  const wasWalletSettled =
    prevLedger.walletCreditApplied > 0 ||
    prevLedger.walletPassApplied ||
    prevLedger.walletWaiverApplied;
  const wasOwnerSettled =
    rsvp.paidMethod === 'Owner Excluded' || rsvp.paidMethod === 'Club Owner';
  const wasCashPaid =
    rsvp.paidStatus === 'paid' && !wasWalletSettled && !wasOwnerSettled;

  // Club Owner handling: never require redundant self-approval ("Received")
  if (clubOwnerPlayerId && rsvp.playerId === clubOwnerPlayerId) {
    if (excludeOwnerFromBilling) {
      return {
        updatedRsvp: {
          ...rsvp,
          grossFeeShare: gross,
          feeShare: gross,
          penaltyPercentApplied,
          walletCreditApplied: 0,
          walletPassApplied: false,
          walletWaiverApplied: false,
          paidStatus: finalizeSplit ? ('paid' as const) : rsvp.paidStatus,
          paidMethod: finalizeSplit ? 'Owner Excluded' : rsvp.paidMethod,
        },
        updatedWallet: workingWallet,
      };
    }
    if (finalizeSplit && gross > 0) {
      return {
        updatedRsvp: {
          ...rsvp,
          grossFeeShare: gross,
          feeShare: gross,
          penaltyPercentApplied,
          walletCreditApplied: 0,
          walletPassApplied: false,
          walletWaiverApplied: false,
          paidStatus: 'paid' as const,
          paidMethod: 'Club Owner',
        },
        updatedWallet: workingWallet,
      };
    }
  }

  // If not finalizing or new gross share is 0, refund any prior wallet benefit and reset to unpaid
  if (!finalizeSplit || gross <= 0) {
    return {
      updatedRsvp: {
        ...rsvp,
        grossFeeShare: gross,
        feeShare: gross,
        penaltyPercentApplied,
        walletCreditApplied: 0,
        walletPassApplied: false,
        walletWaiverApplied: false,
        paidStatus: 'unpaid',
        paidMethod: 'pending',
      },
      updatedWallet: workingWallet,
    };
  }

  // Cash-paid row handling (P1-1e #11 & #12, P1-3)
  if (wasCashPaid) {
    const shareUnchanged = Math.abs(gross - prevLedger.grossFeeShare) < 0.005;
    if (shareUnchanged) {
      return {
        updatedRsvp: {
          ...rsvp,
          grossFeeShare: gross,
          feeShare: gross,
          penaltyPercentApplied,
          walletCreditApplied: 0,
          walletPassApplied: false,
          walletWaiverApplied: false,
          paidStatus: 'paid',
          paidMethod: rsvp.paidMethod,
        },
        updatedWallet: workingWallet,
      };
    }
    // Share changed after cash payment: mark Adjustment Due so organizer knows a top-up or refund is owed
    return {
      updatedRsvp: {
        ...rsvp,
        grossFeeShare: gross,
        feeShare: gross,
        penaltyPercentApplied,
        walletCreditApplied: 0,
        walletPassApplied: false,
        walletWaiverApplied: false,
        paidStatus: 'unpaid',
        paidMethod: 'Adjustment Due',
      },
      updatedWallet: workingWallet,
    };
  }

  // Step 2: Re-apply wallet benefits in priority order: Waiver -> Free Pass -> Credit
  if (workingWallet.waiveAllFees) {
    return {
      updatedRsvp: {
        ...rsvp,
        grossFeeShare: gross,
        feeShare: 0,
        penaltyPercentApplied,
        walletCreditApplied: 0,
        walletPassApplied: false,
        walletWaiverApplied: true,
        paidStatus: 'paid',
        paidMethod: 'Fee Waived (VIP)',
      },
      updatedWallet: workingWallet,
    };
  }

  if (workingWallet.freeSessionPasses > 0) {
    workingWallet.freeSessionPasses = Math.max(0, workingWallet.freeSessionPasses - 1);
    return {
      updatedRsvp: {
        ...rsvp,
        grossFeeShare: gross,
        feeShare: 0,
        penaltyPercentApplied,
        walletCreditApplied: 0,
        walletPassApplied: true,
        walletWaiverApplied: false,
        paidStatus: 'paid',
        paidMethod: 'Free Session Pass',
      },
      updatedWallet: workingWallet,
    };
  }

  if (workingWallet.creditBalance > 0) {
    if (workingWallet.creditBalance >= gross) {
      workingWallet.creditBalance = Number(
        (workingWallet.creditBalance - gross).toFixed(2)
      );
      return {
        updatedRsvp: {
          ...rsvp,
          grossFeeShare: gross,
          feeShare: 0,
          penaltyPercentApplied,
          walletCreditApplied: gross,
          walletPassApplied: false,
          walletWaiverApplied: false,
          paidStatus: 'paid',
          paidMethod: `Credit ($${gross.toFixed(2)})`,
        },
        updatedWallet: workingWallet,
      };
    }

    const applied = Number(workingWallet.creditBalance.toFixed(2));
    const remaining = Number((gross - applied).toFixed(2));
    workingWallet.creditBalance = 0;
    return {
      updatedRsvp: {
        ...rsvp,
        grossFeeShare: gross,
        feeShare: remaining,
        penaltyPercentApplied,
        walletCreditApplied: applied,
        walletPassApplied: false,
        walletWaiverApplied: false,
        paidStatus: 'unpaid',
        paidMethod: `Credit -$${applied.toFixed(2)}`,
      },
      updatedWallet: workingWallet,
    };
  }

  return {
    updatedRsvp: {
      ...rsvp,
      grossFeeShare: gross,
      feeShare: gross,
      penaltyPercentApplied,
      walletCreditApplied: 0,
      walletPassApplied: false,
      walletWaiverApplied: false,
      paidStatus: 'unpaid',
      paidMethod: 'pending',
    },
    updatedWallet: workingWallet,
  };
}

/**
 * Recalculates cumulative match stats and ratingScore for a list of players (or a single player)
 * from a given list of matches in chronological order.
 */
export function recalculatePlayerStatsFromMatches(
  players: Player[],
  remainingMatches: BadmintonMatch[],
  sessions?: Session[]
): Player[] {
  const ordered = sortMatchesChronologically(remainingMatches, sessions);
  return players.map((player) => {
    let singlesWins = 0;
    let singlesLosses = 0;
    let doublesWins = 0;
    let doublesLosses = 0;
    let pointsScored = 0;
    let pointsConceded = 0;

    for (const m of ordered) {
      const side = getPlayerSideInMatch(m, player.id);
      if (!side) continue;
      const won = m.winnerSide === side;
      const scored = side === 'A' ? m.scoreTeamA : m.scoreTeamB;
      const conceded = side === 'A' ? m.scoreTeamB : m.scoreTeamA;
      pointsScored += scored;
      pointsConceded += conceded;
      if (m.matchFormat === 'doubles') {
        if (won) doublesWins += 1;
        else doublesLosses += 1;
      } else {
        if (won) singlesWins += 1;
        else singlesLosses += 1;
      }
    }

    const wins = singlesWins + doublesWins;
    const losses = singlesLosses + doublesLosses;
    const gamesPlayed = wins + losses;
    const winRate = gamesPlayed > 0 ? (wins / gamesPlayed) * 100 : 0;
    const rawAvgPointDiff =
      gamesPlayed > 0 ? (pointsScored - pointsConceded) / gamesPlayed : 0;
    const avgPointDiff = Math.max(-30, Math.min(30, rawAvgPointDiff));
    const baseRating = 1200;
    const calculatedRating =
      gamesPlayed > 0
        ? Math.round(
            1050 + winRate * 3.8 + avgPointDiff * 14 + Math.min(gamesPlayed, 25) * 4
          )
        : baseRating;
    const ratingScore =
      gamesPlayed > 0
        ? Math.max(900, Math.round((baseRating + calculatedRating) / 2))
        : baseRating;

    return {
      ...player,
      wins,
      losses,
      gamesPlayed,
      pointsScored,
      pointsConceded,
      singlesWins,
      singlesLosses,
      doublesWins,
      doublesLosses,
      ratingScore,
    };
  });
}

/**
 * Applies each player's active Club Wallet Benefits (Waive All Fees -> Free Session Passes -> Credit Balance)
 * scoped to the session's clubId when a session's fee split is finalized or updated.
 * Reverses any previously applied wallet benefits on each RSVP before re-applying so re-finalizing or
 * recalculating a session never double-deducts or leaks credits/passes.
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
    const clubWalletKey = makeClubWalletKey(r.clubId, r.playerId);
    const existingWallet = nextWallets[clubWalletKey] || {
      creditBalance: 0,
      freeSessionPasses: 0,
      waiveAllFees: false,
    };

    const { updatedRsvp, updatedWallet } = applyWalletToSingleRsvp({
      rsvp: r,
      grossFeeShare: calc.feeShare,
      penaltyPercentApplied: calc.penaltyPercentApplied,
      wallet: existingWallet,
      finalizeSplit,
      clubOwnerPlayerId,
      excludeOwnerFromBilling,
    });

    if (
      nextWallets[clubWalletKey] ||
      updatedWallet.creditBalance !== 0 ||
      updatedWallet.freeSessionPasses !== 0 ||
      updatedWallet.waiveAllFees
    ) {
      nextWallets[clubWalletKey] = updatedWallet;
    }

    return updatedRsvp;
  });

  return {
    updatedSessionRsvps,
    updatedWalletsMap: nextWallets,
  };
}

/**
 * Immediately applies a player's newly updated club wallet (Waiver, Free Session Passes, or Credit Balance)
 * against any existing finalized RSVPs in that specific club (oldest session first) using idempotent
 * reversal + re-application so top-ups after partial credit or revoking a VIP waiver settle accurately.
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
  let workingWallet: PlayerBenefitWallet = {
    creditBalance: Math.max(0, Number((wallet.creditBalance || 0).toFixed(2))),
    freeSessionPasses: Math.max(0, Math.floor(wallet.freeSessionPasses || 0)),
    waiveAllFees: Boolean(wallet.waiveAllFees),
  };

  const sessionMap = new Map<string, Session>();
  sessions.forEach((s) => sessionMap.set(s.id, s));

  // Find all finalized RSVPs for this player in this club that are unpaid OR were settled by a
  // VIP waiver that has now been revoked, sorted oldest session first.
  const candidateRsvps = rsvps
    .filter((r) => {
      if (r.playerId !== playerId || (clubId && r.clubId !== clubId)) {
        return false;
      }
      const sess = sessionMap.get(r.sessionId);
      if (
        !sess ||
        sess.bookingStatus !== 'completed' ||
        !sess.feeSplitFinalized ||
        (clubId && sess.clubId !== clubId)
      ) {
        return false;
      }
      const ledger = getRsvpWalletLedger(r);
      const isUnpaidWithDebt = r.paidStatus !== 'paid' && r.feeShare > 0;
      const isRevokedWaiver =
        ledger.walletWaiverApplied && !workingWallet.waiveAllFees && ledger.grossFeeShare > 0;
      return isUnpaidWithDebt || isRevokedWaiver;
    })
    .sort((a, b) => {
      const sA = sessionMap.get(a.sessionId)?.sessionDate || '';
      const sB = sessionMap.get(b.sessionId)?.sessionDate || '';
      return sA.localeCompare(sB);
    });

  const modifiedMap = new Map<string, SessionRsvp>();

  candidateRsvps.forEach((r) => {
    const ledger = getRsvpWalletLedger(r);
    const { updatedRsvp, updatedWallet } = applyWalletToSingleRsvp({
      rsvp: r,
      grossFeeShare: ledger.grossFeeShare,
      penaltyPercentApplied: r.penaltyPercentApplied,
      wallet: workingWallet,
      finalizeSplit: true,
    });
    workingWallet = updatedWallet;
    if (
      updatedRsvp.feeShare !== r.feeShare ||
      updatedRsvp.paidStatus !== r.paidStatus ||
      updatedRsvp.paidMethod !== r.paidMethod ||
      updatedRsvp.grossFeeShare !== r.grossFeeShare ||
      updatedRsvp.walletCreditApplied !== r.walletCreditApplied ||
      updatedRsvp.walletPassApplied !== r.walletPassApplied ||
      updatedRsvp.walletWaiverApplied !== r.walletWaiverApplied
    ) {
      modifiedMap.set(r.id, updatedRsvp);
    }
  });

  const updatedRsvps = rsvps.map((r) => modifiedMap.get(r.id) || r);

  return {
    updatedRsvps,
    remainingWallet: workingWallet,
    modifiedRsvps: Array.from(modifiedMap.values()),
  };
}

export function restoreSessionRsvpsAndWalletsForReopen(params: {
  sessionRsvps: SessionRsvp[];
  walletsMap: Record<string, PlayerBenefitWallet>;
}): {
  restoredSessionRsvps: SessionRsvp[];
  restoredWalletsMap: Record<string, PlayerBenefitWallet>;
  changedWalletKeys: string[];
} {
  const { sessionRsvps, walletsMap } = params;
  const nextWallets: Record<string, PlayerBenefitWallet> = { ...walletsMap };
  const changedKeys = new Set<string>();

  const restoredSessionRsvps = sessionRsvps.map((r) => {
    const clubWalletKey = makeClubWalletKey(r.clubId, r.playerId);
    const existingWallet = nextWallets[clubWalletKey] || {
      creditBalance: 0,
      freeSessionPasses: 0,
      waiveAllFees: false,
    };

    const { updatedRsvp, updatedWallet } = applyWalletToSingleRsvp({
      rsvp: r,
      grossFeeShare: 0,
      penaltyPercentApplied: r.penaltyPercentApplied,
      wallet: existingWallet,
      finalizeSplit: false,
    });

    if (
      updatedWallet.creditBalance !== existingWallet.creditBalance ||
      updatedWallet.freeSessionPasses !== existingWallet.freeSessionPasses
    ) {
      nextWallets[clubWalletKey] = updatedWallet;
      changedKeys.add(clubWalletKey);
    }

    return updatedRsvp;
  });

  return {
    restoredSessionRsvps,
    restoredWalletsMap: nextWallets,
    changedWalletKeys: Array.from(changedKeys),
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
