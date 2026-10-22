import test from 'node:test';
import assert from 'node:assert/strict';
import {
  USAGE_PROFILE_PRESETS,
  addDaysToDate,
  calculateDaysElapsed,
  calculateDurationRestringRecommendation,
  calculateEffectiveTension,
  calculateGripDurationStatus,
  getInitialAverageTension,
} from './equipmentMath.ts';
import {
  createEquipmentIndex,
  paginatePlayerStringLogs,
  pruneArchivedStringLogs,
  pruneFinishedShuttleTubes,
} from './equipmentIndex.ts';
import {
  loadEquipmentStoreState,
  writeEquipmentStoreState,
} from './equipmentStorage.ts';
import type {
  FootwearAndConsumableItem,
  RacketGearItem,
  StringingLogEntry,
} from '../types/equipment.ts';

test('getInitialAverageTension supports single tension or main/cross average', () => {
  assert.equal(getInitialAverageTension(27), 27.0);
  assert.equal(getInitialAverageTension(27, 27), 27.0);
});

test('intuitive preset labels and calculateGripDurationStatus compute grip bar percentage and rewrap schedule', () => {
  assert.equal(USAGE_PROFILE_PRESETS.cost_saving.label, 'Max Durability');
  assert.equal(USAGE_PROFILE_PRESETS.balanced.label, 'Regular Club');
  assert.equal(USAGE_PROFILE_PRESETS.performance.label, 'Peak Feel');

  const maxDurabilityGrip = calculateGripDurationStatus({
    lastGripChangeDate: '2026-09-20',
    profilePreset: 'cost_saving',
    referenceDate: '2026-10-17',
  });
  const peakFeelGrip = calculateGripDurationStatus({
    lastGripChangeDate: '2026-09-20',
    profilePreset: 'performance',
    referenceDate: '2026-10-17',
  });

  assert.equal(maxDurabilityGrip.daysElapsed, 27);
  assert.ok(maxDurabilityGrip.gripHealthPercent > peakFeelGrip.gripHealthPercent);
  assert.equal(maxDurabilityGrip.isDue, false);
  assert.equal(peakFeelGrip.isDue, true);
});

test('calculateDaysElapsed and addDaysToDate compute accurate calendar durations', () => {
  assert.equal(calculateDaysElapsed('2026-10-01', '2026-10-17'), 16);
  assert.equal(calculateDaysElapsed('2026-10-20', '2026-10-17'), 0);
  assert.equal(addDaysToDate('2026-10-01', 16), '2026-10-17');
});

test('calculateDurationRestringRecommendation recommends later restring date and higher health in cost_saving profile', () => {
  const costSavingRec = calculateDurationRestringRecommendation({
    strungAtDate: '2026-09-01',
    tensionLbs: 27,
    profilePreset: 'cost_saving',
    referenceDate: '2026-10-17',
  });

  const balancedRec = calculateDurationRestringRecommendation({
    strungAtDate: '2026-09-01',
    tensionLbs: 27,
    profilePreset: 'balanced',
    referenceDate: '2026-10-17',
  });

  const performanceRec = calculateDurationRestringRecommendation({
    strungAtDate: '2026-09-01',
    tensionLbs: 27,
    profilePreset: 'performance',
    referenceDate: '2026-10-17',
  });

  assert.equal(costSavingRec.daysElapsed, 46);
  assert.ok(
    costSavingRec.recommendedCycleDays > balancedRec.recommendedCycleDays,
    'Cost saving cycle should be longer than balanced cycle'
  );
  assert.ok(
    balancedRec.recommendedCycleDays > performanceRec.recommendedCycleDays,
    'Balanced cycle should be longer than performance cycle'
  );
  assert.ok(
    costSavingRec.healthScore > balancedRec.healthScore,
    'Cost saving health % should be more conservative (higher) than balanced'
  );
  assert.ok(
    costSavingRec.recommendedRestringDate > balancedRec.recommendedRestringDate
  );
});

test('calculateEffectiveTension models static creep and dynamic play decay for single tension', () => {
  const freshTension = calculateEffectiveTension({
    mainTensionLbs: 27,
    crossTensionLbs: 27,
    gaugeMm: 0.65,
    hoursPlayedOnBed: 0,
    matchesPlayedOnBed: 0,
    daysElapsed: 0,
    outcome: 'active',
  });
  const wornTension = calculateEffectiveTension({
    mainTensionLbs: 27,
    crossTensionLbs: 27,
    gaugeMm: 0.65,
    hoursPlayedOnBed: 16,
    matchesPlayedOnBed: 22,
    daysElapsed: 25,
    outcome: 'active',
  });
  const snappedTension = calculateEffectiveTension({
    mainTensionLbs: 27,
    crossTensionLbs: 27,
    gaugeMm: 0.65,
    hoursPlayedOnBed: 16,
    matchesPlayedOnBed: 22,
    daysElapsed: 25,
    outcome: 'snapped',
  });

  assert.ok(freshTension > 26.0 && freshTension <= 27.0);
  assert.ok(wornTension < freshTension);
  assert.equal(snappedTension, 0);
});

test('createEquipmentIndex builds O(1) lookup maps, pre-sorted logs, grip statuses, and duration recommendations', () => {
  const rackets: RacketGearItem[] = [
    {
      id: 'r-1',
      playerId: 'p-1',
      nickname: 'Main 1',
      brand: 'Yonex',
      model: 'Astrox 88D Pro',
      weightSpec: '4U',
      gripSize: 'G5',
      balance: 'head_heavy',
      stiffness: 'stiff',
      status: 'active',
      currentStringLogId: 'log-2',
      stringHealthScore: 88,
      gripType: 'pu_overgrip',
      gripBrandModel: 'Super Grap',
      lastGripChangeDate: '2026-09-01',
      matchesSinceGripChange: 2,
      maxMatchesPerGrip: 8,
      grommetCondition: 'fresh',
      framePaintChipsCount: 0,
    },
  ];

  const stringLogs: StringingLogEntry[] = [
    {
      id: 'log-2',
      racketId: 'r-1',
      stringModel: 'Exbolt 65',
      gaugeMm: 0.65,
      mainTensionLbs: 27,
      crossTensionLbs: 27,
      strungAtDate: '2026-09-15',
      outcome: 'active',
      hoursPlayedOnBed: 10,
      matchesPlayedOnBed: 14,
      estimatedEffectiveTensionLbs: 24.2,
    },
  ];

  const consumables: FootwearAndConsumableItem[] = [
    {
      id: 'c-1',
      playerId: 'p-1',
      category: 'shuttle_tube',
      brandModel: 'Yonex AS-50',
      acquiredDate: '2026-10-01',
      hoursOrSessionsUsed: 4,
      maxRecommendedHours: 12,
      conditionPercent: 67,
      statusNote: '8 left',
    },
  ];

  const balancedIndex = createEquipmentIndex({
    playerId: 'p-1',
    rackets,
    stringLogs,
    consumables,
    profilePreset: 'balanced',
  });
  const costSavingIndex = createEquipmentIndex({
    playerId: 'p-1',
    rackets,
    stringLogs,
    consumables,
    profilePreset: 'cost_saving',
  });

  assert.equal(balancedIndex.playerRackets.length, 1);
  assert.equal(balancedIndex.summary.totalShuttlesRemaining, 8);
  assert.equal(balancedIndex.summary.gripsDueCount, 1);
  assert.ok(balancedIndex.gripStatusByRacketId.has('r-1'));
  assert.ok(
    (costSavingIndex.profileHealthByRacketId.get('r-1') ?? 0) >
      (balancedIndex.profileHealthByRacketId.get('r-1') ?? 0)
  );
  assert.ok(
    (costSavingIndex.durationRecByRacketId.get('r-1')?.recommendedCycleDays ?? 0) >
      (balancedIndex.durationRecByRacketId.get('r-1')?.recommendedCycleDays ?? 0)
  );
});

test('paginatePlayerStringLogs, pruneArchivedStringLogs, and pruneFinishedShuttleTubes guarantee O(1) DOM windowing and bounded storage', () => {
  const racketMap = new Map<string, RacketGearItem>([
    [
      'r-1',
      {
        id: 'r-1',
        playerId: 'p-1',
        brand: 'Yonex',
        model: 'Arcsaber 11 Pro',
        weightSpec: '4U',
        gripSize: 'G5',
        balance: 'even_balance',
        stiffness: 'stiff',
        status: 'active',
        stringHealthScore: 95,
        gripType: 'pu_overgrip',
        gripBrandModel: 'Super Grap',
        matchesSinceGripChange: 1,
        maxMatchesPerGrip: 8,
        grommetCondition: 'fresh',
        framePaintChipsCount: 0,
      },
    ],
  ]);

  const manyLogs: StringingLogEntry[] = Array.from({ length: 120 }, (_, idx) => ({
    id: `log-${idx}`,
    racketId: 'r-1',
    stringModel: 'Exbolt 63',
    gaugeMm: 0.63,
    mainTensionLbs: 27,
    crossTensionLbs: 27,
    strungAtDate: `2026-09-${String((idx % 28) + 1).padStart(2, '0')}`,
    outcome: idx === 0 ? 'active' : 'snapped',
    hoursPlayedOnBed: 10,
    matchesPlayedOnBed: 12,
    estimatedEffectiveTensionLbs: idx === 0 ? 25.5 : 0,
  }));

  const pruned = pruneArchivedStringLogs(manyLogs, 20);
  assert.equal(pruned.length, 20);
  assert.ok(pruned.some((l) => l.id === 'log-0' && l.outcome === 'active'));

  const page1 = paginatePlayerStringLogs({
    stringLogs: pruned,
    racketById: racketMap,
    page: 1,
    pageSize: 8,
    alreadyFilteredAndSorted: true,
  });
  assert.equal(page1.visibleLogs.length, 8);
  assert.equal(page1.totalCount, 20);
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.hasMore, true);

  const page3 = paginatePlayerStringLogs({
    stringLogs: pruned,
    racketById: racketMap,
    page: 3,
    pageSize: 8,
    alreadyFilteredAndSorted: true,
  });
  assert.equal(page3.visibleLogs.length, 4);
  assert.equal(page3.hasMore, false);

  const manyFinishedTubes: FootwearAndConsumableItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `tube-${i}`,
    playerId: 'p-1',
    category: 'shuttle_tube',
    brandModel: `Tube ${i}`,
    acquiredDate: '2026-09-01',
    hoursOrSessionsUsed: 12,
    maxRecommendedHours: 12,
    conditionPercent: 0,
    statusNote: 'Tube finished · 0 shuttles left',
  }));
  const prunedTubes = pruneFinishedShuttleTubes(manyFinishedTubes, 5);
  assert.equal(prunedTubes.length, 5);
});

test('writeEquipmentStoreState and loadEquipmentStoreState round-trip with pruning and profiles', () => {
  const memoryMap = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => memoryMap.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryMap.set(k, v);
    },
  };

  const sampleState = {
    rackets: [],
    stringLogs: Array.from({ length: 40 }, (_, i) => ({
      id: `l-${i}`,
      racketId: 'r-1',
      stringModel: 'BG66 Ultimax',
      gaugeMm: 0.65,
      mainTensionLbs: 27,
      crossTensionLbs: 27,
      strungAtDate: '2026-10-01',
      outcome: (i === 0 ? 'active' : 'snapped') as 'active' | 'snapped',
      hoursPlayedOnBed: 5,
      matchesPlayedOnBed: 6,
      estimatedEffectiveTensionLbs: 25,
    })),
    consumables: [],
    playerProfiles: { 'p-1': 'cost_saving' as const },
  };

  const ok = writeEquipmentStoreState(sampleState, mockStorage);
  assert.equal(ok, true);

  const hydrated = loadEquipmentStoreState(
    { rackets: [], stringLogs: [], consumables: [] },
    mockStorage
  );
  assert.equal(hydrated.stringLogs.length, 30);
  assert.equal(hydrated.playerProfiles?.['p-1'], 'cost_saving');
});

test('createEquipmentIndex treats racket with no active string log as unstrung and unplayable', () => {
  const unstrungRacket: RacketGearItem = {
    id: 'r-unstrung',
    playerId: 'p-1',
    brand: 'Victor',
    model: 'Thruster K 9900',
    weightSpec: '4U',
    gripSize: 'G5',
    balance: 'head_heavy',
    stiffness: 'stiff',
    status: 'active',
    stringHealthScore: 100,
    gripType: 'pu_overgrip',
    gripBrandModel: 'Super Grap',
    matchesSinceGripChange: 0,
    maxMatchesPerGrip: 8,
    grommetCondition: 'fresh',
    framePaintChipsCount: 0,
  };

  const index = createEquipmentIndex({
    playerId: 'p-1',
    rackets: [unstrungRacket],
    stringLogs: [],
    consumables: [],
  });

  assert.equal(index.summary.playableCount, 0);
  assert.equal(index.summary.totalFramesCount, 1);
  const rec = index.durationRecByRacketId.get('r-unstrung');
  assert.ok(rec);
  assert.equal(rec.healthScore, 0);
  assert.equal(rec.effectiveTensionLbs, 0);
  assert.equal(rec.tone, 'danger');
  assert.equal(index.profileHealthByRacketId.get('r-unstrung'), 0);
});

test('createEquipmentIndex and calculateDurationRestringRecommendation thread crossTensionLbs', () => {
  const racket: RacketGearItem = {
    id: 'r-hybrid',
    playerId: 'p-1',
    brand: 'Yonex',
    model: 'Nanoflare 800',
    weightSpec: '4U',
    gripSize: 'G5',
    balance: 'head_light',
    stiffness: 'stiff',
    status: 'active',
    currentStringLogId: 'log-hybrid',
    stringHealthScore: 90,
    gripType: 'pu_overgrip',
    gripBrandModel: 'Super Grap',
    matchesSinceGripChange: 0,
    maxMatchesPerGrip: 8,
    grommetCondition: 'fresh',
    framePaintChipsCount: 0,
  };

  const stringLog: StringingLogEntry = {
    id: 'log-hybrid',
    racketId: 'r-hybrid',
    stringModel: 'Aerobite',
    gaugeMm: 0.67,
    mainTensionLbs: 26,
    crossTensionLbs: 28,
    strungAtDate: '2026-10-10',
    outcome: 'active',
    hoursPlayedOnBed: 0,
    matchesPlayedOnBed: 0,
    estimatedEffectiveTensionLbs: 27,
  };

  const index = createEquipmentIndex({
    playerId: 'p-1',
    rackets: [racket],
    stringLogs: [stringLog],
    consumables: [],
    referenceDate: '2026-10-10',
  });

  assert.equal(index.summary.playableCount, 1);
  const rec = index.durationRecByRacketId.get('r-hybrid');
  assert.ok(rec);
  // Average initial tension is (26 + 28) / 2 = 27.0 lbs, minus fresh creep
  assert.ok(rec.effectiveTensionLbs >= 26.0 && rec.effectiveTensionLbs <= 27.0);

  // Compare recommendation without cross tension (main tension only: 26 lbs) vs with cross tension (28 lbs)
  const recMainOnly = calculateDurationRestringRecommendation({
    strungAtDate: '2026-10-10',
    tensionLbs: 26,
    referenceDate: '2026-10-10',
  });
  const recHybrid = calculateDurationRestringRecommendation({
    strungAtDate: '2026-10-10',
    tensionLbs: 26,
    crossTensionLbs: 28,
    referenceDate: '2026-10-10',
  });
  assert.ok(recHybrid.effectiveTensionLbs > recMainOnly.effectiveTensionLbs);
});

test('createEquipmentIndex latestLogByRacketId keeps first-encountered entry on same-date ties', () => {
  const racket: RacketGearItem = {
    id: 'r-tie',
    playerId: 'p-1',
    brand: 'Yonex',
    model: 'Duora 10',
    weightSpec: '3U',
    gripSize: 'G5',
    balance: 'even_balance',
    stiffness: 'stiff',
    status: 'active',
    stringHealthScore: 80,
    gripType: 'pu_overgrip',
    gripBrandModel: 'Super Grap',
    matchesSinceGripChange: 0,
    maxMatchesPerGrip: 8,
    grommetCondition: 'fresh',
    framePaintChipsCount: 0,
  };

  // logs are provided newest-first: first log is newer than second log despite same strungAtDate
  const logNewer: StringingLogEntry = {
    id: 'log-newer',
    racketId: 'r-tie',
    stringModel: 'BG80',
    gaugeMm: 0.68,
    mainTensionLbs: 27,
    crossTensionLbs: 27,
    strungAtDate: '2026-10-10',
    outcome: 'active',
    hoursPlayedOnBed: 2,
    matchesPlayedOnBed: 3,
    estimatedEffectiveTensionLbs: 25.5,
  };
  const logOlder: StringingLogEntry = {
    id: 'log-older',
    racketId: 'r-tie',
    stringModel: 'BG65',
    gaugeMm: 0.70,
    mainTensionLbs: 24,
    crossTensionLbs: 24,
    strungAtDate: '2026-10-10',
    outcome: 'snapped',
    hoursPlayedOnBed: 20,
    matchesPlayedOnBed: 25,
    estimatedEffectiveTensionLbs: 0,
  };

  const index = createEquipmentIndex({
    playerId: 'p-1',
    rackets: [racket],
    stringLogs: [logNewer, logOlder],
    consumables: [],
  });

  assert.equal(index.latestLogByRacketId.get('r-tie')?.id, 'log-newer');
});

