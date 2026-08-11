/**
 * Employee Onboarding Runs — task completion actions + subscriptions.
 */

import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
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
  _txUpdateTask,
} from "./run-cloud-shared.js?v=20260810_od_split_v1";

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

