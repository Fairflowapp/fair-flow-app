import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const backup = readFileSync('refactor-backups/media-upload/media-upload.pre-upload-form.js','utf8');
const backupLines = backup.split('\n');
const main = readFileSync('public/media-upload.js','utf8');
const mod = readFileSync('public/media-upload-form.js','utf8');
const TOKEN='20260701_media_upload_form_split';

const B1_START=584, B1_END=1149;
const B2_START=2026, B2_END=2049;
const origBlock1 = backupLines.slice(B1_START-1, B1_END).join('\n');
const origBlock2 = backupLines.slice(B2_START-1, B2_END).join('\n');

const modLines = mod.split('\n');
const b1Start = modLines.findIndex((l,i)=> l==='// =====================' && modLines[i+1]==='// Upload Modal');
const b2Start = modLines.findIndex(l=>/^function setupUploadModalListeners\(\)/.test(l));
const expStart = modLines.findIndex(l=>/^export \{$/.test(l));
const modBlock1 = modLines.slice(b1Start, b2Start).join('\n').replace(/\n+$/,'');
const modBlock2 = modLines.slice(b2Start, expStart).join('\n').replace(/\n+$/,'');

console.log('[byte] block1 == original 584..1149:', sha(modBlock1)===sha(origBlock1));
console.log('[byte] block2 == original 2026..2049:', sha(modBlock2)===sha(origBlock2));

const FORM_IMP = `import {
  initMediaUploadForm,
  populateWorksDropdown,
  populateMediaCategoriesDropdown,
  openUploadModal,
  closeUploadModal,
  setupUploadModalListeners,
  setupModalBackdrops,
  toggleFileInputs,
  toggleNewFieldsAndExisting,
} from "./media-upload-form.js?v=${TOKEN}";`;

// Build expected reduced from backup: drop blocks, keep imports as trimmed in main
const drop = new Set();
for(let i=B1_START;i<=B1_END;i++) drop.add(i);
for(let i=B2_START;i<=B2_END;i++) drop.add(i);
let expectedReduced = backupLines.filter((_,i)=> !drop.has(i+1));
// apply same import trims as extract script
expectedReduced = expectedReduced.filter(l => !/^\s+MEDIA_UPLOAD_POINTS_DAILY_CAP,/.test(l) && !/^\s+MEDIA_MAX_IMAGES_PER_UPLOAD,/.test(l));
expectedReduced = expectedReduced.filter(l => !/^\s+createWorkWithMedia,/.test(l) && !/^\s+createWorkWithMediaBestEffort,/.test(l) && !/^\s+addMediaToExistingWork,/.test(l) && !/^\s+addMediaToExistingWorkBestEffort,/.test(l));
expectedReduced = expectedReduced.filter(l => !/^import \{ getDocs, doc, collection, query, where \}/.test(l));

// undo M4 wiring from main
let actualReduced = main.replace('\n'+FORM_IMP,'').replace('\n  initMediaUploadForm({ closeWorkDetails, closeMarkPostedModal });','').split('\n');

console.log('[check] reduced line count match:', actualReduced.length, '==', expectedReduced.length, '→', actualReduced.length===expectedReduced.length);
console.log('[semantic] reduced main == expected transform:', actualReduced.length===expectedReduced.length && actualReduced.every((l,i)=>l===expectedReduced[i]));

// full backup reversibility intentionally false (import trim + form wiring); verify round-trip to current main:
const ni = expectedReduced.findIndex(l => l.includes('media-native-share.js'));
const expectedMainLines = expectedReduced.slice();
expectedMainLines.splice(ni + 1, 0, FORM_IMP);
const im = expectedMainLines.findIndex(l => l === 'function initMediaModule() {');
expectedMainLines.splice(im + 1, 0, '  initMediaUploadForm({ closeWorkDetails, closeMarkPostedModal });');
console.log('[semantic] full main == round-trip transform:', sha(expectedMainLines.join('\n'))===sha(main));

for(const n of ['populateWorksDropdown','populateMediaCategoriesDropdown','openUploadModal','setupUploadModalListeners','setupModalBackdrops','toggleFileInputs','toggleNewFieldsAndExisting']){
  const c=(main.match(new RegExp('\\b'+n+'\\b','g'))||[]).length;
  console.log(`   main uses ${n}: ${c-1} refs (excl import)`);
}
