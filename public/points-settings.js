/**
 * Points — settings reader.
 *
 * Loads the account-level points settings (creating defaults on first read)
 * and applies a per-location override when present.
 *
 * Extracted from points-engine.js (step 3 of points refactor) with identical
 * behavior. NOTE: index.html defines its own inline ffGetPointsSettings that
 * wins at runtime (it assigns window.ffGetPointsSettings without a guard,
 * before this module loads). points-engine.js keeps the `||` guard so this
 * version only takes effect if the inline one is absent.
 */
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  POINTS_SETTINGS_DEFAULTS,
  getDb,
  normalizePointsSettings,
} from "./points-config.js?v=20260625_points_split";

export async function ffGetPointsSettings(accountId, locationId = "") {
  const cleanAccountId = String(accountId || "").trim();
  if (!cleanAccountId) throw new Error("No account");
  const db = getDb();
  const ref = doc(db, `accounts/${cleanAccountId}/settings/points`);
  const snap = await getDoc(ref);
  let accountSettings;
  if (!snap.exists()) {
    const defaults = { ...POINTS_SETTINGS_DEFAULTS };
    try {
      await setDoc(ref, {
        ...defaults,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      console.log("[PointsSettings] default created");
    } catch (err) {
      console.warn("[PointsSettings] default create skipped", err);
    }
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
