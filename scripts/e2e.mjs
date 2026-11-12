// Plays the game in a real browser (your installed Google Chrome, headless) and checks what a player would see.
//
//   npm run e2e                     run the checks
//   SHOTS=/some/dir npm run e2e     also save screenshots of each stage there
//
// Needs `npm install` once (playwright-core) and Google Chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

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

const browser = await chromium.launch({ channel: 'chrome' });
const results = [];

async function open(url, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'], ...opts.context,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  if (opts.time) await page.clock.setFixedTime(new Date(opts.time));
  await page.goto(BASE + url);
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

  // The bonus: pumpkin seeds (8.6 g a serving) against whole milk (7.8 g a cup).
  const q = P.bonusQuestion(food('pumpkin-seeds'), require('../foods.js').PROTEINDLE_BENCHMARKS, 1);
  assert.equal(q.winner, 'food');
  await page.click('.bonus-opts button:nth-child(1)');
  assert.equal(await page.textContent('.bonus-note'), '✓ Right.');
  assert.equal(await page.$$eval('.fact', (f) => f.length), 3);
  assert.equal(await page.$$eval('.bar-row', (r) => r.length), 9);
  assert.equal(await page.$$eval('.bar-row.mine', (r) => r.length), 1);
  for (const label of ['Per 100 g', 'Per 100 kcal', 'Per serving']) {
    await page.click(`.tabs button:text-is("${label}")`);
    assert.equal(await page.$eval('.tabs button[aria-pressed="true"]', (b) => b.textContent), label);
    const values = await page.$$eval('.bar-val', (v) => v.map((x) => parseFloat(x.textContent)));
    assert.deepEqual(values, [...values].sort((a, b) => b - a), `${label}: bars are largest first`);
  }
  await page.waitForTimeout(600);
  await shot(page, '07-reveal');
  await noSidewaysScroll(page, 'reveal at 390px');

  // Sharing copies the pattern, not the food.
  const answer = food('pumpkin-seeds');
  const expected = P.shareText(1, ['chickpeas', 'almonds', 'pumpkin-seeds'].map((id) => P.grade(food(id), answer)), true, { hint: false, bonus: true, url: '' });
  await page.click('.actions .primary');
  await page.waitForFunction(() => document.querySelector('#toast').classList.contains('show') && /Copied|Select/.test(document.querySelector('#toast').textContent));
  const copied = (await toastText(page)).startsWith('Copied')
    ? await page.evaluate(() => navigator.clipboard.readText())
    : await page.textContent('#share-text');
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
  assert.deepEqual(await rowNames(page), ['Chickpeas (cooked)', 'Almonds', 'Pumpkin seeds']);
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
  await page.waitForTimeout(600);
  await shot(page, '10-loss');
  await page.click('#stats-btn');
  assert.deepEqual(await page.$$eval('#stats .nums b', (b) => b.map((x) => x.textContent)), ['2', '50', '2', '2']);
  await page.click('#stats .close');
  await page.click('.actions .primary');
  await page.waitForFunction(() => /Copied|Select/.test(document.querySelector('#toast').textContent));
  const lost = (await toastText(page)).startsWith('Copied') ? await page.evaluate(() => navigator.clipboard.readText()) : await page.textContent('#share-text');
  assert.match(lost, /^Proteindle #2 X\/6 💡\n/);

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
