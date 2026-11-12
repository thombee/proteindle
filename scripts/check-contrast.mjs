// Checks that the game's text colours in style.css reach WCAG AA contrast (4.5:1) in every
// colour mode: light, dark, and high-contrast on top of each.
//
//   node scripts/check-contrast.mjs
//
// It reads the --pd-* colour variables out of style.css, so a colour change is checked
// without editing this file. Exits non-zero if any pair is under 4.5:1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const MIN = 4.5;

// The body of the first rule whose selector is exactly `selector`, searching from `from`.
function block(selector, from = 0) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{', 'g');
  re.lastIndex = from;
  const m = re.exec(css);
  if (!m) throw new Error(`style.css: no rule for ${selector}`);
  const start = m.index + m[0].length;
  return css.slice(start, css.indexOf('}', start));
}
function vars(body) {
  const out = {};
  for (const [, name, value] of body.matchAll(/--pd-([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[name] = value;
  return out;
}

const light = vars(block(':root'));
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
if (darkAt < 0) throw new Error('style.css: no dark-mode block');
const dark = { ...light, ...vars(block(':root', darkAt)) };
const high = vars(block(':root[data-contrast="high"]'));
const MODES = { light, dark, 'light, high contrast': { ...light, ...high }, 'dark, high contrast': { ...dark, ...high } };

// Tile text drawn with reduced opacity blends toward the tile colour; use the faintest.
const opacity = (sel) => { const m = /opacity\s*:\s*([\d.]+)/.exec(block(sel)); return m ? Number(m[1]) : 1; };
const tileAlpha = Math.min(opacity('.t-main'), opacity('.t-main small'), opacity('.t-sub'));

const rgb = (hex) => {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const luminance = (c) => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function ratio(fg, bg, alpha = 1) {
  const b = rgb(bg), f = rgb(fg).map((v, i) => v * alpha + b[i] * (1 - alpha));
  const [hi, lo] = [luminance(f), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [text, background, what it is, opacity]
const PAIRS = [
  ['match-ink', 'match', 'match tile', tileAlpha],
  ['close-ink', 'close', 'close tile', tileAlpha],
  ['far-ink', 'far', 'far tile', tileAlpha],
  ['muted', 'bg', 'muted text on the page', 1],
  ['muted', 'card', 'muted text on a card', 1],
  ['muted', 'blank', 'muted text on a fact box', 1],
  ['ink', 'bg', 'text on the page', 1],
  ['ink', 'card', 'text on a card', 1],
  ['accent', 'bg', 'accent text on the page', 1],
];

let failed = 0;
for (const [mode, v] of Object.entries(MODES)) {
  for (const [fg, bg, what, alpha] of PAIRS) {
    if (!v[fg] || !v[bg]) throw new Error(`style.css: --pd-${fg} or --pd-${bg} is missing in ${mode} mode`);
    const r = ratio(v[fg], v[bg], alpha);
    const ok = r >= MIN;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  ${mode.padEnd(20)} ${what} (--pd-${fg} ${v[fg]} on --pd-${bg} ${v[bg]})`);
  }
}
console.log(failed ? `\n${failed} pair(s) under ${MIN}:1` : `\nevery pair reaches ${MIN}:1`);
process.exit(failed ? 1 : 0);
