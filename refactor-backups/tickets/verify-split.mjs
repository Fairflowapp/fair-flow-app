import fs from 'fs';
import crypto from 'crypto';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const PRE = fs.readFileSync('refactor-backups/tickets/tickets-catalog-ui.pre-split.js', 'utf8');
const m = JSON.parse(fs.readFileSync('refactor-backups/tickets/manifest-split.json', 'utf8'));

const RENDER = fs.readFileSync('public/tickets-catalog-render.js', 'utf8');
const TABS = fs.readFileSync('public/tickets-catalog-tabs.js', 'utf8');
const EDIT = fs.readFileSync('public/tickets-catalog-edit.js', 'utf8');

const Atext = m.A.join('\n');
const Btext = m.B.join('\n');
const Ctext = m.C.join('\n');

console.log('=== BYTE-IDENTITY (block verbatim inside each new file) ===');
console.log('  render.js contains A (' + m.A.length + ' lines):', RENDER.includes(Atext));
console.log('  tabs.js   contains B (' + m.B.length + ' lines):', TABS.includes(Btext));
console.log('  edit.js   contains C (' + m.C.length + ' lines):', EDIT.includes(Ctext));

console.log('\n=== REVERSIBILITY (head + A + B + C + tail === pre-split) ===');
const reconstructed = [...m.head, ...m.A, ...m.B, ...m.C, ...m.tail].join('\n');
console.log('  pre-split sha:    ', sha(PRE));
console.log('  reconstructed sha:', sha(reconstructed));
console.log('  BYTE-IDENTICAL:', sha(PRE) === sha(reconstructed));
if (sha(PRE) !== sha(reconstructed)) {
  const a = PRE.split('\n'), b = reconstructed.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { console.log('  first diff line', i + 1, '\n   PRE :', JSON.stringify(a[i]), '\n   RECON:', JSON.stringify(b[i])); break; }
  }
}

console.log('\n=== EXPORT COVERAGE ===');
const all = [...m.NA, ...m.NB, ...m.NC];
console.log('  total exported fns across 3 files:', all.length, '(expected 49)');
// barrel re-exports all
const BARREL = fs.readFileSync('public/tickets-catalog-ui.js', 'utf8');
const missing = all.filter(n => !new RegExp('\\b' + n + '\\b').test(BARREL));
console.log('  names missing from barrel re-export:', JSON.stringify(missing));
// the 13 tickets.js consumes
const consumed = ['_ffEnsureCatalogEditorPortal','_ffServicesMobileShowList','openServicesModal','closeServicesModal','renderServicesCatalogV2','ffServiceStaffPermissionTrue','canStaffSendNewTicket','getStaffDefaultServiceCommission','getStaffDefaultSupplyDeduction','_ffCatalogEditorClose','addServiceCategoryV2','addSharedServiceV2'];
const notCovered = consumed.filter(n => !all.includes(n));
console.log('  tickets.js-consumed names NOT exported anywhere:', JSON.stringify(notCovered));
