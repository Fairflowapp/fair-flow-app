import fs from 'fs';
import crypto from 'crypto';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const PRICE = fs.readFileSync('public/tickets-pricing.js', 'utf8');
const NEW = fs.readFileSync('public/tickets.js', 'utf8');
const PRE = fs.readFileSync('refactor-backups/tickets/tickets.pre-pricing.js', 'utf8');
const m = JSON.parse(fs.readFileSync('refactor-backups/tickets/manifest-pricing.json', 'utf8'));

// ---------- BYTE-IDENTITY ----------
const blockText = m.blockLines.join('\n');
console.log('=== BYTE-IDENTITY ===');
console.log('moved block (136 lines) verbatim in tickets-pricing.js:', PRICE.includes(blockText));

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
console.log('pre-pricing sha:  ', sha(PRE));
console.log('reconstructed sha:', sha(reconstructed));
console.log('BYTE-IDENTICAL:', sha(PRE) === sha(reconstructed));
if (sha(PRE) !== sha(reconstructed)) {
  const a = PRE.split('\n'), b = reconstructed.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { console.log('first diff line', i + 1, '\n PRE :', JSON.stringify(a[i]), '\n RECON:', JSON.stringify(b[i])); break; }
  }
}
