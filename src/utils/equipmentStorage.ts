import type {
  FootwearAndConsumableItem,
  RacketGearItem,
  StringingLogEntry,
  UsageProfilePreset,
} from '../types/equipment.ts';
import {
  pruneArchivedStringLogs,
  pruneFinishedShuttleTubes,
} from './equipmentIndex.ts';

export interface EquipmentStoreState {
  rackets: RacketGearItem[];
  stringLogs: StringingLogEntry[];
  consumables: FootwearAndConsumableItem[];
  playerProfiles?: Record<string, UsageProfilePreset>;
}

export const EQUIPMENT_STORE_VERSION = 3;
const STORAGE_KEY = 'court_gear_locker_v3';

interface PersistedEnvelope {
  version: typeof EQUIPMENT_STORE_VERSION;
  rackets: RacketGearItem[];
  stringLogs: StringingLogEntry[];
  consumables: FootwearAndConsumableItem[];
  playerProfiles?: Record<string, UsageProfilePreset>;
}

export const EMPTY_EQUIPMENT_STORE: EquipmentStoreState = {
  rackets: [],
  stringLogs: [],
  consumables: [],
  playerProfiles: {},
};

/**
 * Parses a persisted envelope (from localStorage or Firestore) with structural validation,
 * log pruning and finished-tube compaction so stored state stays bounded over years of use.
 * Returns null when the payload is missing, from another version, or malformed.
 */
export function parseEquipmentStoreState(raw: string | null | undefined): EquipmentStoreState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedEnvelope>;
    if (
      parsed.version !== EQUIPMENT_STORE_VERSION ||
      !Array.isArray(parsed.rackets) ||
      !Array.isArray(parsed.stringLogs) ||
      !Array.isArray(parsed.consumables)
    ) {
      return null;
    }
    return {
      rackets: parsed.rackets,
      stringLogs: pruneArchivedStringLogs(parsed.stringLogs, 30),
      consumables: pruneFinishedShuttleTubes(parsed.consumables, 8),
      playerProfiles: parsed.playerProfiles ?? {},
    };
  } catch {
    return null;
  }
}

/**
 * Serializes bounded state deterministically, so equal states produce equal strings and sync
 * code can skip redundant writes. `compact` keeps fewer archived rows for tight quotas.
 */
export function serializeEquipmentStoreState(
  state: EquipmentStoreState,
  compact = false
): string {
  const envelope: PersistedEnvelope = {
    version: EQUIPMENT_STORE_VERSION,
    rackets: state.rackets,
    stringLogs: pruneArchivedStringLogs(state.stringLogs, compact ? 10 : 30),
    consumables: pruneFinishedShuttleTubes(state.consumables, compact ? 3 : 8),
    playerProfiles: state.playerProfiles,
  };
  return JSON.stringify(envelope);
}

export function getEquipmentStorageKey(ownerKey?: string | null): string {
  const clean = (ownerKey || '').trim() || 'local';
  return `${STORAGE_KEY}_${clean}`;
}

/** Reads the locker for the given ownerKey (or device-only when omitted), falling back when nothing valid is stored. */
export function loadEquipmentStoreState(
  fallback: EquipmentStoreState,
  storage?: Pick<Storage, 'getItem'>,
  ownerKey?: string | null
): EquipmentStoreState {
  const targetStorage =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!targetStorage) return fallback;
  try {
    const key = getEquipmentStorageKey(ownerKey);
    return parseEquipmentStoreState(targetStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Writes the locker for the given ownerKey (or device-only when omitted), retrying with a compact
 * payload when the browser storage quota is exceeded.
 */
export function writeEquipmentStoreState(
  state: EquipmentStoreState,
  storage?: Pick<Storage, 'setItem'>,
  ownerKey?: string | null
): boolean {
  const targetStorage =
    storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!targetStorage) return false;
  const key = getEquipmentStorageKey(ownerKey);
  try {
    targetStorage.setItem(key, serializeEquipmentStoreState(state));
    return true;
  } catch {
    try {
      targetStorage.setItem(key, serializeEquipmentStoreState(state, true));
      return true;
    } catch {
      return false;
    }
  }
}
