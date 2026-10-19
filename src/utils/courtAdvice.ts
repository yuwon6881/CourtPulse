import type { Club, RotationPace, Session, SessionRsvp } from '../types';

// Court-booking advice for proposed sessions. Court cost is modelled as a rate per
// court-hour so a fee typed for one court count or duration scales correctly to
// another, and so past sessions of different shapes can be compared.

const PACE_PLAYERS_PER_COURT: Record<RotationPace, { ideal: number; max: number }> = {
  competitive: { ideal: 4, max: 5 },
  standard: { ideal: 6, max: 6 },
  social: { ideal: 7, max: 8 },
};

const PLAYERS_PER_DOUBLES_COURT = 4;
const MAX_RECOMMENDED_COURTS = 6;
const HISTORY_SAMPLE_LIMIT = 8;
const RATED_STATUSES = new Set(['booked', 'in_play', 'completed']);

export interface CourtRateEstimate {
  perCourtHour: number;
  source: 'session' | 'venue_history' | 'club_history';
  /** Number of sessions the rate was derived from. */
  sampleSize: number;
  /** Court count and hours the session's own fee was read against (source 'session' only). */
  basisCourts: number;
  basisHours: number;
  basisCourtsEstimated: boolean;
}

export interface CourtScenario {
  courts: number;
  totalCost: number | null;
  costPerPlayer: number | null;
  restingPerGame: number;
  fit: 'underfilled' | 'good' | 'busy' | 'crowded';
  isRecommended: boolean;
}

export interface CourtBookingAdvice {
  goingCount: number;
  billableCount: number;
  ownerExcluded: boolean;
  durationHours: number;
  rate: CourtRateEstimate | null;
  costPerCourt: number | null;
  recommendedCourts: number;
  totalCost: number | null;
  costPerPlayer: number | null;
  status: 'need_players' | 'borderline' | 'ready';
  /** Players still needed to run every recommended court as full doubles. */
  playersShort: number;
  scenarios: CourtScenario[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Reads an explicit court count from a court label such as "2 courts", "Court 3 & 4",
 * "Courts 1-3" or "1 court". Returns null when the label does not say (e.g. "TBD").
 */
export function countCourts(courtNumbers: string): number | null {
  const raw = (courtNumbers || '').trim();
  if (!raw) return null;

  const explicit = raw.match(/\b(\d{1,2})\s*courts?\b/i);
  if (explicit) {
    const n = parseInt(explicit[1], 10);
    return n >= 1 && n <= 20 ? n : null;
  }

  const numbers = new Set<number>();
  const rangePattern = /(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})/gi;
  let withoutRanges = raw;
  for (const m of raw.matchAll(rangePattern)) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (b >= a && b - a < 20) {
      for (let i = a; i <= b; i++) numbers.add(i);
      withoutRanges = withoutRanges.replace(m[0], ' ');
    }
  }
  for (const m of withoutRanges.matchAll(/\d{1,2}/g)) {
    numbers.add(parseInt(m[0], 10));
  }
  return numbers.size >= 1 && numbers.size <= 20 ? numbers.size : null;
}

export function formatCourtCount(courts: number): string {
  return `${courts} ${courts === 1 ? 'court' : 'courts'}`;
}

/** Courts needed to host `maxPlayers` at the given rotation pace. */
export function courtsForCapacity(
  maxPlayers: number,
  pace: RotationPace = 'standard'
): number {
  const { max } = PACE_PLAYERS_PER_COURT[pace];
  return Math.max(1, Math.min(MAX_RECOMMENDED_COURTS, Math.ceil(maxPlayers / max)));
}

/** The court count a session's fee covers: its explicit label, else what its capacity needs. */
export function plannedCourtCount(
  session: Pick<Session, 'courtNumbers' | 'maxPlayers'>,
  pace: RotationPace = 'standard'
): { courts: number; estimated: boolean } {
  const explicit = countCourts(session.courtNumbers);
  if (explicit !== null) return { courts: explicit, estimated: false };
  return { courts: courtsForCapacity(session.maxPlayers, pace), estimated: true };
}

export function computeSessionDurationHours(
  startTime: string,
  endTime: string
): number {
  const parseTime = (t: string): number | null => {
    const m = (t || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
  };
  const s = parseTime(startTime);
  const e = parseTime(endTime);
  if (s === null || e === null) return 2;
  const diff = e >= s ? e - s : 24 - s + e;
  return diff > 0 && diff <= 12 ? Number(diff.toFixed(2)) : 2;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const normalizeVenue = (venue: string): string =>
  (venue || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Median court-hour rate from the club's own booked or completed sessions, preferring
 * the same venue. Only sessions with an explicit court count are used, so a guessed
 * court count never feeds back into a rate.
 */
export function deriveHistoricalCourtRate(
  history: Session[],
  target: Pick<Session, 'clubId' | 'venue'> & { id?: string }
): CourtRateEstimate | null {
  const rated = history
    .filter(
      (s) =>
        s.clubId === target.clubId &&
        s.id !== target.id &&
        RATED_STATUSES.has(s.bookingStatus) &&
        s.courtFee > 0
    )
    .map((s) => {
      const courts = countCourts(s.courtNumbers);
      const hours = computeSessionDurationHours(s.startTime, s.endTime);
      return courts
        ? { session: s, rate: s.courtFee / (courts * hours) }
        : null;
    })
    .filter((x): x is { session: Session; rate: number } => x !== null)
    .sort((a, b) => b.session.sessionDate.localeCompare(a.session.sessionDate));

  const venueKey = normalizeVenue(target.venue);
  const sameVenue = venueKey
    ? rated.filter((r) => normalizeVenue(r.session.venue) === venueKey)
    : [];
  const pool = sameVenue.length > 0 ? sameVenue : rated;
  if (pool.length === 0) return null;

  const sample = pool.slice(0, HISTORY_SAMPLE_LIMIT);
  return {
    perCourtHour: round2(median(sample.map((r) => r.rate))),
    source: sameVenue.length > 0 ? 'venue_history' : 'club_history',
    sampleSize: sample.length,
    basisCourts: 0,
    basisHours: 0,
    basisCourtsEstimated: false,
  };
}

/**
 * The session's own fee is the organizer's latest intent, so it wins; history is only
 * consulted when no fee has been entered. Returns null when neither is known.
 */
export function estimateCourtRate(
  session: Session,
  options?: { pace?: RotationPace; history?: Session[] }
): CourtRateEstimate | null {
  const hours = computeSessionDurationHours(session.startTime, session.endTime);
  if (session.courtFee > 0) {
    const planned = plannedCourtCount(session, options?.pace);
    return {
      perCourtHour: session.courtFee / (planned.courts * hours),
      source: 'session',
      sampleSize: 1,
      basisCourts: planned.courts,
      basisHours: hours,
      basisCourtsEstimated: planned.estimated,
    };
  }
  return options?.history
    ? deriveHistoricalCourtRate(options.history, session)
    : null;
}

/** Court fee for a session shape at a known rate, or null when the rate is unknown. */
export function estimateCourtFee(
  rate: CourtRateEstimate | null,
  courts: number,
  hours: number
): number | null {
  return rate ? round2(rate.perCourtHour * courts * hours) : null;
}

export function evaluateCourtBookingAdvice(
  session: Session,
  sessionRsvps: SessionRsvp[],
  club: Club,
  options?: { pace?: RotationPace; history?: Session[] }
): CourtBookingAdvice {
  const pace = options?.pace ?? 'standard';
  const { max: maxPerCourt } = PACE_PLAYERS_PER_COURT[pace];
  const going = sessionRsvps.filter((r) => r.status === 'going');
  const goingCount = going.reduce(
    (sum, r) => sum + 1 + Math.max(0, Math.floor(r.guestCount || 0)),
    0
  );

  const ownerExcluded = Boolean(
    club.excludeOwnerFromBilling &&
      club.clubOwnerPlayerId &&
      going.some((r) => r.playerId === club.clubOwnerPlayerId)
  );
  const billableCount = ownerExcluded ? Math.max(0, goingCount - 1) : goingCount;

  const durationHours = computeSessionDurationHours(session.startTime, session.endTime);
  const rate = estimateCourtRate(session, options);
  const costPerCourt = rate ? round2(rate.perCourtHour * durationHours) : null;

  const costFor = (courts: number) => {
    const total = costPerCourt === null ? null : round2(courts * costPerCourt);
    return {
      total,
      perPlayer: total !== null && billableCount > 0 ? round2(total / billableCount) : null,
    };
  };

  const recommendedCourts =
    goingCount < PLAYERS_PER_DOUBLES_COURT
      ? 1
      : Math.min(MAX_RECOMMENDED_COURTS, Math.ceil(goingCount / maxPerCourt));
  const fullDoublesNeed = recommendedCourts * PLAYERS_PER_DOUBLES_COURT;
  const playersShort = Math.max(0, fullDoublesNeed - goingCount);
  const status: CourtBookingAdvice['status'] =
    goingCount < PLAYERS_PER_DOUBLES_COURT
      ? 'need_players'
      : playersShort > 0
      ? 'borderline'
      : 'ready';

  const scenarioCount = Math.max(3, Math.min(5, recommendedCourts + 1));
  const scenarios: CourtScenario[] = [];
  for (let courts = 1; courts <= scenarioCount; courts++) {
    const onCourt = courts * PLAYERS_PER_DOUBLES_COURT;
    const restingPerGame = Math.max(0, goingCount - onCourt);
    const fit: CourtScenario['fit'] =
      goingCount < onCourt
        ? 'underfilled'
        : goingCount <= courts * maxPerCourt
        ? 'good'
        : goingCount <= courts * (maxPerCourt + 1)
        ? 'busy'
        : 'crowded';
    const cost = costFor(courts);
    scenarios.push({
      courts,
      totalCost: cost.total,
      costPerPlayer: cost.perPlayer,
      restingPerGame,
      fit,
      isRecommended: courts === recommendedCourts,
    });
  }

  const recommendedCost = costFor(recommendedCourts);
  return {
    goingCount,
    billableCount,
    ownerExcluded,
    durationHours,
    rate,
    costPerCourt,
    recommendedCourts,
    totalCost: recommendedCost.total,
    costPerPlayer: recommendedCost.perPlayer,
    status,
    playersShort,
    scenarios,
  };
}

/** Plain-language explanation of where the court rate came from. */
export function describeCourtRate(rate: CourtRateEstimate | null, fee?: number): string {
  if (!rate) return 'Enter a court fee to estimate costs.';
  const hourly = `$${rate.perCourtHour.toFixed(2)} per court-hour`;
  if (rate.source === 'session') {
    const courts = formatCourtCount(rate.basisCourts);
    const courtsNote = rate.basisCourtsEstimated ? ' (estimated from max players)' : '';
    const hours = `${Number(rate.basisHours.toFixed(2))}h`;
    return `${hourly}: $${(fee ?? 0).toFixed(2)} fee ÷ ${courts}${courtsNote} × ${hours}`;
  }
  const scope = rate.source === 'venue_history' ? 'at this venue' : 'in this club';
  return `${hourly}: median of ${rate.sampleSize} past ${
    rate.sampleSize === 1 ? 'session' : 'sessions'
  } ${scope}`;
}
