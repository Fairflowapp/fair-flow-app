import fs from 'fs';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');
const lines = code.split('\n');

// Block: 1-based lines 949..1592 = indices 948..1591 (644 lines).
//  Sections "// UI: List" + "// Bulk select" through escapeHtml's closing brace.
//  - blockLines (verbatim moved): indices 948..1591 (1-based 949..1592).
//  - removeSlice: indices 948..1592 (1-based 949..1593) = block + trailing blank line 1593.
const B_START = 948;
const B_END_EXCL = 1592;
const blockLines = lines.slice(B_START, B_END_EXCL);
const removeSlice = lines.slice(B_START, B_END_EXCL + 1);

// sanity
if (!/^\/\/ =+$/.test(blockLines[0]) || blockLines[1] !== '// UI: List') {
  throw new Error('block start mismatch: ' + JSON.stringify(blockLines.slice(0, 2)));
}
if (blockLines[blockLines.length - 1] !== '}') {
  throw new Error('block end mismatch: ' + JSON.stringify(blockLines[blockLines.length - 1]));
}
if (removeSlice[removeSlice.length - 1] !== '') {
  throw new Error('trailing blank mismatch: ' + JSON.stringify(removeSlice[removeSlice.length - 1]));
}

// auto-detect top-level function declarations (exports). The window.ffRenderTicketCardHTML
// assignment is a side-effect line kept verbatim in the block, not an export.
const NAMES = [];
for (const ln of blockLines) {
  const m = ln.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (m) NAMES.push(m[1]);
}

const header = `/**
 * Tickets — list rendering + bulk select UI (Phase 6 extraction).
 *
 * Verbatim move from tickets.js of the "UI: List" + "Bulk select" sections:
 * list-line/initial display helpers, bulk archive/permanent-delete selection
 * (chunked Firestore batches), the shared ticket-card HTML builder (also exposed
 * as window.ffRenderTicketCardHTML for the Live Desk), the main renderTicketsList
 * hub, and status colour/escape helpers.
 *
 * Imports from state/crud/helpers/permissions. Eleven helpers that live in
 * tickets.js are injected via initTicketsList to avoid a cycle:
 *   getTicketTechnicianAvatarUrl, ticketHasRealPostSendEdit, ffFormatReviewedAt,
 *   openTicketModal, showToast, ticketConfirm, getActiveTicketsSalonId,
 *   loadAndRenderTicketsSummary, populateTicketsEmployeeSelect,
 *   syncTicketsTimePeriodSelectOptions, ensureTicketsSummaryDefaultTimePeriod.
 *
 * NOTE: renderTicketsList moved here; tickets.js imports it back to keep injecting
 * it into tickets-crud.js (no change to that module).
 */
import { collection, query, where, getDocs, doc, writeBatch, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { ffTicketsPatchLocalTicket, _rebuildCurrentTicketsMerged, updateTicketsLoadMoreUi, deleteTicketPermanently } from "./tickets-crud.js?v=20260630_tickets_crud_split";
import { ffTicketMoney, formatDate, passesTicketsDateFilter, ticketMatchesEmployeeFilter } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { canSeeTicket, updateTicketsTabsVisibility, canViewTicketsSummaryTab, canViewTicketsArchivedTab, ffTicketsSetTimePeriodFiltersVisible, updateTicketsEmployeeFilterVisibility, ffTicketsHideFrontDeskFiltersOnThisView, isTicketsTechnicianRestrictedRole, isStaffRecordManagerOrAdmin, getTicketsSelfEmployeeFilterId, ticketBelongsToTicketsTechnician } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";

let getTicketTechnicianAvatarUrl, ticketHasRealPostSendEdit, ffFormatReviewedAt, openTicketModal, showToast, ticketConfirm, getActiveTicketsSalonId, loadAndRenderTicketsSummary, populateTicketsEmployeeSelect, syncTicketsTimePeriodSelectOptions, ensureTicketsSummaryDefaultTimePeriod;
export function initTicketsList(deps) {
  getTicketTechnicianAvatarUrl = deps.getTicketTechnicianAvatarUrl;
  ticketHasRealPostSendEdit = deps.ticketHasRealPostSendEdit;
  ffFormatReviewedAt = deps.ffFormatReviewedAt;
  openTicketModal = deps.openTicketModal;
  showToast = deps.showToast;
  ticketConfirm = deps.ticketConfirm;
  getActiveTicketsSalonId = deps.getActiveTicketsSalonId;
  loadAndRenderTicketsSummary = deps.loadAndRenderTicketsSummary;
  populateTicketsEmployeeSelect = deps.populateTicketsEmployeeSelect;
  syncTicketsTimePeriodSelectOptions = deps.syncTicketsTimePeriodSelectOptions;
  ensureTicketsSummaryDefaultTimePeriod = deps.ensureTicketsSummaryDefaultTimePeriod;
}

`;
const exportsBlock = `\nexport {\n${NAMES.map(n => '  ' + n + ',').join('\n')}\n};\n`;
const moduleText = header + blockLines.join('\n') + '\n' + exportsBlock;
fs.writeFileSync('public/tickets-list.js', moduleText, 'utf8');

// ---- new tickets.js ----
const before = lines.slice(0, B_START);
const after = lines.slice(B_END_EXCL + 1);
const remainingBody = before.concat(after).join('\n');
const usedNames = NAMES.filter(n => new RegExp('\\b' + n + '\\b').test(remainingBody));
const importLine = `import { initTicketsList, ${usedNames.join(', ')} } from "./tickets-list.js?v=20260630_tickets_list_split";`;
const initLine = `initTicketsList({ getTicketTechnicianAvatarUrl, ticketHasRealPostSendEdit, ffFormatReviewedAt, openTicketModal, showToast, ticketConfirm, getActiveTicketsSalonId, loadAndRenderTicketsSummary, populateTicketsEmployeeSelect, syncTicketsTimePeriodSelectOptions, ensureTicketsSummaryDefaultTimePeriod });`;

const INSERT_AT = 27; // after initTicketsHelpers (1-based line 27 -> index 26)
const newLines = before.slice(0, INSERT_AT)
  .concat([importLine, initLine])
  .concat(before.slice(INSERT_AT))
  .concat(after);
fs.writeFileSync(SRC, newLines.join('\n'), 'utf8');

fs.writeFileSync('refactor-backups/tickets/manifest-list.json', JSON.stringify({
  blockStartIndex0: B_START, blockEndExcl: B_END_EXCL, removeSlice, insertAt: INSERT_AT,
  insertedLines: [importLine, initLine], blockLines, usedNames, allNames: NAMES,
}, null, 2));

console.log('extract done. detected functions:', NAMES.length, '| block:', blockLines.length, '| removed:', removeSlice.length);
console.log('import-back:', usedNames.length, '/', NAMES.length);
console.log('NOT imported back:', JSON.stringify(NAMES.filter(n => !usedNames.includes(n))));
console.log('all names:', JSON.stringify(NAMES));
