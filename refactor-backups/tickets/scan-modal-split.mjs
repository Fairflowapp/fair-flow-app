import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const SRC = 'public/tickets-modal.js';
const src = readFileSync(SRC, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

// imported names -> module
const importedName = new Map();
for (const n of ast.body) if (n.type === 'ImportDeclaration')
  for (const s of n.specifiers) importedName.set(s.local.name, n.source.value);

// injected (let-declared, assigned in initTicketsModal)
const injected = new Set();
for (const n of ast.body) if (n.type === 'VariableDeclaration')
  for (const d of n.declarations) if (d.id.type === 'Identifier') injected.add(d.id.name);

// top-level function declarations (skip initTicketsModal)
const fns = []; // {name,start,end,node}
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration' && n.id && n.id.name !== 'initTicketsModal')
    fns.push({ name: n.id.name, start: n.loc.start.line, end: n.loc.end.line, node: n });
}
const fnNames = new Set(fns.map(f => f.name));

// for each fn, find referenced other-fn names + external + injected usage
function refsOf(node) {
  const ext = new Set(), inj = new Set(), internal = new Set();
  walk.simple(node, {
    Identifier(id) {
      const nm = id.name;
      if (fnNames.has(nm)) internal.add(nm);
      else if (importedName.has(nm)) ext.add(nm + '@' + importedName.get(nm).replace(/.*\//,'').replace(/\?.*/,''));
      else if (injected.has(nm)) inj.add(nm);
    }
  });
  return { ext, inj, internal };
}

const info = new Map();
for (const f of fns) info.set(f.name, refsOf(f.node));

// print function table
console.log('=== functions (', fns.length, ') ===');
for (const f of fns) console.log(String(f.start).padStart(4), '-', String(f.end).padStart(4), f.name, '(', f.end-f.start+1, ')');

function analyzePartition(label, aNames) {
  const A = new Set(aNames), B = new Set(fns.map(f=>f.name).filter(n=>!A.has(n)));
  let aLines=0,bLines=0;
  for (const f of fns) (A.has(f.name)?()=>aLines+=f.end-f.start+1:()=>bLines+=f.end-f.start+1)();
  const aToB = new Set(), bToA = new Set();
  const aInj = new Set(), bInj = new Set(), aExt=new Set(), bExt=new Set();
  for (const f of fns) {
    const {internal,inj,ext} = info.get(f.name);
    for (const t of internal) {
      if (A.has(f.name) && B.has(t)) aToB.add(`${f.name}->${t}`);
      if (B.has(f.name) && A.has(t)) bToA.add(`${f.name}->${t}`);
    }
    for (const i of inj) (A.has(f.name)?aInj:bInj).add(i);
    for (const e of ext) (A.has(f.name)?aExt:bExt).add(e);
  }
  console.log(`\n===== PARTITION: ${label} =====`);
  console.log(`  A (${A.size} fns, ~${aLines} body lines):`, [...A].join(', '));
  console.log(`  B (${B.size} fns, ~${bLines} body lines)`);
  console.log(`  A->B cross-edges (${aToB.size}):`, [...aToB].join(', ') || '(none)');
  console.log(`  B->A cross-edges (${bToA.size}):`, [...bToA].join(', ') || '(none)');
  console.log(`  A injects:`, [...aInj].join(', ') || '(none)');
  console.log(`  B injects:`, [...bInj].join(', ') || '(none)');
}

// Proposal 1: cut after resetTicketForm (views + reset in A)
analyzePartition('A=views+customerUI+reset (47-583) | B=populate..save', [
  'openTicketModal','ffFormatReviewedAt','toggleTicketReviewed','openAdminTicketView',
  'closeTicketModal','openTicketDetailsModal','closeTicketDetailsModal',
  'ffTicketRequiresCustomerName','ffApplyTicketCustomerRequiredUI','resetTicketForm'
]);

// Proposal 2: pure cohesive cut after closeTicketDetailsModal (views only in A)
analyzePartition('A=views only (47-494) | B=customerUI+form..save', [
  'openTicketModal','ffFormatReviewedAt','toggleTicketReviewed','openAdminTicketView',
  'closeTicketModal','openTicketDetailsModal','closeTicketDetailsModal'
]);

// Proposal 3: like P1 but move closeTicketModal to B (hub called by save actions)
analyzePartition('A=views+customerUI+reset (no closeModal) | B=+closeModal+form..save', [
  'openTicketModal','ffFormatReviewedAt','toggleTicketReviewed','openAdminTicketView',
  'openTicketDetailsModal','closeTicketDetailsModal',
  'ffTicketRequiresCustomerName','ffApplyTicketCustomerRequiredUI','resetTicketForm'
]);

// Proposal 4: A=open/views+form setup (populate/reset/customerUI/close) | B=line-edit+save
analyzePartition('A=views+form-setup | B=line-edit+totals+save', [
  'openTicketModal','ffFormatReviewedAt','toggleTicketReviewed','openAdminTicketView',
  'closeTicketModal','openTicketDetailsModal','closeTicketDetailsModal',
  'ffTicketRequiresCustomerName','ffApplyTicketCustomerRequiredUI','resetTicketForm','populateTicketForm'
]);
