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

const FIXTURE_CLIENT_ID = "qaAppointmentClient";
const FIXTURE_NOTE = "FF-QA-FIXTURE";
const QA_CLIENT_NOTE_RE = /^FF-QA-CLIENT-/;
const CLIENTS_PREFIX = "salons/" + SALON_ID + "/clients/";

function isQaLifecycleNote(notes) {
  const text = String(notes || "").trim();
  if (!text || text === FIXTURE_NOTE) return false;
  return QA_CLIENT_NOTE_RE.test(text);
}

function summarizeClient(id, data) {
  return {
    clientId: id,
    salonId: SALON_ID,
    projectId: REQUIRED_PROJECT,
    firstName: data && data.firstName || "",
    lastName: data && data.lastName || "",
    phone: data && data.phone || "",
    email: data && data.email || "",
    notes: data && data.notes || "",
    firstNameNormalized: data && data.firstNameNormalized || "",
    lastNameNormalized: data && data.lastNameNormalized || "",
    displayNameNormalized: data && data.displayNameNormalized || "",
    emailNormalized: data && data.emailNormalized || "",
    phoneDigits: data && data.phoneDigits || "",
    createdAtLocationId: data && data.createdAtLocationId || "",
  };
}

async function withAdmin(fn) {
  const { admin, db } = await openStagingAdmin(REPO_ROOT);
  if (admin.app().options.projectId !== REQUIRED_PROJECT) {
    abort("Admin projectId is not fair-flow-staging.");
  }
  return fn(db, admin);
}

async function getClientById(clientId, options) {
  const id = String(clientId || "").trim();
  if (!id) abort("Missing clientId.");
  const allowFixture = !!(options && options.allowFixture);
  const docPath = CLIENTS_PREFIX + id;
  assertQaSalonPath(docPath);
  if (id === FIXTURE_CLIENT_ID && !allowFixture) {
    abort("Refusing to treat qaAppointmentClient as a lifecycle-created client.");
  }
  return withAdmin(async (db) => {
    const snap = await db.doc(docPath).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (id === FIXTURE_CLIENT_ID && allowFixture) {
      return summarizeClient(snap.id, data);
    }
    if (!isQaLifecycleNote(data.notes)) {
      abort("Refusing to inspect a non-QA client: " + id);
    }
    return summarizeClient(snap.id, data);
  });
}

async function listQaLifecycleClients() {
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/clients").limit(400).get();
    const rows = [];
    snap.forEach((docSnap) => {
      if (docSnap.id === FIXTURE_CLIENT_ID) return;
      const data = docSnap.data() || {};
      if (!isQaLifecycleNote(data.notes)) return;
      rows.push(summarizeClient(docSnap.id, data));
    });
    return rows;
  });
}

async function waitForQaClientByNote(note, timeoutMs) {
  const started = Date.now();
  const limit = Number(timeoutMs) || 20000;
  while (Date.now() - started < limit) {
    const rows = await listQaLifecycleClients();
    const hit = rows.find((row) => String(row.notes || "").indexOf(note) !== -1);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  abort("Timed out waiting for QA client note " + note);
}

async function cleanupQaClients() {
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/clients").limit(400).get();
    const deleted = [];
    for (const docSnap of snap.docs) {
      if (docSnap.id === FIXTURE_CLIENT_ID) continue;
      const data = docSnap.data() || {};
      if (String(data.notes || "").trim() === FIXTURE_NOTE) continue;
      if (!isQaLifecycleNote(data.notes)) continue;
      const docPath = CLIENTS_PREFIX + docSnap.id;
      assertQaSalonPath(docPath);
      await db.doc(docPath).delete();
      deleted.push(docSnap.id);
    }
    return deleted;
  });
}

function makeRunId() {
  return Date.now().toString(36) + path.basename(REPO_ROOT).replace(/[^A-Za-z0-9]/g, "").slice(0, 6);
}

function noteFor(runId, scenario) {
  return "FF-QA-CLIENT-" + String(runId || "") + " " + String(scenario || "client");
}

module.exports = {
  SALON_ID,
  FIXTURE_CLIENT_ID,
  FIXTURE_NOTE,
  QA_CLIENT_NOTE_RE,
  getClientById,
  listQaLifecycleClients,
  waitForQaClientByNote,
  cleanupQaClients,
  makeRunId,
  noteFor,
  summarizeClient,
  isQaLifecycleNote,
};
