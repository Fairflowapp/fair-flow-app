import fs from 'fs';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');
const lines = code.split('\n');

// Block: 1-based lines 490..1097 = indices 489..1096 (608 lines, 36 fns).
// The "// Helpers" section header (487-489) STAYS in tickets.js (summary-UI fns remain under it).
//  - blockLines (verbatim moved): indices 489..1096 (1-based 490..1097).
//  - removeSlice: indices 489..1097 (1-based 490..1098) = block + trailing blank line 1098.
const B_START = 489;
const B_END_EXCL = 1097;
const blockLines = lines.slice(B_START, B_END_EXCL);
const removeSlice = lines.slice(B_START, B_END_EXCL + 1);

// sanity
if (blockLines[0] !== 'function ticketDateFromValue(value) {') {
  throw new Error('block start mismatch: ' + JSON.stringify(blockLines[0]));
}
if (blockLines[blockLines.length - 1] !== '}') {
  throw new Error('block end mismatch: ' + JSON.stringify(blockLines[blockLines.length - 1]));
}
if (removeSlice[removeSlice.length - 1] !== '') {
  throw new Error('trailing blank mismatch: ' + JSON.stringify(removeSlice[removeSlice.length - 1]));
}

// auto-detect top-level function names (exports)
const NAMES = [];
for (const ln of blockLines) {
  const m = ln.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (m) NAMES.push(m[1]);
}

const header = `/**
 * Tickets — date/format + summary computation helpers (Phase 5 extraction).
 *
 * Verbatim move from tickets.js of the pure/computational helper layer: date &
 * money formatting, date-range presets, CLOSED-tickets summary fetch (indexed +
 * client-scan fallback), staff matching, per-staff commission/supply-deduction
 * resolution, and the "by employee" summary row/total builders.
 *
 * Depends on ticketsState + _ticketSummaryPageSize (state), pricing
 * (getTicketTaxConfig, isTicketProductLine) and permissions (canSeeTicket,
 * getActiveLocationIdForTickets, isTicketsTechnicianRestrictedRole,
 * isStaffRecordManagerOrAdmin, ticketBelongsToTicketsTechnician). Five helpers
 * that live in tickets.js are injected via initTicketsHelpers to avoid a cycle:
 *   normalizeTicketTechName, getServiceStaffOverrides, getProductStaffOverrides,
 *   getStaffDefaultServiceCommission, getStaffDefaultSupplyDeduction.
 *
 * NOTE: ticketSubmittedAtDate + _fmtYmdLocal moved here but are still injected
 * into tickets-crud.js by tickets.js (which now imports them from this module).
 */
import {
  collection, query, where, orderBy, startAfter, limit, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState, _ticketSummaryPageSize } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getTicketTaxConfig, isTicketProductLine } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";
import { canSeeTicket, getActiveLocationIdForTickets, isTicketsTechnicianRestrictedRole, isStaffRecordManagerOrAdmin, ticketBelongsToTicketsTechnician } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";

let normalizeTicketTechName, getServiceStaffOverrides, getProductStaffOverrides, getStaffDefaultServiceCommission, getStaffDefaultSupplyDeduction;
export function initTicketsHelpers(deps) {
  normalizeTicketTechName = deps.normalizeTicketTechName;
  getServiceStaffOverrides = deps.getServiceStaffOverrides;
  getProductStaffOverrides = deps.getProductStaffOverrides;
  getStaffDefaultServiceCommission = deps.getStaffDefaultServiceCommission;
  getStaffDefaultSupplyDeduction = deps.getStaffDefaultSupplyDeduction;
}

`;
const exportsBlock = `\nexport {\n${NAMES.map(n => '  ' + n + ',').join('\n')}\n};\n`;
const moduleText = header + blockLines.join('\n') + '\n' + exportsBlock;
fs.writeFileSync('public/tickets-helpers.js', moduleText, 'utf8');

// ---- new tickets.js ----
const before = lines.slice(0, B_START);
const after = lines.slice(B_END_EXCL + 1);
const remainingBody = before.concat(after).join('\n');
const usedNames = NAMES.filter(n => new RegExp('\\b' + n + '\\b').test(remainingBody));
const importLine = `import { initTicketsHelpers, ${usedNames.join(', ')} } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";`;
const initLine = `initTicketsHelpers({ normalizeTicketTechName, getServiceStaffOverrides, getProductStaffOverrides, getStaffDefaultServiceCommission, getStaffDefaultSupplyDeduction });`;

const INSERT_AT = 25; // after initTicketsCrud (1-based line 25 -> index 24)
const newLines = before.slice(0, INSERT_AT)
  .concat([importLine, initLine])
  .concat(before.slice(INSERT_AT))
  .concat(after);
fs.writeFileSync(SRC, newLines.join('\n'), 'utf8');

fs.writeFileSync('refactor-backups/tickets/manifest-helpers.json', JSON.stringify({
  blockStartIndex0: B_START, blockEndExcl: B_END_EXCL, removeSlice, insertAt: INSERT_AT,
  insertedLines: [importLine, initLine], blockLines, usedNames, allNames: NAMES,
}, null, 2));

console.log('extract done. detected functions:', NAMES.length, '| block:', blockLines.length, '| removed:', removeSlice.length);
console.log('import-back:', usedNames.length, '/', NAMES.length);
console.log('NOT imported back:', JSON.stringify(NAMES.filter(n => !usedNames.includes(n))));
