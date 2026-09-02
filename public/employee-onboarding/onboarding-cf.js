/**
 * Shared HTTPS callable helper for onboarding S5 writes.
 */
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

function _fns() {
  return getFunctions(undefined, "us-central1");
}

export function ffOnboardingSalonId() {
  try {
    return String(
      (typeof window !== "undefined" && window.currentSalonId) || ""
    ).trim();
  } catch (_) {
    return "";
  }
}

export async function ffOnboardingCall(name, data) {
  const fn = httpsCallable(_fns(), name);
  const res = await fn(data || {});
  return res && res.data;
}

export function ffOnboardingCallError(e, fallback) {
  if (!e) return fallback || "Request failed";
  const details = e.details && (e.details.message || e.details);
  const raw = String(
    details || e.message || e.code || fallback || "Request failed"
  );
  const msg = raw.replace(/^Firebase:\s*/i, "").trim();
  if (/missing or insufficient permissions/i.test(msg)) {
    return "Could not save. Refresh the page and try again.";
  }
  return msg || fallback || "Request failed";
}
