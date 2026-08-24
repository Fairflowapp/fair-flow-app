/**
 * Staging verification for Booking client phone search.
 * Creates a disposable client, checks A–L, then deletes the records.
 */
import "./patch-fetch-staging.mjs";
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const ROOT = "/Users/shiriadmoni/fair-flow-booking";
const SDK_DIR = "/tmp/ff-client-itest-sdk";
const SALON_A = "ffPhoneSearchA";
const SALON_B = "ffPhoneSearchB";
const UID_A = "ff-phone-search-user-a";
const UID_B = "ff-phone-search-user-b";
const EMAIL_A = "ff-phone-search-a@fair-flow-staging.test";
const EMAIL_B = "ff-phone-search-b@fair-flow-staging.test";
const PASS = "FfPhoneSearch-2026!";
const PHONE = "(954) 600-0292";

const STAGING_APP = {
  apiKey: "AIzaSyDTBRAIbEmgx5uJ3I81mw5qfhlCpZAX4VI",
  authDomain: "fair-flow-staging.firebaseapp.com",
  projectId: "fair-flow-staging",
  storageBucket: "fair-flow-staging.firebasestorage.app",
  messagingSenderId: "529214117704",
  appId: "1:529214117704:web:b346f764c7f7ae716d457d",
};

function loadAdmin() {
  const cfg = JSON.parse(readFileSync(join(process.env.HOME, ".config/configstore/firebase-tools.json"), "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "ff-adc-"));
  writeFileSync(join(tmp, "adc.json"), JSON.stringify({
    type: "authorized_user",
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: cfg.tokens.refresh_token,
  }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = join(tmp, "adc.json");
  const admin = createRequire(join(SDK_DIR, "package.json"))("firebase-admin");
  if (!admin.apps.length) admin.initializeApp({ projectId: "fair-flow-staging", credential: admin.credential.applicationDefault() });
  return admin;
}

async function upsertUser(admin, uid, email, salonId) {
  await admin.firestore().doc(`users/${uid}`).set({ salonId, role: "manager", email }, { merge: true });
  try { await admin.auth().updateUser(uid, { email, password: PASS, disabled: false }); }
  catch (err) {
    if (err.code === "auth/user-not-found") await admin.auth().createUser({ uid, email, password: PASS });
    else throw err;
  }
}

async function loadRepo(appName, email, uid, salonId) {
  const app = initializeApp(STAGING_APP, appName);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(getAuth(app), email, PASS);
  const bridgePath = join(SDK_DIR, `bridge-${appName}.mjs`);
  writeFileSync(bridgePath, "export let db;\nexport function setDb(next) { db = next; }\n");
  writeFileSync(join(SDK_DIR, `clients-data-${appName}.mjs`), readFileSync(join(ROOT, "public/booking/clients/data.js"), "utf8")
    .replace('from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js"', 'from "firebase/firestore"')
    .replace('import { db } from "/app.js?v=20260610_force_lp_ios";', `import { db } from "./bridge-${appName}.mjs";`));
  const bridge = await import(pathToFileURL(bridgePath).href);
  bridge.setDb(db);
  globalThis.currentSalonId = salonId;
  globalThis.ffAuth = { currentUser: { uid } };
  return import(pathToFileURL(join(SDK_DIR, `clients-data-${appName}.mjs`)).href);
}

async function main() {
  if (!existsSync(join(SDK_DIR, "node_modules/firebase/package.json"))) {
    throw new Error("Install firebase under /tmp/ff-client-itest-sdk first.");
  }
  globalThis.window = globalThis;
  new Function("window", readFileSync(join(ROOT, "public/booking/clients/model.js"), "utf8"))(globalThis);

  const uiSrc = readFileSync(join(ROOT, "public/booking/clients/ui.js"), "utf8");
  const apptSrc = readFileSync(join(ROOT, "public/booking/appointments/drawer.js"), "utf8");
  const dataSrc = readFileSync(join(ROOT, "public/booking/clients/data.js"), "utf8");

  const admin = loadAdmin();
  const results = {};
  const record = (letter, ok, detail) => {
    results[letter] = { ok: !!ok, detail: detail || "" };
    console.log(`${ok ? "PASS" : "FAIL"} ${letter}: ${detail || ""}`);
  };

  try {
    await upsertUser(admin, UID_A, EMAIL_A, SALON_A);
    await upsertUser(admin, UID_B, EMAIL_B, SALON_B);
    const repoA = await loadRepo("phoneA", EMAIL_A, UID_A, SALON_A);
    const repoB = await loadRepo("phoneB", EMAIL_B, UID_B, SALON_B);
    globalThis.currentSalonId = SALON_A;
    globalThis.ffAuth = { currentUser: { uid: UID_A } };

    const created = await repoA.createClient({
      firstName: "Phone",
      lastName: "Lookup",
      phone: PHONE,
      email: "phone.lookup@example.com",
      notes: "disposable phone search",
    });
    const id = created.client && created.client.clientId;
    const hits = async (q) => {
      globalThis.currentSalonId = SALON_A;
      const rows = await repoA.searchClients(q);
      return rows.some((row) => row.clientId === id);
    };

    record("A", await hits("9546000292"), "10 digits");
    record("B", await hits("954-600-0292"), "formatted");
    record("C", await hits("(954) 600-0292"), "parentheses/spaces");
    record("D", await hits("+1 954 600 0292"), "+1");
    record("E", await hits("19546000292"), "11-digit US");
    record("F", await hits("phone.lookup@example.com"), "email");
    record("G", await hits("Lookup"), "name");
    record("H", uiSrc.includes("api.searchClients(q)") && !uiSrc.includes("getDocs") && !uiSrc.includes("collection("), "Clients UI uses repository search");
    record("I", apptSrc.includes("api.searchClients(query)") && !apptSrc.includes("getDocs"), "New Appointment uses repository search");
    record("J", dataSrc.includes('where("phoneKeys"') && !dataSrc.includes("getDocs(clientsRef") && dataSrc.includes("limit(cap)"), "no full collection download");

    globalThis.currentSalonId = SALON_B;
    globalThis.ffAuth = { currentUser: { uid: UID_B } };
    const cross = await repoB.searchClients("9546000292");
    record("K", cross.length === 0, `cross-salon n=${cross.length}`);

    globalThis.currentSalonId = SALON_A;
    globalThis.ffAuth = { currentUser: { uid: UID_A } };
    const dup = await repoA.createClient({
      firstName: "Other",
      lastName: "Person",
      phone: "9546000292",
      email: "other.phone@example.com",
    });
    record("L", !!(dup.duplicate && dup.client && dup.client.clientId === id), dup.error || (dup.duplicate ? "duplicate kept same clientId" : "created a second client"));
  } finally {
    const db = admin.firestore();
    for (const path of [`salons/${SALON_A}/clients`, `salons/${SALON_B}/clients`]) {
      const snap = await db.collection(path).get().catch(() => ({ docs: [] }));
      for (const docSnap of snap.docs || []) await docSnap.ref.delete();
    }
    await db.doc(`users/${UID_A}`).delete().catch(() => {});
    await db.doc(`users/${UID_B}`).delete().catch(() => {});
    try { await admin.auth().deleteUser(UID_A); } catch (_) {}
    try { await admin.auth().deleteUser(UID_B); } catch (_) {}
    try { await admin.auth().deleteUser("ff-phone-search-temp-user"); } catch (_) {}
    try { await admin.auth().deleteUser("ff-phone-search-smoke-user"); } catch (_) {}
    await db.doc("users/ff-phone-search-temp-user").delete().catch(() => {});
    await db.doc("users/ff-phone-search-smoke-user").delete().catch(() => {});
  }

  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  if (failed.length) {
    console.error("FAILED", failed.map(([k]) => k).join(", "));
    process.exit(1);
  }
  console.log("Phone search staging checks passed. Cleanup done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
