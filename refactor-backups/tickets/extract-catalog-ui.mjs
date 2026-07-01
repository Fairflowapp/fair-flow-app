import fs from 'fs';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');
const lines = code.split('\n');

// Block: 1-based lines 967..2897 = indices 966..2896 (1931 lines).
//  Section "// UI: Service Catalog Modal" through addSharedServiceV2's closing brace.
//  setTicketsTab + "// UI: Tabs" (951-965) stay; Navigation (2899+) stays.
const B_START = 966;
const B_END_EXCL = 2897;
const blockLines = lines.slice(B_START, B_END_EXCL);
const removeSlice = lines.slice(B_START, B_END_EXCL + 1); // include trailing blank at 2898

// sanity
if (!/^\/\/ =+$/.test(blockLines[0]) || blockLines[1] !== '// UI: Service Catalog Modal') {
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
 * Tickets — Service Catalog V2 management UI (Phase 8 extraction).
 *
 * Verbatim move of the "UI: Service Catalog Modal / Service Catalog V2" section
 * out of tickets.js: the unified per-location catalog screen/modal — render
 * (categories + services collapsible list, two-pane detail), the Locations tab,
 * the Staff-services tab (eligibility, per-staff commission/supply overrides),
 * category/service context menus + popovers, drag-and-drop reordering, and the
 * add/edit mini-modal (editor) with its CRUD entry points.
 *
 * Imports catalog data + permissions + pricing/helpers + list from the already
 * extracted modules. Five tickets.js-resident helpers are injected via
 * initTicketsCatalogUI to avoid a cycle:
 *   showToast, ticketConfirm, setupTicketsUI, getServiceStaffOverrides,
 *   controlledStaffCanProvideService.
 *
 * NOTE: renderServicesCatalogV2 (injected into tickets-catalog-data) and
 * getStaffDefaultServiceCommission + getStaffDefaultSupplyDeduction (injected
 * into tickets-helpers) now live here; tickets.js imports them back to keep
 * injecting them into those modules (no behavioural change there).
 */
import { serverTimestamp, doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { ffCanManageServices, getTicketsAccountId, normalizeSharedCategoryName, sharedCategoryId, sharedServiceCatalogItemsRef, getSharedServicesForCatalogManager, getLocationServicesForCatalogManager, loadSharedCatalogForManager, loadLocationCatalogForManager, saveSharedService, saveSharedServiceCategory, deleteSharedServiceCategory, deleteSharedService, saveSharedServiceOverride, removeSharedServiceOverride, loadSharedServiceLocationOverridesForService, saveSharedServiceLocationOverride, _applyCatalogFilter, loadServices, saveService, deleteService, loadServiceCategories, saveServiceCategory, deleteServiceCategory } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";
import { ffTicketMoney, ffTicketCurSym } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";

let showToast, ticketConfirm, setupTicketsUI, getServiceStaffOverrides, controlledStaffCanProvideService;
export function initTicketsCatalogUI(deps) {
  showToast = deps.showToast;
  ticketConfirm = deps.ticketConfirm;
  setupTicketsUI = deps.setupTicketsUI;
  getServiceStaffOverrides = deps.getServiceStaffOverrides;
  controlledStaffCanProvideService = deps.controlledStaffCanProvideService;
}

`;
const exportsBlock = `\nexport {\n${NAMES.map(n => '  ' + n + ',').join('\n')}\n};\n`;
const moduleText = header + blockLines.join('\n') + '\n' + exportsBlock;
fs.writeFileSync('public/tickets-catalog-ui.js', moduleText, 'utf8');

// ---- new tickets.js ----
const before = lines.slice(0, B_START);
const after = lines.slice(B_END_EXCL + 1);
const remainingBody = before.concat(after).join('\n');
const usedNames = NAMES.filter(n => new RegExp('\\b' + n + '\\b').test(remainingBody));
const importLine = `import { initTicketsCatalogUI, ${usedNames.join(', ')} } from "./tickets-catalog-ui.js?v=20260630_tickets_catalog_ui_split";`;
const initLine = `initTicketsCatalogUI({ showToast, ticketConfirm, setupTicketsUI, getServiceStaffOverrides, controlledStaffCanProvideService });`;

const INSERT_AT = 31; // after initTicketsModal (1-based line 31 -> index 30)
const newLines = before.slice(0, INSERT_AT)
  .concat([importLine, initLine])
  .concat(before.slice(INSERT_AT))
  .concat(after);
fs.writeFileSync(SRC, newLines.join('\n'), 'utf8');

fs.writeFileSync('refactor-backups/tickets/manifest-catalog-ui.json', JSON.stringify({
  blockStartIndex0: B_START, blockEndExcl: B_END_EXCL, removeSlice, insertAt: INSERT_AT,
  insertedLines: [importLine, initLine], blockLines, usedNames, allNames: NAMES,
}, null, 2));

console.log('extract done. detected functions:', NAMES.length, '| block:', blockLines.length, '| removed:', removeSlice.length);
console.log('import-back:', usedNames.length, '/', NAMES.length);
console.log('NOT imported back:', JSON.stringify(NAMES.filter(n => !usedNames.includes(n))));
console.log('imported-back names:', JSON.stringify(usedNames));
