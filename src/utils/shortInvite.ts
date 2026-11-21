import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { Session } from '../types';
import {
  buildShareableClubAndSessionUrl,
  type ParsedSharedInvite,
} from './badmintonLogic';
import {
  buildShortInviteDocFields,
  buildShortInviteUrl,
  generateShortInviteCode,
  parseShortInviteDoc,
  type ShortInviteClubInput,
} from './shortInviteCodec';

export {
  buildShortInviteDocFields,
  buildShortInviteUrl,
  generateShortInviteCode,
  parseShortInviteDoc,
  type ShortInviteClubInput,
  type ShortInviteDocFields,
} from './shortInviteCodec';

const CACHE_STORAGE_KEY = 'courtpulse_short_invites_v1';

interface CachedShortInvite {
  code: string;
  snapshotKey: string;
}

const memoryCodeCache = new Map<string, CachedShortInvite>();
const inFlightRequests = new Map<string, Promise<string>>();

function readStoredCache(): Record<string, CachedShortInvite> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CachedShortInvite>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredCacheEntry(cacheKey: string, entry: CachedShortInvite): void {
  memoryCodeCache.set(cacheKey, entry);
  if (typeof window === 'undefined') return;
  try {
    const all = readStoredCache();
    all[cacheKey] = entry;
    const keys = Object.keys(all);
    if (keys.length > 100) {
      for (const oldKey of keys.slice(0, keys.length - 100)) {
        delete all[oldKey];
      }
    }
    window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore storage errors
  }
}

function readCachedEntry(cacheKey: string): CachedShortInvite | null {
  const mem = memoryCodeCache.get(cacheKey);
  if (mem) return mem;
  const stored = readStoredCache()[cacheKey];
  if (stored && typeof stored.code === 'string' && stored.code.length >= 6) {
    memoryCodeCache.set(cacheKey, stored);
    return stored;
  }
  return null;
}

export function getCachedShortInviteUrl(
  clubId: string,
  sessionId?: string | null,
  explicitUid?: string | null
): string | null {
  const uid =
    explicitUid !== undefined
      ? explicitUid
      : auth.currentUser?.emailVerified
      ? auth.currentUser.uid
      : null;
  if (!uid) return null;
  const cacheKey = `${uid}::${clubId}::${sessionId || ''}`;
  const cached = readCachedEntry(cacheKey);
  return cached ? buildShortInviteUrl(cached.code) : null;
}

export async function createOrReuseShortInviteUrl(options: {
  clubId: string;
  session?: Session | null;
  club?: ShortInviteClubInput | null;
  userUid?: string | null;
}): Promise<string> {
  const { clubId, session = null, club = null } = options;
  const fallbackUrl = buildShareableClubAndSessionUrl(
    clubId,
    session ?? undefined,
    club
  );
  const uid =
    options.userUid !== undefined
      ? options.userUid
      : auth.currentUser?.emailVerified
      ? auth.currentUser.uid
      : null;

  if (!uid) {
    return fallbackUrl;
  }

  const fields = buildShortInviteDocFields(clubId, session, club);
  const snapshotKey = JSON.stringify(fields);
  const cacheKey = `${uid}::${fields.clubId}::${fields.sessionId}`;

  const cached = readCachedEntry(cacheKey);
  if (cached && cached.snapshotKey === snapshotKey) {
    return buildShortInviteUrl(cached.code);
  }

  const inFlightKey = `${cacheKey}::${snapshotKey}`;
  const existingPromise = inFlightRequests.get(inFlightKey);
  if (existingPromise) {
    return existingPromise;
  }

  const work = (async (): Promise<string> => {
    if (cached && fields.sessionId) {
      try {
        const { clubId: _c, sessionId: _s, ...updatable } = fields;
        await updateDoc(doc(db, 'invites', cached.code), {
          ...updatable,
          updatedAt: serverTimestamp(),
        });
        writeStoredCacheEntry(cacheKey, { code: cached.code, snapshotKey });
        return buildShortInviteUrl(cached.code);
      } catch {
        // Fall through to mint a fresh code if the cached doc no longer exists or cannot be updated.
      }
    } else if (cached && !fields.sessionId) {
      writeStoredCacheEntry(cacheKey, { code: cached.code, snapshotKey });
      return buildShortInviteUrl(cached.code);
    }

    const code = generateShortInviteCode();
    try {
      await setDoc(doc(db, 'invites', code), {
        ...fields,
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      writeStoredCacheEntry(cacheKey, { code, snapshotKey });
      return buildShortInviteUrl(code);
    } catch {
      return fallbackUrl;
    }
  })();

  inFlightRequests.set(inFlightKey, work);
  try {
    return await work;
  } finally {
    inFlightRequests.delete(inFlightKey);
  }
}

export async function resolveShortInviteCode(
  code: string
): Promise<ParsedSharedInvite | null> {
  try {
    const snap = await getDoc(doc(db, 'invites', code));
    if (!snap.exists()) return null;
    return parseShortInviteDoc(snap.data() as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Copies text (or a Promise resolving to text) reliably across Chrome, Safari,
 * Firefox, and iframe contexts without losing transient user activation.
 */
export async function copyTextReliable(
  textOrPromise: string | Promise<string>
): Promise<boolean> {
  if (typeof textOrPromise === 'string') {
    try {
      await navigator.clipboard.writeText(textOrPromise);
      return true;
    } catch {
      return copyViaTextareaFallback(textOrPromise);
    }
  }

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    try {
      const item = new ClipboardItem({
        'text/plain': textOrPromise.then(
          (text) => new Blob([text], { type: 'text/plain' })
        ),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      // Fall through to awaiting and calling writeText / execCommand.
    }
  }

  try {
    const text = await textOrPromise;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return copyViaTextareaFallback(text);
    }
  } catch {
    return false;
  }
}

function copyViaTextareaFallback(text: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-9999px';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
