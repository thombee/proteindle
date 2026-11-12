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
const { PROTEINDLE_FOODS: FOODS } = require('../foods.js');
const { PROTEINDLE_SCHEDULE: SCHEDULE } = require('../schedule.js');
const food = (id) => FOODS.find((f) => f.id === id);
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
const settled = (page) => page.waitForFunction(() => !document.querySelector('#rows .fresh'));
// The name is the text after the emoji.
const rowNames = (page) => page.$$eval('#rows .row-name', (els) => els.map((e) => e.lastChild.textContent));
async function guess(page, text) {
  await page.fill('#guess', text);
  await page.keyboard.press('Enter');
  await settled(page);
}
const toastText = (page) => page.$eval('#toast', (t) => (t.classList.contains('show') ? t.textContent : ''));
// Press the share button and return the text it copied (or showed, if copying failed).
async function sharedText(page) {
  await page.click('.actions .primary');
  await page.waitForFunction(() => document.querySelector('#toast').classList.contains('show') && /Copied|Select/.test(document.querySelector('#toast').textContent));
  return (await toastText(page)).startsWith('Copied') ? page.evaluate(() => navigator.clipboard.readText()) : page.textContent('#share-text');
}
const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a ? { cls: a.className, text: a.textContent, pressed: a.getAttribute('aria-pressed') } : null;
});
const saved = async (page) => JSON.parse(await page.evaluate(() => localStorage.getItem('proteindle:v1')));
const closeHelp = (page) => page.click('#help .primary');
const noSidewaysScroll = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 0, `${label}: page is ${over}px wider than the screen`);
  const clipped = await page.$$eval('.tile .t-main, .tile .t-sub', (els) => els.filter((e) => e.scrollWidth > e.parentElement.clientWidth + 1).map((e) => e.textContent));
  assert.deepEqual(clipped, [], `${label}: tile text wider than its tile`);
};

async function check(name, fn) {
  try { await fn(); results.push([name, null]); console.log(`ok    ${name}`); }
  catch (err) { results.push([name, err]); console.log(`FAIL  ${name}\n      ${String(err.message).split('\n').join('\n      ')}`); }
}

const DAY1 = '2026-11-12T10:00:00', DAY2 = '2026-11-13T10:00:00';
assert.equal(P.answerId(1, SCHEDULE), 'pumpkin-seeds');
assert.equal(P.answerId(2, SCHEDULE), 'lentils');

await check('a first visit, a win, a reload, then a loss the next day', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: DAY1 });

  // First visit: the rules open by themselves.
  assert.equal(await page.$eval('#help', (d) => d.open), true, 'help opens on a first visit');
  await shot(page, '01-help');
  await page.click('#help .primary');
  assert.equal(await page.$eval('#help', (d) => d.open), false);
  assert.equal(await page.textContent('#day-tag'), '#1');
  assert.equal(await page.isHidden('#preview-bar'), true);
  await shot(page, '02-start');

  // The list opens on focus with every food, and typing narrows it.
  await page.focus('#guess');
  assert.equal(await page.$$eval('#options .opt', (o) => o.length), FOODS.length);
  await page.fill('#guess', 'chick');
  assert.equal(await page.$eval('#options .opt[aria-selected="true"]', (o) => o.textContent.includes('Chickpeas')), true);
  await shot(page, '03-picker');

  // Things that are not guesses.
  await guess(page, 'zzzz');
  assert.equal(await toastText(page), 'Pick a food from the list');
  assert.deepEqual(await rowNames(page), []);

  await guess(page, 'chick');
  assert.deepEqual(await rowNames(page), ['Chickpeas (cooked)']);
  assert.equal(await page.textContent('#count'), 'Guess 2 of 6');
  await guess(page, 'Chickpeas (cooked)');
  assert.equal(await toastText(page), 'You already guessed that');
  assert.equal((await rowNames(page)).length, 1);

  await guess(page, 'almonds');
  const mystery = await page.$$eval('#mystery .tile', (ts) => ts.map((t) => t.textContent));
  assert.match(mystery[0], /Nuts/, 'the top row shows the group once a guess matches it');
  assert.match(mystery[1], /> 21\.2/, 'the top row shows protein is above the almonds figure');
  await shot(page, '04-midgame');

  // With the group known, the empty list puts that group first and strikes out used foods.
  await page.click('#guess');
  const firstGroups = await page.$$eval('#options .opt', (o) => o.slice(0, 5).map((x) => x.querySelector('.opt-group').textContent));
  assert.deepEqual(firstGroups, ['Nuts', 'Nuts', 'Nuts', 'Nuts', 'Nuts']);
  assert.equal(await page.$$eval('#options .opt[aria-disabled="true"]', (o) => o.length), 2);
  await shot(page, '05-picker-narrowed');
  assert.equal(await page.isHidden('#hint-btn'), true, 'no hint before four guesses');

  // The winning guess.
  await guess(page, 'pumpkin');
  await page.waitForSelector('#reveal:not([hidden])');
  assert.match(await page.textContent('.rv-kicker'), /Solved in 3 of 6/);
  assert.equal(await page.textContent('#reveal h2'), 'Pumpkin seeds');
  assert.equal(await page.isHidden('#entry'), true);
  assert.equal(await page.$('.facts'), null, 'the facts wait for the bonus answer');
  await shot(page, '06-bonus');

  // The bonus: pumpkin seeds (8.6 g a serving) against whole milk (7.8 g a cup), answered
  // from the keyboard. Focus moves to the result, and the result is read out.
  const q = P.bonusQuestion(food('pumpkin-seeds'), require('../foods.js').PROTEINDLE_BENCHMARKS, 1);
  assert.equal(q.winner, 'food');
  await page.focus('.bonus-opts button:nth-child(1)');
  await page.keyboard.press('Enter');
  assert.equal(await page.textContent('.bonus-note'), '✓ Right.');
  assert.equal((await focused(page)).cls, 'bonus-note', 'focus moves to the bonus result');
  assert.equal(await page.textContent('#live'), "Right. Pumpkin seeds 8.6 grams, Whole cow's milk 7.8 grams.");
  assert.equal(await page.$$eval('.fact', (f) => f.length), 3);
  assert.equal(await page.$$eval('.bar-row', (r) => r.length), 9);
  assert.equal(await page.$$eval('.bar-row.mine', (r) => r.length), 1);
  for (const label of ['Per 100 g', 'Per 100 kcal', 'Per serving']) {
    await page.focus(`.tabs button:text-is("${label}")`);
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('.tabs button[aria-pressed="true"]', (b) => b.textContent), label);
    assert.deepEqual(await focused(page), { cls: '', text: label, pressed: 'true' }, `${label}: the pressed tab keeps focus`);
    const values = await page.$$eval('.bar-val', (v) => v.map((x) => parseFloat(x.textContent)));
    assert.deepEqual(values, [...values].sort((a, b) => b - a), `${label}: bars are largest first`);
  }
  await page.click('.tabs button:text-is("Per 100 g")');
  assert.equal(await page.$eval('.tabs button[aria-pressed="true"]', (b) => b.textContent), 'Per 100 g', 'tabs work with the mouse too');
  await page.click('.tabs button:text-is("Per serving")');
  await page.waitForTimeout(600);
  await shot(page, '07-reveal');
  await noSidewaysScroll(page, 'reveal at 390px');

  // Sharing copies the pattern, not the food.
  const answer = food('pumpkin-seeds');
  const expected = P.shareText(1, ['chickpeas', 'almonds', 'pumpkin-seeds'].map((id) => P.grade(food(id), answer)), true, { hint: false, bonus: true, url: '' });
  const copied = await sharedText(page);
  assert.equal(copied, expected);
  assert.ok(!/pumpkin/i.test(copied));

  await page.click('#stats-btn');
  assert.deepEqual(await page.$$eval('#stats .nums b', (b) => b.map((x) => x.textContent)), ['1', '100', '1', '1']);
  assert.match(await page.textContent('.pantry-note'), /tried 3 of/);
  await shot(page, '08-stats');
  await page.click('#stats .close');

  // Coming back later the same day: everything is as it was left.
  await page.reload();
  assert.equal(await page.$eval('#help', (d) => d.open), false, 'help does not reopen');
  assert.deepEqual(await rowNames(page), ['Chickpeas (cooked)', 'Almonds (raw)', 'Pumpkin seeds']);
  assert.equal(await page.textContent('.bonus-note'), '✓ Right.');
  assert.match(await page.textContent('#next'), /Next plant in \d\d:\d\d:\d\d/);

  // The next day: a new plant (lentils), and yesterday's foods show their protein in the list.
  await page.clock.setFixedTime(new Date(DAY2));
  await page.reload();
  assert.equal(await page.textContent('#day-tag'), '#2');
  assert.deepEqual(await rowNames(page), []);
  assert.equal(await page.isVisible('#entry'), true);
  await page.fill('#guess', 'almond');
  assert.equal(await page.$eval('#options .opt .opt-known', (c) => c.textContent), '21.2 g');

  // Lose on purpose, taking the hint when it appears.
  const wrong = ['apple', 'banana', 'white rice', 'walnuts', 'tofu (firm)', 'potato'];
  for (const [i, w] of wrong.entries()) {
    await guess(page, w);
    if (i === 2) assert.equal(await page.isHidden('#hint-btn'), true);
    if (i === 3) {
      assert.equal(await page.isVisible('#hint-btn'), true, 'the hint appears after four guesses');
      await page.click('#hint-btn');
      assert.equal(await page.textContent('#mystery .tag'), 'Starts with L');
      await shot(page, '09-hint');
    }
  }
  await page.waitForSelector('#reveal:not([hidden])');
  assert.match(await page.textContent('.rv-kicker'), /Out of guesses/);
  assert.equal(await page.textContent('#reveal h2'), 'Lentils (cooked)');
  await page.click('.bonus .link-btn');
  assert.equal(await page.$$eval('.fact', (f) => f.length), 3);
  assert.equal((await focused(page)).text, 'Per serving', 'after a skip, focus moves to the first tab');
  await page.waitForTimeout(600);
  await shot(page, '10-loss');
  await page.click('#stats-btn');
  assert.deepEqual(await page.$$eval('#stats .nums b', (b) => b.map((x) => x.textContent)), ['2', '50', '2', '2']);
  await page.click('#stats .close');
  assert.match(await sharedText(page), /^Proteindle #2 X\/6 💡\n/);

  assert.deepEqual(errors, [], 'no errors in the browser console');
  await ctx.close();
});

await check('preview mode plays any day and saves nothing', async () => {
  const { ctx, page, errors } = await open('/index.html?day=5', { time: DAY1 });
  assert.equal(await page.$eval('#help', (d) => d.open), false);
  assert.equal(await page.isVisible('#preview-bar'), true);
  assert.equal(await page.textContent('#preview-day'), 'Day 5');
  await guess(page, 'peanut butter'); // day 5's answer
  await page.waitForSelector('#reveal:not([hidden])');
  assert.match(await page.textContent('.rv-kicker'), /Solved in 1 of 6/);
  await page.click('#next-day');
  assert.equal(await page.textContent('#preview-day'), 'Day 6');
  assert.deepEqual(await rowNames(page), []);
  assert.equal(await page.isHidden('#reveal'), true);
  await page.click('#prev-day');
  await page.click('#prev-day');
  assert.equal(await page.textContent('#preview-day'), 'Day 4');
  assert.equal(await page.evaluate(() => localStorage.getItem('proteindle:v1')), null);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('the keyboard alone can make a guess', async () => {
  const { ctx, page, errors } = await open('/index.html?day=1');
  await page.focus('#guess');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const picked = await page.$eval('#options .opt[aria-selected="true"]', (o) => o.querySelector('span:nth-child(2)').textContent);
  await page.keyboard.press('Enter');
  await settled(page);
  assert.deepEqual(await rowNames(page), [picked]);
  await page.focus('#guess');
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#options'), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const width of [320, 360, 430, 768, 1280]) {
  for (const colorScheme of ['light', 'dark']) {
    await check(`layout holds at ${width}px, ${colorScheme}`, async () => {
      const { ctx, page, errors } = await open('/index.html?day=3', { context: { viewport: { width, height: 800 }, colorScheme, reducedMotion: 'reduce' } });
      for (const g of ['pumpkin seeds', 'chia seeds', 'tortilla chips', 'soybeans']) await guess(page, g);
      await noSidewaysScroll(page, 'mid-game');
      if (width === 320) {
        // Every food name fits on one line in the guess list.
        const wrapped = await page.evaluate((names) => {
          const row = document.querySelector('#rows .row-name');
          const probe = row.cloneNode(true);
          row.parentNode.insertBefore(probe, row);
          const oneLine = probe.getBoundingClientRect().height;
          const out = names.filter((n) => { probe.lastChild.textContent = n; return probe.getBoundingClientRect().height > oneLine + 1; });
          probe.remove();
          return out;
        }, FOODS.map((f) => f.name));
        assert.deepEqual(wrapped, [], 'food names that wrap at 320px');
      }
      await page.focus('#guess');
      await noSidewaysScroll(page, 'list open');
      if (width === 360) await shot(page, `11-midgame-360-${colorScheme}`);
      await guess(page, 'tofu (firm)');
      await page.waitForSelector('#reveal:not([hidden])');
      await page.click('.bonus-opts button:nth-child(2)');
      await noSidewaysScroll(page, 'reveal');
      if (width === 1280 || width === 360) await shot(page, `12-reveal-${width}-${colorScheme}`);
      await page.click('#help-btn');
      await noSidewaysScroll(page, 'help open');
      if (width === 360 && colorScheme === 'dark') await shot(page, '13-help-360-dark');
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  }
}

await check('high-contrast colours switch on and are remembered', async () => {
  const { ctx, page } = await open('/index.html', { time: DAY1 });
  await page.check('#contrast');
  assert.equal(await page.getAttribute('html', 'data-contrast'), 'high');
  await page.click('#help .primary');
  await guess(page, 'almonds');
  await shot(page, '14-high-contrast');
  await page.reload();
  assert.equal(await page.getAttribute('html', 'data-contrast'), 'high');
  await ctx.close();
});

// ---- midnight

await check('a page left open over midnight with no guesses moves to the new day', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: '2026-11-12T23:59:58' });
  await closeHelp(page);
  assert.equal(await page.textContent('#day-tag'), '#1');
  await page.clock.setFixedTime(new Date('2026-11-13T00:00:01'));
  await page.waitForFunction(() => document.querySelector('#day-tag').textContent === '#2', null, { timeout: 4000 });
  assert.deepEqual(await rowNames(page), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('a round in progress at midnight stays, can be finished, then offers the new plant', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: '2026-11-12T23:59:50' });
  await closeHelp(page);
  await guess(page, 'almonds');
  await page.clock.setFixedTime(new Date('2026-11-13T00:00:05'));
  await page.waitForTimeout(1600); // more than one tick of the one-second timer
  assert.equal(await page.textContent('#day-tag'), '#1', 'a started round is not taken away');
  assert.deepEqual(await rowNames(page), ['Almonds (raw)']);
  await guess(page, 'pumpkin');
  await page.waitForSelector('#reveal:not([hidden])');
  assert.match(await page.textContent('.rv-kicker'), /Solved in 2 of 6/);
  // The bonus is still unanswered, and the new plant is already on offer.
  assert.notEqual(await page.$('.bonus-opts button:not([disabled])'), null);
  await page.waitForFunction(() => /A new plant is ready/.test(document.querySelector('#next')?.textContent ?? ''));
  const store = await saved(page);
  assert.deepEqual([store.stats.played, store.stats.won, store.stats.lastDay], [1, 1, 1], 'the round counts for day 1');
  await page.click('#next button');
  assert.equal(await page.textContent('#day-tag'), '#2');
  assert.deepEqual(await rowNames(page), []);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('a finished round with the bonus unanswered offers the new plant after midnight', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: DAY1 });
  await closeHelp(page);
  await guess(page, 'pumpkin');
  await page.waitForSelector('#reveal:not([hidden])');
  assert.equal(await page.$('.bonus-note'), null, 'the bonus is unanswered');
  await page.waitForFunction(() => /Next plant in/.test(document.querySelector('#next')?.textContent ?? ''));
  await page.clock.setFixedTime(new Date(DAY2));
  await page.waitForFunction(() => /A new plant is ready/.test(document.querySelector('#next')?.textContent ?? ''), null, { timeout: 4000 });
  assert.equal(await page.textContent('#day-tag'), '#1', 'a finished round stays until the player moves on');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- several tabs

await check('two tabs share progress: a setting changed in a stale tab keeps a round finished in another', async () => {
  const ctx = await newContext();
  const a = await openTab(ctx, '/index.html', { time: DAY1 });
  await closeHelp(a.page);
  const b = await openTab(ctx, '/index.html', { time: DAY1 });
  // This tab misses the other tabs' storage events, so only the fresh read before a write protects it.
  const c = await openTab(ctx, '/index.html', { time: DAY1, scripts: [deafToOtherTabs] });
  assert.equal(await b.page.$eval('#help', (d) => d.open), false);

  await guess(a.page, 'almonds');
  await guess(a.page, 'pumpkin');
  await a.page.waitForSelector('#reveal:not([hidden])');
  // A tab that hears about it redraws the round from what was saved.
  await b.page.waitForSelector('#reveal:not([hidden])');
  assert.deepEqual(await rowNames(b.page), ['Almonds (raw)', 'Pumpkin seeds']);
  assert.deepEqual(await rowNames(c.page), [], 'the deaf tab still shows its stale round');

  // Change a setting in the stale tab.
  await c.page.click('#help-btn');
  await c.page.check('#contrast');
  const store = await saved(a.page);
  assert.equal(store.contrast, true);
  assert.deepEqual(store.game.guesses, ['almonds', 'pumpkin-seeds'], 'the finished round survives');
  assert.deepEqual([store.stats.played, store.stats.won], [1, 1]);
  // The tabs that hear the change take the new setting too.
  await a.page.waitForFunction(() => document.documentElement.getAttribute('data-contrast') === 'high');
  await b.page.waitForFunction(() => document.documentElement.getAttribute('data-contrast') === 'high');
  await a.page.reload();
  assert.deepEqual(await rowNames(a.page), ['Almonds (raw)', 'Pumpkin seeds']);
  assert.deepEqual([...a.errors, ...b.errors, ...c.errors], []);
  await ctx.close();
});

// ---- a wrong food with the same numbers

const TWIN_DAY = 80, TWIN_TIME = '2027-01-30T10:00:00';
assert.equal(P.answerId(TWIN_DAY, SCHEDULE), 'lettuce');
assert.equal(P.dayNumber(new Date(TWIN_TIME)), TWIN_DAY);
assert.equal(P.sameNumbers(P.grade(food('cucumber'), food('lettuce'))), true);

await check('a wrong food with the same numbers gives the first letter for free', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: TWIN_TIME });
  await closeHelp(page);
  await guess(page, 'cucumber');
  assert.equal(await toastText(page), 'Same numbers, different food. It starts with I.');
  assert.equal(await page.textContent('#mystery .tag'), 'Starts with I');
  for (const g of ['apple', 'almonds', 'white rice']) await guess(page, g);
  assert.equal(await page.isHidden('#hint-btn'), true, 'no hint button once the letter is known');
  await page.reload();
  assert.equal(await page.textContent('#mystery .tag'), 'Starts with I', 'the free hint survives a reload');
  await guess(page, 'iceberg');
  await page.waitForSelector('#reveal:not([hidden])');
  await page.click('.bonus .link-btn');
  assert.match(await sharedText(page), new RegExp(`^Proteindle #${TWIN_DAY} 5/6\n`), 'a free hint adds no 💡');
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('a wrong food with the same numbers after the hint was taken', async () => {
  const { ctx, page, errors } = await open(`/index.html?day=${TWIN_DAY}`);
  for (const g of ['apple', 'almonds', 'white rice', 'tofu (firm)']) await guess(page, g);
  await page.click('#hint-btn');
  await guess(page, 'cucumber');
  assert.equal(await toastText(page), 'Same numbers, different food.');
  assert.equal(await page.textContent('#mystery .tag'), 'Starts with I');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- storage

await check('when storage throws, the game says so once and stays playable', async () => {
  const { ctx, page, errors } = await open('/index.html', { time: DAY1, scripts: [blockStorage] });
  await closeHelp(page);
  assert.equal(await page.isVisible('#save-note'), true);
  assert.equal(await page.textContent('#save-note'), "Your progress can't be saved in this browser.");
  assert.equal(await page.textContent('#live'), "Your progress can't be saved in this browser.", 'announced to screen readers');
  await guess(page, 'almonds');
  assert.notEqual(await page.textContent('#live'), "Your progress can't be saved in this browser.", 'announced once, not after every save');
  await guess(page, 'pumpkin');
  await page.waitForSelector('#reveal:not([hidden])');
  await page.click('.bonus .link-btn');
  assert.equal(await page.$$eval('.fact', (f) => f.length), 3);
  assert.equal(await page.$$eval('#save-note', (n) => n.length), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('the single-file builds load and play', async () => {
  for (const [file, preview] of [['/dist/proteindle.html', false], ['/dist/proteindle-preview.html', true]]) {
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`${file} is missing; run "npm run bundle" first`);
    const { ctx, page, errors } = await open(file, { time: DAY1 });
    assert.equal(await page.isVisible('#preview-bar'), preview, file);
    if (!preview) await page.click('#help .primary');
    await guess(page, 'pumpkin seeds');
    await page.waitForSelector('#reveal:not([hidden])');
    assert.deepEqual(errors, [], file);
    await ctx.close();
  }
});

await browser.close();
server.close();
const failed = results.filter(([, err]) => err);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
