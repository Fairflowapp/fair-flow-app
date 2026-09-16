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

module.exports = {
  NAME_PREFIX,
  listQaComboServices,
  cleanupQaComboServices,
};
