/*
 * Proteindle game rules. No DOM in here: app.js draws the page, this file decides
 * what a guess means. Works as a plain <script> in the browser and via require() in Node.
 */
(function (root) {
  'use strict';

  var MAX_GUESSES = 6;
  // The hint (first letter of the answer) unlocks once this many guesses are used.
  var HINT_AFTER = 4;
  // Day 1 of the schedule, as a local calendar date.
  var EPOCH = { year: 2026, month: 11, day: 12 };

  var GROUPS = {
    beans: { label: 'Beans & lentils', short: 'Beans', emoji: '🫘' },
    soy: { label: 'Soy foods', short: 'Soy', emoji: '🌱' },
    grains: { label: 'Grains & bread', short: 'Grains', emoji: '🌾' },
    nuts: { label: 'Nuts & seeds', short: 'Nuts', emoji: '🥜' },
    veg: { label: 'Vegetables', short: 'Veg', emoji: '🥦' },
    fruit: { label: 'Fruit', short: 'Fruit', emoji: '🍎' },
  };

  // The four numbers a guess is graded on, all per 100 g.
  // A tile is a "match" when the two values differ by no more than the fixed `match`
  // amount. It is "close" when they differ by no more than the absolute or the relative
  // `close` band, whichever allows more; the absolute band stops tiny values (0.3 g of
  // protein against 1.1 g) from counting as far apart.
  var COLUMNS = [
    { key: 'protein', label: 'Protein', unit: 'g', match: { abs: 0.5, rel: 0 }, close: { abs: 2, rel: 0.25 } },
    { key: 'kcal', label: 'Calories', unit: '', match: { abs: 10, rel: 0 }, close: { abs: 25, rel: 0.25 } },
    { key: 'carbs', label: 'Carbs', unit: 'g', match: { abs: 1, rel: 0 }, close: { abs: 3, rel: 0.25 } },
    { key: 'fat', label: 'Fat', unit: 'g', match: { abs: 0.5, rel: 0 }, close: { abs: 2, rel: 0.25 } },
  ];

  function within(a, b, band) {
    return Math.abs(a - b) <= Math.max(band.abs, band.rel * Math.max(a, b)) + 1e-9;
  }

  /*
   * Grade one guess against the answer.
   * Returns { solved, group: {state}, cells: [{key, value, state, dir}] } where state is
   * 'match' | 'close' | 'far' and dir says which way the answer lies from the guess
   * ('up' = the answer has more, 'down' = less, null on a match).
   */
  function grade(guess, answer) {
    var solved = guess.id === answer.id;
    var cells = COLUMNS.map(function (col) {
      var g = guess[col.key], a = answer[col.key];
      var state = solved || within(g, a, col.match) ? 'match' : within(g, a, col.close) ? 'close' : 'far';
      return { key: col.key, value: g, state: state, dir: state === 'match' ? null : a > g ? 'up' : 'down' };
    });
    return { solved: solved, group: { value: guess.group, state: guess.group === answer.group ? 'match' : 'far' }, cells: cells };
  }

  /*
   * True when a guess is the wrong food but every tile matches: the tiles cannot tell the
   * two foods apart, so the game gives the first-letter hint for free.
   */
  function sameNumbers(grade) {
    return !grade.solved && grade.group.state === 'match' && grade.cells.every(function (c) { return c.state === 'match'; });
  }

  // ---- the daily puzzle

  function dayNumber(date) {
    var d = date || new Date();
    var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(EPOCH.year, EPOCH.month - 1, EPOCH.day);
    return Math.round(ms / 864e5) + 1;
  }

  // The schedule is a fixed list of food ids; it repeats once every answer has been used.
  function answerId(day, schedule) {
    var n = schedule.length;
    return schedule[(((day - 1) % n) + n) % n];
  }

  function msUntilTomorrow(date) {
    var d = date || new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime();
  }

  // ---- search

  function fold(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /*
   * Foods matching what the player has typed, best first: names that start with the
   * text, then words that start with it, then aliases, then anything containing it.
   * An empty query returns every food in alphabetical order.
   */
  function search(foods, query) {
    var q = fold(query);
    var scored = [];
    foods.forEach(function (f) {
      var name = fold(f.name), score = -1;
      if (!q) score = 0;
      else if (name.indexOf(q) === 0) score = 0;
      else if ((' ' + name).indexOf(' ' + q) >= 0) score = 1;
      else {
        (f.aliases || []).forEach(function (alias) {
          var a = fold(alias);
          if (a.indexOf(q) === 0 || (' ' + a).indexOf(' ' + q) >= 0) score = score < 0 ? 2 : Math.min(score, 2);
        });
        if (score < 0 && name.indexOf(q) >= 0) score = 3;
      }
      if (score >= 0) scored.push({ food: f, score: score });
    });
    scored.sort(function (x, y) { return x.score - y.score || x.food.name.localeCompare(y.food.name); });
    return scored.map(function (s) { return s.food; });
  }

  // ---- the reveal card

  function round1(x) { return Math.round(x * 10) / 10; }
  function perServing(food) { return food.protein * food.serving.grams / 100; }
  function per100kcal(food) { return food.kcal > 0 ? food.protein / food.kcal * 100 : 0; }

  // The three ways the reveal card measures protein.
  var BASES = [
    { key: 'serving', label: 'Per serving', lead: 'Serving for serving', value: perServing },
    { key: 'gram', label: 'Per 100 g', lead: 'Gram for gram', value: function (f) { return f.protein; } },
    { key: 'kcal', label: 'Per 100 kcal', lead: 'Calorie for calorie', value: per100kcal },
  ];
  function basis(key) {
    for (var i = 0; i < BASES.length; i++) if (BASES[i].key === key) return BASES[i];
    return BASES[0];
  }
  // Protein on one basis, rounded to the one decimal place the card shows.
  function proteinOn(key, food) { return round1(basis(key).value(food)); }

  /*
   * The bonus question shown after the round: which has more protein, today's food or a
   * familiar animal food, measured per serving, per 100 g or per 100 kcal?
   * It prefers match-ups that are a real call (the larger value is 1.1 to 1.8 times the
   * smaller) and rotates through them by day, so every player gets the same question.
   * If nothing is that close, it asks the closest one there is.
   * Returns { basis, benchmark, food, other, winner: 'food' | 'other' }, or null.
   */
  function bonusQuestion(food, benchmarks, day) {
    var all = [];
    BASES.forEach(function (b) {
      var mine = proteinOn(b.key, food);
      benchmarks.forEach(function (bm) {
        var theirs = proteinOn(b.key, bm);
        if (mine === theirs) return;
        var ratio = Math.max(mine, theirs) / Math.max(Math.min(mine, theirs), 0.05);
        if (ratio >= 1.1) all.push({ basis: b.key, benchmark: bm, food: mine, other: theirs, ratio: ratio, winner: mine > theirs ? 'food' : 'other' });
      });
    });
    if (!all.length) return null;
    var fair = all.filter(function (q) { return q.ratio <= 1.8; });
    if (fair.length) return fair[(((day || 0) % fair.length) + fair.length) % fair.length];
    return all.reduce(function (best, q) { return q.ratio < best.ratio ? q : best; });
  }

  /*
   * Bars for the reveal card on one basis: today's food and every animal benchmark,
   * largest first. Every number comes straight from the food data.
   */
  function comparison(key, food, benchmarks) {
    var rows = [{ food: food, value: proteinOn(key, food), mine: true }].concat(benchmarks.map(function (b) {
      return { food: b, value: proteinOn(key, b), mine: false };
    }));
    rows.sort(function (x, y) { return y.value - x.value || (x.mine ? -1 : 1); });
    return rows;
  }

  // Where the food stands among all plant foods in the game for protein per 100 g (1 = most).
  function rank(food, foods) {
    return { place: foods.filter(function (f) { return f.protein > food.protein; }).length + 1, of: foods.length };
  }

  /*
   * What the tiles so far say about the answer, for the summary row above the guesses.
   * group: the answer's group once a guess has matched it, else null (with the groups ruled out).
   * columns: for each number, { about } after a match, else the tightest { more, less } bounds seen.
   */
  function knowledge(grades) {
    var group = null, ruledOut = [];
    grades.forEach(function (g) {
      if (g.group.state === 'match') group = g.group.value;
      else if (ruledOut.indexOf(g.group.value) < 0) ruledOut.push(g.group.value);
    });
    var columns = COLUMNS.map(function (col, i) {
      var k = { key: col.key, about: null, more: null, less: null };
      grades.forEach(function (g) {
        var c = g.cells[i];
        if (c.state === 'match') k.about = c.value;
        else if (c.dir === 'up') k.more = k.more === null ? c.value : Math.max(k.more, c.value);
        else k.less = k.less === null ? c.value : Math.min(k.less, c.value);
      });
      return k;
    });
    return { group: group, ruledOut: ruledOut, columns: columns };
  }

  // ---- sharing and stats

  var SQUARE = { match: '🟩', close: '🟨', far: '⬜' };

  // The result as text. It shows the pattern of each guess and nothing that gives the food away.
  function shareText(day, grades, won, opts) {
    opts = opts || {};
    var lines = grades.map(function (g) {
      return SQUARE[g.group.state] + g.cells.map(function (c) { return SQUARE[c.state]; }).join('');
    });
    var score = (won ? grades.length : 'X') + '/' + MAX_GUESSES;
    var head = 'Proteindle #' + day + ' ' + score + (opts.hint ? ' 💡' : '') + (opts.bonus === true ? ' 🎯' : '');
    var out = [head, ''].concat(lines);
    if (opts.url) out.push('', opts.url);
    return out.join('\n');
  }

  function emptyStats() {
    return { played: 0, won: 0, streak: 0, best: 0, lastDay: 0, dist: [0, 0, 0, 0, 0, 0] };
  }

  /*
   * Record a finished daily round. The streak counts days played in a row, win or lose,
   * so one hard puzzle does not wipe it out. A day that is not later than the last one
   * recorded changes nothing, so a clock set back (or a flight west) cannot count a day twice.
   */
  function recordResult(stats, day, won, guesses) {
    if (day <= stats.lastDay) return stats;
    var s = { played: stats.played + 1, won: stats.won + (won ? 1 : 0), dist: stats.dist.slice(), lastDay: day };
    s.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1;
    s.best = Math.max(stats.best, s.streak);
    if (won) s.dist[guesses - 1]++;
    return s;
  }

  var api = {
    MAX_GUESSES: MAX_GUESSES, HINT_AFTER: HINT_AFTER, EPOCH: EPOCH, GROUPS: GROUPS, COLUMNS: COLUMNS,
    within: within, grade: grade, sameNumbers: sameNumbers, dayNumber: dayNumber, answerId: answerId, msUntilTomorrow: msUntilTomorrow,
    fold: fold, search: search, perServing: perServing, per100kcal: per100kcal,
    BASES: BASES, basis: basis, proteinOn: proteinOn, bonusQuestion: bonusQuestion,
    comparison: comparison, rank: rank, knowledge: knowledge, shareText: shareText,
    emptyStats: emptyStats, recordResult: recordResult,
  };
  root.Proteindle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
