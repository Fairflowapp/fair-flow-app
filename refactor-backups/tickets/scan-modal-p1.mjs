import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const SRC = 'public/tickets-modal.js';
const src = readFileSync(SRC, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

const importedFull = new Map(); // name -> full source specifier
for (const n of ast.body) if (n.type === 'ImportDeclaration')
  for (const s of n.specifiers) importedFull.set(s.local.name, n.source.value);

const injected = new Set();
for (const n of ast.body) if (n.type === 'VariableDeclaration')
  for (const d of n.declarations) if (d.id.type === 'Identifier') injected.add(d.id.name);

const fns = [];
for (const n of ast.body)
  if (n.type === 'FunctionDeclaration' && n.id && n.id.name !== 'initTicketsModal')
    fns.push({ name: n.id.name, start: n.loc.start.line, end: n.loc.end.line, node: n });
const fnNames = new Set(fns.map(f => f.name));

const A = new Set([
  'openTicketModal','ffFormatReviewedAt','toggleTicketReviewed','openAdminTicketView',
  'closeTicketModal','openTicketDetailsModal','closeTicketDetailsModal',
  'ffTicketRequiresCustomerName','ffApplyTicketCustomerRequiredUI','resetTicketForm'
]);
const B = new Set(fns.map(f=>f.name).filter(n=>!A.has(n)));

function surface(setSel) {
  const ext = new Map(), inj = new Set(), cross = new Set();
  for (const f of fns) {
    if (!setSel.has(f.name)) continue;
    walk.simple(f.node, { Identifier(id){
      const nm = id.name;
      if (importedFull.has(nm)) ext.set(nm, importedFull.get(nm));
      else if (injected.has(nm)) inj.add(nm);
      else if (fnNames.has(nm) && !setSel.has(nm)) cross.add(nm); // cross-file dep
    }});
  }
  return { ext, inj, cross };
}

function report(label, setSel) {
  const { ext, inj, cross } = surface(setSel);
  const byMod = {};
  for (const [nm, mod] of ext) (byMod[mod] ||= []).push(nm);
  console.log(`\n===== ${label} =====`);
  console.log('EXTERNAL IMPORTS:');
  for (const m of Object.keys(byMod).sort()) console.log(`  ${m}\n     -> ${byMod[m].sort().join(', ')}`);
  console.log('INJECT from tickets.js:', [...inj].filter(x=>!fnNames.has(x)).sort().join(', '));
  console.log('CROSS (inject sibling fns):', [...cross].sort().join(', '));
}

report('VIEW  (A)', A);
report('EDIT  (B)', B);

// distinguish tickets.js-injected vs any leftover
console.log('\ninjected(let) names:', [...injected].join(', '));
