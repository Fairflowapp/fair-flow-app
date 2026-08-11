/**
 * Employee Onboarding Runs — runtime cloud layer (Pre-Portal Hardening).
 *
 * salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}
 * salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}/tasks/{taskId}
 *
 * Runs are immutable snapshots of package + templates at create time.
 * Run progress/status are recomputed by Cloud Function onOnboardingTaskWrite.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  onSnapshot,
  runTransaction,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, auth, storage } from "/app.js?v=20260610_force_lp_ios";
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

export async function ffGetOnboardingRuns(staffId) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  if (!salonId || !sid) return [];
  try {
    const snap = await getDocs(runsCol(salonId, sid));
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : Number(a.createdAtMs || 0);
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : Number(b.createdAtMs || 0);
        return tb - ta;
      });
  } catch (e) {
    console.warn("[OnboardingRun] get runs failed", e);
    return [];
  }
}

export async function ffGetOnboardingRunTasks(staffId, runId) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  if (!salonId || !sid || !rid) return [];
  try {
    const snap = await getDocs(tasksCol(salonId, sid, rid));
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  } catch (e) {
    console.warn("[OnboardingRun] get tasks failed", e);
    return [];
  }
}

/**
 * Create a draft run from a package (snapshot). Idempotent against double-click via lock key.
 */
export async function ffCreateOnboardingRunFromPackage({
  staffId,
  packageId,
  dueDate,
  templates,
  categories,
  pkg,
} = {}) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  const pid = _trim(packageId);
  if (!salonId || !sid || !pid) throw new Error("Missing salon, staff, or package");
  if (!ffCanManageOnboardingRunsClient()) throw new Error("Permission denied");

  const lockKey = `${salonId}::${sid}::create::${pid}`;
  if (_createLocks.has(lockKey)) throw new Error("Create already in progress");
  _createLocks.add(lockKey);
  try {
    const packageRow = pkg || null;
    if (!packageRow || packageRow.id !== pid) {
      throw new Error("Package snapshot required");
    }
    const templatesById = {};
    (templates || []).forEach((t) => {
      if (t && t.id) templatesById[t.id] = t;
    });
    const categoriesById = {};
    (categories || []).forEach((c) => {
      if (c && c.id) categoriesById[c.id] = c;
    });

    const taskRows = await ffBuildOnboardingRunSnapshotAsync(
      packageRow,
      templatesById,
      categoriesById,
      salonId
    );
    if (!taskRows.length) {
      throw new Error("Package has no active v1 tasks to assign");
    }

    const { progress, status } = ffComputeOnboardingRunProgress(taskRows, "draft");
    const runRef = doc(runsCol(salonId, sid));
    const runId = runRef.id;
    const uid = _uid();
    const runPayload = _stripUndefined({
      id: runId,
      schemaVersion: 1,
      packageId: pid,
      packageNameSnapshot: String(packageRow.name || pid),
      packageDescriptionSnapshot: String(packageRow.description || ""),
      audienceSnapshot: packageRow.audience || {
        workerClassifications: [],
        technicianTypeIds: [],
      },
      status, // draft
      progress,
      dueDate: dueDate || null,
      createdBy: uid,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      sentAt: null,
      completedAt: null,
      cancelledAt: null,
      updatedAt: serverTimestamp(),
    });

    const batch = writeBatch(db);
    batch.set(runRef, runPayload);
    for (const t of taskRows) {
      batch.set(
        taskDoc(salonId, sid, runId, t.id),
        _stripUndefined({
          ...t,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
    await batch.commit();

    // Freeze library versions that were snapshotted into this run (immutable layout).
    const bindings = taskRows
      .filter((t) => t.taskType === "electronic_signature")
      .map((t) => ({
        documentId:
          t.configSnapshot &&
          (t.configSnapshot.signatureDocumentId || t.configSnapshot.documentId),
        versionId:
          t.configSnapshot &&
          (t.configSnapshot.signatureDocumentVersionId ||
            t.configSnapshot.documentVersionId),
        runId,
      }))
      .filter((b) => b.documentId && b.versionId);
    if (
      bindings.length &&
      typeof window !== "undefined" &&
      typeof window.ffBindOnboardingSignatureDocumentVersions === "function"
    ) {
      try {
        await window.ffBindOnboardingSignatureDocumentVersions(bindings);
      } catch (e) {
        console.warn("[OnboardingRun] bind e-sign versions failed", e);
      }
    }

    return { runId, run: { ...runPayload, id: runId }, tasks: taskRows };
  } finally {
    _createLocks.delete(lockKey);
  }
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

export async function ffActivateOnboardingRun(staffId, runId) {
  if (!ffCanManageOnboardingRunsClient()) throw new Error("Permission denied");
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  const rref = runDoc(salonId, sid, rid);
  const snap = await getDoc(rref);
  if (!snap.exists()) throw new Error("Run not found");
  const run = snap.data() || {};
  if (run.status === "cancelled" || run.status === "completed") {
    return { ...run, id: rid };
  }
  if (run.status === "draft") {
    await updateDoc(rref, {
      status: "sent",
      sentAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  return _readRunWithProgress(salonId, sid, rid);
}

export async function ffCancelOnboardingRun(staffId, runId) {
  if (!ffCanManageOnboardingRunsClient()) throw new Error("Permission denied");
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  const rref = runDoc(salonId, sid, rid);
  const snap = await getDoc(rref);
  if (!snap.exists()) throw new Error("Run not found");
  const run = snap.data() || {};
  if (run.status === "completed" || run.status === "cancelled") {
    return { ...run, id: rid };
  }
  await updateDoc(rref, {
    status: "cancelled",
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { ...run, id: rid, status: "cancelled" };
}

export async function ffSkipOnboardingTask(staffId, runId, taskId) {
  if (!ffCanManageOnboardingRunsClient()) throw new Error("Permission denied");
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  const tid = _trim(taskId);
  const lock = `${salonId}::${sid}::${rid}::${tid}::skip`;
  if (_actionLocks.has(lock)) return null;
  _actionLocks.add(lock);
  try {
    return await _txUpdateTask(salonId, sid, rid, tid, (task) => {
      if (task.required !== false) throw new Error("Cannot skip a required task");
      if (task.status === "skipped" || task.status === "completed") return null;
      return {
        status: "skipped",
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        completedBy: _uid(),
      };
    });
  } finally {
    _actionLocks.delete(lock);
  }
}

/**
 * Policy acknowledgement completion (employee or manager). Idempotent.
 * Progress is applied by onOnboardingTaskWrite (server).
 */
export async function ffAcknowledgeOnboardingPolicyTask({
  staffId,
  runId,
  taskId,
  typedName,
} = {}) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  const tid = _trim(taskId);
  if (!salonId || !sid || !rid || !tid) throw new Error("Missing ids");

  const lock = `${salonId}::${sid}::${rid}::${tid}::ack`;
  if (_actionLocks.has(lock)) return null;
  _actionLocks.add(lock);
  try {
    return await _txUpdateTask(salonId, sid, rid, tid, (task) => {
      if (task.taskType !== "policy_acknowledgement") {
        throw new Error("Not a policy acknowledgement task");
      }
      if (task.status === "completed") return null;
      const cfg = task.configSnapshot || {};
      if (cfg.requireTypedName && !_trim(typedName)) {
        throw new Error("Full name is required");
      }
      const uid = _uid();
      return {
        status: "completed",
        result: {
          acknowledgedAt: Timestamp.now(),
          acknowledgedByUid: uid,
          acknowledgedByName: cfg.requireTypedName ? _trim(typedName) : null,
          policyVersion: String(cfg.version || "1.0"),
        },
        completedAt: serverTimestamp(),
        completedBy: uid,
        updatedAt: serverTimestamp(),
      };
    });
  } finally {
    _actionLocks.delete(lock);
  }
}

/**
 * After Inbox approve — mark task completed + link document. Idempotent.
 */
export async function ffCompleteOnboardingTaskFromInboxApprove({
  salonId,
  staffId,
  runId,
  taskId,
  inboxItemId,
  linkedDocumentId,
  approverUid,
} = {}) {
  const sidSalon = _trim(salonId) || _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  const tid = _trim(taskId);
  if (!sidSalon || !sid || !rid || !tid) return null;

  const lock = `${sidSalon}::${sid}::${rid}::${tid}::approve`;
  if (_actionLocks.has(lock)) return null;
  _actionLocks.add(lock);
  try {
    await _txUpdateTask(sidSalon, sid, rid, tid, (task) => {
      const prev = task.result || {};
      if (
        task.status === "completed" &&
        prev.linkedDocumentId &&
        linkedDocumentId &&
        prev.linkedDocumentId === linkedDocumentId
      ) {
        return null;
      }
      return {
        status: "completed",
        result: {
          ...prev,
          linkedDocumentId: linkedDocumentId || prev.linkedDocumentId || null,
          inboxItemId: inboxItemId || prev.inboxItemId || null,
          approvedAt: Timestamp.now(),
          approvedBy: approverUid || _uid(),
          rejectedAt: null,
          rejectionReason: null,
        },
        completedAt: serverTimestamp(),
        completedBy: approverUid || _uid(),
        updatedAt: serverTimestamp(),
      };
    });
    return true;
  } catch (e) {
    console.warn("[OnboardingRun] complete from inbox approve failed", e);
    return null;
  } finally {
    _actionLocks.delete(lock);
  }
}

/**
 * After Inbox reject — mark task rejected. Idempotent.
 */
export async function ffRejectOnboardingTaskFromInbox({
  salonId,
  staffId,
  runId,
  taskId,
  inboxItemId,
  reason,
} = {}) {
  const sidSalon = _trim(salonId) || _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  const tid = _trim(taskId);
  if (!sidSalon || !sid || !rid || !tid) return null;
  const lock = `${sidSalon}::${sid}::${rid}::${tid}::reject`;
  if (_actionLocks.has(lock)) return null;
  _actionLocks.add(lock);
  try {
    await _txUpdateTask(sidSalon, sid, rid, tid, (task) => {
      if (task.status === "completed") return null;
      const prev = task.result || {};
      return {
        status: "rejected",
        result: {
          ...prev,
          inboxItemId: inboxItemId || prev.inboxItemId || null,
          rejectedAt: Timestamp.now(),
          rejectionReason: reason || null,
        },
        updatedAt: serverTimestamp(),
      };
    });
    return true;
  } catch (e) {
    console.warn("[OnboardingRun] reject from inbox failed", e);
    return null;
  } finally {
    _actionLocks.delete(lock);
  }
}

/**
 * Create document_upload inbox item for an onboarding task (same path as Inbox submit).
 */
export async function ffSubmitOnboardingDocumentUpload({
  staffId,
  runId,
  taskId,
  file,
  expirationDate,
  notes,
} = {}) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  const tid = _trim(taskId);
  if (!salonId || !sid || !rid || !tid) throw new Error("Missing ids");
  if (!file) throw new Error("File is required");

  const lock = `${salonId}::${sid}::${rid}::${tid}::upload`;
  if (_actionLocks.has(lock)) throw new Error("Upload already in progress");
  _actionLocks.add(lock);
  try {
    const tref = taskDoc(salonId, sid, rid, tid);
    const snap = await getDoc(tref);
    if (!snap.exists()) throw new Error("Task not found");
    const task = snap.data() || {};
    if (task.taskType !== "document" && task.taskType !== "file_upload") {
      throw new Error("Not an upload task");
    }
    if (task.status === "completed") {
      throw new Error("Task already completed");
    }

    const cfg = task.configSnapshot || {};
    const maxMb = Number(cfg.maxSizeMb) || 10;
    if (file.size > maxMb * 1024 * 1024) {
      throw new Error(`File must be under ${maxMb} MB`);
    }

    const documentType = String(task.templateNameSnapshot || task.templateId || "Other");
    const yyyyMm = new Date().toISOString().slice(0, 7);
    const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const safeName = (file.name || "file").replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 80);
    const path = `salons/${salonId}/staff/${sid}/documents/${documentType}/${yyyyMm}/${fileId}_${safeName}`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file);
    const fileUrl = await getDownloadURL(fileRef);

    const uid = _uid();
    if (!uid) throw new Error("Not signed in");
    const profile =
      (typeof window !== "undefined" && window.inboxState && window.inboxState.currentUserProfile) ||
      {};
    let creatorStaffId = _trim(profile.staffId);
    if (!creatorStaffId) {
      try {
        creatorStaffId = _trim(
          (typeof localStorage !== "undefined" &&
            localStorage.getItem("ff_authedStaffId_v1")) ||
            ""
        );
      } catch (_) {}
    }
    if (!creatorStaffId) creatorStaffId = sid; // manager acting on behalf — still a string for rules
    const creatorName = String(
      profile.name || profile.displayName || "User"
    ).trim();
    const creatorRole = String(profile.role || "technician").trim();
    let locId = null;
    try {
      if (typeof window.ffGetActiveLocationId === "function") {
        const v = window.ffGetActiveLocationId();
        if (typeof v === "string" && v.trim()) locId = v.trim();
      }
    } catch (_) {}

    const data = {
      documentType,
      expirationDate: expirationDate || null,
      filePath: path,
      fileUrl,
      fileName: file.name,
      notes: notes || null,
      documentOwnerStaffId: sid,
      onboardingRunId: rid,
      onboardingTaskId: tid,
      templateId: task.templateId || tid,
      taskType: task.taskType,
    };

    // Match inbox-submit.js create shape (rules lock visibility / identity fields).
    const inboxPayload = {
      tenantId: salonId,
      locationId: locId,
      type: "document_upload",
      status: "open",
      priority: "normal",
      assignedTo: null,
      sentToStaffIds: [],
      sentToNames: [],
      data,
      managerNotes: null,
      responseNote: null,
      decidedBy: null,
      decidedAt: null,
      needsInfoQuestion: null,
      staffReply: null,
      visibility: "managers_only",
      unreadForManagers: true,
      documentOwnerStaffId: sid,
      createdByUid: uid,
      createdByStaffId: creatorStaffId,
      createdByName: creatorName,
      createdByRole: creatorRole,
      forUid: uid,
      forStaffId: creatorStaffId,
      forStaffName: creatorName,
      createdAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      updatedAt: null,
    };

    const iref = doc(collection(db, `salons/${salonId}/inboxItems`));
    await setDoc(iref, inboxPayload);

    // Mark waiting_approval (idempotent if already). Progress → CF.
    if (task.status !== "waiting_approval") {
      await updateDoc(tref, {
        status: "waiting_approval",
        result: {
          ...(task.result || {}),
          inboxItemId: iref.id,
          fileName: file.name,
          storagePath: path,
        },
        updatedAt: serverTimestamp(),
      });
    }

    return { inboxItemId: iref.id, storagePath: path };
  } finally {
    _actionLocks.delete(lock);
  }
}

export function ffSubscribeOnboardingRuns(staffId, onChange) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  if (!salonId || !sid || typeof onChange !== "function") return () => {};
  return onSnapshot(
    runsCol(salonId, sid),
    (snap) => {
      const runs = snap.docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
      onChange(runs);
    },
    (err) => console.warn("[OnboardingRun] subscribe runs", err)
  );
}

export function ffSubscribeOnboardingRunTasks(staffId, runId, onChange) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  if (!salonId || !sid || !rid || typeof onChange !== "function") return () => {};
  return onSnapshot(
    tasksCol(salonId, sid, rid),
    (snap) => {
      const tasks = snap.docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      onChange(tasks);
    },
    (err) => console.warn("[OnboardingRun] subscribe tasks", err)
  );
}

if (typeof window !== "undefined") {
  window.ffComputeOnboardingRunProgress = ffComputeOnboardingRunProgress;
  window.ffCanManageOnboardingRunsClient = ffCanManageOnboardingRunsClient;
  window.ffBuildOnboardingRunSnapshot = ffBuildOnboardingRunSnapshot;
  window.ffBuildOnboardingRunSnapshotAsync = ffBuildOnboardingRunSnapshotAsync;
  window.ffGetOnboardingRuns = ffGetOnboardingRuns;
  window.ffGetOnboardingRunTasks = ffGetOnboardingRunTasks;
  window.ffCreateOnboardingRunFromPackage = ffCreateOnboardingRunFromPackage;
  window.ffActivateOnboardingRun = ffActivateOnboardingRun;
  window.ffCancelOnboardingRun = ffCancelOnboardingRun;
  window.ffSkipOnboardingTask = ffSkipOnboardingTask;
  window.ffAcknowledgeOnboardingPolicyTask = ffAcknowledgeOnboardingPolicyTask;
  window.ffCompleteOnboardingTaskFromInboxApprove = ffCompleteOnboardingTaskFromInboxApprove;
  window.ffRejectOnboardingTaskFromInbox = ffRejectOnboardingTaskFromInbox;
  window.ffSubmitOnboardingDocumentUpload = ffSubmitOnboardingDocumentUpload;
  window.ffSubscribeOnboardingRuns = ffSubscribeOnboardingRuns;
  window.ffSubscribeOnboardingRunTasks = ffSubscribeOnboardingRunTasks;
}
