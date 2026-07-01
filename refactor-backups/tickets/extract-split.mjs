import fs from 'fs';

const SRC = 'public/tickets-catalog-ui.js';
const code = fs.readFileSync(SRC, 'utf8');
const lines = code.split('\n');

const SV = '20260630_catalog_ui_split3'; // ?v= for the 3 new sub-files

// Partition (0-based slice indices). Verified boundaries:
//   head: 1..37   (imports + initTicketsCatalogUI + blank)
//   A:    38..802  (render)
//   B:    803..1354 (tabs)
//   C:    1355..1968 (edit)
//   tail: 1969..EOF (export block)
const head = lines.slice(0, 37);
const A = lines.slice(37, 802);
const B = lines.slice(802, 1354);
const C = lines.slice(1354, 1968);
const tail = lines.slice(1968);

// sanity
if (A[0] !== '// =====================' || A[1] !== '// UI: Service Catalog Modal') throw new Error('A start: ' + JSON.stringify(A.slice(0, 2)));
if (!/^function renderServicesLocationsTabHtml/.test(B[0])) throw new Error('B start: ' + JSON.stringify(B[0]));
if (!/^function _ffShowServicesCategoryDetailMenu/.test(C[0])) throw new Error('C start: ' + JSON.stringify(C[0]));
if (A[A.length - 1] !== '' || B[B.length - 1] !== '') throw new Error('A/B trailing blank missing');
if (C[C.length - 1] !== '}') throw new Error('C end not }: ' + JSON.stringify(C[C.length - 1]));

const names = (arr) => arr.flatMap(l => { const m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/); return m ? [m[1]] : []; });
const NA = names(A), NB = names(B), NC = names(C);

const exportsBlock = (ns) => `\nexport {\n${ns.map(n => '  ' + n + ',').join('\n')}\n};\n`;

// ---------------- render.js (A) ----------------
const renderHeader = `/**
 * Tickets — Service Catalog V2: render layer (Phase 8b split from tickets-catalog-ui.js).
 *
 * The catalog screen/modal shell + mobile drill-down, open/close, the collapsible
 * categories+services list, the services-screen drag-drop, and the two-pane detail
 * renderer. Verbatim move; behaviour unchanged.
 *
 * Imports the per-service tab renderers from ./tickets-catalog-tabs.js and the
 * menus/DnD/editor entry points from ./tickets-catalog-edit.js (one-way: render
 * depends on tabs+edit, never the reverse — cycles are broken by injecting
 * renderServicesCatalogV2 / renderServicesScreenDetail / _ffIsServicesScreenRoot
 * into those modules from the barrel).
 *
 * showToast + setupTicketsUI are injected via initCatalogRender.
 */
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { ffCanManageServices, getSharedServicesForCatalogManager, getLocationServicesForCatalogManager, loadSharedCatalogForManager, loadLocationCatalogForManager, saveSharedService, saveService, loadServices, loadServiceCategories } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";
import { ffTicketMoney } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { renderServicesLocationsTabHtml, wireServicesLocationsTab, renderServicesStaffTabHtml, wireServicesStaffTab } from "./tickets-catalog-tabs.js?v=${SV}";
import { _ffShowServicesCategoryDetailMenu, _ffShowCategoryMenu, _ffShowServiceMenu, _ffCatalogEditorOpen, _ffCatalogEditorClose, _ffWireCatalogDragDrop, _ffClearDragHover } from "./tickets-catalog-edit.js?v=${SV}";

let showToast, setupTicketsUI;
export function initCatalogRender(deps) {
  showToast = deps.showToast;
  setupTicketsUI = deps.setupTicketsUI;
}

`;

// ---------------- tabs.js (B) ----------------
const tabsHeader = `/**
 * Tickets — Service Catalog V2: per-service detail tabs (Phase 8b split).
 *
 * The Locations tab (per-location price overrides) and the Staff-services tab
 * (eligibility + per-staff commission / supply-deduction overrides). Verbatim move.
 *
 * No import of the render layer — renderServicesCatalogV2 and
 * renderServicesScreenDetail are injected via initCatalogTabs to keep the module
 * graph acyclic. showToast, setupTicketsUI, getServiceStaffOverrides and
 * controlledStaffCanProvideService are injected too.
 */
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getSharedServicesForCatalogManager, getLocationServicesForCatalogManager, getTicketsAccountId, loadServices, loadSharedServiceLocationOverridesForService, saveSharedServiceLocationOverride, sharedServiceCatalogItemsRef, _applyCatalogFilter } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";
import { ffTicketMoney } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { serverTimestamp, doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

let showToast, setupTicketsUI, getServiceStaffOverrides, controlledStaffCanProvideService, renderServicesCatalogV2, renderServicesScreenDetail;
export function initCatalogTabs(deps) {
  showToast = deps.showToast;
  setupTicketsUI = deps.setupTicketsUI;
  getServiceStaffOverrides = deps.getServiceStaffOverrides;
  controlledStaffCanProvideService = deps.controlledStaffCanProvideService;
  renderServicesCatalogV2 = deps.renderServicesCatalogV2;
  renderServicesScreenDetail = deps.renderServicesScreenDetail;
}

`;

// ---------------- edit.js (C) ----------------
const editHeader = `/**
 * Tickets — Service Catalog V2: mutation UI (Phase 8b split).
 *
 * Context menus + popovers, catalog drag-and-drop reordering, and the shared
 * add/edit mini-modal (editor) with its CRUD entry points. Verbatim move.
 *
 * No import of the render layer — renderServicesCatalogV2 and _ffIsServicesScreenRoot
 * are injected via initCatalogEdit. showToast, ticketConfirm and setupTicketsUI
 * are injected too.
 */
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { ffCanManageServices, normalizeSharedCategoryName, sharedCategoryId, getSharedServicesForCatalogManager, getLocationServicesForCatalogManager, loadSharedCatalogForManager, loadServices, loadServiceCategories, saveSharedService, saveSharedServiceCategory, deleteSharedServiceCategory, deleteSharedService, saveSharedServiceOverride, removeSharedServiceOverride, saveService, saveServiceCategory, deleteService, deleteServiceCategory } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";
import { ffTicketCurSym } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";

let showToast, ticketConfirm, setupTicketsUI, renderServicesCatalogV2, _ffIsServicesScreenRoot;
export function initCatalogEdit(deps) {
  showToast = deps.showToast;
  ticketConfirm = deps.ticketConfirm;
  setupTicketsUI = deps.setupTicketsUI;
  renderServicesCatalogV2 = deps.renderServicesCatalogV2;
  _ffIsServicesScreenRoot = deps._ffIsServicesScreenRoot;
}

`;

fs.writeFileSync('public/tickets-catalog-render.js', renderHeader + A.join('\n') + '\n' + exportsBlock(NA), 'utf8');
fs.writeFileSync('public/tickets-catalog-tabs.js', tabsHeader + B.join('\n') + '\n' + exportsBlock(NB), 'utf8');
fs.writeFileSync('public/tickets-catalog-edit.js', editHeader + C.join('\n') + '\n' + exportsBlock(NC), 'utf8');

// ---------------- barrel: tickets-catalog-ui.js ----------------
const reexport = (ns, file) => `export {\n${ns.map(n => '  ' + n + ',').join('\n')}\n} from "./${file}?v=${SV}";\n`;
const barrel = `/**
 * Tickets — Service Catalog UI barrel (Phase 8b).
 *
 * tickets-catalog-ui.js was split into three focused modules:
 *   - tickets-catalog-render.js  (screen/modal shell, list + detail render, screen DnD)
 *   - tickets-catalog-tabs.js    (Locations + Staff-services per-service tabs)
 *   - tickets-catalog-edit.js    (context menus, catalog DnD, add/edit editor)
 *
 * This barrel preserves the original public API and the single initTicketsCatalogUI
 * entry point so tickets.js is unchanged. It fans the injected tickets.js helpers
 * out to each sub-module, and injects the render layer's entry points into the
 * tabs/edit modules (breaking the dependency cycle: render -> {tabs, edit}).
 */
import { initCatalogRender, renderServicesCatalogV2, renderServicesScreenDetail, _ffIsServicesScreenRoot } from "./tickets-catalog-render.js?v=${SV}";
import { initCatalogTabs } from "./tickets-catalog-tabs.js?v=${SV}";
import { initCatalogEdit } from "./tickets-catalog-edit.js?v=${SV}";

export function initTicketsCatalogUI(deps) {
  initCatalogRender({
    showToast: deps.showToast,
    setupTicketsUI: deps.setupTicketsUI,
  });
  initCatalogTabs({
    showToast: deps.showToast,
    setupTicketsUI: deps.setupTicketsUI,
    getServiceStaffOverrides: deps.getServiceStaffOverrides,
    controlledStaffCanProvideService: deps.controlledStaffCanProvideService,
    renderServicesCatalogV2,
    renderServicesScreenDetail,
  });
  initCatalogEdit({
    showToast: deps.showToast,
    ticketConfirm: deps.ticketConfirm,
    setupTicketsUI: deps.setupTicketsUI,
    renderServicesCatalogV2,
    _ffIsServicesScreenRoot,
  });
}

${reexport(NA, 'tickets-catalog-render.js')}
${reexport(NB, 'tickets-catalog-tabs.js')}
${reexport(NC, 'tickets-catalog-edit.js')}`;
fs.writeFileSync(SRC, barrel, 'utf8');

fs.writeFileSync('refactor-backups/tickets/manifest-split.json', JSON.stringify({
  head, A, B, C, tail, NA, NB, NC, SV,
}, null, 2));

console.log('split done.');
console.log('render.js:', NA.length, 'fns |', A.length, 'src lines');
console.log('tabs.js:  ', NB.length, 'fns |', B.length, 'src lines');
console.log('edit.js:  ', NC.length, 'fns |', C.length, 'src lines');
console.log('total fns:', NA.length + NB.length + NC.length);
