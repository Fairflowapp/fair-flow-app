import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'public/staff-documents.js';
const OUT = 'public/staff-documents-state.js';
const TOKEN = '20260701_staffdoc_state_split';
const sha = s => createHash('sha1').update(s).digest('hex');

const orig = readFileSync(SRC, 'utf8');
const lines = orig.split('\n');

// state declaration block (1-indexed inclusive) + the two now-unused imports
const BLOCK_START = 153, BLOCK_END = 190;
const IMPORT_LINES = [7, 32];

// sanity
if (!/^let _unsub = null;/.test(lines[BLOCK_START-1])) { console.error('153 mismatch:', lines[BLOCK_START-1]); process.exit(1); }
if (lines[BLOCK_END-1].trim() !== '}') { console.error('190 mismatch:', JSON.stringify(lines[BLOCK_END-1])); process.exit(1); }
if (!/getApp/.test(lines[6])) { console.error('line7 not getApp import'); process.exit(1); }
if (!/getFunctions, httpsCallable/.test(lines[31])) { console.error('line32 not functions import'); process.exit(1); }

// mutable state vars to rename (12)
const VARS = ['_unsub','_mountedKey','_mountCtx','_ffExpiryNotifyDedupe','_ffExpiryNotifyInFlight','_ffBoundContainer','_onDocActionClick','_lastDocList','_staffDocumentsFilter','_staffDocumentsSearchQuery','_staffDocsViewerCanEditMeta','_onStaffDocSearchInput'];

// ---- build state module (hand-authored shape) ----
const MOD = `/**
 * staff-documents-state.js — shared mutable controller state for the Staff Documents view.
 * Split out of staff-documents.js so the controller can be broken into concern modules
 * (ui / expiry-chat / render / main) that all read & write one source of truth. Also holds
 * the filter-id set and the memoized media-download callable.
 */
import { getApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

export const sdState = {
  _unsub: null,
  _mountedKey: "",
  _mountCtx: { salonId: "", staffId: "" },
  /** After a successful send, ignore duplicate sends for the same doc briefly (double-click / dual handlers). */
  _ffExpiryNotifyDedupe: { key: "", at: 0 },
  _ffExpiryNotifyInFlight: false,
  _ffBoundContainer: null,
  _onDocActionClick: null,
  /** @type {Array<Record<string, unknown>> | null} */
  _lastDocList: null,
  /** Staff Member > Documents filter chip (Phase 9). Default "active" (less confusing than "all"). */
  _staffDocumentsFilter: "active",
  /** Phase 10: search query (raw); empty = no search filter. */
  _staffDocumentsSearchQuery: "",
  /** True when signed-in user may edit document type / expiration (managers etc.). */
  _staffDocsViewerCanEditMeta: false,
  _onStaffDocSearchInput: null,
};

export const STAFF_DOC_FILTER_IDS = new Set([
  "all",
  "expired",
  "expiring_soon",
  "active",
  "archived",
]);

const _functions = getFunctions(getApp(), "us-central1");
let _getMediaDownloadUrlCallable = null;
export function getMediaDownloadUrlCallable() {
  if (!_getMediaDownloadUrlCallable) {
    _getMediaDownloadUrlCallable = httpsCallable(_functions, "getMediaDownloadUrl");
  }
  return _getMediaDownloadUrlCallable;
}
`;

// ---- reduce main: drop block + unused imports ----
const dropSet = new Set([...IMPORT_LINES]);
for (let i = BLOCK_START; i <= BLOCK_END; i++) dropSet.add(i);
let reduced = lines.filter((_, i) => !dropSet.has(i+1)).join('\n');

// ---- mechanical rename _var -> sdState._var (whole word) ----
for (const v of VARS) {
  reduced = reduced.replace(new RegExp(`\\b${v}\\b`, 'g'), `sdState.${v}`);
}

// ---- insert state import after app.js import ----
const APP_ANCHOR = 'import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";';
const STATE_IMPORT = `import { sdState, STAFF_DOC_FILTER_IDS, getMediaDownloadUrlCallable } from "./staff-documents-state.js?v=${TOKEN}";`;
if (!reduced.includes(APP_ANCHOR)) { console.error('app anchor missing'); process.exit(1); }
reduced = reduced.replace(APP_ANCHOR, APP_ANCHOR + '\n' + STATE_IMPORT);

writeFileSync(OUT, MOD);
writeFileSync(SRC, reduced);

// report rename counts
let total = 0;
for (const v of VARS){ const m = (reduced.match(new RegExp(`sdState\\.${v}\\b`,'g'))||[]).length; total += m; }
console.log('state module lines:', MOD.split('\n').length);
console.log('main:', lines.length, '->', reduced.split('\n').length);
console.log('total sdState._ references in main:', total);
console.log('sha(new main):', sha(reduced));
