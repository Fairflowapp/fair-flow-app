import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const backup = readFileSync('refactor-backups/media-upload/media-upload.pre-work-details.js','utf8');
const backupLines = backup.split('\n');
const main = readFileSync('public/media-upload.js','utf8');
const mod = readFileSync('public/media-work-details.js','utf8');
const TOKEN='20260701_media_work_details_split';

const B1_START=589, B1_END=1230;
const B2_START=1232, B2_END=1355;
const B3_START=1465, B3_END=1494;

const origBlock1 = backupLines.slice(B1_START-1, B1_END).join('\n');
const origBlock2 = backupLines.slice(B2_START-1, B2_END).join('\n');
const origBlock3 = backupLines.slice(B3_START-1, B3_END).join('\n');

const modLines = mod.split('\n');
const b1Start = modLines.findIndex((l,i)=> l==='// =====================' && modLines[i+1]==='// Work Details Modal');
const b2Start = modLines.findIndex((l,i)=> l==='// =====================' && /Mark as Posted Modal/.test(modLines[i+1]));
const b3Start = modLines.findIndex(l=>/^function setupWorkDetailsListeners\(\)/.test(l));
const expStart = modLines.findIndex(l=>/^export \{$/.test(l));
const modBlock1 = modLines.slice(b1Start, b2Start).join('\n').replace(/\n+$/,'');
const modBlock2 = modLines.slice(b2Start, b3Start).join('\n').replace(/\n+$/,'');
const modBlock3 = modLines.slice(b3Start, expStart).join('\n').replace(/\n+$/,'');

console.log('[byte] block1 589..1230:', sha(modBlock1)===sha(origBlock1));
console.log('[byte] block2 1232..1355:', sha(modBlock2)===sha(origBlock2));
console.log('[byte] block3 1465..1494:', sha(modBlock3)===sha(origBlock3));

const WD_IMP = `import {
  initMediaWorkDetails,
  openWorkDetails,
  closeWorkDetails,
  closeMarkPostedModal,
  setupWorkDetailsListeners,
  setupMarkPostedListeners,
} from "./media-work-details.js?v=${TOKEN}";`;
const INJECT = `  initMediaWorkDetails({
    showMediaMessage,
    showMediaConfirm,
    renderMediaList,
    enrichWorkWithPreview,
    formatDate,
    getStatusLabels,
    isSelfDeleteEligible,
    canShowSelfDeleteButton,
  });`;

const drop = new Set();
for(let i=B1_START;i<=B1_END;i++) drop.add(i);
for(let i=B2_START;i<=B2_END;i++) drop.add(i);
for(let i=B3_START;i<=B3_END;i++) drop.add(i);

let expectedReduced = backupLines.filter((_,i)=> !drop.has(i+1));
expectedReduced = expectedReduced.filter(l => !/^\s+getContentWork,/.test(l) && !/^\s+getMediaItems,/.test(l) && !/^\s+getPostedHistory,/.test(l));
expectedReduced = expectedReduced.filter(l => !/^\s+resolveMediaItemsForDisplay,/.test(l) && !/^\s+addPostedHistory,/.test(l));
expectedReduced = expectedReduced.filter(l => !/^\s+archiveContentWork,/.test(l) && !/^\s+deleteContentWork,/.test(l) && !/^\s+deleteMediaItem,/.test(l) && !/^\s+selfDeleteContentWork,/.test(l));
expectedReduced = expectedReduced.filter(l => !/^\s+ffGetCapacitor,/.test(l) && !/^\s+ffWithTimeout,/.test(l) && !/^\s+ffIsNativeCapacitor,/.test(l));
expectedReduced = expectedReduced.filter(l => !/^\s+ffNativeBridge,/.test(l) && !/^\s+ffGetCapShare,/.test(l) && !/^\s+ffIsShareCancel,/.test(l));
expectedReduced = expectedReduced.filter(l => !/^\s+ffMediaFastUrlMode,/.test(l) && !/^\s+ffShareMediaUrlFast,/.test(l));
expectedReduced = expectedReduced.filter(l => !/^\s+ffSaveBlobToDeviceViaShare,/.test(l) && !/^\s+ffShareBlobNative,/.test(l));
expectedReduced = expectedReduced.filter(l => !/^\s+fetchBlobViaHttpProxy,/.test(l) && !/^\s+triggerMediaFileDownload,/.test(l));
expectedReduced = expectedReduced.map(l => l === 'import {' ? l : l)
  .join('\n')
  .replace(
    `import {
  initMediaNativeShare,
  ffGetCapacitor,
  ffWithTimeout,
  ffIsNativeCapacitor,
  ffNativeBridge,
  ffGetCapShare,
  ffIsShareCancel,
  ffMediaFastUrlMode,
  ffShareMediaUrlFast,
  ffSaveBlobToDeviceViaShare,
  ffShareBlobNative,
  fetchBlobViaHttpProxy,
  triggerMediaFileDownload,
} from "./media-native-share.js?v=20260701_media_native_split";`,
    `import { initMediaNativeShare } from "./media-native-share.js?v=20260701_media_native_split";`
  )
  .split('\n');

let actualReduced = main.replace('\n'+WD_IMP,'').replace('\n'+INJECT,'').split('\n');
console.log('[check] reduced lines:', actualReduced.length, '==', expectedReduced.length, '→', actualReduced.length===expectedReduced.length);
if(actualReduced.length===expectedReduced.length){
  console.log('[semantic] reduced identical:', actualReduced.every((l,i)=>l===expectedReduced[i]));
}

const fi = expectedReduced.findIndex(l => l.includes('media-upload-form.js'));
const expectedMain = expectedReduced.slice();
expectedMain.splice(fi + 1, 0, WD_IMP);
const im = expectedMain.findIndex(l => l === 'function initMediaModule() {');
expectedMain.splice(im + 1, 0, INJECT);
console.log('[semantic] full main round-trip:', sha(expectedMain.join('\n'))===sha(main));

for(const n of ['openWorkDetails','closeWorkDetails','closeMarkPostedModal','setupWorkDetailsListeners','setupMarkPostedListeners']){
  const c=(main.match(new RegExp('\\b'+n+'\\b','g'))||[]).length;
  console.log(`   main uses ${n}: ${c-1} refs (excl import)`);
}
