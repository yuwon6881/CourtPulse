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
export function nextDateForWeekday(
  weekday: number,
  today: Date,
  includeToday = false
): string {
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
  today: Date = new Date()
): SessionHistoryDefaults | null {
  const clubSessions = sessions
    .filter((s) => s.clubId === clubId)
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  const latest = clubSessions[0];
  if (!latest) return null;

  const weekday = weekdayOf(latest.sessionDate);
  // Start after the latest scheduled session so the default never duplicates it.
  const latestDay = new Date(`${latest.sessionDate}T12:00:00`);
  const from =
    !Number.isNaN(latestDay.getTime()) && latestDay > today ? latestDay : today;
  const lastUnitCost = clubSessions.find((s) => s.shuttleUnitCost > 0)?.shuttleUnitCost;

  return {
    title: latest.title,
    venue: latest.venue,
    startTime: latest.startTime,
    endTime: latest.endTime,
    maxPlayers: latest.maxPlayers,
    shuttleUnitCost: lastUnitCost ?? 3,
    sessionDate:
      weekday === null
        ? toIsoDate(new Date(today.getTime() + 86400000))
        : nextDateForWeekday(weekday, from),
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
