import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = s => createHash('sha1').update(s).digest('hex');
const BACKUP = 'refactor-backups/tickets/tickets.pre-picker.js';
const NEW = 'public/tickets.js';
const MOD = 'public/tickets-picker.js';
const BLOCK_START = 657, BLOCK_END = 843;

const backup = readFileSync(BACKUP, 'utf8');
const neu = readFileSync(NEW, 'utf8');
const mod = readFileSync(MOD, 'utf8');

const backupLines = backup.split('\n');
const truthBlock = backupLines.slice(BLOCK_START - 1, BLOCK_END).join('\n');

// A. module contains block verbatim
console.log('A. module contains original block verbatim :', mod.includes(truthBlock) ? 'PASS' : 'FAIL');
console.log('   truth block sha:', sha(truthBlock));

// B. reversibility
const IMPORT_LINE = 'import { initTicketsPicker, setupTicketsUI, ffTicketServiceSearchClear, ffTicketServiceSearchSetVisible, updateNewTicketButtonVisibility, ensureTicketsBackgroundSubscription } from "./tickets-picker.js?v=20260701_tickets_picker_split";';
const INIT_LINE = 'initTicketsPicker({ doServiceSelect, getActiveTicketsSalonId, getProductsGroupedByCategory, getServicesGroupedByCategory, getTicketPriceForProductAndActiveLocation, isTicketPickerServiceAvailableForActiveLocation });';
const neuLines = neu.split('\n');
console.log('B0. import line at index 36 :', neuLines[36] === IMPORT_LINE ? 'PASS' : 'FAIL', '(', neuLines.indexOf(IMPORT_LINE), ')');
console.log('B0. init  line at index 37 :', neuLines[37] === INIT_LINE ? 'PASS' : 'FAIL', '(', neuLines.indexOf(INIT_LINE), ')');

// extract block from module between last-header-blank and footer
const fStart = mod.indexOf('\n\nexport {');
const hStart = mod.indexOf('}\n\n');   // end of initTicketsPicker fn
const modBlock = mod.slice(mod.indexOf('\n\n', hStart) + 2, fStart);
console.log('B1. module-extracted block == truth block :', modBlock === truthBlock ? 'PASS' : 'FAIL');

// rebuild: drop the 2 inserted lines, reinsert block+blank at original boundary
const without = [...neuLines.slice(0, 36), ...neuLines.slice(38)];
const insertAt = 656; // 0-based: original line 657 position
const rebuilt = [...without.slice(0, insertAt), ...modBlock.split('\n'), '', ...without.slice(insertAt)].join('\n');
console.log('B2. rebuilt tickets.js == backup :', sha(rebuilt) === sha(backup) ? 'PASS' : 'FAIL');
console.log('   backup sha :', sha(backup));
console.log('   rebuilt sha:', sha(rebuilt));

// C. wiring
console.log('\nC. tickets.js imports initTicketsPicker + 5 back:',
  ['initTicketsPicker','setupTicketsUI','ffTicketServiceSearchClear','ffTicketServiceSearchSetVisible','updateNewTicketButtonVisibility','ensureTicketsBackgroundSubscription'].every(n => neu.includes(n)) ? 'PASS' : 'FAIL');
console.log('   initTicketsPicker called with 6 deps:',
  /initTicketsPicker\({ doServiceSelect, getActiveTicketsSalonId, getProductsGroupedByCategory, getServicesGroupedByCategory, getTicketPriceForProductAndActiveLocation, isTicketPickerServiceAvailableForActiveLocation }\)/.test(neu) ? 'PASS' : 'FAIL');
console.log('   injections at 22/31/33/35 preserved (setupTicketsUI x4):',
  (neu.match(/setupTicketsUI/g)||[]).length >= 5 ? 'PASS' : 'FAIL');
console.log('   no leftover picker fn definitions in tickets.js:',
  !/function (setupTicketsUI|ffRenderTicketServiceSearch|ensureTicketsBackgroundSubscription)\b/.test(neu) ? 'PASS' : 'FAIL');
