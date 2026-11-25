import type { MatchFormat } from '../types';

export type ActiveTab =
  | 'sessions'
  | 'rsvp'
  | 'leaderboard'
  | 'profile'
  | 'gear'
  | 'clubs'
  | 'users'
  | 'settings';

export type SessionSubTab = 'roster' | 'matches';

export interface PersistedMatchDraft {
  sessionId: string;
  matchFormat: MatchFormat;
  teamA1Id: string;
  teamA2Id: string;
  teamB1Id: string;
  teamB2Id: string;
  matchTargetPoints: number;
  finalScoreA: string;
  finalScoreB: string;
}

export interface PersistedNavigationState {
  activeTab: ActiveTab;
  activeClubId: string;
  selectedSessionId: string;
  inspectedPlayerId?: string | null;
  sessionSubTab: SessionSubTab;
  showLogMatchDrawer: boolean;
  matchDraft?: PersistedMatchDraft | null;
  updatedAt: number;
}

export const NAV_STATE_STORAGE_PREFIX = 'courtpulse_nav_state_v1_';
export const MAX_NAV_RESTORE_AGE_MS = 12 * 60 * 60 * 1000;

const VALID_ACTIVE_TABS = new Set<ActiveTab>([
  'sessions',
  'rsvp',
  'leaderboard',
  'profile',
  'gear',
  'clubs',
  'users',
  'settings',
]);

/**
 * Maps the current app tab to the 0-based column index in the mobile bottom navigation bar,
 * or -1 when the current screen (Profile, Gear Locker, Settings) is outside the bottom bar.
 */
export function getMobileNavIndicatorIndex(
  activeTab: ActiveTab,
  canManageFunds: boolean,
  showStandings: boolean = true
): number {
  switch (activeTab) {
    case 'sessions':
    case 'rsvp':
      return 0;
    case 'leaderboard':
      return showStandings ? 1 : -1;
    case 'clubs':
      return showStandings ? 2 : 1;
    case 'users':
      return canManageFunds ? (showStandings ? 3 : 2) : -1;
    default:
      return -1;
  }
}

export function makeNavStateStorageKey(accountKey: string): string {
  return `${NAV_STATE_STORAGE_PREFIX}${accountKey.trim()}`;
}

function getDefaultStorage(): Storage | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

function sanitizeMatchDraft(raw: unknown): PersistedMatchDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.sessionId !== 'string' || !obj.sessionId.trim()) return null;
  const matchFormat: MatchFormat =
    obj.matchFormat === 'singles' ? 'singles' : 'doubles';
  const rawTarget = Number(obj.matchTargetPoints);
  const matchTargetPoints =
    Number.isFinite(rawTarget) && rawTarget >= 11 && rawTarget <= 30
      ? Math.round(rawTarget)
      : 21;

  return {
    sessionId: obj.sessionId,
    matchFormat,
    teamA1Id: typeof obj.teamA1Id === 'string' ? obj.teamA1Id : '',
    teamA2Id: typeof obj.teamA2Id === 'string' ? obj.teamA2Id : '',
    teamB1Id: typeof obj.teamB1Id === 'string' ? obj.teamB1Id : '',
    teamB2Id: typeof obj.teamB2Id === 'string' ? obj.teamB2Id : '',
    matchTargetPoints,
    finalScoreA: typeof obj.finalScoreA === 'string' ? obj.finalScoreA : '',
    finalScoreB: typeof obj.finalScoreB === 'string' ? obj.finalScoreB : '',
  };
}

export function loadPersistedNavigationState(
  accountKey: string | null | undefined,
  nowMs: number = Date.now(),
  storage: Storage | undefined = getDefaultStorage()
): PersistedNavigationState | null {
  const cleanKey = (accountKey || '').trim();
  if (!cleanKey || !storage) return null;

  const storageKey = makeNavStateStorageKey(cleanKey);
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const updatedAt = Number(parsed.updatedAt);
    if (
      !Number.isFinite(updatedAt) ||
      nowMs - updatedAt > MAX_NAV_RESTORE_AGE_MS ||
      updatedAt - nowMs > 60_000
    ) {
      storage.removeItem(storageKey);
      return null;
    }

    const activeTab = VALID_ACTIVE_TABS.has(parsed.activeTab as ActiveTab)
      ? (parsed.activeTab as ActiveTab)
      : 'sessions';
    const activeClubId =
      typeof parsed.activeClubId === 'string' && parsed.activeClubId.trim()
        ? parsed.activeClubId
        : 'all';
    const selectedSessionId =
      typeof parsed.selectedSessionId === 'string'
        ? parsed.selectedSessionId
        : '';
    const sessionSubTab: SessionSubTab =
      parsed.sessionSubTab === 'matches' ? 'matches' : 'roster';
    const showLogMatchDrawer = Boolean(parsed.showLogMatchDrawer);
    const inspectedPlayerId =
      typeof parsed.inspectedPlayerId === 'string'
        ? parsed.inspectedPlayerId
        : null;
    const matchDraft = sanitizeMatchDraft(parsed.matchDraft);

    return {
      activeTab,
      activeClubId,
      selectedSessionId,
      inspectedPlayerId,
      sessionSubTab,
      showLogMatchDrawer,
      matchDraft,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export function savePersistedNavigationState(
  accountKey: string | null | undefined,
  state: Omit<PersistedNavigationState, 'updatedAt'>,
  nowMs: number = Date.now(),
  storage: Storage | undefined = getDefaultStorage()
): void {
  const cleanKey = (accountKey || '').trim();
  if (!cleanKey || !storage) return;

  try {
    const payload: PersistedNavigationState = {
      ...state,
      updatedAt: nowMs,
    };
    storage.setItem(makeNavStateStorageKey(cleanKey), JSON.stringify(payload));
  } catch {
    // Ignore storage quota or private-browsing blocks
  }
}

export function clearPersistedNavigationState(
  accountKey: string | null | undefined,
  storage: Storage | undefined = getDefaultStorage()
): void {
  const cleanKey = (accountKey || '').trim();
  if (!cleanKey || !storage) return;
  try {
    storage.removeItem(makeNavStateStorageKey(cleanKey));
  } catch {
    // ignore
  }
}
