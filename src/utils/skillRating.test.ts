import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SKILL_BASE_RATING,
  computeSkillRatingMap,
  marginMultiplier,
  type SkillMatchInput,
} from './skillRating';

const game = (
  a: string[],
  b: string[],
  scoreA: number,
  scoreB: number
): SkillMatchInput => ({
  winnerSide: scoreA > scoreB ? 'A' : 'B',
  scoreTeamA: scoreA,
  scoreTeamB: scoreB,
  sideA: a,
  sideB: b,
});

test('a first win and loss are symmetric around the base rating', () => {
  const r = computeSkillRatingMap([game(['a', 'b'], ['c', 'd'], 21, 15)]);
  assert.ok(r.get('a')! > SKILL_BASE_RATING);
  assert.equal(r.get('a'), r.get('b'));
  assert.equal(r.get('a')! - SKILL_BASE_RATING, SKILL_BASE_RATING - r.get('c')!);
});

test('a close win moves ratings less than a rout, but is still worth more than a loss', () => {
  const close = computeSkillRatingMap([game(['a'], ['b'], 21, 19)]);
  const rout = computeSkillRatingMap([game(['a'], ['b'], 21, 8)]);
  assert.ok(close.get('a')! > SKILL_BASE_RATING);
  assert.ok(close.get('a')! < rout.get('a')!);
  assert.ok(marginMultiplier(21, 19) < marginMultiplier(21, 8));
});

test('losing to a much stronger pair costs far less than losing to an equal one', () => {
  const history: SkillMatchInput[] = [];
  for (let i = 0; i < 8; i++) history.push(game(['s1', 's2'], ['w1', 'w2'], 21, 10));
  const before = computeSkillRatingMap(history);
  const after = computeSkillRatingMap([...history, game(['s1', 's2'], ['w1', 'w2'], 21, 15)]);
  const expectedLossCost = before.get('w1')! - after.get('w1')!;

  const fresh = computeSkillRatingMap([game(['s1', 's2'], ['w1', 'w2'], 21, 15)]);
  const evenLossCost = SKILL_BASE_RATING - fresh.get('w1')!;
  assert.ok(expectedLossCost < evenLossCost / 2, `${expectedLossCost} vs ${evenLossCost}`);
});

test('a strong player stuck with a weak partner is not dragged down like a weak player', () => {
  const history: SkillMatchInput[] = [];
  for (let i = 0; i < 8; i++) history.push(game(['star', 'p1'], ['x1', 'x2'], 21, 12));
  for (let i = 0; i < 8; i++) history.push(game(['p2', 'weak'], ['x1', 'x2'], 21, 12));
  const before = computeSkillRatingMap(history);
  // Star teams with the weakest player and loses to a strong pair
  const after = computeSkillRatingMap([
    ...history,
    game(['star', 'weak'], ['p1', 'p2'], 15, 21),
  ]);
  assert.ok(after.get('star')! > before.get('star')! - 15);
});

test('ignores undecided, empty or self-overlapping matches', () => {
  const r = computeSkillRatingMap([
    { winnerSide: 'pending', scoreTeamA: 0, scoreTeamB: 0, sideA: ['a'], sideB: ['b'] },
    game([], ['b'], 21, 10),
    game(['a'], ['a'], 21, 10),
  ]);
  assert.equal(r.size, 0);
});

test('order matters only through the caller: the same order gives the same ratings', () => {
  const games = [game(['a'], ['b'], 21, 15), game(['b'], ['a'], 21, 19)];
  assert.deepEqual([...computeSkillRatingMap(games)], [...computeSkillRatingMap(games)]);
});
