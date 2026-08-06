import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const SRC = 'public/staff-documents.js';
const lines = readFileSync(SRC, 'utf8').split('\n');

// contiguous ui slab: lines 85..845 (1-indexed inclusive)
const SLAB_START = 85, SLAB_END = 845;
const slab = lines.slice(SLAB_START-1, SLAB_END).join('\n');
const rest = lines.filter((_, i) => (i+1 < SLAB_START || i+1 > SLAB_END)).join('\n');

// collect free identifiers referenced in a code string (idents not declared within it)
function freeIdents(code) {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
  const declared = new Set();
  const used = new Set();
  walk.ancestor(ast, {
    FunctionDeclaration(n){ if(n.id) declared.add(n.id.name); },
    VariableDeclarator(n){ if(n.id.type==='Identifier') declared.add(n.id.name); },
    Identifier(n, _st, anc){
      const p = anc[anc.length-2];
      if(!p) { used.add(n.name); return; }
      if(p.type==='MemberExpression' && p.property===n && !p.computed) return; // obj.prop
      if((p.type==='Property') && p.key===n && !p.computed) return; // {key:...}
      if(p.type==='FunctionDeclaration' || p.type==='FunctionExpression' || p.type==='ArrowFunctionExpression') {
        if(p.params && p.params.includes(n)) return;
        if(p.id===n) return;
      }
      if(p.type==='VariableDeclarator' && p.id===n) return;
      used.add(n.name);
    }
  });
  return { declared, used };
}

const slabInfo = freeIdents(slab);
const restInfo = freeIdents(rest);

// import sources in this file
const IMPORTS = {
  firestore: ['collection','doc','getDoc','getDocs','limit','query','setDoc','updateDoc','deleteDoc','onSnapshot','serverTimestamp','Timestamp','deleteField','increment','where','writeBatch'],
  storage: ['storageRef','uploadBytes','getDownloadURL','deleteObject'],
  app: ['db','auth','storage'],
  state: ['sdState','STAFF_DOC_FILTER_IDS','getMediaDownloadUrlCallable'],
  format: ['trimStr','stripUndefined','ffStaffDocumentTypeSelectOptionsHtml','ffExpirationTimestampToYmdInput','parseExpirationForStaffDoc','calendarDaysUntilExpiry','ffComputeLifecycleFromExpiration','escapeHtml','escapeAttr','toDateMaybe','formatWhen','formatDay','formatDocumentTitle','formatApprovalLabel','formatLifecycleLabel','staffDocsEmptyMessageHtml','staffDocsShellStyle','expiryBadgeState','badgeHtml','groupDocument','tierForActiveSectionDoc','sortActiveDocuments','sortArchivedDocuments','renderActiveSubheader','filterDocumentsByChip','normalizeStaffDocSearch','docMatchesSearch','sortDocumentsForFilterChip','renderFilterChipsHtml'],
  inboxsync: ['ffResyncStaffDocumentFromInbox'],
};
const all = {};
for (const [k,v] of Object.entries(IMPORTS)) for (const n of v) all[n]=k;

// slab top-level fn names (these move to ui; main may re-import some)
const slabFns = [...slabInfo.declared];

function classify(usedSet){
  const bySrc = {};
  for (const n of usedSet){ const s = all[n]; if(s){ (bySrc[s]=bySrc[s]||[]).push(n); } }
  return bySrc;
}

console.log('=== SLAB (ui.js) top-level declarations ===');
console.log(slabFns.join(', '));
console.log('\n=== ui.js imports needed (used in slab, provided by a module) ===');
const uiImp = classify(slabInfo.used);
for(const [s,ns] of Object.entries(uiImp)) console.log(`  ${s}: ${[...new Set(ns)].sort().join(', ')}`);

console.log('\n=== ui.js free idents NOT from known imports (injected/local/global) ===');
const uiUnknown = [...slabInfo.used].filter(n=>!all[n] && !slabInfo.declared.has(n)).sort();
console.log('  ', uiUnknown.join(', '));

console.log('\n=== main-after-removal: which slab fns are still referenced (=> import from ui) ===');
const stillUsed = slabFns.filter(fn => restInfo.used.has(fn)).sort();
console.log('  ', stillUsed.join(', '));

console.log('\n=== main-after-removal: imports that become UNUSED (drop from main) ===');
const mainImp = classify(restInfo.used);
for(const [s,v] of Object.entries(IMPORTS)){
  const used = new Set(mainImp[s]||[]);
  const unused = v.filter(n=> !used.has(n));
  const stillThere = v.filter(n=> used.has(n));
  console.log(`  [${s}] still-used: ${stillThere.join(', ') || '(none)'}`);
  console.log(`  [${s}] now-UNUSED: ${unused.join(', ') || '(none)'}`);
}
