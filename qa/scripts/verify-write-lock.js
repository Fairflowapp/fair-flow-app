"use strict";

/**
 * Live contention test for the staging-write lease.
 * Mutates only salons/ffBookingQa/qaLocks/booking-write-suite.
 */
const {
  LOCK_PATH,
  acquireWriteLock,
  releaseWriteLock,
  readWriteLock,
} = require("../helpers/write-lock");
const { REQUIRED_PROJECT, SALON_ID } = require("../helpers/staging-admin");

let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log("PASS:", name);
    return;
  }
  failed += 1;
  console.log("FAIL:", name, detail || "");
}

async function main() {
  const runA = "FF-QA-LOCKTEST-A-" + Date.now().toString(36);
  const runB = "FF-QA-LOCKTEST-B-" + Date.now().toString(36);
  let holdA = null;
  let holdB = null;

  console.log("Write-lock contention self-test");
  console.log("Project:", REQUIRED_PROJECT);
  console.log("Salon:", SALON_ID);
  console.log("Path:", LOCK_PATH);

  try {
    holdA = await acquireWriteLock({
      runId: runA,
      targetLabel: "lock-self-test-a",
      targetSha: "lock-test",
      ttlMs: 2 * 60 * 1000,
    });
    const afterA = await readWriteLock();
    check("A acquired atomically", !!(holdA && afterA && afterA.runId === runA));
    check("lease records runId", afterA && afterA.runId === runA);
    check("lease records target label", afterA && afterA.targetLabel === "lock-self-test-a");
    check("lease records target SHA", afterA && afterA.targetSha === "lock-test");
    check("lease records acquiredAt", afterA && afterA.acquiredAt > 0);
    check("lease records expiresAt", afterA && afterA.expiresAt > Date.now());
    check("lease salon is ffBookingQa", afterA && afterA.salonId === SALON_ID);
    check("lease project is fair-flow-staging", afterA && afterA.projectId === REQUIRED_PROJECT);

    let bError = null;
    try {
      await acquireWriteLock({
        runId: runB,
        targetLabel: "lock-self-test-b",
        targetSha: "lock-test",
        ttlMs: 60000,
      });
    } catch (err) {
      bError = err;
    }
    check(
      "B rejected while A is active",
      !!(bError && bError.code === "QA_WRITE_LOCK_HELD"),
      bError && bError.message
    );
    check(
      "B rejection is CLASS D contention, not product B",
      !!(bError && /CLASS D/i.test(String(bError.message || "")) && /CONTENTION/i.test(String(bError.message || "")))
    );
    const stillA = await readWriteLock();
    check("A lease not stolen", stillA && stillA.runId === runA);

    const steal = await releaseWriteLock({ runId: runB });
    check("B cannot release A's lease", steal && steal.released === false);
    const stillA2 = await readWriteLock();
    check("A still held after mismatched release", stillA2 && stillA2.runId === runA);

    const releasedA = await releaseWriteLock({ runId: runA });
    check("A released with A runId", releasedA && releasedA.released === true);
    holdA = null;

    holdB = await acquireWriteLock({
      runId: runB,
      targetLabel: "lock-self-test-b",
      targetSha: "lock-test",
      ttlMs: 60000,
    });
    const afterB = await readWriteLock();
    check("B acquires after A release", afterB && afterB.runId === runB);
    await releaseWriteLock(holdB);
    holdB = null;

    await acquireWriteLock({
      runId: runA + "-expired",
      targetLabel: "lock-self-test-expire",
      targetSha: "lock-test",
      ttlMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const replacement = await acquireWriteLock({
      runId: runB + "-after-expire",
      targetLabel: "lock-self-test-replace",
      targetSha: "lock-test",
      ttlMs: 60000,
    });
    const afterExpire = await readWriteLock();
    check("expired lease can be replaced", afterExpire && afterExpire.runId === replacement.runId);
    await releaseWriteLock(replacement);
  } finally {
    if (holdA) await releaseWriteLock(holdA);
    if (holdB) await releaseWriteLock(holdB);
    await releaseWriteLock({ runId: runA });
    await releaseWriteLock({ runId: runB });
    await releaseWriteLock({ runId: runA + "-expired" });
    await releaseWriteLock({ runId: runB + "-after-expire" });
    const leftover = await readWriteLock();
    const leftoverOurs = leftover && /^FF-QA-LOCKTEST-/.test(leftover.runId || "");
    check("no synthetic lock left behind", !leftoverOurs, leftover && leftover.runId);
  }

  if (failed) {
    console.error("Write-lock self-test failed:", failed);
    process.exit(1);
  }
  console.log("Write-lock contention self-test passed.");
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
