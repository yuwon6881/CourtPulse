// Club referral links: the owner's invite URL plus a secret `ref` code. A new player who arrives
// with a valid code is joined to the club without the confirm card or (for private clubs) the
// owner's approval step. The code is checked by firestore.rules, never by this file.

export const REFERRAL_CODE_LENGTH = 16;
const REFERRAL_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** Mirrors the pattern in firestore.rules (`^[a-z0-9]{12,32}$`). */
const REFERRAL_CODE_PATTERN = /^[a-z0-9]{12,32}$/;

/** A link a player opened but has not finished redeeming (they may still be verifying their email). */
export const PENDING_REFERRAL_STORAGE_KEY = 'courtpulse_pending_referral_v1';
export const PENDING_REFERRAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingReferral {
  clubId: string;
  code: string;
}

export function isValidReferralCode(code: unknown): code is string {
  return typeof code === 'string' && REFERRAL_CODE_PATTERN.test(code);
}

/** Unguessable code (~82 bits). Uses the Web Crypto RNG; never Math.random for a secret. */
export function generateReferralCode(
  fill: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => void crypto.getRandomValues(bytes)
): string {
  const bytes = new Uint8Array(REFERRAL_CODE_LENGTH);
  fill(bytes);
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    // 256 is not a multiple of 36, but the bias (<1.6%) is irrelevant for a 16-char secret.
    code += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
  }
  return code;
}

/** The club's ordinary invite URL carrying the referral code. */
export function buildReferralUrl(inviteUrl: string, code: string): string {
  const url = new URL(inviteUrl);
  url.searchParams.set('ref', code);
  return url.toString();
}

/** Reads `?club=&ref=` from an invite link; null unless both are well formed. */
export function parseReferralFromParams(params: URLSearchParams): PendingReferral | null {
  const clubId = params.get('club');
  const code = params.get('ref');
  if (!clubId || !/^[a-zA-Z0-9_-]{1,128}$/.test(clubId)) return null;
  if (!isValidReferralCode(code)) return null;
  return { clubId, code };
}

interface StoredReferral extends PendingReferral {
  savedAt: number;
}

export function savePendingReferral(
  referral: PendingReferral,
  now: number = Date.now(),
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  try {
    const stored: StoredReferral = { ...referral, savedAt: now };
    storage.setItem(PENDING_REFERRAL_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode / quota: the link still works in this tab through in-memory state.
  }
}

export function loadPendingReferral(
  now: number = Date.now(),
  storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage
): PendingReferral | null {
  try {
    const raw = storage.getItem(PENDING_REFERRAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredReferral>;
    const fresh =
      typeof parsed.savedAt === 'number' &&
      now - parsed.savedAt >= 0 &&
      now - parsed.savedAt <= PENDING_REFERRAL_TTL_MS;
    if (
      !fresh ||
      typeof parsed.clubId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(parsed.clubId) ||
      !isValidReferralCode(parsed.code)
    ) {
      storage.removeItem(PENDING_REFERRAL_STORAGE_KEY);
      return null;
    }
    return { clubId: parsed.clubId, code: parsed.code };
  } catch {
    return null;
  }
}

export function clearPendingReferral(
  storage: Pick<Storage, 'removeItem'> = localStorage
): void {
  try {
    storage.removeItem(PENDING_REFERRAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}
