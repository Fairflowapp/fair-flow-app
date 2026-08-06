import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const SRC = 'public/media-upload.js';
const OUT = 'public/media-native-share.js';
const TOKEN = '20260701_media_native_split';
const PROFILE_TOKEN = '20260701_media_profile_split';

copyFileSync(SRC, 'refactor-backups/media-upload/media-upload.pre-native.js');
const orig = readFileSync(SRC,'utf8');
const lines = orig.split('\n');

const START=1165, END=1455;
if(lines[START-1] !== '/**' || !/Capacitor helpers/.test(lines[START])){ console.error('bad START', JSON.stringify(lines[START-1]), JSON.stringify(lines[START])); process.exit(1); }
if(lines[END-1] !== '}' || lines[END] !== '' || !/openWorkDetails/.test(lines[END+1])){ console.error('bad END', JSON.stringify(lines[END-1]), JSON.stringify(lines[END+1])); process.exit(1); }
if(!/^function ffGetCapacitor\(\)/.test(lines[1171])){ console.error('ffGetCapacitor not at 1172', JSON.stringify(lines[1171])); process.exit(1); }
if(!/^async function triggerMediaFileDownload/.test(lines[1379])){ console.error('trigger not at 1380', JSON.stringify(lines[1379])); process.exit(1); }
const blockText = lines.slice(START-1, END).join('\n');

const MOD = `/**
 * media-native-share.js — Capacitor (iOS/Android) native bridge plus media share / download
 * helpers for the Media module: native share sheets, saving blobs to the device, the HTTP
 * proxy fetch fallback, and the browser download fallback. Extracted verbatim from
 * media-upload.js (M5).
 */
import { auth } from "/app.js?v=20260610_force_lp_ios";
import { canHandleMediaWork } from "./media-profile.js?v=${PROFILE_TOKEN}";

// Injected from media-upload.js to avoid an import cycle: showMediaMessage lives in the main UI slab.
let showMediaMessage = () => {};
export function initMediaNativeShare(deps) {
  if (deps && typeof deps.showMediaMessage === "function") showMediaMessage = deps.showMediaMessage;
}

${blockText}

export {
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
};
`;
writeFileSync(OUT, MOD);

// remove block + insert import + inject init call
const keep = lines.filter((_,i)=> !(i>=START-1 && i<=END-1));
let main = keep.join('\n');

const PROFILE_IMP = `import { loadUserProfile, canHandleMediaWork, isAdmin } from "./media-profile.js?v=${PROFILE_TOKEN}";`;
const NATIVE_IMP = `import {
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
} from "./media-native-share.js?v=${TOKEN}";`;
if(!main.includes(PROFILE_IMP)){ console.error('profile import missing'); process.exit(1); }
main = main.replace(PROFILE_IMP, PROFILE_IMP + '\n' + NATIVE_IMP);

const INIT_ANCHOR = `export function initMediaUpload() {\n  onAuthStateChanged(auth, async (user) => {`;
if(!main.includes(INIT_ANCHOR)){ console.error('initMediaUpload anchor missing'); process.exit(1); }
main = main.replace(INIT_ANCHOR, `export function initMediaUpload() {\n  initMediaNativeShare({ showMediaMessage });\n  onAuthStateChanged(auth, async (user) => {`);

writeFileSync(SRC, main);
console.log('media-native-share.js lines:', MOD.split('\n').length);
console.log('main:', lines.length, '->', main.split('\n').length);
console.log('sha(main):', sha(main));
