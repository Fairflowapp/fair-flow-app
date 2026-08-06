/**
 * Staging smoke: lateClockOutFlag via live schedule fallback on punch out.
 *
 * Replays the user scenario:
 *   1) Open manual time card WITHOUT linkedShift* (legacy / pre-fix Manage add)
 *   2) Punch clock-out (manager override — same late-eval path as kiosk punch)
 *      after published shift end + Y
 *   3) Assert lateClockOutFlag + late-clock-out alert marker
 * Also checks Manage-add now attaches a published-shift snapshot.
 *
 * Usage:
 *   node functions/scripts/smoke-late-clock-out-fallback.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "../..");
const fnRequire = createRequire(path.join(ROOT, "functions/index.js"));

process.env.GCLOUD_PROJECT = "fair-flow-staging";

const cfgPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const au = {
  type: "authorized_user",
  client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
  client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
  refresh_token: cfg.tokens.refresh_token,
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff-adc-"));
fs.writeFileSync(path.join(tmp, "adc.json"), JSON.stringify(au));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(tmp, "adc.json");

const admin = fnRequire("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "fair-flow-staging" });

const sched = require("../time-clock-schedule");
const {
  timeClockPunchHandler,
  timeClockManageEntryHandler,
} = require("../time-clock");

const SALON_ID = process.env.SMOKE_SALON_ID || "5KXe0jn9nDYP5MATP3HX";
const STAFF_ID = process.env.SMOKE_STAFF_ID || "staff_1782844860449_wg3ybx3ue"; // Bobo
const LOC_ID = process.env.SMOKE_LOCATION_ID || "4ruFL1G3hDnHOdhGmYGD";
const MANAGER_UID = process.env.SMOKE_MANAGER_UID || "84V176J8Nueonz9YzvwBmpbQmMI3";
const SMOKE_TAG = "ff-smoke-late-out";

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failures += 1;
    console.log("FAIL:", name, extra != null ? JSON.stringify(extra).slice(0, 400) : "");
  }
}

async function voidOpenEntries(db, staffId) {
  const snap = await db.collection(`salons/${SALON_ID}/timeEntries`).where("status", "==", "open").get();
  const batch = [];
  snap.forEach((d) => {
    const e = d.data() || {};
    if (String(e.staffId || "") !== String(staffId)) return;
    batch.push(d.ref.set({
      status: "void",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: SMOKE_TAG,
      notes: `${e.notes || ""} [voided by ${SMOKE_TAG}]`.trim(),
    }, { merge: true }));
  });
  await Promise.all(batch);
  return batch.length;
}

async function main() {
  const db = admin.firestore();
  console.log("=== late clock-out fallback smoke ===");
  console.log({ SALON_ID, STAFF_ID, LOC_ID, MANAGER_UID });

  const settingsRef = db.doc(`salons/${SALON_ID}/settings/timeClock`);
  const prevSettings = await settingsRef.get();
  const prevSettingsData = prevSettings.exists ? prevSettings.data() : null;

  const tzInfo = await sched.resolveSalonTimeZone(db, SALON_ID, LOC_ID);
  const nowMs = Date.now();
  const dateKey = sched.salonDateKey(new Date(nowMs), tzInfo.timeZone);
  const enforcement = sched.normalizeScheduleEnforcement({
    enabled: true,
    earlyClockInMinutes: 15,
    lateClockOutMinutes: 15,
    noShiftPolicy: "allow",
  });

  let createdFallbackId = null;
  let createdManageId = null;
  let alertRef = null;

  try {
    await settingsRef.set({
      scheduleEnforcement: {
        enabled: true,
        earlyClockInMinutes: 15,
        lateClockOutMinutes: 15,
        noShiftPolicy: "allow",
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: SMOKE_TAG,
    }, { merge: true });

    const live = await sched.resolveScheduleContextForPunch(db, {
      salonId: SALON_ID,
      locationId: LOC_ID,
      staffId: STAFF_ID,
      nowMs,
      enforcement,
    });
    check("live week published", live.weekPublished === true, live);
    check("live shift present", !!(live.shift && live.shift.endTime), live.shift);
    if (!(live.shift && live.shift.endTime)) {
      throw new Error("No published shift for Bobo today — cannot smoke late-out fallback.");
    }

    const shiftEndMs = sched.zonedWallTimeToUtcMs(dateKey, live.shift.endTime, tzInfo.timeZone);
    const thresholdMs = shiftEndMs + 15 * 60 * 1000;
    check(
      "now is past shift end + Y (needed for flag)",
      Number.isFinite(shiftEndMs) && nowMs > thresholdMs,
      { shiftEnd: live.shift.endTime, shiftEndMs, thresholdMs, nowMs, dateKey },
    );
    if (!(Number.isFinite(shiftEndMs) && nowMs > thresholdMs)) {
      throw new Error("Smoke requires current time after published shift end + 15m.");
    }

    // Offline resolve helper against live Firestore (no punch yet).
    const closedLike = await voidOpenEntries(db, STAFF_ID);
    console.log("voided open entries:", closedLike);

    // ── A) Manage-add should attach snapshot ───────────────────────────────
    const manageAdd = await timeClockManageEntryHandler({
      op: "add",
      salonId: SALON_ID,
      staffId: STAFF_ID,
      locationId: LOC_ID,
      clockInAt: new Date(shiftEndMs - 2 * 60 * 60 * 1000).toISOString(),
      notes: `${SMOKE_TAG} manage-add snapshot`,
    }, {
      auth: { uid: MANAGER_UID, token: {} },
      rawRequest: { ip: "127.0.0.1" },
    });
    createdManageId = manageAdd.entryId;
    const manageDoc = await db.doc(`salons/${SALON_ID}/timeEntries/${createdManageId}`).get();
    const manageData = manageDoc.data() || {};
    check(
      "manage-add wrote linkedShift snapshot",
      manageData.scheduled === true
        && String(manageData.linkedShiftEnd || "") === String(live.shift.endTime)
        && String(manageData.linkedShiftDateKey || "") === dateKey,
      {
        scheduled: manageData.scheduled,
        linkedShiftEnd: manageData.linkedShiftEnd,
        linkedShiftDateKey: manageData.linkedShiftDateKey,
        expectedEnd: live.shift.endTime,
      },
    );
    check("manage-add did not set lateClockOutFlag", manageData.lateClockOutFlag !== true);

    // Close/void manage-add card so Bobo can have another open entry.
    await timeClockManageEntryHandler({
      op: "void",
      salonId: SALON_ID,
      entryId: createdManageId,
    }, {
      auth: { uid: MANAGER_UID, token: {} },
      rawRequest: { ip: "127.0.0.1" },
    });

    // ── B) Manual open card WITHOUT snapshot → punch out → late flag ───────
    const entryRef = await db.collection(`salons/${SALON_ID}/timeEntries`).add({
      salonId: SALON_ID,
      locationId: LOC_ID,
      staffId: STAFF_ID,
      clockInAt: admin.firestore.Timestamp.fromMillis(shiftEndMs - 2 * 60 * 60 * 1000),
      clockOutAt: null,
      status: "open",
      linkedShiftId: null,
      scheduled: false,
      linkedShiftStart: null,
      linkedShiftEnd: null,
      linkedShiftDateKey: null,
      lateClockOutFlag: false,
      source: "admin",
      notes: `${SMOKE_TAG} open manual no-snapshot`,
      durationMinutes: null,
      kioskId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: SMOKE_TAG,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: SMOKE_TAG,
    });
    createdFallbackId = entryRef.id;
    console.log("created no-snapshot open entry:", createdFallbackId);

    // Pure helper should choose live_fallback and flag late.
    const resolved = await sched.resolveLateClockOutForPunch(db, {
      salonId: SALON_ID,
      locationId: LOC_ID,
      staffId: STAFF_ID,
      entry: (await entryRef.get()).data(),
      nowMs,
      enforcement,
    });
    check("resolve source live_fallback", resolved.source === "live_fallback", resolved);
    check(
      "resolve decision late",
      resolved.decision && resolved.decision.lateClockOutFlag === true,
      resolved.decision,
    );

    // Punch out via manager override (same late-eval gate as kiosk punch out).
    const punch = await timeClockPunchHandler({
      action: "out",
      salonId: SALON_ID,
      locationId: LOC_ID,
      override: {
        staffId: STAFF_ID,
        reason: `${SMOKE_TAG} late out verify`,
      },
    }, {
      auth: { uid: MANAGER_UID, token: {} },
      rawRequest: { ip: "127.0.0.1" },
    });
    check("punch out ok", punch && punch.ok === true && punch.action === "out", punch);
    check("punch returns lateClockOutFlag true", punch && punch.lateClockOutFlag === true, punch);

    const after = await entryRef.get();
    const afterData = after.data() || {};
    check("entry lateClockOutFlag true", afterData.lateClockOutFlag === true, {
      lateClockOutFlag: afterData.lateClockOutFlag,
      scheduled: afterData.scheduled,
      linkedShiftEnd: afterData.linkedShiftEnd,
    });
    check(
      "entry persisted live-fallback snapshot",
      afterData.scheduled === true
        && String(afterData.linkedShiftEnd || "") === String(live.shift.endTime),
      {
        scheduled: afterData.scheduled,
        linkedShiftEnd: afterData.linkedShiftEnd,
        linkedShiftDateKey: afterData.linkedShiftDateKey,
      },
    );

    alertRef = db.doc(`salons/${SALON_ID}/timeClockLateClockOutAlerts/${createdFallbackId}`);
    // Alert write is best-effort async after update; retry briefly.
    let alertExists = false;
    for (let i = 0; i < 8; i++) {
      const a = await alertRef.get();
      if (a.exists) { alertExists = true; break; }
      await new Promise((r) => setTimeout(r, 400));
    }
    check("late clock-out alert marker created", alertExists === true);

    const auditOut = await entryRef.collection("auditEvents").doc("clock_out").get();
    const auditData = auditOut.exists ? (auditOut.data() || {}) : {};
    check(
      "audit records live_fallback source",
      auditData.lateClockOutSource === "live_fallback" && auditData.lateClockOutFlag === true,
      {
        lateClockOutSource: auditData.lateClockOutSource,
        lateClockOutFlag: auditData.lateClockOutFlag,
        lateEvalReason: auditData.lateEvalReason,
      },
    );
  } finally {
    // Cleanup smoke docs
    try {
      if (createdFallbackId) {
        await db.doc(`salons/${SALON_ID}/timeEntries/${createdFallbackId}`).set({
          status: "void",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: SMOKE_TAG,
        }, { merge: true });
      }
    } catch (e) {
      console.warn("cleanup fallback entry failed", e && e.message);
    }
    try {
      if (createdManageId) {
        await db.doc(`salons/${SALON_ID}/timeEntries/${createdManageId}`).set({
          status: "void",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: SMOKE_TAG,
        }, { merge: true });
      }
    } catch (e) {
      console.warn("cleanup manage entry failed", e && e.message);
    }
    try {
      if (alertRef) await alertRef.delete().catch(() => {});
    } catch (_) { /* ignore */ }

    try {
      if (prevSettingsData && prevSettingsData.scheduleEnforcement) {
        await settingsRef.set(
          { scheduleEnforcement: prevSettingsData.scheduleEnforcement },
          { merge: true },
        );
      }
    } catch (e) {
      console.warn("settings restore failed", e && e.message);
    }
  }

  console.log("");
  if (failures) {
    console.error(`FAILED: ${failures} check(s)`);
    process.exit(1);
  }
  console.log("All late clock-out fallback smoke checks passed.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
