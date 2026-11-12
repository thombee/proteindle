// Packs the game into single HTML files in dist/, with the stylesheet and scripts inlined.
//
//   node scripts/bundle.mjs
//
//   dist/proteindle.html          the game, as one file you can send to someone or host anywhere
//   dist/proteindle-preview.html  the same, in preview mode: any day can be played and nothing is saved
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let html = read('index.html');
// Replacer functions, because the sources contain "$" sequences that a replacement string would interpret.
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>\n${read(href)}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  const js = read(src);
  if (/<\/script/i.test(js)) throw new Error(`${src} contains "</script", which would end the inline script early`);
  return `<script>\n${js}</script>`;
});
if (/<script src=|rel="stylesheet"/.test(html)) throw new Error('something was left un-inlined');

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'proteindle.html'), html);
fs.writeFileSync(path.join(ROOT, 'dist', 'proteindle-preview.html'), html.replace('<html lang="en">', '<html lang="en" data-preview>'));
console.log(`bundle: wrote dist/proteindle.html and dist/proteindle-preview.html (${(html.length / 1024).toFixed(0)} KB each)`);
