import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const SRC = 'public/media-upload.js';
const OUT = 'public/media-state.js';
const TOKEN = '20260701_media_state_split';
const sha = s => createHash('sha1').update(s).digest('hex');

const orig = readFileSync(SRC, 'utf8');
const lines = orig.split('\n');

const VARS = ['currentUserProfile','userWorks','allWorks','unsubMyWorks','unsubAllWorks','currentMediaTab','selectedWorkId','currentMediaFilter','currentMediaSort','currentMediaEmployeeFilter','currentMediaCategoryFilter','mediaCategories','unsubMediaCategories','mediaMyWorksHydrated','mediaAllWorksHydrated','_mediaWorkListSubKey'];
const VS = new Set(VARS);

// ---- AST: collect ranges to rename. Handle BOTH Identifier (reads/calls) and VariablePattern
//      (assignment targets / for-of lhs), since acorn-walk routes binding-position idents to
//      VariablePattern. Exclude: member props, obj keys, declaration ids, function params. ----
const ast = acorn.parse(orig, { ecmaVersion:'latest', sourceType:'module', ranges:true });
const repl = []; // {start,end,text}
let shorthands = 0, skippedDecl = 0, skippedParam = 0;
function isParam(node, fn){
  return Array.isArray(fn.params) && fn.params.some(p => p === node);
}
function classify(node, anc){
  if(!VS.has(node.name)) return;
  const p = anc[anc.length-2];
  if(!p) return;
  if(p.type==='MemberExpression' && p.property===node && !p.computed) return;      // obj.X
  if(p.type==='VariableDeclarator' && p.id===node){ skippedDecl++; return; }         // declaration site
  if((p.type==='FunctionDeclaration'||p.type==='FunctionExpression'||p.type==='ArrowFunctionExpression') && isParam(node,p)){ skippedParam++; return; }
  if(p.type==='Property' && !p.computed && p.key===node){
    if(p.shorthand){ shorthands++; repl.push({start:node.start, end:node.end, text:`${node.name}: mediaState.${node.name}`}); }
    return; // pure key: leave as-is
  }
  repl.push({start:node.start, end:node.end, text:`mediaState.${node.name}`});
}
walk.ancestor(ast, {
  Identifier(node, _st, anc){ classify(node, anc); },
  VariablePattern(node, _st, anc){ classify(node, anc); },
});
// apply right-to-left
repl.sort((a,b)=>b.start-a.start);
let renamed = orig;
for(const r of repl){ renamed = renamed.slice(0,r.start) + r.text + renamed.slice(r.end); }
console.log('AST refs renamed:', repl.length, '| shorthands expanded:', shorthands, '| skipped decl-ids:', skippedDecl, '| skipped params:', skippedParam);

// ---- remove declaration blocks by original line numbers ----
const renLines = renamed.split('\n');
if(renLines.length !== lines.length){ console.error('line count changed by rename!'); process.exit(1); }
const drop = new Set();
for(let i=34;i<=53;i++) drop.add(i);   // state lets + caps + hydrated + subkey
for(let i=310;i<=332;i++) drop.add(i); // MY_UPLOADS_FILTERS / TO_HANDLE_FILTERS / SORT_OPTIONS
drop.add(413);                          // MEDIA_DROPDOWN_FLOAT_MQ
// sanity on boundaries (using original lines)
if(!/^let currentUserProfile = null;/.test(lines[33])){console.error('L34',lines[33]);process.exit(1);}
if(lines[52].trim()!==''&&!/_mediaWorkListSubKey/.test(lines[52])){console.error('L53',lines[52]);process.exit(1);}
if(!/^const MY_UPLOADS_FILTERS = \[/.test(lines[309])){console.error('L310',lines[309]);process.exit(1);}
if(lines[331].trim()!=='];'){console.error('L332',lines[331]);process.exit(1);}
if(!/^const MEDIA_DROPDOWN_FLOAT_MQ =/.test(lines[412])){console.error('L413',lines[412]);process.exit(1);}

let reduced = renLines.filter((_,i)=>!drop.has(i+1)).join('\n');

// ---- insert media-state import after app.js import ----
const APP = 'import { db, auth } from "/app.js?v=20260610_force_lp_ios";';
const IMP = `import {
  mediaState,
  MEDIA_UPLOAD_POINTS_DAILY_CAP,
  MEDIA_MAX_IMAGES_PER_UPLOAD,
  MEDIA_DROPDOWN_FLOAT_MQ,
  MY_UPLOADS_FILTERS,
  TO_HANDLE_FILTERS,
  SORT_OPTIONS,
} from "./media-state.js?v=${TOKEN}";`;
if(!reduced.includes(APP)){console.error('app import missing');process.exit(1);}
reduced = reduced.replace(APP, APP + '\n' + IMP);

// ---- build media-state.js ----
const MOD = `/**
 * media-state.js — shared mutable controller state for the Media module (MY UPLOADS /
 * TO HANDLE / Upload / Work Details), split out of media-upload.js so it can be broken into
 * concern modules that share one source of truth. Also holds module constants and the
 * filter/sort config consumed by the filters + list renderers.
 */
export const mediaState = {
  currentUserProfile: null,
  userWorks: [],
  allWorks: [],
  unsubMyWorks: null,
  unsubAllWorks: null,
  currentMediaTab: "my_uploads",
  selectedWorkId: null,
  currentMediaFilter: "all",
  currentMediaSort: "newest",
  currentMediaEmployeeFilter: "all", // staffId or "all"; only used in TO HANDLE
  currentMediaCategoryFilter: "all", // categoryId or "all"; filter by category
  mediaCategories: [],
  unsubMediaCategories: null,
  /** First Firestore snapshot received (avoid empty-state flash while queries run). */
  mediaMyWorksHydrated: false,
  mediaAllWorksHydrated: false,
  /** Skip tearing down subscriptions when uid/staff/salon/to-handle unchanged (faster return to Media). */
  _mediaWorkListSubKey: "",
};

export const MEDIA_UPLOAD_POINTS_DAILY_CAP = 10;
export const MEDIA_MAX_IMAGES_PER_UPLOAD = 15;

export const MEDIA_DROPDOWN_FLOAT_MQ = "(max-width: 768px)";

export const MY_UPLOADS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "posted", label: "Posted" },
  { id: "featured", label: "Featured" },
  { id: "archived", label: "Archived" },
];

export const TO_HANDLE_FILTERS = [
  { id: "all", label: "All" },
  { id: "not_posted", label: "Not Posted" },
  { id: "posted", label: "Posted" },
  { id: "featured", label: "Featured" },
  { id: "archived", label: "Archived" },
  { id: "duplicate", label: "Duplicate" },
];

export const SORT_OPTIONS = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "most_posted", label: "Most Posted" },
  { id: "featured_first", label: "Featured First" },
];
`;

writeFileSync(OUT, MOD);
writeFileSync(SRC, reduced);

let total=0; for(const v of VARS){ total += (reduced.match(new RegExp(`mediaState\\.${v}\\b`,'g'))||[]).length; }
console.log('media-state.js lines:', MOD.split('\n').length);
console.log('main:', lines.length, '->', reduced.split('\n').length);
console.log('total mediaState.* refs in main:', total);
console.log('sha(main):', sha(reduced));
