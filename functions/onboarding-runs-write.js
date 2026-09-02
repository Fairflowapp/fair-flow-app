/**
 * Employee Onboarding S5 — run/task write callables.
 * Client create/update on onboardingRuns + tasks become false after deploy.
 */
const { onCall } = require("firebase-functions/v2/https");
const {
  admin,
  HttpsError,
  REGION,
  V1_TYPES,
  db,
  trimStr,
  requireAuth,
  assertManager,
  normalizeTaskConfig,
  assertCanActOnStaff,
  runRef,
  taskRef,
  nowTs,
} = require("./onboarding-writes-helpers");
const { versionsCol, docsCol } = require("./onboarding-esign-library-helpers");

async function enrichEsignSnapshot(salonId, cfg, taskLabel) {
  const config = normalizeTaskConfig("electronic_signature", cfg);
  const documentId = trimStr(config.signatureDocumentId);
  const versionId = trimStr(config.signatureDocumentVersionId);
  if (!documentId || !versionId) {
    throw new HttpsError(
      "failed-precondition",
      `E-sign task "${taskLabel}" is missing a bound library document.`
    );
  }
  const vref = versionsCol(salonId, documentId).doc(versionId);
  const [vSnap, dSnap] = await Promise.all([
    vref.get(),
    docsCol(salonId).doc(documentId).get(),
  ]);
  if (!vSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      `E-sign task "${taskLabel}": document version not found.`
    );
  }
  const ver = vSnap.data() || {};
  const docRow = dSnap.exists ? dSnap.data() || {} : {};
  const fieldSchema = Array.isArray(ver.fieldSchema)
    ? ver.fieldSchema
    : Array.isArray(config.fieldSchema)
      ? config.fieldSchema
      : [];
  if (!fieldSchema.length) {
    throw new HttpsError(
      "failed-precondition",
      `E-sign task "${taskLabel}" has no signature field layout.`
    );
  }
  return normalizeTaskConfig("electronic_signature", {
    ...config,
    signatureDocumentId: documentId,
    signatureDocumentVersionId: versionId,
    documentSha256: trimStr(ver.sha256) || config.documentSha256,
    documentTitle: trimStr(docRow.title) || config.documentTitle || documentId,
    documentVersion:
      ver.documentVersion != null ? ver.documentVersion : versionId,
    pageCount: Number(ver.pageCount) || config.pageCount,
    fieldSchema,
    storagePath: trimStr(ver.storagePath),
  });
}

async function bindVersions(salonId, uid, runId, tasks) {
  for (const t of tasks) {
    if (t.taskType !== "electronic_signature") continue;
    const documentId = trimStr(
      t.configSnapshot &&
        (t.configSnapshot.signatureDocumentId || t.configSnapshot.documentId)
    );
    const versionId = trimStr(
      t.configSnapshot &&
        (t.configSnapshot.signatureDocumentVersionId ||
          t.configSnapshot.documentVersionId)
    );
    if (!documentId || !versionId) continue;
    const vref = versionsCol(salonId, documentId).doc(versionId);
    const snap = await vref.get();
    if (!snap.exists) continue;
    const ver = snap.data() || {};
    if (ver.status && ver.status !== "ready") continue;
    await vref.set(
      {
        schemaFrozen: true,
        immutable: true,
        boundRunCount: Number(ver.boundRunCount || 0) + 1,
        lastBoundRunId: runId,
        lastBoundAt: nowTs(),
        lastBoundByUid: uid,
      },
      { merge: true }
    );
  }
}

async function buildTaskRows(salonId, pkg) {
  const items = Array.isArray(pkg.items) ? pkg.items.slice() : [];
  items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const [tmplSnap, catSnap] = await Promise.all([
    db().collection(`salons/${salonId}/onboardingTaskTemplates`).get(),
    db().collection(`salons/${salonId}/onboardingCategories`).get(),
  ]);
  const templatesById = {};
  tmplSnap.docs.forEach((d) => {
    templatesById[d.id] = { id: d.id, ...(d.data() || {}) };
  });
  const categoriesById = {};
  catSnap.docs.forEach((d) => {
    categoriesById[d.id] = { id: d.id, ...(d.data() || {}) };
  });
  const tasks = [];
  for (const it of items) {
    const templateId = trimStr(it && it.templateId);
    if (!templateId) continue;
    const tmpl = templatesById[templateId];
    if (!tmpl || tmpl.active === false) continue;
    const taskType = trimStr(tmpl.taskType);
    if (!V1_TYPES.includes(taskType)) continue;
    const configOverrides =
      it.configOverrides && typeof it.configOverrides === "object"
        ? it.configOverrides
        : {};
    let configSnapshot = normalizeTaskConfig(taskType, {
      ...(tmpl.config || {}),
      ...configOverrides,
    });
    if (taskType === "electronic_signature") {
      configSnapshot = await enrichEsignSnapshot(
        salonId,
        configSnapshot,
        tmpl.name || templateId
      );
    }
    const categoryId = tmpl.categoryId ? String(tmpl.categoryId) : null;
    const cat = categoryId && categoriesById[categoryId];
    tasks.push({
      id: templateId,
      templateId,
      templateNameSnapshot: String(tmpl.name || templateId),
      taskType,
      categoryId,
      categoryNameSnapshot: cat ? String(cat.name || "") : "",
      required: it.required === false ? false : tmpl.defaultRequired !== false,
      sortOrder: Number.isFinite(Number(it.sortOrder))
        ? Number(it.sortOrder)
        : tasks.length,
      status: "pending",
      configSnapshot,
      result: {},
      completedAt: null,
      completedBy: null,
      createdAt: nowTs(),
      updatedAt: nowTs(),
    });
  }
  return tasks;
}

exports.createOnboardingRunFromPackage = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const packageId = trimStr(request.data && request.data.packageId);
    const dueDate = trimStr(request.data && request.data.dueDate) || null;
    if (!salonId || !staffId || !packageId) {
      throw new HttpsError(
        "invalid-argument",
        "Missing salonId, staffId, or packageId."
      );
    }
    await assertManager(uid, salonId);
    const staffSnap = await db().doc(`salons/${salonId}/staff/${staffId}`).get();
    if (!staffSnap.exists) throw new HttpsError("not-found", "Staff not found.");
    const pkgSnap = await db()
      .doc(`salons/${salonId}/onboardingPackages/${packageId}`)
      .get();
    if (!pkgSnap.exists) throw new HttpsError("not-found", "Package not found.");
    const pkg = { id: pkgSnap.id, ...(pkgSnap.data() || {}) };
    if (pkg.active === false) {
      throw new HttpsError("failed-precondition", "Package is inactive.");
    }
    const taskRows = await buildTaskRows(salonId, pkg);
    if (!taskRows.length) {
      throw new HttpsError(
        "failed-precondition",
        "Package has no active v1 tasks to assign."
      );
    }
    const runDoc = db()
      .collection(`salons/${salonId}/staff/${staffId}/onboardingRuns`)
      .doc();
    const runId = runDoc.id;
    const runPayload = {
      id: runId,
      schemaVersion: 1,
      packageId,
      packageNameSnapshot: String(pkg.name || packageId),
      packageDescriptionSnapshot: String(pkg.description || ""),
      audienceSnapshot: pkg.audience || {
        workerClassifications: [],
        technicianTypeIds: [],
      },
      status: "draft",
      progress: {
        total: taskRows.length,
        requiredTotal: taskRows.filter((t) => t.required !== false).length,
        completed: 0,
        requiredCompleted: 0,
        missing: taskRows.filter((t) => t.required !== false).length,
      },
      dueDate,
      createdBy: uid,
      createdAt: nowTs(),
      createdAtMs: Date.now(),
      sentAt: null,
      completedAt: null,
      cancelledAt: null,
      updatedAt: nowTs(),
    };
    const batch = db().batch();
    batch.set(runDoc, runPayload);
    for (const t of taskRows) {
      batch.set(taskRef(salonId, staffId, runId, t.id), t);
    }
    await batch.commit();
    try {
      await bindVersions(salonId, uid, runId, taskRows);
    } catch (e) {
      console.warn("[OnboardingS5] bind versions failed", e && e.message);
    }
    return { runId, ok: true };
  }
);

exports.activateOnboardingRun = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const salonId = trimStr(request.data && request.data.salonId);
  const staffId = trimStr(request.data && request.data.staffId);
  const runId = trimStr(request.data && request.data.runId);
  if (!salonId || !staffId || !runId) {
    throw new HttpsError("invalid-argument", "Missing salonId, staffId, or runId.");
  }
  await assertManager(uid, salonId);
  const ref = runRef(salonId, staffId, runId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Run not found.");
  const run = snap.data() || {};
  if (run.status === "cancelled" || run.status === "completed") {
    return { ok: true, status: run.status, runId };
  }
  if (run.status === "draft") {
    await ref.set(
      { status: "sent", sentAt: nowTs(), updatedAt: nowTs() },
      { merge: true }
    );
    return { ok: true, status: "sent", runId };
  }
  return { ok: true, status: run.status, runId };
});

exports.cancelOnboardingRun = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const salonId = trimStr(request.data && request.data.salonId);
  const staffId = trimStr(request.data && request.data.staffId);
  const runId = trimStr(request.data && request.data.runId);
  if (!salonId || !staffId || !runId) {
    throw new HttpsError("invalid-argument", "Missing salonId, staffId, or runId.");
  }
  await assertManager(uid, salonId);
  const ref = runRef(salonId, staffId, runId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Run not found.");
  const run = snap.data() || {};
  if (run.status === "completed" || run.status === "cancelled") {
    return { ok: true, status: run.status, runId };
  }
  await ref.set(
    { status: "cancelled", cancelledAt: nowTs(), updatedAt: nowTs() },
    { merge: true }
  );
  return { ok: true, status: "cancelled", runId };
});

exports.skipOnboardingTask = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const salonId = trimStr(request.data && request.data.salonId);
  const staffId = trimStr(request.data && request.data.staffId);
  const runId = trimStr(request.data && request.data.runId);
  const taskId = trimStr(request.data && request.data.taskId);
  if (!salonId || !staffId || !runId || !taskId) {
    throw new HttpsError("invalid-argument", "Missing ids.");
  }
  await assertManager(uid, salonId);
  const ref = taskRef(salonId, staffId, runId, taskId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
  const task = snap.data() || {};
  if (task.required !== false) {
    throw new HttpsError("failed-precondition", "Cannot skip a required task.");
  }
  if (task.status === "skipped" || task.status === "completed") {
    return { ok: true, status: task.status };
  }
  await ref.set(
    {
      status: "skipped",
      updatedAt: nowTs(),
      completedAt: nowTs(),
      completedBy: uid,
    },
    { merge: true }
  );
  return { ok: true, status: "skipped" };
});

exports.acknowledgeOnboardingPolicyTask = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    const taskId = trimStr(request.data && request.data.taskId);
    const typedName = trimStr(request.data && request.data.typedName);
    if (!salonId || !staffId || !runId || !taskId) {
      throw new HttpsError("invalid-argument", "Missing ids.");
    }
    await assertCanActOnStaff(uid, salonId, staffId);
    const ref = taskRef(salonId, staffId, runId, taskId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
    const task = snap.data() || {};
    if (task.taskType !== "policy_acknowledgement") {
      throw new HttpsError("failed-precondition", "Not a policy acknowledgement task.");
    }
    if (task.status === "completed") return { ok: true, alreadyCompleted: true };
    const cfg = task.configSnapshot || {};
    if (cfg.requireTypedName && !typedName) {
      throw new HttpsError("invalid-argument", "Full name is required.");
    }
    await ref.set(
      {
        status: "completed",
        result: {
          acknowledgedAt: admin.firestore.Timestamp.now(),
          acknowledgedByUid: uid,
          acknowledgedByName: cfg.requireTypedName ? typedName : null,
          policyVersion: String(cfg.version || "1.0"),
        },
        completedAt: nowTs(),
        completedBy: uid,
        updatedAt: nowTs(),
      },
      { merge: true }
    );
    return { ok: true };
  }
);

exports.markOnboardingUploadWaitingApproval = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    const taskId = trimStr(request.data && request.data.taskId);
    const inboxItemId = trimStr(request.data && request.data.inboxItemId);
    const fileName = trimStr(request.data && request.data.fileName);
    const storagePath = trimStr(request.data && request.data.storagePath);
    if (!salonId || !staffId || !runId || !taskId) {
      throw new HttpsError("invalid-argument", "Missing ids.");
    }
    await assertCanActOnStaff(uid, salonId, staffId);
    const ref = taskRef(salonId, staffId, runId, taskId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
    const task = snap.data() || {};
    if (task.taskType !== "document" && task.taskType !== "file_upload") {
      throw new HttpsError("failed-precondition", "Not an upload task.");
    }
    if (task.status === "completed") {
      throw new HttpsError("failed-precondition", "Task already completed.");
    }
    if (task.status === "waiting_approval") return { ok: true, already: true };
    await ref.set(
      {
        status: "waiting_approval",
        result: {
          ...(task.result || {}),
          inboxItemId: inboxItemId || null,
          fileName: fileName || null,
          storagePath: storagePath || null,
        },
        updatedAt: nowTs(),
      },
      { merge: true }
    );
    return { ok: true };
  }
);

exports.completeOnboardingTaskFromInboxApprove = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    const taskId = trimStr(request.data && request.data.taskId);
    const inboxItemId = trimStr(request.data && request.data.inboxItemId);
    const linkedDocumentId = trimStr(
      request.data && request.data.linkedDocumentId
    );
    const approverUid = trimStr(request.data && request.data.approverUid) || uid;
    if (!salonId || !staffId || !runId || !taskId) {
      throw new HttpsError("invalid-argument", "Missing ids.");
    }
    await assertManager(uid, salonId);
    const ref = taskRef(salonId, staffId, runId, taskId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
    const task = snap.data() || {};
    const prev = task.result || {};
    if (
      task.status === "completed" &&
      prev.linkedDocumentId &&
      linkedDocumentId &&
      prev.linkedDocumentId === linkedDocumentId
    ) {
      return { ok: true, alreadyCompleted: true };
    }
    await ref.set(
      {
        status: "completed",
        result: {
          ...prev,
          linkedDocumentId: linkedDocumentId || prev.linkedDocumentId || null,
          inboxItemId: inboxItemId || prev.inboxItemId || null,
          approvedAt: admin.firestore.Timestamp.now(),
          approvedBy: approverUid,
          rejectedAt: null,
          rejectionReason: null,
        },
        completedAt: nowTs(),
        completedBy: approverUid,
        updatedAt: nowTs(),
      },
      { merge: true }
    );
    return { ok: true };
  }
);

exports.rejectOnboardingTaskFromInbox = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    const taskId = trimStr(request.data && request.data.taskId);
    const inboxItemId = trimStr(request.data && request.data.inboxItemId);
    const reason = trimStr(request.data && request.data.reason);
    if (!salonId || !staffId || !runId || !taskId) {
      throw new HttpsError("invalid-argument", "Missing ids.");
    }
    await assertManager(uid, salonId);
    const ref = taskRef(salonId, staffId, runId, taskId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
    const task = snap.data() || {};
    if (task.status === "completed") return { ok: true, alreadyCompleted: true };
    const prev = task.result || {};
    await ref.set(
      {
        status: "rejected",
        result: {
          ...prev,
          inboxItemId: inboxItemId || prev.inboxItemId || null,
          rejectedAt: admin.firestore.Timestamp.now(),
          rejectionReason: reason || null,
        },
        updatedAt: nowTs(),
      },
      { merge: true }
    );
    return { ok: true };
  }
);

/**
 * Void one e-sign completion and reopen that task only.
 * Other tasks stay completed. Run returns to in_progress so the employee
 * can sign again (and receive a portal email).
 */
exports.reopenOnboardingEsignTask = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const salonId = trimStr(request.data && request.data.salonId);
  const staffId = trimStr(request.data && request.data.staffId);
  const runId = trimStr(request.data && request.data.runId);
  const taskId = trimStr(request.data && request.data.taskId);
  if (!salonId || !staffId || !runId || !taskId) {
    throw new HttpsError("invalid-argument", "Missing ids.");
  }
  await assertManager(uid, salonId);

  const tRef = taskRef(salonId, staffId, runId, taskId);
  const rRef = runRef(salonId, staffId, runId);
  const [taskSnap, runSnap] = await Promise.all([tRef.get(), rRef.get()]);
  if (!taskSnap.exists) throw new HttpsError("not-found", "Task not found.");
  if (!runSnap.exists) throw new HttpsError("not-found", "Onboarding run not found.");

  const task = taskSnap.data() || {};
  const run = runSnap.data() || {};
  if (run.status === "cancelled") {
    throw new HttpsError(
      "failed-precondition",
      "Cannot reopen a task on a cancelled run."
    );
  }
  if (task.taskType !== "electronic_signature") {
    throw new HttpsError(
      "failed-precondition",
      "Only an e-sign form can be reopened this way."
    );
  }
  if (task.status !== "completed" && task.status !== "sealing") {
    throw new HttpsError(
      "failed-precondition",
      "This form is already open for the employee."
    );
  }

  const prev = task.result && typeof task.result === "object" ? task.result : {};
  const taskTitle =
    trimStr(task.templateNameSnapshot) ||
    trimStr((task.configSnapshot || {}).documentTitle) ||
    taskId;

  await tRef.update({
    status: "pending",
    completedAt: admin.firestore.FieldValue.delete(),
    completedBy: admin.firestore.FieldValue.delete(),
    updatedAt: nowTs(),
    result: {
      reopenedAt: new Date().toISOString(),
      reopenedByUid: uid,
      voidedPrevious: {
        reason: "manager_reopen",
        sealId: prev.sealId || null,
        signedAt: prev.signedAt || null,
        signedPdfSha256: prev.signedPdfSha256 || null,
        signedDocumentId: prev.signedDocumentId || null,
      },
    },
  });

  await rRef.set(
    {
      status: "in_progress",
      completedAt: admin.firestore.FieldValue.delete(),
      updatedAt: nowTs(),
    },
    { merge: true }
  );

  try {
    await rRef
      .collection("auditEvents")
      .doc(`esign_reopen_${taskId}_${Date.now()}`)
      .set({
        action: "esign_reopen",
        performedAs: "manager",
        byUid: uid,
        staffId,
        runId,
        taskId,
        taskTitle,
        voidedSealId: prev.sealId || null,
        createdAt: nowTs(),
      });
  } catch (_) {}

  return {
    ok: true,
    status: "pending",
    taskId,
    taskTitle,
    runStatus: "in_progress",
  };
});
