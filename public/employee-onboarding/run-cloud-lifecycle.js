/**
 * Employee Onboarding Runs — create / activate / cancel / skip / get.
 */

import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import {
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
  _readRunWithProgress,
  _txUpdateTask,
  ffComputeOnboardingRunProgress,
  ffCanManageOnboardingRunsClient,
  ffBuildOnboardingRunSnapshotAsync,
} from "./run-cloud-shared.js?v=20260810_od_split_v1";

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

