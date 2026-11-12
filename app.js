/*
 * Proteindle page. Shows the day's match-ups one at a time, then the score, and keeps the
 * player's progress in localStorage. The rules (which match-ups, scoring, stats, share
 * text) are in logic.js.
 */
(function () {
  'use strict';

  var P = window.Proteindle;
  var FOODS = window.PROTEINDLE_FOODS;
  var BENCH = window.PROTEINDLE_BENCHMARKS;

  // The address added to shared results. Leave empty until the game has a home.
  var SITE_URL = '';
  var STORE_KEY = 'proteindle:v2';

  var root = document.documentElement;
  var forcedDay = parseInt(new URLSearchParams(location.search).get('day'), 10);
  // Preview mode plays any day and saves nothing. It is on for ?day=N and for preview builds.
  var PREVIEW = root.hasAttribute('data-preview') || forcedDay > 0;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;

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
  function portionText(p) { return p.label + ' · ' + Math.round(p.grams) + ' g'; }
  // "🫘 Lentils (cooked), 1 cup" for the recap and for screen readers.
  function sideText(p) { return p.food.name + ', ' + p.label; }

  // ---- saved progress

  function emptyStore() { return { v: 2, stats: P.emptyStats(), game: null, contrast: false }; }
  // The saved progress, or null if this browser will not let the page read localStorage.
  function readStore() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    var s = emptyStore();
    try {
      var d = JSON.parse(raw || 'null');
      if (!d || d.v !== 2) return s;
      var st = d.stats || {};
      ['played', 'total', 'streak', 'best', 'lastDay'].forEach(function (k) {
        if (Number.isFinite(st[k]) && st[k] >= 0) s.stats[k] = Math.floor(st[k]);
      });
      if (Array.isArray(st.dist) && st.dist.length === s.stats.dist.length) {
        s.stats.dist = st.dist.map(function (n) { return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; });
      }
      if (d.game && Number.isFinite(d.game.day) && Array.isArray(d.game.picks)) {
        s.game = {
          day: d.game.day,
          picks: d.game.picks.filter(function (p) { return p === 'left' || p === 'right'; }).slice(0, P.ROUNDS),
        };
      }
      s.contrast = d.contrast === true;
    } catch (e) { /* corrupt: start clean */ }
    return s;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { cannotSave(); }
  }
  // Shown once, under the game, when the browser will not keep the player's progress.
  function cannotSave() {
    var note = $('storage-note');
    if (PREVIEW || !note.hidden) return;
    note.hidden = false;
    $('live').textContent = note.textContent;
  }
  var store = readStore();
  if (!store) { store = emptyStore(); cannotSave(); }

  // ---- the current day's game

  // day, persist (false in preview), rounds, picks ('left' | 'right' per match-up played),
  // revealed (true while the answer to the latest pick is on screen).
  var S = null;

  function today() { return Math.max(1, P.dayNumber()); }

  function startGame(day, persist) {
    S = { day: day, persist: persist, rounds: P.dailyRounds(day, FOODS, BENCH), picks: [], revealed: false };
    if (persist && store.game && store.game.day === day) S.picks = store.game.picks.slice();
    $('day-tag').textContent = '#' + day;
    $('preview-bar').hidden = !PREVIEW;
    $('preview-day').textContent = 'Day ' + day;
    if (finished()) renderResults(false); else renderRound();
  }
  function finished() { return S.picks.length >= P.ROUNDS; }
  function snapshot() {
    store.game = { day: S.day, picks: S.picks.slice() };
    save();
  }

  function samePicks(a, b) {
    return a.length === b.length && a.every(function (p, i) { return p === b[i]; });
  }
  // True if the saved game is for this tab's day and is ahead of this tab or at odds with it.
  function savedIsNewer() {
    var theirs = store.game;
    return !!theirs && theirs.day === S.day && theirs.picks.length >= S.picks.length && !samePicks(theirs.picks, S.picks);
  }

  function choose(side) {
    if (S.revealed || finished()) return;
    if (S.persist) {
      // Read the store again first, so what another tab has saved is not overwritten. If
      // that tab has played this day further, or differently, take its game instead of this pick.
      var fresh = readStore();
      if (fresh) store = fresh;
      if (savedIsNewer()) { startGame(S.day, true); return; }
    }
    S.picks.push(side);
    S.revealed = true;
    if (S.persist) {
      if (finished()) store.stats = P.recordResult(store.stats, S.day, P.score(S.rounds, S.picks));
      snapshot();
    }
    reveal();
  }

  function next() {
    if (!S.revealed) return;
    S.revealed = false;
    if (finished()) { renderResults(true); return; }
    renderRound();
    var first = $('arena').querySelector('.card');
    if (first) first.focus({ preventScroll: true });
  }

  // ---- drawing a match-up

  function renderDots() {
    var dots = $('dots'), at = S.revealed ? S.picks.length - 1 : S.picks.length;
    dots.textContent = '';
    S.rounds.forEach(function (r, i) {
      var state = i < S.picks.length ? (S.picks[i] === r.winner ? 'right' : 'wrong') : '';
      var label = 'Match-up ' + (i + 1) + ': ' + (state || (i === at ? 'now playing' : 'still to come'));
      dots.appendChild(el('li', { class: 'dot ' + state + (i === at && !finished() ? ' now' : ''), 'aria-label': label }, [
        state && el('span', { 'aria-hidden': 'true', text: state === 'right' ? '✓' : '✕' }),
      ]));
    });
  }

  function card(side, p) {
    return el('button', {
      class: 'card', type: 'button', 'data-side': side, 'aria-label': sideText(p) + ', ' + Math.round(p.grams) + ' grams',
      onclick: function () { choose(side); },
    }, [
      el('span', { class: 'c-fill', 'aria-hidden': 'true' }),
      el('span', { class: 'c-emoji', 'aria-hidden': 'true', text: p.food.emoji }),
      el('span', { class: 'c-name', text: p.food.name }),
      el('span', { class: 'c-portion', text: portionText(p) }),
      el('span', { class: 'c-protein', 'aria-hidden': 'true' }, [el('b', { text: '?' }), 'g protein']),
    ]);
  }

  function renderRound() {
    var i = S.picks.length, r = S.rounds[i], arena = $('arena');
    $('play').hidden = false;
    $('results').hidden = true;
    arena.textContent = '';
    arena.appendChild(card('left', r.left));
    arena.appendChild(card('right', r.right));
    arena.appendChild(el('span', { class: 'vs', 'aria-hidden': 'true', text: 'vs' }));
    $('verdict').className = 'verdict hint';
    $('verdict').textContent = 'Match-up ' + (i + 1) + ' of ' + P.ROUNDS + (i === 0 ? '. Tap the one with more protein.' : '');
    $('next-btn').hidden = true;
    renderDots();
  }

  // Count a number up from zero to `to` inside `node`.
  function countUp(node, to) {
    if (REDUCED) { node.textContent = fmt(to); return; }
    var start = null;
    function frame(now) {
      if (start === null) start = now;
      var k = Math.min(1, (now - start) / 650), eased = 1 - Math.pow(1 - k, 3);
      node.textContent = k === 1 ? fmt(to) : (to * eased).toFixed(1);
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Show the answer to the match-up the player has just picked.
  function reveal() {
    var i = S.picks.length - 1, r = S.rounds[i], picked = S.picks[i], right = picked === r.winner;
    var most = Math.max(r.left.protein, r.right.protein);
    Array.prototype.forEach.call($('arena').querySelectorAll('.card'), function (c) {
      var side = c.getAttribute('data-side'), p = r[side], won = side === r.winner;
      c.classList.add(won ? 'win' : 'lose');
      c.setAttribute('aria-disabled', 'true');
      c.setAttribute('aria-label', sideText(p) + ': ' + fmt(p.protein) + ' grams of protein' + (side === picked ? ', your pick' : ''));
      if (side === picked) {
        c.classList.add('picked');
        c.appendChild(el('span', { class: 'c-badge', 'aria-hidden': 'true', text: 'Your pick' }));
      }
      if (won || side === picked) c.appendChild(el('span', { class: 'c-mark', 'aria-hidden': 'true', text: won ? '✓' : '✕' }));
      c.querySelector('.c-fill').style.height = (p.protein / most * 100).toFixed(1) + '%';
      countUp(c.querySelector('.c-protein b'), p.protein);
    });
    var winner = r[r.winner], loser = r[r.winner === 'left' ? 'right' : 'left'];
    var line = (right ? '✓ Right. ' : '✕ Not this time. ') + 'At these portions, ' + winner.food.name + ' has ' + fmt(r.times) + '× the protein.';
    $('verdict').className = 'verdict';
    $('verdict').textContent = line;
    $('live').textContent = (right ? 'Right. ' : 'Not this time. ') + sideText(winner) + ': ' + fmt(winner.protein) + ' grams. ' +
      sideText(loser) + ': ' + fmt(loser.protein) + ' grams.';
    var btn = $('next-btn');
    btn.textContent = finished() ? 'See my score' : 'Next';
    btn.hidden = false;
    btn.focus({ preventScroll: true });
    renderDots();
  }

  // ---- the score card

  function renderResults(justFinished) {
    var box = $('results'), points = P.score(S.rounds, S.picks), close = P.closeCalls(S.rounds, S.picks);
    var closeText = close.right === 0 ? 'none of the ' + close.of : close.right === close.of ? 'all ' + close.of : close.right + ' of the ' + close.of;
    $('play').hidden = true;
    box.hidden = false;
    box.textContent = '';
    renderDots();
    box.appendChild(el('div', { class: 'score-head' }, [
      el('div', { class: 'score', 'aria-label': points + ' out of ' + P.ROUNDS }, [String(points), el('span', { text: '/' + P.ROUNDS })]),
      el('div', {}, [
        el('h2', { class: 'score-title', text: P.title(points) }),
        el('p', { class: 'score-sub', text: 'You got ' + closeText + ' closest calls.' }),
      ]),
    ]));
    box.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'primary', type: 'button', text: 'Share result', onclick: share }),
      el('button', { class: 'secondary', type: 'button', text: 'Stats', onclick: openStats }),
    ]));
    box.appendChild(el('pre', { class: 'share-text', id: 'share-text', hidden: true }));
    if (S.persist && store.stats.streak >= 2 && store.stats.lastDay === S.day) {
      box.appendChild(el('p', { class: 'streak', text: '🔥 ' + store.stats.streak + ' days in a row' }));
    }
    box.appendChild(el('p', { class: 'next', id: 'next' }));
    box.appendChild(el('h3', { text: 'Today’s match-ups' }));
    box.appendChild(el('ol', { class: 'recap' }, S.rounds.map(function (r, i) {
      var right = S.picks[i] === r.winner, winner = r[r.winner], loser = r[r.winner === 'left' ? 'right' : 'left'];
      return el('li', {}, [
        el('span', { class: 'mark ' + (right ? 'right' : 'wrong') }, [
          el('span', { 'aria-hidden': 'true', text: right ? '✓' : '✕' }),
          el('span', { class: 'sr-only', text: right ? 'You were right: ' : 'You were wrong: ' }),
        ]),
        el('span', {}, [
          el('span', { class: 'winner' }, [winner.food.emoji + ' ' + sideText(winner) + ' ', el('b', { text: fmt(winner.protein) + ' g' })]),
          el('br'),
          el('span', { class: 'loser' }, ['beat ' + loser.food.emoji + ' ' + sideText(loser) + ' ', el('b', { text: fmt(loser.protein) + ' g' })]),
        ]),
      ]);
    })));
    tick();
    if (justFinished) {
      $('live').textContent = 'You scored ' + points + ' out of ' + P.ROUNDS + '. ' + P.title(points) + '.';
      if (points >= 8) celebrate();
      box.querySelector('.primary').focus({ preventScroll: true });
      if (!REDUCED) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // A short shower of leaves after a high score.
  function celebrate() {
    if (REDUCED) return;
    var bits = ['🌱', '🌿', '🍃', '🫘', '🥜'];
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

  // ---- sharing

  function share() {
    var text = P.shareText(S.day, S.rounds, S.picks, SITE_URL);
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

  // ---- the clock: countdown to the next day, and moving on when it arrives

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    if (!S.persist) {
      if ($('next')) $('next').textContent = 'Preview: use the arrows at the top to try another day.';
      return;
    }
    var newDay = today() !== S.day;
    // A day nobody has started moves on by itself. One in progress can be finished first.
    if (newDay && !S.picks.length) { startGame(today(), true); return; }
    var box = $('next');
    if (!box || !finished()) return;
    if (newDay) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      box.textContent = 'New match-ups are ready. ';
      box.appendChild(el('button', { class: 'chip-btn', type: 'button', text: 'Play', onclick: function () { startGame(today(), true); } }));
      return;
    }
    var s = Math.floor(P.msUntilTomorrow() / 1000);
    box.textContent = 'New match-ups in ';
    box.appendChild(el('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }));
  }

  // ---- stats

  function openStats() {
    var st = store.stats, body = $('stats-body');
    var most = Math.max.apply(null, st.dist.concat([1]));
    var todayScore = S.persist && finished() && st.lastDay === S.day ? P.score(S.rounds, S.picks) : -1;
    body.textContent = '';
    body.appendChild(el('div', { class: 'nums' }, [
      num(st.played, 'Played'),
      num(st.played ? (st.total / st.played).toFixed(1) : '0', 'Average'),
      num(st.lastDay >= today() - 1 ? st.streak : 0, 'Day streak'),
      num(st.best, 'Best streak'),
    ]));
    body.appendChild(el('h3', { text: 'Your scores' }));
    body.appendChild(el('ol', { class: 'hist', 'aria-label': 'How often you got each score' }, st.dist.map(function (n, i) {
      return el('li', { 'aria-label': i + ' out of ' + P.ROUNDS + ': ' + n + (n === 1 ? ' time' : ' times') }, [
        el('span', { class: 'hist-count', 'aria-hidden': 'true', text: n ? String(n) : '' }),
        el('span', { class: 'hist-bar' + (todayScore === i ? ' today' : ''), style: 'height:' + Math.round(n / most * 64) + 'px' }),
        el('span', { 'aria-hidden': 'true', text: String(i) }),
      ]);
    })));
    if (PREVIEW) body.appendChild(el('p', { class: 'fine', text: 'This is a preview, so days played here are not counted.' }));
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
  function dialogOpen() { return !!document.querySelector('dialog[open]'); }
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

  $('next-btn').addEventListener('click', next);
  // A held Enter or Space key repeats, and focus moves between the cards and Next, so each
  // repeat would play on. Only the first press of a key counts.
  document.addEventListener('keydown', function (e) {
    if (!e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (e.target.closest && e.target.closest('#arena .card, #next-btn')) e.preventDefault();
  }, true);
  // Left and right arrow keys pick a side.
  document.addEventListener('keydown', function (e) {
    if (dialogOpen() || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') choose('left');
    else if (e.key === 'ArrowRight') choose('right');
  });
  $('help-btn').addEventListener('click', function () { openDialog('help'); });
  $('stats-btn').addEventListener('click', openStats);
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) closeDialog(d);
    });
  });
  $('contrast').addEventListener('change', function () {
    // Read the store again first, so this write carries what another tab has saved since.
    var fresh = readStore();
    if (fresh) store = fresh;
    store.contrast = $('contrast').checked;
    save();
    applyContrast();
  });
  $('prev-day').addEventListener('click', function () { if (S.day > 1) startGame(S.day - 1, false); });
  $('next-day').addEventListener('click', function () { startGame(S.day + 1, false); });
  // Another tab saved something: take its copy, and redraw if it has played this day further
  // than this tab, or as far but differently.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY) return;
    var fresh = readStore();
    if (!fresh) return;
    store = fresh;
    applyContrast();
    if (!S.persist) return;
    var theirs = store.game;
    if (theirs && theirs.day > S.day) {
      startGame(today(), true);
    } else if (theirs && theirs.day === S.day) {
      if (savedIsNewer()) startGame(S.day, true);
    } else if (S.picks.length) {
      // Their copy has no trace of this tab's day (it was on an earlier one): put ours back.
      snapshot();
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 1000);

  applyContrast();
  startGame(forcedDay > 0 ? forcedDay : today(), !PREVIEW);
})();
