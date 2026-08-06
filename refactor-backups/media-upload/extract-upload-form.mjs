import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const SRC = 'public/media-upload.js';
const OUT = 'public/media-upload-form.js';
const TOKEN = '20260701_media_upload_form_split';
const STATE_TOKEN = '20260701_media_state_split';
const PROFILE_TOKEN = '20260701_media_profile_split';

copyFileSync(SRC, 'refactor-backups/media-upload/media-upload.pre-upload-form.js');
const orig = readFileSync(SRC,'utf8');
const lines = orig.split('\n');

const B1_START=584, B1_END=1149;
const B2_START=2026, B2_END=2049;

if(!/^\/\/ Upload Modal/.test(lines[B1_START])){ console.error('bad B1 header', JSON.stringify(lines[B1_START])); process.exit(1); }
if(!/^function getUploadMode\(\)/.test(lines[B1_START+3])){ console.error('bad B1 fn', JSON.stringify(lines[B1_START+3])); process.exit(1); }
if(!/^function setupModalBackdrops\(\)/.test(lines[1135])){ console.error('bad setupModalBackdrops', JSON.stringify(lines[1135])); process.exit(1); }
if(lines[B1_END-1]!=='}'){ console.error('bad B1 end', JSON.stringify(lines[B1_END-1])); process.exit(1); }
if(!/^function setupUploadModalListeners\(\)/.test(lines[B2_START-1])){ console.error('bad B2 fn', JSON.stringify(lines[B2_START-1])); process.exit(1); }
if(lines[B2_END-1]!=='}'){ console.error('bad B2 end', JSON.stringify(lines[B2_END-1])); process.exit(1); }

const block1 = lines.slice(B1_START-1, B1_END).join('\n');
const block2 = lines.slice(B2_START-1, B2_END).join('\n');

const MOD = `/**
 * media-upload-form.js — Upload Work modal: file/category selection, validation, Firestore
 * upload via media-cloud, points awarding, and modal wiring. Extracted verbatim from
 * media-upload.js (M4).
 */
import { getDocs, query, collection, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  mediaState,
  MEDIA_UPLOAD_POINTS_DAILY_CAP,
  MEDIA_MAX_IMAGES_PER_UPLOAD,
} from "./media-state.js?v=${STATE_TOKEN}";
import { loadUserProfile } from "./media-profile.js?v=${PROFILE_TOKEN}";
import {
  createWorkWithMedia,
  createWorkWithMediaBestEffort,
  addMediaToExistingWork,
  addMediaToExistingWorkBestEffort,
  getContentWork,
} from "./media-cloud.js?v=20260623_mediafix";

// Injected from media-upload.js (setupModalBackdrops closes sibling modals).
let closeWorkDetails = () => {};
let closeMarkPostedModal = () => {};
export function initMediaUploadForm(deps) {
  if (deps && typeof deps.closeWorkDetails === "function") closeWorkDetails = deps.closeWorkDetails;
  if (deps && typeof deps.closeMarkPostedModal === "function") closeMarkPostedModal = deps.closeMarkPostedModal;
}

${block1}
${block2}

export {
  populateWorksDropdown,
  populateMediaCategoriesDropdown,
  openUploadModal,
  closeUploadModal,
  setupUploadModalListeners,
  setupModalBackdrops,
  toggleFileInputs,
  toggleNewFieldsAndExisting,
};
`;
writeFileSync(OUT, MOD);

const drop = new Set();
for(let i=B1_START;i<=B1_END;i++) drop.add(i);
for(let i=B2_START;i<=B2_END;i++) drop.add(i);
let main = lines.filter((_,i)=> !drop.has(i+1)).join('\n');

const NATIVE_IMP_END = '} from "./media-native-share.js?v=20260701_media_native_split";';
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
if(!main.includes(NATIVE_IMP_END)){ console.error('native import missing'); process.exit(1); }
main = main.replace(NATIVE_IMP_END, NATIVE_IMP_END + '\n' + FORM_IMP);

// trim media-state import
main = main.replace(
  `import {
  mediaState,
  MEDIA_UPLOAD_POINTS_DAILY_CAP,
  MEDIA_MAX_IMAGES_PER_UPLOAD,
  MEDIA_DROPDOWN_FLOAT_MQ,
  MY_UPLOADS_FILTERS,
  TO_HANDLE_FILTERS,
  SORT_OPTIONS,
} from "./media-state.js?v=${STATE_TOKEN}";`,
  `import {
  mediaState,
  MEDIA_DROPDOWN_FLOAT_MQ,
  MY_UPLOADS_FILTERS,
  TO_HANDLE_FILTERS,
  SORT_OPTIONS,
} from "./media-state.js?v=${STATE_TOKEN}";`
);

// trim media-cloud import
main = main.replace(
  `import {
  createWorkWithMedia,
  createWorkWithMediaBestEffort,
  addMediaToExistingWork,
  addMediaToExistingWorkBestEffort,
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
} from "./media-cloud.js?v=20260623_mediafix";`
);

// remove firestore import if orphaned (ignore comment-only matches like "work doc")
const codeWithoutFbImport = main.replace(/^import \{[^}]+\} from "https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-firestore\.js";\n/m, '');
const fbUsed = /\b(getDocs|getDoc|setDoc|query|collection|where)\s*\(/.test(codeWithoutFbImport) || /\bdoc\s*\(/.test(codeWithoutFbImport);
if(!fbUsed){
  main = main.replace(/^import \{[^}]+\} from "https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-firestore\.js";\n/m, '');
}

const INIT = 'function initMediaModule() {';
if(!main.includes(INIT)){ console.error('initMediaModule missing'); process.exit(1); }
main = main.replace(INIT, `${INIT}\n  initMediaUploadForm({ closeWorkDetails, closeMarkPostedModal });`);

writeFileSync(SRC, main);
console.log('media-upload-form.js lines:', MOD.split('\n').length);
console.log('main:', lines.length, '->', main.split('\n').length);
console.log('sha(main):', sha(main));
