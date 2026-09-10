// Server-side last line of defense: a stale tablet cannot put yesterday's
// people back after the cloud already cleared them, and cannot delete people
// the live cloud has without a fresh justifying history row.
//
// Client guards can be skipped by an old cached JS bundle. This onWrite runs
// on every queueState write in the project.

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { protectQueueWrite } = require("./queue-write-guard-logic");

const GUARD_UID = "server:queueWriteGuard";
const SKIP_UIDS = new Set(["server:queueAutoReset", GUARD_UID]);
const SKIP_REASONS = new Set(["auto-reset", "manual-reset", "clear-history", "retention-prune", "write-guard"]);

exports.protectQueueWrite = protectQueueWrite;

exports.onQueueStateWrite = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .firestore.document("salons/{salonId}/queueState/{docId}")
  .onWrite(async (change) => {
    if (!change.after.exists) return null;
    const after = change.after.data() || {};
    const before = change.before.exists ? (change.before.data() || {}) : {};
    const by = String(after.lastUpdatedByUid || "");
    const reason = String(after.lastUpdateReason || "");
    if (SKIP_UIDS.has(by) || SKIP_REASONS.has(reason)) return null;

    const guarded = protectQueueWrite(before, after);
    if (!guarded.changed) return null;

    console.warn("[queueWriteGuard] stripped leftover / restored live people", JSON.stringify({
      path: change.after.ref.path,
      beforeQ: Array.isArray(before.queue) ? before.queue.length : 0,
      beforeS: Array.isArray(before.service) ? before.service.length : 0,
      afterQ: Array.isArray(after.queue) ? after.queue.length : 0,
      afterS: Array.isArray(after.service) ? after.service.length : 0,
      keptQ: guarded.queue.length,
      keptS: guarded.service.length,
    }));

    const rev = (typeof after.rev === "number" && after.rev >= 0) ? after.rev : 0;
    await change.after.ref.set({
      queue: guarded.queue,
      service: guarded.service,
      lastUpdatedByUid: GUARD_UID,
      lastUpdateReason: "write-guard",
      rev: rev + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return null;
  });
