import {
  CACHED_PLAYER_STORAGE_KEY,
  CLUB_BILLING_RULES_STORAGE_KEY,
  CLUB_JOIN_REQUESTS_STORAGE_KEY,
  CLUB_OWNER_MAP_STORAGE_KEY,
  CLUB_PAYMENT_DETAILS_STORAGE_KEY,
  LOCAL_STATE_STORAGE_KEY,
  PLAYER_WALLETS_STORAGE_KEY,
  RSVP_GUESTS_STORAGE_KEY,
} from './badmintonLogic.ts';
import { EQUIPMENT_STORAGE_KEY } from './equipmentStorage.ts';

export const DEV_SESSION_STORAGE_KEY = 'courtpulse_dev_session_v1';
export const ACTIVITY_EVENTS_STORAGE_KEY = 'courtpulse_club_activity_events_v1';
export const CARE_SCHEDULE_PREF_KEY = 'courtpulse_care_schedule_pref_v1';

export const NOTIF_FEED_STORAGE_PREFIX = 'courtpulse_notif_feed_v2_';
export const RSVP_SNAPSHOT_STORAGE_PREFIX = 'courtpulse_rsvp_snapshot_v2_';
export const NOTIFIED_KEYS_STORAGE_PREFIX = 'courtpulse_notified_keys_v2_';
export const ALLOWED_STORAGE_PREFIX = 'courtpulse_browser_notif_allowed_v2_';
export const PROMPT_SNOOZE_STORAGE_PREFIX = 'courtpulse_browser_notif_snoozed_v1_';

/**
 * Prefixes for per-player notification keys that must be cleared on sign out / account switch.
 * The "allowed" flag, the prompt snooze and the dedup keys are deliberately NOT listed: they are
 * per-player preferences holding no club data, and wiping them made the "Enable notifications"
 * prompt reappear (and old alerts replay) on every login.
 */
export const NOTIFICATION_STORAGE_KEY_PREFIXES: readonly string[] = [
  NOTIF_FEED_STORAGE_PREFIX,
  RSVP_SNAPSHOT_STORAGE_PREFIX,
  // Also clean up legacy v1 keys
  'courtpulse_notif_feed_v1_',
  'courtpulse_rsvp_snapshot_v1_',
  'courtpulse_notified_keys_v1_',
];

/** Exact keys that hold club/account data and must not survive a sign-out or account switch. */
export const COURTPULSE_DATA_STORAGE_KEYS: readonly string[] = [
  LOCAL_STATE_STORAGE_KEY,
  DEV_SESSION_STORAGE_KEY,
  CLUB_PAYMENT_DETAILS_STORAGE_KEY,
  CLUB_BILLING_RULES_STORAGE_KEY,
  CLUB_JOIN_REQUESTS_STORAGE_KEY,
  CLUB_OWNER_MAP_STORAGE_KEY,
  RSVP_GUESTS_STORAGE_KEY,
  PLAYER_WALLETS_STORAGE_KEY,
  CACHED_PLAYER_STORAGE_KEY,
  ACTIVITY_EVENTS_STORAGE_KEY,
  CARE_SCHEDULE_PREF_KEY,
];

/** Key prefix for per-account gear lockers (`court_gear_locker_v3_<uid|local>`). */
export const GEAR_LOCKER_KEY_PREFIX = `${EQUIPMENT_STORAGE_KEY}_`;

/** Which stored keys `clearAllCourtPulseLocalData` would remove, given the keys in a storage. */
export function selectCourtPulseKeys(
  allKeys: readonly string[],
  currentUid?: string
): string[] {
  const matchesGearLocker = (k: string) => {
    if (!k.startsWith(GEAR_LOCKER_KEY_PREFIX)) return false;
    if (currentUid !== undefined) {
      const cleanUid = currentUid.trim();
      return (
        k === `${GEAR_LOCKER_KEY_PREFIX}local` ||
        (cleanUid.length > 0 && k === `${GEAR_LOCKER_KEY_PREFIX}${cleanUid}`)
      );
    }
    return true;
  };

  const matchesPrefix = (k: string) =>
    NOTIFICATION_STORAGE_KEY_PREFIXES.some((prefix) => k.startsWith(prefix));

  return allKeys.filter(
    (k) =>
      COURTPULSE_DATA_STORAGE_KEYS.includes(k) ||
      matchesPrefix(k) ||
      matchesGearLocker(k)
  );
}

/**
 * Removes CourtPulse data keys (demo state, payment details, billing rules, RSVP guest
 * counts, wallets, join requests, dev session, notifications, care schedule preferences
 * and current user's gear locker) from this browser.
 * View-mode preferences are cosmetic and intentionally kept.
 */
export function clearAllCourtPulseLocalData(
  currentUidOrStorage?: string | Storage,
  storageOrUid?: Storage | string
): void {
  let currentUid: string | undefined;
  let target: Storage | undefined;

  if (typeof currentUidOrStorage === 'string') {
    currentUid = currentUidOrStorage;
  } else if (currentUidOrStorage && typeof currentUidOrStorage === 'object') {
    target = currentUidOrStorage;
  }

  if (typeof storageOrUid === 'string') {
    currentUid = storageOrUid;
  } else if (storageOrUid && typeof storageOrUid === 'object') {
    target = storageOrUid;
  }

  if (!target) {
    target =
      typeof window !== 'undefined' ? window.localStorage : undefined;
  }
  if (!target) return;

  try {
    const keys: string[] = [];
    for (let i = 0; i < target.length; i += 1) {
      const key = target.key(i);
      if (key) keys.push(key);
    }
    selectCourtPulseKeys(keys, currentUid).forEach((k) => target!.removeItem(k));
  } catch {
    // Storage can be blocked (private mode); there is nothing to clear in that case.
  }
}

/** Startup hygiene: production builds never use the demo state or dev persona, so drop them. */
export function purgeDevLeftoversOutsideDev(isDev: boolean, storage?: Storage): void {
  if (isDev) return;
  const target =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) return;
  try {
    target.removeItem(LOCAL_STATE_STORAGE_KEY);
    target.removeItem(DEV_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}
