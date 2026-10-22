import type {
  FootwearAndConsumableItem,
  RacketGearItem,
  StringingLogEntry,
  UsageProfilePreset,
} from '../types/equipment.ts';
import {
  type DurationRestringRecommendation,
  type GripDurationStatus,
  calculateDaysElapsed,
  calculateDurationRestringRecommendation,
  calculateGripDurationStatus,
  todayIsoDate,
} from './equipmentMath.ts';

export interface EquipmentIndex {
  playerRackets: RacketGearItem[];
  racketById: Map<string, RacketGearItem>;
  activeLogByRacketId: Map<string, StringingLogEntry>;
  latestLogByRacketId: Map<string, StringingLogEntry>;
  profileHealthByRacketId: Map<string, number>;
  durationRecByRacketId: Map<string, DurationRestringRecommendation>;
  gripStatusByRacketId: Map<string, GripDurationStatus>;
  playerStringLogsSorted: StringingLogEntry[];
  playerStringLogCount: number;
  shuttleTubes: FootwearAndConsumableItem[];
  summary: {
    playableCount: number;
    totalFramesCount: number;
    meanEffectiveTension: string | null;
    totalShuttlesRemaining: number;
    finishedTubesCount: number;
    gripsDueCount: number;
    gripsFreshCount: number;
  };
}

/**
 * Single-pass O(R + L + C) data indexer for a player's equipment.
 * Pre-computes historical span average once in O(L) instead of O(R * L), and pre-indexes
 * both string duration recommendations and grip duration statuses per racket.
 */
export function createEquipmentIndex(params: {
  playerId: string;
  rackets: RacketGearItem[];
  stringLogs: StringingLogEntry[];
  consumables: FootwearAndConsumableItem[];
  profilePreset?: UsageProfilePreset;
  playerMatchesPlayed?: number;
  referenceDate?: string;
}): EquipmentIndex {
  const preset = params.profilePreset ?? 'balanced';
  const refDate = params.referenceDate ?? todayIsoDate();

  const playerRackets: RacketGearItem[] = [];
  const racketById = new Map<string, RacketGearItem>();
  const currentLogIdToRacketId = new Map<string, string>();

  let playableCount = 0;
  for (let i = 0; i < params.rackets.length; i++) {
    const r = params.rackets[i];
    if (r.playerId !== params.playerId) continue;
    playerRackets.push(r);
    racketById.set(r.id, r);
    if (r.currentStringLogId) {
      currentLogIdToRacketId.set(r.currentStringLogId, r.id);
    }
  }

  const activeLogByRacketId = new Map<string, StringingLogEntry>();
  const latestLogByRacketId = new Map<string, StringingLogEntry>();
  const playerStringLogsSorted: StringingLogEntry[] = [];
  let spanSum = 0;
  let spanCount = 0;
  let isAlreadySortedDesc = true;

  for (let i = 0; i < params.stringLogs.length; i++) {
    const log = params.stringLogs[i];
    if (!racketById.has(log.racketId)) continue;

    if (
      playerStringLogsSorted.length > 0 &&
      log.strungAtDate > playerStringLogsSorted[playerStringLogsSorted.length - 1].strungAtDate
    ) {
      isAlreadySortedDesc = false;
    }
    playerStringLogsSorted.push(log);

    if (log.brokenOrCutDate && log.strungAtDate) {
      const span = calculateDaysElapsed(log.strungAtDate, log.brokenOrCutDate);
      if (span >= 14 && span <= 180) {
        spanSum += span;
        spanCount++;
      }
    }

    const mappedRacketId = currentLogIdToRacketId.get(log.id);
    if (mappedRacketId) {
      activeLogByRacketId.set(mappedRacketId, log);
    }

    const existingLatest = latestLogByRacketId.get(log.racketId);
    if (!existingLatest || log.strungAtDate > existingLatest.strungAtDate) {
      latestLogByRacketId.set(log.racketId, log);
    }
  }

  if (!isAlreadySortedDesc && playerStringLogsSorted.length > 1) {
    playerStringLogsSorted.sort((a, b) => b.strungAtDate.localeCompare(a.strungAtDate));
  }

  const precomputedHistoricalSpanDays = spanCount > 0 ? spanSum / spanCount : null;

  const profileHealthByRacketId = new Map<string, number>();
  const durationRecByRacketId = new Map<string, DurationRestringRecommendation>();
  const gripStatusByRacketId = new Map<string, GripDurationStatus>();
  let tensionSum = 0;
  let activeTensionCount = 0;
  let gripsDueCount = 0;

  for (let i = 0; i < playerRackets.length; i++) {
    const r = playerRackets[i];
    const activeLog = activeLogByRacketId.get(r.id);

    const isPlayable =
      r.status !== 'needs_restring' &&
      r.status !== 'retired_cracked' &&
      Boolean(activeLog && activeLog.outcome === 'active');

    if (isPlayable) {
      playableCount++;
    }

    const rec = activeLog
      ? calculateDurationRestringRecommendation({
          strungAtDate: activeLog.strungAtDate,
          tensionLbs: activeLog.mainTensionLbs,
          crossTensionLbs: activeLog.crossTensionLbs,
          gaugeMm: activeLog.gaugeMm,
          outcome:
            r.status === 'needs_restring' || activeLog.outcome === 'snapped'
              ? 'snapped'
              : 'active',
          profilePreset: preset,
          precomputedHistoricalSpanDays,
          playerMatchesPlayed: params.playerMatchesPlayed,
          referenceDate: refDate,
        })
      : {
          daysElapsed: calculateDaysElapsed(r.purchaseDate ?? refDate, refDate),
          recommendedCycleDays: 0,
          recommendedRestringDate: refDate,
          daysUntilRestring: 0,
          estimatedCourtHours: 0,
          effectiveTensionLbs: 0,
          healthScore: 0,
          statusLabel: 'Unstrung · Restring needed',
          suggestionText: '',
          tone: 'danger' as const,
        };

    durationRecByRacketId.set(r.id, rec);
    profileHealthByRacketId.set(r.id, rec.healthScore);

    const gripStatus = calculateGripDurationStatus({
      lastGripChangeDate: r.lastGripChangeDate,
      fallbackDate: r.purchaseDate ?? refDate,
      gripType: r.gripType,
      profilePreset: preset,
      referenceDate: refDate,
    });
    gripStatusByRacketId.set(r.id, gripStatus);

    if (gripStatus.isDue) {
      gripsDueCount++;
    }

    if (isPlayable) {
      tensionSum += rec.effectiveTensionLbs;
      activeTensionCount++;
    }
  }

  const shuttleTubes: FootwearAndConsumableItem[] = [];
  let totalShuttlesRemaining = 0;
  let finishedTubesCount = 0;

  for (let i = 0; i < params.consumables.length; i++) {
    const c = params.consumables[i];
    if (c.playerId !== params.playerId) continue;
    if (c.category === 'shuttle_tube') {
      shuttleTubes.push(c);
      const remaining = Math.max(0, c.maxRecommendedHours - c.hoursOrSessionsUsed);
      totalShuttlesRemaining += remaining;
      if (remaining === 0 || c.conditionPercent === 0) {
        finishedTubesCount++;
      }
    }
  }

  return {
    playerRackets,
    racketById,
    activeLogByRacketId,
    latestLogByRacketId,
    profileHealthByRacketId,
    durationRecByRacketId,
    gripStatusByRacketId,
    playerStringLogsSorted,
    playerStringLogCount: playerStringLogsSorted.length,
    shuttleTubes,
    summary: {
      playableCount,
      totalFramesCount: playerRackets.length,
      meanEffectiveTension:
        activeTensionCount > 0 ? (tensionSum / activeTensionCount).toFixed(1) : null,
      totalShuttlesRemaining,
      finishedTubesCount,
      gripsDueCount,
      gripsFreshCount: Math.max(0, playerRackets.length - gripsDueCount),
    },
  };
}

/**
 * Windowed pagination for stringing logs so DOM node count stays strictly bounded (e.g. 8 rows max).
 */
export function paginatePlayerStringLogs(params: {
  stringLogs: StringingLogEntry[];
  racketById: Map<string, RacketGearItem>;
  limit?: number;
  page?: number;
  pageSize?: number;
  filterRacketId?: string;
  alreadyFilteredAndSorted?: boolean;
}): {
  visibleLogs: StringingLogEntry[];
  totalCount: number;
  hasMore: boolean;
  page: number;
  totalPages: number;
} {
  let matching: StringingLogEntry[];

  if (params.alreadyFilteredAndSorted && !params.filterRacketId) {
    matching = params.stringLogs;
  } else {
    matching = [];
    for (let i = 0; i < params.stringLogs.length; i++) {
      const log = params.stringLogs[i];
      if (!params.racketById.has(log.racketId)) continue;
      if (params.filterRacketId && log.racketId !== params.filterRacketId) continue;
      matching.push(log);
    }
    if (!params.alreadyFilteredAndSorted) {
      matching.sort((a, b) => b.strungAtDate.localeCompare(a.strungAtDate));
    }
  }

  const totalCount = matching.length;

  if (typeof params.page === 'number' && typeof params.pageSize === 'number') {
    const safePageSize = Math.max(1, params.pageSize);
    const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
    const currentPage = Math.max(1, Math.min(params.page, totalPages));
    const startIdx = (currentPage - 1) * safePageSize;
    const endIdx = startIdx + safePageSize;
    return {
      visibleLogs: matching.slice(startIdx, endIdx),
      totalCount,
      hasMore: currentPage < totalPages,
      page: currentPage,
      totalPages,
    };
  }

  const limit = params.limit ?? 8;
  return {
    visibleLogs: matching.slice(0, limit),
    totalCount,
    hasMore: totalCount > limit,
    page: 1,
    totalPages: Math.max(1, Math.ceil(totalCount / Math.max(1, limit))),
  };
}

/**
 * Bounds long-term stringing log growth by retaining active beds plus the most recent `maxPerRacket` logs per frame.
 */
export function pruneArchivedStringLogs(
  stringLogs: StringingLogEntry[],
  maxPerRacket = 30
): StringingLogEntry[] {
  if (stringLogs.length <= maxPerRacket) {
    return [...stringLogs].sort((a, b) => b.strungAtDate.localeCompare(a.strungAtDate));
  }

  const grouped = new Map<string, StringingLogEntry[]>();
  for (let i = 0; i < stringLogs.length; i++) {
    const log = stringLogs[i];
    const list = grouped.get(log.racketId);
    if (list) {
      list.push(log);
    } else {
      grouped.set(log.racketId, [log]);
    }
  }

  const retained: StringingLogEntry[] = [];
  for (const [, logs] of grouped) {
    if (logs.length <= maxPerRacket) {
      retained.push(...logs);
    } else {
      logs.sort((a, b) => {
        if (a.outcome === 'active' && b.outcome !== 'active') return -1;
        if (b.outcome === 'active' && a.outcome !== 'active') return 1;
        return b.strungAtDate.localeCompare(a.strungAtDate);
      });
      retained.push(...logs.slice(0, maxPerRacket));
    }
  }

  retained.sort((a, b) => b.strungAtDate.localeCompare(a.strungAtDate));
  return retained;
}

/**
 * Bounds long-term shuttlecock tube growth by retaining all active tubes plus at most `maxFinishedPerPlayer` empty tubes.
 */
export function pruneFinishedShuttleTubes(
  consumables: FootwearAndConsumableItem[],
  maxFinishedPerPlayer = 8
): FootwearAndConsumableItem[] {
  const finishedCounts = new Map<string, number>();
  const retained: FootwearAndConsumableItem[] = [];

  for (let i = 0; i < consumables.length; i++) {
    const item = consumables[i];
    if (item.category !== 'shuttle_tube') continue;
    const remaining = Math.max(0, item.maxRecommendedHours - item.hoursOrSessionsUsed);
    const isFinished = remaining === 0 || item.conditionPercent === 0;
    if (!isFinished) {
      retained.push(item);
      continue;
    }
    const prevCount = finishedCounts.get(item.playerId) ?? 0;
    if (prevCount < maxFinishedPerPlayer) {
      finishedCounts.set(item.playerId, prevCount + 1);
      retained.push(item);
    }
  }

  return retained;
}
