import fs from 'fs';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');
const lines = code.split('\n');

// Block to move: lines 1474..1774 (1-based) = indices 1473..1773 (301 lines: header + 19 fns).
const B_START = 1473;            // 0-based index of line 1474
const B_END_EXCL = 1774;         // exclusive -> indices 1473..1773
const blockLines = lines.slice(B_START, B_END_EXCL);     // 301 lines (kept verbatim in new module)
const removeSlice = lines.slice(B_START, B_END_EXCL + 1); // 302 lines: block + trailing blank (line 1775)

const NAMES = [
  'loadFrontDeskRecipients','getAutoFrontDeskRecipients','getTicketVisibility','_ticketsCurrentStaffRow',
  'getTicketsStaffPermissions','canViewTicketsSummaryTab','canViewTicketsArchivedTab','canCurrentUserCloseTickets',
  'updateTicketsTabsVisibility','ffTicketsSetTimePeriodFiltersVisible','isStaffRecordManagerOrAdmin',
  'isTicketsTechnicianRestrictedRole','ffTicketsIsMobileViewport','ffTicketsHideFrontDeskFiltersOnThisView',
  'getTicketsSelfEmployeeFilterId','ticketBelongsToTicketsTechnician','updateTicketsEmployeeFilterVisibility',
  'getActiveLocationIdForTickets','canSeeTicket',
];

// ---- build tickets-permissions.js ----
const header = `/**
 * Tickets — permissions, front-desk recipients & ticket visibility (Phase 1 extraction).
 *
 * Verbatim move of the permission / front-desk / visibility cluster from tickets.js.
 * No behavior change. \`normalizeTicketTechName\` stays in tickets.js (used widely there)
 * and is injected via initTicketsPermissions to avoid a circular import.
 */
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";

let normalizeTicketTechName;
export function initTicketsPermissions(deps) {
  normalizeTicketTechName = deps.normalizeTicketTechName;
}

`;
const exportsBlock = `\nexport {\n${NAMES.map(n => '  ' + n + ',').join('\n')}\n};\n`;
const moduleText = header + blockLines.join('\n') + '\n' + exportsBlock;
fs.writeFileSync('public/tickets-permissions.js', moduleText, 'utf8');

// ---- build new tickets.js ----
const before = lines.slice(0, B_START);
const after = lines.slice(B_END_EXCL + 1); // skip the 302 removed lines

// import-back: only names actually referenced in the remaining body.
const remainingBody = before.concat(after).join('\n');
const usedNames = NAMES.filter(n => new RegExp('\\b' + n + '\\b').test(remainingBody));
const importLine = `import { initTicketsPermissions, ${usedNames.join(', ')} } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";`;
const initLine = `initTicketsPermissions({ normalizeTicketTechName });`;

// insert after index 17 (line 18 = tickets-state import).
const INSERT_AT = 18;
const newLines = before.slice(0, INSERT_AT)
  .concat([importLine, initLine])
  .concat(before.slice(INSERT_AT))
  .concat(after);
fs.writeFileSync(SRC, newLines.join('\n'), 'utf8');

fs.writeFileSync('refactor-backups/tickets/manifest-permissions.json', JSON.stringify({
  blockStartIndex0: B_START,
  removeSlice,
  insertAt: INSERT_AT,
  insertedLines: [importLine, initLine],
  blockLines,
  usedNames,
}, null, 2));

console.log('extract done.');
console.log('block lines:', blockLines.length, '| removed (incl trailing blank):', removeSlice.length);
console.log('import-back names:', usedNames.length, '/', NAMES.length);
const notUsed = NAMES.filter(n => !usedNames.includes(n));
console.log('NOT imported back (internal-only):', JSON.stringify(notUsed));
