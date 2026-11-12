#!/usr/bin/env node
// Sanity checks on the generated foods.js:
//   node scripts/check-foods.mjs          summary, energy flags, tier 1 near-duplicates
//   node scripts/check-foods.mjs --table  also print every food's values
// Exits non-zero if any tier 1 near-duplicate pair remains.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PROTEINDLE_FOODS: foods, PROTEINDLE_BENCHMARKS: bench } = require('../foods.js');

const GROUPS = ['beans', 'soy', 'grains', 'nuts', 'veg', 'fruit'];

console.log('Counts (tier 1 / tier 2 / total):');
for (const g of GROUPS) {
  const inG = foods.filter((f) => f.group === g);
  const t1 = inG.filter((f) => f.tier === 1).length;
  console.log(`  ${g.padEnd(7)} ${String(t1).padStart(3)} / ${String(inG.length - t1).padStart(3)} / ${String(inG.length).padStart(3)}`);
}
const t1All = foods.filter((f) => f.tier === 1).length;
console.log(`  ${'all'.padEnd(7)} ${String(t1All).padStart(3)} / ${String(foods.length - t1All).padStart(3)} / ${String(foods.length).padStart(3)}   benchmarks: ${bench.length}`);

// Energy sanity: kcal vs 4P + 4C + 9F, flagged when off by >15% AND >20 kcal.
// (USDA carbs are "by difference" and include fibre, so 4C overstates fibre-rich foods.)
console.log('\nEnergy flags (|kcal - (4P+4C+9F)| > 15% and > 20 kcal):');
let flagged = 0;
for (const f of [...foods, ...bench]) {
  const est = 4 * f.protein + 4 * f.carbs + 9 * f.fat;
  const diff = f.kcal - est;
  if (Math.abs(diff) > 20 && Math.abs(diff) > 0.15 * f.kcal) {
    flagged++;
    console.log(`  ${f.id.padEnd(20)} kcal ${f.kcal}  4/4/9 ${est.toFixed(0)}  diff ${diff.toFixed(0)}  fibre ${f.fibre}  4/4/9 minus 2×fibre ${(est - 2 * f.fibre).toFixed(0)}`);
  }
}
if (!flagged) console.log('  none');

// Tier 1 pairs in the same group the tiles cannot tell apart.
console.log('\nTier 1 near-duplicates (same group, <1 g protein, <15 kcal, <2 g carbs, <1 g fat):');
const t1 = foods.filter((f) => f.tier === 1);
let pairs = 0;
for (let i = 0; i < t1.length; i++) {
  for (let j = i + 1; j < t1.length; j++) {
    const a = t1[i], b = t1[j];
    if (a.group !== b.group) continue;
    if (Math.abs(a.protein - b.protein) < 1 && Math.abs(a.kcal - b.kcal) < 15 &&
        Math.abs(a.carbs - b.carbs) < 2 && Math.abs(a.fat - b.fat) < 1) {
      pairs++;
      console.log(`  ${a.group}: ${a.id} (${a.protein}p ${a.kcal}k ${a.carbs}c ${a.fat}f) ~ ${b.id} (${b.protein}p ${b.kcal}k ${b.carbs}c ${b.fat}f)`);
    }
  }
}
if (!pairs) console.log('  none');

if (process.argv.includes('--table')) {
  console.log('\nid                   grp    t  kcal  prot  carb   fat  fibre  serving');
  for (const f of [...foods].sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || b.protein - a.protein)) {
    const p = (v) => String(v).padStart(5);
    const sp = (f.protein * f.serving.grams / 100).toFixed(1);
    console.log(`${f.id.padEnd(20)} ${f.group.padEnd(6)} ${f.tier} ${p(f.kcal)} ${p(f.protein)} ${p(f.carbs)} ${p(f.fat)} ${p(f.fibre)}  ${f.serving.label} = ${f.serving.grams} g -> ${sp} g protein`);
  }
  console.log('\nbenchmarks:');
  for (const f of bench) {
    console.log(`${f.id.padEnd(20)} ${String(f.kcal).padStart(5)} ${String(f.protein).padStart(5)} ${String(f.carbs).padStart(5)} ${String(f.fat).padStart(5)}  ${f.serving.label} = ${f.serving.grams} g -> ${(f.protein * f.serving.grams / 100).toFixed(1)} g protein`);
  }
}

process.exit(pairs ? 1 : 0);
