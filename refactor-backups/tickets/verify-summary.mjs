import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = s => createHash('sha1').update(s).digest('hex');
const BACKUP = 'refactor-backups/tickets/tickets.pre-summary.js';
const NEW = 'public/tickets.js';
const MOD = 'public/tickets-summary.js';
const BLOCK_START = 500, BLOCK_END = 817, TRAILING_BLANK = 818;

const backup = readFileSync(BACKUP, 'utf8');
const neu = readFileSync(NEW, 'utf8');
const mod = readFileSync(MOD, 'utf8');

const backupLines = backup.split('\n');
const truthBlock = backupLines.slice(BLOCK_START - 1, BLOCK_END).join('\n');

// ---- Check A: module contains the block verbatim ----
const containsBlock = mod.includes(truthBlock);
console.log('A. module contains original block verbatim :', containsBlock ? 'PASS' : 'FAIL');
console.log('   truth block sha:', sha(truthBlock));

// ---- Check B: reversibility (rebuild original from NEW + MOD) ----
const IMPORT_LINE = 'import { loadAndRenderTicketsSummary, populateTicketsEmployeeSelect, syncTicketsTimePeriodSelectOptions, ensureTicketsSummaryDefaultTimePeriod, setupTicketsDateFilters } from "./tickets-summary.js?v=20260630_tickets_summary_split";';
const neuLines = neu.split('\n');
const importIdx = neuLines.indexOf(IMPORT_LINE);
console.log('B0. import line present at index          :', importIdx, importIdx === 35 ? '(expected 35)' : '(UNEXPECTED)');

// extract block from module by slicing between header/footer markers
const hStart = mod.indexOf('\n\n', mod.indexOf('import { loadServices')); // after last import line
const fStart = mod.indexOf('\n\nexport {');
const modBlock = mod.slice(hStart + 2, fStart);
console.log('B1. module-extracted block == truth block :', modBlock === truthBlock ? 'PASS' : 'FAIL');

// remove import line, reinsert block+blank at header boundary
const without = [...neuLines.slice(0, importIdx), ...neuLines.slice(importIdx + 1)];
// header line 499 (last // ===) is now at index 498 (since we removed the import that was BEFORE it... )
// after removing import at 35, midKeep (orig 36..499) sits at indices 35..498 -> line 499 == index 498
const insertAt = 499; // reinsert block starting where orig line 500 was (index 499)
const rebuilt = [...without.slice(0, insertAt), ...modBlock.split('\n'), '', ...without.slice(insertAt)].join('\n');
console.log('B2. rebuilt tickets.js == backup          :', sha(rebuilt) === sha(backup) ? 'PASS' : 'FAIL');
console.log('   backup sha :', sha(backup));
console.log('   rebuilt sha:', sha(rebuilt));

// ---- Check C: wiring in new tickets.js ----
const need = ['loadAndRenderTicketsSummary','populateTicketsEmployeeSelect','syncTicketsTimePeriodSelectOptions','ensureTicketsSummaryDefaultTimePeriod','setupTicketsDateFilters'];
console.log('\nC. tickets.js imports back:', need.every(n => neu.includes(n)) ? 'PASS' : 'FAIL');
console.log('   initTicketsList still injects 4 summary fns:',
  /initTicketsList\({[^}]*loadAndRenderTicketsSummary[^}]*populateTicketsEmployeeSelect[^}]*syncTicketsTimePeriodSelectOptions[^}]*ensureTicketsSummaryDefaultTimePeriod/.test(neu) ? 'PASS' : 'FAIL');
console.log('   setupTicketsDateFilters() call kept:', /setupTicketsDateFilters\(\)/.test(neu) ? 'PASS' : 'FAIL');
console.log('   no leftover summary fn definitions in tickets.js:',
  !/function (paintTicketsSummaryTable|loadAndRenderTicketsSummary|setupTicketsDateFilters)\b/.test(neu) ? 'PASS' : 'FAIL');
