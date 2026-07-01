import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const SRC = 'public/media-upload.js';
const OUT = 'public/media-work-details.js';
const TOKEN = '20260701_media_work_details_split';
const STATE_TOKEN = '20260701_media_state_split';
const PROFILE_TOKEN = '20260701_media_profile_split';
const NATIVE_TOKEN = '20260701_media_native_split';

copyFileSync(SRC, 'refactor-backups/media-upload/media-upload.pre-work-details.js');
const orig = readFileSync(SRC,'utf8');
const lines = orig.split('\n');

const B1_START=589, B1_END=1230;
const B2_START=1232, B2_END=1355;
const B3_START=1465, B3_END=1494;

// boundary guards
if(lines[B1_START-1] !== '// =====================' || lines[B1_START] !== '// Work Details Modal'){ console.error('bad B1'); process.exit(1); }
if(!/^function closeWorkDetails\(\)/.test(lines[1225])){ console.error('bad closeWorkDetails', lines[1225]); process.exit(1); }
if(lines[B2_START-1] !== '// =====================' || !/Mark as Posted/.test(lines[B2_START])){ console.error('bad B2'); process.exit(1); }
if(!/^async function saveMarkPosted\(\)/.test(lines[1322])){ console.error('bad saveMarkPosted', lines[1322]); process.exit(1); }
if(!/^function setupWorkDetailsListeners\(\)/.test(lines[B3_START-1])){ console.error('bad B3'); process.exit(1); }
if(lines[B3_END-1] !== '}'){ console.error('bad B3 end', lines[B3_END-1]); process.exit(1); }

const block1 = lines.slice(B1_START-1, B1_END).join('\n');
const block2 = lines.slice(B2_START-1, B2_END).join('\n');
const block3 = lines.slice(B3_START-1, B3_END).join('\n');

const MOD = `/**
 * media-work-details.js — Work Details modal (preview, share/download, manager actions)
 * and Mark as Posted flow for the Media module. Extracted verbatim from media-upload.js (M6).
 */
import { auth } from "/app.js?v=20260610_force_lp_ios";
import { mediaState } from "./media-state.js?v=${STATE_TOKEN}";
import { canHandleMediaWork, isAdmin } from "./media-profile.js?v=${PROFILE_TOKEN}";
import {
  getContentWork,
  getMediaItems,
  getPostedHistory,
  resolveMediaItemsForDisplay,
  addPostedHistory,
  updateContentWork,
  archiveContentWork,
  deleteContentWork,
  deleteMediaItem,
  selfDeleteContentWork,
} from "./media-cloud.js?v=20260623_mediafix";
import {
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
} from "./media-native-share.js?v=${NATIVE_TOKEN}";

// Injected from media-upload.js (main UI slab) to avoid import cycles.
let showMediaMessage = () => {};
let showMediaConfirm = () => {};
let renderMediaList = () => {};
let enrichWorkWithPreview = async (_work) => {};
let formatDate = (_ts) => "";
let getStatusLabels = (_work) => "";
let isSelfDeleteEligible = (_work) => false;
let canShowSelfDeleteButton = () => false;
export function initMediaWorkDetails(deps) {
  if (deps && typeof deps.showMediaMessage === "function") showMediaMessage = deps.showMediaMessage;
  if (deps && typeof deps.showMediaConfirm === "function") showMediaConfirm = deps.showMediaConfirm;
  if (deps && typeof deps.renderMediaList === "function") renderMediaList = deps.renderMediaList;
  if (deps && typeof deps.enrichWorkWithPreview === "function") enrichWorkWithPreview = deps.enrichWorkWithPreview;
  if (deps && typeof deps.formatDate === "function") formatDate = deps.formatDate;
  if (deps && typeof deps.getStatusLabels === "function") getStatusLabels = deps.getStatusLabels;
  if (deps && typeof deps.isSelfDeleteEligible === "function") isSelfDeleteEligible = deps.isSelfDeleteEligible;
  if (deps && typeof deps.canShowSelfDeleteButton === "function") canShowSelfDeleteButton = deps.canShowSelfDeleteButton;
}

${block1}
${block2}
${block3}

export {
  openWorkDetails,
  closeWorkDetails,
  closeMarkPostedModal,
  setupWorkDetailsListeners,
  setupMarkPostedListeners,
};
`;
writeFileSync(OUT, MOD);

const drop = new Set();
for(let i=B1_START;i<=B1_END;i++) drop.add(i);
for(let i=B2_START;i<=B2_END;i++) drop.add(i);
for(let i=B3_START;i<=B3_END;i++) drop.add(i);
let main = lines.filter((_,i)=> !drop.has(i+1)).join('\n');

const FORM_IMP_END = '} from "./media-upload-form.js?v=20260701_media_upload_form_split";';
const WD_IMP = `import {
  initMediaWorkDetails,
  openWorkDetails,
  closeWorkDetails,
  closeMarkPostedModal,
  setupWorkDetailsListeners,
  setupMarkPostedListeners,
} from "./media-work-details.js?v=${TOKEN}";`;
if(!main.includes(FORM_IMP_END)){ console.error('form import missing'); process.exit(1); }
main = main.replace(FORM_IMP_END, FORM_IMP_END + '\n' + WD_IMP);

// trim native import to initMediaNativeShare only
main = main.replace(
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
);

// trim media-cloud import
main = main.replace(
  `import {
  subscribeContentWorks,
  getContentWork,
  getMediaItems,
  getPostedHistory,
  resolveWorkCardPreviewUrl,
  resolveMediaItemsForDisplay,
  addPostedHistory,
  updateContentWork,
  archiveContentWork,
  deleteContentWork,
  deleteMediaItem,
  deleteAllMediaFromWork,
  selfDeleteContentWork,
  getMediaCategories,
  subscribeMediaCategories,
  createMediaCategory,
  updateMediaCategory,
  deleteMediaCategory,
} from "./media-cloud.js?v=20260623_mediafix";`,
  `import {
  subscribeContentWorks,
  resolveWorkCardPreviewUrl,
  updateContentWork,
  deleteAllMediaFromWork,
  getMediaCategories,
  subscribeMediaCategories,
  createMediaCategory,
  updateMediaCategory,
  deleteMediaCategory,
} from "./media-cloud.js?v=20260623_mediafix";`
);

const INIT = 'function initMediaModule() {';
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
if(!main.includes(INIT)){ console.error('initMediaModule missing'); process.exit(1); }
main = main.replace(INIT, `${INIT}\n${INJECT}`);

writeFileSync(SRC, main);
console.log('media-work-details.js lines:', MOD.split('\n').length);
console.log('main:', lines.length, '->', main.split('\n').length);
console.log('sha(main):', sha(main));
