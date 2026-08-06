import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const backup = readFileSync('refactor-backups/media-upload/media-upload.pre-native.js','utf8');
const backupLines = backup.split('\n');
const main = readFileSync('public/media-upload.js','utf8');
const mod = readFileSync('public/media-native-share.js','utf8');
const TOKEN='20260701_media_native_split';
const PROFILE_TOKEN='20260701_media_profile_split';

const START=1165,END=1455;
const origBlock = backupLines.slice(START-1,END).join('\n');
const modLines = mod.split('\n');
const bStart = modLines.findIndex(l=>l==='/**' && /Capacitor helpers/.test(modLines[modLines.indexOf(l)+1]));
// robust: find the '/**' that precedes 'Capacitor helpers'
let cStart=-1; for(let i=0;i<modLines.length;i++){ if(modLines[i]==='/**' && /Capacitor helpers/.test(modLines[i+1])){ cStart=i; break; } }
const expStart = modLines.findIndex(l=>/^export \{$/.test(l));
const modBlock = modLines.slice(cStart, expStart-1).join('\n');
console.log('[byte] module block == original 1165..1455:', sha(modBlock)===sha(origBlock), '| orig', origBlock.length, 'mod', modBlock.length);

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
let t = main.replace('\n'+NATIVE_IMP,'');
t = t.replace('\n  initMediaNativeShare({ showMediaMessage });','');
const tLines = t.split('\n');
const recon = [...tLines.slice(0,START-1), ...backupLines.slice(START-1,END), ...tLines.slice(START-1)].join('\n');
console.log('[rev] reinsert == pre-native backup:', sha(recon)===sha(backup));
console.log('    recon', sha(recon), '\n    orig ', sha(backup));

// profile imports still used in main?
for(const n of ['loadUserProfile','canHandleMediaWork','isAdmin']){
  const c=(main.match(new RegExp('\\b'+n+'\\b','g'))||[]).length;
  console.log(`   main uses ${n}: ${c-1} refs (excl import)`);
}
