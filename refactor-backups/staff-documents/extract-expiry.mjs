import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'public/staff-documents.js';
const OUT = 'public/staff-documents-expiry-chat.js';
const TOKEN = '20260701_staffdoc_expiry_split';
const sha = s => createHash('sha1').update(s).digest('hex');

const orig = readFileSync(SRC, 'utf8');
const lines = orig.split('\n');

const SLAB_START = 82, SLAB_END = 324;
const head = lines.slice(0, SLAB_START - 1);          // 1..81
const slab = lines.slice(SLAB_START - 1, SLAB_END);   // 82..324
const tail = lines.slice(SLAB_END);                   // 325..end

// sanity
if (!/Align with media-upload/.test(slab[0])) { console.error('slab[0]:', slab[0]); process.exit(1); }
if (!/^function ffUserCanSendExpiryChatReminder/.test(slab[1])) { console.error('slab[1]:', slab[1]); process.exit(1); }
if (slab[slab.length-1].trim() !== '}') { console.error('slab end:', JSON.stringify(slab[slab.length-1])); process.exit(1); }
if (tail[0] !== '' || tail[3] !== 'function renderActiveSectionWithSubheaders(sortedActive) {') { console.error('tail head:', JSON.stringify(tail.slice(0,4))); process.exit(1); }

const slabText = slab.join('\n');

// ---------- expiry module ----------
const MOD = `/**
 * staff-documents-expiry-chat.js — "document expiring soon" chat-reminder flow split out
 * of staff-documents.js: role gate, recipient-uid resolution, the 1:1 reminder sender,
 * the guarded notify entrypoint, and the explicit-context variant used by the Inbox alert.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  serverTimestamp,
  increment,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import { sdState } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";
import { trimStr, toDateMaybe, calendarDaysUntilExpiry } from "./staff-documents-format.js?v=20260701_staffdoc_format_split";
import { ffToast } from "./staff-documents-ui.js?v=20260701_staffdoc_ui_split";

${slabText}

export { ffRunExpiryChatNotify };
`;

// ---------- reduced main ----------
let headText = head.join('\n');

const FS_OLD = `import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  onSnapshot,
  serverTimestamp,
  increment,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";`;
const FS_NEW = `import {
  collection,
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";`;

function must(t,n){ if(!t.includes(n)){ console.error('MISSING:\n'+n.split('\n')[0]); process.exit(1);} return t; }
must(headText, FS_OLD); headText = headText.replace(FS_OLD, FS_NEW);
must(headText, '  calendarDaysUntilExpiry,\n'); headText = headText.replace('  calendarDaysUntilExpiry,\n', '');

// insert expiry import + re-export right after the ui re-export line
const UI_REEXPORT = `export { ffUpdateStaffDocumentMetadata } from "./staff-documents-ui.js?v=20260701_staffdoc_ui_split";`;
const INSERT = UI_REEXPORT + `
import { ffRunExpiryChatNotify, ffSendExpiryChatReminderForStaffDocContext } from "./staff-documents-expiry-chat.js?v=${TOKEN}";
export { ffSendExpiryChatReminderForStaffDocContext };`;
must(headText, UI_REEXPORT); headText = headText.replace(UI_REEXPORT, INSERT);

const newMain = headText + '\n' + tail.join('\n');

writeFileSync(OUT, MOD);
writeFileSync(SRC, newMain);

console.log('expiry module lines:', MOD.split('\n').length, ' slab:', slab.length);
console.log('main:', lines.length, '->', newMain.split('\n').length);
console.log('sha(expiry):', sha(MOD));
console.log('sha(main):', sha(newMain));
