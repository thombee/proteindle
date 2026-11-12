// Checks the game rules in logic.js against the real food data.  Run: node --test scripts/test-logic.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../logic.js');
const { PROTEINDLE_FOODS: FOODS, PROTEINDLE_BENCHMARKS: BENCH } = require('../foods.js');
const { PROTEINDLE_SCHEDULE: SCHEDULE } = require('../schedule.js');
const food = (id) => { const f = FOODS.find((x) => x.id === id); assert.ok(f, `no food ${id}`); return f; };

test('a correct guess is solved and every tile matches', () => {
  const g = P.grade(food('lentils'), food('lentils'));
  assert.equal(g.solved, true);
  assert.equal(g.group.state, 'match');
  assert.ok(g.cells.every((c) => c.state === 'match' && c.dir === null));
});

test('arrows point from the guess toward the answer', () => {
  // Guess lentils (9 g protein, 116 kcal, 0.4 g fat); the answer is peanuts (24.4 g, 587 kcal, 49.7 g).
  const g = P.grade(food('lentils'), food('peanuts'));
  assert.equal(g.solved, false);
  assert.equal(g.group.state, 'far');
  const by = Object.fromEntries(g.cells.map((c) => [c.key, c]));
  assert.deepEqual([by.protein.state, by.protein.dir], ['far', 'up']);
  assert.deepEqual([by.kcal.state, by.kcal.dir], ['far', 'up']);
  assert.deepEqual([by.fat.state, by.fat.dir], ['far', 'up']);
  const back = P.grade(food('peanuts'), food('lentils'));
  assert.ok(back.cells.every((c) => c.dir === 'down' || c.state === 'match'));
});

test('bands: match within 5% or the absolute floor, close within 25% or the floor', () => {
  const protein = P.COLUMNS.find((c) => c.key === 'protein');
  assert.equal(P.within(20, 20.9, protein.match), true); // 5% of 20.9 is about 1.05
  assert.equal(P.within(20, 21.2, protein.match), false);
  assert.equal(P.within(20, 26, protein.close), true); // 25% of 26 is 6.5
  assert.equal(P.within(20, 27, protein.close), false);
  assert.equal(P.within(0.3, 0.7, protein.match), true); // tiny values use the 0.5 g floor
  assert.equal(P.within(0.3, 2.2, protein.close), true); // and the 2 g floor
  assert.equal(P.within(0.3, 2.4, protein.close), false);
});

test('a wrong food never grades as solved, even when its numbers match', () => {
  for (const a of FOODS) for (const b of FOODS) if (a !== b) assert.equal(P.grade(a, b).solved, false);
});

test('day numbers follow the local calendar', () => {
  const { year, month, day } = P.EPOCH;
  assert.equal(P.dayNumber(new Date(year, month - 1, day, 0, 0, 1)), 1);
  assert.equal(P.dayNumber(new Date(year, month - 1, day, 23, 59, 59)), 1);
  assert.equal(P.dayNumber(new Date(year, month - 1, day + 1, 0, 0, 0)), 2);
  assert.equal(P.dayNumber(new Date(year + 1, month - 1, day)), 366); // 2026-11-12 to 2027-11-12
  assert.equal(P.dayNumber(new Date(2027, 2, 28, 12)), P.dayNumber(new Date(2027, 2, 27, 12)) + 1); // across a clock change
});

test('the schedule uses every tier 1 food once, never a tier 2 food, and repeats', () => {
  const tier1 = FOODS.filter((f) => f.tier === 1).map((f) => f.id).sort();
  assert.deepEqual([...SCHEDULE].sort(), tier1);
  assert.equal(P.answerId(1, SCHEDULE), SCHEDULE[0]);
  assert.equal(P.answerId(SCHEDULE.length, SCHEDULE), SCHEDULE.at(-1));
  assert.equal(P.answerId(SCHEDULE.length + 1, SCHEDULE), SCHEDULE[0]);
  for (let i = 1; i < SCHEDULE.length; i++) assert.notEqual(food(SCHEDULE[i]).group, food(SCHEDULE[i - 1]).group, `days ${i} and ${i + 1} share a group`);
});

test('search finds foods by name, by a later word, and by another name', () => {
  assert.equal(P.search(FOODS, 'chick')[0].id, 'chickpeas');
  assert.equal(P.search(FOODS, 'garbanzo')[0].id, 'chickpeas');
  assert.ok(P.search(FOODS, 'butter').some((f) => f.id === 'peanut-butter'));
  assert.equal(P.search(FOODS, '').length, FOODS.length);
  assert.equal(P.search(FOODS, 'zzzz').length, 0);
  assert.equal(P.search(FOODS, '  TOFU ')[0].id, 'tofu');
});

test('knowledge keeps the tightest bounds and the group', () => {
  const answer = food('peanuts');
  const grades = [food('lentils'), food('macadamias'), food('cashews')].map((g) => P.grade(g, answer));
  const k = P.knowledge(grades);
  assert.equal(k.group, 'nuts');
  assert.deepEqual(k.ruledOut, ['beans']);
  const protein = k.columns.find((c) => c.key === 'protein');
  assert.equal(protein.more, 15.3); // cashews: the highest guess still below the answer
  assert.equal(protein.less, null);
  const fat = k.columns.find((c) => c.key === 'fat');
  assert.equal(fat.less, 75.8); // macadamias
});

test('every answer has a bonus question whose winner agrees with its numbers', () => {
  for (let day = 1; day <= SCHEDULE.length; day++) {
    const f = food(P.answerId(day, SCHEDULE));
    const q = P.bonusQuestion(f, BENCH, day);
    assert.ok(q, `no bonus question for ${f.id}`);
    assert.notEqual(q.food, q.other);
    assert.equal(q.winner, q.food > q.other ? 'food' : 'other');
    assert.equal(q.food, P.proteinOn(q.basis, f));
    assert.equal(q.other, P.proteinOn(q.basis, q.benchmark));
    assert.deepEqual(P.bonusQuestion(f, BENCH, day), q); // the same for every player
  }
});

test('comparison lists the food with all benchmarks, largest first', () => {
  const rows = P.comparison('gram', food('pumpkin-seeds'), BENCH);
  assert.equal(rows.length, BENCH.length + 1);
  assert.equal(rows.filter((r) => r.mine).length, 1);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].value >= rows[i].value);
  assert.equal(rows.find((r) => r.mine).value, 30.2);
});

test('per-serving and per-calorie figures come from the data', () => {
  const lentils = food('lentils'); // 9 g per 100 g, 116 kcal, serving 198 g
  assert.equal(P.proteinOn('serving', lentils), 17.8);
  assert.equal(P.proteinOn('kcal', lentils), 7.8);
  assert.equal(P.proteinOn('gram', lentils), 9);
});

test('share text shows the pattern and never the food', () => {
  const answer = food('peanuts');
  const guesses = [food('lentils'), food('cashews'), answer];
  const text = P.shareText(7, guesses.map((g) => P.grade(g, answer)), true, { hint: true, bonus: true, url: 'https://example.test' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Proteindle #7 3/6 💡 🎯');
  assert.equal(lines[4], '🟩🟩🟩🟩🟩');
  assert.equal(lines.at(-1), 'https://example.test');
  for (const g of guesses) assert.ok(!text.toLowerCase().includes(g.name.toLowerCase().split(' ')[0]));
  assert.match(P.shareText(7, guesses.slice(0, 2).map((g) => P.grade(g, answer)), false), /^Proteindle #7 X\/6\n/);
});

test('stats: the streak counts days played in a row and a day is only counted once', () => {
  let s = P.emptyStats();
  s = P.recordResult(s, 10, true, 3);
  s = P.recordResult(s, 11, false, 6);
  assert.deepEqual([s.played, s.won, s.streak, s.best], [2, 1, 2, 2]);
  assert.deepEqual(s.dist, [0, 0, 1, 0, 0, 0]);
  assert.equal(P.recordResult(s, 11, true, 2), s); // same day again
  s = P.recordResult(s, 13, true, 6); // skipped day 12
  assert.deepEqual([s.played, s.won, s.streak, s.best], [3, 2, 1, 2]);
  assert.deepEqual(s.dist, [0, 0, 1, 0, 0, 1]);
});
