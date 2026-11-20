import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_STORAGE_KEY,
  parseThemeValue,
  readThemeFromCookie,
  resolveTheme,
  _resetThemeMemoryForTests,
} from './theme';
import { clearAllCourtPulseLocalData } from './localData';

function makeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

test('parseThemeValue only accepts exact light or dark strings', () => {
  assert.equal(parseThemeValue('dark'), 'dark');
  assert.equal(parseThemeValue('light'), 'light');
  assert.equal(parseThemeValue('DARK'), null);
  assert.equal(parseThemeValue('system'), null);
  assert.equal(parseThemeValue(null), null);
  assert.equal(parseThemeValue(undefined), null);
});

test('readThemeFromCookie extracts saved theme from cookie string', () => {
  assert.equal(
    readThemeFromCookie(`foo=bar; ${THEME_STORAGE_KEY}=dark; baz=1`),
    'dark'
  );
  assert.equal(
    readThemeFromCookie(`${THEME_STORAGE_KEY}=light`),
    'light'
  );
  assert.equal(readThemeFromCookie(`${THEME_STORAGE_KEY}=invalid`), null);
  assert.equal(readThemeFromCookie(''), null);
});

test('resolveTheme prioritizes localStorage over cookie, memory, and document class', () => {
  _resetThemeMemoryForTests();
  const storage = makeStorage({ [THEME_STORAGE_KEY]: 'light' });
  const resolved = resolveTheme({
    storage,
    cookieString: `${THEME_STORAGE_KEY}=dark`,
    memory: 'dark',
    documentHasDarkClass: true,
  });
  assert.equal(resolved, 'light');
});

test('resolveTheme falls back to cookie and backfills localStorage when storage is empty', () => {
  _resetThemeMemoryForTests();
  const storage = makeStorage();
  const resolved = resolveTheme({
    storage,
    cookieString: `${THEME_STORAGE_KEY}=dark`,
    memory: null,
    documentHasDarkClass: false,
  });
  assert.equal(resolved, 'dark');
  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'dark');
});

test('resolveTheme survives throwing storage by falling back to cookie, memory, or document class', () => {
  _resetThemeMemoryForTests();
  const brokenStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('SecurityError');
    },
  };

  assert.equal(
    resolveTheme({
      storage: brokenStorage,
      cookieString: `${THEME_STORAGE_KEY}=dark`,
      memory: null,
      documentHasDarkClass: false,
    }),
    'dark'
  );

  assert.equal(
    resolveTheme({
      storage: brokenStorage,
      cookieString: '',
      memory: 'dark',
      documentHasDarkClass: false,
    }),
    'dark'
  );

  assert.equal(
    resolveTheme({
      storage: brokenStorage,
      cookieString: '',
      memory: null,
      documentHasDarkClass: true,
    }),
    'dark'
  );

  assert.equal(
    resolveTheme({
      storage: brokenStorage,
      cookieString: '',
      memory: null,
      documentHasDarkClass: false,
    }),
    'light'
  );
});

test('clearAllCourtPulseLocalData preserves the persisted theme preference', () => {
  const storage = makeStorage({
    [THEME_STORAGE_KEY]: 'dark',
    courtpulse_dev_session_v1: '{}',
  });
  clearAllCourtPulseLocalData(storage);
  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'dark');
  assert.equal(storage.getItem('courtpulse_dev_session_v1'), null);
});
