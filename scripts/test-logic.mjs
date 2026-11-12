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

test('bands: match within a fixed amount, close within 25% or a fixed amount', () => {
  const col = Object.fromEntries(P.COLUMNS.map((c) => [c.key, c]));
  // A match is absolute only, however large the numbers.
  assert.equal(P.within(20, 20.5, col.protein.match), true);
  assert.equal(P.within(20, 20.9, col.protein.match), false);
  assert.equal(P.within(500, 510, col.kcal.match), true);
  assert.equal(P.within(500, 512, col.kcal.match), false);
  assert.equal(P.within(60, 61, col.carbs.match), true);
  assert.equal(P.within(60, 61.2, col.carbs.match), false);
  assert.equal(P.within(50, 50.5, col.fat.match), true);
  assert.equal(P.within(50, 50.7, col.fat.match), false);
  assert.equal(P.within(0.3, 0.7, col.protein.match), true);
  // Close is 25% of the larger value, or a fixed floor for small numbers.
  assert.equal(P.within(20, 26, col.protein.close), true); // 25% of 26 is 6.5
  assert.equal(P.within(20, 27, col.protein.close), false);
  assert.equal(P.within(0.3, 2.2, col.protein.close), true); // the 2 g floor
  assert.equal(P.within(0.3, 2.4, col.protein.close), false);
});

test('a wrong food never grades as solved, even when its numbers match', () => {
  for (const a of FOODS) for (const b of FOODS) if (a !== b) assert.equal(P.grade(a, b).solved, false);
});

test('sameNumbers: a wrong food whose group and every number match', () => {
  // Cucumber and iceberg lettuce: both veg, within 0.5 g protein, 10 kcal, 1 g carbs, 0.5 g fat.
  assert.equal(P.sameNumbers(P.grade(food('cucumber'), food('lettuce'))), true);
  assert.equal(P.sameNumbers(P.grade(food('lettuce'), food('lettuce'))), false); // solved, not a twin
  assert.equal(P.sameNumbers(P.grade(food('carrot'), food('lettuce'))), false);
  // Different groups never count, however close the numbers.
  for (const a of FOODS) for (const b of FOODS) {
    if (a.group !== b.group) assert.equal(P.sameNumbers(P.grade(a, b)), false);
  }
});

test('the worked example in the help is a real guess: white rice against pinto beans', () => {
  const g = P.grade(food('white-rice'), food('pinto-beans'));
  assert.equal(g.group.state, 'far');
  assert.deepEqual(g.cells.map((c) => [c.value, c.state, c.dir]), [
    [2.7, 'far', 'up'], [130, 'close', 'up'], [28.2, 'close', 'down'], [0.3, 'match', null],
  ]);
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
  // A day before the last one recorded (the clock went back, or a flight west) changes nothing.
  assert.equal(P.recordResult(s, 12, true, 1), s);
  assert.equal(P.recordResult(s, 1, false, 6), s);
  s = P.recordResult(s, 14, false, 6);
  assert.deepEqual([s.played, s.won, s.streak, s.best], [4, 2, 2, 2]);
});

test('every food name says how the food was measured where it matters', () => {
  // Vegetables eaten both raw and cooked carry their state; ids never change.
  for (const id of ['broccoli', 'spinach', 'kale', 'carrot', 'aubergine', 'sweetcorn', 'parsnip']) {
    assert.match(food(id).name, /\((raw|boiled|baked)\)$/, id);
  }
  assert.match(food('soy-milk').name, /sweetened/);
  assert.equal(P.search(FOODS, 'broccoli')[0].id, 'broccoli');
  assert.equal(P.search(FOODS, 'soy milk')[0].id, 'soy-milk');
});
