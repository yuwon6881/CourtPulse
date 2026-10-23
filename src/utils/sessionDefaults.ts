import type { Session } from '../types';
import {
  computeSessionDurationHours,
  CourtRateEstimate,
  deriveHistoricalCourtRate,
  estimateCourtFee,
  plannedCourtCount,
} from './courtAdvice';

// Pre-fills a new session from the club's own history so organizers only type what changed.

export interface SessionHistoryDefaults {
  title: string;
  venue: string;
  startTime: string;
  endTime: string;
  maxPlayers: number;
  shuttleUnitCost: number;
  /** Next date after today on the weekday the club last played. */
  sessionDate: string;
  /** Number of club sessions the defaults were drawn from. */
  sampleSize: number;
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Next calendar date on `weekday` (0 = Sunday); today counts when `includeToday` is set. */
function getZonedDateParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const y = parseInt(get('year'), 10);
  const m = parseInt(get('month'), 10);
  const d = parseInt(get('day'), 10);
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[get('weekday')] ?? new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { year: y, month: m, day: d, weekday };
}

/** Next calendar date on `weekday` (0 = Sunday); today counts when `includeToday` is set. */
export function nextDateForWeekday(
  weekday: number,
  today: Date,
  includeToday = false,
  timeZone?: string
): string {
  if (timeZone) {
    const { year, month, day, weekday: currentWeekday } = getZonedDateParts(today, timeZone);
    let delta = (weekday - currentWeekday + 7) % 7;
    if (delta === 0 && !includeToday) delta = 7;
    const target = new Date(Date.UTC(year, month - 1, day + delta, 12));
    const resY = target.getUTCFullYear();
    const resM = String(target.getUTCMonth() + 1).padStart(2, '0');
    const resD = String(target.getUTCDate()).padStart(2, '0');
    return `${resY}-${resM}-${resD}`;
  }

  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  let delta = (weekday - base.getDay() + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  base.setDate(base.getDate() + delta);
  return toIsoDate(base);
}

function weekdayOf(isoDate: string): number | null {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12);
  return Number.isNaN(d.getTime()) ? null : d.getDay();
}

export function buildSessionDefaultsFromHistory(
  sessions: Session[],
  clubId: string,
  today: Date = new Date(),
  timeZone?: string
): SessionHistoryDefaults | null {
  const clubSessions = sessions
    .filter((s) => s.clubId === clubId)
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  const latest = clubSessions[0];
  if (!latest) return null;

  const weekday = weekdayOf(latest.sessionDate);
  const lastUnitCost = clubSessions.find((s) => s.shuttleUnitCost > 0)?.shuttleUnitCost;

  let sessionDate: string;
  if (timeZone) {
    const { year, month, day } = getZonedDateParts(today, timeZone);
    const todayIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (latest.sessionDate > todayIso) {
      const m = latest.sessionDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m && weekday !== null) {
        const ly = parseInt(m[1], 10);
        const lm = parseInt(m[2], 10);
        const ld = parseInt(m[3], 10);
        const target = new Date(Date.UTC(ly, lm - 1, ld + 7, 12));
        const resY = target.getUTCFullYear();
        const resM = String(target.getUTCMonth() + 1).padStart(2, '0');
        const resD = String(target.getUTCDate()).padStart(2, '0');
        sessionDate = `${resY}-${resM}-${resD}`;
      } else {
        sessionDate = nextDateForWeekday(weekday ?? 0, today, false, timeZone);
      }
    } else {
      if (weekday === null) {
        const target = new Date(Date.UTC(year, month - 1, day + 1, 12));
        const resY = target.getUTCFullYear();
        const resM = String(target.getUTCMonth() + 1).padStart(2, '0');
        const resD = String(target.getUTCDate()).padStart(2, '0');
        sessionDate = `${resY}-${resM}-${resD}`;
      } else {
        sessionDate = nextDateForWeekday(weekday, today, false, timeZone);
      }
    }
  } else {
    // Start after the latest scheduled session so the default never duplicates it.
    const latestDay = new Date(`${latest.sessionDate}T12:00:00`);
    const from =
      !Number.isNaN(latestDay.getTime()) && latestDay > today ? latestDay : today;
    sessionDate =
      weekday === null
        ? toIsoDate(new Date(today.getTime() + 86400000))
        : nextDateForWeekday(weekday, from);
  }

  return {
    title: latest.title,
    venue: latest.venue,
    startTime: latest.startTime,
    endTime: latest.endTime,
    maxPlayers: latest.maxPlayers,
    shuttleUnitCost: lastUnitCost ?? 3,
    sessionDate,
    sampleSize: clubSessions.length,
  };
}

export interface CourtFeeSuggestion {
  courtFee: number;
  rate: CourtRateEstimate;
  courts: number;
  hours: number;
}

/**
 * Court fee for a draft session shape from the club's past rates, or null when the club
 * has no priced history yet.
 */
export function suggestCourtFeeFromHistory(
  history: Session[],
  draft: Pick<
    Session,
    'clubId' | 'venue' | 'courtNumbers' | 'maxPlayers' | 'startTime' | 'endTime'
  >
): CourtFeeSuggestion | null {
  const rate = deriveHistoricalCourtRate(history, draft);
  if (!rate) return null;
  const { courts } = plannedCourtCount(draft);
  const hours = computeSessionDurationHours(draft.startTime, draft.endTime);
  const exact = estimateCourtFee(rate, courts, hours);
  // A history-based figure is an estimate, so whole dollars read more honestly than cents.
  return exact === null ? null : { courtFee: Math.round(exact), rate, courts, hours };
}

/** How many finalized sessions the shuttle estimate averages over. */
export const SHUTTLE_ESTIMATE_SAMPLE_SIZE = 3;

/**
 * Starting guess for "shuttles used" on a session whose count the organizer has not entered yet:
 * the rounded average of the club's most recent finalized sessions that used shuttles. A club
 * with no such history gets 0, so a first session never starts with an invented fee. The
 * organizer's own entry always replaces this.
 */
export function estimateShuttlesFromHistory(
  history: Session[],
  clubId: string,
  excludeSessionId?: string
): number {
  const recent = history
    .filter(
      (s) =>
        s.clubId === clubId &&
        s.id !== excludeSessionId &&
        s.feeSplitFinalized &&
        s.shuttlesUsed > 0
    )
    .sort((a, b) =>
      `${b.sessionDate} ${b.startTime}`.localeCompare(`${a.sessionDate} ${a.startTime}`)
    )
    .slice(0, SHUTTLE_ESTIMATE_SAMPLE_SIZE);
  if (recent.length === 0) return 0;
  const total = recent.reduce((sum, s) => sum + s.shuttlesUsed, 0);
  return Math.round(total / recent.length);
}
