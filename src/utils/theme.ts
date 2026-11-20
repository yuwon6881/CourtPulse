import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'courtpulse_theme_v1';
const THEME_EVENT = 'courtpulse:theme-change';
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const LIGHT_THEME_COLOR = '#059669';
const DARK_THEME_COLOR = '#050505';
const LIGHT_STATUS_BAR_STYLE = 'default';
const DARK_STATUS_BAR_STYLE = 'black-translucent';

let memoryTheme: ThemeMode | null = null;

export function parseThemeValue(value: unknown): ThemeMode | null {
  if (value === 'dark' || value === 'light') {
    return value;
  }
  return null;
}

export function readThemeFromCookie(cookieString?: string): ThemeMode | null {
  const raw =
    cookieString !== undefined
      ? cookieString
      : typeof document !== 'undefined'
      ? document.cookie
      : '';
  if (!raw) return null;
  const parts = raw.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${THEME_STORAGE_KEY}=`)) continue;
    const val = decodeURIComponent(
      trimmed.slice(THEME_STORAGE_KEY.length + 1)
    ).trim();
    const parsed = parseThemeValue(val);
    if (parsed) return parsed;
  }
  return null;
}

export function writeThemeCookie(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = `${THEME_STORAGE_KEY}=${mode}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  } catch {
    // ignore cookie errors in restricted contexts
  }
}

export interface ResolveThemeSources {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  cookieString?: string;
  memory?: ThemeMode | null;
  documentHasDarkClass?: boolean;
}

export function resolveTheme(sources: ResolveThemeSources = {}): ThemeMode {
  const storage =
    sources.storage !== undefined
      ? sources.storage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;

  let stored: ThemeMode | null = null;
  if (storage) {
    try {
      stored = parseThemeValue(storage.getItem(THEME_STORAGE_KEY));
    } catch {
      stored = null;
    }
  }
  if (stored) {
    return stored;
  }

  const fromCookie = readThemeFromCookie(sources.cookieString);
  if (fromCookie) {
    if (storage) {
      try {
        storage.setItem(THEME_STORAGE_KEY, fromCookie);
      } catch {
        // ignore storage write errors
      }
    }
    return fromCookie;
  }

  const cachedMemory =
    sources.memory !== undefined ? sources.memory : memoryTheme;
  if (cachedMemory) {
    return cachedMemory;
  }

  const hasDark =
    sources.documentHasDarkClass !== undefined
      ? sources.documentHasDarkClass
      : typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');
  if (hasDark) {
    return 'dark';
  }

  return 'light';
}

export function getStoredTheme(): ThemeMode {
  const resolved = resolveTheme();
  memoryTheme = resolved;
  return resolved;
}

export function applyThemeToDocument(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = mode === 'dark';
  root.classList.toggle('dark', isDark);
  root.dataset.theme = mode;
  root.style.colorScheme = mode;

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute(
      'content',
      isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR
    );
  }

  const statusBarMeta = document.querySelector(
    'meta[name="apple-mobile-web-app-status-bar-style"]'
  );
  if (statusBarMeta) {
    statusBarMeta.setAttribute(
      'content',
      isDark ? DARK_STATUS_BAR_STYLE : LIGHT_STATUS_BAR_STYLE
    );
  }
}

export function initializeTheme(): ThemeMode {
  const mode = getStoredTheme();
  applyThemeToDocument(mode);
  return mode;
}

export function persistAndApplyTheme(mode: ThemeMode): void {
  memoryTheme = mode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors
  }
  writeThemeCookie(mode);
  applyThemeToDocument(mode);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: mode }));
  }
}

/** Test helper to clear module-level memory state between test cases. */
export function _resetThemeMemoryForTests(): void {
  memoryTheme = null;
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    const syncFromPersisted = () => {
      const next = getStoredTheme();
      applyThemeToDocument(next);
      setThemeState((prev) => (prev === next ? prev : next));
    };

    const handleSync = (event: Event) => {
      const custom = event as CustomEvent<ThemeMode>;
      const parsed = parseThemeValue(custom.detail);
      if (parsed) {
        memoryTheme = parsed;
        applyThemeToDocument(parsed);
        setThemeState((prev) => (prev === parsed ? prev : parsed));
      } else {
        syncFromPersisted();
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) {
        const next =
          parseThemeValue(event.newValue) ??
          readThemeFromCookie() ??
          'light';
        memoryTheme = next;
        applyThemeToDocument(next);
        setThemeState((prev) => (prev === next ? prev : next));
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncFromPersisted();
      }
    };

    window.addEventListener(THEME_EVENT, handleSync);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('pageshow', syncFromPersisted);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener(THEME_EVENT, handleSync);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('pageshow', syncFromPersisted);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    persistAndApplyTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    const current = getStoredTheme();
    const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
    persistAndApplyTheme(next);
    setThemeState(next);
  }, []);

  return {
    theme,
    isDark: theme === 'dark',
    setTheme,
    toggleTheme,
  };
}
