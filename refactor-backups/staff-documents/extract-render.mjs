import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'public/staff-documents.js';
const OUT = 'public/staff-documents-render.js';
const TOKEN = '20260701_staffdoc_render_split';
const sha = s => createHash('sha1').update(s).digest('hex');

const orig = readFileSync(SRC, 'utf8');
const lines = orig.split('\n');

const SLAB_START = 77, SLAB_END = 465;
const head = lines.slice(0, SLAB_START - 1);          // 1..76
const slab = lines.slice(SLAB_START - 1, SLAB_END);   // 77..465
const tail = lines.slice(SLAB_END);                   // 466..end

// sanity
if (slab[0] !== 'function renderActiveSectionWithSubheaders(sortedActive) {') { console.error('slab[0]:', slab[0]); process.exit(1); }
if (slab[slab.length-1].trim() !== '}') { console.error('slab end:', JSON.stringify(slab[slab.length-1])); process.exit(1); }
if (!/Unsubscribe from Firestore/.test(tail[2])) { console.error('tail head:', JSON.stringify(tail.slice(0,4))); process.exit(1); }

const slabText = slab.join('\n');

// ---------- render module ----------
const MOD = `/**
 * staff-documents-render.js — Staff Documents rendering + live subscription split out of
 * staff-documents.js: filter/search toolbar, list + card renderers, grouping/sections,
 * the Firestore onSnapshot subscription, and DOM re-render into the mounted container.
 * Reads/writes the shared sdState; consumed by the lifecycle orchestrator in staff-documents.js.
 */
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { sdState, STAFF_DOC_FILTER_IDS } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";
import {
  trimStr,
  ffComputeLifecycleFromExpiration,
  escapeHtml,
  escapeAttr,
  toDateMaybe,
  formatWhen,
  formatDay,
  formatDocumentTitle,
  formatApprovalLabel,
  formatLifecycleLabel,
  staffDocsEmptyMessageHtml,
  staffDocsShellStyle,
  expiryBadgeState,
  badgeHtml,
  groupDocument,
  tierForActiveSectionDoc,
  sortActiveDocuments,
  sortArchivedDocuments,
  renderActiveSubheader,
  filterDocumentsByChip,
  normalizeStaffDocSearch,
  docMatchesSearch,
  sortDocumentsForFilterChip,
  renderFilterChipsHtml,
} from "./staff-documents-format.js?v=20260701_staffdoc_format_split";
import { refreshStaffDocViewerEditMeta } from "./staff-documents-ui.js?v=20260701_staffdoc_ui_split";
import { ffRunExpiryChatNotify } from "./staff-documents-expiry-chat.js?v=20260701_staffdoc_expiry_split";

${slabText}

export { ensureStaffDocSearchListeners, renderListIntoContainer, ensureSubscription };
`;

// ---------- reduced main ----------
let headText = head.join('\n');

// 1) firestore import: remove entirely
const FS_OLD = `import {
  collection,
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
`;
// 2) state import: drop STAFF_DOC_FILTER_IDS
const STATE_OLD = `import { sdState, STAFF_DOC_FILTER_IDS } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";`;
const STATE_NEW = `import { sdState } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";`;
// 3) format import: reduce to trimStr only (whole block)
const FMT_OLD = `import {
  trimStr,
  ffComputeLifecycleFromExpiration,
  escapeHtml,
  escapeAttr,
  toDateMaybe,
  formatWhen,
  formatDay,
  formatDocumentTitle,
  formatApprovalLabel,
  formatLifecycleLabel,
  staffDocsEmptyMessageHtml,
  staffDocsShellStyle,
  expiryBadgeState,
  badgeHtml,
  groupDocument,
  tierForActiveSectionDoc,
  sortActiveDocuments,
  sortArchivedDocuments,
  renderActiveSubheader,
  filterDocumentsByChip,
  normalizeStaffDocSearch,
  docMatchesSearch,
  sortDocumentsForFilterChip,
  renderFilterChipsHtml,
} from "./staff-documents-format.js?v=20260701_staffdoc_format_split";`;
const FMT_NEW = `import { trimStr } from "./staff-documents-format.js?v=20260701_staffdoc_format_split";`;

function must(t,n,label){ if(!t.includes(n)){ console.error('MISSING '+(label||'')+':\n'+n.split('\n')[0]); process.exit(1);} return t; }
must(headText, FS_OLD, 'firestore'); headText = headText.replace(FS_OLD, '');
must(headText, STATE_OLD, 'state'); headText = headText.replace(STATE_OLD, STATE_NEW);
must(headText, FMT_OLD, 'format'); headText = headText.replace(FMT_OLD, FMT_NEW);
// 4) ui import: drop refreshStaffDocViewerEditMeta
must(headText, '  refreshStaffDocViewerEditMeta,\n', 'ui'); headText = headText.replace('  refreshStaffDocViewerEditMeta,\n', '');

// 5) add render import right after the expiry re-export line
const EXPIRY_REEXPORT = `export { ffSendExpiryChatReminderForStaffDocContext };`;
const INSERT = EXPIRY_REEXPORT + `
import { ensureStaffDocSearchListeners, renderListIntoContainer, ensureSubscription } from "./staff-documents-render.js?v=${TOKEN}";`;
must(headText, EXPIRY_REEXPORT, 'expiry-reexport'); headText = headText.replace(EXPIRY_REEXPORT, INSERT);

const newMain = headText + '\n' + tail.join('\n');

writeFileSync(OUT, MOD);
writeFileSync(SRC, newMain);

console.log('render module lines:', MOD.split('\n').length, ' slab:', slab.length);
console.log('main:', lines.length, '->', newMain.split('\n').length);
console.log('sha(render):', sha(MOD));
console.log('sha(main):', sha(newMain));
