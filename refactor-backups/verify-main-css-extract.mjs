#!/usr/bin/env node
/** Verify main.css extract matches backup verbatim (inner content of all <style> blocks). */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BACKUP = path.join(ROOT, 'refactor-backups/index.html.pre-css-extract.bak');
const MAIN_CSS = path.join(ROOT, 'public/main.css');
const INDEX = path.join(ROOT, 'public/index.html');

const backup = fs.readFileSync(BACKUP, 'utf8');
const mainCss = fs.readFileSync(MAIN_CSS, 'utf8');
const index = fs.readFileSync(INDEX, 'utf8');

const styleRe = /<style(\s[^>]*)?>([\s\S]*?)<\/style>/gi;
const chunks = [];
let m;
while ((m = styleRe.exec(backup)) !== null) chunks.push(m[2]);
const reconstructed = chunks.join('\n\n');

const cssMatch = reconstructed === mainCss;
const indexStyleCount = [...index.matchAll(/<style[\s>]/gi)].length;
const hasMainLink = index.includes('href="/main.css?v=20260704_main_css_extract"');
const hasDynamic = index.includes('id="ff-dynamic-layout-vars"');
const dynamicVars = ['--header-h:', '--ff-join-more-top:', '--ff-join-more-right:'].every((v) =>
  index.includes(v)
);
const noOldNativeStyle = !index.includes('id="ff-native-login-only-v1"');
const mainHasRoot = mainCss.includes(':root{') || mainCss.includes(':root {');
const mainHasHeaderVar = mainCss.includes('var(--header-h');

console.log(JSON.stringify({
  styleBlocksInBackup: chunks.length,
  cssByteIdentical: cssMatch,
  cssLineDiff: mainCss.split('\n').length - reconstructed.split('\n').length,
  indexRemainingStyleTags: indexStyleCount,
  hasMainCssLink: hasMainLink,
  hasDynamicStyleBlock: hasDynamic,
  dynamicVarDefaultsInIndex: dynamicVars,
  nativeLoginStyleMovedToMainCss: noOldNativeStyle && mainCss.includes('ff-native-login-only-v1') || mainCss.includes('ff-native-app'),
  mainCssHasRootTokens: mainHasRoot,
  mainCssUsesHeaderH: mainHasHeaderVar,
  indexLineReduction: backup.split('\n').length - index.split('\n').length,
}, null, 2));

if (!cssMatch) {
  console.error('FAIL: main.css does not match backup style content');
  process.exit(1);
}
if (indexStyleCount !== 1 || !hasMainLink || !hasDynamic) {
  console.error('FAIL: index.html structure check');
  process.exit(1);
}
console.log('OK: verification passed');
