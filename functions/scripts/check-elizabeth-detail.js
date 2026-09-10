/*
 * READ-ONLY: deep-dive on Elizabeth Alvarez login state.
 * Salon: Zmqs7MrHe4vgscfiCtNF (neo nails - Miami)
 * Staff: staff_1779205398717_0c6d0g95h, email zuanet3@gmail.com, uid kIUoIGUJFcgJV8vDI5moKQc49KR2
 * No writes.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const admin = require("firebase-admin");

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "configstore", "firebase-tools.json"), "utf8"));
const au = { type: "authorized_user", client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com", client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi", refresh_token: cfg.tokens.refresh_token };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff-adc-"));
fs.writeFileSync(path.join(tmp, "adc.json"), JSON.stringify(au));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(tmp, "adc.json");

admin.initializeApp({ projectId: "fairflowapp-db841", credential: admin.credential.applicationDefault() });
const db = admin.firestore();

const SALON_ID = "Zmqs7MrHe4vgscfiCtNF";
const STAFF_ID = "staff_1779205398717_0c6d0g95h";
const EMAIL = "zuanet3@gmail.com";
const UID = "kIUoIGUJFcgJV8vDI5moKQc49KR2";

function fmtTs(v) {
  try { if (v && typeof v.toDate === "function") return v.toDate().toISOString(); } catch (_) {}
  return v == null ? "" : String(v);
}

(async () => {
  console.log("=== Staff doc (full) ===");
  const staffDoc = await db.doc(`salons/${SALON_ID}/staff/${STAFF_ID}`).get();
  const s = staffDoc.data() || {};
  Object.keys(s).sort().forEach((k) => {
    const v = s[k];
    const out = (v && typeof v.toDate === "function") ? fmtTs(v) : JSON.stringify(v);
    console.log(`  ${k} = ${out}`);
  });

  console.log("\n=== Firebase Auth: by email ===");
  try {
    const u = await admin.auth().getUserByEmail(EMAIL);
    console.log(`  uid=${u.uid}`);
    console.log(`  email=${u.email} verified=${u.emailVerified} disabled=${u.disabled}`);
    console.log(`  providers=${u.providerData.map((p) => p.providerId).join(",") || "(none)"}`);
    console.log(`  created=${u.metadata.creationTime}`);
    console.log(`  lastSignIn=${u.metadata.lastSignInTime}`);
    console.log(`  lastRefresh=${u.metadata.lastRefreshTime || "n/a"}`);
    console.log(`  customClaims=${JSON.stringify(u.customClaims || {})}`);
  } catch (e) {
    console.log(`  NOT FOUND by email: ${e.code || e.message}`);
  }

  console.log("\n=== Firebase Auth: by uid on staff doc ===");
  try {
    const u = await admin.auth().getUser(UID);
    console.log(`  uid=${u.uid} email=${u.email} disabled=${u.disabled}`);
    console.log(`  providers=${u.providerData.map((p) => p.providerId).join(",") || "(none)"}`);
    console.log(`  created=${u.metadata.creationTime} lastSignIn=${u.metadata.lastSignInTime} lastRefresh=${u.metadata.lastRefreshTime || "n/a"}`);
  } catch (e) {
    console.log(`  NOT FOUND by uid: ${e.code || e.message}`);
  }

  console.log("\n=== users/{uid} doc ===");
  const userDoc = await db.doc(`users/${UID}`).get();
  console.log(`  exists=${userDoc.exists}`);
  if (userDoc.exists) {
    const u = userDoc.data() || {};
    Object.keys(u).sort().forEach((k) => {
      const v = u[k];
      const out = (v && typeof v.toDate === "function") ? fmtTs(v) : JSON.stringify(v);
      console.log(`  ${k} = ${out}`);
    });
  }

  console.log("\n=== users/{uid}/memberships ===");
  const memSnap = await db.collection(`users/${UID}/memberships`).get();
  console.log(`  count=${memSnap.size}`);
  memSnap.forEach((d) => console.log(`  - ${d.id}: ${JSON.stringify(d.data())}`));

  console.log("\n=== pendingInvites for email ===");
  for (const field of ["email", "inviteEmail"]) {
    try {
      const snap = await db.collection("pendingInvites").where(field, "==", EMAIL).get();
      snap.forEach((d) => {
        const inv = d.data() || {};
        console.log(`  [${field}] ${d.id}: salonId=${inv.salonId || ""} status=${inv.status || ""} staffId=${inv.staffId || ""} createdAt=${fmtTs(inv.createdAt)} usedAt=${fmtTs(inv.usedAt)}`);
      });
      if (snap.empty) console.log(`  [${field}] none`);
    } catch (e) {
      console.log(`  [${field}] query failed: ${e.message}`);
    }
  }

  console.log("\n=== salon invites subcollection (if any) ===");
  for (const coll of ["invites", "pendingInvites", "staffInvites"]) {
    try {
      const snap = await db.collection(`salons/${SALON_ID}/${coll}`).get();
      if (!snap.empty) {
        snap.forEach((d) => {
          const inv = d.data() || {};
          const hay = JSON.stringify(inv).toLowerCase();
          if (hay.includes("zuanet") || hay.includes("eliz") || (inv.staffId === STAFF_ID)) {
            console.log(`  ${coll}/${d.id}: ${JSON.stringify(inv).slice(0, 500)}`);
          }
        });
      }
    } catch (_) {}
  }

  process.exit(0);
})().catch((err) => { console.error("Failed:", err); process.exit(1); });
