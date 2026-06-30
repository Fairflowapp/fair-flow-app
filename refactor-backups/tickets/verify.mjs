import fs from 'fs';
import crypto from 'crypto';
import { classify } from './common.mjs';

const NEW = fs.readFileSync('public/tickets.js', 'utf8');
const BASE = fs.readFileSync('refactor-backups/tickets/tickets.baseline.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('refactor-backups/tickets/manifest.json', 'utf8'));
const names = manifest.names;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// ---------- COMPLETENESS ----------
// Re-run the SAME classifier on the NEW file. Any "convert" hit now is a leftover
// bareword target reference (because all real refs should already be ticketsState.X,
// and `ticketsState.X` makes X a member-prop -> classified as skipped, not convert).
const { convert, shorthand, skipped } = classify(NEW);
const memberRefs = (NEW.match(/ticketsState\.[A-Za-z_]+/g) || []).length;
const importOk = NEW.includes(manifest.importLine);

console.log('=== COMPLETENESS ===');
console.log('leftover bareword target refs (should be 0):', convert.length);
if (convert.length) console.log('  ', JSON.stringify(convert.slice(0, 40)));
console.log('shorthand sites (should be 0):', shorthand.length);
console.log('ticketsState.X member refs in file:', memberRefs);
console.log('distinct ticketsState.<name>:', new Set((NEW.match(/ticketsState\.[A-Za-z_]+/g) || [])).size);
console.log('import line present:', importOk);
console.log('TICKETS_PAGE_SIZE bare uses:', (NEW.match(/\bTICKETS_PAGE_SIZE\b/g) || []).length, '| _ticketSummaryPageSize:', (NEW.match(/\b_ticketSummaryPageSize\b/g) || []).length);
console.log('skipped breakdown:', JSON.stringify(skipped));

// ---------- REVERSIBILITY ----------
let lines = NEW.split('\n');
const impIdx = lines.indexOf(manifest.importLine);
if (impIdx < 0) throw new Error('import line not found for reverse');
lines.splice(impIdx, 1);
const re = new RegExp('\\bticketsState\\.(' + names.join('|') + ')\\b', 'g');
let text = lines.join('\n').replace(re, '$1');
lines = text.split('\n');
for (const d of manifest.decls.slice().sort((a, b) => a.index0 - b.index0)) lines.splice(d.index0, 0, d.text);
const reconstructed = lines.join('\n');

console.log('\n=== REVERSIBILITY ===');
console.log('baseline sha:     ', sha(BASE));
console.log('reconstructed sha:', sha(reconstructed));
console.log('BYTE-IDENTICAL:', sha(BASE) === sha(reconstructed));
if (sha(BASE) !== sha(reconstructed)) {
  const a = BASE.split('\n'), b = reconstructed.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { console.log('first diff line', i + 1, '\n BASE :', JSON.stringify(a[i]), '\n RECON:', JSON.stringify(b[i])); break; }
  }
}
