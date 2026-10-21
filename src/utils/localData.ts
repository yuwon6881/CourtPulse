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
];

/** Key prefix for per-account gear lockers (`court_gear_locker_v3_<uid|local>`). */
export const GEAR_LOCKER_KEY_PREFIX = `${EQUIPMENT_STORAGE_KEY}_`;

/** Which stored keys `clearAllCourtPulseLocalData` would remove, given the keys in a storage. */
export function selectCourtPulseKeys(allKeys: readonly string[]): string[] {
  return allKeys.filter(
    (k) => COURTPULSE_DATA_STORAGE_KEYS.includes(k) || k.startsWith(GEAR_LOCKER_KEY_PREFIX)
  );
}

/**
 * Removes every CourtPulse data key (demo state, payment details, billing rules, RSVP guest
 * counts, wallets, join requests, dev session and every gear locker) from this browser.
 * View-mode preferences are cosmetic and intentionally kept.
 */
export function clearAllCourtPulseLocalData(storage?: Storage): void {
  const target =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < target.length; i += 1) {
      const key = target.key(i);
      if (key) keys.push(key);
    }
    selectCourtPulseKeys(keys).forEach((k) => target.removeItem(k));
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
