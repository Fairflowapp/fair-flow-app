import fs from 'fs';
import crypto from 'crypto';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const MOD = fs.readFileSync('public/tickets-nav.js', 'utf8');
const NEW = fs.readFileSync('public/tickets.js', 'utf8');
const PRE = fs.readFileSync('refactor-backups/tickets/tickets.pre-nav.js', 'utf8');
const m = JSON.parse(fs.readFileSync('refactor-backups/tickets/manifest-nav.json', 'utf8'));

const blockText = m.blockLines.join('\n');
console.log('=== BYTE-IDENTITY ===');
console.log('moved block (' + m.blockLines.length + ' lines) verbatim in module:', MOD.includes(blockText));
console.log('exported (inline):', JSON.stringify(m.allNames));

// injected refs present in block
const injected = ['showToast','loadCurrentUserProfile','enrichTicketsProfileFromMemberDoc','loadTicketsMembersForAvatars','setupTicketsUI','updateNewTicketButtonVisibility'];
console.log('\n=== INJECTED DEP REFS (calls in block) ===');
for (const n of injected) console.log(`  ${n}:`, (blockText.match(new RegExp('\\b' + n + '\\(', 'g')) || []).length);

// reversibility
let lines = NEW.split('\n');
for (const ins of m.insertedLines) {
  const idx = lines.indexOf(ins);
  if (idx < 0) throw new Error('inserted line not found: ' + ins);
  lines.splice(idx, 1);
}
lines.splice(m.blockStartIndex0, 0, ...m.removeSlice);
const reconstructed = lines.join('\n');

console.log('\n=== REVERSIBILITY ===');
console.log('pre sha:          ', sha(PRE));
console.log('reconstructed sha:', sha(reconstructed));
console.log('BYTE-IDENTICAL:', sha(PRE) === sha(reconstructed));
if (sha(PRE) !== sha(reconstructed)) {
  const a = PRE.split('\n'), b = reconstructed.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { console.log('first diff line', i + 1, '\n PRE :', JSON.stringify(a[i]), '\n RECON:', JSON.stringify(b[i])); break; }
  }
}

// wiring check
console.log('\n=== WIRING (tickets.js) ===');
console.log('imports initTicketsNav+names:', /import \{ initTicketsNav, goToTickets, goToServices \}/.test(NEW));
console.log('calls initTicketsNav({...}):', /initTicketsNav\(\{/.test(NEW));
console.log('keeps window.goToTickets assign:', /window\.goToTickets = goToTickets;/.test(NEW));
console.log('keeps window.goToServices assign:', /window\.goToServices = goToServices;/.test(NEW));
console.log('goToTickets/goToServices no longer defined in tickets.js:', !/^export (async )?function goTo(Tickets|Services)/m.test(NEW));
