import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = s => createHash('sha1').update(s).digest('hex');
const BACKUP = 'refactor-backups/staff-documents/staff-documents.pre-state.js';
const NEW_MAIN = 'public/staff-documents.js';
const TOKEN = '20260701_staffdoc_state_split';

const orig = readFileSync(BACKUP, 'utf8');
const origLines = orig.split('\n');
const BLOCK_START = 153, BLOCK_END = 190;
const IMPORT_LINES = [7, 32];
const dropSet = new Set(IMPORT_LINES);
for (let i = BLOCK_START; i <= BLOCK_END; i++) dropSet.add(i);

const VARS = ['_unsub','_mountedKey','_mountCtx','_ffExpiryNotifyDedupe','_ffExpiryNotifyInFlight','_ffBoundContainer','_onDocActionClick','_lastDocList','_staffDocumentsFilter','_staffDocumentsSearchQuery','_staffDocsViewerCanEditMeta','_onStaffDocSearchInput'];

let text = readFileSync(NEW_MAIN, 'utf8');

// 1) remove inserted state import
const STATE_IMPORT = `import { sdState, STAFF_DOC_FILTER_IDS, getMediaDownloadUrlCallable } from "./staff-documents-state.js?v=${TOKEN}";`;
if (!text.includes(STATE_IMPORT)) { console.log('[!] state import not found in main'); }
text = text.replace('\n' + STATE_IMPORT, '');

// 2) reverse rename sdState._var -> _var
for (const v of VARS) {
  text = text.replace(new RegExp(`\\bsdState\\.${v}\\b`, 'g'), v);
}

// sanity: no stray sdState references should remain
const stray = (text.match(/\bsdState\b/g) || []).length;
console.log('[check] stray sdState refs after reverse:', stray);

// 3) reinsert dropped lines (imports 7/32 + block 153-190) from backup
const reducedLines = text.split('\n');
const recon = []; let ri = 0;
for (let i = 1; i <= origLines.length; i++) {
  if (dropSet.has(i)) recon.push(origLines[i-1]);
  else { recon.push(reducedLines[ri]); ri++; }
}
const reconStr = recon.join('\n');
console.log('[1] semantic-identity (reverse-transform == backup):', sha(reconStr) === sha(orig));
console.log('    sha recon:', sha(reconStr));
console.log('    sha orig :', sha(orig));
if (ri !== reducedLines.length) console.log('    WARN leftover reduced lines:', reducedLines.length - ri);
