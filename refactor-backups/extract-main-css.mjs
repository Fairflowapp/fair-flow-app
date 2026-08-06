#!/usr/bin/env node
/**
 * One-shot: extract all <style> blocks from public/index.html → public/main.css
 * Keep a tiny inline block for the 3 JS-driven layout custom properties.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const INDEX = path.join(ROOT, 'public/index.html');
const BACKUP = path.join(ROOT, 'refactor-backups/index.html.pre-css-extract.bak');
const MAIN_CSS = path.join(ROOT, 'public/main.css');
const CSS_TOKEN = '20260704_main_css_extract';

const DYNAMIC_STYLE = `<style id="ff-dynamic-layout-vars">
  /* Defaults until setHeaderH() / positionMenu() override via JS */
  :root {
    --header-h: 60px;
  }
  #queueControls {
    --ff-join-more-top: 170px;
    --ff-join-more-right: 14px;
  }
</style>`;

const LINK_TAG = `<link rel="stylesheet" href="/main.css?v=${CSS_TOKEN}">`;

const html = fs.readFileSync(INDEX, 'utf8');

fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
fs.copyFileSync(INDEX, BACKUP);

const styleRe = /<style(\s[^>]*)?>([\s\S]*?)<\/style>/gi;
const chunks = [];
let match;
let blockCount = 0;
while ((match = styleRe.exec(html)) !== null) {
  blockCount++;
  chunks.push(match[2]);
}

if (blockCount === 0) {
  console.error('No <style> blocks found');
  process.exit(1);
}

const mainCss = chunks.join('\n\n');
fs.writeFileSync(MAIN_CSS, mainCss, 'utf8');

let newHtml = html.replace(styleRe, '');
const fontsLink =
  '<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">';
const injection = `${LINK_TAG}\n${DYNAMIC_STYLE}`;
if (!newHtml.includes(fontsLink)) {
  console.error('Could not find Google Fonts link anchor');
  process.exit(1);
}
newHtml = newHtml.replace(fontsLink, `${fontsLink}\n${injection}`);

const remainingStyles = [...newHtml.matchAll(/<style[\s>]/gi)];
if (remainingStyles.length !== 1) {
  console.error(`Expected 1 remaining <style> block, found ${remainingStyles.length}`);
  process.exit(1);
}

fs.writeFileSync(INDEX, newHtml, 'utf8');

const cssLines = mainCss.split('\n').length;
const indexLines = newHtml.split('\n').length;
console.log(JSON.stringify({
  backup: BACKUP,
  mainCss: MAIN_CSS,
  cssToken: CSS_TOKEN,
  styleBlocksExtracted: blockCount,
  mainCssLines: cssLines,
  mainCssBytes: Buffer.byteLength(mainCss, 'utf8'),
  indexHtmlLines: indexLines,
  indexHtmlBytes: Buffer.byteLength(newHtml, 'utf8'),
  backupLines: html.split('\n').length,
}, null, 2));
