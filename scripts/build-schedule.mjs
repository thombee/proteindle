// Writes schedule.js: the order in which the tier 1 foods come up as the daily answer.
//
//   node scripts/build-schedule.mjs
//
// The order is fixed by SEED, so running this again gives the same file unless the food
// list changed. After launch, do not regenerate it: that would change answers people have
// already played. Add new foods to the end of schedule.js by hand instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PROTEINDLE_FOODS: FOODS } = require('../foods.js');

const SEED = 20261112;
// The first week is chosen by hand: familiar foods from different groups.
const FIRST = ['pumpkin-seeds', 'lentils', 'tofu', 'oats', 'peanut-butter', 'potato', 'edamame'];

let s = SEED;
const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const tier1 = FOODS.filter((f) => f.tier === 1);
const byId = new Map(tier1.map((f) => [f.id, f]));
for (const id of FIRST) if (!byId.has(id)) throw new Error(`first-week food "${id}" is not a tier 1 food`);

// Deal the rest out so that no two days in a row share a food group: each day takes a
// random food from the group with the most foods left, skipping yesterday's group.
const left = new Map();
for (const f of tier1) {
  if (FIRST.includes(f.id)) continue;
  if (!left.has(f.group)) left.set(f.group, []);
  left.get(f.group).push(f.id);
}
const order = [...FIRST];
let prev = byId.get(FIRST.at(-1)).group;
while ([...left.values()].some((ids) => ids.length)) {
  const open = [...left].filter(([g, ids]) => ids.length && g !== prev);
  const pool = open.length ? open : [...left].filter(([, ids]) => ids.length);
  const most = Math.max(...pool.map(([, ids]) => ids.length));
  const groups = pool.filter(([, ids]) => ids.length === most);
  const [group, ids] = groups[Math.floor(rand() * groups.length)];
  order.push(ids.splice(Math.floor(rand() * ids.length), 1)[0]);
  prev = group;
}

if (new Set(order).size !== tier1.length) throw new Error('schedule does not cover every tier 1 food exactly once');
const repeats = order.filter((id, i) => i > 0 && byId.get(id).group === byId.get(order[i - 1]).group).length;

const out = `/*
 * Proteindle answer schedule: day 1 is the first id, and the list repeats when it runs out.
 * Written by scripts/build-schedule.mjs. Once the game is public, add to the end; do not reorder.
 */
var PROTEINDLE_SCHEDULE = ${JSON.stringify(order, null, 2)};

globalThis.PROTEINDLE_SCHEDULE = PROTEINDLE_SCHEDULE;
if (typeof module !== "undefined" && module.exports) module.exports = { PROTEINDLE_SCHEDULE: PROTEINDLE_SCHEDULE };
`;
fs.writeFileSync(path.join(ROOT, 'schedule.js'), out);
console.log(`build-schedule: wrote schedule.js (${order.length} days, ${repeats} back-to-back days in the same group)`);
