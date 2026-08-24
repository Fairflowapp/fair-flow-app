/**
 * Staging checks for partial phone search via phoneKeyPrefixes.
 * Cleans disposable records. Staging only.
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
import { backfill } from "./backfill-client-phone-key-prefixes.mjs";

const ROOT = "/Users/shiriadmoni/fair-flow-booking";
const SDK_DIR = "/tmp/ff-client-itest-sdk";
const SALON_A = "ffPhonePrefixA";
const SALON_B = "ffPhonePrefixB";
const UID_A = "ff-phone-prefix-user-a";
const UID_B = "ff-phone-prefix-user-b";
const EMAIL_A = "ff-phone-prefix-a@fair-flow-staging.test";
const EMAIL_B = "ff-phone-prefix-b@fair-flow-staging.test";
const PASS = "FfPhonePrefix-2026!";

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
  process.env.FF_BACKFILL_AS_MODULE = "1";
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
    const repoA = await loadRepo("prefixA", EMAIL_A, UID_A, SALON_A);
    const repoB = await loadRepo("prefixB", EMAIL_B, UID_B, SALON_B);
    globalThis.currentSalonId = SALON_A;
    globalThis.ffAuth = { currentUser: { uid: UID_A } };

    const created = await repoA.createClient({
      firstName: "Prefix",
      lastName: "Lookup",
      phone: "(954) 600-0292",
      email: "prefix.lookup@example.com",
    });
    const id = created.client && created.client.clientId;
    const prefixes = created.client && created.client.phoneKeyPrefixes;
    record("K", !!(created.ok && created.created && prefixes && prefixes.indexOf("954") !== -1 && prefixes.indexOf("9546000292") !== -1), "new client stored prefixes");

    const hits = async (q) => {
      globalThis.currentSalonId = SALON_A;
      const rows = await repoA.searchClients(q);
      return rows.some((row) => row.clientId === id);
    };
    record("A", await hits("954"), "954");
    record("B", await hits("9546"), "9546");
    record("C", await hits("954600"), "954600");
    record("D", await hits("(954) 600"), "(954) 600");
    record("E", await hits("9546000292"), "10-digit");
    record("F", await hits("+1 954 600 0292"), "+1");
    record("G", await hits("prefix.lookup@example.com"), "email");
    record("H", await hits("Lookup"), "name");

    const dup = await repoA.createClient({
      firstName: "Other",
      lastName: "Person",
      phone: "9546000292",
      email: "other.prefix@example.com",
    });
    record("I", !!(dup.duplicate && dup.client && dup.client.clientId === id), "duplicate detection");

    const legacyRef = await admin.firestore().collection(`salons/${SALON_A}/clients`).add({
      firstName: "Legacy",
      lastName: "Phone",
      phone: "3055551212",
      phoneDigits: "3055551212",
      phoneKeys: ["3055551212", "13055551212"],
      createdByUid: UID_A,
    });
    const before = await legacyRef.get();
    const hadPrefixes = Array.isArray(before.data().phoneKeyPrefixes);
    const fill = await backfill({ projectId: "fair-flow-staging", salonId: SALON_A });
    const after = await legacyRef.get();
    const filled = after.data().phoneKeyPrefixes || [];
    record("J", !hadPrefixes && filled.indexOf("305") !== -1 && filled.indexOf("3055551212") !== -1 && fill.updated >= 1, JSON.stringify(fill));

    const updated = await repoA.updateClient(id, {
      firstName: "Prefix",
      lastName: "Lookup",
      phone: "7865550100",
      email: "prefix.lookup@example.com",
    });
    const next = updated.client && updated.client.phoneKeyPrefixes || [];
    record("L", updated.ok && next.indexOf("786") !== -1 && next.indexOf("954") === -1 && next.indexOf("7865550100") !== -1, "phone update replaced prefixes");

    record("M", uiSrc.includes("api.searchClients(q)") && !uiSrc.includes("getDocs"), "Clients UI");
    record("N", apptSrc.includes("api.searchClients(query)") && !apptSrc.includes("getDocs"), "New Appointment");
    record("O", dataSrc.includes('where("phoneKeyPrefixes"') && dataSrc.includes("array-contains") && !dataSrc.includes("forEach((client"), "targeted prefix query");

    globalThis.currentSalonId = SALON_B;
    globalThis.ffAuth = { currentUser: { uid: UID_B } };
    const cross = await repoB.searchClients("7865550100");
    record("P", cross.length === 0, `cross-salon n=${cross.length}`);
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
  }

  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  if (failed.length) {
    console.error("FAILED", failed.map(([k]) => k).join(", "));
    process.exit(1);
  }
  console.log("Partial phone search staging checks passed. Cleanup done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
