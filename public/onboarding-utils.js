/**
 * Onboarding utilities — pure helpers (no DOM, no Firestore).
 *
 * Extracted verbatim from onboarding-wizard.js. These functions have no side
 * effects beyond reading window.ffIsNativeApp; they take their inputs as
 * arguments and return values, so they are safe to share across the wizard's
 * data/ui/orchestrator modules.
 */

export const LS_COMPLETED_KEY = "ff_onboarding_completed_v1";

export function scopedCompletedKey(user, salonId) {
  const uid = user?.uid ? String(user.uid).trim() : "anon";
  const sid = salonId ? String(salonId).trim() : "nosalon";
  return `${LS_COMPLETED_KEY}_${uid}_${sid}`;
}

export function ffOnbNativeApp() {
  try {
    return typeof window !== "undefined" && typeof window.ffIsNativeApp === "function" && window.ffIsNativeApp() === true;
  } catch (_) {
    return false;
  }
}

export function validatePin(raw) {
  const v = String(raw || "").trim();
  if (!/^[0-9]{4,6}$/.test(v)) return null;
  return v;
}

export function normalizeOnboardingEmail(email) {
  return String(email || "").trim().toLowerCase();
}
