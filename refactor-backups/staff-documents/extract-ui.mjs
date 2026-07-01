import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'public/staff-documents.js';
const OUT = 'public/staff-documents-ui.js';
const TOKEN = '20260701_staffdoc_ui_split';
const sha = s => createHash('sha1').update(s).digest('hex');

const orig = readFileSync(SRC, 'utf8');
const lines = orig.split('\n');

// contiguous ui slab: lines 85..845 (1-indexed inclusive)
const SLAB_START = 85, SLAB_END = 845;
const head = lines.slice(0, SLAB_START - 1);          // 1..84
const slab = lines.slice(SLAB_START - 1, SLAB_END);   // 85..845 (761 lines)
const tail = lines.slice(SLAB_END);                   // 846..end

// sanity
if (slab[0] !== '/**') { console.error('slab[0] mismatch:', JSON.stringify(slab[0])); process.exit(1); }
if (!/^export async function ffUpdateStaffDocumentMetadata\(/.test(slab[3])) { console.error('slab[3] mismatch:', slab[3]); process.exit(1); }
if (slab[slab.length-1].trim() !== '}') { console.error('slab end mismatch:', JSON.stringify(slab[slab.length-1])); process.exit(1); }
if (tail[0] !== '' || !/Align with media-upload/.test(tail[1])) { console.error('tail head mismatch:', JSON.stringify(tail.slice(0,2))); process.exit(1); }

const slabText = slab.join('\n');

// ---------- build ui.js ----------
const UI = `/**
 * staff-documents-ui.js — Staff Documents UI layer split out of staff-documents.js:
 * toasts, confirm dialog, edit-metadata modal, file viewers (incl. iOS), the replace-file
 * modal + writer, and the delegated document action-click handler. Reads/writes the shared
 * sdState; render + expiry-chat callbacks are injected (named identically to the originals)
 * so the moved code is byte-verbatim and the module graph stays acyclic.
 */
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  deleteField,
  increment,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
import { sdState, STAFF_DOC_FILTER_IDS, getMediaDownloadUrlCallable } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";
import {
  trimStr,
  parseExpirationForStaffDoc,
  ffComputeLifecycleFromExpiration,
  escapeHtml,
  escapeAttr,
  ffExpirationTimestampToYmdInput,
  ffStaffDocumentTypeSelectOptionsHtml,
} from "./staff-documents-format.js?v=20260701_staffdoc_format_split";

// Injected from staff-documents.js (render + expiry-chat still live there until C3/C4).
// Kept under the original names so the moved code below stays byte-verbatim.
let renderListIntoContainer = () => {};
let ffRunExpiryChatNotify = async () => false;
export function initStaffDocumentsUi(deps) {
  if (deps && typeof deps.renderListIntoContainer === "function") renderListIntoContainer = deps.renderListIntoContainer;
  if (deps && typeof deps.ffRunExpiryChatNotify === "function") ffRunExpiryChatNotify = deps.ffRunExpiryChatNotify;
}

${slabText}

export {
  ffToast,
  ffStaffDocumentsConfirm,
  refreshStaffDocViewerEditMeta,
  ffOpenStaffDocumentEditMetadataModal,
  closePopupIfOpen,
  openBlankTabForLaterNavigation,
  assignUrlToTabOrOpenFresh,
  ffStaffDocsIsIosMobile,
  ffStaffDocsIsImageDocument,
  ffOpenStaffDocumentIosViewer,
  openStaffDocumentResolvedUrl,
  ffOpenReplaceDocumentModal,
  ffReplaceStaffDocumentVersion,
  ffStaffDocClickTargetEl,
  ffHandleStaffDocumentActionClick,
};
`;

// ---------- build reduced main ----------
let headText = head.join('\n');

// 1) firestore import: drop updateDoc, deleteDoc, Timestamp, deleteField
const FS_OLD = `import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  deleteField,
  increment,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";`;
const FS_NEW = `import {
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

// 2) storage import: remove entirely
const STORAGE_OLD = `import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
`;

// 3) app import: drop storage
const APP_OLD = `import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";`;
const APP_NEW = `import { db, auth } from "/app.js?v=20260610_force_lp_ios";`;

// 4) state import: drop getMediaDownloadUrlCallable
const STATE_OLD = `import { sdState, STAFF_DOC_FILTER_IDS, getMediaDownloadUrlCallable } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";`;
const STATE_NEW = `import { sdState, STAFF_DOC_FILTER_IDS } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";`;

function must(text, needle){ if(!text.includes(needle)){ console.error('MISSING in head:\n'+needle.split('\n')[0]); process.exit(1);} return text; }
must(headText, FS_OLD); headText = headText.replace(FS_OLD, FS_NEW);
must(headText, STORAGE_OLD); headText = headText.replace(STORAGE_OLD, '');
must(headText, APP_OLD); headText = headText.replace(APP_OLD, APP_NEW);
must(headText, STATE_OLD); headText = headText.replace(STATE_OLD, STATE_NEW);

// 5) format import: drop 4 names (exact lines)
for (const drop of ['  stripUndefined,\n', '  ffStaffDocumentTypeSelectOptionsHtml,\n', '  ffExpirationTimestampToYmdInput,\n', '  parseExpirationForStaffDoc,\n']) {
  must(headText, drop); headText = headText.replace(drop, '');
}

// 6) append ui import + re-export + init call (in head region, tail stays byte-identical)
const WIRE = `import {
  ffToast,
  refreshStaffDocViewerEditMeta,
  ffHandleStaffDocumentActionClick,
  initStaffDocumentsUi,
} from "./staff-documents-ui.js?v=${TOKEN}";
export { ffUpdateStaffDocumentMetadata } from "./staff-documents-ui.js?v=${TOKEN}";

initStaffDocumentsUi({ renderListIntoContainer, ffRunExpiryChatNotify });
`;

const newMain = headText + '\n' + WIRE + '\n' + tail.join('\n');

writeFileSync(OUT, UI);
writeFileSync(SRC, newMain);

console.log('ui.js lines:', UI.split('\n').length, ' slab lines:', slab.length);
console.log('main:', lines.length, '->', newMain.split('\n').length);
console.log('sha(ui):', sha(UI));
console.log('sha(main):', sha(newMain));
