import fs from 'fs';
import crypto from 'crypto';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const MOD = fs.readFileSync('public/tickets-catalog-data.js', 'utf8');
const NEW = fs.readFileSync('public/tickets.js', 'utf8');
const PRE = fs.readFileSync('refactor-backups/tickets/tickets.pre-catalog-data.js', 'utf8');
const m = JSON.parse(fs.readFileSync('refactor-backups/tickets/manifest-catalog-data.json', 'utf8'));

// ---------- BYTE-IDENTITY ----------
const blockText = m.blockLines.join('\n');
console.log('=== BYTE-IDENTITY ===');
console.log('moved block (865 lines) verbatim in module:', MOD.includes(blockText));
console.log('functions exported:', m.allNames.length);

// ---------- DEPENDENCY / INJECTION SCAN ----------
// Confirm the block references the injected/imported externals and no OTHER tickets.js UI.
const injected = ['renderServicesCatalogV2', 'setupTicketsUI'];
const imported = ['getActiveLocationIdForTickets'];
for (const n of injected.concat(imported)) {
  console.log(`  refs ${n}:`, (blockText.match(new RegExp('\\b' + n + '\\(', 'g')) || []).length);
}
// scan for any other render*/setup* call that would be an un-injected UI dependency
const uiCalls = [...new Set((blockText.match(/\b(?:render|setup)[A-Za-z0-9_]*\s*\(/g) || []).map(s => s.replace(/\s*\($/, '')))];
const unexpected = uiCalls.filter(c => !injected.includes(c));
console.log('  UI-ish calls in block:', JSON.stringify(uiCalls), '| unexpected (un-injected):', JSON.stringify(unexpected));

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
console.log('pre-catalog sha:  ', sha(PRE));
console.log('reconstructed sha:', sha(reconstructed));
console.log('BYTE-IDENTICAL:', sha(PRE) === sha(reconstructed));
if (sha(PRE) !== sha(reconstructed)) {
  const a = PRE.split('\n'), b = reconstructed.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { console.log('first diff line', i + 1, '\n PRE :', JSON.stringify(a[i]), '\n RECON:', JSON.stringify(b[i])); break; }
  }
}
