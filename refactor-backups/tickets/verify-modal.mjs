import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as acorn from 'acorn';

const sha = s => createHash('sha1').update(s).digest('hex');
const backup = readFileSync('refactor-backups/tickets/tickets-modal.pre-split.js', 'utf8');
const view = readFileSync('public/tickets-modal-view.js', 'utf8');
const edit = readFileSync('public/tickets-modal-edit.js', 'utf8');
const barrel = readFileSync('public/tickets-modal.js', 'utf8');

const bl = backup.split('\n');
const truthA = bl.slice(46, 582).join('\n');   // 47..582
const truthB = bl.slice(583, 1138).join('\n');  // 584..1138

let pass = true; const ok = (c,m)=>{ if(!c) pass=false; console.log((c?'PASS':'FAIL')+' — '+m); };

// A/B byte identity
ok(sha(truthA)==='225c6f77dab84c75dc72636028a1f1baa6194da2', 'blockA sha == extract ('+sha(truthA)+')');
ok(sha(truthB)==='2f91fc553801d9602f7fa733f9fbefd0ef9117dc', 'blockB sha == extract ('+sha(truthB)+')');
ok(view.includes(truthA), 'view.js contains blockA verbatim');
ok(edit.includes(truthB), 'edit.js contains blockB verbatim');

// tiling / reversibility at block level
const recon = [...bl.slice(0,46), truthA, bl[582], truthB, ...bl.slice(1138)].join('\n');
ok(sha(recon)===sha(backup), 'preamble+A+sep+B+tail tiles original byte-identically');
console.log('   backup sha :', sha(backup));
console.log('   recon  sha :', sha(recon));

// exported API parity
function exportsOf(src){
  const ast = acorn.parse(src,{ecmaVersion:'latest',sourceType:'module'});
  const s=new Set();
  for(const n of ast.body){
    if(n.type==='ExportNamedDeclaration'){
      if(n.declaration&&n.declaration.type==='FunctionDeclaration') s.add(n.declaration.id.name);
      for(const sp of n.specifiers) s.add(sp.exported.name);
    }
  }
  return s;
}
const bE = exportsOf(backup), rE = exportsOf(barrel);
bE.delete('initTicketsModal'); rE.delete('initTicketsModal');
const missing=[...bE].filter(x=>!rE.has(x)); const extra=[...rE].filter(x=>!bE.has(x));
ok(missing.length===0 && extra.length===0, `barrel re-exports same ${bE.size} fns (missing=[${missing}] extra=[${extra}])`);
ok(exportsOf(barrel).has('initTicketsModal'), 'barrel exports initTicketsModal');

// cross-injection integrity
const VIEW_EXPORTS=['openTicketModal','ffFormatReviewedAt','toggleTicketReviewed','openAdminTicketView','closeTicketModal','openTicketDetailsModal','closeTicketDetailsModal','ffTicketRequiresCustomerName','ffApplyTicketCustomerRequiredUI','resetTicketForm'];
const EDIT_EXPORTS=['populateTicketForm','syncTicketFormLinesFromDom','renderPerformedLines','renderDiff','addServiceToTicket','addProductToTicket','setupTicketFormToggles','updateTicketDiff','updateTicketTotal','paintTicketServiceUpgradeButton','setupTicketServiceUpgradeControl','saveTicket','doSendNewTicket','doFinalizeTicket','doCloseTicket'];
const VIEW_CROSS=['populateTicketForm','setupTicketServiceUpgradeControl','doCloseTicket','doSendNewTicket','paintTicketServiceUpgradeButton','updateTicketDiff','setupTicketFormToggles'];
const EDIT_CROSS=['closeTicketModal','openTicketDetailsModal','ffTicketRequiresCustomerName','ffApplyTicketCustomerRequiredUI'];
ok(VIEW_CROSS.every(n=>EDIT_EXPORTS.includes(n)), 'all VIEW cross-deps are exported by edit');
ok(EDIT_CROSS.every(n=>VIEW_EXPORTS.includes(n)), 'all EDIT cross-deps are exported by view');
// each cross fn wired in barrel init calls
ok(VIEW_CROSS.every(n=>new RegExp('initModalView[\\s\\S]*?\\b'+n+'\\b[\\s\\S]*?\\}\\);').test(barrel)), 'barrel passes all VIEW cross-deps to initModalView');
ok(EDIT_CROSS.every(n=>new RegExp('initModalEdit[\\s\\S]*?\\b'+n+'\\b[\\s\\S]*?\\}\\);').test(barrel)), 'barrel passes all EDIT cross-deps to initModalEdit');

console.log('\n'+(pass?'ALL CHECKS PASS':'*** FAILURES ***'));
process.exit(pass?0:1);
