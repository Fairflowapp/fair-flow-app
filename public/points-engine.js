import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const POINTS_SETTINGS_DEFAULTS = {
  taskCompleted: 5,
  photoUpload: 2,
  videoUpload: 3,
  beforeAfterUpload: 4,
  upgradeService: 10,
  ticketUpgrade: 5,
  queueFirst: 10,
  queueSecond: 7,
  queueThird: 5,
  queueJoin: 2,
  monthlyGoal: 120,
  pointsVisibilityMode: "full",
};

function getDb() {
  const db = (typeof window !== "undefined" && (window.ffDb || window.db)) || null;
  if (!db) throw new Error("Firestore is not ready");
  return db;
}

function normalizePointsSettings(data) {
  const source = data && typeof data === "object" ? data : {};
  const out = {};
  Object.keys(POINTS_SETTINGS_DEFAULTS).forEach((key) => {
    if (key === "pointsVisibilityMode") {
      const mode = String(source[key] || "").trim();
      out[key] = ["private", "partial", "full"].includes(mode) ? mode : POINTS_SETTINGS_DEFAULTS[key];
      return;
    }
    const value = Number(source[key]);
    out[key] = Number.isFinite(value) ? value : POINTS_SETTINGS_DEFAULTS[key];
  });
  return out;
}

export async function ffGetPointsSettings(accountId, locationId = "") {
  const cleanAccountId = String(accountId || "").trim();
  if (!cleanAccountId) throw new Error("No account");
  const db = getDb();
  const ref = doc(db, `accounts/${cleanAccountId}/settings/points`);
  const snap = await getDoc(ref);
  let accountSettings;
  if (!snap.exists()) {
    const defaults = { ...POINTS_SETTINGS_DEFAULTS };
    await setDoc(ref, {
      ...defaults,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    console.log("[PointsSettings] default created");
    console.log("[PointsSettings] loaded");
    accountSettings = defaults;
  } else {
    const raw = snap.data() || {};
    const merged = normalizePointsSettings(raw);
  const missing = Object.keys(POINTS_SETTINGS_DEFAULTS).some((key) => {
    if (key === "pointsVisibilityMode") return !["private", "partial", "full"].includes(String(raw[key] || "").trim());
    return raw[key] == null || !Number.isFinite(Number(raw[key]));
  });
  if (missing) {
    await setDoc(ref, {
      ...merged,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
    accountSettings = merged;
  }
  const cleanLocationId = String(locationId || "").trim();
  if (cleanLocationId) {
    const locationRef = doc(db, `accounts/${cleanAccountId}/locations/${cleanLocationId}/settings/points`);
    const locationSnap = await getDoc(locationRef);
    if (locationSnap.exists()) {
      console.log("[PointsSettings] loaded location override");
      return normalizePointsSettings({ ...accountSettings, ...(locationSnap.data() || {}) });
    }
  }
  console.log("[PointsSettings] loaded");
  return accountSettings;
}

function startOfUtcYear(date) {
  return Date.UTC(date.getUTCFullYear(), 0, 1);
}

function getIsoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil((((d.getTime() - startOfUtcYear(d)) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function safeIdPart(value) {
  return encodeURIComponent(String(value || "").trim()).replace(/\./g, "%2E").slice(0, 240);
}

function buildEventId({ staffId, type, sourceModule, sourceId, dayKey }) {
  const parts = [
    safeIdPart(type),
    safeIdPart(sourceModule),
    safeIdPart(staffId),
    safeIdPart(sourceId),
  ];
  if (dayKey) parts.push(safeIdPart(dayKey));
  return parts.join("__");
}

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

    tx.set(summaryRef, {
      allTime: allTime + points,
      currentWeek: currentWeek + points,
      currentMonth: currentMonth + points,
      currentWeekKey: weekKey,
      currentMonthKey: monthKey,
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

if (typeof window !== "undefined") {
  window.ffGetPointsSettings = window.ffGetPointsSettings || ffGetPointsSettings;
  window.ffCreatePointsEvent = ffCreatePointsEvent;
  window.ffVoidPointsEvent = ffVoidPointsEvent;
}
