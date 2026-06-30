import fs from 'fs';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');
const lines = code.split('\n');

// Block: 1-based lines 965..2059 = indices 964..2058 (1095 lines).
//  Section "// UI: Ticket Modal (create/edit)" through doCloseTicket's closing brace.
//  setTicketsTab + "// UI: Tabs" (951-964) stay in tickets.js.
const B_START = 964;
const B_END_EXCL = 2059;
const blockLines = lines.slice(B_START, B_END_EXCL);
const removeSlice = lines.slice(B_START, B_END_EXCL + 1);

// sanity
if (!/^\/\/ =+$/.test(blockLines[0]) || blockLines[1] !== '// UI: Ticket Modal (create/edit)') {
  throw new Error('block start mismatch: ' + JSON.stringify(blockLines.slice(0, 2)));
}
if (blockLines[blockLines.length - 1] !== '}') {
  throw new Error('block end mismatch: ' + JSON.stringify(blockLines[blockLines.length - 1]));
}
if (removeSlice[removeSlice.length - 1] !== '') {
  throw new Error('trailing blank mismatch: ' + JSON.stringify(removeSlice[removeSlice.length - 1]));
}

// auto-detect top-level function declarations (exports)
const NAMES = [];
for (const ln of blockLines) {
  const m = ln.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (m) NAMES.push(m[1]);
}

const header = `/**
 * Tickets — ticket modal: create/edit form + line editing (Phase 7 extraction).
 *
 * Verbatim move of the "UI: Ticket Modal (create/edit)" section out of tickets.js:
 * the create/edit + admin + details modals (open/close), reviewed toggle,
 * customer-name requirement UI, form reset/populate, performed-line editing
 * (add service/product, price/note edits, totals/diff), service-upgrade control,
 * and the save/send/finalize/close action handlers.
 *
 * Imports from state/crud/list/helpers/pricing/permissions/catalog-data. Ten
 * tickets.js helpers are injected via initTicketsModal to avoid a cycle:
 *   showToast, ticketConfirm, computeDiff, ffTicketLinesChanged,
 *   ffRenderFrontDeskChangesHtml, ffTicketServiceSearchClear,
 *   ffTicketServiceSearchSetVisible, setupTicketsUI,
 *   getTicketPriceForServiceAndCurrentStaff, getTicketPriceForProductAndActiveLocation.
 *
 * NOTE: closeTicketModal (injected into tickets-crud) and openTicketModal +
 * ffFormatReviewedAt (injected into tickets-list) now live here; tickets.js
 * imports them back to keep injecting them into those modules (no change there).
 */
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { updateTicketsNavBadge, markTicketSeenByFrontDesk, updateTicket, reopenTicket, archiveTicket, deleteTicketPermanently, setTicketServiceUpgrade, awardTicketUpgradePoints, createTicket, finalizeTicket, getTicketCustomerPriceApprovedFromForm, closeTicket } from "./tickets-crud.js?v=20260630_tickets_crud_split";
import { renderTicketsList, escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { ffTicketMoney, ffTicketCurSym, formatTicketDisplayDateTime } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { computeTicketTotalsFromLines } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";
import { canSeeTicket, canCurrentUserCloseTickets, getTicketVisibility, getAutoFrontDeskRecipients } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import { loadServiceCategories, loadServices } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";

let showToast, ticketConfirm, computeDiff, ffTicketLinesChanged, ffRenderFrontDeskChangesHtml, ffTicketServiceSearchClear, ffTicketServiceSearchSetVisible, setupTicketsUI, getTicketPriceForServiceAndCurrentStaff, getTicketPriceForProductAndActiveLocation;
export function initTicketsModal(deps) {
  showToast = deps.showToast;
  ticketConfirm = deps.ticketConfirm;
  computeDiff = deps.computeDiff;
  ffTicketLinesChanged = deps.ffTicketLinesChanged;
  ffRenderFrontDeskChangesHtml = deps.ffRenderFrontDeskChangesHtml;
  ffTicketServiceSearchClear = deps.ffTicketServiceSearchClear;
  ffTicketServiceSearchSetVisible = deps.ffTicketServiceSearchSetVisible;
  setupTicketsUI = deps.setupTicketsUI;
  getTicketPriceForServiceAndCurrentStaff = deps.getTicketPriceForServiceAndCurrentStaff;
  getTicketPriceForProductAndActiveLocation = deps.getTicketPriceForProductAndActiveLocation;
}

`;
const exportsBlock = `\nexport {\n${NAMES.map(n => '  ' + n + ',').join('\n')}\n};\n`;
const moduleText = header + blockLines.join('\n') + '\n' + exportsBlock;
fs.writeFileSync('public/tickets-modal.js', moduleText, 'utf8');

// ---- new tickets.js ----
const before = lines.slice(0, B_START);
const after = lines.slice(B_END_EXCL + 1);
const remainingBody = before.concat(after).join('\n');
const usedNames = NAMES.filter(n => new RegExp('\\b' + n + '\\b').test(remainingBody));
const importLine = `import { initTicketsModal, ${usedNames.join(', ')} } from "./tickets-modal.js?v=20260630_tickets_modal_split";`;
const initLine = `initTicketsModal({ showToast, ticketConfirm, computeDiff, ffTicketLinesChanged, ffRenderFrontDeskChangesHtml, ffTicketServiceSearchClear, ffTicketServiceSearchSetVisible, setupTicketsUI, getTicketPriceForServiceAndCurrentStaff, getTicketPriceForProductAndActiveLocation });`;

const INSERT_AT = 29; // after initTicketsList (1-based line 29 -> index 28)
const newLines = before.slice(0, INSERT_AT)
  .concat([importLine, initLine])
  .concat(before.slice(INSERT_AT))
  .concat(after);
fs.writeFileSync(SRC, newLines.join('\n'), 'utf8');

fs.writeFileSync('refactor-backups/tickets/manifest-modal.json', JSON.stringify({
  blockStartIndex0: B_START, blockEndExcl: B_END_EXCL, removeSlice, insertAt: INSERT_AT,
  insertedLines: [importLine, initLine], blockLines, usedNames, allNames: NAMES,
}, null, 2));

console.log('extract done. detected functions:', NAMES.length, '| block:', blockLines.length, '| removed:', removeSlice.length);
console.log('import-back:', usedNames.length, '/', NAMES.length);
console.log('NOT imported back:', JSON.stringify(NAMES.filter(n => !usedNames.includes(n))));
console.log('all names:', JSON.stringify(NAMES));
