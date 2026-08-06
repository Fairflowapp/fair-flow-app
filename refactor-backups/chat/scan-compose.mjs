import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const SRC = 'public/chat.js';
const BLOCK_START = 478, BLOCK_END = 940;
const src = readFileSync(SRC, 'utf8');
const lines = src.split('\n');
const blockSrc = lines.slice(BLOCK_START - 1, BLOCK_END).join('\n');

const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

const importedName = new Map();
for (const n of ast.body) if (n.type === 'ImportDeclaration')
  for (const s of n.specifiers) importedName.set(s.local.name, n.source.value);

// resident top-level: function decls + const/let names + window.X assignment names, with line ranges
const residentFn = new Map();   // name -> [start,end]
const windowDefs = new Map();    // name -> [start,end]  (window.NAME = ...)
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration' && n.id) residentFn.set(n.id.name, [n.loc.start.line, n.loc.end.line]);
  if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') residentFn.set(d.id.name, [n.loc.start.line, n.loc.end.line]);
  if (n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression') {
    const l = n.expression.left;
    if (l.type === 'MemberExpression' && l.object.type === 'Identifier' && l.object.name === 'window' && l.property.type === 'Identifier')
      windowDefs.set(l.property.name, [n.loc.start.line, n.loc.end.line]);
  }
}

const inBlock = (ln) => ln >= BLOCK_START && ln <= BLOCK_END;

// names DEFINED inside the block
const blockFns = new Set(), blockWindow = new Set();
for (const [nm,[s]] of residentFn) if (inBlock(s)) blockFns.add(nm);
for (const [nm,[s]] of windowDefs) if (inBlock(s)) blockWindow.add(nm);

// free identifiers in block
const bAst = acorn.parse(blockSrc, { ecmaVersion: 'latest', sourceType: 'module' });
const declared = new Set(), referenced = new Set();
const cp = nd => { if(!nd)return; if(nd.type==='Identifier')declared.add(nd.name);
  else if(nd.type==='ObjectPattern')nd.properties.forEach(p=>cp(p.value||p.argument));
  else if(nd.type==='ArrayPattern')nd.elements.forEach(e=>e&&cp(e));
  else if(nd.type==='AssignmentPattern')cp(nd.left); else if(nd.type==='RestElement')cp(nd.argument); };
walk.ancestor(bAst, {
  FunctionDeclaration(n){if(n.id)declared.add(n.id.name);n.params.forEach(cp);},
  FunctionExpression(n){if(n.id)declared.add(n.id.name);n.params.forEach(cp);},
  ArrowFunctionExpression(n){n.params.forEach(cp);},
  VariableDeclarator(n){cp(n.id);}, CatchClause(n){if(n.param)cp(n.param);},
  ClassDeclaration(n){if(n.id)declared.add(n.id.name);},
  Identifier(n,anc){const p=anc[anc.length-2]; if(!p){referenced.add(n.name);return;}
    if(p.type==='MemberExpression'&&p.property===n&&!p.computed)return;
    if(p.type==='Property'&&p.key===n&&!p.computed)return;
    if((p.type==='FunctionDeclaration'||p.type==='FunctionExpression')&&p.id===n)return;
    if(p.type==='VariableDeclarator'&&p.id===n)return;
    if(p.type==='ClassDeclaration'&&p.id===n)return;
    referenced.add(n.name);}
});

const BUILTINS = new Set(['window','document','console','Math','Object','Array','JSON','Date','Number','String','Boolean','Promise','Map','Set','parseInt','parseFloat','isNaN','setTimeout','clearTimeout','undefined','null','true','false','NaN','Infinity','RegExp','Error','Intl','localStorage','navigator','location','alert','requestAnimationFrame','globalThis','fetch','URL','Symbol','confirm','prompt','getComputedStyle','encodeURIComponent','decodeURIComponent']);

const free = [...referenced].filter(x=>!declared.has(x)&&!blockFns.has(x)).sort();
const imports=[], injects=[], builtins=[], unknown=[];
for (const nm of free) {
  if (importedName.has(nm)) imports.push([nm, importedName.get(nm)]);
  else if (residentFn.has(nm)) injects.push(nm); // resident (outside block) -> inject
  else if (BUILTINS.has(nm)) builtins.push(nm);
  else unknown.push(nm);
}

console.log('=== BLOCK', BLOCK_START,'-',BLOCK_END,'(',BLOCK_END-BLOCK_START+1,'lines) ===');
console.log('\nDEFINED in block — plain fns:', [...blockFns].join(', '));
console.log('DEFINED in block — window.*:', [...blockWindow].join(', '));

const byMod={}; for(const [nm,m] of imports)(byMod[m]||=[]).push(nm);
console.log('\n--- IMPORTS needed ---');
for(const m of Object.keys(byMod).sort()) console.log('  '+m+'\n     -> '+byMod[m].sort().join(', '));
console.log('\n--- INJECT from chat.js (resident, bare-ref) ---\n  ', injects.join(', ')||'(none)');
console.log('\n--- builtins ---\n  ', builtins.join(', '));
console.log('\n--- UNKNOWN ---\n  ', unknown.join(', ')||'(none)');

// what OUTSIDE the block references block-defined names (bare fn refs)?
const outNeedsFn = new Set();
walk.ancestor(ast, { Identifier(n,anc){
  const ln = n.loc ? n.loc.start.line : (anc[0]&&anc[0].loc?0:0);
  if (!n.loc || inBlock(n.loc.start.line)) return;
  const p = anc[anc.length-2];
  if (p && p.type==='MemberExpression' && p.property===n && !p.computed) return;
  if (blockFns.has(n.name)) outNeedsFn.add(n.name);
}});
console.log('\n--- chat.js (outside block) bare-refs block plain-fns (import back) ---\n  ', [...outNeedsFn].join(', ')||'(none)');
console.log('--- block window.* (self-register; callable via window elsewhere) ---\n  ', [...blockWindow].join(', '));
