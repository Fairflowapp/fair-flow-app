import fs from 'fs';
import * as acorn from 'acorn';

const code = fs.readFileSync('public/tickets.js', 'utf8');
const lines = code.split('\n');

// Block: 1-based 967..2897 => indices 966..2896
const B_START = 966;
const B_END_EXCL = 2897;
const blockLines = lines.slice(B_START, B_END_EXCL);
const blockText = blockLines.join('\n');

// sanity
if (!/^\/\/ =+$/.test(blockLines[0]) || blockLines[1] !== '// UI: Service Catalog Modal') {
  throw new Error('block start mismatch: ' + JSON.stringify(blockLines.slice(0, 2)));
}
if (blockLines[blockLines.length - 1] !== '}') {
  throw new Error('block end mismatch: ' + JSON.stringify(blockLines[blockLines.length - 1]));
}

// Parse the block as a module. It is a sequence of function declarations + comments.
const ast = acorn.parse(blockText, { ecmaVersion: 2023, sourceType: 'module', locations: true });

// Collect top-level declared function names (the module's own exports/locals).
const localTop = new Set();
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration' && n.id) localTop.add(n.id.name);
}

// Free-variable analysis: walk with scope tracking.
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const free = new Map(); // name -> count

function collectBoundInFunction(node, bound) {
  // params
  const addPat = (p) => {
    if (!p) return;
    switch (p.type) {
      case 'Identifier': bound.add(p.name); break;
      case 'AssignmentPattern': addPat(p.left); break;
      case 'RestElement': addPat(p.argument); break;
      case 'ArrayPattern': p.elements.forEach(addPat); break;
      case 'ObjectPattern': p.properties.forEach(pr => addPat(pr.type === 'RestElement' ? pr.argument : pr.value)); break;
    }
  };
  (node.params || []).forEach(addPat);
  if (node.id && node.type === 'FunctionExpression') bound.add(node.id.name);
}

function walk(node, scopes) {
  if (!node || typeof node.type !== 'string') return;

  // New scope for functions
  if (FN.has(node.type)) {
    const bound = new Set();
    collectBoundInFunction(node, bound);
    // hoist var/function decls + collect let/const at body level
    const body = node.body;
    if (body && body.type === 'BlockStatement') hoist(body.body, bound);
    else if (node.type === 'ArrowFunctionExpression' && body && body.type !== 'BlockStatement') { /* expr body */ }
    const newScopes = scopes.concat(bound);
    if (body) {
      if (body.type === 'BlockStatement') body.body.forEach(c => walk(c, newScopes));
      else walk(body, newScopes);
    }
    return;
  }

  if (node.type === 'BlockStatement') {
    const bound = new Set();
    hoist(node.body, bound);
    const newScopes = scopes.concat(bound);
    node.body.forEach(c => walk(c, newScopes));
    return;
  }

  if (node.type === 'CatchClause') {
    const bound = new Set();
    if (node.param && node.param.type === 'Identifier') bound.add(node.param.name);
    const newScopes = scopes.concat(bound);
    walk(node.body, newScopes);
    return;
  }

  // Identifier reference
  if (node.type === 'Identifier') return; // handled by parent contexts below

  // Handle member/property/keys to avoid false refs
  for (const k in node) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = node[k];
    if (Array.isArray(v)) { v.forEach(c => visitChild(node, k, c, scopes)); }
    else if (v && typeof v === 'object' && typeof v.type === 'string') visitChild(node, k, v, scopes);
  }
}

function visitChild(parent, key, child, scopes) {
  if (!child || typeof child.type !== 'string') return;
  if (child.type === 'Identifier') {
    const pt = parent.type;
    if (pt === 'MemberExpression' && key === 'property' && !parent.computed) return;
    if (pt === 'Property' && key === 'key' && !parent.computed) return;
    if (pt === 'LabeledStatement' || pt === 'BreakStatement' || pt === 'ContinueStatement') return;
    const name = child.name;
    // bound in any enclosing scope or top-level local?
    const boundSomewhere = scopes.some(s => s.has(name)) || localTop.has(name);
    if (!boundSomewhere) free.set(name, (free.get(name) || 0) + 1);
    return;
  }
  walk(child, scopes);
}

function hoist(stmts, bound) {
  for (const s of stmts) {
    if (!s) continue;
    if (s.type === 'FunctionDeclaration' && s.id) bound.add(s.id.name);
    if (s.type === 'VariableDeclaration') {
      for (const d of s.declarations) collectVarNames(d.id, bound);
    }
    if (s.type === 'ClassDeclaration' && s.id) bound.add(s.id.name);
  }
}
function collectVarNames(id, bound) {
  if (!id) return;
  switch (id.type) {
    case 'Identifier': bound.add(id.name); break;
    case 'AssignmentPattern': collectVarNames(id.left, bound); break;
    case 'RestElement': collectVarNames(id.argument, bound); break;
    case 'ArrayPattern': id.elements.forEach(e => collectVarNames(e, bound)); break;
    case 'ObjectPattern': id.properties.forEach(p => collectVarNames(p.type === 'RestElement' ? p.argument : p.value, bound)); break;
  }
}

// top-level: function decls are the localTop; walk their bodies
const topScope = new Set(localTop);
ast.body.forEach(n => walk(n, [topScope]));

// Classify free identifiers
const alreadyImported = new Set([
  // tickets-state
  'ticketsState','TICKETS_PAGE_SIZE','_ticketSummaryPageSize',
  // permissions
  'getAutoFrontDeskRecipients','getTicketVisibility','_ticketsCurrentStaffRow','canViewTicketsSummaryTab','canViewTicketsArchivedTab','canCurrentUserCloseTickets','updateTicketsTabsVisibility','ffTicketsSetTimePeriodFiltersVisible','isStaffRecordManagerOrAdmin','isTicketsTechnicianRestrictedRole','ffTicketsHideFrontDeskFiltersOnThisView','getTicketsSelfEmployeeFilterId','ticketBelongsToTicketsTechnician','updateTicketsEmployeeFilterVisibility','getActiveLocationIdForTickets','canSeeTicket',
  // pricing
  'getTicketTaxConfig','isTicketProductLine','computeTicketTotalsFromLines',
  // catalog-data
  'ffCanViewServices','ffCanManageServices','getTicketsAccountId','normalizeSharedCategoryName','sharedCategoryId','sharedServiceCatalogItemsRef','loadSharedServiceOverrides','getSharedServicesForCatalogManager','getLocationServicesForCatalogManager','loadSharedCatalogForManager','loadLocationCatalogForManager','saveSharedService','saveSharedServiceCategory','deleteSharedServiceCategory','deleteSharedService','saveSharedServiceOverride','removeSharedServiceOverride','loadSharedServiceLocationOverridesForService','saveSharedServiceLocationOverride','seedSharedServiceCatalogFromLocationCatalogIfEmpty','_applyCatalogFilter','subscribeProductsCatalog','loadServices','saveService','deleteService','loadServiceCategories','saveServiceCategory','deleteServiceCategory',
  // crud
  '_rebuildCurrentTicketsMerged','ffTicketsPatchLocalTicket','updateTicketsLoadMoreUi','loadMoreTicketsOlder','subscribeTickets','updateTicketsNavBadge','getTicketCustomerPriceApprovedFromForm','createTicket','updateTicket','finalizeTicket','closeTicket','reopenTicket','archiveTicket','setTicketServiceUpgrade','awardTicketUpgradePoints','deleteTicketPermanently','markTicketSeenByFrontDesk',
  // helpers
  'formatTicketDisplayDateTime','formatDate','ticketSubmittedAtDate','passesTicketsDateFilter','fetchClosedTicketsForSummary','_fmtYmdLocal','computeRangeForPreset','_ticketsFmtMonthDay','_ticketsRangeLabelMd','ticketMatchesEmployeeFilter','formatSummaryMoney','ffTicketMoney','ffTicketCurSym','formatSummaryInt','getSummaryFilterDateRangeFromDom','summaryDocMatchesLocation','buildSummaryRowsFromClosedTicketList','buildSummaryRowsFromLiveClosedTickets',
  // list
  'ffTicketsBulkInit','renderTicketsList','escapeHtml',
  // modal
  'openTicketModal','ffFormatReviewedAt','closeTicketModal','closeTicketDetailsModal','addServiceToTicket','addProductToTicket','saveTicket',
  // firebase
  'collection','query','where','orderBy','limit','startAfter','addDoc','updateDoc','setDoc','doc','getDoc','getDocFromServer','getDocs','deleteDoc','deleteField','onSnapshot','serverTimestamp','Timestamp','writeBatch','onAuthStateChanged','db','auth',
]);

const builtins = new Set(['if','for','while','switch','catch','return','function','typeof','await','new','async','String','Number','Boolean','Array','Object','Map','Set','Date','Promise','Math','JSON','Intl','isNaN','parseInt','parseFloat','console','document','window','setTimeout','clearTimeout','requestAnimationFrame','CustomEvent','Error','Event','Node','HTMLElement','undefined','null','true','false','NaN','Infinity','navigator','location','localStorage','sessionStorage','fetch','Promise','RegExp','encodeURIComponent','decodeURIComponent','Symbol','WeakMap','WeakSet','getComputedStyle','MutationObserver','ResizeObserver','IntersectionObserver','alert','confirm','prompt','structuredClone','queueMicrotask']);

const freeNames = [...free.keys()].sort();
const needInjection = freeNames.filter(n => !alreadyImported.has(n) && !builtins.has(n));
const usesImported = freeNames.filter(n => alreadyImported.has(n));

console.log('=== BLOCK ===');
console.log('lines:', blockLines.length, '| top-level functions:', localTop.size);
console.log('\n=== FREE IDENTIFIERS THAT ARE ALREADY-IMPORTABLE (from other modules) ===');
console.log(JSON.stringify(usesImported));
console.log('\n=== FREE IDENTIFIERS NEEDING INJECTION or IMPORT-FROM-tickets.js (resident) ===');
for (const n of needInjection) console.log(`  ${n}: ${free.get(n)}`);
console.log('\nlocalTopNames:', JSON.stringify([...localTop]));
