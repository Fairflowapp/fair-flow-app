import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const lines = readFileSync('public/staff-documents.js', 'utf8').split('\n');
const SLAB_START = 77, SLAB_END = 465;
const slab = lines.slice(SLAB_START-1, SLAB_END).join('\n');
const rest = lines.filter((_, i) => (i+1 < SLAB_START || i+1 > SLAB_END)).join('\n');

function analyze(code){
  const ast = acorn.parse(code, { ecmaVersion:'latest', sourceType:'module', allowReturnOutsideFunction:true });
  const topFns = new Set();
  for (const n of ast.body){ if(n.type==='FunctionDeclaration'&&n.id) topFns.add(n.id.name);
    if(n.type==='ExportNamedDeclaration'&&n.declaration&&n.declaration.type==='FunctionDeclaration') topFns.add(n.declaration.id.name); }
  const used = new Set();
  walk.ancestor(ast, { Identifier(n,_s,anc){ const p=anc[anc.length-2]; if(!p){used.add(n.name);return;}
    if(p.type==='MemberExpression'&&p.property===n&&!p.computed)return;
    if(p.type==='Property'&&p.key===n&&!p.computed)return;
    if((/Function/).test(p.type)){ if(p.params&&p.params.includes(n))return; if(p.id===n)return; }
    if(p.type==='VariableDeclarator'&&p.id===n)return;
    used.add(n.name);
  }});
  return { topFns:[...topFns], used };
}

const S = analyze(slab), R = analyze(rest);
const IMPORTS = {
  firestore:['collection','doc','onSnapshot'],
  app:['db','auth'],
  state:['sdState','STAFF_DOC_FILTER_IDS'],
  format:['trimStr','ffComputeLifecycleFromExpiration','escapeHtml','escapeAttr','toDateMaybe','formatWhen','formatDay','formatDocumentTitle','formatApprovalLabel','formatLifecycleLabel','staffDocsEmptyMessageHtml','staffDocsShellStyle','expiryBadgeState','badgeHtml','groupDocument','tierForActiveSectionDoc','sortActiveDocuments','sortArchivedDocuments','renderActiveSubheader','filterDocumentsByChip','normalizeStaffDocSearch','docMatchesSearch','sortDocumentsForFilterChip','renderFilterChipsHtml'],
  ui:['ffToast','refreshStaffDocViewerEditMeta','ffHandleStaffDocumentActionClick'],
  expiry:['ffRunExpiryChatNotify','ffSendExpiryChatReminderForStaffDocContext'],
};
const src = {}; for(const[k,v]of Object.entries(IMPORTS))for(const n of v)src[n]=k;

console.log('=== render slab top-level fns ===');
console.log(' ', S.topFns.join(', '));
console.log('\n=== render module imports needed ===');
const need={}; for(const n of S.used){const s=src[n]; if(s)(need[s]=need[s]||new Set()).add(n);}
for(const[s,set]of Object.entries(need)) console.log(`  ${s}: ${[...set].sort().join(', ')}`);
console.log('\n=== free idents in slab not from known imports (globals) ===');
console.log('  ', [...S.used].filter(n=>!src[n] && !S.topFns.includes(n)).sort().join(', '));
console.log('\n=== slab fns still used by main-after (=> main imports from render) ===');
console.log('  ', S.topFns.filter(fn=>R.used.has(fn)).join(', '));
console.log('\n=== main-after: imports that become orphaned ===');
for(const[s,v]of Object.entries(IMPORTS)){
  const stillUsed = new Set(); for(const n of R.used) if(src[n]===s) stillUsed.add(n);
  const orphan = v.filter(n=>!stillUsed.has(n));
  console.log(`  [${s}] still: ${v.filter(n=>stillUsed.has(n)).join(', ')||'(none)'}  |  orphan: ${orphan.join(', ')||'(none)'}`);
}
