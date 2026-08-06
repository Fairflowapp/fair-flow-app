import fs from 'fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const SRC = 'public/tickets.js';
const code = fs.readFileSync(SRC, 'utf8');

// 54 mutable state vars that move into ticketsState (NOT the 2 const numbers).
const TARGETS = new Set([
  'currentUserProfile','salonServices','serviceCategories','salonProducts','productCategories',
  '_productsUnsub','_productCatsUnsub','_productsSubSalonId','currentTickets',
  '_ticketsFirstPageTickets','_ticketsExtraTickets','_ticketsNextPageCursor','_ticketsHasMoreOlder',
  '_ticketsLoadingMore','ticketsUnsubscribe','_ticketsDataReady','currentTicketsTab','editingTicketId',
  '_ticketPickerShowAllCatalog','_justClosedTicketId','_ticketsMembersAvatarCache','_ticketsMembersAvatarByName',
  '_ticketsOpenedThisSession','_ticketsListSnapshotReady','_ffCatalogLegacyWiped','_rawServices','_rawCategories',
  '_rawSharedServices','_rawSharedCategories','_rawServiceOverrides','_catalogSource','_ffCatalogModalMode',
  '_servicesUnsub','_serviceCatsUnsub','_catalogSubSalonId','_frontDeskCache','_ticketsSummaryFetchSeq',
  '_ticketsDateFiltersWired','ticketsSelectionMode','ticketsSelectionTab','ticketsSelected','ticketsClosedShownIds',
  '_ffOpenCats','_ffCatalogRenderedOnce','_ffCatalogRenderRootId','_ffSelectedServiceId','_ffSelectedCategoryId',
  '_ffServicesInlineEditServiceId','_ffServicesDetailTab','_ffServicesLocationOverridesByService',
  '_ffServicesLocationOverridesLoading','_ffServicesSharedBackfillChecked','_ffDragSrc','_ffDragHoverEl',
]);

// Known module-level declaration lines (from grep) — these declarators are the legit bindings.
const MODULE_DECL_LINES = new Set([22,23,24,26,27,28,29,30,31,36,37,38,39,40,41,42,43,44,48,50,52,54,120,122,281,282,283,284,285,286,287,288,289,290,291,1513,3105,3327,3517,3518,3519,3520,5265,5268,5269,5270,5271,5272,5273,5274,5275,5276,6791,6792]);

const ast = acorn.parse(code, { ecmaVersion: 2023, sourceType: 'module', locations: true, ranges: true });

const bindings = [];   // {name, line} — every place a name is INTRODUCED
const refs = [];       // {name, start, end, line, shorthand}
const skipped = [];    // property keys / member props (for sanity)

function recordPatternBindings(pat) {
  if (!pat) return;
  switch (pat.type) {
    case 'Identifier': bindings.push({ name: pat.name, line: pat.loc.start.line }); break;
    case 'ObjectPattern': pat.properties.forEach(p => {
      if (p.type === 'RestElement') recordPatternBindings(p.argument);
      else recordPatternBindings(p.value);
    }); break;
    case 'ArrayPattern': pat.elements.forEach(e => e && recordPatternBindings(e)); break;
    case 'AssignmentPattern': recordPatternBindings(pat.left); break;
    case 'RestElement': recordPatternBindings(pat.argument); break;
  }
}

walk.ancestor(ast, {
  VariableDeclarator(node) { recordPatternBindings(node.id); },
  FunctionDeclaration(node) { if (node.id) bindings.push({ name: node.id.name, line: node.id.loc.start.line }); node.params.forEach(recordPatternBindings); },
  FunctionExpression(node) { if (node.id) bindings.push({ name: node.id.name, line: node.id.loc.start.line }); node.params.forEach(recordPatternBindings); },
  ArrowFunctionExpression(node) { node.params.forEach(recordPatternBindings); },
  CatchClause(node) { if (node.param) recordPatternBindings(node.param); },
  ClassDeclaration(node) { if (node.id) bindings.push({ name: node.id.name, line: node.id.loc.start.line }); },
  Identifier(node, _state, ancestors) {
    if (!TARGETS.has(node.name)) return;
    const parent = ancestors[ancestors.length - 2];
    if (!parent) return;
    // member property: obj.X  (skip)
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) { skipped.push({name:node.name,line:node.loc.start.line,why:'member-prop'}); return; }
    // object property
    if (parent.type === 'Property' && !parent.computed) {
      if (parent.key === node && !parent.shorthand) { skipped.push({name:node.name,line:node.loc.start.line,why:'obj-key'}); return; }
      if (parent.shorthand) { refs.push({ name: node.name, start: node.start, end: node.end, line: node.loc.start.line, shorthand: true }); return; }
      // value position (key !== node) -> reference, fall through
    }
    // declaration id positions
    if (parent.type === 'VariableDeclarator' && parent.id === node) return;
    if ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression') && (parent.id === node || parent.params.includes(node))) return;
    if (parent.type === 'ArrowFunctionExpression' && parent.params.includes(node)) return;
    if (parent.type === 'CatchClause' && parent.param === node) return;
    // labels
    if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return;
    refs.push({ name: node.name, start: node.start, end: node.end, line: node.loc.start.line, shorthand: false });
  },
});

// Shadowing: any target name bound somewhere OTHER than its known module-level decl line.
const shadow = bindings.filter(b => TARGETS.has(b.name) && !MODULE_DECL_LINES.has(b.line));

console.log('=== ANALYSIS ===');
console.log('total reference sites to convert:', refs.length);
console.log('shorthand sites:', refs.filter(r => r.shorthand).length);
if (refs.some(r=>r.shorthand)) console.log('  shorthand lines:', refs.filter(r=>r.shorthand).map(r=>r.line));
console.log('skipped (member-prop/obj-key):', skipped.length);
if (skipped.length) console.log('  ', JSON.stringify(skipped));
console.log('SHADOWING bindings (target names declared locally, NOT module-level):', shadow.length);
if (shadow.length) console.log('  ', JSON.stringify(shadow));
// per-name ref counts
const counts = {};
refs.forEach(r => counts[r.name] = (counts[r.name]||0)+1);
console.log('per-name counts:', JSON.stringify(counts, null, 0));
