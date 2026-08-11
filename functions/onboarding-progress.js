/**
 * Employee Onboarding — server-side run progress recompute.
 *
 * Triggered whenever a task under
 *   salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}/tasks/{taskId}
 * is created/updated/deleted. Uses Admin SDK so clients no longer need (or
 * get) permission to forge run.progress / run.status.
 *
 * Deploy (staging):
 *   firebase deploy --only functions:onOnboardingTaskWrite --project fair-flow-staging
 */

const admin = require("firebase-admin");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = "us-central1";

function computeProgress(tasks, currentStatus) {
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
        [
          "in_progress",
          "waiting_approval",
          "sealing",
          "completed",
          "rejected",
          "skipped",
        ].includes(String(t.status || ""))
      )
    ) {
      if (status === "draft" || status === "sent") status = "in_progress";
    }
  }
  return { progress, status };
}

async function recomputeRun(salonId, staffId, runId) {
  const runRef = db.doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
  );
  await db.runTransaction(async (tx) => {
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists) return;
    const run = runSnap.data() || {};
    if (run.status === "cancelled") return;

    const tasksSnap = await tx.get(
      db.collection(
        `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks`
      )
    );
    const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const { progress, status } = computeProgress(tasks, run.status);

    const prev = run.progress || {};
    const sameProgress =
      Number(prev.total || 0) === progress.total &&
      Number(prev.requiredTotal || 0) === progress.requiredTotal &&
      Number(prev.completed || 0) === progress.completed &&
      Number(prev.requiredCompleted || 0) === progress.requiredCompleted &&
      Number(prev.missing || 0) === progress.missing;
    if (sameProgress && run.status === status) return;

    const patch = {
      progress,
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (status === "completed" && run.status !== "completed") {
      patch.completedAt = admin.firestore.FieldValue.serverTimestamp();
    }
    tx.update(runRef, patch);
  });
}

exports.onOnboardingTaskWrite = onDocumentWritten(
  {
    document:
      "salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}/tasks/{taskId}",
    region: REGION,
  },
  async (event) => {
    const { salonId, staffId, runId } = event.params || {};
    if (!salonId || !staffId || !runId) return;
    try {
      await recomputeRun(salonId, staffId, runId);
    } catch (e) {
      console.error("[onboarding-progress] recompute failed", {
        salonId,
        staffId,
        runId,
        message: e && e.message,
      });
      throw e;
    }
  }
);

exports._computeOnboardingRunProgressForTests = computeProgress;
