import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSettings } from './engine.mjs';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(sourceRoot, '..', '옴탈 채검하기 시간 테스트'));
const read = name => fs.readFileSync(path.join(sourceRoot, name), 'utf8');
const settings = validateSettings(JSON.parse(fs.readFileSync(path.join(root, '설정.json'), 'utf8')));
const stripModule = text => text.replace(/^import .*?;\r?\n/gm, '').replace(/^export /gm, '');
const engine = stripModule(read('engine.mjs'));
const storage = stripModule(read('storage.mjs'));
const app = read('app.mjs').replace(/^import .*?;\r?\n/gm, '');
const code = `(() => {\n'use strict';\n${engine}\n${storage}\n${app}\n})();`.replace(/<\/script/gi, '<\\/script');
const html = read('화면 템플릿.html')
  .replace('<link rel="stylesheet" href="style.css">', `<style>\n${read('style.css')}\n</style>`)
  .replace('<script type="module" src="app.mjs"></script>',
    `<script id="initial-settings" type="application/json">${JSON.stringify(settings)}</script>\n<script>\n${code}\n</script>`);
if (html.includes('type="module"') || html.includes('/api/')) throw new Error('The offline HTML must not depend on modules or API requests.');
fs.writeFileSync(path.join(root, 'index.html'), html, 'utf8');
console.log(`Built direct-open index.html (${Buffer.byteLength(html)} bytes); no server required.`);
