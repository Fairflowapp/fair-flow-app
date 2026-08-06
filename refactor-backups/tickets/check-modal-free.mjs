import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const BUILTINS = new Set(['window','document','console','Math','Object','Array','JSON','Date','Number','String','Boolean','Promise','Map','Set','parseInt','parseFloat','isNaN','setTimeout','clearTimeout','setInterval','undefined','null','true','false','NaN','Infinity','RegExp','Error','Intl','localStorage','navigator','location','alert','requestAnimationFrame','structuredClone','globalThis','fetch','URL','Symbol','WeakMap','Promise','Function','prompt','confirm','getComputedStyle']);

function check(file){
  const src = readFileSync(file,'utf8');
  const ast = acorn.parse(src,{ecmaVersion:'latest',sourceType:'module'});
  const known = new Set();
  for(const n of ast.body){
    if(n.type==='ImportDeclaration') for(const s of n.specifiers) known.add(s.local.name);
    if(n.type==='FunctionDeclaration'&&n.id) known.add(n.id.name);
    if(n.type==='ExportNamedDeclaration'&&n.declaration){
      if(n.declaration.type==='FunctionDeclaration') known.add(n.declaration.id.name);
      if(n.declaration.type==='VariableDeclaration') for(const d of n.declaration.declarations) if(d.id.type==='Identifier') known.add(d.id.name);
    }
    if(n.type==='VariableDeclaration') for(const d of n.declarations) if(d.id.type==='Identifier') known.add(d.id.name);
  }
  const declared=new Set(), referenced=new Set();
  const cp=nd=>{ if(!nd)return; if(nd.type==='Identifier')declared.add(nd.name);
    else if(nd.type==='ObjectPattern')nd.properties.forEach(p=>cp(p.value||p.argument));
    else if(nd.type==='ArrayPattern')nd.elements.forEach(e=>e&&cp(e));
    else if(nd.type==='AssignmentPattern')cp(nd.left);
    else if(nd.type==='RestElement')cp(nd.argument); };
  walk.ancestor(ast,{
    FunctionDeclaration(n){if(n.id)declared.add(n.id.name);n.params.forEach(cp);},
    FunctionExpression(n){if(n.id)declared.add(n.id.name);n.params.forEach(cp);},
    ArrowFunctionExpression(n){n.params.forEach(cp);},
    VariableDeclarator(n){cp(n.id);},
    CatchClause(n){if(n.param)cp(n.param);},
    ClassDeclaration(n){if(n.id)declared.add(n.id.name);},
    Identifier(n,anc){const p=anc[anc.length-2]; if(!p){referenced.add(n.name);return;}
      if(p.type==='MemberExpression'&&p.property===n&&!p.computed)return;
      if(p.type==='Property'&&p.key===n&&!p.computed)return;
      if((p.type==='FunctionDeclaration'||p.type==='FunctionExpression')&&p.id===n)return;
      if(p.type==='VariableDeclarator'&&p.id===n)return;
      if(p.type==='ClassDeclaration'&&p.id===n)return;
      referenced.add(n.name);}
  });
  const unknown=[...referenced].filter(x=>!known.has(x)&&!declared.has(x)&&!BUILTINS.has(x)).sort();
  console.log(`${file}: ${unknown.length? 'UNKNOWN -> '+unknown.join(', ') : 'clean (no orphan identifiers)'}`);
  return unknown.length===0;
}
const a=check('public/tickets-modal-view.js');
const b=check('public/tickets-modal-edit.js');
process.exit(a&&b?0:1);
