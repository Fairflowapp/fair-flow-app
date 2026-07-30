/*
 * Pre-deploy guard for firestore.rules.
 *
 * Fails the deploy if a critical rules block is missing from firestore.rules.
 * Added after the passwordResetRequests block was silently lost in a merge
 * (July 6, 2026) and deployed to production, breaking Forgot Password.
 *
 * Wired into firebase.json: firestore.predeploy.
 * Run manually: node scripts/check-critical-rules.js
 */

const fs = require("fs");
const path = require("path");

const RULES_PATH = path.join(__dirname, "..", "firestore.rules");

// Each entry must appear as a `match` block in firestore.rules.
// If you intentionally remove one, update this list in the same commit.
const CRITICAL_MATCHES = [
  "/passwordResetRequests/",   // Forgot Password flow (branded reset email)
  "/staffInviteTokens/",       // staff invite finalize flow
  "/users/",                   // user profile docs
  "/salons/",                  // core salon data
  "/mail/",                    // outbound email queue (send-email extension)
  "/{document=**}",            // default deny — must always be last resort
];

const src = fs.readFileSync(RULES_PATH, "utf8");

const missing = CRITICAL_MATCHES.filter((m) => !src.includes(`match ${m}`));

if (missing.length) {
  console.error("\n[check-critical-rules] DEPLOY BLOCKED — firestore.rules is missing critical block(s):");
  missing.forEach((m) => console.error(`  - match ${m}`));
  console.error("\nThis usually means a merge dropped part of the file.");
  console.error("Restore the missing block(s) before deploying (see git history of firestore.rules).\n");
  process.exit(1);
}

console.log(`[check-critical-rules] OK — all ${CRITICAL_MATCHES.length} critical rule blocks present.`);
