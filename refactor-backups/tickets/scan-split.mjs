import fs from 'fs';
import * as acorn from 'acorn';

const code = fs.readFileSync('public/tickets-catalog-ui.js', 'utf8');
const lines = code.split('\n');

// 1-based inclusive ranges -> 0-based slice [start-1, end)
const BLOCKS = {
  A: { name: 'render', s: 38, e: 802 },
  B: { name: 'tabs',   s: 803, e: 1354 },
  C: { name: 'edit',   s: 1355, e: 1968 },
};

// name -> module for the external imports currently in the file.
const MODMAP = {};
const put = (mod, arr) => arr.forEach(n => (MODMAP[n] = mod));
put('firebase', ['serverTimestamp', 'doc', 'updateDoc']);
put('appjs', ['db']);
put('state', ['ticketsState']);
put('catalogData', ['ffCanManageServices','getTicketsAccountId','normalizeSharedCategoryName','sharedCategoryId','sharedServiceCatalogItemsRef','getSharedServicesForCatalogManager','getLocationServicesForCatalogManager','loadSharedCatalogForManager','loadLocationCatalogForManager','saveSharedService','saveSharedServiceCategory','deleteSharedServiceCategory','deleteSharedService','saveSharedServiceOverride','removeSharedServiceOverride','loadSharedServiceLocationOverridesForService','saveSharedServiceLocationOverride','_applyCatalogFilter','loadServices','saveService','deleteService','loadServiceCategories','saveServiceCategory','deleteServiceCategory']);
put('helpers', ['ffTicketMoney', 'ffTicketCurSym']);
put('list', ['escapeHtml']);

const INJECTED = new Set(['showToast', 'ticketConfirm', 'setupTicketsUI', 'getServiceStaffOverrides', 'controlledStaffCanProvideService']);

const builtins = new Set(['if','for','while','switch','catch','return','function','typeof','await','new','async','String','Number','Boolean','Array','Object','Map','Set','Date','Promise','Math','JSON','Intl','isNaN','parseInt','parseFloat','console','document','window','setTimeout','clearTimeout','requestAnimationFrame','CustomEvent','Error','Event','getComputedStyle','navigator','location','fetch','RegExp','encodeURIComponent','decodeURIComponent','Symbol','undefined','NaN','Infinity','parseFloat','structuredClone','queueMicrotask','MutationObserver']);

// ---- free-identifier analysis (reuse walker) ----
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
function freeIdents(src) {
  const ast = acorn.parse(src, { ecmaVersion: 2023, sourceType: 'module', locations: true });
  const localTop = new Set();
  for (const n of ast.body) if (n.type === 'FunctionDeclaration' && n.id) localTop.add(n.id.name);
  const free = new Map();

  const collectVarNames = (id, bound) => {
    if (!id) return;
    switch (id.type) {
      case 'Identifier': bound.add(id.name); break;
      case 'AssignmentPattern': collectVarNames(id.left, bound); break;
      case 'RestElement': collectVarNames(id.argument, bound); break;
      case 'ArrayPattern': id.elements.forEach(e => collectVarNames(e, bound)); break;
      case 'ObjectPattern': id.properties.forEach(p => collectVarNames(p.type === 'RestElement' ? p.argument : p.value, bound)); break;
    }
  };
  const hoist = (stmts, bound) => {
    for (const s of stmts) {
      if (!s) continue;
      if (s.type === 'FunctionDeclaration' && s.id) bound.add(s.id.name);
      if (s.type === 'ClassDeclaration' && s.id) bound.add(s.id.name);
      if (s.type === 'VariableDeclaration') for (const d of s.declarations) collectVarNames(d.id, bound);
    }
  };
  const collectParams = (node, bound) => {
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
  };

  function walk(node, scopes) {
    if (!node || typeof node.type !== 'string') return;
    if (FN.has(node.type)) {
      const bound = new Set(); collectParams(node, bound);
      const body = node.body;
      if (body && body.type === 'BlockStatement') hoist(body.body, bound);
      const ns = scopes.concat(bound);
      if (body) { if (body.type === 'BlockStatement') body.body.forEach(c => walk(c, ns)); else walk(body, ns); }
      return;
    }
    if (node.type === 'BlockStatement') {
      const bound = new Set(); hoist(node.body, bound);
      const ns = scopes.concat(bound); node.body.forEach(c => walk(c, ns)); return;
    }
    if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      const bound = new Set();
      if (node.left && node.left.type === 'VariableDeclaration') for (const d of node.left.declarations) collectVarNames(d.id, bound);
      if (node.init && node.init.type === 'VariableDeclaration') for (const d of node.init.declarations) collectVarNames(d.id, bound);
      const ns = scopes.concat(bound);
      for (const k of ['left','right','init','test','update','body']) if (node[k]) walk(node[k], ns);
      return;
    }
    if (node.type === 'CatchClause') {
      const bound = new Set();
      if (node.param && node.param.type === 'Identifier') bound.add(node.param.name);
      walk(node.body, scopes.concat(bound)); return;
    }
    for (const k in node) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(c => visitChild(node, k, c, scopes));
      else if (v && typeof v === 'object' && typeof v.type === 'string') visitChild(node, k, v, scopes);
    }
  }
  function visitChild(parent, key, child, scopes) {
    if (!child || typeof child.type !== 'string') return;
    if (child.type === 'Identifier') {
      const pt = parent.type;
      if (pt === 'MemberExpression' && key === 'property' && !parent.computed) return;
      if (pt === 'Property' && key === 'key' && !parent.computed) return;
      if ((pt === 'LabeledStatement' || pt === 'BreakStatement' || pt === 'ContinueStatement') && key === 'label') return;
      const nm = child.name;
      if (!(scopes.some(s => s.has(nm)) || localTop.has(nm))) free.set(nm, (free.get(nm) || 0) + 1);
      return;
    }
    walk(child, scopes);
  }
  const top = new Set(localTop);
  ast.body.forEach(n => walk(n, [top]));
  return { localTop, free };
}

// assign the 49 names to blocks
const blockNames = {};
for (const [k, b] of Object.entries(BLOCKS)) {
  const src = lines.slice(b.s - 1, b.e).join('\n');
  const { localTop } = freeIdents(src);
  blockNames[k] = localTop;
}
const nameToBlock = {};
for (const [k, set] of Object.entries(blockNames)) for (const n of set) nameToBlock[n] = k;

console.log('=== FUNCTION COUNTS PER BLOCK ===');
for (const k of ['A','B','C']) console.log(`  ${k} (${BLOCKS[k].name}): ${blockNames[k].size} functions`);

// per-block classification
for (const k of ['A','B','C']) {
  const b = BLOCKS[k];
  const src = lines.slice(b.s - 1, b.e).join('\n');
  const { free } = freeIdents(src);
  const crossEdges = {}; // otherBlock -> [names]
  const importsByMod = {};
  const injects = new Set();
  const unknown = [];
  for (const nm of [...free.keys()].sort()) {
    if (nameToBlock[nm] && nameToBlock[nm] !== k) {
      (crossEdges[nameToBlock[nm]] ||= []).push(nm);
    } else if (INJECTED.has(nm)) {
      injects.add(nm);
    } else if (MODMAP[nm]) {
      (importsByMod[MODMAP[nm]] ||= []).push(nm);
    } else if (!builtins.has(nm)) {
      unknown.push(nm);
    }
  }
  console.log(`\n===== BLOCK ${k} (${b.name}, lines ${b.s}-${b.e}) =====`);
  console.log('  cross-block refs (need import from sibling):');
  for (const ob of ['A','B','C']) if (crossEdges[ob]) console.log(`    from ${ob}(${BLOCKS[ob].name}): ${JSON.stringify(crossEdges[ob])}`);
  console.log('  external imports needed:');
  for (const mod of Object.keys(importsByMod)) console.log(`    ${mod}: ${JSON.stringify(importsByMod[mod].sort())}`);
  console.log('  injected deps used:', JSON.stringify([...injects].sort()));
  console.log('  UNKNOWN (review; window.* or globals):', JSON.stringify(unknown));
}
