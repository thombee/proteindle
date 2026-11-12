/*
 * Proteindle game rules. No DOM in here: app.js draws the page, this file decides which
 * match-ups a day has and how a round is scored. Works as a plain <script> in the browser
 * and via require() in Node.
 *
 * The game: ten match-ups a day. Each shows two foods in everyday portions, and the
 * player picks the one with more protein.
 */
(function (root) {
  'use strict';

  var ROUNDS = 10;
  // Day 1, as a local calendar date.
  var EPOCH = { year: 2026, month: 11, day: 12 };

  /*
   * The ten slots of a day, in playing order: easy first, close calls last.
   * kind 'animal' puts a plant food against an animal food, 'plant' against another plant.
   */
  var SLOTS = [
    { kind: 'animal', level: 'easy' }, { kind: 'plant', level: 'easy' }, { kind: 'animal', level: 'easy' },
    { kind: 'animal', level: 'medium' }, { kind: 'plant', level: 'medium' }, { kind: 'animal', level: 'medium' }, { kind: 'animal', level: 'medium' },
    { kind: 'plant', level: 'hard' }, { kind: 'animal', level: 'hard' }, { kind: 'animal', level: 'hard' },
  ];
  // How many times the loser's protein the winner has, per level: [at least, less than].
  var LEVELS = { easy: [1.8, 4], medium: [1.35, 1.8], hard: [1.12, 1.35] };
  // A match-up needs a winner with at least this much protein, and at least this much between the two.
  var MIN_WINNER = 4, MIN_GAP = 0.8;

  // Animal foods appear in the serving from the data, and some in a larger portion too:
  // [multiple of that serving, how to say it].
  var LARGER_PORTIONS = {
    'egg': [[2, '2 large eggs'], [3, '3 large eggs']],
    'chicken-breast': [[2, '1 breast']],
    'milk': [[2, '2 cups']],
    'cheddar': [[2, '2 slices']],
    'ham': [[2, '4 slices']],
    'mozzarella': [[2, '2 oz']],
    'steak': [[2, '6 oz']],
    'cod': [[2, '6 oz']],
    'cottage-cheese': [[2, '8 oz']],
  };

  function round1(x) { return Math.round(x * 10) / 10; }

  // One side of a match-up: a food, how much of it, and the protein in that much.
  function portion(food, label, grams) {
    return { food: food, label: label, grams: grams, protein: round1(food.protein * grams / 100) };
  }

  /*
   * The portions a plant food can appear in: the serving from the data, and for servings
   * of one or two ounces, tablespoons or slices, double that as well.
   */
  function plantPortions(food) {
    var s = food.serving, out = [portion(food, s.label, s.grams)];
    var m = /^([12]) (oz|tbsp|slice)\b/.exec(s.label);
    if (m) {
      var n = Number(m[1]) * 2, unit = m[2] === 'slice' ? 'slices' : m[2];
      // "1 oz (23 almonds)" doubles to "2 oz": the count in brackets no longer applies.
      var label = s.label.replace(/^[12] (oz|tbsp|slice)/, n + ' ' + unit).replace(/\s*\(.*\)$/, '');
      out.push(portion(food, label, s.grams * 2));
    }
    return out;
  }

  function animalPortions(food) {
    // "1 slice (1 oz)" is shown as "1 slice": the card gives the weight in grams anyway.
    var out = [portion(food, food.serving.label.replace(/\s*\(.*\)$/, ''), food.serving.grams)];
    (LARGER_PORTIONS[food.id] || []).forEach(function (p) { out.push(portion(food, p[1], food.serving.grams * p[0])); });
    return out;
  }

  // A small seeded random number generator (mulberry32), so a day is the same for everyone.
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rand, list) { return list[Math.floor(rand() * list.length)]; }
  function shuffle(rand, list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /*
   * The ten match-ups for a day. The same day always gives the same list.
   *
   * Each match-up is { kind, level, left, right, winner: 'left' | 'right', times } where
   * left and right are portions and `times` is how many times the loser's protein the
   * winner has. Only everyday plant foods (tier 1 in the data) are used, and no food
   * appears twice in a day.
   *
   * Of the seven plant-versus-animal match-ups, the plant wins two, three, four or five
   * (PLANT_WINS gives the odds), drawn per day. Over time the plant wins half, so "always
   * pick the meat" and "always pick the plant" both score about half, and counting the
   * day's plant wins does not give the last answers away.
   *
   * Plant foods used one day sit out the next. Animal foods are chosen first from those
   * not used in the two days before, then from those not used the day before, and only
   * then from any. So two days running rarely feel alike, and the animal foods that fit
   * few match-ups still turn up often enough. To keep that cheap, days are worked out in
   * blocks of seven: the first day of a block starts fresh (so it can repeat a food from
   * the day before) and each later day builds on the ones before.
   */
  function dailyRounds(day, foods, benchmarks) {
    var first = day - ((((day - 1) % 7) + 7) % 7), history = [];
    for (var d = first; d <= day; d++) history.unshift(buildDay(d, foods, benchmarks, history[0] || [], history[1] || []));
    return history[0];
  }

  // How many of the seven plant-versus-animal match-ups the plant wins: [wins, chance].
  var PLANT_WINS = [[2, 0.15], [3, 0.35], [4, 0.35], [5, 0.15]];

  // The ids of the foods in some days' match-ups, as an object of id: true.
  function idsIn(days) {
    var ids = {};
    days.forEach(function (rounds) { rounds.forEach(function (r) { ids[r.left.food.id] = ids[r.right.food.id] = true; }); });
    return ids;
  }

  /*
   * One day's match-ups, given the match-ups of the day before and the day before that
   * (empty lists at the start of a block).
   */
  function buildDay(day, foods, benchmarks, dayBefore, twoDaysBefore) {
    var rand = rng(Math.imul(day, 2654435761) ^ 0x9e3779b9);
    var plants = [], animals = [];
    foods.forEach(function (f) { if (f.tier === 1) plantPortions(f).forEach(function (p) { plants.push(p); }); });
    benchmarks.forEach(function (b) { animalPortions(b).forEach(function (p) { animals.push(p); }); });

    var animalSlots = SLOTS.filter(function (s) { return s.kind === 'animal'; }).length;
    var wins = PLANT_WINS[PLANT_WINS.length - 1][0], roll = rand();
    for (var w = 0, sum = 0; w < PLANT_WINS.length; w++) {
      sum += PLANT_WINS[w][1];
      if (roll < sum) { wins = PLANT_WINS[w][0]; break; }
    }
    var plantWins = [];
    for (var i = 0; i < animalSlots; i++) plantWins.push(i < wins);
    plantWins = shuffle(rand, plantWins);

    // Foods already in today's match-ups, plus the plant foods from the day before.
    var used = {}, yesterday = idsIn([dayBefore]);
    plants.forEach(function (p) { if (yesterday[p.food.id]) used[p.food.id] = true; });
    // Animal foods to avoid if possible, from most to least restrictive.
    var avoid = [idsIn([dayBefore, twoDaysBefore]), yesterday, {}];

    var rounds = [], animalIndex = 0;
    SLOTS.forEach(function (slot) {
      var wantPlant = slot.kind === 'animal' ? plantWins[animalIndex++] : null, band = LEVELS[slot.level], options = null;
      // Try the slot as specified, then without the fixed winner, then at any closeness;
      // each time avoiding recent animal foods first.
      [[band, wantPlant], [band, null]].forEach(function (want) {
        avoid.forEach(function (skip) { options = options || candidates(slot, want[0], want[1], skip); });
      });
      options = options || candidates(slot, [LEVELS.hard[0], LEVELS.easy[1]], null, {});
      if (!options) throw new Error('no match-up available for day ' + day);
      // Choose one food, then its opponent, so foods with many possible opponents do not
      // dominate. Against an animal food the animal food is chosen first, so each animal
      // food turns up about as often as the others.
      var pairs = options[pick(rand, Object.keys(options).sort())];
      if (slot.kind === 'animal') pairs = pick(rand, groupBy(pairs, 0));
      var pair = pick(rand, pairs);
      used[pair[0].food.id] = used[pair[1].food.id] = true;
      var plantLeft = rand() < 0.5;
      var left = plantLeft ? pair[0] : pair[1], right = plantLeft ? pair[1] : pair[0];
      var hi = Math.max(left.protein, right.protein), lo = Math.min(left.protein, right.protein);
      rounds.push({
        kind: slot.kind, level: slot.level, left: left, right: right,
        winner: left.protein > right.protein ? 'left' : 'right', times: round1(hi / Math.max(lo, 0.1)),
      });
    });
    return rounds;

    /*
     * Valid pairs [plant, opponent] for a slot, grouped by the id of the food chosen first
     * (the animal food in a plant-versus-animal slot, else the plant); null if there are
     * none. Animal foods whose ids are in `skip` are left out.
     */
    function candidates(slot, band, wantPlant, skip) {
      var vsAnimal = slot.kind === 'animal', others = vsAnimal ? animals : plants, out = {}, any = false;
      plants.forEach(function (p) {
        if (used[p.food.id]) return;
        others.forEach(function (o) {
          if (used[o.food.id] || o.food === p.food || (vsAnimal && skip[o.food.id])) return;
          var hi = Math.max(p.protein, o.protein), lo = Math.min(p.protein, o.protein);
          if (hi < MIN_WINNER || hi - lo < MIN_GAP) return;
          var times = hi / Math.max(lo, 0.1);
          if (times < band[0] || times >= band[1]) return;
          if (wantPlant !== null && (p.protein > o.protein) !== wantPlant) return;
          var key = vsAnimal ? o.food.id : p.food.id;
          (out[key] = out[key] || []).push([p, o]);
          any = true;
        });
      });
      return any ? out : null;
    }
  }

  // The pairs grouped by the id of the food at `side` (0 or 1), as a list of groups in id order.
  function groupBy(pairs, side) {
    var groups = {};
    pairs.forEach(function (pr) { (groups[pr[side].food.id] = groups[pr[side].food.id] || []).push(pr); });
    return Object.keys(groups).sort().map(function (id) { return groups[id]; });
  }

  // ---- the calendar

  function dayNumber(date) {
    var d = date || new Date();
    var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day);
    return Math.round(ms / 864e5) + 1;
  }
  function msUntilTomorrow(date) {
    var d = date || new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime();
  }

  // ---- scoring, sharing and stats

  // picks is the list of sides the player chose so far ('left' or 'right'), one per round played.
  function score(rounds, picks) {
    return picks.filter(function (p, i) { return rounds[i] && rounds[i].winner === p; }).length;
  }

  var TITLES = [[10, 'Perfect plate'], [8, 'Protein pro'], [6, 'Well fed'], [4, 'Getting warmer'], [0, 'Tough crowd today']];
  function title(points) {
    for (var i = 0; i < TITLES.length; i++) if (points >= TITLES[i][0]) return TITLES[i][1];
    return TITLES[TITLES.length - 1][1];
  }

  // How the player did on the day's hard match-ups, the closest calls: { right, of }.
  function closeCalls(rounds, picks) {
    var right = 0, of = 0;
    rounds.forEach(function (r, i) {
      if (r.level !== 'hard') return;
      of++;
      if (picks[i] === r.winner) right++;
    });
    return { right: right, of: of };
  }

  // The result as text: a square per round, right or wrong, and nothing about the foods.
  function shareText(day, rounds, picks, url) {
    var squares = rounds.map(function (r, i) { return picks[i] === r.winner ? '🟩' : '🟥'; }).join('');
    var out = ['Proteindle #' + day + ' 🌱 ' + score(rounds, picks) + '/' + rounds.length, squares];
    if (url) out.push(url);
    return out.join('\n');
  }

  function emptyStats() {
    var dist = [];
    for (var i = 0; i <= ROUNDS; i++) dist.push(0);
    return { played: 0, total: 0, streak: 0, best: 0, lastDay: 0, dist: dist };
  }

  /*
   * Record a finished day. `total` is the sum of all scores, for the average. The streak
   * counts days played in a row. A day that is not later than the last one recorded
   * changes nothing, so a clock set back cannot count a day twice.
   */
  function recordResult(stats, day, points) {
    if (day <= stats.lastDay) return stats;
    var s = { played: stats.played + 1, total: stats.total + points, dist: stats.dist.slice(), lastDay: day };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    s.dist[points]++;
    return s;
  }

  var api = {
    ROUNDS: ROUNDS, EPOCH: EPOCH, SLOTS: SLOTS, LEVELS: LEVELS, LARGER_PORTIONS: LARGER_PORTIONS, PLANT_WINS: PLANT_WINS,
    portion: portion, plantPortions: plantPortions, animalPortions: animalPortions, dailyRounds: dailyRounds,
    dayNumber: dayNumber, msUntilTomorrow: msUntilTomorrow,
    score: score, title: title, closeCalls: closeCalls, shareText: shareText,
    emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Proteindle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
