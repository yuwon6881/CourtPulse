import type { BookingStatus, Club, Session } from '../types';
import {
  getClubCurrencyCode,
  getInviteBaseUrl,
  type ParsedSharedInvite,
  type SharedClubTerms,
} from './badmintonLogic.ts';
import { toEpochMs } from './clubTime.ts';

const SHORT_CODE_ALPHABET =
  '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const SHORT_CODE_LENGTH = 7;
const VALID_BOOKING_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'booked',
  'in_play',
  'completed',
]);

export type ShortInviteClubInput = Pick<
  Club,
  | 'name'
  | 'currency'
  | 'freeCancelHours'
  | 'lockCancelHours'
  | 'lateCancelFeePercent'
  | 'noShowFeePercent'
>;

export interface ShortInviteDocFields {
  clubId: string;
  sessionId: string;
  title?: string;
  venue?: string;
  courtNumbers?: string;
  sessionDate?: string;
  startTime?: string;
  endTime?: string;
  bookingStatus?: BookingStatus;
  courtFee?: number;
  maxPlayers?: number;
  organizerName?: string;
  startsAtMs?: number;
  clubName?: string;
  currency?: string;
  freeCancelHours?: number;
  lockCancelHours?: number;
  lateCancelFeePercent?: number;
  noShowFeePercent?: number;
}

function clampString(
  value: string | undefined,
  maxLen: number,
  fallback: string
): string {
  const trimmed = (value || '').trim();
  const resolved = trimmed || fallback;
  return resolved.slice(0, maxLen);
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

export function generateShortInviteCode(length = SHORT_CODE_LENGTH): string {
  const chars: string[] = [];
  const alphabetLen = SHORT_CODE_ALPHABET.length;
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i += 1) {
      chars.push(SHORT_CODE_ALPHABET[bytes[i] % alphabetLen]);
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      chars.push(SHORT_CODE_ALPHABET[Math.floor(Math.random() * alphabetLen)]);
    }
  }
  return chars.join('');
}

export function buildShortInviteUrl(code: string): string {
  return `${getInviteBaseUrl()}?i=${encodeURIComponent(code)}`;
}

export function buildShortInviteDocFields(
  clubId: string,
  session?: Session | null,
  club?: ShortInviteClubInput | null
): ShortInviteDocFields {
  const base: ShortInviteDocFields = {
    clubId: clubId.trim().slice(0, 128),
    sessionId: session ? session.id.trim().slice(0, 128) : '',
  };

  if (session) {
    base.title = clampString(session.title, 120, 'Shared Club Session');
    base.venue = clampString(session.venue, 120, 'Badminton Hall');
    base.courtNumbers = clampString(session.courtNumbers, 60, 'Court 1');
    base.sessionDate = clampString(session.sessionDate, 40, '2026-10-22');
    base.startTime = clampString(session.startTime, 20, '20:00');
    base.endTime = clampString(session.endTime, 20, '22:00');
    base.bookingStatus = VALID_BOOKING_STATUSES.has(session.bookingStatus)
      ? session.bookingStatus
      : 'booked';
    base.courtFee = clampNumber(session.courtFee, 0, 100000, 0);
    base.maxPlayers = clampNumber(session.maxPlayers, 2, 64, 8);
    base.organizerName = clampString(session.organizerName, 80, 'Club Organizer');

    const startsAtMs = toEpochMs(session.startsAt);
    if (startsAtMs !== null && startsAtMs >= 0 && startsAtMs <= 9999999999999) {
      base.startsAtMs = startsAtMs;
    }

    if (club) {
      base.clubName = clampString(club.name, 100, 'Club');
      base.currency = clampString(getClubCurrencyCode(club), 10, 'USD');
      base.freeCancelHours = clampNumber(club.freeCancelHours, 0, 720, 24);
      base.lockCancelHours = clampNumber(club.lockCancelHours, 0, 720, 4);
      base.lateCancelFeePercent = clampNumber(
        club.lateCancelFeePercent,
        0,
        100,
        50
      );
      base.noShowFeePercent = clampNumber(club.noShowFeePercent, 0, 100, 100);
    }
  }

  return base;
}

export function parseShortInviteDoc(
  data: Record<string, unknown>
): ParsedSharedInvite | null {
  const clubId =
    typeof data.clubId === 'string' && data.clubId.trim()
      ? data.clubId.trim()
      : null;
  if (!clubId) return null;

  const sessionId =
    typeof data.sessionId === 'string' && data.sessionId.trim()
      ? data.sessionId.trim()
      : null;

  if (!sessionId) {
    return {
      clubId,
      sessionId: null,
      hydratedSession: null,
      hydratedClubTerms: null,
    };
  }

  const free =
    typeof data.freeCancelHours === 'number' && Number.isFinite(data.freeCancelHours)
      ? data.freeCancelHours
      : null;
  const lock =
    typeof data.lockCancelHours === 'number' && Number.isFinite(data.lockCancelHours)
      ? data.lockCancelHours
      : null;
  const late =
    typeof data.lateCancelFeePercent === 'number' &&
    Number.isFinite(data.lateCancelFeePercent)
      ? data.lateCancelFeePercent
      : null;
  const noShow =
    typeof data.noShowFeePercent === 'number' &&
    Number.isFinite(data.noShowFeePercent)
      ? data.noShowFeePercent
      : null;

  const hydratedClubTerms: SharedClubTerms | null =
    free !== null && lock !== null && late !== null && noShow !== null
      ? {
          name:
            typeof data.clubName === 'string' && data.clubName.trim()
              ? data.clubName.trim().slice(0, 100)
              : undefined,
          currency:
            typeof data.currency === 'string' && data.currency.trim()
              ? data.currency.trim()
              : undefined,
          freeCancelHours: free,
          lockCancelHours: lock,
          lateCancelFeePercent: late,
          noShowFeePercent: noShow,
        }
      : null;

  const title = typeof data.title === 'string' ? data.title : '';
  const sessionDate = typeof data.sessionDate === 'string' ? data.sessionDate : '';
  const venue = typeof data.venue === 'string' ? data.venue : '';
  const startsAtMs =
    typeof data.startsAtMs === 'number' && Number.isFinite(data.startsAtMs)
      ? data.startsAtMs
      : null;
  const startsAt = startsAtMs !== null ? new Date(startsAtMs) : undefined;
  const rawStatus =
    typeof data.bookingStatus === 'string' ? data.bookingStatus : 'booked';
  const bookingStatus: BookingStatus = VALID_BOOKING_STATUSES.has(rawStatus)
    ? (rawStatus as BookingStatus)
    : 'booked';

  const hydratedSession: Session | null =
    title || sessionDate || venue || startsAtMs !== null
      ? {
          id: sessionId,
          clubId,
          title: title || 'Shared Club Session',
          venue: venue || 'Badminton Hall',
          courtNumbers:
            typeof data.courtNumbers === 'string' && data.courtNumbers
              ? data.courtNumbers
              : 'Court 1',
          sessionDate: sessionDate || '2026-10-22',
          startTime:
            typeof data.startTime === 'string' && data.startTime
              ? data.startTime
              : '20:00',
          endTime:
            typeof data.endTime === 'string' && data.endTime
              ? data.endTime
              : '22:00',
          bookingStatus,
          courtFee:
            typeof data.courtFee === 'number' && Number.isFinite(data.courtFee)
              ? data.courtFee
              : 60,
          shuttlesUsed: 0,
          shuttleUnitCost: 3.0,
          shuttleFee: 0,
          maxPlayers:
            typeof data.maxPlayers === 'number' && Number.isFinite(data.maxPlayers)
              ? data.maxPlayers
              : 8,
          organizerName:
            typeof data.organizerName === 'string' && data.organizerName
              ? data.organizerName
              : 'Club Organizer',
          paymentInfo: 'PayNow',
          feeSplitFinalized: false,
          ownerId: 'local_club',
          startsAt,
        }
      : null;

  return { clubId, sessionId, hydratedSession, hydratedClubTerms };
}
