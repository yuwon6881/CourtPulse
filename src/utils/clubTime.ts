/**
 * Club-timezone helpers.
 *
 * A session's start/cancel deadlines belong to the CLUB's timezone, never to the viewer's device
 * zone. Everything here goes through Intl.DateTimeFormat with an explicit `timeZone`, so results are
 * identical whatever the process / browser timezone is (tests run under an odd TZ to prove it).
 */

export const DEFAULT_CLUB_TIMEZONE = 'Asia/Singapore';

/** Zones offered in club settings. Any valid IANA name stored on a club is still honoured. */
export const COMMON_CLUB_TIMEZONES: readonly string[] = [
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Jakarta',
  'Asia/Bangkok',
  'Asia/Hong_Kong',
  'Asia/Manila',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

const validityCache = new Map<string, boolean>();

/** True for a non-empty (<= 64 chars) IANA timezone name this runtime understands. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string') return false;
  const name = tz.trim();
  if (name.length < 1 || name.length > 64) return false;
  const cached = validityCache.get(name);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: name });
    ok = true;
  } catch {
    ok = false;
  }
  validityCache.set(name, ok);
  return ok;
}

/** The club's zone, or the default when missing/unknown. */
export function resolveClubTimeZone(tz: unknown): string {
  return isValidTimeZone(tz) ? tz.trim() : DEFAULT_CLUB_TIMEZONE;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = partsFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(tz, fmt);
  }
  return fmt;
}

/** Wall-clock fields of an instant in `tz`, read as if they were UTC fields. */
function wallClockAsUtcMs(ms: number, tz: string): number {
  const parts = getPartsFormatter(tz).formatToParts(new Date(ms));
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? parseInt(p.value, 10) : 0;
  };
  // Some engines print midnight as hour 24 even with h23; normalise it.
  const hour = get('hour') % 24;
  const utc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  // Date.UTC maps years 0..99 to 1900..1999; irrelevant for session dates but keep it exact.
  return utc;
}

/** Offset (zone wall clock minus UTC) in ms at the instant `ms`; whole seconds. */
export function getTimeZoneOffsetMs(ms: number, tz: string): number {
  const truncated = Math.floor(ms / 1000) * 1000;
  return wallClockAsUtcMs(truncated, tz) - truncated;
}

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Converts a wall-clock date + minutes-since-midnight in `tz` to the UTC instant (epoch ms).
 *
 * - `minutesSinceMidnight` may exceed 1440 (or be 1440 exactly for "24:00"): it rolls into the
 *   following days, the same way the session helpers treat end times past midnight.
 * - DST overlap (fall back; the wall time occurs twice): the EARLIER instant (first occurrence,
 *   still on daylight time) is returned.
 * - DST gap (spring forward; the wall time never occurs): the time is shifted forward by the gap
 *   length, i.e. interpreted with the offset in force BEFORE the transition ("compatible"
 *   disambiguation, same as Temporal and legacy JS Date).
 *
 * Returns null for an invalid zone, a malformed date, a calendar overflow such as 2026-02-31, or a
 * non-integer / non-finite minute count.
 */
export function zonedWallTimeToUtcMs(
  dateIso: string,
  minutesSinceMidnight: number,
  tz: string
): number | null {
  if (!isValidTimeZone(tz)) return null;
  if (typeof dateIso !== 'string') return null;
  if (!Number.isFinite(minutesSinceMidnight) || !Number.isInteger(minutesSinceMidnight)) return null;
  const m = dateIso.trim().match(DATE_ISO);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  const zone = tz.trim();
  // The wall time expressed as if it were UTC.
  const naive = Date.UTC(year, month - 1, day, 0, minutesSinceMidnight, 0, 0);
  if (Number.isNaN(naive)) return null;

  const DAY = 24 * 3600 * 1000;
  // Offsets in force a day before and a day after; a zone changes offset at most once in that span.
  const offsetBefore = getTimeZoneOffsetMs(naive - DAY, zone);
  const offsetAfter = getTimeZoneOffsetMs(naive + DAY, zone);

  const candidates: number[] = [];
  for (const offset of new Set([offsetBefore, offsetAfter])) {
    const candidate = naive - offset;
    if (getTimeZoneOffsetMs(candidate, zone) === offset) candidates.push(candidate);
  }
  if (candidates.length === 0) {
    // Gap: use the pre-transition offset, which lands just after the jump.
    return naive - offsetBefore;
  }
  return Math.min(...candidates);
}

const ABBREVIATIONS: Record<string, string> = {
  'Asia/Singapore': 'SGT',
  'Asia/Kuala_Lumpur': 'MYT',
  'Asia/Jakarta': 'WIB',
  'Asia/Bangkok': 'ICT',
  'Asia/Hong_Kong': 'HKT',
  'Asia/Manila': 'PHT',
  'Asia/Tokyo': 'JST',
  'Asia/Seoul': 'KST',
  'Asia/Kolkata': 'IST',
  'Asia/Dubai': 'GST',
  UTC: 'UTC',
};

function localeHintFor(tz: string): string {
  if (tz.startsWith('America/')) return 'en-US';
  if (tz.startsWith('Europe/')) return 'en-GB';
  if (tz.startsWith('Australia/')) return 'en-AU';
  if (tz === 'Pacific/Auckland') return 'en-NZ';
  return 'en-US';
}

/** Short zone label for display next to a time: "SGT", "EDT", "BST", or "GMT+8" as a fallback. */
export function getTimeZoneShortLabel(tz: string, atMs: number = Date.now()): string {
  const zone = resolveClubTimeZone(tz);
  const known = ABBREVIATIONS[zone];
  if (known) return known;
  try {
    const parts = new Intl.DateTimeFormat(localeHintFor(zone), {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(new Date(atMs));
    return parts.find((p) => p.type === 'timeZoneName')?.value || zone;
  } catch {
    return zone;
  }
}

/** Generic Intl formatting pinned to the club zone (never the device zone). */
export function formatInClubZone(
  ms: number,
  tz: string,
  opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  },
  locale: string = 'en-GB'
): string {
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: resolveClubTimeZone(tz) }).format(
    new Date(ms)
  );
}

/**
 * Deadline label such as "Thu 20 Oct, 8:00 PM SGT". `withZoneLabel` can be turned off where the
 * zone is already stated nearby.
 */
export function formatClubInstant(ms: number, tz: string, withZoneLabel = true): string {
  if (!Number.isFinite(ms)) return '';
  const zone = resolveClubTimeZone(tz);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const period = get('dayPeriod').toUpperCase();
  const text = `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')} ${period}`;
  return withZoneLabel ? `${text} ${getTimeZoneShortLabel(zone, ms)}` : text;
}

/** Epoch ms of a Firestore Timestamp, Date, or number; null when absent or unusable. */
export function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'object') {
    const maybe = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === 'function') {
      const t = maybe.toMillis();
      return Number.isFinite(t) ? t : null;
    }
    if (typeof maybe.seconds === 'number') {
      return maybe.seconds * 1000 + Math.floor((maybe.nanoseconds || 0) / 1e6);
    }
  }
  return null;
}
