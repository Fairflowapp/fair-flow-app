/**
 * Employee Onboarding Runs — task completion actions + subscriptions.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { db, storage } from "/app.js?v=20260610_force_lp_ios";
import {
  _actionLocks,
  _salonId,
  _uid,
  _trim,
  runsCol,
  tasksCol,
  taskDoc,
} from "./run-cloud-shared.js?v=20260812_od_s5";
import {
  ffOnboardingCall,
  ffOnboardingCallError,
} from "./onboarding-cf.js?v=20260812_od_s5";

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
    await ffOnboardingCall("acknowledgeOnboardingPolicyTask", {
      salonId,
      staffId: sid,
      runId: rid,
      taskId: tid,
      typedName: typedName || "",
    });
    return { ok: true };
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Acknowledge failed"));
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
    await ffOnboardingCall("completeOnboardingTaskFromInboxApprove", {
      salonId: sidSalon,
      staffId: sid,
      runId: rid,
      taskId: tid,
      inboxItemId: inboxItemId || "",
      linkedDocumentId: linkedDocumentId || "",
      approverUid: approverUid || _uid(),
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
    await ffOnboardingCall("rejectOnboardingTaskFromInbox", {
      salonId: sidSalon,
      staffId: sid,
      runId: rid,
      taskId: tid,
      inboxItemId: inboxItemId || "",
      reason: reason || "",
    });
    return true;
  } catch (e) {
    console.warn("[OnboardingRun] reject from inbox failed", e);
    return null;
  } finally {
    _actionLocks.delete(lock);
  }
}

/** Void one completed e-sign task and reopen it for the employee. */
export async function ffReopenOnboardingEsignTask({
  staffId,
  runId,
  taskId,
} = {}) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  const tid = _trim(taskId);
  if (!salonId || !sid || !rid || !tid) throw new Error("Missing ids");
  const lock = `${salonId}::${sid}::${rid}::${tid}::reopen`;
  if (_actionLocks.has(lock)) throw new Error("Already working on this form.");
  _actionLocks.add(lock);
  try {
    return await ffOnboardingCall("reopenOnboardingEsignTask", {
      salonId,
      staffId: sid,
      runId: rid,
      taskId: tid,
    });
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not reopen this form."));
  } finally {
    _actionLocks.delete(lock);
  }
}

function _parseExpTs(raw) {
  const s = _trim(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return null;
}

async function _writeStaffDocFromOnboardingUpload({
  salonId,
  staffId,
  runId,
  taskId,
  task,
  storagePath,
  fileName,
  expirationDate,
  notes,
  documentType,
}) {
  const typeName = String(
    documentType || (task && (task.templateNameSnapshot || task.templateId)) || "Document"
  );
  const templateId = _trim((task && task.templateId) || taskId);
  let documentId = `${taskId}_upload`;
  try {
    const snap = await getDocs(collection(db, `salons/${salonId}/staff/${staffId}/documents`));
    const match = snap.docs.find((d) => {
      const row = d.data() || {};
      return (
        _trim(row.onboardingTemplateId) === templateId &&
        String(row.lifecycleStatus || "").toLowerCase() !== "archived"
      );
    });
    if (match) documentId = match.id;
  } catch (_) {}
  const expTs = _parseExpTs(expirationDate);
  const ref = doc(db, `salons/${salonId}/staff/${staffId}/documents`, documentId);
  const prev = await getDoc(ref);
  const payload = {
    title: typeName,
    type: typeName,
    fileName: fileName || null,
    storagePath,
    approvalStatus: "approved",
    approvedBy: "onboarding_portal",
    approvedAt: serverTimestamp(),
    lifecycleStatus: "active",
    via: "portal_upload",
    onboardingRunId: runId,
    onboardingTaskId: taskId,
    onboardingTemplateId: templateId || null,
    uploadedByUid: _uid() || "onboarding_portal",
    notes: notes || null,
    updatedAt: serverTimestamp(),
  };
  if (expTs) payload.expirationDate = expTs;
  if (!prev.exists()) payload.createdAt = serverTimestamp();
  await setDoc(ref, payload, { merge: true });
  return documentId;
}

/** Convert a leftover waiting_approval upload into a staff document (no Inbox). */
export async function ffPromoteOnboardingWaitingUpload({ staffId, runId, taskId } = {}) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  const tid = _trim(taskId);
  if (!salonId || !sid || !rid || !tid) return null;
  const snap = await getDoc(taskDoc(salonId, sid, rid, tid));
  if (!snap.exists()) return null;
  const task = snap.data() || {};
  if (task.taskType !== "document" && task.taskType !== "file_upload") return null;
  if (String(task.status || "") !== "waiting_approval") return null;
  const res = task.result || {};
  let expirationDate = res.expirationDate || null;
  let notes = null;
  let storagePath = _trim(res.storagePath);
  let fileName = res.fileName || null;
  const inboxId = _trim(res.inboxItemId);
  if (inboxId) {
    try {
      const isnap = await getDoc(doc(db, `salons/${salonId}/inboxItems`, inboxId));
      if (isnap.exists()) {
        const d = (isnap.data() || {}).data || {};
        expirationDate = expirationDate || d.expirationDate || null;
        notes = d.notes || null;
        storagePath = storagePath || _trim(d.storagePath || d.filePath);
        fileName = fileName || d.fileName || null;
      }
    } catch (_) {}
  }
  if (!storagePath) return null;
  const documentId = await _writeStaffDocFromOnboardingUpload({
    salonId,
    staffId: sid,
    runId: rid,
    taskId: tid,
    task,
    storagePath,
    fileName,
    expirationDate,
    notes,
    documentType: task.templateNameSnapshot || task.templateId,
  });
  await ffOnboardingCall("completeOnboardingTaskFromInboxApprove", {
    salonId,
    staffId: sid,
    runId: rid,
    taskId: tid,
    inboxItemId: inboxId,
    linkedDocumentId: documentId,
    approverUid: _uid(),
  });
  if (inboxId) {
    try {
      await updateDoc(doc(db, `salons/${salonId}/inboxItems`, inboxId), {
        status: "archived",
        unreadForManagers: false,
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
      });
    } catch (_) {}
  }
  return documentId;
}

/**
 * Save an onboarding upload to the staff Documents tab. No Inbox approval.
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

    const uid = _uid();
    if (!uid) throw new Error("Not signed in");

    const documentId = await _writeStaffDocFromOnboardingUpload({
      salonId,
      staffId: sid,
      runId: rid,
      taskId: tid,
      task,
      storagePath: path,
      fileName: file.name,
      expirationDate,
      notes,
      documentType,
    });
    await ffOnboardingCall("completeOnboardingTaskFromInboxApprove", {
      salonId,
      staffId: sid,
      runId: rid,
      taskId: tid,
      inboxItemId: "",
      linkedDocumentId: documentId,
      approverUid: uid,
    });

    return { linkedDocumentId: documentId, storagePath: path };
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

