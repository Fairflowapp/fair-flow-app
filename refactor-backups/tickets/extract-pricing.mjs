import fs from 'fs';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');
const lines = code.split('\n');

// Block: lines 1339..1474 (1-based) = indices 1338..1473 (136 lines: comment + 10 fns).
const B_START = 1338;
const B_END_EXCL = 1474; // indices 1338..1473
const blockLines = lines.slice(B_START, B_END_EXCL);        // 136 lines kept verbatim
const removeSlice = lines.slice(B_START, B_END_EXCL + 1);   // 137 lines: block + trailing blank (line 1475)

const NAMES = [
  'getSalonTaxRateForTickets','getTicketTaxConfig','ffAnyTicketTaxActive','isTicketProductLine',
  'isTicketServiceLine','computeLineSalesTax','computeLineSalesTaxAmount','computeTicketTotalsFromLines',
  'getTicketSalesTaxAmount','getTicketTaxBreakdown',
];

// ---- build tickets-pricing.js ----
const header = `/**
 * Tickets — sales-tax engine & line totals (Phase 2 extraction).
 *
 * Pure computation: resolves Product/Service tax config from Settings (window.ffGet*),
 * computes per-line sales tax, ticket totals, and tax breakdowns. No app state, no
 * imports, no injection. Verbatim move from tickets.js; behavior unchanged.
 */

`;
const exportsBlock = `\nexport {\n${NAMES.map(n => '  ' + n + ',').join('\n')}\n};\n`;
const moduleText = header + blockLines.join('\n') + '\n' + exportsBlock;
fs.writeFileSync('public/tickets-pricing.js', moduleText, 'utf8');

// ---- build new tickets.js ----
const before = lines.slice(0, B_START);
const after = lines.slice(B_END_EXCL + 1);
const remainingBody = before.concat(after).join('\n');
const usedNames = NAMES.filter(n => new RegExp('\\b' + n + '\\b').test(remainingBody));
const importLine = `import { ${usedNames.join(', ')} } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";`;

const INSERT_AT = 19; // right after the tickets-permissions import line (index 19 -> line 20)
const newLines = before.slice(0, INSERT_AT)
  .concat([importLine])
  .concat(before.slice(INSERT_AT))
  .concat(after);
fs.writeFileSync(SRC, newLines.join('\n'), 'utf8');

fs.writeFileSync('refactor-backups/tickets/manifest-pricing.json', JSON.stringify({
  blockStartIndex0: B_START, removeSlice, insertAt: INSERT_AT, insertedLines: [importLine], blockLines, usedNames,
}, null, 2));

console.log('extract done. block:', blockLines.length, '| removed:', removeSlice.length);
console.log('import-back:', usedNames.length, '/', NAMES.length, '->', JSON.stringify(usedNames));
console.log('NOT imported (unused in remaining tickets.js):', JSON.stringify(NAMES.filter(n => !usedNames.includes(n))));
