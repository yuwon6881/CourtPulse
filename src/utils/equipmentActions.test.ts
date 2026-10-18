import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addShuttleTube,
  clearArchivedStringLogs,
  markRacketStringSnapped,
  restringRacket,
  rewrapRacketGrip,
  takeShuttleFromTube,
} from './equipmentActions.ts';
import { createEquipmentIndex } from './equipmentIndex.ts';
import { todayIsoDate } from './equipmentMath.ts';
import type { EquipmentStoreState } from './equipmentStorage.ts';
import type { RacketGearItem, StringingLogEntry } from '../types/equipment.ts';

const TODAY = '2026-10-18';

function makeRacket(overrides: Partial<RacketGearItem> = {}): RacketGearItem {
  return {
    id: 'r-1',
    playerId: 'p-1',
    nickname: 'Main',
    brand: 'Yonex',
    model: 'Astrox 88D Pro',
    weightSpec: '4U',
    gripSize: 'G5',
    balance: 'head_heavy',
    stiffness: 'stiff',
    status: 'active',
    currentStringLogId: 'log-1',
    stringHealthScore: 80,
    gripType: 'pu_overgrip',
    gripBrandModel: 'Yonex Super Grap (Yellow)',
    lastGripChangeDate: '2026-09-02',
    matchesSinceGripChange: 8,
    maxMatchesPerGrip: 8,
    grommetCondition: 'fresh',
    framePaintChipsCount: 0,
    ...overrides,
  };
}

function makeLog(overrides: Partial<StringingLogEntry> = {}): StringingLogEntry {
  return {
    id: 'log-1',
    racketId: 'r-1',
    stringModel: 'Yonex BG80',
    gaugeMm: 0.68,
    mainTensionLbs: 26,
    crossTensionLbs: 26,
    strungAtDate: '2026-08-15',
    outcome: 'active',
    hoursPlayedOnBed: 20,
    matchesPlayedOnBed: 25,
    estimatedEffectiveTensionLbs: 23,
    ...overrides,
  };
}

function makeStore(overrides: Partial<EquipmentStoreState> = {}): EquipmentStoreState {
  return {
    rackets: [makeRacket()],
    stringLogs: [makeLog()],
    consumables: [],
    playerProfiles: {},
    ...overrides,
  };
}

test('todayIsoDate formats the local calendar date, not the UTC date', () => {
  // 23:30 local on Oct 18 must stay Oct 18 regardless of the machine's offset.
  assert.equal(todayIsoDate(new Date(2026, 9, 18, 23, 30)), '2026-10-18');
  assert.equal(todayIsoDate(new Date(2026, 0, 5, 0, 5)), '2026-01-05');
});

test('restringing replaces the active bed and leaves the grip untouched', () => {
  const store = makeStore({
    rackets: [makeRacket({ status: 'needs_restring', stringHealthScore: 0 })],
  });
  const next = restringRacket(
    store,
    {
      racketId: 'r-1',
      stringModel: 'Yonex Exbolt 65',
      gaugeMm: 0.65,
      mainTensionLbs: 27,
      crossTensionLbs: 27,
      strungAtDate: TODAY,
    },
    { today: TODAY, newLogId: 'log-2' }
  );

  const racket = next.rackets[0];
  assert.equal(racket.currentStringLogId, 'log-2');
  assert.equal(racket.status, 'active');
  assert.equal(racket.lastGripChangeDate, '2026-09-02');
  assert.equal(racket.matchesSinceGripChange, 8);
  assert.equal(racket.gripBrandModel, 'Yonex Super Grap (Yellow)');

  const oldLog = next.stringLogs.find((l) => l.id === 'log-1');
  assert.equal(oldLog?.outcome, 'cut_for_fresh_bed');
  assert.equal(oldLog?.brokenOrCutDate, TODAY);
  const newLog = next.stringLogs.find((l) => l.id === 'log-2');
  assert.equal(newLog?.outcome, 'active');
  assert.equal(newLog?.cost, undefined, 'an unrecorded price stays unknown');
});

test('re-wrapping resets only the grip and stamps the given day', () => {
  const next = rewrapRacketGrip(makeStore(), 'r-1', TODAY);
  assert.equal(next.rackets[0].lastGripChangeDate, TODAY);
  assert.equal(next.rackets[0].matchesSinceGripChange, 0);
  assert.equal(next.rackets[0].currentStringLogId, 'log-1');
});

test('marking a string snapped flags the racket and closes its active log on that day', () => {
  const next = markRacketStringSnapped(makeStore(), 'r-1', TODAY);
  assert.equal(next.rackets[0].status, 'needs_restring');
  assert.equal(next.stringLogs[0].outcome, 'snapped');
  assert.equal(next.stringLogs[0].brokenOrCutDate, TODAY);
  assert.equal(markRacketStringSnapped(next, 'missing', TODAY), next);
});

test('shuttle tubes count down to empty and never below zero', () => {
  let store = addShuttleTube(
    makeStore(),
    { brandModel: 'Yonex AS-50', shuttleCount: 2 },
    { playerId: 'p-1', today: TODAY, tubeId: 't-1' }
  );
  store = takeShuttleFromTube(store, 't-1');
  assert.equal(store.consumables[0].statusNote, '1 shuttle left in tube');
  store = takeShuttleFromTube(takeShuttleFromTube(store, 't-1'), 't-1');
  assert.equal(store.consumables[0].hoursOrSessionsUsed, 2);
  assert.equal(store.consumables[0].conditionPercent, 0);
});

test('clearing old logs keeps active beds and other players’ history', () => {
  const store = makeStore({
    rackets: [makeRacket(), makeRacket({ id: 'r-other', playerId: 'p-2' })],
    stringLogs: [
      makeLog(),
      makeLog({ id: 'old', outcome: 'cut_for_fresh_bed', brokenOrCutDate: '2026-08-15' }),
      makeLog({ id: 'other-old', racketId: 'r-other', outcome: 'snapped' }),
    ],
  });
  const next = clearArchivedStringLogs(store, new Set(['r-1']));
  assert.deepEqual(
    next.stringLogs.map((l) => l.id),
    ['log-1', 'other-old']
  );
});

test('average tension is unknown, not zero, when no racket has an active string', () => {
  const index = createEquipmentIndex({
    playerId: 'p-1',
    rackets: [makeRacket({ status: 'needs_restring' })],
    stringLogs: [makeLog({ outcome: 'snapped' })],
    consumables: [],
    referenceDate: TODAY,
  });
  assert.equal(index.summary.meanEffectiveTension, null);
});
