/**
 * Employee Onboarding Portal — manager-side helpers.
 * Copy Link / issue / revoke / reissue / extend via Cloud Functions.
 */

import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

function _fns() {
  return getFunctions(undefined, "us-central1");
}

function _salonId() {
  try {
    return String(
      (typeof window !== "undefined" && window.currentSalonId) || ""
    ).trim();
  } catch (_) {
    return "";
  }
}

function _call(name, data) {
  const fn = httpsCallable(_fns(), name);
  return fn(data).then((res) => res && res.data);
}

async function _copyText(text) {
  const url = String(text || "");
  if (!url) throw new Error("No portal URL returned");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
    }
  } catch (_) {}
  return url;
}

/** Issue (or replace) active portal token. Returns { url, tokenId, expiresAt, ttlDays }. */
export async function ffIssueOnboardingPortalToken({
  staffId,
  runId,
  salonId,
  ttlDays,
} = {}) {
  const sid = String(salonId || _salonId()).trim();
  if (!sid || !staffId || !runId) throw new Error("Missing salon, staff, or run");
  return _call("issueOnboardingPortalToken", {
    salonId: sid,
    staffId: String(staffId).trim(),
    runId: String(runId).trim(),
    ttlDays: ttlDays || 30,
  });
}

export async function ffReissueOnboardingPortalToken({
  staffId,
  runId,
  salonId,
  ttlDays,
} = {}) {
  const sid = String(salonId || _salonId()).trim();
  if (!sid || !staffId || !runId) throw new Error("Missing salon, staff, or run");
  return _call("reissueOnboardingPortalToken", {
    salonId: sid,
    staffId: String(staffId).trim(),
    runId: String(runId).trim(),
    ttlDays: ttlDays || 30,
  });
}

export async function ffRevokeOnboardingPortalToken({
  staffId,
  runId,
  tokenId,
  salonId,
} = {}) {
  const sid = String(salonId || _salonId()).trim();
  if (!sid) throw new Error("Missing salon");
  return _call("revokeOnboardingPortalToken", {
    salonId: sid,
    staffId: staffId ? String(staffId).trim() : undefined,
    runId: runId ? String(runId).trim() : undefined,
    tokenId: tokenId ? String(tokenId).trim() : undefined,
  });
}

export async function ffExtendOnboardingPortalToken({
  staffId,
  runId,
  tokenId,
  salonId,
  addDays,
} = {}) {
  const sid = String(salonId || _salonId()).trim();
  if (!sid) throw new Error("Missing salon");
  return _call("extendOnboardingPortalToken", {
    salonId: sid,
    staffId: staffId ? String(staffId).trim() : undefined,
    runId: runId ? String(runId).trim() : undefined,
    tokenId: tokenId ? String(tokenId).trim() : undefined,
    addDays: addDays || 30,
  });
}

export async function ffGetOnboardingPortalActiveLink({
  staffId,
  runId,
  salonId,
} = {}) {
  const sid = String(salonId || _salonId()).trim();
  if (!sid || !staffId || !runId) throw new Error("Missing salon, staff, or run");
  return _call("getOnboardingPortalActiveLink", {
    salonId: sid,
    staffId: String(staffId).trim(),
    runId: String(runId).trim(),
  });
}

/**
 * Copy Onboarding Link:
 * - no active token → issue + copy
 * - active token with sealed URL → copy existing (no reissue)
 * - active legacy token without seal → reissue once + copy
 */
export async function ffCopyOnboardingPortalLink({ staffId, runId, salonId } = {}) {
  const active = await ffGetOnboardingPortalActiveLink({ staffId, runId, salonId });
  let result;
  if (active && active.active && active.url && !active.needsReissue) {
    result = {
      url: active.url,
      tokenId: active.tokenId,
      expiresAt: active.expiresAt,
      reused: true,
    };
  } else if (active && active.active && active.needsReissue) {
    result = await ffReissueOnboardingPortalToken({ staffId, runId, salonId });
    result = { ...result, reused: false, migrated: true };
  } else {
    result = await ffIssueOnboardingPortalToken({ staffId, runId, salonId });
    result = { ...result, reused: false };
  }
  await _copyText(result.url);
  if (typeof window.showToast === "function") {
    window.showToast(
      result.reused ? "Portal link copied." : "Portal link created and copied.",
      "success"
    );
  }
  return result;
}

/** Force a new link (supersedes previous) and copy. */
export async function ffReissueAndCopyOnboardingPortalLink({
  staffId,
  runId,
  salonId,
} = {}) {
  const result = await ffReissueOnboardingPortalToken({ staffId, runId, salonId });
  await _copyText(result && result.url);
  if (typeof window.showToast === "function") {
    window.showToast("New portal link created and copied.", "success");
  }
  return result;
}

/**
 * Send / Resend portal email (manager-explicit).
 * Reuses active token when valid; issues one only if needed.
 * Does not return the raw portal URL to the client.
 */
export async function ffSendOnboardingPortalEmail({
  staffId,
  runId,
  salonId,
} = {}) {
  const sid = String(salonId || _salonId()).trim();
  if (!sid || !staffId || !runId) throw new Error("Missing salon, staff, or run");
  return _call("sendOnboardingPortalEmail", {
    salonId: sid,
    staffId: String(staffId).trim(),
    runId: String(runId).trim(),
  });
}

/** Manual "Send Reminder Now" — reuses active portal token when valid. */
export async function ffSendOnboardingPortalReminder({
  staffId,
  runId,
  salonId,
} = {}) {
  const sid = String(salonId || _salonId()).trim();
  if (!sid || !staffId || !runId) throw new Error("Missing salon, staff, or run");
  return _call("sendOnboardingPortalReminder", {
    salonId: sid,
    staffId: String(staffId).trim(),
    runId: String(runId).trim(),
  });
}

/** Ops/staging: run automatic reminder sweep now (idempotent). */
export async function ffRunOnboardingRemindersSweep({ limit } = {}) {
  return _call("runOnboardingRemindersSweep", {
    limit: limit || 200,
  });
}

/**
 * Unauthenticated Portal HTTP actions.
 * POST https://us-central1-<project>.cloudfunctions.net/<name>
 */
export async function ffOnboardingPortalHttp(name, data) {
  let projectId = "fair-flow-staging";
  try {
    if (typeof window !== "undefined" && window.__ff_firebase_project_id) {
      projectId = String(window.__ff_firebase_project_id);
    } else if (typeof location !== "undefined" && /fair-flow-staging/.test(location.host)) {
      projectId = "fair-flow-staging";
    } else if (typeof location !== "undefined" && /fairflowapp\.com/.test(location.host)) {
      projectId = "fairflowapp-db841";
    }
  } catch (_) {}
  const url = `https://us-central1-${projectId}.cloudfunctions.net/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: data || {} }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (json && json.error && json.error.message) ||
      `Portal request failed (${res.status})`;
    throw new Error(msg);
  }
  return json.result;
}

if (typeof window !== "undefined") {
  window.ffIssueOnboardingPortalToken = ffIssueOnboardingPortalToken;
  window.ffReissueOnboardingPortalToken = ffReissueOnboardingPortalToken;
  window.ffRevokeOnboardingPortalToken = ffRevokeOnboardingPortalToken;
  window.ffExtendOnboardingPortalToken = ffExtendOnboardingPortalToken;
  window.ffGetOnboardingPortalActiveLink = ffGetOnboardingPortalActiveLink;
  window.ffCopyOnboardingPortalLink = ffCopyOnboardingPortalLink;
  window.ffReissueAndCopyOnboardingPortalLink = ffReissueAndCopyOnboardingPortalLink;
  window.ffSendOnboardingPortalEmail = ffSendOnboardingPortalEmail;
  window.ffSendOnboardingPortalReminder = ffSendOnboardingPortalReminder;
  window.ffRunOnboardingRemindersSweep = ffRunOnboardingRemindersSweep;
  window.ffOnboardingPortalHttp = ffOnboardingPortalHttp;
}
