import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_EQUIPMENT_STORE,
  type EquipmentStoreState,
  getEquipmentStorageKey,
  parseEquipmentStoreState,
  serializeEquipmentStoreState,
} from './equipmentStorage.ts';

const SEED: EquipmentStoreState = {
  rackets: [
    {
      id: 'rkt-test-1',
      playerId: 'plr-test-1',
      nickname: 'Main Racket',
      brand: 'Yonex',
      model: 'Astrox 88D Pro',
      weightSpec: '4U',
      gripSize: 'G5',
      balance: 'head_heavy',
      stiffness: 'stiff',
      status: 'active',
      purchaseDate: '2026-03-14',
      purchasePrice: 259,
      currentStringLogId: 'slog-test-1',
      stringHealthScore: 91,
      gripType: 'pu_overgrip',
      gripBrandModel: 'Yonex Super Grap',
      gripColor: 'White',
      lastGripChangeDate: '2026-10-04',
      matchesSinceGripChange: 5,
      maxMatchesPerGrip: 8,
      grommetCondition: 'fresh',
      framePaintChipsCount: 1,
    },
  ],
  stringLogs: [
    {
      id: 'slog-test-1',
      racketId: 'rkt-test-1',
      stringModel: 'BG80',
      gaugeMm: 0.68,
      mainTensionLbs: 26,
      crossTensionLbs: 28,
      strungAtDate: '2026-10-01',
      stringerName: 'Pro Stringer',
      cost: 22,
      hoursPlayedOnBed: 3,
      matchesPlayedOnBed: 4,
      estimatedEffectiveTensionLbs: 25.5,
      outcome: 'active',
    },
  ],
  consumables: [
    {
      id: 'shuttle-test-1',
      playerId: 'plr-test-1',
      category: 'shuttle_tube',
      brandModel: 'Yonex AS-50',
      acquiredDate: '2026-10-01',
      hoursOrSessionsUsed: 3,
      maxRecommendedHours: 12,
      conditionPercent: 75,
      statusNote: '9/12 left',
    },
  ],
  playerProfiles: {
    'plr-test-1': 'balanced',
  },
};

test('serialization round-trips to the identical string, so cloud echoes are recognised', () => {
  const json = serializeEquipmentStoreState(SEED);
  const reparsed = parseEquipmentStoreState(json);
  assert.ok(reparsed);
  assert.equal(serializeEquipmentStoreState(reparsed), json);
  assert.equal(serializeEquipmentStoreState(SEED), json, 'no timestamps or other volatile fields');
});

test('payloads from another version or with missing collections are rejected, not guessed', () => {
  assert.equal(parseEquipmentStoreState(null), null);
  assert.equal(parseEquipmentStoreState('not json'), null);
  assert.equal(
    parseEquipmentStoreState(JSON.stringify({ version: 2, rackets: [], stringLogs: [], consumables: [] })),
    null
  );
  assert.equal(parseEquipmentStoreState(JSON.stringify({ version: 3, rackets: [] })), null);
  assert.deepEqual(
    parseEquipmentStoreState(serializeEquipmentStoreState(EMPTY_EQUIPMENT_STORE)),
    EMPTY_EQUIPMENT_STORE
  );
});

test('getEquipmentStorageKey scopes localStorage key per account uid and defaults to local', () => {
  assert.equal(getEquipmentStorageKey(null), 'court_gear_locker_v3_local');
  assert.equal(getEquipmentStorageKey(undefined), 'court_gear_locker_v3_local');
  assert.equal(getEquipmentStorageKey('uid_alice'), 'court_gear_locker_v3_uid_alice');
  assert.notEqual(getEquipmentStorageKey('uid_alice'), getEquipmentStorageKey('uid_bob'));
});
