import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const SRC = 'public/media-upload.js';
const OUT = 'public/media-profile.js';
const TOKEN = '20260701_media_profile_split';
const STATE_TOKEN = '20260701_media_state_split';

copyFileSync(SRC, 'refactor-backups/media-upload/media-upload.pre-profile.js');
const orig = readFileSync(SRC,'utf8');
const lines = orig.split('\n');

// M2 block: lines 44..266 (1-based) => idx 43..265
const START=44, END=266;
if(!/^\/\*\* Same defaults/.test(lines[START-1])){ console.error('bad START', lines[START-1]); process.exit(1); }
if(lines[END-1] !== '}'){ console.error('bad END line', JSON.stringify(lines[END-1])); process.exit(1); }
if(lines[END] !== '' || !/Tab switching/.test(lines[END+2])){ console.error('bad boundary after END', JSON.stringify(lines[END]), JSON.stringify(lines[END+2])); process.exit(1); }
if(!/^function isAdmin\(\)/.test(lines[262])){ console.error('isAdmin not at 263', JSON.stringify(lines[262])); process.exit(1); }
const blockText = lines.slice(START-1, END).join('\n');

const MOD = `/**
 * media-profile.js — user profile + media-handling permission checks for the Media module.
 * Resolves the signed-in user's salon staff doc / role, hydrates mediaState.currentUserProfile,
 * and exposes the permission helpers used across the Media UI. Extracted verbatim from
 * media-upload.js (M2).
 */
import { getDoc, getDocs, doc, collection, setDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import { mediaState } from "./media-state.js?v=${STATE_TOKEN}";

${blockText}

export { loadUserProfile, canHandleMediaWork, isAdmin };
`;
writeFileSync(OUT, MOD);

// remove block from main + insert import after media-cloud import block
const CLOUD_END = '} from "./media-cloud.js?v=20260623_mediafix";';
const IMP = `import { loadUserProfile, canHandleMediaWork, isAdmin } from "./media-profile.js?v=${TOKEN}";`;
const keep = lines.filter((_,i)=> !(i>=START-1 && i<=END-1));
let main = keep.join('\n');
if(!main.includes(CLOUD_END)){ console.error('cloud import not found'); process.exit(1); }
main = main.replace(CLOUD_END, CLOUD_END + '\n' + IMP);
writeFileSync(SRC, main);

console.log('media-profile.js lines:', MOD.split('\n').length);
console.log('main:', lines.length, '->', main.split('\n').length);
console.log('sha(main):', sha(main));
