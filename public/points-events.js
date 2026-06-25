/**
 * Points — event transactions.
 *
 * ffCreatePointsEvent: idempotent award (dedupe via deterministic event id),
 * updates the staff pointsSummary atomically.
 * ffVoidPointsEvent: posts a compensating "points_correction" event and
 * decrements the summary atomically.
 *
 * Extracted from points-engine.js (step 4 of points refactor) — EXACT move,
 * no logic changes. The transaction read/write order and dedupe semantics are
 * load-bearing; do not reorder tx.get/tx.set calls.
 */
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getIsoWeekKey,
  getMonthKey,
  getDayKey,
  buildEventId,
} from "./points-keys.js?v=20260625_points_split";
import { getDb } from "./points-config.js?v=20260625_points_split";

export async function ffCreatePointsEvent(input) {
  const accountId = String(input?.accountId || "").trim();
  const staffId = String(input?.staffId || "").trim();
  const staffName = String(input?.staffName || "").trim();
  const locationId = String(input?.locationId || "").trim();
  const type = String(input?.type || "").trim();
  const sourceModule = String(input?.sourceModule || "").trim();
  const sourceId = String(input?.sourceId || "").trim();
  const points = Number(input?.points);
  const uniquePerSource = input?.uniquePerSource === true;
  const fileHash = String(input?.fileHash || "").trim();
  const sourceMeta = input?.sourceMeta && typeof input.sourceMeta === "object" ? input.sourceMeta : null;

  if (!accountId || !staffId || !locationId || !type || !sourceModule || !sourceId || !Number.isFinite(points)) {
    return { created: false, reason: "missing_required_fields" };
  }

  const db = getDb();
  const now = new Date();
  const weekKey = getIsoWeekKey(now);
  const monthKey = getMonthKey(now);
  const dayKey = getDayKey(now);
  const eventId = buildEventId({ staffId, type, sourceModule, sourceId, dayKey: uniquePerSource ? "" : dayKey });
  const eventRef = doc(collection(db, `accounts/${accountId}/pointsEvents`), eventId);
  const summaryRef = doc(db, `accounts/${accountId}/staff/${staffId}/pointsSummary/main`);

  return runTransaction(db, async (tx) => {
    const existingEvent = await tx.get(eventRef);
    if (existingEvent.exists()) {
      console.log("[Points] duplicate skipped");
      return { created: false, duplicate: true };
    }

    const summarySnap = await tx.get(summaryRef);
    const summary = summarySnap.exists() ? (summarySnap.data() || {}) : {};
    const previousWeekKey = String(summary.currentWeekKey || "");
    const previousMonthKey = String(summary.currentMonthKey || "");
    const allTime = Number(summary.allTime) || 0;
    const currentWeek = previousWeekKey === weekKey ? (Number(summary.currentWeek) || 0) : 0;
    const currentMonth = previousMonthKey === monthKey ? (Number(summary.currentMonth) || 0) : 0;

    const eventPayload = {
      staffId,
      staffName,
      locationId,
      type,
      sourceModule,
      sourceId,
      points,
      createdAt: serverTimestamp(),
      weekKey,
      monthKey,
      voided: false,
    };
    if (fileHash) eventPayload.fileHash = fileHash;
    if (sourceMeta) eventPayload.sourceMeta = sourceMeta;
    tx.set(eventRef, eventPayload);
    console.log("[Points] event created");

    const previousBreakdownEvents = Array.isArray(summary.breakdownEvents)
      ? summary.breakdownEvents.filter((event) => event && event.voided !== true)
      : [];
    const summaryBreakdownEvent = {
      id: eventId,
      staffId,
      staffName,
      locationId,
      type,
      sourceModule,
      points,
      weekKey,
      monthKey,
      voided: false,
    };
    if (sourceMeta) summaryBreakdownEvent.sourceMeta = sourceMeta;
    const breakdownEvents = [...previousBreakdownEvents, summaryBreakdownEvent]
      .slice(-100);

    tx.set(summaryRef, {
      allTime: allTime + points,
      currentWeek: currentWeek + points,
      currentMonth: currentMonth + points,
      currentWeekKey: weekKey,
      currentMonthKey: monthKey,
      breakdownEvents,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    console.log("[Points] summary updated");

    return { created: true, eventId, weekKey, monthKey };
  });
}

export async function ffVoidPointsEvent(input) {
  const accountId = String(input?.accountId || "").trim();
  const eventId = String(input?.eventId || "").trim();
  const reason = String(input?.reason || "Voided").trim() || "Voided";
  const correctedByName = String(input?.correctedByName || "").trim();
  const correctedByRole = String(input?.correctedByRole || "").trim();
  if (!accountId || !eventId) {
    return { voided: false, reason: "missing_required_fields" };
  }

  const db = getDb();
  const eventRef = doc(db, `accounts/${accountId}/pointsEvents/${eventId}`);

  return runTransaction(db, async (tx) => {
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists()) {
      return { voided: false, reason: "event_not_found" };
    }
    const event = eventSnap.data() || {};
    if (event.voided === true) {
      return { voided: false, duplicate: true };
    }
    if (String(event.type || "") === "points_correction") {
      return { voided: false, reason: "cannot_correct_correction" };
    }

    const staffId = String(event.staffId || "").trim();
    if (!staffId) {
      return { voided: false, reason: "missing_staff_id" };
    }

    const points = Number(event.points) || 0;
    const eventWeekKey = String(event.weekKey || "");
    const eventMonthKey = String(event.monthKey || "");
    const correctionId = buildEventId({
      staffId,
      type: "points_correction",
      sourceModule: "points",
      sourceId: eventId,
      dayKey: "",
    });
    const correctionRef = doc(collection(db, `accounts/${accountId}/pointsEvents`), correctionId);
    const correctionSnap = await tx.get(correctionRef);
    if (correctionSnap.exists()) {
      return { voided: false, duplicate: true };
    }
    const summaryRef = doc(db, `accounts/${accountId}/staff/${staffId}/pointsSummary/main`);
    const summarySnap = await tx.get(summaryRef);
    const summary = summarySnap.exists() ? (summarySnap.data() || {}) : {};
    const allTime = Math.max(0, (Number(summary.allTime) || 0) - points);
    const currentWeek = String(summary.currentWeekKey || "") === eventWeekKey
      ? Math.max(0, (Number(summary.currentWeek) || 0) - points)
      : (Number(summary.currentWeek) || 0);
    const currentMonth = String(summary.currentMonthKey || "") === eventMonthKey
      ? Math.max(0, (Number(summary.currentMonth) || 0) - points)
      : (Number(summary.currentMonth) || 0);

    tx.set(correctionRef, {
      staffId,
      staffName: String(event.staffName || ""),
      locationId: String(event.locationId || ""),
      type: "points_correction",
      sourceModule: "points",
      sourceId: eventId,
      points: -Math.abs(points),
      createdAt: serverTimestamp(),
      weekKey: eventWeekKey || getIsoWeekKey(new Date()),
      monthKey: eventMonthKey || getMonthKey(new Date()),
      correction: true,
      correctionReason: reason,
      correctedByName,
      correctedByRole,
      sourceMeta: {
        correctedEventId: eventId,
        correctedType: String(event.type || ""),
        correctedSourceModule: String(event.sourceModule || ""),
        correctedSourceId: String(event.sourceId || ""),
      },
    });

    tx.set(summaryRef, {
      allTime,
      currentWeek,
      currentMonth,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    return { voided: true, correction: true, eventId: correctionId, staffId, points };
  });
}
