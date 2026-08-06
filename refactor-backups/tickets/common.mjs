import * as acorn from 'acorn';

export const TARGETS = new Set([
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

const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/**
 * Manual full-AST traversal (parent + key tracked) so we visit EVERY Identifier,
 * including assignment-target identifiers (`X = ...`) that acorn-walk routes through
 * a Pattern path and never reports as an Identifier.
 *
 * Returns { convert: [{start,end,name}], shorthand: [...], skipped: {...counts} }.
 */
export function classify(code) {
  const ast = acorn.parse(code, { ecmaVersion: 2023, sourceType: 'module', locations: true, ranges: true });
  const convert = [];
  const shorthand = [];
  const skipped = { memberProp: 0, objKey: 0, declId: 0, param: 0, importSpec: 0, label: 0 };

  function visit(node, parent, key) {
    if (!node || typeof node.type !== 'string') return;

    if (node.type === 'Identifier' && TARGETS.has(node.name) && parent) {
      const pt = parent.type;
      // member property: obj.X
      if (pt === 'MemberExpression' && key === 'property' && !parent.computed) { skipped.memberProp++; }
      // object literal key (non-shorthand): { X: ... }
      else if (pt === 'Property' && key === 'key' && !parent.computed && !parent.shorthand) { skipped.objKey++; }
      // shorthand { X }  (needs X: ticketsState.X) — flagged separately
      else if (pt === 'Property' && parent.shorthand) { shorthand.push({ start: node.start, end: node.end, name: node.name, line: node.loc.start.line }); }
      // declaration binding id (module-level decls — removed anyway)
      else if (pt === 'VariableDeclarator' && key === 'id') { skipped.declId++; }
      // function/arrow id or params, catch param
      else if (FN.has(pt) && (key === 'id' || key === 'params')) { skipped.param++; }
      else if (pt === 'CatchClause' && key === 'param') { skipped.param++; }
      // import/export specifiers
      else if (pt === 'ImportSpecifier' || pt === 'ImportDefaultSpecifier' || pt === 'ImportNamespaceSpecifier' || pt === 'ExportSpecifier') { skipped.importSpec++; }
      // labels
      else if ((pt === 'LabeledStatement' || pt === 'BreakStatement' || pt === 'ContinueStatement') && key === 'label') { skipped.label++; }
      // everything else is a real read/write reference -> convert
      else { convert.push({ start: node.start, end: node.end, name: node.name, line: node.loc.start.line }); }
    }

    for (const k in node) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) visit(c, node, k); }
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v, node, k);
    }
  }
  visit(ast, null, null);
  return { convert, shorthand, skipped };
}
