import fs from 'fs';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');
const lines = code.split('\n');

// Block: lines 243..1107 (1-based) = indices 242..1106 (865 lines).
const B_START = 242;
const B_END_EXCL = 1107; // indices 242..1106
const blockLines = lines.slice(B_START, B_END_EXCL);        // 865 lines verbatim
const removeSlice = lines.slice(B_START, B_END_EXCL + 1);   // 866 lines: block + trailing blank (line 1108)

// auto-detect top-level function names in the block (these are the exports).
const NAMES = [];
for (const ln of blockLines) {
  const m = ln.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (m) NAMES.push(m[1]);
}

const header = `/**
 * Tickets — service catalog DATA layer (Phase 3 extraction).
 *
 * Verbatim move of the per-location + shared service catalog data system from
 * tickets.js: account/refs helpers, shared-catalog load/apply/save, location
 * catalog, live onSnapshot subscriptions, services & serviceCategories CRUD.
 *
 * Depends on ticketsState (state) and getActiveLocationIdForTickets (permissions).
 * The two UI refresh callbacks it triggers (renderServicesCatalogV2, setupTicketsUI)
 * live in tickets.js and are injected via initTicketsCatalogData to avoid a cycle.
 */
import { collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, deleteField, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getActiveLocationIdForTickets } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";

let renderServicesCatalogV2, setupTicketsUI;
export function initTicketsCatalogData(deps) {
  renderServicesCatalogV2 = deps.renderServicesCatalogV2;
  setupTicketsUI = deps.setupTicketsUI;
}

`;
const exportsBlock = `\nexport {\n${NAMES.map(n => '  ' + n + ',').join('\n')}\n};\n`;
const moduleText = header + blockLines.join('\n') + '\n' + exportsBlock;
fs.writeFileSync('public/tickets-catalog-data.js', moduleText, 'utf8');

// ---- new tickets.js ----
const before = lines.slice(0, B_START);
const after = lines.slice(B_END_EXCL + 1);
const remainingBody = before.concat(after).join('\n');
const usedNames = NAMES.filter(n => new RegExp('\\b' + n + '\\b').test(remainingBody));
const importLine = `import { initTicketsCatalogData, ${usedNames.join(', ')} } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";`;
const initLine = `initTicketsCatalogData({ renderServicesCatalogV2, setupTicketsUI });`;

const INSERT_AT = 20; // after the tickets-pricing import (line 20 -> index 20)
const newLines = before.slice(0, INSERT_AT)
  .concat([importLine, initLine])
  .concat(before.slice(INSERT_AT))
  .concat(after);
fs.writeFileSync(SRC, newLines.join('\n'), 'utf8');

fs.writeFileSync('refactor-backups/tickets/manifest-catalog-data.json', JSON.stringify({
  blockStartIndex0: B_START, removeSlice, insertAt: INSERT_AT, insertedLines: [importLine, initLine], blockLines, usedNames, allNames: NAMES,
}, null, 2));

console.log('extract done. detected functions:', NAMES.length, '| block:', blockLines.length, '| removed:', removeSlice.length);
console.log('import-back:', usedNames.length, '/', NAMES.length);
console.log('NOT imported back:', JSON.stringify(NAMES.filter(n => !usedNames.includes(n))));
