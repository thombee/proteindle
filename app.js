/*
 * Proteindle page. Draws the board, handles input, and keeps the player's progress in
 * localStorage. The rules themselves (grading, schedule, stats, share text) are in logic.js.
 */
(function () {
  'use strict';

  var P = window.Proteindle;
  var FOODS = window.PROTEINDLE_FOODS;
  var BENCH = window.PROTEINDLE_BENCHMARKS;
  var SCHEDULE = window.PROTEINDLE_SCHEDULE;

  // The address added to shared results. Leave empty until the game has a home.
  var SITE_URL = '';
  var STORE_KEY = 'proteindle:v1';

  var byId = {};
  FOODS.forEach(function (f) { byId[f.id] = f; });

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day and saves nothing. It is on for ?day=N and for embedded builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;
  // Time for the five tiles of a new guess to finish flipping (see pd-flip in style.css).
  var FLIP_MS = REDUCED ? 0 : 4 * 140 + 500 + 80;
  var WIN_WORDS = ['First try!', 'Brilliant', 'Impressive', 'Nicely done', 'Got it', 'Phew'];

  function $(id) { return document.getElementById(id); }

  // Build an element. props: class, text, on<event> handlers, anything else is an attribute.
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function fmt(v) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }
  // "1 cup · 198 g". The no-break spaces keep a number and its unit on one line.
  function servingText(s) {
    return /\d\s*g\)/.test(s.label) ? s.label : s.label + ' ·\u00a0' + Math.round(s.grams) + '\u00a0g';
  }
  function ordinal(n) {
    var t = n % 100, u = n % 10;
    return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
  }

  // ---- saved progress

  function emptyStore() {
    return { v: 1, stats: P.emptyStats(), pantry: [], game: null, seenHelp: false, contrast: false };
  }
  // The saved progress, or null if this browser will not let the page read localStorage.
  function readStore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    return parseStore(raw);
  }
  function parseStore(raw) {
    var s = emptyStore();
    try {
      var d = JSON.parse(raw || 'null');
      if (!d || d.v !== 1) return s;
      var st = d.stats || {};
      ['played', 'won', 'streak', 'best', 'lastDay'].forEach(function (k) {
        if (Number.isFinite(st[k]) && st[k] >= 0) s.stats[k] = Math.floor(st[k]);
      });
      if (Array.isArray(st.dist) && st.dist.length === P.MAX_GUESSES) {
        s.stats.dist = st.dist.map(function (n) { return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; });
      }
      if (Array.isArray(d.pantry)) {
        d.pantry.forEach(function (id) { if (byId[id] && s.pantry.indexOf(id) < 0) s.pantry.push(id); });
      }
      if (d.game && Number.isFinite(d.game.day) && Array.isArray(d.game.guesses)) {
        s.game = {
          day: d.game.day,
          guesses: d.game.guesses.filter(function (id) { return typeof id === 'string' && byId[id]; }),
          hint: d.game.hint === true,
          bonus: ['right', 'wrong', 'skip'].indexOf(d.game.bonus) >= 0 ? d.game.bonus : null,
        };
      }
      s.seenHelp = d.seenHelp === true;
      s.contrast = d.contrast === true;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { cannotSave(); }
  }
  // Change one preference. The store is read again first, so the write carries whatever
  // another tab has saved since this one last looked, not this tab's older copy of the game.
  function savePref(key, value) {
    var fresh = readStore();
    if (fresh) store = fresh;
    store[key] = value;
    save();
  }
  var store = readStore();
  if (!store) { store = emptyStore(); cannotSave(); }

  // Shown once, under the board, when the browser will not keep the player's progress.
  function cannotSave() {
    if (PREVIEW) return;
    var note = $('save-note');
    if (!note.hidden) return;
    note.hidden = false;
    $('live').textContent = note.textContent;
  }

  // ---- the current round

  var S = null;

  function today() { return Math.max(1, P.dayNumber()); }

  function startGame(day, persist) {
    var answer = byId[P.answerId(day, SCHEDULE)];
    S = {
      day: day, persist: persist, answer: answer, guesses: [], grades: [],
      hint: false, freeHint: false, bonus: null, done: false, won: false, busy: false,
      bonusQ: P.bonusQuestion(answer, BENCH, day), basis: 'serving',
    };
    if (persist && store.game && store.game.day === day) {
      store.game.guesses.some(function (id) {
        var f = byId[id];
        if (S.guesses.indexOf(f) >= 0 || S.guesses.length >= P.MAX_GUESSES) return true;
        S.guesses.push(f);
        return f.id === answer.id;
      });
      S.hint = store.game.hint;
      S.bonus = store.game.bonus;
    }
    S.grades = S.guesses.map(function (g) { return P.grade(g, answer); });
    // hint: the player asked for it. freeHint: a guess matched every tile, so it came free.
    S.freeHint = S.grades.some(P.sameNumbers);
    S.won = S.grades.some(function (g) { return g.solved; });
    S.done = S.won || S.guesses.length >= P.MAX_GUESSES;
    if (S.bonusQ) S.basis = S.bonusQ.basis;
    $('guess').value = '';
    closeList();
    renderAll();
  }

  function snapshot() {
    store.game = { day: S.day, guesses: S.guesses.map(function (g) { return g.id; }), hint: S.hint, bonus: S.bonus };
    save();
  }

  function submitGuess(food) {
    if (S.done || S.busy) return;
    if (S.guesses.indexOf(food) >= 0) { toast('You already guessed that'); return; }
    var game = S, grade = P.grade(food, S.answer);
    var twin = P.sameNumbers(grade), knewLetter = S.hint || S.freeHint;
    if (twin) S.freeHint = true;
    S.guesses.push(food);
    S.grades.push(grade);
    var over = grade.solved || S.guesses.length >= P.MAX_GUESSES;
    if (over) { S.done = true; S.won = grade.solved; }
    if (S.persist) {
      if (store.pantry.indexOf(food.id) < 0) store.pantry.push(food.id);
      if (over) store.stats = P.recordResult(store.stats, S.day, S.won, S.guesses.length);
      snapshot();
    }
    S.busy = true;
    $('guess').value = '';
    closeList();
    if (TOUCH) $('guess').blur();
    renderBoard(S.guesses.length - 1);
    announce(food, grade);
    setTimeout(function () {
      if (S !== game) return; // the round was replaced while the tiles were flipping
      S.busy = false;
      var row = $('rows').children[S.guesses.length - 1];
      if (row) { row.classList.remove('fresh'); if (S.won) row.classList.add('won'); }
      renderMystery();
      renderEntry();
      if (twin && !over) toast('Same numbers, different food.' + (knewLetter ? '' : ' It starts with ' + firstLetter() + '.'));
      if (over) {
        if (S.won) { toast(WIN_WORDS[S.guesses.length - 1]); celebrate(); }
        renderReveal();
        if (!REDUCED) $('reveal').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, FLIP_MS);
  }

  // A short shower of leaves (and the answer's own emoji) after a win.
  function celebrate() {
    if (REDUCED) return;
    var bits = [S.answer.emoji, '🌱', '🌿', '🍃'];
    var layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (var i = 0; i < 18; i++) {
      layer.appendChild(el('span', {
        text: bits[i % bits.length],
        style: '--x:' + (Math.random() * 96).toFixed(1) + '%;--delay:' + (Math.random() * 0.5).toFixed(2) + 's;--spin:' +
          Math.round(Math.random() * 360 - 180) + 'deg;--time:' + (1.5 + Math.random()).toFixed(2) + 's',
      }));
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 3500);
  }

  // ---- drawing the board

  function mark(cell) {
    if (cell.state === 'match') return '✓';
    return (cell.dir === 'up' ? '▲' : '▼').repeat(cell.state === 'far' ? 2 : 1);
  }
  function spoken(col, cell) {
    var head = col.label + ': ' + fmt(cell.value) + (col.unit ? ' grams. ' : '. ');
    if (cell.state === 'match') return head + 'Match.';
    return head + 'The mystery food has ' + (cell.dir === 'up' ? 'more' : 'less') + (cell.state === 'far' ? ', and is not close.' : ', and is close.');
  }
  function tile(cls, i, label, main, sub) {
    return el('div', { class: 'tile ' + cls, style: '--i:' + i, role: 'img', 'aria-label': label }, [
      el('span', { class: 't-main' }, main),
      sub ? el('span', { class: 't-sub', text: sub }) : null,
    ]);
  }
  function groupTile(key, state) {
    var g = P.GROUPS[key], hit = state === 'match';
    return tile('is-' + state, 0, 'Group: ' + g.label + '. ' + (hit ? 'Match.' : 'Not this group.'), [g.emoji], g.short + (hit ? ' ✓' : ' ✕'));
  }
  function numberMain(col, value) {
    return [fmt(value), col.unit ? el('small', { text: col.unit }) : null];
  }

  function guessRow(food, grade, fresh) {
    var tiles = [groupTile(grade.group.value, grade.group.state)].concat(grade.cells.map(function (cell, i) {
      return tile('is-' + cell.state, i + 1, spoken(P.COLUMNS[i], cell), numberMain(P.COLUMNS[i], cell.value), mark(cell));
    }));
    return el('li', { class: 'row' + (fresh ? ' fresh' : '') }, [
      el('div', { class: 'row-name' }, [el('span', { 'aria-hidden': 'true', text: food.emoji }), food.name]),
      el('div', { class: 'tiles' }, tiles),
    ]);
  }
  function emptyRow() {
    var tiles = [];
    for (var i = 0; i < 5; i++) tiles.push(el('div', { class: 'tile empty' }));
    return el('li', { class: 'row', 'aria-hidden': 'true' }, [el('div', { class: 'tiles' }, tiles)]);
  }

  // freshIndex: the row to animate as a new guess, or -1 for none.
  function renderBoard(freshIndex) {
    var rows = $('rows');
    rows.textContent = '';
    for (var i = 0; i < P.MAX_GUESSES; i++) {
      rows.appendChild(i < S.guesses.length ? guessRow(S.guesses[i], S.grades[i], i === freshIndex) : emptyRow());
    }
  }

  // The top row: what the tiles have told the player so far, or the answer once the round is over.
  function renderMystery() {
    var box = $('mystery'), a = S.answer, tiles;
    box.textContent = '';
    box.className = 'row mystery' + (S.done ? ' solved' : '');
    if (S.done) {
      tiles = [tile('', 0, 'Group: ' + P.GROUPS[a.group].label, [P.GROUPS[a.group].emoji], P.GROUPS[a.group].short)]
        .concat(P.COLUMNS.map(function (col) {
          return tile('', 0, col.label + ': ' + fmt(a[col.key]), numberMain(col, a[col.key]));
        }));
      box.appendChild(el('div', { class: 'row-name' }, [el('span', { 'aria-hidden': 'true', text: a.emoji }), a.name]));
    } else {
      var k = P.knowledge(S.grades);
      var g = k.group ? P.GROUPS[k.group] : null;
      tiles = [g ? tile('known', 0, 'Group: ' + g.label, [g.emoji], g.short) : tile('', 0, 'Group: not known yet', ['?'])]
        .concat(k.columns.map(function (c, i) {
          var col = P.COLUMNS[i];
          if (c.about !== null) return tile('known', 0, col.label + ': about ' + fmt(c.about), ['≈ ' + fmt(c.about)]);
          if (c.more !== null && c.less !== null) {
            return tile('known', 0, col.label + ': between ' + fmt(c.more) + ' and ' + fmt(c.less), [fmt(c.more)], 'to ' + fmt(c.less));
          }
          if (c.more !== null) return tile('known', 0, col.label + ': more than ' + fmt(c.more), ['> ' + fmt(c.more)]);
          if (c.less !== null) return tile('known', 0, col.label + ': less than ' + fmt(c.less), ['< ' + fmt(c.less)]);
          return tile('', 0, col.label + ': not known yet', ['?']);
        }));
      box.appendChild(el('div', { class: 'row-name' }, [
        el('span', { 'aria-hidden': 'true', text: '❓' }), 'Mystery food',
        S.hint || S.freeHint ? el('span', { class: 'tag', text: 'Starts with ' + firstLetter() }) : null,
      ]));
    }
    box.appendChild(el('div', { class: 'tiles' }, tiles));
  }

  function firstLetter() { return S.answer.name.charAt(0).toUpperCase(); }

  function renderEntry() {
    $('entry').hidden = S.done;
    $('count').textContent = 'Guess ' + Math.min(S.guesses.length + 1, P.MAX_GUESSES) + ' of ' + P.MAX_GUESSES;
    $('hint-btn').hidden = S.hint || S.freeHint || S.done || S.guesses.length < P.HINT_AFTER;
  }

  function renderAll() {
    $('day-tag').textContent = '#' + S.day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + S.day;
    renderEntry();
    renderBoard(-1);
    renderMystery();
    renderReveal();
  }

  function announce(food, grade) {
    var parts = [food.name + '.', grade.solved ? 'Correct!' : 'Group: ' + (grade.group.state === 'match' ? 'match.' : 'no match.')];
    if (!grade.solved) grade.cells.forEach(function (c, i) { parts.push(spoken(P.COLUMNS[i], c)); });
    $('live').textContent = parts.join(' ');
  }

  // ---- the food picker

  var shown = [], active = -1;

  function guessed(food) { return S.guesses.indexOf(food) >= 0; }

  function openList() {
    if (S.done) return;
    var input = $('guess'), ul = $('options'), k = P.knowledge(S.grades);
    var typed = P.fold(input.value);
    // A food is still possible if its group has not been ruled out.
    var possible = function (f) { return k.group ? f.group === k.group : k.ruledOut.indexOf(f.group) < 0; };
    shown = P.search(FOODS, input.value);
    if (!typed) shown = shown.filter(possible).concat(shown.filter(function (f) { return !possible(f); }));
    ul.textContent = '';
    shown.forEach(function (f, i) {
      var known = !guessed(f) && store.pantry.indexOf(f.id) >= 0;
      ul.appendChild(el('li', {
        class: 'opt' + (possible(f) ? '' : ' out'), role: 'option', id: 'opt-' + i, 'data-id': f.id,
        'aria-selected': 'false', 'aria-disabled': guessed(f) ? 'true' : null,
      }, [
        el('span', { 'aria-hidden': 'true', text: f.emoji }),
        el('span', { text: f.name }),
        known ? el('span', { class: 'opt-known', title: 'Protein per 100 g, from a food you have tried before', text: fmt(f.protein) + ' g' }) : el('span'),
        el('span', { class: 'opt-group', text: P.GROUPS[f.group].short }),
      ]));
    });
    if (!shown.length) ul.appendChild(el('li', { class: 'opt-none', text: 'No food by that name. Try another word.' }));
    active = typed ? step(-1, 1) : -1;
    ul.hidden = false;
    ul.scrollTop = 0;
    input.setAttribute('aria-expanded', 'true');
    markActive();
  }
  function closeList() {
    $('options').hidden = true;
    $('guess').setAttribute('aria-expanded', 'false');
    $('guess').removeAttribute('aria-activedescendant');
    active = -1;
  }
  // The next food that can still be guessed, moving from index `from` in direction `dir`; -1 if none.
  function step(from, dir) {
    for (var n = 1; n <= shown.length; n++) {
      var i = (((from + dir * n) % shown.length) + shown.length) % shown.length;
      if (!guessed(shown[i])) return i;
    }
    return -1;
  }
  function markActive() {
    var ul = $('options');
    Array.prototype.forEach.call(ul.children, function (li, i) {
      if (li.getAttribute('role') === 'option') li.setAttribute('aria-selected', i === active ? 'true' : 'false');
    });
    if (active >= 0) {
      $('guess').setAttribute('aria-activedescendant', 'opt-' + active);
      ul.children[active].scrollIntoView({ block: 'nearest' });
    } else {
      $('guess').removeAttribute('aria-activedescendant');
    }
  }
  function onKey(e) {
    var ul = $('options');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (ul.hidden) { openList(); return; }
      if (!shown.length) return;
      var dir = e.key === 'ArrowDown' ? 1 : -1;
      active = step(active < 0 && dir < 0 ? 0 : active, dir);
      markActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var typed = P.fold($('guess').value);
      var exact = FOODS.filter(function (f) { return P.fold(f.name) === typed; })[0];
      if (active >= 0 && !ul.hidden) submitGuess(shown[active]);
      else if (typed && exact) submitGuess(exact);
      else toast('Pick a food from the list');
    } else if (e.key === 'Escape') {
      closeList();
    }
  }

  // ---- the reveal card

  function renderReveal() {
    var box = $('reveal');
    box.textContent = '';
    box.hidden = !S.done;
    if (!S.done) return;
    var a = S.answer;
    box.appendChild(el('div', { class: 'rv-head' }, [
      el('div', { class: 'rv-emoji', 'aria-hidden': 'true', text: a.emoji }),
      el('div', {}, [
        el('div', { class: 'rv-kicker', text: S.won ? 'Solved in ' + S.guesses.length + ' of ' + P.MAX_GUESSES : 'Out of guesses. The mystery plant was' }),
        el('h2', { text: a.name }),
      ]),
    ]));
    if (S.bonusQ) box.appendChild(bonusBlock());
    // The facts wait until the bonus is answered or skipped; the line about the next plant does not.
    if (S.bonusQ && !S.bonus) { box.appendChild(nextLine()); tick(); return; }

    box.appendChild(el('div', { class: 'facts' }, [
      fact(fmt(a.protein) + ' g', 'protein per 100\u00a0g'),
      fact(fmt(P.proteinOn('serving', a)) + ' g', 'in ' + servingText(a.serving)),
      fact(fmt(P.proteinOn('kcal', a)) + ' g', 'per 100\u00a0calories'),
    ]));
    box.appendChild(el('div', { class: 'tabs', role: 'group', 'aria-label': 'Compare protein' }, P.BASES.map(function (b) {
      return el('button', {
        type: 'button', 'aria-pressed': b.key === S.basis ? 'true' : 'false', 'data-basis': b.key, text: b.label,
        onclick: function () { showBasis(b.key); },
      });
    })));
    box.appendChild(bars());
    var r = P.rank(a, FOODS);
    box.appendChild(el('p', { class: 'rank', text: 'Protein per 100 g: ' + (r.place === 1 ? 'the' : ordinal(r.place)) + ' highest of the ' + r.of + ' plant foods in the game.' }));
    box.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'primary', type: 'button', text: 'Share result', onclick: share }),
      el('button', { class: 'secondary', type: 'button', text: 'Stats', onclick: openStats }),
    ]));
    box.appendChild(el('pre', { class: 'share-text', id: 'share-text', hidden: true }));
    if (S.persist && store.stats.streak >= 2) {
      box.appendChild(el('p', { class: 'streak', text: '🔥 ' + store.stats.streak + ' days in a row' }));
    }
    box.appendChild(nextLine());
    tick();
  }
  function nextLine() { return el('p', { class: 'next', id: 'next' }); }

  // Switch the comparison basis. Only the bars are replaced, so the pressed tab keeps focus.
  function showBasis(key) {
    S.basis = key;
    Array.prototype.forEach.call(document.querySelectorAll('#reveal .tabs button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-basis') === key ? 'true' : 'false');
    });
    var old = document.querySelector('#reveal .bars');
    if (old) old.replaceWith(bars());
  }

  function fact(big, small) {
    return el('div', { class: 'fact' }, [el('b', { text: big }), el('span', { text: small })]);
  }

  function bonusBlock() {
    var q = S.bonusQ, a = S.answer, answered = !!S.bonus;
    var under = function (food) {
      return q.basis === 'serving' ? servingText(food.serving) : q.basis === 'gram' ? 'per 100 g' : 'per 100 calories';
    };
    // Which side the player picked, worked out from whether they were right.
    var picked = S.bonus === 'right' ? q.winner : S.bonus === 'wrong' ? (q.winner === 'food' ? 'other' : 'food') : null;
    var option = function (side, food, value) {
      return el('button', {
        type: 'button', disabled: answered,
        class: (answered && q.winner === side ? 'winner' : '') + (picked === side ? ' picked' : ''),
        onclick: function () { answerBonus(side); },
      }, [
        food.emoji + ' ' + food.name,
        el('small', { text: under(food) }),
        answered ? el('strong', { text: fmt(value) + ' g' }) : null,
      ]);
    };
    var note = S.bonus === 'right' ? '✓ Right.' : S.bonus === 'wrong' ? '✕ Not this time.' : null;
    return el('div', { class: 'bonus' }, [
      el('p', { class: 'bonus-q' }, [el('span', { text: 'Bonus round' }), P.basis(q.basis).lead + ', which has more protein?']),
      el('div', { class: 'bonus-opts' }, [option('food', a, q.food), option('other', q.benchmark, q.other)]),
      note ? el('p', { class: 'bonus-note', tabindex: '-1', text: note }) : null,
      answered ? null : el('button', { class: 'link-btn', type: 'button', text: 'Skip', onclick: function () { answerBonus(null); } }),
    ]);
  }
  function answerBonus(side) {
    if (S.bonus) return;
    var q = S.bonusQ;
    S.bonus = side === null ? 'skip' : side === q.winner ? 'right' : 'wrong';
    if (S.persist) snapshot();
    renderReveal();
    // The card was rebuilt, so put focus somewhere sensible and say how it went.
    if (S.bonus === 'skip') {
      var tab = document.querySelector('#reveal .tabs button');
      if (tab) tab.focus();
      return;
    }
    var note = document.querySelector('#reveal .bonus-note');
    if (note) note.focus();
    $('live').textContent = (S.bonus === 'right' ? 'Right. ' : 'Not this time. ') +
      S.answer.name + ' ' + fmt(q.food) + ' grams, ' + q.benchmark.name + ' ' + fmt(q.other) + ' grams.';
  }

  function bars() {
    var rows = P.comparison(S.basis, S.answer, BENCH);
    var max = Math.max(rows[0].value, 0.1);
    return el('ul', { class: 'bars' }, rows.map(function (r) {
      return el('li', { class: 'bar-row' + (r.mine ? ' mine' : '') }, [
        el('span', { class: 'bar-name' }, [
          r.food.emoji + ' ' + r.food.name,
          S.basis === 'serving' ? el('small', { text: '  ' + r.food.serving.label }) : null,
        ]),
        el('span', { class: 'bar-val', text: fmt(r.value) + ' g' }),
        el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: 'width:' + Math.max(1.5, r.value / max * 100).toFixed(1) + '%' })]),
      ]);
    }));
  }

  // ---- sharing

  function shareString() {
    return P.shareText(S.day, S.grades, S.won, { hint: S.hint, bonus: S.bonus === 'right', url: SITE_URL });
  }
  function share() {
    var text = shareString();
    var showText = function () {
      var pre = $('share-text');
      pre.textContent = text;
      pre.hidden = false;
      try { window.getSelection().selectAllChildren(pre); } catch (e) { /* the text is still there to copy by hand */ }
      toast('Select the text below to copy it');
    };
    var copy = function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) { showText(); return; }
      navigator.clipboard.writeText(text).then(function () { toast('Copied. Paste it to a friend'); }, showText);
    };
    if (TOUCH && navigator.share) {
      navigator.share({ text: text }).catch(function (err) { if (!err || err.name !== 'AbortError') copy(); });
    } else {
      copy();
    }
  }

  // ---- countdown to the next plant

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var box = $('next');
    if (!box || !S.done) return;
    if (!S.persist) {
      box.textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    if (today() !== S.day) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'A new plant is ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(P.msUntilTomorrow() / 1000);
    box.textContent = 'Next plant in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    var most = Math.max.apply(null, st.dist.concat([1]));
    var todayWon = S.persist && S.won ? S.guesses.length : 0;
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(st.played ? Math.round(100 * st.won / st.played) : 0, 'Win %'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.best, 'Best streak'),
    ]));
    body.appendChild(el('h3', { text: 'Guesses needed' }));
    body.appendChild(el('ol', { class: 'dist' }, st.dist.map(function (n, i) {
      return el('li', {}, [
        String(i + 1),
        el('span', { class: 'dist-bar' + (todayWon === i + 1 ? ' today' : ''), style: 'width:' + Math.max(8, n / most * 100).toFixed(0) + '%', text: String(n) }),
      ]);
    })));
    body.appendChild(el('h3', { text: 'Your pantry' }));
    body.appendChild(el('div', { class: 'pantry-track' }, [
      el('div', { class: 'pantry-fill', style: 'width:' + (100 * store.pantry.length / FOODS.length).toFixed(1) + '%' }),
    ]));
    body.appendChild(el('p', {
      class: 'pantry-note',
      text: 'You have tried ' + store.pantry.length + ' of ' + FOODS.length + ' foods. A food you have tried shows its protein in the list from then on.',
    }));
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so rounds played here are not counted.' }));
    openDialog('stats');
  }
  function num(value, label) {
    return el('div', {}, [el('b', { text: String(value) }), el('span', { text: label })]);
  }

  // ---- dialogs, toast, settings

  function openDialog(id) {
    var d = $(id);
    try { if (!d.open) d.showModal(); } catch (e) { d.setAttribute('open', ''); }
  }
  function closeDialog(d) {
    try { d.close(); } catch (e) { d.removeAttribute('open'); }
  }
  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function applyContrast() {
    if (store.contrast) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast');
    $('contrast').checked = store.contrast;
  }

  // ---- wiring

  $('guess').addEventListener('input', openList);
  $('guess').addEventListener('focus', openList);
  // A click on a box that already has focus fires no focus event, so open the list on click too.
  $('guess').addEventListener('click', function () { if ($('options').hidden) openList(); });
  $('guess').addEventListener('keydown', onKey);
  // Keep the text box focused while the list is clicked, so the list does not close first.
  $('options').addEventListener('mousedown', function (e) { e.preventDefault(); });
  $('options').addEventListener('click', function (e) {
    var li = e.target.closest ? e.target.closest('.opt') : null;
    if (li && byId[li.getAttribute('data-id')]) submitGuess(byId[li.getAttribute('data-id')]);
  });
  document.addEventListener('pointerdown', function (e) {
    if (!e.target.closest || !e.target.closest('.combo')) closeList();
  });
  $('hint-btn').addEventListener('click', function () {
    if (S.done || S.hint || S.freeHint) return;
    S.hint = true;
    if (S.persist) snapshot();
    renderMystery();
    renderEntry();
    toast('It starts with ' + firstLetter());
  });
  $('help-btn').addEventListener('click', function () { openDialog('help'); });
  $('stats-btn').addEventListener('click', openStats);
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) closeDialog(d);
    });
  });
  $('contrast').addEventListener('change', function () {
    savePref('contrast', $('contrast').checked);
    applyContrast();
  });
  $('prev-day').addEventListener('click', function () { if (S.day > 1) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { startGame(S.day + 1, false); });
  // A page left open past midnight moves on to the new day by itself if the round has not
  // been started. A started round stays until it is finished and counts for its own day;
  // once it is finished, the line under the reveal card offers the new plant.
  function rollOver() {
    if (S.persist && !S.done && !S.guesses.length && today() !== S.day) startGame(today(), true);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) rollOver(); });
  setInterval(function () { rollOver(); tick(); }, 1000);

  // Another tab saved progress. Take its copy, so this tab never writes back an older one,
  // and redraw the round if the saved one is not what this tab is showing.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY && e.key !== null) return;
    var fresh = readStore();
    if (!fresh) return;
    store = fresh;
    applyContrast();
    if (!S.persist || !store.game) return;
    var g = store.game;
    if (g.day === S.day) {
      var same = g.guesses.join() === S.guesses.map(function (f) { return f.id; }).join() && g.hint === S.hint && g.bonus === S.bonus;
      if (!same) startGame(S.day, true);
    } else if (g.day === today()) {
      startGame(today(), true);
    }
  });

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
  if (!PREVIEW && !store.seenHelp) {
    savePref('seenHelp', true);
    openDialog('help');
  }
})();
