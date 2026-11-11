// Insère les pictogrammes (design/pictos.svg) dans index.html, entre les balises <!-- sprites:start --> et <!-- sprites:end -->.
// À relancer après toute modification d'un pictogramme :  node scripts/inline-sprites.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sprites = ['design/pictos.svg'].map((f) => readFileSync(join(root, f), 'utf8').trim()).join('\n');
const out = html.replace(/<!-- sprites:start -->[\s\S]*?<!-- sprites:end -->/, `<!-- sprites:start -->\n${sprites}\n<!-- sprites:end -->`);
if (out === html && !html.includes(sprites)) throw new Error('Balises <!-- sprites:start/end --> introuvables dans index.html');
writeFileSync(join(root, 'index.html'), out);
console.log('Sprites insérés dans index.html');
