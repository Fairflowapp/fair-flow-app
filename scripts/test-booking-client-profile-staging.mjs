/**
 * Staging checks for Client Profile appointment queries and client edits.
 * Disposable salon. Staging only.
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
const SALON = "ffClientProfileSmoke";
const SALON_B = "ffClientProfileSmokeB";
const UID = "ff-client-profile-smoke-user";
const UID_B = "ff-client-profile-smoke-user-b";
const EMAIL = "ff-client-profile@fair-flow-staging.test";
const EMAIL_B = "ff-client-profile-b@fair-flow-staging.test";
const PASS = "FfClientProfile-2026!";

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

function writeBridge(name) {
  writeFileSync(join(SDK_DIR, `bridge-${name}.mjs`), "export let db;\nexport function setDb(next) { db = next; }\n");
}

async function loadRepo(name, srcRel, email, uid, salonId) {
  const app = initializeApp(STAGING_APP, name);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(getAuth(app), email, PASS);
  writeBridge(name);
  writeFileSync(join(SDK_DIR, `${name}.mjs`), readFileSync(join(ROOT, srcRel), "utf8")
    .replace('from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js"', 'from "firebase/firestore"')
    .replace(/import \{ db \} from "\/app\.js[^"]+";/, `import { db } from "./bridge-${name}.mjs";`));
  const bridge = await import(pathToFileURL(join(SDK_DIR, `bridge-${name}.mjs`)).href);
  bridge.setDb(db);
  globalThis.currentSalonId = salonId;
  globalThis.ffAuth = { currentUser: { uid } };
  return import(pathToFileURL(join(SDK_DIR, `${name}.mjs`)).href);
}

function line(start, end, loc) {
  return {
    lineId: "line1",
    serviceId: "svc1",
    serviceNameSnapshot: "Full Set",
    providerId: "bobo",
    providerNameSnapshot: "Bobo",
    startAt: start,
    endAt: end,
    durationMinutes: 60,
    priceSnapshot: 80,
  };
}

async function main() {
  if (!existsSync(join(SDK_DIR, "node_modules/firebase/package.json"))) {
    throw new Error("Install firebase under /tmp/ff-client-itest-sdk first.");
  }
  globalThis.window = globalThis;
  new Function("window", readFileSync(join(ROOT, "public/booking/clients/model.js"), "utf8"))(globalThis);
  new Function("window", readFileSync(join(ROOT, "public/booking/appointments/model.js"), "utf8"))(globalThis);

  const admin = loadAdmin();
  const results = {};
  const record = (letter, ok, detail) => {
    results[letter] = { ok: !!ok, detail: detail || "" };
    console.log(`${ok ? "PASS" : "FAIL"} ${letter}: ${detail || ""}`);
  };

  try {
    await upsertUser(admin, UID, EMAIL, SALON);
    await upsertUser(admin, UID_B, EMAIL_B, SALON_B);
    const clients = await loadRepo("profileClients", "public/booking/clients/data.js", EMAIL, UID, SALON);
    const appts = await loadRepo("profileAppts", "public/booking/appointments/data.js", EMAIL, UID, SALON);
    globalThis.currentSalonId = SALON;
    globalThis.ffAuth = { currentUser: { uid: UID } };

    const created = await clients.createClient({
      firstName: "Jessica",
      lastName: "Miller",
      phone: "(954) 600-0292",
      email: "jessica.profile@example.com",
      notes: "Prefers aisle seat",
    });
    const other = await clients.createClient({
      firstName: "Other",
      lastName: "Client",
      phone: "3055550100",
      email: "other.profile@example.com",
    });
    record("B", !!(created.ok && created.client && created.client.clientId), created.client && created.client.clientId);
    const jessica = created.client;
    const otherId = other.client.clientId;

    const Ts = admin.firestore.Timestamp;
    const now = Date.now();
    const futureStart = new Date(now + 2 * 24 * 60 * 60 * 1000);
    const futureEnd = new Date(futureStart.getTime() + 60 * 60 * 1000);
    const pastStart = new Date(now - 3 * 24 * 60 * 60 * 1000);
    const pastEnd = new Date(pastStart.getTime() + 60 * 60 * 1000);
    const cancelStart = new Date(now - 5 * 24 * 60 * 60 * 1000);
    const cancelEnd = new Date(cancelStart.getTime() + 60 * 60 * 1000);
    const otherLocStart = new Date(now - 1 * 24 * 60 * 60 * 1000);
    const otherLocEnd = new Date(otherLocStart.getTime() + 60 * 60 * 1000);
    const otherClientStart = new Date(now + 3 * 24 * 60 * 60 * 1000);
    const otherClientEnd = new Date(otherClientStart.getTime() + 60 * 60 * 1000);

    const col = admin.firestore().collection(`salons/${SALON}/appointments`);
    const upcomingRef = await col.add({
      clientId: jessica.clientId, locationId: "locA", status: "scheduled",
      startAt: Ts.fromDate(futureStart), endAt: Ts.fromDate(futureEnd),
      serviceLines: [line(Ts.fromDate(futureStart), Ts.fromDate(futureEnd), "locA")],
      createdByUid: UID,
    });
    await col.add({
      clientId: jessica.clientId, locationId: "locA", status: "completed",
      startAt: Ts.fromDate(pastStart), endAt: Ts.fromDate(pastEnd),
      serviceLines: [line(Ts.fromDate(pastStart), Ts.fromDate(pastEnd), "locA")],
      createdByUid: UID,
    });
    await col.add({
      clientId: jessica.clientId, locationId: "locA", status: "cancelled",
      startAt: Ts.fromDate(cancelStart), endAt: Ts.fromDate(cancelEnd),
      serviceLines: [line(Ts.fromDate(cancelStart), Ts.fromDate(cancelEnd), "locA")],
      createdByUid: UID,
    });
    await col.add({
      clientId: jessica.clientId, locationId: "locB", status: "completed",
      startAt: Ts.fromDate(otherLocStart), endAt: Ts.fromDate(otherLocEnd),
      serviceLines: [line(Ts.fromDate(otherLocStart), Ts.fromDate(otherLocEnd), "locB")],
      createdByUid: UID,
    });
    await col.add({
      clientId: otherId, locationId: "locA", status: "scheduled",
      startAt: Ts.fromDate(otherClientStart), endAt: Ts.fromDate(otherClientEnd),
      serviceLines: [line(Ts.fromDate(otherClientStart), Ts.fromDate(otherClientEnd), "locA")],
      createdByUid: UID,
    });

    const loaded = await clients.getClientById(jessica.clientId);
    record("C", loaded.displayName === "Jessica Miller", loaded.displayName);
    record("D", /9546000292|954/.test(loaded.phone), loaded.phone);
    record("E", loaded.email === "jessica.profile@example.com", loaded.email);
    record("F", loaded.notes === "Prefers aisle seat", loaded.notes);
    record("G", !!loaded.createdAt, "createdAt");
    record("H", !!loaded.updatedAt, "updatedAt");

    const edited = await clients.updateClient(jessica.clientId, {
      firstName: "Jess",
      lastName: "Miller",
      phone: "7865550199",
      email: "jess.profile@example.com",
      notes: loaded.notes,
    });
    record("J", !!(edited.ok && edited.client && edited.client.clientId === jessica.clientId), edited.client && edited.client.clientId);
    record("K", edited.client.displayName === "Jess Miller", edited.client.displayName);
    record("L", edited.client.phoneKeys.indexOf("7865550199") !== -1 && edited.client.phoneKeyPrefixes.indexOf("786") !== -1, "phone fields");
    record("M", (await clients.searchClients("7865550199")).some((row) => row.clientId === jessica.clientId), "full phone");
    record("N", (await clients.searchClients("786555")).some((row) => row.clientId === jessica.clientId), "partial phone");
    record("O", (await clients.searchClients("jess.profile@example.com")).some((row) => row.clientId === jessica.clientId), "email");

    const hist = await appts.getClientAppointments(jessica.clientId, { limit: 20 });
    record("R", dataUsesClientId(), "query uses clientId");
    record("T", hist.upcoming.some((row) => row.appointmentId === upcomingRef.id && row.clientId === jessica.clientId), "upcoming");
    record("U", hist.past.some((row) => row.status === "completed" && row.locationId === "locA"), "past");
    record("V", !hist.upcoming.some((row) => row.clientId === otherId) && !hist.past.some((row) => row.clientId === otherId), "other client excluded");
    record("W", hist.past.some((row) => row.locationId === "locB" && row.clientId === jessica.clientId), "other location included");
    record("X", hist.upcoming[0] && hist.upcoming[0].serviceLines[0].serviceNameSnapshot === "Full Set", "service snapshot");
    record("Y", hist.upcoming[0] && hist.upcoming[0].serviceLines[0].providerNameSnapshot === "Bobo", "provider snapshot");
    record("Z", !!(hist.upcoming[0] && hist.upcoming[0].startAt && hist.upcoming[0].endAt), "times");
    record("AA", hist.past.some((row) => row.status === "cancelled"), "cancelled visible");
    record("AB", hist.upcoming.length <= 20, `upcoming=${hist.upcoming.length}`);
    record("AC", hist.past.length <= 20, `past=${hist.past.length}`);

    record("AG", (await clients.searchClients("Miller")).some((row) => row.clientId === jessica.clientId), "name search");
    record("AH", (await clients.searchClients("7865550199")).length >= 1, "exact phone");
    record("AI", (await clients.searchClients("786")).some((row) => row.clientId === jessica.clientId), "partial");
    record("AJ", (await clients.searchClients("jess.profile@example.com")).length >= 1, "email search");

    const clientsB = await loadRepo("profileClientsB", "public/booking/clients/data.js", EMAIL_B, UID_B, SALON_B);
    globalThis.currentSalonId = SALON_B;
    const cross = await clientsB.searchClients("7865550199");
    record("Pcross", cross.length === 0, `cross-salon n=${cross.length}`);
  } finally {
    const db = admin.firestore();
    for (const path of [`salons/${SALON}/appointments`, `salons/${SALON}/clients`, `salons/${SALON_B}/clients`]) {
      const snap = await db.collection(path).get().catch(() => ({ docs: [] }));
      for (const docSnap of snap.docs || []) await docSnap.ref.delete();
    }
    await db.doc(`users/${UID}`).delete().catch(() => {});
    await db.doc(`users/${UID_B}`).delete().catch(() => {});
    try { await admin.auth().deleteUser(UID); } catch (_) {}
    try { await admin.auth().deleteUser(UID_B); } catch (_) {}
  }

  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  if (failed.length) {
    console.error("FAILED", failed.map(([k]) => k).join(", "));
    process.exit(1);
  }
  console.log("Client Profile staging checks passed. Cleanup done.");
}

function dataUsesClientId() {
  const src = readFileSync(join(ROOT, "public/booking/appointments/data.js"), "utf8");
  return src.includes('where("clientId", "==", id)') && !src.includes("getDocs(appointmentsRef(salonId))") || src.includes("limit(cap)");
}

main().catch((err) => { console.error(err); process.exit(1); });
