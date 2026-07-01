import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const SRC = 'public/tickets.js';
const BLOCK_START = 657;
const BLOCK_END   = 843;

const full = readFileSync(SRC, 'utf8');
const lines = full.split('\n');
const blockSrc = lines.slice(BLOCK_START - 1, BLOCK_END).join('\n');

const ast = acorn.parse(full, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

// 1) imported name -> module specifier
const importedName = new Map();
for (const n of ast.body) {
  if (n.type === 'ImportDeclaration') {
    for (const s of n.specifiers) importedName.set(s.local.name, n.source.value);
  }
}

// 2) resident top-level function names (candidates for injection)
const residentFns = new Set();
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration' && n.id) residentFns.add(n.id.name);
  if (n.type === 'ExportNamedDeclaration' && n.declaration && n.declaration.type === 'FunctionDeclaration' && n.declaration.id)
    residentFns.add(n.declaration.id.name);
  if ((n.type === 'VariableDeclaration')) for (const d of n.declarations) if (d.id.type === 'Identifier') residentFns.add(d.id.name);
  if (n.type === 'ExportNamedDeclaration' && n.declaration && n.declaration.type === 'VariableDeclaration')
    for (const d of n.declaration.declarations) if (d.id.type === 'Identifier') residentFns.add(d.id.name);
}

// 3) parse block, collect declared-in-block + referenced identifiers
const bAst = acorn.parse(blockSrc, { ecmaVersion: 'latest', sourceType: 'module' });
const declared = new Set();
const referenced = new Set();
const definedInBlock = new Set(); // top-level fn names inside block

function collectPattern(node) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier': declared.add(node.name); break;
    case 'ObjectPattern': node.properties.forEach(p => collectPattern(p.value || p.argument)); break;
    case 'ArrayPattern': node.elements.forEach(e => e && collectPattern(e)); break;
    case 'AssignmentPattern': collectPattern(node.left); break;
    case 'RestElement': collectPattern(node.argument); break;
  }
}

for (const n of bAst.body) {
  if (n.type === 'FunctionDeclaration' && n.id) definedInBlock.add(n.id.name);
}

walk.ancestor(bAst, {
  FunctionDeclaration(n){ if(n.id) declared.add(n.id.name); n.params.forEach(collectPattern); },
  FunctionExpression(n){ if(n.id) declared.add(n.id.name); n.params.forEach(collectPattern); },
  ArrowFunctionExpression(n){ n.params.forEach(collectPattern); },
  VariableDeclarator(n){ collectPattern(n.id); },
  CatchClause(n){ if(n.param) collectPattern(n.param); },
  ClassDeclaration(n){ if(n.id) declared.add(n.id.name); },
  Identifier(n, ancestors){
    const parent = ancestors[ancestors.length - 2];
    if (!parent) { referenced.add(n.name); return; }
    // skip non-computed member property: obj.PROP
    if (parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
    // skip non-computed object property key
    if (parent.type === 'Property' && parent.key === n && !parent.computed) return;
    // skip declaration ids / params (handled above)
    if (parent.type === 'FunctionDeclaration' && parent.id === n) return;
    if ((parent.type === 'FunctionExpression'||parent.type==='ArrowFunctionExpression') && parent.id === n) return;
    if (parent.type === 'VariableDeclarator' && parent.id === n) return;
    if (parent.type === 'ClassDeclaration' && parent.id === n) return;
    if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return;
    referenced.add(n.name);
  }
});

const BUILTINS = new Set(['window','document','console','Math','Object','Array','JSON','Date','Number','String','Boolean','Promise','Map','Set','parseInt','parseFloat','isNaN','setTimeout','clearTimeout','setInterval','clearInterval','undefined','null','true','false','NaN','Infinity','RegExp','Error','Intl','localStorage','sessionStorage','navigator','location','alert','confirm','prompt','requestAnimationFrame','structuredClone','Number','globalThis','void','fetch','URL','Array','Symbol']);

const free = [...referenced].filter(x => !declared.has(x) && !definedInBlock.has(x)).sort();

const imports = [];      // {name, module}
const injects = [];      // resident fns to inject
const builtins = [];
const unknown = [];

for (const name of free) {
  if (importedName.has(name)) imports.push({ name, module: importedName.get(name) });
  else if (definedInBlock.has(name)) {}
  else if (residentFns.has(name)) injects.push(name);
  else if (BUILTINS.has(name)) builtins.push(name);
  else unknown.push(name);
}

console.log('=== BLOCK', BLOCK_START, '-', BLOCK_END, '(', BLOCK_END-BLOCK_START+1, 'lines ) ===');
console.log('\n--- defined in block (exports candidates) ---');
console.log([...definedInBlock].join(', '));

const byModule = {};
for (const {name, module} of imports) (byModule[module] ||= []).push(name);
console.log('\n--- IMPORTS needed (existing modules) ---');
for (const m of Object.keys(byModule).sort()) console.log(`  ${m}:  ${byModule[m].sort().join(', ')}`);

console.log('\n--- INJECT from tickets.js (resident fns) ---');
console.log('  ', injects.join(', '));

console.log('\n--- builtins/window (ignore) ---');
console.log('  ', builtins.join(', '));

console.log('\n--- UNKNOWN (investigate!) ---');
console.log('  ', unknown.length ? unknown.join(', ') : '(none)');
