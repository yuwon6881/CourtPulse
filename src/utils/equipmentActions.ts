import type {
  FootwearAndConsumableItem,
  RacketGearItem,
  StringingLogEntry,
  UsageProfilePreset,
} from '../types/equipment.ts';
import { calculateDaysElapsed, calculateEffectiveTension } from './equipmentMath.ts';
import { pruneArchivedStringLogs, pruneFinishedShuttleTubes } from './equipmentIndex.ts';
import type { EquipmentStoreState } from './equipmentStorage.ts';

export interface RestringPayload {
  racketId: string;
  stringModel: string;
  gaugeMm: number;
  mainTensionLbs: number;
  crossTensionLbs: number;
  strungAtDate: string;
}

export interface GripChangePayload {
  racketId: string;
  gripBrandModel: string;
  wrappedAtDate: string;
}

export interface AddRacketPayload {
  nickname: string;
  brand: string;
  model: string;
  initialStringModel: string;
  initialGaugeMm: number;
  initialMainLbs: number;
  initialCrossLbs: number;
  strungAtDate: string;
  gripBrandModel: string;
}

export interface AddShuttleTubePayload {
  brandModel: string;
  shuttleCount: number;
}

export function getRacketLabel(racket: RacketGearItem | undefined): string {
  if (!racket) return 'racket';
  return racket.nickname || racket.model || `${racket.brand} ${racket.model}`.trim();
}

function describeShuttlesLeft(remaining: number): string {
  return remaining === 0
    ? 'Tube finished · 0 shuttles left'
    : `${remaining} ${remaining === 1 ? 'shuttle' : 'shuttles'} left in tube`;
}

// Court time is not tracked per racket yet, so a back-dated bed starts from the same
// cadence estimate the restring recommendation uses (~0.3 h and ~0.4 matches per day).
function createStringLog(params: {
  id: string;
  racketId: string;
  stringModel: string;
  gaugeMm: number;
  mainTensionLbs: number;
  crossTensionLbs: number;
  strungAtDate: string;
  today: string;
}): StringingLogEntry {
  const daysElapsed = calculateDaysElapsed(params.strungAtDate, params.today);
  const hoursPlayedOnBed = Number((daysElapsed * 0.3).toFixed(1));
  const matchesPlayedOnBed = Math.round(daysElapsed * 0.4);
  return {
    id: params.id,
    racketId: params.racketId,
    stringModel: params.stringModel,
    gaugeMm: params.gaugeMm,
    tensionLbs: params.mainTensionLbs,
    mainTensionLbs: params.mainTensionLbs,
    crossTensionLbs: params.crossTensionLbs,
    strungAtDate: params.strungAtDate,
    outcome: 'active',
    hoursPlayedOnBed,
    matchesPlayedOnBed,
    estimatedEffectiveTensionLbs: calculateEffectiveTension({
      mainTensionLbs: params.mainTensionLbs,
      crossTensionLbs: params.crossTensionLbs,
      gaugeMm: params.gaugeMm,
      hoursPlayedOnBed,
      matchesPlayedOnBed,
      daysElapsed,
      outcome: 'active',
    }),
  };
}

export function setPlayerProfilePreset(
  store: EquipmentStoreState,
  playerId: string,
  preset: UsageProfilePreset
): EquipmentStoreState {
  return {
    ...store,
    playerProfiles: { ...store.playerProfiles, [playerId]: preset },
  };
}

export function changeRacketGrip(
  store: EquipmentStoreState,
  payload: GripChangePayload
): EquipmentStoreState {
  return {
    ...store,
    rackets: store.rackets.map((r) =>
      r.id === payload.racketId
        ? {
            ...r,
            gripBrandModel: payload.gripBrandModel,
            lastGripChangeDate: payload.wrappedAtDate,
            matchesSinceGripChange: 0,
          }
        : r
    ),
  };
}

export function rewrapRacketGrip(
  store: EquipmentStoreState,
  racketId: string,
  today: string
): EquipmentStoreState {
  return {
    ...store,
    rackets: store.rackets.map((r) =>
      r.id === racketId
        ? { ...r, matchesSinceGripChange: 0, lastGripChangeDate: today }
        : r
    ),
  };
}

export function markRacketStringSnapped(
  store: EquipmentStoreState,
  racketId: string,
  today: string
): EquipmentStoreState {
  const target = store.rackets.find((r) => r.id === racketId);
  if (!target) return store;
  return {
    ...store,
    rackets: store.rackets.map((r) =>
      r.id === racketId
        ? { ...r, status: 'needs_restring' as const, stringHealthScore: 0 }
        : r
    ),
    stringLogs: store.stringLogs.map((l) =>
      l.id === target.currentStringLogId
        ? {
            ...l,
            outcome: 'snapped' as const,
            brokenOrCutDate: today,
            estimatedEffectiveTensionLbs: 0,
          }
        : l
    ),
  };
}

export function restringRacket(
  store: EquipmentStoreState,
  payload: RestringPayload,
  options: { today: string; newLogId: string }
): EquipmentStoreState {
  const newEntry = createStringLog({
    id: options.newLogId,
    racketId: payload.racketId,
    stringModel: payload.stringModel,
    gaugeMm: payload.gaugeMm,
    mainTensionLbs: payload.mainTensionLbs,
    crossTensionLbs: payload.crossTensionLbs,
    strungAtDate: payload.strungAtDate,
    today: options.today,
  });

  const nextLogs = pruneArchivedStringLogs(
    [
      newEntry,
      ...store.stringLogs.map((l) =>
        l.racketId === payload.racketId && l.outcome === 'active'
          ? {
              ...l,
              outcome: 'cut_for_fresh_bed' as const,
              brokenOrCutDate: payload.strungAtDate,
            }
          : l
      ),
    ],
    30
  );

  return {
    ...store,
    stringLogs: nextLogs,
    rackets: store.rackets.map((r) =>
      r.id === payload.racketId
        ? {
            ...r,
            currentStringLogId: options.newLogId,
            stringHealthScore: 100,
            status: r.status === 'needs_restring' ? ('active' as const) : r.status,
          }
        : r
    ),
  };
}

export function addRacketToLocker(
  store: EquipmentStoreState,
  payload: AddRacketPayload,
  options: { playerId: string; today: string; racketId: string; logId: string }
): EquipmentStoreState {
  const newLog = createStringLog({
    id: options.logId,
    racketId: options.racketId,
    stringModel: payload.initialStringModel,
    gaugeMm: payload.initialGaugeMm,
    mainTensionLbs: payload.initialMainLbs,
    crossTensionLbs: payload.initialCrossLbs,
    strungAtDate: payload.strungAtDate,
    today: options.today,
  });

  const newRacket: RacketGearItem = {
    id: options.racketId,
    playerId: options.playerId,
    nickname: payload.nickname,
    brand: payload.brand,
    model: payload.model,
    status: 'active',
    purchaseDate: payload.strungAtDate,
    currentStringLogId: options.logId,
    stringHealthScore: 100,
    gripType: 'pu_overgrip',
    gripBrandModel: payload.gripBrandModel,
    lastGripChangeDate: payload.strungAtDate,
    matchesSinceGripChange: 0,
    maxMatchesPerGrip: 8,
    grommetCondition: 'fresh',
    framePaintChipsCount: 0,
  };

  return {
    ...store,
    rackets: [newRacket, ...store.rackets],
    stringLogs: pruneArchivedStringLogs([newLog, ...store.stringLogs], 30),
  };
}

export function takeShuttleFromTube(
  store: EquipmentStoreState,
  tubeId: string
): EquipmentStoreState {
  return {
    ...store,
    consumables: store.consumables.map((item) => {
      if (item.id !== tubeId) return item;
      const nextUsed = Math.min(item.maxRecommendedHours, item.hoursOrSessionsUsed + 1);
      const remaining = Math.max(0, item.maxRecommendedHours - nextUsed);
      return {
        ...item,
        hoursOrSessionsUsed: nextUsed,
        conditionPercent: Math.round((remaining / item.maxRecommendedHours) * 100),
        statusNote: describeShuttlesLeft(remaining),
      };
    }),
  };
}

export function finishShuttleTube(
  store: EquipmentStoreState,
  tubeId: string
): EquipmentStoreState {
  return {
    ...store,
    consumables: store.consumables.map((item) =>
      item.id === tubeId
        ? {
            ...item,
            hoursOrSessionsUsed: item.maxRecommendedHours,
            conditionPercent: 0,
            statusNote: describeShuttlesLeft(0),
          }
        : item
    ),
  };
}

export function restockShuttleTube(
  store: EquipmentStoreState,
  tubeId: string,
  today: string
): EquipmentStoreState {
  return {
    ...store,
    consumables: store.consumables.map((item) =>
      item.id === tubeId
        ? {
            ...item,
            hoursOrSessionsUsed: 0,
            conditionPercent: 100,
            acquiredDate: today,
            statusNote: describeShuttlesLeft(item.maxRecommendedHours),
          }
        : item
    ),
  };
}

export function removeShuttleTube(
  store: EquipmentStoreState,
  tubeId: string
): EquipmentStoreState {
  return {
    ...store,
    consumables: store.consumables.filter((c) => c.id !== tubeId),
  };
}

export function addShuttleTube(
  store: EquipmentStoreState,
  payload: AddShuttleTubePayload,
  options: { playerId: string; today: string; tubeId: string }
): EquipmentStoreState {
  const shuttleCount = Math.max(1, payload.shuttleCount);
  const newItem: FootwearAndConsumableItem = {
    id: options.tubeId,
    playerId: options.playerId,
    category: 'shuttle_tube',
    brandModel: payload.brandModel,
    acquiredDate: options.today,
    hoursOrSessionsUsed: 0,
    maxRecommendedHours: shuttleCount,
    conditionPercent: 100,
    statusNote: describeShuttlesLeft(shuttleCount),
  };
  return {
    ...store,
    consumables: pruneFinishedShuttleTubes([newItem, ...store.consumables], 8),
  };
}

/**
 * Drops finished stringing logs for the given player's rackets only; other players' history
 * and every active bed are kept.
 */
export function clearArchivedStringLogs(
  store: EquipmentStoreState,
  playerRacketIds: ReadonlySet<string>
): EquipmentStoreState {
  return {
    ...store,
    stringLogs: store.stringLogs.filter(
      (l) => !playerRacketIds.has(l.racketId) || l.outcome === 'active'
    ),
  };
}
