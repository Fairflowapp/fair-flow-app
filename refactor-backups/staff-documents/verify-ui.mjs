import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const backup = readFileSync('refactor-backups/staff-documents/staff-documents.pre-ui.js', 'utf8').split('\n');
const main = readFileSync('public/staff-documents.js', 'utf8').split('\n');
const ui = readFileSync('public/staff-documents-ui.js', 'utf8').split('\n');

const SLAB_START = 85, SLAB_END = 845;
const slabBackup = backup.slice(SLAB_START-1, SLAB_END);   // 761
const tailBackup = backup.slice(SLAB_END);                 // 846..end

// 1) slab verbatim inside ui.js
const anchor = 'export async function ffUpdateStaffDocumentMetadata({ salonId, staffId, documentId, type, expirationYmd, title }) {';
const aIdx = ui.findIndex(l => l === anchor);
const slabUi = aIdx >= 3 ? ui.slice(aIdx-3, aIdx-3+slabBackup.length) : [];
const slabOk = slabUi.join('\n') === slabBackup.join('\n');
console.log('[1] slab verbatim (ui.js == backup[85..845]):', slabOk, '| sha', sha(slabBackup.join('\n')));

// 2) tail verbatim in main (last N lines == backup[846..end])
const newTail = main.slice(main.length - tailBackup.length);
const tailOk = newTail.join('\n') === tailBackup.join('\n');
console.log('[2] tail verbatim (main tail == backup[846..end]):', tailOk, '| sha', sha(tailBackup.join('\n')));

// 3) confirm none of the 16 moved fns remain declared in main
const MOVED = ['ffUpdateStaffDocumentMetadata','ffToast','ffStaffDocumentsConfirm','refreshStaffDocViewerEditMeta','ffOpenStaffDocumentEditMetadataModal','closePopupIfOpen','openBlankTabForLaterNavigation','assignUrlToTabOrOpenFresh','ffStaffDocsIsIosMobile','ffStaffDocsIsImageDocument','ffOpenStaffDocumentIosViewer','openStaffDocumentResolvedUrl','ffOpenReplaceDocumentModal','ffReplaceStaffDocumentVersion','ffStaffDocClickTargetEl','ffHandleStaffDocumentActionClick'];
const mainText = main.join('\n');
const stillDeclared = MOVED.filter(fn => new RegExp(`^(export )?(async )?function ${fn}\\b`, 'm').test(mainText));
console.log('[3] moved fns still declared in main (want []):', stillDeclared);

console.log(slabOk && tailOk && stillDeclared.length===0 ? '\nALL BYTE-IDENTITY CHECKS PASS' : '\nCHECK FAILED');
