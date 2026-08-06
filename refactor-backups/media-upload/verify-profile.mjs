import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = s => createHash('sha1').update(s).digest('hex');

const backup = readFileSync('refactor-backups/media-upload/media-upload.pre-profile.js','utf8');
const backupLines = backup.split('\n');
const main = readFileSync('public/media-upload.js','utf8');
const mod = readFileSync('public/media-profile.js','utf8');
const TOKEN='20260701_media_profile_split';

// --- byte-identity: block in module == original lines 44..266 ---
const START=44,END=266;
const origBlock = backupLines.slice(START-1,END).join('\n');
const modLines = mod.split('\n');
// module block sits between the import (line 9 blank line 8?) and the export line
const expIdx = modLines.findIndex(l=>/^export \{ loadUserProfile/.test(l));
// module structure: header(1-6) import(7-9) blank(10?) ... find block start: after the 3rd import + blank
// simpler: locate first block line '/** Same defaults'
const bStart = modLines.findIndex(l=>/^\/\*\* Same defaults/.test(l));
const modBlock = modLines.slice(bStart, expIdx-1).join('\n'); // exclude trailing blank before export
console.log('[byte] module block == original 44..266:', sha(modBlock)===sha(origBlock), '| origLen', origBlock.length, 'modLen', modBlock.length);

// --- reversibility: from main remove import + reinsert block == backup ---
const IMP = `import { loadUserProfile, canHandleMediaWork, isAdmin } from "./media-profile.js?v=${TOKEN}";`;
let t = main.replace('\n'+IMP,'');
const tLines = t.split('\n');
// reinsert origBlock at index START-1
const recon = [...tLines.slice(0,START-1), ...backupLines.slice(START-1,END), ...tLines.slice(START-1)].join('\n');
console.log('[rev] reinsert == pre-profile backup:', sha(recon)===sha(backup));
console.log('    recon', sha(recon), '\n    orig ', sha(backup));

// --- orphaned firestore imports in main? ---
const fb=['getDoc','getDocs','doc','collection','query','where','setDoc'];
for(const n of fb){
  const re=new RegExp('\\b'+n+'\\b','g');
  const c=(main.match(re)||[]).length; // includes import line
  console.log(`   main uses ${n}: ${c-1} refs (excl import)`);
}
