// Plays the game in a real browser (headless) and checks what a player would see.
//
//   npm run e2e                     run the checks in your installed Google Chrome
//   BROWSER=webkit npm run e2e      ... in Playwright's WebKit build (Safari's engine)
//   BROWSER=firefox npm run e2e     ... in Playwright's Firefox build
//   SHOTS=/some/dir npm run e2e     also save screenshots of each stage there
//
// Needs `npm install` once (playwright-core), and Google Chrome or, for the other engines,
// `npx playwright-core install webkit firefox`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium, webkit, firefox } from 'playwright-core';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = require('../logic.js');
const { PROTEINDLE_FOODS: FOODS, PROTEINDLE_BENCHMARKS: BENCH } = require('../foods.js');
const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// A static file server for the repo, so the page has a normal origin for storage and the clipboard.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

const ENGINES = {
  chrome: { name: 'Google Chrome', launch: () => chromium.launch({ channel: 'chrome' }), install: 'Install Google Chrome' },
  webkit: { name: "Playwright's WebKit", launch: () => webkit.launch(), install: 'Run: npx playwright-core install webkit' },
  firefox: { name: "Playwright's Firefox", launch: () => firefox.launch(), install: 'Run: npx playwright-core install firefox' },
};
const ENGINE = (process.env.BROWSER || 'chrome').toLowerCase();
if (!ENGINES[ENGINE]) {
  console.error(`BROWSER=${ENGINE} is not one of: ${Object.keys(ENGINES).join(', ')}`);
  process.exit(2);
}
let browser;
try {
  browser = await ENGINES[ENGINE].launch();
} catch (err) {
  const missing = /Executable doesn't exist|not found|install/i.test(String(err.message));
  console.error(missing ? `${ENGINES[ENGINE].name} is not installed. ${ENGINES[ENGINE].install}` : `Could not start ${ENGINES[ENGINE].name}:\n${err.message}`);
  server.close();
  process.exit(2);
}
console.log(`browser: ${ENGINES[ENGINE].name} ${browser.version()}\n`);
const results = [];

// Clipboard permissions can only be granted in Chrome. In WebKit and Firefox a test page cannot
// read the clipboard back, so there the harness swaps in a stand-in clipboard that records what
// the game copies. This is a limit of the test harness, not of the game.
function stubClipboard() {
  let copied = '';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t) => { copied = String(t); return Promise.resolve(); }, readText: () => Promise.resolve(copied) },
  });
}
// Every read and write of localStorage throws, as in a browser with site data blocked.
function blockStorage() {
  const no = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  Storage.prototype.getItem = no;
  Storage.prototype.setItem = no;
}
// This tab hears no storage events from other tabs, as if it had missed them.
function deafToOtherTabs() {
  window.addEventListener('storage', (e) => e.stopImmediatePropagation(), true);
}

async function newContext(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    ...(ENGINE === 'chrome' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}), ...opts.context,
  });
  if (ENGINE !== 'chrome') await ctx.addInitScript(stubClipboard);
  for (const script of opts.scripts ?? []) await ctx.addInitScript(script);
  return ctx;
}
// Another tab in the same browser profile, sharing localStorage.
async function openTab(ctx, url, opts = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const script of opts.scripts ?? []) await page.addInitScript(script);
  if (opts.time) await page.clock.setFixedTime(new Date(opts.time));
  await page.goto(BASE + url);
  return { page, errors };
}
async function open(url, opts = {}) {
  const ctx = await newContext(opts);
  const { page, errors } = await openTab(ctx, url, { time: opts.time });
  return { ctx, page, errors };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); };
const toastText = (page) => page.$eval('#toast', (t) => (t.classList.contains('show') ? t.textContent : ''));
// Press the share button and return the text it copied (or showed, if copying failed).
async function sharedText(page) {
  await page.click('.actions .primary');
  await page.waitForFunction(() => document.querySelector('#toast').classList.contains('show') && /Copied|Select/.test(document.querySelector('#toast').textContent));
  return (await toastText(page)).startsWith('Copied') ? page.evaluate(() => navigator.clipboard.readText()) : page.textContent('#share-text');
}
const saved = async (page) => JSON.parse(await page.evaluate(() => localStorage.getItem('proteindle:v2')));
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const other = (side) => (side === 'left' ? 'right' : 'left');
const cardNames = (page) => page.$$eval('#arena .card .c-name', (els) => els.map((e) => e.textContent));
const dots = (page) => page.$$eval('#dots .dot', (els) => els.map((e) => (e.classList.contains('right') ? 'R' : e.classList.contains('wrong') ? 'W' : '.')).join(''));
// Pick a side in the match-up on screen and wait for the answer to show.
async function pick(page, side) {
  await page.click(`#arena .card[data-side="${side}"]`);
  await page.waitForSelector('#next-btn:not([hidden])');
}
// Play match-ups from the one on screen to the end. `plan(round, index)` returns the side to pick.
async function playFrom(page, rounds, from, plan) {
  for (let i = from; i < rounds.length; i++) {
    await pick(page, plan(rounds[i], i));
    await page.click('#next-btn');
  }
  await page.waitForSelector('#results:not([hidden])');
}
const noSidewaysScroll = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 0, `${label}: page is ${over}px wider than the screen`);
  const clipped = await page.$$eval('.card .c-name, .card .c-portion, .card .c-protein b', (els) => els.filter((e) => e.scrollWidth > e.closest('.card').clientWidth).map((e) => e.textContent));
  assert.deepEqual(clipped, [], `${label}: card text wider than its card`);
  // The "vs" badge covers no card text.
  const covered = await page.evaluate(() => {
    const vs = document.querySelector('#arena .vs');
    if (!vs || !vs.offsetParent) return [];
    const a = vs.getBoundingClientRect();
    return [...document.querySelectorAll('#arena .card .c-name, #arena .card .c-portion, #arena .card .c-protein')].filter((e) => {
      const b = e.getBoundingClientRect();
      return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    }).map((e) => e.textContent);
  });
  assert.deepEqual(covered, [], `${label}: the vs badge covers card text`);
};

async function check(name, fn) {
  try { await fn(); results.push([name, null]); console.log(`ok    ${name}`); }
  catch (err) { results.push([name, err]); console.log(`FAIL  ${name}\n      ${String(err.message).split('\n').join('\n      ')}`); }
}

const DAY1 = '2026-11-12T10:00:00', DAY2 = '2026-11-13T10:00:00';
const R1 = P.dailyRounds(1, FOODS, BENCH), R2 = P.dailyRounds(2, FOODS, BENCH);

await check('a full day: right and wrong picks, the score card, sharing, stats and a reload', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: DAY1 });
  assert.equal(await page.textContent('#day-tag'), '#1');
  assert.equal(await page.$('dialog[open]'), null, 'no dialog gets in the way of the first match-up');
  assert.equal(await page.isHidden('#preview-bar'), true);
  assert.deepEqual(await cardNames(page), [R1[0].left.food.name, R1[0].right.food.name]);
  assert.equal(await dots(page), '..........');
  assert.match(await page.textContent('#verdict'), /^Match-up 1 of 10\. Tap the one with more protein\.$/);
  assert.equal(await page.isHidden('#next-btn'), true);
  await page.waitForTimeout(600); // let the cards finish sliding in before the picture
  await shot(page, '01-matchup');

  // A right pick.
  await pick(page, R1[0].winner);
  assert.equal(await page.textContent('#verdict'), `✓ Right. At these portions, ${R1[0][R1[0].winner].food.name} has ${fmt(R1[0].times)}× the protein.`);
  const win = R1[0][R1[0].winner], lose = R1[0][other(R1[0].winner)];
  await page.waitForFunction((want) => document.querySelector('#arena .card.win .c-protein b').textContent === want, fmt(win.protein));
  assert.equal(await page.textContent('#arena .card.lose .c-protein b'), fmt(lose.protein));
  assert.equal(await page.$eval('#arena .card.win', (c) => c.classList.contains('picked')), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'next-btn', 'focus moves to Next');
  assert.equal(await dots(page), 'R.........');
  await shot(page, '02-right');

  // Picking again changes nothing.
  await page.click(`#arena .card[data-side="${other(R1[0].winner)}"]`, { force: true });
  assert.equal((await saved(page)).game.picks.length, 1);

  // A wrong pick.
  await page.click('#next-btn');
  assert.deepEqual(await cardNames(page), [R1[1].left.food.name, R1[1].right.food.name]);
  assert.match(await page.textContent('#verdict'), /^Match-up 2 of 10$/);
  await pick(page, other(R1[1].winner));
  assert.match(await page.textContent('#verdict'), /^✕ Not this time\. At these portions, .+ has [\d.]+× the protein\.$/);
  assert.equal(await page.$eval('#arena .card.lose', (c) => c.classList.contains('picked')), true);
  assert.equal(await dots(page), 'RW........');
  await page.waitForTimeout(800);
  await shot(page, '03-wrong');
  await page.click('#next-btn');

  // Leaving and coming back mid-way picks up at the next match-up.
  await pick(page, R1[2].winner);
  await page.reload();
  assert.equal(await dots(page), 'RWR.......');
  assert.deepEqual(await cardNames(page), [R1[3].left.food.name, R1[3].right.food.name]);

  // The rest, all right.
  for (let i = 3; i < 10; i++) {
    await pick(page, R1[i].winner);
    assert.equal(await page.textContent('#next-btn'), i === 9 ? 'See my score' : 'Next');
    await page.click('#next-btn');
  }
  await page.waitForSelector('#results:not([hidden])');
  assert.equal(await page.isHidden('#play'), true);
  assert.equal((await page.textContent('.score')).trim(), '9/10');
  assert.equal(await page.textContent('.score-title'), P.title(9));
  assert.equal(await page.textContent('.score-sub'), 'You got all 3 closest calls.');
  assert.equal(await page.$$eval('.recap li', (l) => l.length), 10);
  assert.equal(await page.$$eval('.recap .mark.wrong', (l) => l.length), 1);
  assert.equal(await dots(page), 'RWRRRRRRRR');
  assert.match(await page.textContent('#next'), /New match-ups in \d\d:\d\d:\d\d/);
  await page.waitForTimeout(600);
  await shot(page, '04-score');
  await noSidewaysScroll(page, 'score card at 390px');

  // Sharing copies the pattern and the score, and no food names.
  const picks = R1.map((r, i) => (i === 1 ? other(r.winner) : r.winner));
  const text = await sharedText(page);
  assert.equal(text, P.shareText(1, R1, picks, ''));
  assert.equal(text, 'Proteindle #1 🌱 9/10\n🟩🟥🟩🟩🟩🟩🟩🟩🟩🟩');

  await page.click('#stats-btn');
  assert.deepEqual(await page.$$eval('#stats .nums b', (b) => b.map((x) => x.textContent)), ['1', '9.0', '1', '1']);
  assert.equal(await page.$$eval('#stats .hist-bar.today', (b) => b.length), 1);
  await shot(page, '05-stats');
  await page.click('#stats .close');

  // Coming back later the same day shows the score card again, and nothing is counted twice.
  await page.reload();
  assert.equal(await page.isVisible('#results'), true);
  assert.equal((await page.textContent('.score')).trim(), '9/10');
  assert.equal((await saved(page)).stats.played, 1);

  // The next day: new match-ups. Get them all wrong.
  await page.clock.setFixedTime(new Date(DAY2));
  await page.reload();
  assert.equal(await page.textContent('#day-tag'), '#2');
  assert.equal(await dots(page), '..........');
  await playFrom(page, R2, 0, (r) => other(r.winner));
  assert.equal((await page.textContent('.score')).trim(), '0/10');
  assert.equal(await page.textContent('.score-title'), P.title(0));
  assert.equal(await page.textContent('.score-sub'), 'You got none of the 3 closest calls.');
  assert.equal(await page.textContent('.streak'), '🔥 2 days in a row');
  await page.click('#stats-btn');
  assert.deepEqual(await page.$$eval('#stats .nums b', (b) => b.map((x) => x.textContent)), ['2', '4.5', '2', '2']);
  await page.click('#stats .close');

  assert.deepEqual(errors, [], 'no errors in the browser console');
  await ctx.close();
});

await check('the keyboard alone can play', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: DAY1 });
  await page.keyboard.press(R1[0].winner === 'left' ? 'ArrowLeft' : 'ArrowRight');
  await page.waitForSelector('#next-btn:not([hidden])');
  assert.equal(await dots(page), 'R.........');
  await page.keyboard.press('Enter'); // Next has the focus
  assert.deepEqual(await cardNames(page), [R1[1].left.food.name, R1[1].right.food.name]);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-side')), 'left', 'focus moves to the first card');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter'); // the right-hand card
  await page.waitForSelector('#next-btn:not([hidden])');
  assert.equal((await saved(page)).game.picks[1], 'right');
  // With a dialog open, the arrow keys do not pick.
  await page.keyboard.press('Enter');
  await page.click('#help-btn');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await saved(page)).game.picks.length, 2);
  await shot(page, '06-help');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('holding Enter down makes one move, not several', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: DAY1 });
  await page.focus('#arena .card[data-side="left"]');
  // After the first, each keyboard.down of a key still held is sent with repeat: true.
  for (let i = 0; i < 6; i++) await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  assert.deepEqual((await saved(page)).game.picks, ['left']);
  assert.equal(await page.isVisible('#next-btn'), true, 'the answer to the first match-up is still on screen');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'next-btn');
  // A fresh press moves on.
  await page.keyboard.press('Enter');
  assert.deepEqual(await cardNames(page), [R1[1].left.food.name, R1[1].right.food.name]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('preview mode plays any day and saves nothing', async () => {
  const { ctx, page, errors } = await open('/index.html?day=5', { time: DAY1 });
  const R5 = P.dailyRounds(5, FOODS, BENCH);
  assert.equal(await page.isVisible('#preview-bar'), true);
  assert.equal(await page.textContent('#preview-day'), 'Day 5');
  assert.deepEqual(await cardNames(page), [R5[0].left.food.name, R5[0].right.food.name]);
  await pick(page, R5[0].winner);
  await page.click('#next-day');
  assert.equal(await page.textContent('#preview-day'), 'Day 6');
  assert.equal(await dots(page), '..........');
  await page.click('#prev-day');
  await page.click('#prev-day');
  assert.equal(await page.textContent('#preview-day'), 'Day 4');
  assert.equal(await page.evaluate(() => localStorage.getItem('proteindle:v2')), null);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('midnight: an untouched day moves on, a day in progress can be finished', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: '2026-11-12T23:59:30' });
  assert.equal(await page.textContent('#day-tag'), '#1');
  await page.clock.setFixedTime(new Date('2026-11-13T00:00:05'));
  await page.waitForFunction(() => document.querySelector('#day-tag').textContent === '#2');
  assert.deepEqual(await cardNames(page), [R2[0].left.food.name, R2[0].right.food.name]);

  // Start day 2, then let midnight pass again.
  await pick(page, R2[0].winner);
  await page.click('#next-btn');
  await page.clock.setFixedTime(new Date('2026-11-14T00:00:05'));
  await page.waitForTimeout(1500);
  assert.equal(await page.textContent('#day-tag'), '#2', 'a day in progress stays');
  await playFrom(page, R2, 1, (r) => r.winner);
  assert.equal((await page.textContent('.score')).trim(), '10/10');
  await page.waitForFunction(() => /New match-ups are ready/.test(document.querySelector('#next').textContent));
  assert.equal((await saved(page)).stats.lastDay, 2, 'the finished day counts for the day it belongs to');
  await page.click('#next button');
  assert.equal(await page.textContent('#day-tag'), '#3');
  assert.equal(await page.isVisible('#play'), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('two tabs share progress and do not overwrite each other', async () => {
  const ctx = await newContext();
  const a = await openTab(ctx, '/index.html', { time: DAY1 });
  const b = await openTab(ctx, '/index.html', { time: DAY1 });
  // Tab B follows what tab A plays.
  await pick(a.page, R1[0].winner);
  await b.page.waitForFunction(() => document.querySelectorAll('#dots .dot.right').length === 1);
  await a.page.click('#next-btn');
  await playFrom(a.page, R1, 1, (r) => r.winner);
  await b.page.waitForSelector('#results:not([hidden])');
  assert.equal((await b.page.textContent('.score')).trim(), '10/10');
  // A tab that missed those updates changes a setting: the finished day survives.
  const c = await openTab(ctx, '/index.html?fresh', { time: DAY1, scripts: [deafToOtherTabs] });
  await c.page.evaluate(() => localStorage.setItem('probe', '1'));
  await c.page.click('#help-btn');
  await c.page.check('#contrast');
  const after = await saved(a.page);
  assert.equal(after.contrast, true);
  assert.equal(after.stats.played, 1);
  assert.equal(after.game.picks.length, 10);
  assert.deepEqual([...a.errors, ...b.errors, ...c.errors], []);
  await ctx.close();
});

await check('a tab that is behind takes the saved game instead of overwriting it', async () => {
  const ctx = await newContext();
  const a = await openTab(ctx, '/index.html', { time: DAY1 });
  const b = await openTab(ctx, '/index.html', { time: DAY1, scripts: [deafToOtherTabs] });
  await pick(a.page, R1[0].winner);
  await a.page.click('#next-btn');
  await pick(a.page, other(R1[1].winner));
  await a.page.click('#next-btn');
  // Tab B missed both picks and still shows match-up 1. Tapping a card there records nothing
  // and brings it up to date.
  assert.deepEqual(await cardNames(b.page), [R1[0].left.food.name, R1[0].right.food.name]);
  await b.page.click('#arena .card[data-side="left"]');
  assert.deepEqual((await saved(a.page)).game.picks, [R1[0].winner, other(R1[1].winner)]);
  assert.deepEqual(await cardNames(b.page), [R1[2].left.food.name, R1[2].right.food.name]);
  assert.equal(await dots(b.page), 'RW........');
  assert.equal(await b.page.isHidden('#next-btn'), true, 'no answer is shown for the ignored tap');
  assert.deepEqual([...a.errors, ...b.errors], []);
  await ctx.close();
});

await check('with storage blocked the game still plays and says progress is not saved', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: DAY1, scripts: [blockStorage] });
  assert.equal(await page.isVisible('#storage-note'), true);
  assert.equal(await page.textContent('#storage-note'), "Your progress can't be saved in this browser.");
  await playFrom(page, R1, 0, (r) => r.winner);
  assert.equal((await page.textContent('.score')).trim(), '10/10');
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const width of [320, 360, 430, 768, 1280]) {
  for (const colorScheme of ['light', 'dark']) {
    await check(`layout holds at ${width}px, ${colorScheme}`, async () => {
      const { ctx, page, errors } = await open('/index.html?day=3', { context: { viewport: { width, height: 800 }, colorScheme, reducedMotion: 'reduce' } });
      const R3 = P.dailyRounds(3, FOODS, BENCH);
      // Every match-up of the day, before and after the answer.
      for (let i = 0; i < R3.length; i++) {
        await noSidewaysScroll(page, `match-up ${i + 1}`);
        await pick(page, i % 2 ? R3[i].winner : other(R3[i].winner));
        await noSidewaysScroll(page, `match-up ${i + 1} answered`);
        if (i === 4 && (width === 360 || width === 1280)) await shot(page, `07-answered-${width}-${colorScheme}`);
        await page.click('#next-btn');
      }
      await page.waitForSelector('#results:not([hidden])');
      await noSidewaysScroll(page, 'score card');
      if (width === 360) await shot(page, `08-score-360-${colorScheme}`);
      await page.click('#stats-btn');
      await noSidewaysScroll(page, 'stats open');
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  }
}

await check('no card text is cut off across sixty days of match-ups at 320px', async () => {
  const { ctx, page, errors } = await open('/index.html?day=1', { context: { viewport: { width: 320, height: 700 }, reducedMotion: 'reduce' } });
  for (let day = 1; day <= 60; day++) {
    const rounds = P.dailyRounds(day, FOODS, BENCH);
    for (let i = 0; i < rounds.length; i++) {
      await noSidewaysScroll(page, `day ${day} match-up ${i + 1}`);
      await pick(page, rounds[i].winner);
      await page.click('#next-btn');
    }
    await page.click('#next-day');
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('high-contrast colours switch on and are remembered', async () => {
  const { ctx, page } = await open('/index.html', { time: DAY1 });
  await page.click('#help-btn');
  await page.check('#contrast');
  assert.equal(await page.getAttribute('html', 'data-contrast'), 'high');
  await page.click('#help .primary');
  await pick(page, other(R1[0].winner));
  await page.waitForTimeout(800);
  await shot(page, '09-high-contrast');
  await page.reload();
  assert.equal(await page.getAttribute('html', 'data-contrast'), 'high');
  await ctx.close();
});

await check('the single-file builds load and play', async () => {
  for (const [file, preview] of [['/dist/proteindle.html', false], ['/dist/proteindle-preview.html', true]]) {
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`${file} is missing; run "npm run bundle" first`);
    const { ctx, page, errors } = await open(file, { time: DAY1 });
    assert.equal(await page.isVisible('#preview-bar'), preview, file);
    await playFrom(page, R1, 0, (r) => r.winner);
    assert.equal((await page.textContent('.score')).trim(), '10/10');
    assert.deepEqual(errors, [], file);
    await ctx.close();
  }
});

await browser.close();
server.close();
const failed = results.filter(([, err]) => err);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
