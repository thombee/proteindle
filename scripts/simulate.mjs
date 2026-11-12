// Estimates how hard Proteindle is, by playing it many times with a simulated player.
//
//   node scripts/simulate.mjs            casual and keen players, 3000 games each
//   node scripts/simulate.mjs --answers  also list the hardest answers for a casual player
//
// The player does not know the nutrition figures exactly. Each game they hold a fuzzy
// belief about every food (the true value, off by a random factor), learn the true
// figures of each food they guess, and pick the food that best fits the tiles so far.
// "Casual" beliefs are off by about 35%, "keen" by about 15%. This is a rough model for
// tuning the close bands and the guess limit, not a prediction of real players.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../logic.js');
const { PROTEINDLE_FOODS: FOODS } = require('../foods.js');

// Environment overrides for trying other rules: MAX (guess limit), HINT (guesses before the hint).
const MAX = Number(process.env.MAX) || P.MAX_GUESSES;
const HINT = Number(process.env.HINT) || P.HINT_AFTER;
const answers = FOODS.filter((f) => f.tier === 1);
const rand = (() => { let s = 12345; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const pick = (list) => list[Math.floor(rand() * list.length)];

function play(answer, sigma, useHint = false) {
  const belief = new Map(FOODS.map((f) => [f.id, Object.fromEntries(P.COLUMNS.map((c) => [c.key, f[c.key] * Math.exp(sigma * gauss())]))]));
  const seen = [];
  let guess = pick(answers);
  for (let turn = 1; turn <= MAX; turn++) {
    const g = P.grade(guess, answer);
    if (g.solved) return turn;
    belief.set(guess.id, guess); // the tiles show the guess's true figures
    seen.push({ guess, g });
    // Score every other food by how badly it breaks what the tiles have said.
    let best = [], bestScore = Infinity;
    for (const f of FOODS) {
      if (seen.some((s) => s.guess.id === f.id)) continue;
      // The hint gives the first letter once enough guesses are used, or for free once a
      // guess has matched every tile without being the answer.
      const letter = (useHint && turn >= HINT) || seen.some((s) => P.sameNumbers(s.g));
      if (letter && P.fold(f.name)[0] !== P.fold(answer.name)[0]) continue;
      const b = belief.get(f.id);
      let score = f.tier === 1 ? 0 : 0.15; // slight pull toward everyday foods
      for (const { guess: gu, g: gr } of seen) {
        if ((gr.group.state === 'match') !== (f.group === gu.group)) score += 5;
        gr.cells.forEach((cell, i) => {
          const col = P.COLUMNS[i], v = b[col.key], gv = gu[col.key];
          const want = cell.state;
          const got = P.within(gv, v, col.match) ? 'match' : P.within(gv, v, col.close) ? 'close' : 'far';
          const dir = v > gv ? 'up' : 'down';
          if (want !== 'match' && got !== 'match' && dir !== cell.dir) score += 2;
          else if (want !== got) score += 1;
        });
      }
      if (score < bestScore - 1e-9) { bestScore = score; best = [f]; } else if (Math.abs(score - bestScore) < 1e-9) best.push(f);
    }
    guess = pick(best);
  }
  return 0; // lost
}

function run(label, sigma, games, useHint = false) {
  const dist = new Array(MAX + 1).fill(0);
  const perAnswer = new Map(answers.map((a) => [a.id, { n: 0, lost: 0, turns: 0 }]));
  for (let i = 0; i < games; i++) {
    const a = answers[i % answers.length];
    const t = play(a, sigma, useHint);
    dist[t]++;
    const r = perAnswer.get(a.id); r.n++; if (!t) r.lost++; r.turns += t || MAX + 1;
  }
  const wins = games - dist[0];
  const mean = dist.reduce((s, n, t) => s + n * t, 0) / wins;
  console.log(`${label.padEnd(12)} win ${(100 * wins / games).toFixed(1)}%  mean ${mean.toFixed(2)} guesses  by guess [${dist.slice(1).map((n) => (100 * n / games).toFixed(0) + '%').join(' ')}]  lost ${(100 * dist[0] / games).toFixed(1)}%`);
  return perAnswer;
}

console.log(`${answers.length} answers, ${FOODS.length} guessable foods, ${MAX} guesses, hint after ${HINT}`);
const casual = run('casual', 0.35, 3000);
run('casual+hint', 0.35, 3000, true);
run('keen', 0.15, 3000);
run('keen+hint', 0.15, 3000, true);
if (process.argv.includes('--answers')) {
  const rows = [...casual].map(([id, r]) => ({ id, lost: r.lost / r.n, avg: r.turns / r.n })).sort((x, y) => y.lost - x.lost);
  console.log('\nHardest answers for a casual player (share of games lost, average guesses with a loss counted as 7):');
  for (const r of rows.slice(0, 15)) console.log(`  ${r.id.padEnd(20)} ${(100 * r.lost).toFixed(0).padStart(3)}%  ${r.avg.toFixed(2)}`);
}
