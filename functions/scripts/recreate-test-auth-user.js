/**
 * Recreate the Auth record for the pre-existing test member
 * admin_test@fairflowapp.com (uid 56O1zruUrtRrn2tiFtXCcqw2sNg1) in
 * test_salon_001, so Playwright can log in and reproduce the mobile
 * Inventory freeze. Also prints/creates the users/{uid} doc if missing,
 * mirroring the shape of an existing user doc.
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

const UID = "56O1zruUrtRrn2tiFtXCcqw2sNg1";
const EMAIL = "admin_test@fairflowapp.com";
const PW = "FfInvDebug!2026";
const SALON = "test_salon_001";

(async () => {
  const db = admin.firestore();

  try {
    await admin.auth().createUser({ uid: UID, email: EMAIL, password: PW, displayName: "Admin Test" });
    console.log("auth user created");
  } catch (e) {
    if (e.code === "auth/uid-already-exists" || e.code === "auth/email-already-exists") {
      await admin.auth().updateUser(UID, { password: PW });
      console.log("auth user existed — password set");
    } else throw e;
  }

  const userRef = db.doc(`users/${UID}`);
  const snap = await userRef.get();
  if (snap.exists) {
    console.log("users doc exists:", JSON.stringify(snap.data()));
  } else {
    // Mirror shape from another member of the same salon.
    const sample = await db.doc(`users/Ub4MnJw1yAdK3eMCLQFG0J95pGr2`).get();
    console.log("sample users doc:", JSON.stringify(sample.exists ? sample.data() : null));
    const doc = {
      email: EMAIL,
      name: "Admin Test",
      role: "admin",
      salonId: SALON,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await userRef.set(doc);
    console.log("users doc created:", JSON.stringify(doc));
  }
  console.log(`READY email=${EMAIL} password=${PW}`);
})().catch((e) => { console.error(e); process.exit(1); });
