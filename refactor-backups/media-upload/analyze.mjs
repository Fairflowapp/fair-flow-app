import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const src = readFileSync('public/media-upload.js','utf8');
const ast = acorn.parse(src, { ecmaVersion:'latest', sourceType:'module', ranges:true, locations:true });

// module-level bindings: function decls + imported names + top-level const/let (mediaState etc. now imported)
const topFns = new Map(); // name -> node
const imported = new Set();
const topVars = new Set();
for(const n of ast.body){
  if(n.type==='FunctionDeclaration' && n.id) topFns.set(n.id.name, n);
  else if((n.type==='ExportNamedDeclaration'||n.type==='ExportDefaultDeclaration') && n.declaration && n.declaration.type==='FunctionDeclaration') topFns.set(n.declaration.id.name, n.declaration);
  else if(n.type==='ImportDeclaration'){ for(const s of n.specifiers) imported.add(s.local.name); }
  else if(n.type==='VariableDeclaration'){ for(const d of n.declarations){ if(d.id.type==='Identifier') topVars.add(d.id.name); } }
}

// collect free identifiers used within a function node (names not locally declared in it)
function freeIdents(fnNode){
  const used = new Set();
  const declared = new Set();
  // params
  (function collectParams(params){ for(const p of params) collectPattern(p, declared); })(fnNode.params||[]);
  walk.ancestor(fnNode.body||fnNode, {
    Identifier(node,_st,anc){
      const p = anc[anc.length-2];
      if(p && p.type==='MemberExpression' && p.property===node && !p.computed) return;
      if(p && p.type==='Property' && p.key===node && !p.computed && !p.shorthand) return;
      used.add(node.name);
    },
    VariableDeclarator(node){ collectPattern(node.id, declared); },
    FunctionDeclaration(node){ if(node.id) declared.add(node.id.name); (node.params||[]).forEach(pp=>collectPattern(pp,declared)); },
  });
  const free = new Set();
  for(const u of used){ if(!declared.has(u)) free.add(u); }
  return free;
}
function collectPattern(p, set){
  if(!p) return;
  if(p.type==='Identifier') set.add(p.name);
  else if(p.type==='ObjectPattern') p.properties.forEach(pr=> collectPattern(pr.value||pr.argument, set));
  else if(p.type==='ArrayPattern') p.elements.forEach(e=> collectPattern(e,set));
  else if(p.type==='AssignmentPattern') collectPattern(p.left,set);
  else if(p.type==='RestElement') collectPattern(p.argument,set);
}

const GROUPS = {
  M2_profile: ['legacyMediaHandleFromStaffDoc','computeMediaHandleAllowed','waitForSalonId','resolveSalonStaffDoc','enrichStaffDocIfMissing','loadUserProfile','canHandleMediaWork','isAdmin'],
  M5_native: ['ffGetCapacitor','ffTimeoutPromise','ffWithTimeout','ffIsNativeCapacitor','ffNativeBridge','ffCallNative','ffGetCapShare','ffGetCapFs','ffCapDir','ffBlobToBase64','ffWriteBlobToCapCache','ffIsShareCancel','ffMediaFastUrlMode','ffShareMediaUrlFast','ffSaveBlobToDeviceViaShare','ffShareBlobNative','fetchBlobViaHttpProxy','triggerMediaFileDownload'],
};

// build map: for each top fn, set of top-level names it references
const fnRefs = new Map();
for(const [name,node] of topFns){ fnRefs.set(name, freeIdents(node)); }

for(const [gname, members] of Object.entries(GROUPS)){
  const memberSet = new Set(members);
  // external deps: names referenced by members that are NOT in this group
  const extFns = new Set(), extImports = new Set(), extVars = new Set(), unknown = new Set();
  for(const m of members){
    const refs = fnRefs.get(m);
    if(!refs){ console.log('MISSING fn', m); continue; }
    for(const r of refs){
      if(memberSet.has(r)) continue;
      if(topFns.has(r)) extFns.add(r);
      else if(imported.has(r)) extImports.add(r);
      else if(topVars.has(r)) extVars.add(r);
      else { /* globals/builtins */ }
    }
  }
  // who outside the group references group members?
  const consumersOutside = new Set();
  for(const [name,refs] of fnRefs){ if(memberSet.has(name)) continue; for(const r of refs){ if(memberSet.has(r)) consumersOutside.add(r); } }
  console.log('\n===== '+gname+' ('+members.length+' fns) =====');
  console.log('needs OTHER top-level FUNCTIONS (main):', [...extFns].sort());
  console.log('needs IMPORTS (fb/app/state/cloud):', [...extImports].sort());
  console.log('needs TOP VARS:', [...extVars].sort());
  console.log('EXPORT (used outside group):', [...consumersOutside].sort());
}
