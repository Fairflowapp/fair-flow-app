/**
 * S7 — durable access audit for onboarding file reads / reveals.
 * Admin SDK only. Never store signed URLs or raw tokens.
 */
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

async function writeOnboardingAccessAudit({
  salonId,
  staffId,
  runId,
  taskId,
  uid,
  action,
  storagePath,
  kind,
  extra,
} = {}) {
  const sid = trimStr(salonId);
  const act = trimStr(action);
  if (!sid || !act) return null;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const eventId = `${act.slice(0, 40)}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const payload = {
    type: act,
    action: act,
    byUid: uid || null,
    storagePath: storagePath ? String(storagePath).slice(0, 500) : null,
    kind: kind ? trimStr(kind) : null,
    staffId: trimStr(staffId) || null,
    runId: trimStr(runId) || null,
    taskId: trimStr(taskId) || null,
    createdAt: now,
  };
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach((k) => {
      if (payload[k] == null && extra[k] != null) payload[k] = extra[k];
    });
  }
  const db = admin.firestore();
  const batch = db.batch();
  batch.set(db.doc(`salons/${sid}/onboardingAccessAudit/${eventId}`), payload);
  if (payload.staffId && payload.runId) {
    batch.set(
      db.doc(
        `salons/${sid}/staff/${payload.staffId}/onboardingRuns/${payload.runId}/auditEvents/${eventId}`
      ),
      payload
    );
  }
  await batch.commit();
  return eventId;
}

module.exports = { writeOnboardingAccessAudit };
