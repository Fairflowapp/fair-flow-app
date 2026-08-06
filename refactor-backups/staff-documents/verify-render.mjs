import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const backup = readFileSync('refactor-backups/staff-documents/staff-documents.pre-render.js','utf8').split('\n');
const main = readFileSync('public/staff-documents.js','utf8').split('\n');
const mod = readFileSync('public/staff-documents-render.js','utf8').split('\n');

const SLAB_START = 77, SLAB_END = 465;
const slabBackup = backup.slice(SLAB_START-1, SLAB_END);
const tailBackup = backup.slice(SLAB_END);

// 1) slab verbatim inside render module
const anchor = 'function renderActiveSectionWithSubheaders(sortedActive) {';
const aIdx = mod.findIndex(l => l === anchor);
const slabMod = aIdx >= 0 ? mod.slice(aIdx, aIdx+slabBackup.length) : [];
const slabOk = slabMod.join('\n') === slabBackup.join('\n');
console.log('[1] slab verbatim (render == backup[77..465]):', slabOk, '| sha', sha(slabBackup.join('\n')));

// 2) tail verbatim in main
const newTail = main.slice(main.length - tailBackup.length);
const tailOk = newTail.join('\n') === tailBackup.join('\n');
console.log('[2] tail verbatim (main tail == backup[466..end]):', tailOk, '| sha', sha(tailBackup.join('\n')));

// 3) moved fns gone from main
const MOVED = ['renderActiveSectionWithSubheaders','renderFilteredSingleSection','renderSearchRowHtml','renderListContentBody','ensureStaffDocSearchListeners','wireStaffDocExpiryChatButtons','renderListIntoContainer','applyDocumentsSnapshot','ensureSubscription','renderDocumentCard','renderGrouped','renderEmpty'];
const mainText = main.join('\n');
const still = MOVED.filter(fn => new RegExp(`^(export )?(async )?function ${fn}\\b`,'m').test(mainText));
console.log('[3] moved fns still declared in main (want []):', still);

console.log(slabOk && tailOk && still.length===0 ? '\nALL BYTE-IDENTITY CHECKS PASS' : '\nCHECK FAILED');
