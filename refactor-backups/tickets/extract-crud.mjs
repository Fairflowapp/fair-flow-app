import fs from 'fs';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');
const lines = code.split('\n');

// Block: 1-based lines 485..1085 = indices 484..1084.
//  - blockLines (verbatim moved): indices 484..1083 (1-based 485..1084) = section header + 23 functions.
//  - removeSlice: indices 484..1084 (1-based 485..1085) = block + trailing blank line 1085.
const B_START = 484;
const B_END_EXCL = 1084; // blockLines = slice(B_START, B_END_EXCL)
const blockLines = lines.slice(B_START, B_END_EXCL);          // verbatim
const removeSlice = lines.slice(B_START, B_END_EXCL + 1);     // block + trailing blank

// sanity: block must start at the CRUD section header and end at the last fn's closing brace
if (!/^\/\/ =+$/.test(blockLines[0]) || blockLines[1] !== '// Tickets CRUD') {
  throw new Error('block start mismatch: ' + JSON.stringify(blockLines.slice(0, 2)));
}
if (blockLines[blockLines.length - 1] !== '}') {
  throw new Error('block end mismatch: ' + JSON.stringify(blockLines[blockLines.length - 1]));
}
if (removeSlice[removeSlice.length - 1] !== '') {
  throw new Error('trailing blank mismatch: ' + JSON.stringify(removeSlice[removeSlice.length - 1]));
}

// auto-detect top-level function names in the block (these are the exports).
const NAMES = [];
for (const ln of blockLines) {
  const m = ln.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (m) NAMES.push(m[1]);
}

const header = `/**
 * Tickets — CRUD + live listener layer (Phase 4 extraction).
 *
 * Verbatim move from tickets.js of the ticket write/lifecycle system: local
 * pagination merge + patch, "Load more" paging, the live onSnapshot listener,
 * nav badge, create/update/finalize, close + summary append, reopen/void/archive,
 * service-upgrade flag + upgrade-points award, permanent delete + summary markers,
 * and front-desk "seen".
 *
 * Depends on ticketsState + TICKETS_PAGE_SIZE (state) and canSeeTicket +
 * getActiveLocationIdForTickets (permissions). Seven helpers that live in
 * tickets.js are injected via initTicketsCrud to avoid a cycle:
 *   getActiveTicketsSalonId, notifyTicketsAnalyticsDataChanged,
 *   ticketSubmittedAtDate, _fmtYmdLocal, showToast, renderTicketsList,
 *   closeTicketModal.
 */
import {
  collection, query, where, orderBy, limit, startAfter,
  doc, getDoc, getDocFromServer, getDocs, addDoc, updateDoc, deleteDoc, deleteField, onSnapshot,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState, TICKETS_PAGE_SIZE } from "./tickets-state.js?v=20260630_tickets_state_split";
import { canSeeTicket, getActiveLocationIdForTickets } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";

let getActiveTicketsSalonId, notifyTicketsAnalyticsDataChanged, ticketSubmittedAtDate, _fmtYmdLocal, showToast, renderTicketsList, closeTicketModal;
export function initTicketsCrud(deps) {
  getActiveTicketsSalonId = deps.getActiveTicketsSalonId;
  notifyTicketsAnalyticsDataChanged = deps.notifyTicketsAnalyticsDataChanged;
  ticketSubmittedAtDate = deps.ticketSubmittedAtDate;
  _fmtYmdLocal = deps._fmtYmdLocal;
  showToast = deps.showToast;
  renderTicketsList = deps.renderTicketsList;
  closeTicketModal = deps.closeTicketModal;
}

`;
const exportsBlock = `\nexport {\n${NAMES.map(n => '  ' + n + ',').join('\n')}\n};\n`;
const moduleText = header + blockLines.join('\n') + '\n' + exportsBlock;
fs.writeFileSync('public/tickets-crud.js', moduleText, 'utf8');

// ---- new tickets.js ----
const before = lines.slice(0, B_START);
const after = lines.slice(B_END_EXCL + 1);
const remainingBody = before.concat(after).join('\n');
const usedNames = NAMES.filter(n => new RegExp('\\b' + n + '\\b').test(remainingBody));
const importLine = `import { initTicketsCrud, ${usedNames.join(', ')} } from "./tickets-crud.js?v=20260630_tickets_crud_split";`;
const initLine = `initTicketsCrud({ getActiveTicketsSalonId, notifyTicketsAnalyticsDataChanged, ticketSubmittedAtDate, _fmtYmdLocal, showToast, renderTicketsList, closeTicketModal });`;

const INSERT_AT = 23; // after initTicketsPermissions (1-based line 23 -> index 22)
const newLines = before.slice(0, INSERT_AT)
  .concat([importLine, initLine])
  .concat(before.slice(INSERT_AT))
  .concat(after);
fs.writeFileSync(SRC, newLines.join('\n'), 'utf8');

fs.writeFileSync('refactor-backups/tickets/manifest-crud.json', JSON.stringify({
  blockStartIndex0: B_START, blockEndExcl: B_END_EXCL, removeSlice, insertAt: INSERT_AT,
  insertedLines: [importLine, initLine], blockLines, usedNames, allNames: NAMES,
}, null, 2));

console.log('extract done. detected functions:', NAMES.length, '| block:', blockLines.length, '| removed:', removeSlice.length);
console.log('import-back:', usedNames.length, '/', NAMES.length);
console.log('NOT imported back:', JSON.stringify(NAMES.filter(n => !usedNames.includes(n))));
console.log('all names:', JSON.stringify(NAMES));
