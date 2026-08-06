import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const backup = readFileSync('refactor-backups/media-upload/media-upload.pre-state.js','utf8');
const backupLines = backup.split('\n');
const main = readFileSync('public/media-upload.js','utf8');
const TOKEN = '20260701_media_state_split';
const VARS = ['currentUserProfile','userWorks','allWorks','unsubMyWorks','unsubAllWorks','currentMediaTab','selectedWorkId','currentMediaFilter','currentMediaSort','currentMediaEmployeeFilter','currentMediaCategoryFilter','mediaCategories','unsubMediaCategories','mediaMyWorksHydrated','mediaAllWorksHydrated','_mediaWorkListSubKey'];

let text = main;
// 1) remove state import block
const IMP = `import {
  mediaState,
  MEDIA_UPLOAD_POINTS_DAILY_CAP,
  MEDIA_MAX_IMAGES_PER_UPLOAD,
  MEDIA_DROPDOWN_FLOAT_MQ,
  MY_UPLOADS_FILTERS,
  TO_HANDLE_FILTERS,
  SORT_OPTIONS,
} from "./media-state.js?v=${TOKEN}";`;
if(!text.includes(IMP)){ console.log('[!] state import block not found'); }
text = text.replace('\n' + IMP, '');

// 2) reverse rename mediaState.X -> X
for(const v of VARS){ text = text.replace(new RegExp(`\\bmediaState\\.${v}\\b`,'g'), v); }
const stray = (text.match(/\bmediaState\b/g)||[]).length;
console.log('[check] stray mediaState refs after reverse:', stray);

// 3) reinsert removed declaration blocks at original positions
const drop = new Set();
for(let i=34;i<=53;i++) drop.add(i);
for(let i=310;i<=332;i++) drop.add(i);
drop.add(413);
const reducedLines = text.split('\n');
const recon = []; let ri=0;
for(let i=1;i<=backupLines.length;i++){
  if(drop.has(i)) recon.push(backupLines[i-1]);
  else { recon.push(reducedLines[ri]); ri++; }
}
const reconStr = recon.join('\n');
console.log('[1] semantic-identity (reverse-transform == backup):', sha(reconStr)===sha(backup));
console.log('    sha recon:', sha(reconStr));
console.log('    sha orig :', sha(backup));
if(ri!==reducedLines.length) console.log('    WARN leftover reduced lines:', reducedLines.length-ri);
