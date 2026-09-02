/**
 * Portal document uploads go straight to the staff Documents tab.
 * No Inbox approval item and no broadcast to every manager.
 * Expiry reminders stay on the existing 30-day Inbox job.
 */

const { admin, HttpsError, db, trimStr } = require("./onboarding-portal-shared");

function parseExpirationTs(raw) {
  const s = trimStr(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) {
      return admin.firestore.Timestamp.fromDate(d);
    }
  }
  if (raw && typeof raw.toDate === "function") return raw;
  return null;
}

function lifecycleFromExpiration(ts) {
  if (!ts) return "active";
  const exp = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  if (Number.isNaN(exp.getTime())) return "active";
  const expDay = Date.UTC(exp.getUTCFullYear(), exp.getUTCMonth(), exp.getUTCDate());
  const now = new Date();
  const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diff = Math.round((expDay - todayDay) / 86400000);
  if (diff < 0) return "expired";
  if (diff <= 30) return "expiring_soon";
  return "active";
}

async function findReusableStaffDocumentId(salonId, staffId, templateId, documentType) {
  const snap = await db()
    .collection(`salons/${salonId}/staff/${staffId}/documents`)
    .get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const tid = trimStr(templateId);
  if (tid) {
    const byT = rows.filter(
      (r) =>
        trimStr(r.onboardingTemplateId) === tid &&
        String(r.lifecycleStatus || "").toLowerCase() !== "archived"
    );
    if (byT.length) return byT[0].id;
  }
  const dtype = trimStr(documentType);
  if (dtype) {
    const urgent = rows.find((r) => {
      if (trimStr(r.type) !== dtype) return false;
      if (String(r.lifecycleStatus || "").toLowerCase() === "archived") return false;
      const life = lifecycleFromExpiration(r.expirationDate);
      return life === "expired" || life === "expiring_soon";
    });
    if (urgent) return urgent.id;
  }
  return null;
}

async function archivePortalInboxItem(salonId, inboxItemId) {
  const iid = trimStr(inboxItemId);
  if (!iid) return;
  try {
    await db()
      .doc(`salons/${salonId}/inboxItems/${iid}`)
      .set(
        {
          status: "archived",
          unreadForManagers: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  } catch (_) {}
}

async function readInboxUploadMeta(salonId, inboxItemId) {
  const iid = trimStr(inboxItemId);
  if (!iid) return {};
  try {
    const snap = await db().doc(`salons/${salonId}/inboxItems/${iid}`).get();
    if (!snap.exists) return {};
    const row = snap.data() || {};
    const d = row.data || {};
    return {
      expirationDate: d.expirationDate || null,
      notes: d.notes || null,
      fileName: d.fileName || null,
      storagePath: d.storagePath || d.filePath || null,
      documentType: d.documentType || null,
    };
  } catch (_) {
    return {};
  }
}

async function writeStaffDocumentFromPortalUpload({
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
    documentType ||
      (task && (task.templateNameSnapshot || task.templateId)) ||
      "Document"
  ).replace(/[^a-zA-Z0-9._ -]/g, "_");
  const templateId = trimStr((task && task.templateId) || taskId);
  const reused = await findReusableStaffDocumentId(
    salonId,
    staffId,
    templateId,
    typeName
  );
  const documentId = reused || `${taskId}_upload`;
  const expTs = parseExpirationTs(expirationDate);
  const ref = db().doc(`salons/${salonId}/staff/${staffId}/documents/${documentId}`);
  const prev = await ref.get();
  const payload = {
    title: typeName,
    type: typeName,
    fileName: fileName || null,
    storagePath,
    approvalStatus: "approved",
    approvedBy: "onboarding_portal",
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    lifecycleStatus: lifecycleFromExpiration(expTs),
    via: "portal_upload",
    viaOnboardingArtifacts: true,
    onboardingRunId: runId,
    onboardingTaskId: taskId,
    onboardingTemplateId: templateId || null,
    uploadedByUid: "onboarding_portal",
    notes: notes || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (expTs) payload.expirationDate = expTs;
  if (prev.exists) {
    payload.thirtyDayReminderSentAt = admin.firestore.FieldValue.delete();
    payload.expiredReminderSentAt = admin.firestore.FieldValue.delete();
  } else {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await ref.set(payload, { merge: true });
  return documentId;
}

async function completePortalUploadTask({
  salonId,
  staffId,
  runId,
  taskId,
  linkedDocumentId,
  fileName,
  storagePath,
  expirationDate,
}) {
  const taskRef = db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks/${taskId}`
  );
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
    const cur = snap.data() || {};
    if (cur.status === "completed" && cur.result && cur.result.linkedDocumentId) {
      return;
    }
    tx.set(
      taskRef,
      {
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedBy: "onboarding_portal",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        result: {
          ...(cur.result || {}),
          linkedDocumentId,
          fileName: fileName || (cur.result && cur.result.fileName) || null,
          storagePath: storagePath || (cur.result && cur.result.storagePath) || null,
          expirationDate: expirationDate || (cur.result && cur.result.expirationDate) || null,
          approvedAt: admin.firestore.Timestamp.now(),
          approvedBy: "onboarding_portal",
          rejectedAt: null,
          rejectionReason: null,
        },
      },
      { merge: true }
    );
  });
}

/**
 * Save a portal upload as a staff document and complete the task.
 * Archives any leftover approval Inbox row.
 */
async function finalizePortalUploadAsStaffDoc({
  salonId,
  staffId,
  runId,
  taskId,
  task,
  storagePath,
  fileName,
  expirationDate,
  notes,
  inboxItemId,
  documentType,
}) {
  const path = trimStr(storagePath);
  if (!path) throw new HttpsError("failed-precondition", "File is missing.");
  const documentId = await writeStaffDocumentFromPortalUpload({
    salonId,
    staffId,
    runId,
    taskId,
    task,
    storagePath: path,
    fileName,
    expirationDate,
    notes,
    documentType,
  });
  await completePortalUploadTask({
    salonId,
    staffId,
    runId,
    taskId,
    linkedDocumentId: documentId,
    fileName,
    storagePath: path,
    expirationDate,
  });
  await archivePortalInboxItem(salonId, inboxItemId);
  return documentId;
}

/**
 * Convert leftover waiting_approval portal uploads (created before this change).
 */
async function promoteWaitingPortalUploads(ctx) {
  const tasks = ctx.tasks || [];
  let changed = 0;
  for (const task of tasks) {
    if (task.taskType !== "document" && task.taskType !== "file_upload") continue;
    if (String(task.status || "") !== "waiting_approval") continue;
    const res = task.result || {};
    const inboxMeta = await readInboxUploadMeta(ctx.salonId, res.inboxItemId);
    const storagePath = trimStr(res.storagePath || inboxMeta.storagePath);
    if (!storagePath) continue;
    await finalizePortalUploadAsStaffDoc({
      salonId: ctx.salonId,
      staffId: ctx.staffId,
      runId: ctx.runId,
      taskId: task.id,
      task,
      storagePath,
      fileName: res.fileName || inboxMeta.fileName,
      expirationDate: res.expirationDate || inboxMeta.expirationDate,
      notes: inboxMeta.notes,
      inboxItemId: res.inboxItemId,
      documentType: inboxMeta.documentType,
    });
    changed += 1;
  }
  return changed;
}

module.exports = {
  parseExpirationTs,
  finalizePortalUploadAsStaffDoc,
  promoteWaitingPortalUploads,
};
