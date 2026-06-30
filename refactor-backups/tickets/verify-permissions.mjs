import fs from 'fs';
import crypto from 'crypto';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const PERM = fs.readFileSync('public/tickets-permissions.js', 'utf8');
const NEW = fs.readFileSync('public/tickets.js', 'utf8');
const PRE = fs.readFileSync('refactor-backups/tickets/tickets.pre-permissions.js', 'utf8');
const m = JSON.parse(fs.readFileSync('refactor-backups/tickets/manifest-permissions.json', 'utf8'));

// ---------- BYTE-IDENTITY of moved block ----------
const blockText = m.blockLines.join('\n');
console.log('=== BYTE-IDENTITY ===');
console.log('moved block (301 lines) present verbatim in tickets-permissions.js:', PERM.includes(blockText));

// ---------- DEPENDENCY SCAN: only tickets.js symbol allowed is normalizeTicketTechName ----------
// crude: list bare call-like identifiers in the block that are NOT window.*/ticketsState.*/firebase/self.
const selfNames = new Set([...m.usedNames, 'loadFrontDeskRecipients','getTicketsStaffPermissions','ffTicketsIsMobileViewport',
  'initTicketsPermissions','normalizeTicketTechName']);
const allowedGlobals = new Set(['collection','getDocs','db','ticketsState','window','document','console','Set','Map','Array','Number','String','Object','Boolean','Math','getCurrentActorRole','JSON']);
const callRe = /(?<![.\w])([A-Za-z_$][\w$]*)\s*\(/g;
const calls = new Set();
let mm; while ((mm = callRe.exec(blockText))) calls.add(mm[1]);
const foreign = [...calls].filter(c => !selfNames.has(c) && !allowedGlobals.has(c));
console.log('foreign call identifiers in block (expect only safe/window helpers):', JSON.stringify(foreign));

// ---------- REVERSIBILITY ----------
let lines = NEW.split('\n');
// remove the 2 inserted lines (exact match, at insertAt)
for (const ins of m.insertedLines) {
  const idx = lines.indexOf(ins);
  if (idx < 0) throw new Error('inserted line not found: ' + ins);
  lines.splice(idx, 1);
}
// re-insert removed slice at original block start
lines.splice(m.blockStartIndex0, 0, ...m.removeSlice);
const reconstructed = lines.join('\n');

console.log('\n=== REVERSIBILITY ===');
console.log('pre-permissions sha:', sha(PRE));
console.log('reconstructed sha:  ', sha(reconstructed));
console.log('BYTE-IDENTICAL:', sha(PRE) === sha(reconstructed));
if (sha(PRE) !== sha(reconstructed)) {
  const a = PRE.split('\n'), b = reconstructed.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { console.log('first diff line', i + 1, '\n PRE :', JSON.stringify(a[i]), '\n RECON:', JSON.stringify(b[i])); break; }
  }
}
