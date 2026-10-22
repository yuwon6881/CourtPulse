/**
 * Pure helpers that turn Firebase error codes into short sentences a player can act on.
 * Kept free of Firebase imports so they can be unit tested without initialising the SDK.
 */

/** Extracts a bare Firestore/Auth error code ("permission-denied", "auth/network-request-failed"). */
export function getErrorCode(err: unknown): string {
  if (typeof err === 'object' && err && 'code' in err) {
    const raw = String((err as { code: unknown }).code || '');
    return raw.startsWith('firestore/') ? raw.slice('firestore/'.length) : raw;
  }
  return '';
}

export const GENERIC_DATA_ERROR = 'Something went wrong. Please try again.';

/** Friendly sentence for a Firestore failure. Never includes ids, emails or paths. */
export function friendlyFirestoreMessage(err: unknown): string {
  switch (getErrorCode(err)) {
    case 'permission-denied':
    case 'unauthenticated':
      return "You don't have permission to do that. Refresh and try again.";
    case 'unavailable':
    case 'deadline-exceeded':
      return "You appear to be offline. Try again when you're connected.";
    case 'already-exists':
      return 'That already exists. Refresh and try again.';
    case 'not-found':
      return 'That item no longer exists. Refresh and try again.';
    case 'failed-precondition':
      return 'That action is no longer possible because something changed. Refresh and try again.';
    case 'resource-exhausted':
      return 'CourtPulse is busy right now. Wait a moment and try again.';
    case 'aborted':
      return 'That change collided with another one. Try again.';
    case 'invalid-argument':
      return 'Some of the details were not valid. Check them and try again.';
    default:
      return GENERIC_DATA_ERROR;
  }
}

/** Friendly sentence for a Firebase Auth failure; empty string means "stay silent". */
export function friendlyAuthMessage(err: unknown): string {
  switch (getErrorCode(err)) {
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/missing-password':
      return 'Enter your password.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password':
      return 'Choose a stronger password (at least 8 characters).';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled for CourtPulse yet.';
    case 'auth/unauthorized-domain':
      return 'Sign-in is not enabled for this web address yet. Please contact the CourtPulse admin.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account with this email already exists using a different sign-in method. Sign in with that method instead.';
    case 'auth/requires-recent-login':
      return 'For your security, please sign in again and retry.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact the CourtPulse admin.';
    case 'auth/invalid-action-code':
      return 'That code or link is invalid or has already been used.';
    case 'auth/expired-action-code':
      return 'That code or link has expired. Please request a new one.';
    case 'auth/quota-exceeded':
      return 'CourtPulse is busy right now. Please wait a moment and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    default:
      return GENERIC_DATA_ERROR;
  }
}

/** Splits an array into chunks of at most `size` items (Firestore `in` allows 30 values). */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    out.push(items.slice(i, i + step));
  }
  return out;
}

/** Exponential retry delay: 2s, 4s, 8s ... capped at 60s. `attempt` starts at 1. */
export function backoffDelayMs(attempt: number, baseMs = 2000, capMs = 60000): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(capMs, baseMs * 2 ** (n - 1));
}
