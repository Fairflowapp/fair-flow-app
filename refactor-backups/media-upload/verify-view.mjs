import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const backup = readFileSync('refactor-backups/media-upload/media-upload.pre-view.js','utf8');
const backupLines = backup.split('\n');
const main = readFileSync('public/media-upload.js','utf8');
const mod = readFileSync('public/media-view.js','utf8');
const TOKEN='20260701_media_view_split';

const B_START=47, B_END=568;
const origBlock = backupLines.slice(B_START-1, B_END).join('\n');

const modLines = mod.split('\n');
const bStart = modLines.findIndex((l,i)=> l==='// =====================' && modLines[i+1]==='// Tab switching');
const expStart = modLines.findIndex(l=>/^export \{$/.test(l));
const modBlock = modLines.slice(bStart, expStart).join('\n').replace(/\n+$/,'');

console.log('[byte] block 47..568:', sha(modBlock)===sha(origBlock), '|', origBlock.length, modBlock.length);

const VIEW_IMP = `import {
  setMediaTab,
  renderMediaFilters,
  renderMediaList,
  applyToHandleVisibility,
  showMediaMessage,
  showMediaConfirm,
  enrichWorkWithPreview,
  formatDate,
  getStatusLabels,
  isSelfDeleteEligible,
  canShowSelfDeleteButton,
  updateMediaUploadWorkButtonVisibility,
  closeMediaDropdowns,
  _positionMediaDropdownPanel,
} from "./media-view.js?v=${TOKEN}";`;

const drop = new Set();
for(let i=B_START;i<=B_END;i++) drop.add(i);
let expectedReduced = backupLines.filter((_,i)=> !drop.has(i+1));
expectedReduced = expectedReduced.map(l=>l).join('\n')
  .replace(
    `import {
  mediaState,
  MEDIA_DROPDOWN_FLOAT_MQ,
  MY_UPLOADS_FILTERS,
  TO_HANDLE_FILTERS,
  SORT_OPTIONS,
} from "./media-state.js?v=20260701_media_state_split";`,
    `import { mediaState } from "./media-state.js?v=20260701_media_state_split";`
  )
  .replace(
    `  resolveWorkCardPreviewUrl,\n  updateContentWork,`,
    `  updateContentWork,`
  )
  .split('\n');

let actualReduced = main.replace('\n'+VIEW_IMP,'').split('\n');
console.log('[check] reduced lines:', actualReduced.length, '==', expectedReduced.length, '→', actualReduced.length===expectedReduced.length);
if(actualReduced.length===expectedReduced.length){
  console.log('[semantic] reduced identical:', actualReduced.every((l,i)=>l===expectedReduced[i]));
}

const wi = expectedReduced.findIndex(l => l.includes('media-work-details.js'));
const expectedMain = expectedReduced.slice();
expectedMain.splice(wi + 1, 0, VIEW_IMP);
console.log('[semantic] full main round-trip:', sha(expectedMain.join('\n'))===sha(main));

for(const n of ['setMediaTab','renderMediaFilters','renderMediaList','showMediaMessage','closeMediaDropdowns','_positionMediaDropdownPanel']){
  const c=(main.match(new RegExp('\\b'+n+'\\b','g'))||[]).length;
  console.log(`   main uses ${n}: ${c-1} refs (excl import)`);
}

console.log('[cycle] view imports work-details:', /from \"\.\/media-work-details/.test(mod));
console.log('[cycle] work-details imports view:', /media-view/.test(readFileSync('public/media-work-details.js','utf8')));
