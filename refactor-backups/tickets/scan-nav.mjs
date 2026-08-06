import fs from 'fs';
import * as acorn from 'acorn';

const code = fs.readFileSync('public/tickets.js', 'utf8');
const lines = code.split('\n');

// Block: 1-based 969..1181 => indices 968..1180
const B_START = 968, B_END_EXCL = 1181;
const blockLines = lines.slice(B_START, B_END_EXCL);
const blockText = blockLines.join('\n');

if (!/^\/\/ =+$/.test(blockLines[0]) || blockLines[1] !== '// Navigation') throw new Error('start: ' + JSON.stringify(blockLines.slice(0,2)));
if (blockLines[blockLines.length - 1] !== '} catch (e) {}') throw new Error('end: ' + JSON.stringify(blockLines[blockLines.length-1]));

const importableByMod = {
  state: ['ticketsState'],
  crud: ['updateTicketsNavBadge','subscribeTickets'],
  list: ['renderTicketsList'],
  catalogData: ['ffCanViewServices','loadServiceCategories','loadServices','loadSharedCatalogForManager','seedSharedServiceCatalogFromLocationCatalogIfEmpty','loadLocationCatalogForManager'],
  catalogUi: ['_ffEnsureCatalogEditorPortal','_ffServicesMobileShowList','renderServicesCatalogV2'],
};
const IMPORTABLE = new Set(Object.values(importableByMod).flat());
const INJECT_EXPECTED = new Set(['showToast','loadCurrentUserProfile','enrichTicketsProfileFromMemberDoc','loadTicketsMembersForAvatars','setupTicketsUI','updateNewTicketButtonVisibility']);
const builtins = new Set(['if','for','while','switch','catch','return','function','typeof','await','new','async','String','Number','Boolean','Array','Object','Map','Set','Date','Promise','Math','JSON','Intl','isNaN','parseInt','parseFloat','console','document','window','setTimeout','clearTimeout','requestAnimationFrame','CustomEvent','Error','getComputedStyle','navigator','location','undefined','goToTickets','goToServices']);

// free-ident walker
const FN = new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const ast = acorn.parse(blockText, { ecmaVersion: 2023, sourceType: 'module' });
const localTop = new Set();
for (const n of ast.body) if (n.type === 'FunctionDeclaration' && n.id) localTop.add(n.id.name);
const free = new Map();
const cvn = (id,b)=>{if(!id)return;switch(id.type){case'Identifier':b.add(id.name);break;case'AssignmentPattern':cvn(id.left,b);break;case'RestElement':cvn(id.argument,b);break;case'ArrayPattern':id.elements.forEach(e=>cvn(e,b));break;case'ObjectPattern':id.properties.forEach(p=>cvn(p.type==='RestElement'?p.argument:p.value,b));break;}};
const hoist=(ss,b)=>{for(const s of ss){if(!s)continue;if(s.type==='FunctionDeclaration'&&s.id)b.add(s.id.name);if(s.type==='ClassDeclaration'&&s.id)b.add(s.id.name);if(s.type==='VariableDeclaration')for(const d of s.declarations)cvn(d.id,b);}};
const cp=(node,b)=>{const ap=p=>{if(!p)return;switch(p.type){case'Identifier':b.add(p.name);break;case'AssignmentPattern':ap(p.left);break;case'RestElement':ap(p.argument);break;case'ArrayPattern':p.elements.forEach(ap);break;case'ObjectPattern':p.properties.forEach(pr=>ap(pr.type==='RestElement'?pr.argument:pr.value));break;}};(node.params||[]).forEach(ap);if(node.id&&node.type==='FunctionExpression')b.add(node.id.name);};
function walk(node,scopes){
  if(!node||typeof node.type!=='string')return;
  if(FN.has(node.type)){const b=new Set();cp(node,b);const body=node.body;if(body&&body.type==='BlockStatement')hoist(body.body,b);const ns=scopes.concat(b);if(body){if(body.type==='BlockStatement')body.body.forEach(c=>walk(c,ns));else walk(body,ns);}return;}
  if(node.type==='BlockStatement'){const b=new Set();hoist(node.body,b);const ns=scopes.concat(b);node.body.forEach(c=>walk(c,ns));return;}
  if(node.type==='ForStatement'||node.type==='ForInStatement'||node.type==='ForOfStatement'){const b=new Set();if(node.left&&node.left.type==='VariableDeclaration')for(const d of node.left.declarations)cvn(d.id,b);if(node.init&&node.init.type==='VariableDeclaration')for(const d of node.init.declarations)cvn(d.id,b);const ns=scopes.concat(b);for(const k of['left','right','init','test','update','body'])if(node[k])walk(node[k],ns);return;}
  if(node.type==='CatchClause'){const b=new Set();if(node.param&&node.param.type==='Identifier')b.add(node.param.name);walk(node.body,scopes.concat(b));return;}
  for(const k in node){if(k==='loc'||k==='range'||k==='start'||k==='end'||k==='type')continue;const v=node[k];if(Array.isArray(v))v.forEach(c=>vc(node,k,c,scopes));else if(v&&typeof v==='object'&&typeof v.type==='string')vc(node,k,v,scopes);}
}
function vc(parent,key,child,scopes){
  if(!child||typeof child.type!=='string')return;
  if(child.type==='Identifier'){const pt=parent.type;if(pt==='MemberExpression'&&key==='property'&&!parent.computed)return;if(pt==='Property'&&key==='key'&&!parent.computed)return;if((pt==='LabeledStatement'||pt==='BreakStatement'||pt==='ContinueStatement')&&key==='label')return;const nm=child.name;if(!(scopes.some(s=>s.has(nm))||localTop.has(nm)))free.set(nm,(free.get(nm)||0)+1);return;}
  walk(child,scopes);
}
ast.body.forEach(n=>walk(n,[new Set(localTop)]));

const names=[...free.keys()].sort();
const injects=[], imports={}, windowGlobals=[], unknown=[];
for(const nm of names){
  if(INJECT_EXPECTED.has(nm))injects.push(nm);
  else if(IMPORTABLE.has(nm)){for(const[mod,arr]of Object.entries(importableByMod))if(arr.includes(nm))(imports[mod]||=[]).push(nm);}
  else if(builtins.has(nm))continue;
  else unknown.push(nm);
}
// window.* usage
const win=[...new Set([...blockText.matchAll(/window\.([A-Za-z_$][\w$]*)/g)].map(x=>x[1]))].sort();

console.log('block lines:', blockLines.length, '| localTop:', JSON.stringify([...localTop]));
console.log('\ninjected deps used:', JSON.stringify(injects.sort()));
console.log('\nexternal imports needed:');
for(const mod of Object.keys(imports))console.log('  '+mod+':', JSON.stringify(imports[mod].sort()));
console.log('\nwindow.* globals (guarded, no import):', JSON.stringify(win));
console.log('\nUNKNOWN (must be empty):', JSON.stringify(unknown));
