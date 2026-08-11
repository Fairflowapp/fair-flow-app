/**
 * Employee Onboarding Runs — shared helpers (paths, locks, progress, snapshots).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  ffNormalizeOnboardingTaskConfig,
  ffValidateOnboardingTaskConfig,
  ffValidateOnboardingEsignFieldSchema,
  ffOnboardingV1TaskTypes,
  ffOnboardingEsignAllowsInternalSign,
} from "./task-registry.js?v=20260809_esign_e2";

const V1_TYPES = new Set(ffOnboardingV1TaskTypes());
const _createLocks = new Set();
const _actionLocks = new Set();

function _salonId() {
  try {
    return String((typeof window !== "undefined" && window.currentSalonId) || "").trim() || null;
  } catch (_) {
    return null;
  }
}

function _uid() {
  try {
    return auth?.currentUser?.uid ? String(auth.currentUser.uid) : null;
  } catch (_) {
    return null;
  }
}

function _trim(v) {
  return String(v == null ? "" : v).trim();
}

function _stripUndefined(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

function runsCol(salonId, staffId) {
  return collection(db, `salons/${salonId}/staff/${staffId}/onboardingRuns`);
}
function runDoc(salonId, staffId, runId) {
  return doc(db, `salons/${salonId}/staff/${staffId}/onboardingRuns`, runId);
}
function tasksCol(salonId, staffId, runId) {
  return collection(db, `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks`);
}
function taskDoc(salonId, staffId, runId, taskId) {
  return doc(db, `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks`, taskId);
}

/** Compute progress + derived run status from task list. */
export function ffComputeOnboardingRunProgress(tasks, currentStatus) {
  const list = Array.isArray(tasks) ? tasks : [];
  const required = list.filter((t) => t && t.required !== false);
  const requiredCompleted = required.filter((t) => t.status === "completed").length;
  const completed = list.filter((t) => t && t.status === "completed").length;
  const missing = required.filter((t) => t.status !== "completed").length;
  const progress = {
    total: list.length,
    requiredTotal: required.length,
    completed,
    requiredCompleted,
    missing,
  };
  let status = currentStatus || "draft";
  if (status !== "cancelled") {
    if (required.length > 0 && missing === 0) {
      status = "completed";
    } else if (
      list.some((t) =>
        ["in_progress", "waiting_approval", "completed", "rejected", "skipped"].includes(t.status)
      )
    ) {
      if (status === "draft" || status === "sent") status = "in_progress";
    }
  }
  return { progress, status };
}

export function ffCanManageOnboardingRunsClient() {
  try {
    const role = String(
      (typeof window !== "undefined" && window.__ff_user_role) || ""
    ).toLowerCase();
    if (role === "manager" || role === "admin" || role === "owner") return true;
    if (typeof window.ffIsOwner === "function" && window.ffIsOwner() === true) return true;
    const store =
      typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : null;
    const list = store && Array.isArray(store.staff) ? store.staff : [];
    const sid = String(
      (typeof window !== "undefined" && window.__ff_authedStaffId) ||
        (typeof localStorage !== "undefined"
          ? localStorage.getItem("ff_authedStaffId_v1")
          : "") ||
        ""
    ).trim();
    if (sid) {
      const me = list.find((s) => String((s && (s.id || s.staffId)) || "") === sid);
      if (me && (me.isManager === true || me.isAdmin === true)) return true;
      const r = String((me && me.role) || "").toLowerCase();
      if (r === "manager" || r === "admin" || r === "owner") return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Enrich electronic_signature config from the library version at Run create time.
 * Snapshot is frozen on the task — later template/layout edits do not affect it.
 */
async function _enrichEsignConfigSnapshot(salonId, configSnapshot, taskLabel) {
  let cfg = ffNormalizeOnboardingTaskConfig("electronic_signature", configSnapshot || {});
  if (!ffOnboardingEsignAllowsInternalSign(cfg)) {
    throw new Error(
      `E-sign task "${taskLabel}" is regulated and cannot use generic e-sign`
    );
  }
  const documentId = _trim(cfg.signatureDocumentId || cfg.documentId);
  const versionId = _trim(
    cfg.signatureDocumentVersionId || cfg.documentVersionId
  );
  if (!documentId || !versionId) {
    throw new Error(
      `E-sign task "${taskLabel}" must link a Signature Library document + version`
    );
  }

  const dref = doc(db, `salons/${salonId}/onboardingSignatureDocuments`, documentId);
  const vref = doc(
    db,
    `salons/${salonId}/onboardingSignatureDocuments/${documentId}/versions`,
    versionId
  );
  const [dsnap, vsnap] = await Promise.all([getDoc(dref), getDoc(vref)]);
  if (!dsnap.exists()) {
    throw new Error(`E-sign task "${taskLabel}": signature document not found`);
  }
  if (!vsnap.exists()) {
    throw new Error(`E-sign task "${taskLabel}": signature version not found`);
  }
  const docRow = dsnap.data() || {};
  const ver = vsnap.data() || {};
  if (String(docRow.complianceTier || "standard") !== "standard") {
    throw new Error(
      `E-sign task "${taskLabel}": regulated documents are blocked`
    );
  }
  if (ver.status !== "ready" || !ver.sha256) {
    throw new Error(
      `E-sign task "${taskLabel}": signature version is not ready`
    );
  }
  const fieldSchema = Array.isArray(ver.fieldSchema) ? ver.fieldSchema.slice() : [];
  const fs = ffValidateOnboardingEsignFieldSchema(fieldSchema, {
    pageCount: ver.pageCount,
    requireSignature: cfg.requireDrawnSignature === true,
  });
  if (!fs.ok) {
    throw new Error(
      `E-sign task "${taskLabel}": ${fs.errors.join("; ")}`
    );
  }

  cfg = ffNormalizeOnboardingTaskConfig("electronic_signature", {
    ...cfg,
    signatureDocumentId: documentId,
    signatureDocumentVersionId: versionId,
    documentId,
    documentVersionId: versionId,
    documentVersion:
      ver.documentVersion != null ? ver.documentVersion : versionId,
    documentSha256: String(ver.sha256 || ""),
    documentTitle: String(docRow.title || documentId),
    pageCount: Number(ver.pageCount) || null,
    fieldSchema,
    complianceTier: "standard",
    allowInternalEsign: true,
  });

  const validation = ffValidateOnboardingTaskConfig("electronic_signature", cfg);
  if (!validation.ok) {
    throw new Error(
      `E-sign task "${taskLabel}": ${validation.errors.join("; ")}`
    );
  }
  return cfg;
}

/**
 * Build snapshot task rows from a package + live templates/categories (at create time).
 * Sync helper — for e-sign packages prefer ffBuildOnboardingRunSnapshotAsync.
 */
export function ffBuildOnboardingRunSnapshot(pkg, templatesById, categoriesById) {
  const items = Array.isArray(pkg && pkg.items) ? pkg.items.slice() : [];
  items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const tasks = [];
  for (const it of items) {
    const templateId = _trim(it && it.templateId);
    if (!templateId) continue;
    const tmpl = templatesById[templateId];
    if (!tmpl || tmpl.active === false) continue;
    const taskType = _trim(tmpl.taskType);
    if (!V1_TYPES.has(taskType)) continue;
    const configOverrides =
      it.configOverrides && typeof it.configOverrides === "object"
        ? it.configOverrides
        : {};
    const configSnapshot = ffNormalizeOnboardingTaskConfig(taskType, {
      ...(tmpl.config || {}),
      ...configOverrides,
    });
    if (taskType === "electronic_signature") {
      const validation = ffValidateOnboardingTaskConfig(
        "electronic_signature",
        configSnapshot
      );
      if (!validation.ok) {
        throw new Error(
          `E-sign task "${tmpl.name || templateId}": ${validation.errors.join("; ")}`
        );
      }
      if (!ffOnboardingEsignAllowsInternalSign(configSnapshot)) {
        throw new Error(
          `E-sign task "${tmpl.name || templateId}" is regulated and cannot use generic e-sign`
        );
      }
    }
    const categoryId = tmpl.categoryId ? String(tmpl.categoryId) : null;
    const cat = categoryId && categoriesById[categoryId] ? categoriesById[categoryId] : null;
    tasks.push({
      id: templateId, // stable id → prevents duplicate tasks
      templateId,
      templateNameSnapshot: String(tmpl.name || templateId),
      taskType,
      categoryId,
      categoryNameSnapshot: cat ? String(cat.name || "") : "",
      required: it.required === false ? false : tmpl.defaultRequired !== false,
      sortOrder: Number.isFinite(Number(it.sortOrder)) ? Number(it.sortOrder) : tasks.length,
      status: "pending",
      configSnapshot,
      result: {},
      completedAt: null,
      completedBy: null,
    });
  }
  return tasks;
}

/** Async snapshot builder — loads library version hash/fields into e-sign configSnapshot. */
export async function ffBuildOnboardingRunSnapshotAsync(
  pkg,
  templatesById,
  categoriesById,
  salonId
) {
  const sid = _trim(salonId) || _salonId();
  if (!sid) throw new Error("Missing salon");
  const tasks = ffBuildOnboardingRunSnapshot(pkg, templatesById, categoriesById);
  for (const t of tasks) {
    if (t.taskType !== "electronic_signature") continue;
    t.configSnapshot = await _enrichEsignConfigSnapshot(
      sid,
      t.configSnapshot,
      t.templateNameSnapshot || t.templateId
    );
  }
  return tasks;
}

async function _loadTasks(salonId, staffId, runId) {
  const snap = await getDocs(tasksCol(salonId, staffId, runId));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

/** Read-only progress helper for UI. Authoritative writes are Cloud Function. */
async function _readRunWithProgress(salonId, staffId, runId) {
  const rref = runDoc(salonId, staffId, runId);
  const rsnap = await getDoc(rref);
  if (!rsnap.exists()) return null;
  const run = { ...rsnap.data(), id: rsnap.id };
  const tasks = await _loadTasks(salonId, staffId, runId);
  const { progress, status } = ffComputeOnboardingRunProgress(tasks, run.status);
  return { ...run, progress: run.progress || progress, status: run.status || status, tasks };
}

async function _txUpdateTask(salonId, staffId, runId, taskId, mutator) {
  const tref = taskDoc(salonId, staffId, runId, taskId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(tref);
    if (!snap.exists()) throw new Error("Task not found");
    const task = { ...snap.data(), id: snap.id };
    const patch = mutator(task);
    if (!patch) return;
    tx.update(tref, patch);
  });
  return _readRunWithProgress(salonId, staffId, runId);
}


export {
  V1_TYPES,
  _createLocks,
  _actionLocks,
  _salonId,
  _uid,
  _trim,
  _stripUndefined,
  runsCol,
  runDoc,
  tasksCol,
  taskDoc,
  _enrichEsignConfigSnapshot,
  _loadTasks,
  _readRunWithProgress,
  _txUpdateTask,
};
