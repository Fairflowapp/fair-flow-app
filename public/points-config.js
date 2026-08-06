/**
 * Points — config + data-access helpers.
 *
 * Holds the canonical points settings defaults, their normalization, and the
 * shared Firestore handle resolver. No DOM.
 *
 * Extracted from points-engine.js (step 2 of points refactor) with identical
 * behavior. NOTE: a near-duplicate of these defaults/normalizer also lives
 * inline in index.html (FF_POINTS_SETTINGS_DEFAULTS, with an extra
 * showRankToPrivate field) — do not "unify" here; that is a separate task.
 */

export const POINTS_SETTINGS_DEFAULTS = {
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
  pointsVisibilityMode: "full",
};

export function getDb() {
  const db = (typeof window !== "undefined" && (window.ffDb || window.db)) || null;
  if (!db) throw new Error("Firestore is not ready");
  return db;
}

export function normalizePointsSettings(data) {
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
