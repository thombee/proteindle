#!/usr/bin/env node
// Builds foods.js from the raw USDA FoodData Central downloads and data/picks.json.
//
//   node scripts/build-foods.mjs
//
// Fails (non-zero exit, every problem listed) if any pick does not resolve to
// exactly one source record, if the record's description differs from the one
// recorded in picks.json, if a nutrient is missing, or if a serving that claims
// to come from the record matches none of the record's portions.
// The raw files are treated as untrusted data: they are only JSON-parsed, and
// only numbers are taken from them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');

// Every dataset a pick may name. `file` is relative to data/raw/.
const DATASETS = {
  'SR Legacy': {
    file: 'sr-legacy-2018-04/FoodData_Central_sr_legacy_food_json_2018-04.json',
    key: 'SRLegacyFoods',
    dataType: 'SR Legacy',
    title: 'USDA FoodData Central, SR Legacy',
    release: 'April 2018 (FoodData_Central_sr_legacy_food_json_2018-04)',
  },
  FNDDS: {
    file: 'fndds-2024-10-31/surveyDownload.json',
    key: 'SurveyFoods',
    dataType: 'Survey (FNDDS)',
    title: 'USDA FoodData Central, Food and Nutrient Database for Dietary Studies (FNDDS 2021-2023)',
    release: '2024-10-31 (FoodData_Central_survey_food_json_2024-10-31)',
  },
};

// FoodData Central nutrient ids, with the unit each must be reported in.
const NUTRIENTS = {
  kcal: { id: 1008, unit: 'kcal' }, // Energy
  protein: { id: 1003, unit: 'g' }, // Protein
  carbs: { id: 1005, unit: 'g' }, // Carbohydrate, by difference
  fat: { id: 1004, unit: 'g' }, // Total lipid (fat)
  fibre: { id: 1079, unit: 'g' }, // Fiber, total dietary
};

const GROUPS = ['beans', 'soy', 'grains', 'nuts', 'veg', 'fruit'];
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const errors = [];
const fail = (msg) => errors.push(msg);

const picks = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'picks.json'), 'utf8'));
if (!Array.isArray(picks.foods) || !Array.isArray(picks.benchmarks)) {
  throw new Error('data/picks.json must have "foods" and "benchmarks" arrays');
}

// ---- load only the datasets the picks use, indexed by fdcId (keeping duplicates visible)
const index = {};
const used = new Set([...picks.foods, ...picks.benchmarks].map((p) => p?.source?.dataset));
for (const name of used) {
  const ds = DATASETS[name];
  if (!ds) { fail(`unknown dataset "${name}" in picks.json`); continue; }
  const file = path.join(RAW, ds.file);
  if (!fs.existsSync(file)) {
    throw new Error(`missing raw data ${path.relative(ROOT, file)}; see data/SOURCES.md for the download`);
  }
  const list = JSON.parse(fs.readFileSync(file, 'utf8'))[ds.key];
  if (!Array.isArray(list)) throw new Error(`${ds.file}: no "${ds.key}" array`);
  const byId = new Map();
  for (const rec of list) {
    if (!rec || typeof rec !== 'object') continue;
    const arr = byId.get(rec.fdcId) ?? [];
    arr.push(rec);
    byId.set(rec.fdcId, arr);
  }
  index[name] = byId;
}

function resolve(pick, label) {
  const src = pick.source;
  if (!src || typeof src.fdcId !== 'number' || typeof src.description !== 'string') {
    fail(`${label}: source must have dataset, numeric fdcId and description`);
    return null;
  }
  const byId = index[src.dataset];
  if (!byId) return null; // already reported
  const hits = byId.get(src.fdcId) ?? [];
  if (hits.length !== 1) {
    fail(`${label}: ${src.dataset} fdcId ${src.fdcId} matches ${hits.length} records (need exactly 1)`);
    return null;
  }
  const rec = hits[0];
  if (rec.description !== src.description) {
    fail(`${label}: description mismatch for ${src.fdcId}\n    picks: ${src.description}\n    data:  ${rec.description}`);
    return null;
  }
  if (rec.dataType !== DATASETS[src.dataset].dataType) {
    fail(`${label}: record ${src.fdcId} has dataType "${rec.dataType}", expected "${DATASETS[src.dataset].dataType}"`);
    return null;
  }
  return rec;
}

// A pick may set "fibreMissing": true when its source record has no fibre value.
// The game never grades on fibre, so the food is still playable; fibre is written as null.
function nutrients(rec, label, fibreMissing = false) {
  const out = {};
  for (const [key, { id, unit }] of Object.entries(NUTRIENTS)) {
    const hits = (rec.foodNutrients ?? []).filter((n) => n?.nutrient?.id === id);
    if (key === 'fibre' && fibreMissing) {
      if (hits.length) fail(`${label}: marked fibreMissing but the record has a fibre value; remove the flag`);
      out[key] = null;
      continue;
    }
    if (hits.length !== 1) { fail(`${label}: ${hits.length} values for nutrient ${id} (${key})`); continue; }
    const { amount } = hits[0];
    const gotUnit = hits[0].nutrient.unitName;
    if (gotUnit !== unit) { fail(`${label}: nutrient ${id} in "${gotUnit}", expected "${unit}"`); continue; }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      fail(`${label}: nutrient ${id} (${key}) has no usable amount`);
      continue;
    }
    out[key] = amount;
  }
  if (Object.keys(out).length !== Object.keys(NUTRIENTS).length) return null;
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    kcal: Math.round(out.kcal),
    protein: r1(out.protein),
    carbs: r1(out.carbs),
    fat: r1(out.fat),
    fibre: out.fibre === null ? null : r1(out.fibre),
  };
}

function serving(pick, rec, label) {
  const s = pick.serving;
  if (!s || typeof s.label !== 'string' || !s.label.trim() || typeof s.grams !== 'number' || !(s.grams > 0)) {
    fail(`${label}: serving needs a label and positive grams`);
    return null;
  }
  if (pick.servingSource !== undefined && pick.servingSource !== 'chosen') {
    fail(`${label}: servingSource may only be "chosen"`);
  }
  if (pick.servingSource !== 'chosen') {
    const weights = (rec.foodPortions ?? []).map((p) => p?.gramWeight);
    if (!weights.includes(s.grams)) {
      fail(`${label}: serving ${s.grams} g is not one of the record's portions [${weights.join(', ')}]; mark it "servingSource": "chosen" or fix it`);
    }
  }
  return { label: s.label, grams: s.grams };
}

const ids = new Set();
const names = new Map(); // lower-cased name or alias -> food id
function checkCommon(pick, label) {
  if (typeof pick.id !== 'string' || !ID_RE.test(pick.id)) fail(`${label}: id must be a kebab-case slug`);
  if (ids.has(pick.id)) fail(`${label}: duplicate id`);
  ids.add(pick.id);
  if (typeof pick.name !== 'string' || !pick.name.trim()) fail(`${label}: missing name`);
  if (typeof pick.emoji !== 'string' || !pick.emoji) fail(`${label}: missing emoji`);
}

const foods = [];
for (const [i, pick] of picks.foods.entries()) {
  const label = `foods[${i}] ${pick?.id ?? '?'}`;
  checkCommon(pick, label);
  if (!GROUPS.includes(pick.group)) fail(`${label}: group must be one of ${GROUPS.join(', ')}`);
  if (pick.tier !== 1 && pick.tier !== 2) fail(`${label}: tier must be 1 or 2`);
  if (!Array.isArray(pick.aliases) || pick.aliases.some((a) => typeof a !== 'string' || !a.trim())) {
    fail(`${label}: aliases must be an array of non-empty strings`);
  } else {
    for (const term of [pick.name, ...pick.aliases]) {
      const k = String(term).trim().toLowerCase();
      if (names.has(k) && names.get(k) !== pick.id) fail(`${label}: name/alias "${term}" also used by ${names.get(k)}`);
      names.set(k, pick.id);
    }
  }
  const rec = resolve(pick, label);
  if (!rec) continue;
  if (pick.fibreMissing !== undefined && pick.fibreMissing !== true) fail(`${label}: fibreMissing may only be true`);
  const n = nutrients(rec, label, pick.fibreMissing === true);
  const s = serving(pick, rec, label);
  if (!n || !s) continue;
  foods.push({
    id: pick.id, name: pick.name, aliases: pick.aliases, group: pick.group, emoji: pick.emoji, tier: pick.tier,
    ...n, serving: s, source: { dataset: pick.source.dataset, fdcId: pick.source.fdcId },
  });
}

const benchmarks = [];
for (const [i, pick] of picks.benchmarks.entries()) {
  const label = `benchmarks[${i}] ${pick?.id ?? '?'}`;
  checkCommon(pick, label);
  const rec = resolve(pick, label);
  if (!rec) continue;
  const n = nutrients(rec, label);
  const s = serving(pick, rec, label);
  if (!n || !s) continue;
  benchmarks.push({
    id: pick.id, name: pick.name, emoji: pick.emoji,
    ...n, serving: s, source: { dataset: pick.source.dataset, fdcId: pick.source.fdcId },
  });
}

if (errors.length) {
  console.error(`build-foods: ${errors.length} problem(s), foods.js not written:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

// ---- write foods.js (classic script; works via <script> and require())
const today = new Date().toISOString().slice(0, 10);
const usedSets = [...used].sort().map((n) => ` *   - ${DATASETS[n].title}, release ${DATASETS[n].release}`);
const UNSAFE = new RegExp("[<" + String.fromCharCode(0x2028, 0x2029) + "]", "g"); // keep the output safe inside a <script> and as JS source
const safe = (s) => s.replace(UNSAFE, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
// One record per line keeps the file readable and its diffs small.
const json = (list) => '[\n' + list.map((x) => '  ' + safe(JSON.stringify(x))).join(',\n') + '\n]';
const out = `/*
 * Proteindle food data. GENERATED FILE: do not edit by hand.
 * Regenerate with: node scripts/build-foods.mjs (see data/SOURCES.md).
 *
 * Source: USDA FoodData Central (public domain, https://fdc.nal.usda.gov/):
${usedSets.join('\n')}
 * Curated picks: data/picks.json. Generated: ${today}.
 *
 * Values are per 100 g: kcal (integer), protein, carbs (by difference), fat, fibre (g, 1 dp).
 * fibre is null where the source record has no fibre value.
 */
var PROTEINDLE_FOODS = ${json(foods)};

var PROTEINDLE_BENCHMARKS = ${json(benchmarks)};

globalThis.PROTEINDLE_FOODS = PROTEINDLE_FOODS;
globalThis.PROTEINDLE_BENCHMARKS = PROTEINDLE_BENCHMARKS;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { PROTEINDLE_FOODS: PROTEINDLE_FOODS, PROTEINDLE_BENCHMARKS: PROTEINDLE_BENCHMARKS };
}
`;
fs.writeFileSync(path.join(ROOT, 'foods.js'), out);
const t1 = foods.filter((f) => f.tier === 1).length;
console.log(`build-foods: wrote foods.js (${foods.length} foods, ${t1} tier 1; ${benchmarks.length} benchmarks)`);
