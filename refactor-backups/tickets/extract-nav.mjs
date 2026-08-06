import fs from 'fs';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');
const lines = code.split('\n');

// Block: 1-based 969..1181 => indices 968..1180 (213 lines).
//  "// Navigation" header + goToTickets + goToServices + window.__ffGoToTicketsReal assignment.
const B_START = 968;
const B_END_EXCL = 1181;
const blockLines = lines.slice(B_START, B_END_EXCL);
const removeSlice = lines.slice(B_START, B_END_EXCL + 1); // include trailing blank (line 1182)

// sanity
if (!/^\/\/ =+$/.test(blockLines[0]) || blockLines[1] !== '// Navigation') throw new Error('start: ' + JSON.stringify(blockLines.slice(0, 2)));
if (blockLines[blockLines.length - 1] !== '} catch (e) {}') throw new Error('end: ' + JSON.stringify(blockLines[blockLines.length - 1]));
if (removeSlice[removeSlice.length - 1] !== '') throw new Error('trailing blank: ' + JSON.stringify(removeSlice[removeSlice.length - 1]));

// exported names (inline `export function` in the block — no extra export block needed)
const NAMES = [];
for (const ln of blockLines) {
  const m = ln.match(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (m) NAMES.push(m[1]);
}

const header = `/**
 * Tickets — Navigation (Phase 9a extraction).
 *
 * goToTickets / goToServices: screen-switching entry points that hide the other
 * app screens, activate the Tickets / Services screen, and kick off the relevant
 * data load + render. Verbatim move out of tickets.js; behaviour unchanged.
 *
 * Both are exported (inline) and re-imported by tickets.js so initTickets can keep
 * wiring window.goToTickets / window.goToServices. The window.__ffGoToTicketsReal
 * assignment moves here and runs at module-eval time (same as before).
 *
 * Six tickets.js-resident helpers are injected via initTicketsNav to avoid a cycle:
 *   showToast, loadCurrentUserProfile, enrichTicketsProfileFromMemberDoc,
 *   loadTicketsMembersForAvatars, setupTicketsUI, updateNewTicketButtonVisibility.
 */
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { subscribeTickets, updateTicketsNavBadge } from "./tickets-crud.js?v=20260630_tickets_crud_split";
import { renderTicketsList } from "./tickets-list.js?v=20260630_tickets_list_split";
import { ffCanViewServices, loadServiceCategories, loadServices, loadSharedCatalogForManager, seedSharedServiceCatalogFromLocationCatalogIfEmpty, loadLocationCatalogForManager } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";
import { _ffEnsureCatalogEditorPortal, _ffServicesMobileShowList, renderServicesCatalogV2 } from "./tickets-catalog-ui.js?v=20260630_tickets_catalog_ui_split3";

let showToast, loadCurrentUserProfile, enrichTicketsProfileFromMemberDoc, loadTicketsMembersForAvatars, setupTicketsUI, updateNewTicketButtonVisibility;
export function initTicketsNav(deps) {
  showToast = deps.showToast;
  loadCurrentUserProfile = deps.loadCurrentUserProfile;
  enrichTicketsProfileFromMemberDoc = deps.enrichTicketsProfileFromMemberDoc;
  loadTicketsMembersForAvatars = deps.loadTicketsMembersForAvatars;
  setupTicketsUI = deps.setupTicketsUI;
  updateNewTicketButtonVisibility = deps.updateNewTicketButtonVisibility;
}

`;
const moduleText = header + blockLines.join('\n') + '\n';
fs.writeFileSync('public/tickets-nav.js', moduleText, 'utf8');

// ---- new tickets.js ----
const before = lines.slice(0, B_START);
const after = lines.slice(B_END_EXCL + 1);
const importLine = `import { initTicketsNav, ${NAMES.join(', ')} } from "./tickets-nav.js?v=20260630_tickets_nav_split";`;
const initLine = `initTicketsNav({ showToast, loadCurrentUserProfile, enrichTicketsProfileFromMemberDoc, loadTicketsMembersForAvatars, setupTicketsUI, updateNewTicketButtonVisibility });`;

const INSERT_AT = 33; // after initTicketsCatalogUI (1-based line 33 -> index 32)
const newLines = before.slice(0, INSERT_AT)
  .concat([importLine, initLine])
  .concat(before.slice(INSERT_AT))
  .concat(after);
fs.writeFileSync(SRC, newLines.join('\n'), 'utf8');

fs.writeFileSync('refactor-backups/tickets/manifest-nav.json', JSON.stringify({
  blockStartIndex0: B_START, blockEndExcl: B_END_EXCL, removeSlice, insertAt: INSERT_AT,
  insertedLines: [importLine, initLine], blockLines, allNames: NAMES,
}, null, 2));

console.log('extract done. exported (inline):', JSON.stringify(NAMES), '| block:', blockLines.length, '| removed:', removeSlice.length);
