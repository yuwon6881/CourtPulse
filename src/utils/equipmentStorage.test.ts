import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_EQUIPMENT_STORE,
  getEquipmentStorageKey,
  parseEquipmentStoreState,
  serializeEquipmentStoreState,
} from './equipmentStorage.ts';
import {
  INITIAL_CONSUMABLES,
  INITIAL_PLAYER_PROFILES,
  INITIAL_RACKETS,
  INITIAL_STRING_LOGS,
} from '../data/seedEquipment.ts';

const SEED = {
  rackets: INITIAL_RACKETS,
  stringLogs: INITIAL_STRING_LOGS,
  consumables: INITIAL_CONSUMABLES,
  playerProfiles: INITIAL_PLAYER_PROFILES,
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
