/**
 * Staging integration tests A–Q for the Booking Appointment repository.
 * Usage from /tmp/ff-client-itest-sdk:
 *   node /Users/shiriadmoni/fair-flow-booking/scripts/test-booking-appointment-staging.mjs
 * Cleans up disposable smoke records. Staging only.
 */
import "./patch-fetch-staging.mjs";
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  Timestamp,
  addDoc,
  collection,
  getDocs,
  getFirestore,
} from "firebase/firestore";

const ROOT = "/Users/shiriadmoni/fair-flow-booking";
const SDK_DIR = "/tmp/ff-client-itest-sdk";
const SALON_A = "ffApptSmokeA";
const SALON_B = "ffApptSmokeB";
const UID_A = "ff-appt-smoke-user-a";
const UID_B = "ff-appt-smoke-user-b";
const LOC_A = "locA";
const LOC_B = "locB";
const PROV_A = "provA";
const PROV_B = "provB";
const PROV_OFF = "provOff";
const DATE_KEY = "2026-08-29";

const STAGING_APP = {
  apiKey: "AIzaSyDTBRAIbEmgx5uJ3I81mw5qfhlCpZAX4VI",
  authDomain: "fair-flow-staging.firebaseapp.com",
  projectId: "fair-flow-staging",
  storageBucket: "fair-flow-staging.firebasestorage.app",
  messagingSenderId: "529214117704",
  appId: "1:529214117704:web:b346f764c7f7ae716d457d",
};

function loadWindowScript(rel) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  new Function("window", src)(globalThis);
}

function weekHours() {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const out = {};
  days.forEach((day) => {
    out[day] = { isOpen: true, openTime: "09:00", closeTime: "18:00" };
  });
  return out;
}

function weekSchedule(enabledDays) {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const allow = new Set(enabledDays || days);
  const out = {};
  days.forEach((day) => {
    out[day] = allow.has(day)
      ? { enabled: true, startTime: "09:00", endTime: "18:00" }
      : { enabled: false, startTime: null, endTime: null };
  });
  return out;
}

function seedAvailabilityWindow() {
  globalThis.settings = {
    preferences: { salonTimeZone: "America/New_York" },
    locationPreferences: {
      [LOC_A]: { salonTimeZone: "America/New_York" },
      [LOC_B]: { salonTimeZone: "America/New_York" },
    },
    locationSchedules: {
      [LOC_A]: { businessHours: weekHours() },
      [LOC_B]: { businessHours: weekHours() },
    },
  };
  const staff = [
    { id: PROV_A, name: "Provider A", defaultSchedule: weekSchedule() },
    { id: PROV_B, name: "Provider B", defaultSchedule: weekSchedule() },
    { id: PROV_OFF, name: "Provider Off", defaultSchedule: weekSchedule(["monday", "tuesday", "wednesday", "thursday", "friday"]) },
  ];
  globalThis.ffGetStaffStore = () => ({ staff });
}

function loadAdmin() {
  const cfgPath = join(process.env.HOME, ".config/configstore/firebase-tools.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "ff-adc-"));
  writeFileSync(join(tmp, "adc.json"), JSON.stringify({
    type: "authorized_user",
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: cfg.tokens.refresh_token,
  }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = join(tmp, "adc.json");
  process.env.GCLOUD_PROJECT = "fair-flow-staging";
  const sdkRequire = createRequire(join(SDK_DIR, "package.json"));
  const admin = sdkRequire("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: "fair-flow-staging",
      credential: admin.credential.applicationDefault(),
    });
  }
  return admin;
}

function writeAdaptedRepo() {
  const src = readFileSync(join(ROOT, "public/booking/appointments/data.js"), "utf8")
    .replace(
      'from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js"',
      'from "firebase/firestore"'
    )
    .replace(
      'import { db } from "/app.js?v=20260610_force_lp_ios";',
      'import { db } from "./bridge.mjs";'
    );
  const dest = join(SDK_DIR, "appointments-data.mjs");
  writeFileSync(dest, src);
  writeFileSync(join(SDK_DIR, "bridge.mjs"), "export let db;\nexport function setDb(next) { db = next; }\n");
  return dest;
}

async function ensureAuthUser(admin, uid, email, password) {
  try {
    await admin.auth().updateUser(uid, { email, password, disabled: false });
  } catch (err) {
    if (err && err.code === "auth/user-not-found") {
      await admin.auth().createUser({ uid, email, password, disabled: false });
      return;
    }
    throw err;
  }
}

async function deleteCollection(adminDb, path) {
  const snap = await adminDb.collection(path).get();
  for (const docSnap of snap.docs) await docSnap.ref.delete();
}

async function cleanup(admin) {
  const db = admin.firestore();
  for (const salonId of [SALON_A, SALON_B]) {
    await deleteCollection(db, `salons/${salonId}/appointments`);
    await deleteCollection(db, `salons/${salonId}/clients`);
    await deleteCollection(db, `salons/${salonId}/services`);
    await deleteCollection(db, `salons/${salonId}/staff`);
    await db.doc(`salons/${salonId}`).delete().catch(() => {});
  }
  await db.doc(`users/${UID_A}`).delete().catch(() => {});
  await db.doc(`users/${UID_B}`).delete().catch(() => {});
}

function record(results, letter, ok, detail) {
  results[letter] = { ok: !!ok, detail: detail || "" };
  console.log(`${ok ? "PASS" : "FAIL"} ${letter}: ${detail || ""}`);
}

async function main() {
  if (!existsSync(join(SDK_DIR, "node_modules/firebase/package.json"))) {
    throw new Error("Install firebase + firebase-admin under /tmp/ff-client-itest-sdk first.");
  }
  globalThis.window = globalThis;
  seedAvailabilityWindow();
  loadWindowScript("public/booking/calendar-time.js");
  loadWindowScript("public/booking/availability.js");
  loadWindowScript("public/booking/clients/model.js");
  loadWindowScript("public/booking/appointments/model.js");
  writeAdaptedRepo();

  const admin = loadAdmin();
  const adminDb = admin.firestore();
  const results = {};
  const { setDb } = await import(pathToFileURL(join(SDK_DIR, "bridge.mjs")).href);

  const emailA = "ff-appt-smoke-a@fair-flow-staging.test";
  const emailB = "ff-appt-smoke-b@fair-flow-staging.test";
  const passA = "FfApptSmoke-A-2026!";
  const passB = "FfApptSmoke-B-2026!";

  try {
    await adminDb.doc(`users/${UID_A}`).set({
      salonId: SALON_A, role: "manager", email: emailA, name: "Appt Smoke A",
    }, { merge: true });
    await adminDb.doc(`users/${UID_B}`).set({
      salonId: SALON_B, role: "manager", email: emailB, name: "Appt Smoke B",
    }, { merge: true });
    await ensureAuthUser(admin, UID_A, emailA, passA);
    await ensureAuthUser(admin, UID_B, emailB, passB);

    const appA = initializeApp(STAGING_APP, "apptA");
    const appB = initializeApp(STAGING_APP, "apptB");
    const authA = getAuth(appA);
    const authB = getAuth(appB);
    const dbA = getFirestore(appA);
    const dbB = getFirestore(appB);
    await signInWithEmailAndPassword(authA, emailA, passA);
    await signInWithEmailAndPassword(authB, emailB, passB);

    setDb(dbA);
    globalThis.currentSalonId = SALON_A;
    globalThis.ffAuth = { currentUser: { uid: UID_A } };
    globalThis.__ff_authedStaffId = "staff-a";

    const repo = await import(pathToFileURL(join(SDK_DIR, "appointments-data.mjs")).href + `?t=${Date.now()}`);
    const model = globalThis.ffBookingAppointmentModel;
    const at = (minutes) => model.civilToDate(DATE_KEY, minutes, LOC_A);

    const clientRef = await addDoc(collection(dbA, `salons/${SALON_A}/clients`), {
      firstName: "Jessica",
      lastName: "Miller",
      phone: "305-555-1212",
      email: "jessica.miller@example.com",
      displayNameNormalized: "jessica miller",
      createdByUid: UID_A,
      createdAtLocationId: LOC_A,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    const gelRef = await addDoc(collection(dbA, `salons/${SALON_A}/services`), {
      name: "Gel Manicure", defaultPrice: 45, durationMinutes: 60, active: true,
    });
    const pediRef = await addDoc(collection(dbA, `salons/${SALON_A}/services`), {
      name: "Pedicure", defaultPrice: 40, durationMinutes: 45, active: true,
    });
    const blockedRef = await addDoc(collection(dbA, `salons/${SALON_A}/services`), {
      name: "Blocked Gel",
      defaultPrice: 45,
      durationMinutes: 60,
      active: true,
      staffOverrides: { [PROV_A]: { enabled: false } },
    });

    let single;
    try {
      single = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_A,
        source: "front_desk",
        assignmentType: "specific_provider",
        notes: "foundation-smoke",
        serviceLines: [{ serviceId: gelRef.id, providerId: PROV_A, startAt: at(10 * 60) }],
      });
      record(results, "A", !!(single.ok && single.created && single.appointment), single.ok ? single.appointment.appointmentId : JSON.stringify(single));
    } catch (err) {
      record(results, "A", false, err.message);
    }

    let multi;
    try {
      multi = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_A,
        source: "front_desk",
        assignmentType: "specific_provider",
        serviceLines: [
          { serviceId: gelRef.id, providerId: PROV_A, startAt: at(13 * 60) },
          { serviceId: pediRef.id, providerId: PROV_B, startAt: at(13 * 60) },
        ],
      });
      record(results, "B", !!(multi.ok && multi.appointment && multi.appointment.serviceLines.length === 2), multi.ok ? `${multi.appointment.serviceLines.length} lines` : JSON.stringify(multi));
    } catch (err) {
      record(results, "B", false, err.message);
    }

    const row = single && single.appointment;
    record(
      results,
      "C",
      !!(row && row.clientId === clientRef.id && row.clientSnapshot && row.clientSnapshot.displayName === "Jessica Miller"),
      row ? `${row.clientId} / ${row.clientSnapshot && row.clientSnapshot.displayName}` : "missing"
    );

    const mrow = multi && multi.appointment;
    const startOk = mrow && model.toDate(mrow.startAt).getTime() === at(13 * 60).getTime();
    const endOk = mrow && model.toDate(mrow.endAt).getTime() === at(14 * 60).getTime();
    record(results, "D", !!(startOk && endOk), mrow ? `start=${model.toDate(mrow.startAt).toISOString()} end=${model.toDate(mrow.endAt).toISOString()}` : "missing multi");

    try {
      const off = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_A,
        serviceLines: [{ serviceId: gelRef.id, providerId: PROV_OFF, startAt: at(10 * 60) }],
      });
      record(results, "E", !off.ok && off.code === "PROVIDER_NOT_WORKING", off.code || JSON.stringify(off));
    } catch (err) {
      record(results, "E", false, err.message);
    }

    try {
      const late = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_A,
        serviceLines: [{ serviceId: gelRef.id, providerId: PROV_A, startAt: at(17 * 60 + 30), durationMinutes: 60 }],
      });
      record(results, "F", !late.ok && late.code === "OUTSIDE_BUSINESS_HOURS", late.code || JSON.stringify(late));
    } catch (err) {
      record(results, "F", false, err.message);
    }

    try {
      const overlap = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_A,
        serviceLines: [{ serviceId: gelRef.id, providerId: PROV_A, startAt: at(10 * 60 + 45) }],
      });
      record(results, "G", !overlap.ok && overlap.code === "APPOINTMENT_CONFLICT", overlap.code || JSON.stringify(overlap));
    } catch (err) {
      record(results, "G", false, err.message);
    }

    let backToBack;
    try {
      backToBack = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_A,
        serviceLines: [{ serviceId: gelRef.id, providerId: PROV_A, startAt: at(11 * 60) }],
      });
      record(results, "H", !!(backToBack.ok && backToBack.created), backToBack.ok ? backToBack.appointment.appointmentId : JSON.stringify(backToBack));
    } catch (err) {
      record(results, "H", false, err.message);
    }

    try {
      if (!backToBack || !backToBack.appointment) throw new Error("back-to-back appointment missing");
      const cancelled = await repo.cancelAppointment(backToBack.appointment.appointmentId, "smoke");
      const again = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_A,
        serviceLines: [{ serviceId: gelRef.id, providerId: PROV_A, startAt: at(11 * 60) }],
      });
      record(results, "I", !!(cancelled.ok && cancelled.appointment.status === "cancelled" && again.ok), again.ok ? again.appointment.appointmentId : JSON.stringify(again));
    } catch (err) {
      record(results, "I", false, err.message);
    }

    try {
      const otherProv = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_A,
        serviceLines: [{ serviceId: pediRef.id, providerId: PROV_B, startAt: at(10 * 60) }],
      });
      record(results, "J", !!(otherProv.ok && otherProv.created), otherProv.ok ? otherProv.appointment.appointmentId : JSON.stringify(otherProv));
    } catch (err) {
      record(results, "J", false, err.message);
    }

    try {
      const otherLoc = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_B,
        serviceLines: [{ serviceId: gelRef.id, providerId: PROV_A, startAt: at(10 * 60) }],
      });
      record(results, "K", !otherLoc.ok && otherLoc.code === "APPOINTMENT_CONFLICT", otherLoc.code || JSON.stringify(otherLoc));
    } catch (err) {
      record(results, "K", false, err.message);
    }

    record(results, "L", !!(mrow && mrow.serviceLines[0].providerId === PROV_A && mrow.serviceLines[1].providerId === PROV_B), mrow ? mrow.serviceLines.map((l) => l.providerId).join(",") : "missing");

    try {
      const badClient = await repo.createAppointment({
        clientId: "missing-client",
        locationId: LOC_A,
        serviceLines: [{ serviceId: gelRef.id, providerId: PROV_A, startAt: at(15 * 60) }],
      });
      record(results, "M", !badClient.ok && badClient.code === "INVALID_CLIENT", badClient.code || JSON.stringify(badClient));
    } catch (err) {
      record(results, "M", false, err.message);
    }

    try {
      const badService = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_A,
        serviceLines: [{ serviceId: "missing-service", providerId: PROV_A, startAt: at(15 * 60) }],
      });
      record(results, "N", !badService.ok && badService.code === "INVALID_SERVICE", badService.code || JSON.stringify(badService));
    } catch (err) {
      record(results, "N", false, err.message);
    }

    try {
      const incapable = await repo.createAppointment({
        clientId: clientRef.id,
        locationId: LOC_A,
        serviceLines: [{ serviceId: blockedRef.id, providerId: PROV_A, startAt: at(15 * 60) }],
      });
      record(results, "O", !incapable.ok && incapable.code === "PROVIDER_INCAPABLE", incapable.code || JSON.stringify(incapable));
    } catch (err) {
      record(results, "O", false, err.message);
    }

    try {
      let isolated = false;
      let detail = "";
      try {
        const sneak = await getDocs(collection(dbB, `salons/${SALON_A}/appointments`));
        isolated = false;
        detail = `user B read ${sneak.size} docs`;
      } catch (err) {
        isolated = /permission-denied|Missing or insufficient permissions/i.test(String(err && err.message || err));
        detail = isolated ? "permission-denied as expected" : String(err && err.message || err);
      }
      record(results, "P", isolated, detail);
    } catch (err) {
      record(results, "P", false, err.message);
    }

    try {
      const sameDay = await repo.getAppointmentsForDate(DATE_KEY, LOC_A);
      const otherDay = await repo.getAppointmentsForDate("2026-08-30", LOC_A);
      const otherLoc = await repo.getAppointmentsForDate(DATE_KEY, LOC_B);
      const range = await repo.getAppointmentsForRange(at(9 * 60), at(18 * 60), LOC_A);
      record(
        results,
        "Q",
        sameDay.length >= 1 && otherDay.length === 0 && otherLoc.length === 0 && range.length === sameDay.length,
        `date=${sameDay.length} otherDay=${otherDay.length} otherLoc=${otherLoc.length} range=${range.length}`
      );
    } catch (err) {
      record(results, "Q", false, err.message);
    }
  } finally {
    await cleanup(admin);
    try { await admin.auth().deleteUser(UID_A); } catch (_) {}
    try { await admin.auth().deleteUser(UID_B); } catch (_) {}
    const leftoverA = await admin.firestore().collection(`salons/${SALON_A}/appointments`).get();
    const leftoverB = await admin.firestore().collection(`salons/${SALON_B}/appointments`).get();
    console.log(JSON.stringify({
      cleanup: { salonAAppointments: leftoverA.size, salonBAppointments: leftoverB.size },
      results,
    }, null, 2));
  }

  const failed = Object.entries(results).filter(([, v]) => !v.ok);
  if (failed.length) {
    console.error("FAILED", failed.map(([k]) => k).join(", "));
    process.exit(1);
  }
  console.log("All appointment staging tests passed. Cleanup done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
