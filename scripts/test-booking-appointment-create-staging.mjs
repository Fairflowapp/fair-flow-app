/**
 * Staging checks for New Appointment create path (repository + form helper).
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
import { Timestamp, addDoc, collection, getDocs, getFirestore } from "firebase/firestore";

const ROOT = "/Users/shiriadmoni/fair-flow-booking";
const SDK_DIR = "/tmp/ff-client-itest-sdk";
const SALON = "ffApptCreateSmoke";
const UID = "ff-appt-create-smoke-user";
const LOC = "locA";
const PROV = "bobo";
const DATE_KEY = "2026-08-25";

const STAGING_APP = {
  apiKey: "AIzaSyDTBRAIbEmgx5uJ3I81mw5qfhlCpZAX4VI",
  authDomain: "fair-flow-staging.firebaseapp.com",
  projectId: "fair-flow-staging",
  storageBucket: "fair-flow-staging.firebasestorage.app",
  messagingSenderId: "529214117704",
  appId: "1:529214117704:web:b346f764c7f7ae716d457d",
};

function load(rel) {
  new Function("window", readFileSync(join(ROOT, rel), "utf8"))(globalThis);
}

function weekHours() {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const out = {};
  days.forEach((day) => { out[day] = { isOpen: true, openTime: "09:00", closeTime: "18:00" }; });
  return out;
}

function weekSchedule() {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const out = {};
  days.forEach((day) => { out[day] = { enabled: true, startTime: "09:00", endTime: "18:00" }; });
  return out;
}

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

async function main() {
  if (!existsSync(join(SDK_DIR, "node_modules/firebase/package.json"))) {
    throw new Error("Install firebase under /tmp/ff-client-itest-sdk first.");
  }
  globalThis.window = globalThis;
  globalThis.settings = {
    preferences: { salonTimeZone: "America/New_York" },
    locationSchedules: { [LOC]: { businessHours: weekHours() } },
  };
  globalThis.ffGetStaffStore = () => ({ staff: [{ id: PROV, name: "Bobo", defaultSchedule: weekSchedule() }] });
  load("public/booking/calendar-time.js");
  load("public/booking/availability.js");
  load("public/booking/appointments/model.js");
  load("public/booking/appointments/form.js");
  writeFileSync(join(SDK_DIR, "bridge.mjs"), "export let db;\nexport function setDb(next) { db = next; }\n");
  writeFileSync(join(SDK_DIR, "appointments-data.mjs"), readFileSync(join(ROOT, "public/booking/appointments/data.js"), "utf8")
    .replace('from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js"', 'from "firebase/firestore"')
    .replace('import { db } from "/app.js?v=20260610_force_lp_ios";', 'import { db } from "./bridge.mjs";'));

  const admin = loadAdmin();
  const results = {};
  const record = (letter, ok, detail) => {
    results[letter] = { ok: !!ok, detail: detail || "" };
    console.log(`${ok ? "PASS" : "FAIL"} ${letter}: ${detail || ""}`);
  };

  try {
    await admin.firestore().doc(`users/${UID}`).set({ salonId: SALON, role: "manager", email: "ff-appt-create@fair-flow-staging.test" }, { merge: true });
    try { await admin.auth().updateUser(UID, { email: "ff-appt-create@fair-flow-staging.test", password: "FfApptCreate-2026!", disabled: false }); }
    catch (err) {
      if (err.code === "auth/user-not-found") await admin.auth().createUser({ uid: UID, email: "ff-appt-create@fair-flow-staging.test", password: "FfApptCreate-2026!" });
      else throw err;
    }
    const app = initializeApp(STAGING_APP, "apptCreate");
    const db = getFirestore(app);
    await signInWithEmailAndPassword(getAuth(app), "ff-appt-create@fair-flow-staging.test", "FfApptCreate-2026!");
    const { setDb } = await import(pathToFileURL(join(SDK_DIR, "bridge.mjs")).href);
    setDb(db);
    globalThis.currentSalonId = SALON;
    globalThis.ffAuth = { currentUser: { uid: UID } };
    const repo = await import(pathToFileURL(join(SDK_DIR, "appointments-data.mjs")).href + `?t=${Date.now()}`);
    globalThis.ffBookingAppointments = repo;
    const model = globalThis.ffBookingAppointmentModel;
    const form = globalThis.ffBookingAppointmentForm;
    const at = (minutes) => model.civilToDate(DATE_KEY, minutes, LOC);

    const clientRef = await addDoc(collection(db, `salons/${SALON}/clients`), {
      firstName: "Jessica", lastName: "Miller", phone: "3055559999", email: "jess.create@example.com",
      createdByUid: UID, createdAtLocationId: LOC, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    const gelRef = await addDoc(collection(db, `salons/${SALON}/services`), {
      name: "Gel Manicure", defaultPrice: 45, durationMinutes: 45, active: true,
      staffOverrides: { [PROV]: { durationMinutes: 60 } },
    });

    const state = form.emptyState({ locationId: LOC, dateKey: DATE_KEY, startMin: 14 * 60 + 15, providerId: PROV });
    form.setClient(state, { clientId: clientRef.id, displayName: "Jessica Miller", phone: "3055559999" });
    state.serviceId = gelRef.id;
    state.service = { id: gelRef.id, durationMinutes: 60, price: 45, raw: { durationMinutes: 60, defaultPrice: 45, staffOverrides: { [PROV]: { durationMinutes: 60 } } } };
    form.derive(state);
    record("I", state.durationMinutes === 60 && state.endMin === 15 * 60 + 15, `duration=${state.durationMinutes} end=${state.endMin}`);

    const created = await form.create(state);
    record("N", !!(created.ok && created.appointment), created.ok ? created.appointment.appointmentId : created.error);
    const appt = created.appointment;
    record("U", !!(appt && appt.clientId === clientRef.id && appt.serviceLines[0].serviceId === gelRef.id && appt.serviceLines[0].providerId === PROV && appt.locationId === LOC && appt.serviceLines[0].durationMinutes === 60 && appt.serviceLines[0].priceSnapshot === 45), appt ? JSON.stringify({ clientId: appt.clientId, serviceId: appt.serviceLines[0].serviceId, duration: appt.serviceLines[0].durationMinutes, price: appt.serviceLines[0].priceSnapshot }) : "missing");

    const overlap = await repo.createAppointment({
      clientId: clientRef.id, locationId: LOC, source: "front_desk", assignmentType: "specific_provider",
      serviceLines: [{ serviceId: gelRef.id, providerId: PROV, startAt: at(14 * 60 + 15), durationMinutes: 60 }],
    });
    record("O", !overlap.ok && overlap.code === "APPOINTMENT_CONFLICT" && /already has an appointment/.test(form.friendlyError(overlap.code, PROV)), form.friendlyError(overlap.code, PROV));

    const late = await repo.createAppointment({
      clientId: clientRef.id, locationId: LOC,
      serviceLines: [{ serviceId: gelRef.id, providerId: PROV, startAt: at(17 * 60 + 30), durationMinutes: 60 }],
    });
    record("P", !late.ok && late.code === "OUTSIDE_BUSINESS_HOURS", late.code || JSON.stringify(late));

    const tickets = await admin.firestore().collection(`salons/${SALON}/tickets`).get();
    const queue = await admin.firestore().collection(`salons/${SALON}/queue`).get().catch(() => ({ size: 0 }));
    record("V", tickets.size === 0, `tickets=${tickets.size}`);
    record("W", queue.size === 0, `queue=${queue.size}`);
  } finally {
    const db = admin.firestore();
    for (const path of [`salons/${SALON}/appointments`, `salons/${SALON}/clients`, `salons/${SALON}/services`, `salons/${SALON}/tickets`]) {
      const snap = await db.collection(path).get().catch(() => ({ docs: [] }));
      for (const docSnap of snap.docs || []) await docSnap.ref.delete();
    }
    await db.doc(`users/${UID}`).delete().catch(() => {});
    try { await admin.auth().deleteUser(UID); } catch (_) {}
    console.log(JSON.stringify({ results }, null, 2));
  }
  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  if (failed.length) {
    console.error("FAILED", failed.map(([k]) => k).join(", "));
    process.exit(1);
  }
  console.log("Create-workflow staging checks passed. Cleanup done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
