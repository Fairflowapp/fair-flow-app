#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const BACKUP = path.join(ROOT, 'refactor-backups/index.html.pre-monolith-helpers-extract.bak');
const INDEX = path.join(ROOT, 'public/index.html');
const TOKEN = '20260704_monolith_helpers_extract';

const RANGES = {
  g6: { file: 'public/utility-functions.js', start: 3489, end: 3533 },
  g2: { file: 'public/dom-helpers.js', start: 3842, end: 4021 },
  g4: { file: 'public/navigation-helpers.js', start: 12081, end: 17632 },
};

const backup = fs.readFileSync(BACKUP, 'utf8');
const index = fs.readFileSync(INDEX, 'utf8');
const backupLines = backup.split('\n');

function readExtract(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8').replace(/\n$/, '');
}

const g6 = readExtract(RANGES.g6.file);
const g2 = readExtract(RANGES.g2.file);
const g4 = readExtract(RANGES.g4.file);

const origG6 = backupLines.slice(RANGES.g6.start - 1, RANGES.g6.end).join('\n');
const origG2 = backupLines.slice(RANGES.g2.start - 1, RANGES.g2.end).join('\n');
const origG4 = backupLines.slice(RANGES.g4.start - 1, RANGES.g4.end).join('\n');

function reconstructHtml() {
  const { g6: r6, g2: r2, g4: r4 } = RANGES;
  const part1 = backupLines.slice(0, r6.start - 1);
  const part2 = backupLines.slice(r6.end, r2.start - 1);
  const part3 = backupLines.slice(r2.end, r4.start - 1);
  const part4 = backupLines.slice(r4.end);
  const split = (src) => `</script>\n<script src="${src}?v=${TOKEN}"></script>\n<script>`;
  return [
    ...part1,
    split('/utility-functions.js'),
    ...part2,
    split('/dom-helpers.js'),
    ...part3,
    split('/navigation-helpers.js'),
    ...part4,
  ].join('\n');
}

const reconstructed = reconstructHtml();
const checks = {
  backupExists: fs.existsSync(BACKUP),
  g6ByteIdentical: g6 === origG6,
  g2ByteIdentical: g2 === origG2,
  g4ByteIdentical: g4 === origG4,
  indexMatchesReconstruction: index === reconstructed,
  utilityScriptTag: index.includes(`<script src="/utility-functions.js?v=${TOKEN}"></script>`),
  domScriptTag: index.includes(`<script src="/dom-helpers.js?v=${TOKEN}"></script>`),
  navScriptTag: index.includes(`<script src="/navigation-helpers.js?v=${TOKEN}"></script>`),
  g6NotInline: !index.includes('/** Same idea as app.js ffSafeParseJSON'),
  g2NotInline: !index.includes('// Get elements - use getElementById for more reliable selection'),
  g4NotInline: !index.includes('// Navigation function to return to Queue view\nfunction goToQueue'),
  utilityHasFfSafeParseJSON: g6.includes('function ffSafeParseJSON'),
  utilityHasDollarHelpers: g6.includes('const $=s=>document.querySelector(s)'),
  domHasNameSelect: g2.includes('const nameSelect = document.getElementById("nameSelect")'),
  navHasGoToQueue: g4.includes('function goToQueue()'),
  navHasGoToTraining: g4.includes('async function goToTraining()'),
  navHasFfUserShouldRoute: g4.includes('window.ffUserShouldRouteToMyProfileOnly'),
  scriptSplitCount: (index.match(/<script src="\/utility-functions\.js/g) || []).length === 1,
  domSplitCount: (index.match(/<script src="\/dom-helpers\.js/g) || []).length === 1,
  navSplitCount: (index.match(/<script src="\/navigation-helpers\.js/g) || []).length === 1,
};

let ok = true;
for (const [k, v] of Object.entries(checks)) {
  if (!v) {
    console.error('FAIL:', k);
    ok = false;
  }
}

for (const f of Object.values(RANGES).map((r) => r.file)) {
  try {
    execSync(`node --check ${f}`, { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    console.error('FAIL: syntax', f, e.stderr?.toString());
    ok = false;
  }
}

const lineStats = {
  backupLines: backupLines.length,
  indexLines: index.split('\n').length,
  lineReduction: backupLines.length - index.split('\n').length,
  g6Lines: g6.split('\n').length,
  g2Lines: g2.split('\n').length,
  g4Lines: g4.split('\n').length,
};

console.log(JSON.stringify({ token: TOKEN, checks, lineStats }, null, 2));
if (!ok) process.exit(1);
console.log('OK: verification passed');
