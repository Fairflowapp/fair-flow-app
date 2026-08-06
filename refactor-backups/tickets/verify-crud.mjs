import fs from 'fs';
import crypto from 'crypto';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const MOD = fs.readFileSync('public/tickets-crud.js', 'utf8');
const NEW = fs.readFileSync('public/tickets.js', 'utf8');
const PRE = fs.readFileSync('refactor-backups/tickets/tickets.pre-crud.js', 'utf8');
const m = JSON.parse(fs.readFileSync('refactor-backups/tickets/manifest-crud.json', 'utf8'));

// ---------- BYTE-IDENTITY ----------
const blockText = m.blockLines.join('\n');
console.log('=== BYTE-IDENTITY ===');
console.log('moved block (' + m.blockLines.length + ' lines) verbatim in module:', MOD.includes(blockText));
console.log('functions exported:', m.allNames.length);

// ---------- DEPENDENCY / INJECTION SCAN ----------
const injected = ['getActiveTicketsSalonId', 'notifyTicketsAnalyticsDataChanged', 'ticketSubmittedAtDate', '_fmtYmdLocal', 'showToast', 'renderTicketsList', 'closeTicketModal'];
const imported = ['canSeeTicket', 'getActiveLocationIdForTickets'];
const firebase = ['collection', 'query', 'where', 'orderBy', 'limit', 'startAfter', 'doc', 'getDoc', 'getDocFromServer', 'getDocs', 'addDoc', 'updateDoc', 'deleteDoc', 'deleteField', 'onSnapshot', 'serverTimestamp', 'Timestamp'];
console.log('\n=== DEP REFS (calls in block) ===');
for (const n of injected.concat(imported)) {
  console.log(`  ${n}:`, (blockText.match(new RegExp('\\b' + n + '\\(', 'g')) || []).length);
}

// Foreign-call scan: every called bareword identifier minus (block-local fns, injected,
// imported, firebase, JS builtins/keywords). window.* and obj.method() are excluded.
const calls = [...blockText.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(x => x[2]);
const local = new Set(m.allNames);
const known = new Set([...injected, ...imported, ...firebase]);
const builtins = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'await', 'new', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Map', 'Set', 'Date', 'Promise', 'Math', 'JSON', 'isNaN', 'parseInt', 'parseFloat', 'console', 'document', 'setTimeout', 'CustomEvent', 'Error']);
const foreign = [...new Set(calls)].filter(c => !local.has(c) && !known.has(c) && !builtins.has(c));
console.log('\n=== FOREIGN CALL IDENTIFIERS (review) ===');
console.log(JSON.stringify(foreign));
// window.* members referenced
const win = [...new Set([...blockText.matchAll(/window\.([A-Za-z_$][\w$]*)/g)].map(x => x[1]))];
console.log('window.* members used:', JSON.stringify(win));

// ---------- REVERSIBILITY ----------
let lines = NEW.split('\n');
for (const ins of m.insertedLines) {
  const idx = lines.indexOf(ins);
  if (idx < 0) throw new Error('inserted line not found: ' + ins);
  lines.splice(idx, 1);
}
lines.splice(m.blockStartIndex0, 0, ...m.removeSlice);
const reconstructed = lines.join('\n');

console.log('\n=== REVERSIBILITY ===');
console.log('pre-crud sha:    ', sha(PRE));
console.log('reconstructed sha:', sha(reconstructed));
console.log('BYTE-IDENTICAL:', sha(PRE) === sha(reconstructed));
if (sha(PRE) !== sha(reconstructed)) {
  const a = PRE.split('\n'), b = reconstructed.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { console.log('first diff line', i + 1, '\n PRE :', JSON.stringify(a[i]), '\n RECON:', JSON.stringify(b[i])); break; }
  }
}
