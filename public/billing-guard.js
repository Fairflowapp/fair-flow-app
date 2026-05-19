/**
 * Billing Guard — global account-state enforcement based on Stripe.
 *
 * Reads:    salons/{salonId}.{accountStatus, gracePeriodEndsAt}
 *           (mirrored from billing/stripe by functions/stripe.js so non-owner
 *            members can read it without firestore.rules changes)
 *
 * Calls:    createStripePortalSession  (callable v2)  — Manage Billing button
 *
 * Renders one of three UI states, in addition to ZERO normal-app-state UI:
 *
 *   active   → no UI added by this module
 *   at_risk  → red banner pinned to the top of <body>; full app access kept
 *   locked   → full-screen modal overlay; only Manage Billing / Log Out
 *
 * Time-based grace-period expiration (now > gracePeriodEndsAt) is computed
 * client-side. When entering at_risk we schedule a single setTimeout for the
 * exact deadline so we re-derive once at expiry, without polling.
 *
 * Architecture constraints honored:
 *   - No firestore.rules changes (server-side mirror onto salon root doc).
 *   - No polling of Firestore — only realtime listeners.
 *   - Hooks into the rest of the app via just one SafeLoader entry in
 *     index.html. Banner + overlay are created via DOM APIs at <body> level
 *     so no other module's markup is touched.
 *   - Owner gating uses the existing window.ffIsOwner() helper.
 *   - Logout uses the existing Firebase Auth `signOut` import path.
 *   - No alert() / confirm() / prompt() anywhere.
 *
 * Future extension points (no code added now):
 *   - trials              → status === "trialing" already routes to active.
 *   - paused              → add "paused" to AT_RISK in classifyAccountStatus.
 *   - feature gating      → other modules can read window.ffBillingGuardState.
 *   - per-location limits → render warning when items.location.quantity is
 *                            below the actual location count in this salon.
 *   - usage quotas        → same pattern: read counter, compare to limit.
 */

import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { db, auth } from "/app.js?v=20260510_firestore_lp";

// ─── State machine ──────────────────────────────────────────────────────────

const STATE_ACTIVE = "active";
const STATE_AT_RISK = "at_risk";
const STATE_LOCKED = "locked";

const FUNCTIONS_REGION = "us-central1";

// ─── Module-private state ───────────────────────────────────────────────────

let _unsubSalon = null;
let _currentSalonId = null;
let _currentState = STATE_ACTIVE;
let _gracePeriodTimerId = null;
let _bannerEl = null;
let _overlayEl = null;
let _stylesInjected = false;
// Cached last snapshot — used by the grace-period setTimeout to re-derive
// without re-fetching from Firestore.
let _lastSnap = null;
// Watchdog for window.currentSalonId becoming available right after login.
let _salonWatchdogTimer = null;
// Periodic local-only check that catches salon switches (which set
// window.currentSalonId without re-firing onAuthStateChanged). NOT a Firestore
// poll — just a JS-variable check, fires every 3s while signed in.
let _salonSwitchTickerId = null;

// ─── Visual constants (Fair Flow purple palette + warning red) ──────────────

const PALETTE = Object.freeze({
  primary: "#7c3aed",
  primaryHover: "#6d28d9",
  warningBg: "#dc2626",
  warningHover: "#b91c1c",
  warningText: "#ffffff",
  overlayBg: "rgba(15, 23, 42, 0.92)",
  cardBg: "#ffffff",
  textDark: "#111827",
  textMuted: "#6b7280",
  border: "#e5e7eb",
  errorBg: "#fef2f2",
  errorBorder: "#fecaca",
  errorText: "#991b1b",
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function isOwner() {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.ffIsOwner === "function" &&
      window.ffIsOwner() === true
    );
  } catch (_) {
    return false;
  }
}

function getSalonId() {
  try {
    if (typeof window !== "undefined" && window.currentSalonId) {
      return String(window.currentSalonId).trim() || null;
    }
  } catch (_) {}
  return null;
}

function tsToMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts.seconds != null) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return null;
}

/**
 * Pure derivation. Inputs:
 *   accountStatus     — server-classified bucket: 'active' | 'at_risk' | 'locked'
 *                       (computed by classifyAccountStatus in functions/stripe.js)
 *   gracePeriodEndsAt — Firestore Timestamp | null
 *
 * Returns one of: STATE_ACTIVE | STATE_AT_RISK | STATE_LOCKED.
 *
 * The only time-dependent rule lives here: AT_RISK + (now > deadline) → LOCKED.
 * That way the salon doc never needs a server-side refresh purely due to
 * time passing — the client takes care of it.
 */
function deriveState(accountStatus, gracePeriodEndsAt) {
  const base = String(accountStatus || STATE_ACTIVE).toLowerCase();
  if (base === STATE_LOCKED) return STATE_LOCKED;
  if (base === STATE_AT_RISK) {
    const deadline = tsToMillis(gracePeriodEndsAt);
    if (deadline != null && Date.now() > deadline) return STATE_LOCKED;
    return STATE_AT_RISK;
  }
  return STATE_ACTIVE;
}

// ─── Style injection (one-time) ─────────────────────────────────────────────

function injectStylesOnce() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement("style");
  style.id = "ff-billing-guard-styles";
  style.textContent = `
@keyframes ffbg-fadein { from { opacity: 0 } to { opacity: 1 } }
.ffbg-banner {
  position: sticky; top: 0; z-index: 99997;
  background: ${PALETTE.warningBg}; color: ${PALETTE.warningText};
  padding: 10px 16px; font-size: 14px; line-height: 1.4;
  display: flex; align-items: center; justify-content: center; gap: 14px;
  flex-wrap: wrap;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  animation: ffbg-fadein 250ms ease;
  font-family: inherit;
}
.ffbg-banner-msg { flex: 0 1 auto; max-width: 720px; text-align: center; }
.ffbg-banner-cta {
  background: #ffffff; color: ${PALETTE.warningBg};
  border: none; padding: 7px 14px; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background 150ms ease;
  font-family: inherit;
}
.ffbg-banner-cta:hover { background: #fef2f2; }
.ffbg-banner-cta:disabled { opacity: 0.6; cursor: wait; }

.ffbg-overlay {
  position: fixed; inset: 0; z-index: 99998;
  background: ${PALETTE.overlayBg};
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: ffbg-fadein 250ms ease;
  font-family: inherit;
}
.ffbg-overlay-card {
  background: ${PALETTE.cardBg}; color: ${PALETTE.textDark};
  max-width: min(420px, 92vw); width: 100%;
  border-radius: 16px;
  padding: 32px 28px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.35);
  text-align: center;
}
.ffbg-overlay-icon {
  width: 56px; height: 56px; border-radius: 50%;
  background: #f3e8ff;
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 16px;
  font-size: 26px;
  color: ${PALETTE.primary};
  font-weight: 700;
}
.ffbg-overlay-title {
  font-size: 20px; font-weight: 700; margin: 0 0 12px;
  color: ${PALETTE.textDark};
}
.ffbg-overlay-msg {
  font-size: 14px; line-height: 1.5;
  color: ${PALETTE.textMuted};
  margin: 0 0 24px;
}
.ffbg-btn-row {
  display: flex; flex-direction: column; gap: 10px;
}
@media (min-width: 480px) {
  .ffbg-btn-row { flex-direction: row; gap: 12px; }
  .ffbg-btn-row > button { flex: 1; }
}
.ffbg-btn-primary {
  background: ${PALETTE.primary}; color: #ffffff;
  border: none; padding: 12px 20px; border-radius: 10px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background 150ms ease;
  font-family: inherit;
}
.ffbg-btn-primary:hover { background: ${PALETTE.primaryHover}; }
.ffbg-btn-primary:disabled { opacity: 0.6; cursor: wait; }
.ffbg-btn-secondary {
  background: transparent; color: ${PALETTE.textDark};
  border: 1px solid ${PALETTE.border};
  padding: 12px 20px; border-radius: 10px;
  font-size: 14px; font-weight: 500; cursor: pointer;
  transition: background 150ms ease;
  font-family: inherit;
}
.ffbg-btn-secondary:hover { background: #f3f4f6; }
.ffbg-error {
  margin-top: 14px;
  padding: 8px 12px;
  background: ${PALETTE.errorBg};
  border: 1px solid ${PALETTE.errorBorder};
  color: ${PALETTE.errorText};
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
}
@media (prefers-reduced-motion: reduce) {
  .ffbg-banner, .ffbg-overlay { animation: none; }
}
`;
  document.head.appendChild(style);
}

// ─── Banner ─────────────────────────────────────────────────────────────────

function mountBanner(graceDaysRemaining) {
  injectStylesOnce();
  if (!_bannerEl) {
    _bannerEl = document.createElement("div");
    _bannerEl.className = "ffbg-banner";
    _bannerEl.setAttribute("role", "alert");
    _bannerEl.setAttribute("aria-live", "polite");
    _bannerEl.setAttribute("data-ff-billing-guard", "banner");
    document.body.insertBefore(_bannerEl, document.body.firstChild);
  }

  let msg =
    "Payment issue detected. Please update your payment method to avoid account interruption.";
  if (
    typeof graceDaysRemaining === "number" &&
    graceDaysRemaining >= 0 &&
    graceDaysRemaining <= 60
  ) {
    msg += ` Account will be locked in ${graceDaysRemaining} day${
      graceDaysRemaining === 1 ? "" : "s"
    }.`;
  }

  _bannerEl.innerHTML = "";
  const msgEl = document.createElement("span");
  msgEl.className = "ffbg-banner-msg";
  msgEl.textContent = msg;
  _bannerEl.appendChild(msgEl);

  // Manage Billing button only for owners — non-owners can't change billing.
  if (isOwner()) {
    const btn = document.createElement("button");
    btn.className = "ffbg-banner-cta";
    btn.type = "button";
    btn.textContent = "Manage Billing";
    btn.addEventListener("click", onManageBillingClick);
    _bannerEl.appendChild(btn);
  }
}

function unmountBanner() {
  if (_bannerEl && _bannerEl.parentNode) {
    _bannerEl.parentNode.removeChild(_bannerEl);
  }
  _bannerEl = null;
}

// ─── Lock overlay ───────────────────────────────────────────────────────────

function mountOverlay() {
  injectStylesOnce();
  if (_overlayEl) return; // already mounted

  _overlayEl = document.createElement("div");
  _overlayEl.className = "ffbg-overlay";
  _overlayEl.setAttribute("role", "dialog");
  _overlayEl.setAttribute("aria-modal", "true");
  _overlayEl.setAttribute("aria-labelledby", "ffbg-overlay-title");
  _overlayEl.setAttribute("data-ff-billing-guard", "overlay");

  const card = document.createElement("div");
  card.className = "ffbg-overlay-card";

  const icon = document.createElement("div");
  icon.className = "ffbg-overlay-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "!";
  card.appendChild(icon);

  const title = document.createElement("h2");
  title.id = "ffbg-overlay-title";
  title.className = "ffbg-overlay-title";
  title.textContent = "Subscription inactive";
  card.appendChild(title);

  const owner = isOwner();
  const msg = document.createElement("p");
  msg.className = "ffbg-overlay-msg";
  msg.textContent = owner
    ? "Please update your billing to continue using Fair Flow."
    : "Please contact your salon owner to renew the subscription.";
  card.appendChild(msg);

  const btnRow = document.createElement("div");
  btnRow.className = "ffbg-btn-row";

  if (owner) {
    const manageBtn = document.createElement("button");
    manageBtn.className = "ffbg-btn-primary";
    manageBtn.type = "button";
    manageBtn.textContent = "Manage Billing";
    manageBtn.addEventListener("click", onManageBillingClick);
    btnRow.appendChild(manageBtn);
  }

  const logoutBtn = document.createElement("button");
  logoutBtn.className = "ffbg-btn-secondary";
  logoutBtn.type = "button";
  logoutBtn.textContent = "Log Out";
  logoutBtn.addEventListener("click", onLogoutClick);
  btnRow.appendChild(logoutBtn);

  card.appendChild(btnRow);
  _overlayEl.appendChild(card);
  document.body.appendChild(_overlayEl);

  // Prevent background scrolling while overlay is up.
  document.body.style.overflow = "hidden";
}

function unmountOverlay() {
  if (_overlayEl && _overlayEl.parentNode) {
    _overlayEl.parentNode.removeChild(_overlayEl);
  }
  _overlayEl = null;
  document.body.style.overflow = "";
}

function showInlineError(message) {
  // Prefer the overlay card when locked; fall back to the banner.
  const host =
    (_overlayEl && _overlayEl.querySelector(".ffbg-overlay-card")) ||
    _bannerEl;
  if (!host) return;
  let err = host.querySelector(".ffbg-error");
  if (!err) {
    err = document.createElement("div");
    err.className = "ffbg-error";
    host.appendChild(err);
  }
  err.textContent = String(message || "");
  err.style.display = "block";
}

// ─── Click handlers ─────────────────────────────────────────────────────────

async function onManageBillingClick(event) {
  const btn = event && event.currentTarget;
  let originalText = "";
  if (btn) {
    originalText = btn.textContent || "";
    btn.disabled = true;
    btn.textContent = "Opening portal…";
  }
  try {
    const salonId = getSalonId();
    if (!salonId) throw new Error("No salon selected");
    const fn = httpsCallable(
      getFunctions(undefined, FUNCTIONS_REGION),
      "createStripePortalSession"
    );
    const { data } = await fn({
      salonId,
      returnUrl: window.location.origin + "/",
    });
    if (data && data.url) {
      window.location.href = data.url;
    } else {
      throw new Error("No portal URL returned by server");
    }
  } catch (err) {
    console.warn("[BillingGuard] portal failed", err);
    if (btn) {
      btn.disabled = false;
      if (originalText) btn.textContent = originalText;
    }
    showInlineError(`Could not open portal: ${err?.message || err}`);
  }
}

async function onLogoutClick(event) {
  const btn = event && event.currentTarget;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Logging out…";
  }
  try {
    await signOut(auth);
    // After sign-out, onAuthStateChanged will tear down the guard. Reload to
    // hand control back to the login screen cleanly.
    window.location.reload();
  } catch (err) {
    console.warn("[BillingGuard] logout failed", err);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Log Out";
    }
    showInlineError(`Logout failed: ${err?.message || err}`);
  }
}

// ─── Grace-period timer ─────────────────────────────────────────────────────

function clearGraceTimer() {
  if (_gracePeriodTimerId != null) {
    clearTimeout(_gracePeriodTimerId);
    _gracePeriodTimerId = null;
  }
}

function scheduleGraceExpiry(deadlineMs) {
  clearGraceTimer();
  if (deadlineMs == null) return;
  const delta = deadlineMs - Date.now();
  if (delta <= 0) {
    // Already past — flip on next tick rather than synchronously, so the
    // current snapshot render finishes first.
    _gracePeriodTimerId = setTimeout(() => {
      _gracePeriodTimerId = null;
      if (_lastSnap) {
        applyState(_lastSnap.accountStatus, _lastSnap.gracePeriodEndsAt);
      }
    }, 0);
    return;
  }
  // Cap at ~24.8 days (max int32 ms) so setTimeout doesn't overflow. If the
  // grace period is longer, the backstop is the next snapshot or the next
  // page load — both will re-derive correctly.
  const cap = 1 << 30;
  const safeDelta = Math.min(delta, cap);
  _gracePeriodTimerId = setTimeout(() => {
    _gracePeriodTimerId = null;
    if (_lastSnap) {
      applyState(_lastSnap.accountStatus, _lastSnap.gracePeriodEndsAt);
    }
  }, safeDelta);
}

// ─── State application (the heart of the guard) ────────────────────────────

function applyState(accountStatus, gracePeriodEndsAt) {
  _lastSnap = { accountStatus, gracePeriodEndsAt };
  const next = deriveState(accountStatus, gracePeriodEndsAt);
  if (next === _currentState && _bannerEl == null && _overlayEl == null) {
    // No-op when state didn't change AND DOM isn't already mounted incorrectly.
    // (When state changes, we always re-render so banner-msg can update.)
    return;
  }
  _currentState = next;
  window.ffBillingGuardState = next;

  clearGraceTimer();

  if (next === STATE_LOCKED) {
    unmountBanner();
    mountOverlay();
  } else if (next === STATE_AT_RISK) {
    unmountOverlay();
    let daysRemaining = null;
    const deadline = tsToMillis(gracePeriodEndsAt);
    if (deadline != null) {
      daysRemaining = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000))
      );
      scheduleGraceExpiry(deadline);
    }
    mountBanner(daysRemaining);
  } else {
    // active
    unmountBanner();
    unmountOverlay();
  }

  console.info(
    "[BillingGuard] state →",
    next,
    gracePeriodEndsAt ? "(has grace period)" : ""
  );
}

// ─── Listener lifecycle ─────────────────────────────────────────────────────

function startListening(salonId) {
  stopListening();
  _currentSalonId = salonId;
  try {
    const ref = doc(db, "salons", salonId);
    _unsubSalon = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        applyState(data.accountStatus, data.gracePeriodEndsAt);
      },
      (err) => {
        // Fail-open on permission/network errors so we don't lock users out
        // of a working app due to a transient glitch.
        console.warn(
          "[BillingGuard] snapshot error",
          err && err.code,
          err && err.message
        );
        applyState(STATE_ACTIVE, null);
      }
    );
  } catch (err) {
    console.warn("[BillingGuard] failed to subscribe", err);
  }
}

function stopListening() {
  if (_unsubSalon) {
    try {
      _unsubSalon();
    } catch (_) {}
    _unsubSalon = null;
  }
  _currentSalonId = null;
  _currentState = STATE_ACTIVE;
  _lastSnap = null;
  clearGraceTimer();
  unmountBanner();
  unmountOverlay();
  window.ffBillingGuardState = STATE_ACTIVE;
}

function clearSalonWatchdog() {
  if (_salonWatchdogTimer != null) {
    clearTimeout(_salonWatchdogTimer);
    _salonWatchdogTimer = null;
  }
}

function clearSalonSwitchTicker() {
  if (_salonSwitchTickerId != null) {
    clearInterval(_salonSwitchTickerId);
    _salonSwitchTickerId = null;
  }
}

/**
 * After auth completes, the rest of the app sets `window.currentSalonId`
 * asynchronously (see public/app.js — depends on memberships + Choose-Salon
 * flow). This watchdog polls the LOCAL JS variable (NOT Firestore) for up
 * to 30 seconds to pick it up the first time. Once attached, `startListening`
 * uses a real-time Firestore listener — no further polling.
 */
function waitForSalonAndStart(maxAttempts = 60, intervalMs = 500) {
  clearSalonWatchdog();
  let attempts = 0;
  const tryStart = () => {
    if (!auth.currentUser) return; // signed out mid-poll
    const sid = getSalonId();
    if (sid) {
      if (sid !== _currentSalonId) startListening(sid);
      return;
    }
    if (attempts++ >= maxAttempts) {
      console.warn(
        "[BillingGuard] gave up waiting for currentSalonId after",
        attempts,
        "attempts"
      );
      return;
    }
    _salonWatchdogTimer = setTimeout(tryStart, intervalMs);
  };
  tryStart();
}

/**
 * After a successful initial attach, multi-salon users can switch the active
 * salon (which mutates `window.currentSalonId` without triggering
 * onAuthStateChanged). We notice that here. NOT a Firestore poll — just a
 * lightweight local-variable check at 3s intervals.
 */
function startSalonSwitchTicker() {
  clearSalonSwitchTicker();
  _salonSwitchTickerId = setInterval(() => {
    if (!auth.currentUser) return;
    const sid = getSalonId();
    if (!sid) return;
    if (sid !== _currentSalonId) {
      console.info("[BillingGuard] salon switched →", sid);
      startListening(sid);
    }
  }, 3000);
}

// ─── Auth wiring ────────────────────────────────────────────────────────────

onAuthStateChanged(auth, (user) => {
  if (!user) {
    clearSalonWatchdog();
    clearSalonSwitchTicker();
    stopListening();
    return;
  }
  waitForSalonAndStart();
  startSalonSwitchTicker();
});

// ─── Public debug surface ───────────────────────────────────────────────────

window.ffBillingGuardState = STATE_ACTIVE;
window.ffBillingGuard = Object.freeze({
  /**
   * Re-derive UI state from the cached last snapshot. Handy for tests and
   * for forcing a re-render after an external change (e.g., locale switch).
   */
  refresh() {
    if (_lastSnap) {
      applyState(_lastSnap.accountStatus, _lastSnap.gracePeriodEndsAt);
    }
  },
  /**
   * DEV-only escape hatch. No-op outside localhost / staging hostnames so it
   * can never accidentally bypass enforcement on production.
   */
  unlock() {
    const host = (window.location && window.location.hostname) || "";
    const allowed =
      host === "localhost" ||
      host.endsWith(".test") ||
      host === "fair-flow-staging.web.app" ||
      host === "fair-flow-staging.firebaseapp.com";
    if (!allowed) {
      console.warn("[BillingGuard] unlock() is disabled on this host");
      return false;
    }
    stopListening();
    console.info("[BillingGuard] manually unlocked (dev override)");
    return true;
  },
});
