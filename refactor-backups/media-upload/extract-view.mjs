import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const SRC = 'public/media-upload.js';
const OUT = 'public/media-view.js';
const TOKEN = '20260701_media_view_split';
const STATE_TOKEN = '20260701_media_state_split';
const PROFILE_TOKEN = '20260701_media_profile_split';
const FORM_TOKEN = '20260701_media_upload_form_split';
const WD_TOKEN = '20260701_media_work_details_split';

copyFileSync(SRC, 'refactor-backups/media-upload/media-upload.pre-view.js');
const orig = readFileSync(SRC,'utf8');
const lines = orig.split('\n');

const B_START=47, B_END=568;

if(lines[B_START-1] !== '// =====================' || lines[B_START] !== '// Tab switching'){ console.error('bad B start'); process.exit(1); }
if(!/^function renderMediaList\(\)/.test(lines[489])){ console.error('bad renderMediaList', lines[489]); process.exit(1); }
if(lines[B_END-1] !== '}'){ console.error('bad B end', lines[B_END-1]); process.exit(1); }

const blockText = lines.slice(B_START-1, B_END).join('\n');

const MOD = `/**
 * media-view.js — Media list UI: tab switching, filters/sort dropdowns, work grid
 * rendering, and shared toast/confirm helpers. Extracted verbatim from media-upload.js (M3).
 */
import { auth } from "/app.js?v=20260610_force_lp_ios";
import {
  mediaState,
  MEDIA_DROPDOWN_FLOAT_MQ,
  MY_UPLOADS_FILTERS,
  TO_HANDLE_FILTERS,
  SORT_OPTIONS,
} from "./media-state.js?v=${STATE_TOKEN}";
import { canHandleMediaWork } from "./media-profile.js?v=${PROFILE_TOKEN}";
import { resolveWorkCardPreviewUrl } from "./media-cloud.js?v=20260623_mediafix";
import { openUploadModal } from "./media-upload-form.js?v=${FORM_TOKEN}";
import { openWorkDetails } from "./media-work-details.js?v=${WD_TOKEN}";

${blockText}

export {
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
};
`;
writeFileSync(OUT, MOD);

const drop = new Set();
for(let i=B_START;i<=B_END;i++) drop.add(i);
let main = lines.filter((_,i)=> !drop.has(i+1)).join('\n');

const WD_IMP_END = '} from "./media-work-details.js?v=20260701_media_work_details_split";';
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
if(!main.includes(WD_IMP_END)){ console.error('work-details import missing'); process.exit(1); }
main = main.replace(WD_IMP_END, WD_IMP_END + '\n' + VIEW_IMP);

main = main.replace(
  `import {
  mediaState,
  MEDIA_DROPDOWN_FLOAT_MQ,
  MY_UPLOADS_FILTERS,
  TO_HANDLE_FILTERS,
  SORT_OPTIONS,
} from "./media-state.js?v=${STATE_TOKEN}";`,
  `import { mediaState } from "./media-state.js?v=${STATE_TOKEN}";`
);

main = main.replace(
  `import {
  subscribeContentWorks,
  resolveWorkCardPreviewUrl,
  updateContentWork,
  getMediaCategories,
  subscribeMediaCategories,
  createMediaCategory,
  updateMediaCategory,
  deleteMediaCategory,
} from "./media-cloud.js?v=20260623_mediafix";`,
  `import {
  subscribeContentWorks,
  updateContentWork,
  getMediaCategories,
  subscribeMediaCategories,
  createMediaCategory,
  updateMediaCategory,
  deleteMediaCategory,
} from "./media-cloud.js?v=20260623_mediafix";`
);

// collapse extra blank lines after imports
main = main.replace(
  '} from "./media-view.js?v=' + TOKEN + '";\n\n\n',
  '} from "./media-view.js?v=' + TOKEN + '";\n\n'
);

writeFileSync(SRC, main);
console.log('media-view.js lines:', MOD.split('\n').length);
console.log('main:', lines.length, '->', main.split('\n').length);
console.log('sha(main):', sha(main));
