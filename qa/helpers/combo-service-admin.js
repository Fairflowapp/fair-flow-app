"use strict";

const { REPO_ROOT } = require("./env");
const {
  REQUIRED_PROJECT,
  SALON_ID,
  abort,
  openStagingAdmin,
} = require("./staging-admin");

const NAME_PREFIX = "FF-QA-COMBO";
const ACCOUNT_ID = SALON_ID;
const FORBIDDEN_NAMES = new Set(["QA Manicure", "QA Pedicure", "QA Hands"]);

function isOwnedName(name, runId) {
  const text = String(name || "").trim();
  const id = String(runId || "").trim();
  if (!text.startsWith(NAME_PREFIX)) return false;
  if (FORBIDDEN_NAMES.has(text)) return false;
  if (id && text.indexOf(id) === -1) return false;
  return true;
}

async function withAdmin(fn) {
  const { admin, db } = await openStagingAdmin(REPO_ROOT);
  if (admin.app().options.projectId !== REQUIRED_PROJECT) {
    abort("Admin projectId is not fair-flow-staging.");
  }
  return fn(db, admin);
}

async function deleteMatching(db, colPath, runId, extraOk) {
  const snap = await db.collection(colPath).limit(400).get();
  const deleted = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const name = String(data.name || "");
    if (!isOwnedName(name, runId)) continue;
    if (typeof extraOk === "function" && !extraOk(data, docSnap.id)) continue;
    await db.doc(colPath + "/" + docSnap.id).delete();
    deleted.push({ path: colPath + "/" + docSnap.id, name });
  }
  return deleted;
}

async function listMatching(db, colPath, runId) {
  const snap = await db.collection(colPath).limit(400).get();
  const rows = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const name = String(data.name || "");
    if (!isOwnedName(name, runId)) return;
    rows.push({
      id: docSnap.id,
      path: colPath + "/" + docSnap.id,
      name,
      serviceType: data.serviceType || "",
      defaultPrice: data.defaultPrice,
      durationMinutes: data.durationMinutes,
      components: Array.isArray(data.components) ? data.components : [],
    });
  });
  return rows;
}

async function listQaComboServices(runId) {
  return withAdmin(async (db) => {
    const shared = await listMatching(db, "accounts/" + ACCOUNT_ID + "/shared/serviceCatalog/items", runId);
    const local = await listMatching(db, "salons/" + SALON_ID + "/services", runId);
    return { shared, local };
  });
}

async function cleanupQaComboServices(runId) {
  const id = String(runId || "").trim();
  if (!id) abort("cleanupQaComboServices requires a runId.");
  return withAdmin(async (db) => {
    const deleted = [];
    deleted.push(...await deleteMatching(db, "accounts/" + ACCOUNT_ID + "/shared/serviceCatalog/items", id));
    deleted.push(...await deleteMatching(db, "salons/" + SALON_ID + "/services", id));
    deleted.push(...await deleteMatching(db, "accounts/" + ACCOUNT_ID + "/shared/serviceCategories/items", id));
    deleted.push(...await deleteMatching(db, "salons/" + SALON_ID + "/serviceCategories", id));
    return deleted;
  });
}

async function seedQaComboAppointmentCatalog(runId, opts) {
  const id = String(runId || "").trim();
  if (!id) abort("seedQaComboAppointmentCatalog requires a runId.");
  const options = opts || {};
  const locationId = String(options.locationId || "qaLoc1").trim();
  const blockedProviderId = String(options.blockedProviderId || "qaProv2").trim();
  const gelId = "qaComboApptGel_" + id;
  const pediId = "qaComboApptPedi_" + id;
  const comboId = "qaComboAppt_" + id;
  const gelName = "FF-QA-COMBO-APPT-GEL " + id;
  const pediName = "FF-QA-COMBO-APPT-PEDI " + id;
  const name = "FF-QA-COMBO-APPT " + id;
  const now = new Date().toISOString();
  const overrides = {};
  overrides[blockedProviderId] = { enabled: false };
  return withAdmin(async (db) => {
    await db.doc("salons/" + SALON_ID + "/services/" + gelId).set({
      name: gelName,
      serviceType: "single",
      defaultPrice: 55,
      durationMinutes: 45,
      active: true,
      locationId: locationId,
      category: "QA Hands",
      staffOverrides: overrides,
      updatedAt: now
    });
    await db.doc("salons/" + SALON_ID + "/services/" + pediId).set({
      name: pediName,
      serviceType: "single",
      defaultPrice: 45,
      durationMinutes: 30,
      active: true,
      locationId: locationId,
      category: "QA Hands",
      staffOverrides: {},
      updatedAt: now
    });
    await db.doc("salons/" + SALON_ID + "/services/" + comboId).set({
      name: name,
      serviceType: "combo",
      defaultPrice: 84,
      durationMinutes: 75,
      active: true,
      locationId: locationId,
      category: "QA Hands",
      components: [
        { serviceId: gelId, allocatedPrice: 44, sortOrder: 0 },
        { serviceId: pediId, allocatedPrice: 40, sortOrder: 1 }
      ],
      updatedAt: now
    });
    return {
      comboId: comboId,
      name: name,
      gelId: gelId,
      gelName: gelName,
      pediId: pediId,
      pediName: pediName,
      sellingPrice: 84,
      path: "salons/" + SALON_ID + "/services/" + comboId
    };
  });
}

module.exports = {
  NAME_PREFIX,
  listQaComboServices,
  cleanupQaComboServices,
  seedQaComboAppointmentCatalog,
};
