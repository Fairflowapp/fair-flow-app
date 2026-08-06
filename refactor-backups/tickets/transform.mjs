import fs from 'fs';
import { classify, TARGETS } from './common.mjs';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');

const REMOVE_LINES = new Set([22,23,24,26,27,28,29,30,31,33,35,36,37,38,39,40,41,42,43,44,48,50,52,54,120,122,281,282,283,284,285,286,287,288,289,290,291,1513,3105,3327,3517,3518,3519,3520,5265,5268,5269,5270,5271,5272,5273,5274,5275,5276,6791,6792]);
const IMPORT_LINE = 'import { ticketsState, TICKETS_PAGE_SIZE, _ticketSummaryPageSize } from "./tickets-state.js?v=20260630_tickets_state_split";';

const { convert, shorthand, skipped } = classify(code);
if (shorthand.length) { console.error('ABORT: shorthand sites present:', JSON.stringify(shorthand)); process.exit(1); }

const edits = convert.map(c => ({ start: c.start, end: c.end, replacement: 'ticketsState.' + c.name }));

const lines = code.split('\n');
const lineStartOffset = []; { let off = 0; for (let i = 0; i < lines.length; i++) { lineStartOffset[i] = off; off += lines[i].length + 1; } }
const manifestDecls = [];
for (const ln of REMOVE_LINES) {
  const idx0 = ln - 1;
  const start = lineStartOffset[idx0];
  const end = (idx0 + 1 < lines.length) ? lineStartOffset[idx0 + 1] : code.length;
  edits.push({ start, end, replacement: '' });
  manifestDecls.push({ index0: idx0, text: lines[idx0] });
}

const fmtMarker = 'import "./format-utils.js";\n';
const fmtPos = code.indexOf(fmtMarker);
if (fmtPos < 0) throw new Error('format-utils import marker not found');
const importInsertAt = fmtPos + fmtMarker.length;
edits.push({ start: importInsertAt, end: importInsertAt, replacement: IMPORT_LINE + '\n' });

edits.sort((a, b) => b.start - a.start || b.end - a.end);
let out = code;
for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);

fs.writeFileSync(SRC, out, 'utf8');
fs.writeFileSync('refactor-backups/tickets/manifest.json', JSON.stringify({
  importLine: IMPORT_LINE,
  names: [...TARGETS],
  decls: manifestDecls.sort((a, b) => a.index0 - b.index0),
}, null, 2));

console.log('forward done. ref-edits:', convert.length, 'decl-removed:', REMOVE_LINES.size, 'import:1');
console.log('skipped:', JSON.stringify(skipped));
