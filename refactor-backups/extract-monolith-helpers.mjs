#!/usr/bin/env node
/**
 * Extract monolith helper blocks from index.html (verbatim):
 *   G6 Utility functions  L3489–3533
 *   G2 DOM helpers        L3842–4021
 *   G4 Navigation helpers L12081–17632
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const INDEX = path.join(ROOT, 'public/index.html');
const BACKUP = path.join(ROOT, 'refactor-backups/index.html.pre-monolith-helpers-extract.bak');
const TOKEN = '20260704_monolith_helpers_extract';

const RANGES = {
  g6: { file: 'public/utility-functions.js', start: 3489, end: 3533, label: 'G6 Utility functions' },
  g2: { file: 'public/dom-helpers.js', start: 3842, end: 4021, label: 'G2 DOM helpers' },
  g4: {
    file: 'public/navigation-helpers.js',
    start: 12081,
    end: 17632,
    label: 'G4 Navigation helpers',
  },
};

function sliceBlock(lines, start, end) {
  const block = lines.slice(start - 1, end).join('\n');
  const anchorStart = lines[start - 1];
  const anchorEnd = lines[end - 1];
  return { block, anchorStart, anchorEnd };
}

function scriptTag(src) {
  return `</script>\n<script src="${src}?v=${TOKEN}"></script>\n<script>`;
}

const html = fs.readFileSync(INDEX, 'utf8');
const lines = html.split('\n');

fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
fs.copyFileSync(INDEX, BACKUP);

const extracted = {};
for (const [key, cfg] of Object.entries(RANGES)) {
  const { block, anchorStart, anchorEnd } = sliceBlock(lines, cfg.start, cfg.end);
  if (!block.trim()) {
    console.error(`FAIL: empty block ${key}`);
    process.exit(1);
  }
  extracted[key] = block;
  fs.writeFileSync(path.join(ROOT, cfg.file), block + '\n', 'utf8');
  console.log(`${cfg.label}: ${cfg.end - cfg.start + 1} lines -> ${cfg.file}`);
  console.log(`  start: ${anchorStart.slice(0, 72)}`);
  console.log(`  end:   ${anchorEnd.slice(0, 72)}`);
}

const { g6, g2, g4 } = RANGES;
const part1 = lines.slice(0, g6.start - 1);
const part2 = lines.slice(g6.end, g2.start - 1);
const part3 = lines.slice(g2.end, g4.start - 1);
const part4 = lines.slice(g4.end);

const newLines = [
  ...part1,
  scriptTag('/utility-functions.js'),
  ...part2,
  scriptTag('/dom-helpers.js'),
  ...part3,
  scriptTag('/navigation-helpers.js'),
  ...part4,
];

const newHtml = newLines.join('\n');
fs.writeFileSync(INDEX, newHtml, 'utf8');

for (const cfg of Object.values(RANGES)) {
  try {
    execSync(`node --check ${cfg.file}`, { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    console.error(`FAIL: syntax ${cfg.file}`, e.stderr?.toString());
    process.exit(1);
  }
}

console.log(
  JSON.stringify(
    {
      backup: BACKUP,
      token: TOKEN,
      files: Object.values(RANGES).map((r) => r.file),
      indexLinesBefore: lines.length,
      indexLinesAfter: newLines.length,
      linesExtracted: Object.values(RANGES).reduce((s, r) => s + (r.end - r.start + 1), 0),
      scriptSplits: 3,
    },
    null,
    2
  )
);
