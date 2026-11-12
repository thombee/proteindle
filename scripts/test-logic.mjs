// Checks the game rules in logic.js against the real food data.  Run: node --test scripts/test-logic.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../logic.js');
const { PROTEINDLE_FOODS: FOODS, PROTEINDLE_BENCHMARKS: BENCH } = require('../foods.js');
const food = (id) => { const f = [...FOODS, ...BENCH].find((x) => x.id === id); assert.ok(f, `no food ${id}`); return f; };
const isPlant = (p) => FOODS.includes(p.food);
const DAYS = 730; // two years
const days = Array.from({ length: DAYS }, (_, i) => P.dailyRounds(i + 1, FOODS, BENCH));

test('a portion carries the protein in that much of the food', () => {
  const lentils = food('lentils'); // 9 g protein per 100 g; a cup is 198 g
  assert.deepEqual(P.plantPortions(lentils).map((p) => [p.label, p.grams, p.protein]), [['1 cup', 198, 17.8]]);
  // Ounces, tablespoons and slices can double; the count in brackets is dropped when they do.
  assert.deepEqual(P.plantPortions(food('almonds')).map((p) => p.label), ['1 oz (23 almonds)', '2 oz']);
  assert.deepEqual(P.plantPortions(food('peanut-butter')).map((p) => [p.label, p.grams]), [['2 tbsp', 32], ['4 tbsp', 64]]);
  assert.deepEqual(P.plantPortions(food('white-bread')).map((p) => p.label), ['1 slice', '2 slices']);
  assert.deepEqual(P.plantPortions(food('hemp-seeds')).map((p) => p.label), ['3 tbsp']); // already a big spoonful
  assert.deepEqual(P.animalPortions(food('egg')).map((p) => [p.label, p.grams, p.protein]), [['1 large egg', 50, 6.3], ['2 large eggs', 100, 12.6], ['3 large eggs', 150, 18.9]]);
  assert.deepEqual(P.animalPortions(food('cheddar')).map((p) => p.label), ['1 slice', '2 slices']);
  assert.deepEqual(P.animalPortions(food('greek-yogurt')).map((p) => p.label), ['1 pot']);
});

test('every larger animal portion belongs to a food in the data', () => {
  for (const id of Object.keys(P.LARGER_PORTIONS)) assert.ok(BENCH.some((b) => b.id === id), id);
});

test('a day has ten match-ups in the planned order, the same every time it is asked for', () => {
  for (const [i, rounds] of days.entries()) {
    assert.equal(rounds.length, P.ROUNDS);
    assert.deepEqual(rounds.map((r) => [r.kind, r.level]), P.SLOTS.map((s) => [s.kind, s.level]), `day ${i + 1}`);
    assert.deepEqual(P.dailyRounds(i + 1, FOODS, BENCH), rounds);
  }
});

test('every match-up has a clear, correctly named winner within its level', () => {
  for (const [i, rounds] of days.entries()) {
    for (const r of rounds) {
      const where = `day ${i + 1}: ${r.left.food.id} v ${r.right.food.id}`;
      for (const p of [r.left, r.right]) assert.equal(p.protein, Math.round(p.food.protein * p.grams / 100 * 10) / 10, where);
      const hi = Math.max(r.left.protein, r.right.protein), lo = Math.min(r.left.protein, r.right.protein);
      assert.equal(r.winner, r.left.protein > r.right.protein ? 'left' : 'right', where);
      assert.ok(hi >= 4 && hi - lo >= 0.8, `${where}: too small or too close (${hi} v ${lo})`);
      const [from, to] = P.LEVELS[r.level];
      assert.ok(hi / lo >= from && hi / lo < to, `${where}: ${hi} v ${lo} is outside ${r.level}`);
      assert.equal(r.times, Math.round(hi / lo * 10) / 10, where);
    }
  }
});

test('plant-versus-animal match-ups have one of each, and the plant wins two to five of the seven, half overall', () => {
  const perDay = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const [i, rounds] of days.entries()) {
    for (const r of rounds) {
      const plants = [r.left, r.right].filter(isPlant).length;
      assert.equal(plants, r.kind === 'animal' ? 1 : 2, `day ${i + 1}`);
    }
    const versus = rounds.filter((r) => r.kind === 'animal');
    assert.equal(versus.length, 7);
    perDay[versus.filter((r) => isPlant(r[r.winner])).length]++;
  }
  const share = (n) => perDay[n] / DAYS;
  assert.equal(perDay[0] + perDay[1] + perDay[6] + perDay[7], 0, `plant wins per day: ${perDay}`);
  // The draw is 15%, 35%, 35% and 15%.
  for (const [n, want] of P.PLANT_WINS) assert.ok(Math.abs(share(n) - want) < 0.05, `${n} plant wins on ${(100 * share(n)).toFixed(1)}% of days`);
  const overall = perDay.reduce((sum, days, n) => sum + days * n, 0) / (7 * DAYS);
  assert.ok(Math.abs(overall - 0.5) < 0.02, `plants won ${(100 * overall).toFixed(1)}% overall`);
});

test('every animal food turns up often, none too often, and two days running share few', () => {
  const animalIds = (rounds) => new Set(rounds.flatMap((r) => [r.left, r.right]).filter((p) => !isPlant(p)).map((p) => p.food.id));
  const perDay = days.map(animalIds);
  for (const b of BENCH) {
    const share = perDay.filter((ids) => ids.has(b.id)).length / DAYS;
    assert.ok(share <= 0.55 && share >= 0.12, `${b.id} is on ${(100 * share).toFixed(1)}% of days`);
  }
  let shared = 0, pairs = 0;
  for (let i = 1; i < DAYS; i++) {
    if (i % 7 === 0) continue; // the first day of a block starts fresh
    shared += [...perDay[i]].filter((id) => perDay[i - 1].has(id)).length;
    pairs++;
  }
  assert.ok(shared / pairs < 1.5, `two days running share ${(shared / pairs).toFixed(2)} animal foods on average`);
});

test('neither side of the screen is favoured', () => {
  const all = days.flat();
  const left = all.filter((r) => r.winner === 'left').length / all.length;
  assert.ok(left > 0.45 && left < 0.55, `left wins ${(100 * left).toFixed(1)}%`);
  const plantLeft = all.filter((r) => r.kind === 'animal' && isPlant(r.left)).length / all.filter((r) => r.kind === 'animal').length;
  assert.ok(plantLeft > 0.45 && plantLeft < 0.55, `the plant is on the left ${(100 * plantLeft).toFixed(1)}% of the time`);
});

test('only everyday plant foods appear, none twice in a day, and none two days running within a week block', () => {
  for (const [i, rounds] of days.entries()) {
    const sides = rounds.flatMap((r) => [r.left, r.right]);
    const ids = sides.map((p) => p.food.id);
    assert.equal(new Set(ids).size, ids.length, `day ${i + 1} repeats a food`);
    for (const p of sides.filter(isPlant)) assert.equal(p.food.tier, 1, `${p.food.id} is not an everyday food`);
    if (i % 7 !== 0) {
      const before = new Set(days[i - 1].flatMap((r) => [r.left, r.right]).filter(isPlant).map((p) => p.food.id));
      for (const p of sides.filter(isPlant)) assert.ok(!before.has(p.food.id), `day ${i + 1} repeats ${p.food.id} from the day before`);
    }
  }
});

test('the game draws on a wide range of foods', () => {
  const used = new Set(days.flat().flatMap((r) => [r.left.food.id, r.right.food.id]));
  assert.ok(BENCH.every((b) => used.has(b.id)), 'every animal food is used');
  assert.ok(FOODS.filter((f) => f.tier === 1 && used.has(f.id)).length >= 70, 'at least 70 plant foods are used');
});

test('day numbers follow the local calendar', () => {
  const { year, month, day } = P.EPOCH;
  assert.equal(P.dayNumber(new Date(year, month - 1, day, 0, 0, 1)), 1);
  assert.equal(P.dayNumber(new Date(year, month - 1, day, 23, 59, 59)), 1);
  assert.equal(P.dayNumber(new Date(year, month - 1, day + 1, 0, 0, 0)), 2);
  assert.equal(P.dayNumber(new Date(year + 1, month - 1, day)), 366);
  assert.equal(P.dayNumber(new Date(2027, 2, 28, 12)), P.dayNumber(new Date(2027, 2, 27, 12)) + 1); // across a clock change
  assert.equal(P.msUntilTomorrow(new Date(2026, 10, 12, 23, 59, 0)), 60000);
});

test('score, title and share text', () => {
  const rounds = days[0];
  const picks = rounds.map((r, i) => (i < 7 ? r.winner : r.winner === 'left' ? 'right' : 'left'));
  assert.equal(P.score(rounds, picks), 7);
  assert.equal(P.score(rounds, picks.slice(0, 3)), 3);
  assert.equal(P.shareText(12, rounds, picks, ''), 'Proteindle #12 🌱 7/10\n🟩🟩🟩🟩🟩🟩🟩🟥🟥🟥');
  assert.equal(P.shareText(12, rounds, picks, 'https://example.test').split('\n').at(-1), 'https://example.test');
  const text = P.shareText(12, rounds, picks, '').toLowerCase();
  for (const r of rounds) for (const p of [r.left, r.right]) assert.ok(!text.includes(p.food.name.toLowerCase()), 'share text names no food');
  assert.deepEqual(P.closeCalls(rounds, picks), { right: 0, of: 3 }); // the last three are the hard ones
  assert.deepEqual(P.closeCalls(rounds, rounds.map((r) => r.winner)), { right: 3, of: 3 });
  assert.deepEqual(P.closeCalls(rounds, picks.slice(0, 8)), { right: 0, of: 3 });
  assert.deepEqual([10, 9, 8, 7, 6, 5, 4, 3, 0].map(P.title), ['Perfect plate', 'Protein pro', 'Protein pro', 'Well fed', 'Well fed', 'Getting warmer', 'Getting warmer', 'Tough crowd today', 'Tough crowd today']);
});

test('stats: the streak counts days played in a row, and a day is never counted twice', () => {
  let s = P.emptyStats();
  assert.equal(s.dist.length, 11);
  s = P.recordResult(s, 10, 7);
  s = P.recordResult(s, 11, 4);
  assert.deepEqual([s.played, s.total, s.streak, s.best, s.lastDay], [2, 11, 2, 2, 11]);
  assert.equal(s.dist[7], 1);
  assert.equal(s.dist[4], 1);
  assert.equal(P.recordResult(s, 11, 10), s); // the same day again
  assert.equal(P.recordResult(s, 10, 10), s); // an earlier day, after the clock was set back
  s = P.recordResult(s, 13, 10); // day 12 was missed
  assert.deepEqual([s.played, s.total, s.streak, s.best], [3, 21, 1, 2]);
});
