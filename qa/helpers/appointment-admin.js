"use strict";

const path = require("path");
const { REPO_ROOT } = require("./env");
const {
  REQUIRED_PROJECT,
  SALON_ID,
  abort,
  openStagingAdmin,
  assertQaSalonPath,
} = require("./staging-admin");

const QA_NOTE_RE = /^FF-QA-[A-Za-z0-9]+(?:\s|$)/;
const FIXTURE_NOTE = "FF-QA-FIXTURE";
const APPOINTMENTS_PREFIX = "salons/" + SALON_ID + "/appointments/";

function isQaAppointmentNote(notes) {
  const text = String(notes || "").trim();
  if (!text || text === FIXTURE_NOTE) return false;
  return QA_NOTE_RE.test(text);
}

function summarizeAppointment(id, data) {
  const lines = Array.isArray(data && data.serviceLines) ? data.serviceLines : [];
  return {
    appointmentId: id,
    salonId: SALON_ID,
    projectId: REQUIRED_PROJECT,
    clientId: data && data.clientId || "",
    locationId: data && data.locationId || "",
    status: data && data.status || "",
    notes: data && data.notes || "",
    dateKey: data && data.dateKey || "",
    providerIds: Array.isArray(data && data.providerIds) ? data.providerIds : [],
    requested: lines.some((line) => line && line.requested === true),
    serviceLines: lines.map((line) => ({
      lineId: line && line.lineId || "",
      serviceId: line && line.serviceId || "",
      serviceName: line && line.serviceNameSnapshot || "",
      providerId: line && line.providerId || "",
      durationMinutes: line && line.durationMinutes || 0,
      requested: !!(line && line.requested),
      startAt: line && line.startAt && line.startAt.toDate ? line.startAt.toDate().toISOString() : "",
      endAt: line && line.endAt && line.endAt.toDate ? line.endAt.toDate().toISOString() : "",
    })),
    startAt: data && data.startAt && data.startAt.toDate ? data.startAt.toDate().toISOString() : "",
    endAt: data && data.endAt && data.endAt.toDate ? data.endAt.toDate().toISOString() : "",
  };
}

async function withAdmin(fn) {
  const { admin, db } = await openStagingAdmin(REPO_ROOT);
  if (admin.app().options.projectId !== REQUIRED_PROJECT) {
    abort("Admin projectId is not fair-flow-staging.");
  }
  return fn(db, admin);
}

async function listQaAppointments(runId) {
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/appointments").limit(400).get();
    const rows = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (!isQaAppointmentNote(data.notes)) return;
      if (runId && String(data.notes).indexOf(runId) === -1) return;
      rows.push(summarizeAppointment(docSnap.id, data));
    });
    return rows;
  });
}

async function waitForQaAppointmentByNote(note, timeoutMs) {
  const started = Date.now();
  const limit = Number(timeoutMs) || 20000;
  while (Date.now() - started < limit) {
    const rows = await listQaAppointments();
    const hit = rows.find((row) => String(row.notes || "").indexOf(note) !== -1);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  abort("Timed out waiting for QA appointment note " + note);
}

async function getQaAppointment(appointmentId) {
  const id = String(appointmentId || "").trim();
  if (!id) abort("Missing appointmentId.");
  const docPath = APPOINTMENTS_PREFIX + id;
  assertQaSalonPath(docPath);
  return withAdmin(async (db) => {
    const snap = await db.doc(docPath).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (!isQaAppointmentNote(data.notes)) {
      abort("Refusing to inspect a non-QA appointment: " + id);
    }
    if (data.locationId && data.locationId !== "qaLoc1") {
      abort("Appointment location is not qaLoc1.");
    }
    return summarizeAppointment(snap.id, data);
  });
}

async function cleanupQaAppointments(runId) {
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/appointments").limit(400).get();
    const deleted = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      if (!isQaAppointmentNote(data.notes)) continue;
      if (runId && String(data.notes).indexOf(runId) === -1) continue;
      const docPath = APPOINTMENTS_PREFIX + docSnap.id;
      assertQaSalonPath(docPath);
      if (data.locationId && data.locationId !== "qaLoc1") continue;
      await db.doc(docPath).delete();
      deleted.push(docSnap.id);
    }
    return deleted;
  });
}

function makeRunId() {
  return "FF-QA-" + Date.now().toString(36) + path.basename(REPO_ROOT).replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
}

function noteFor(runId, scenario) {
  return String(runId) + " " + String(scenario || "lifecycle");
}

module.exports = {
  SALON_ID,
  QA_NOTE_RE,
  listQaAppointments,
  waitForQaAppointmentByNote,
  getQaAppointment,
  cleanupQaAppointments,
  makeRunId,
  noteFor,
  summarizeAppointment,
  isQaAppointmentNote,
};
