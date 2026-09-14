"use strict";

const { REPO_ROOT } = require("./env");
const {
  REQUIRED_PROJECT,
  SALON_ID,
  abort,
  openStagingAdmin,
  assertQaSalonPath,
} = require("./staging-admin");

const LOCK_PATH = "salons/" + SALON_ID + "/qaLocks/booking-write-suite";
const DEFAULT_TTL_MS = 25 * 60 * 1000;

function lockRef(db) {
  assertQaSalonPath(LOCK_PATH);
  return db.doc(LOCK_PATH);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds != null) return Number(value.seconds) * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function acquireWriteLock(options) {
  const runId = String(options && options.runId || "").trim();
  if (!runId) abort("Write lock requires a runId.");
  const ttlMs = Number(options && options.ttlMs) || DEFAULT_TTL_MS;
  const label = String(options && options.targetLabel || "").trim();
  const sha = String(options && options.targetSha || "").trim();

  return (async function useAdmin() {
    const { admin, db } = await openStagingAdmin(REPO_ROOT);
    if (admin.app().options.projectId !== REQUIRED_PROJECT) {
      abort("Admin projectId is not fair-flow-staging.");
    }
    const ref = lockRef(db);
    const now = Date.now();
    const expiresAt = now + ttlMs;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const data = snap.data() || {};
        const currentExpiry = toMillis(data.expiresAt);
        const holder = String(data.runId || "");
        if (holder && holder !== runId && currentExpiry > now) {
          const err = new Error(
            "QA CONTENTION: staging write lease is held by run " + holder +
              " until " + new Date(currentExpiry).toISOString() +
              ". This is CLASS D, not a product regression."
          );
          err.code = "QA_WRITE_LOCK_HELD";
          throw err;
        }
      }
      tx.set(ref, {
        runId,
        targetLabel: label,
        targetSha: sha,
        ownerPid: process.pid,
        acquiredAt: new Date(now),
        expiresAt: new Date(expiresAt),
        salonId: SALON_ID,
        projectId: REQUIRED_PROJECT,
      });
    });

    return {
      runId,
      path: LOCK_PATH,
      expiresAt,
    };
  })();
}

async function readWriteLock() {
  const { admin, db } = await openStagingAdmin(REPO_ROOT);
  if (admin.app().options.projectId !== REQUIRED_PROJECT) {
    abort("Admin projectId is not fair-flow-staging.");
  }
  const snap = await lockRef(db).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    runId: String(data.runId || ""),
    targetLabel: String(data.targetLabel || ""),
    targetSha: String(data.targetSha || ""),
    acquiredAt: toMillis(data.acquiredAt),
    expiresAt: toMillis(data.expiresAt),
    salonId: String(data.salonId || ""),
    projectId: String(data.projectId || ""),
    path: LOCK_PATH,
  };
}

async function releaseWriteLock(handle) {
  const runId = String(handle && handle.runId || "").trim();
  if (!runId) return { released: false, reason: "missing-runId" };
  const { admin, db } = await openStagingAdmin(REPO_ROOT);
  if (admin.app().options.projectId !== REQUIRED_PROJECT) {
    abort("Admin projectId is not fair-flow-staging.");
  }
  const ref = lockRef(db);
  let released = false;
  let holder = "";
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    holder = String(data.runId || "");
    if (holder !== runId) return;
    tx.delete(ref);
    released = true;
  });
  return { released, holder, runId };
}

async function maybeAcquireWriteLock(options) {
  if (String(process.env.FF_QA_WRITE_LOCK_HELD || "") === "1") {
    return { heldExternally: true, runId: String(options && options.runId || "") };
  }
  const lease = await acquireWriteLock(options);
  return Object.assign({ heldExternally: false }, lease);
}

async function maybeReleaseWriteLock(handle) {
  if (!handle || handle.heldExternally) return;
  await releaseWriteLock(handle);
}

module.exports = {
  LOCK_PATH,
  DEFAULT_TTL_MS,
  acquireWriteLock,
  releaseWriteLock,
  readWriteLock,
  maybeAcquireWriteLock,
  maybeReleaseWriteLock,
};
