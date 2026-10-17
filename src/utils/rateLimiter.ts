/**
 * Client-side sliding-window & cooldown rate limiter to prevent DDoS / write spam
 * against Firestore and application state endpoints.
 */

interface RateBucket {
  timestamps: number[];
  lastActionTime: number;
}

const buckets = new Map<string, RateBucket>();

const WINDOW_MS = 60_000; // 1 minute sliding window
const MAX_WRITES_PER_WINDOW = 8; // Max 8 mutations per minute per client
const MIN_COOLDOWN_MS = 1_200; // Minimum 1.2s between consecutive writes

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remainingQuota: number;
  reason?: string;
}

export function checkAndConsumeRateLimit(actionKey = 'global_write'): RateLimitCheckResult {
  const now = Date.now();
  const bucket = buckets.get(actionKey) || { timestamps: [], lastActionTime: 0 };

  // Prune timestamps older than 60s
  bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < WINDOW_MS);

  // Check burst cooldown
  const sinceLast = now - bucket.lastActionTime;
  if (sinceLast < MIN_COOLDOWN_MS) {
    const waitSec = Math.ceil((MIN_COOLDOWN_MS - sinceLast) / 1000);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, waitSec),
      remainingQuota: Math.max(0, MAX_WRITES_PER_WINDOW - bucket.timestamps.length),
      reason: `Please wait ${Math.max(1, waitSec)}s before submitting another action.`,
    };
  }

  // Check sliding window quota
  if (bucket.timestamps.length >= MAX_WRITES_PER_WINDOW) {
    const oldest = bucket.timestamps[0];
    const waitSec = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, waitSec),
      remainingQuota: 0,
      reason: `Rate limit reached (${MAX_WRITES_PER_WINDOW} actions/min). Try again in ${Math.max(1, waitSec)}s.`,
    };
  }

  bucket.timestamps.push(now);
  bucket.lastActionTime = now;
  buckets.set(actionKey, bucket);

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remainingQuota: MAX_WRITES_PER_WINDOW - bucket.timestamps.length,
  };
}
