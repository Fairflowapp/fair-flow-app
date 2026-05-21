/**
 * Billing Cloud — Stripe subscription UI.
 *
 * Wires TWO Settings UIs (the app currently ships both — the new mobile-style
 * Settings UI is what users actually open today; the legacy dialog is still
 * present and harmless):
 *
 *   1. New Settings UI: #userProfileCardBilling inside #userProfileScreen
 *      Hooked via window.updateBillingPanel() — the existing router at the
 *      `section === 'billing'` branch in initializeUserProfileMenu() already
 *      calls this if defined.
 *
 *   2. Legacy dialog: #billingSettingsSection inside #settingsDlg
 *      Hooked via window.ffInitBillingSection() — called from
 *      openSettingsSecure().
 *
 * Reads:    salons/{salonId}/billing/stripe   (live, onSnapshot)
 * Calls:    createStripeCheckoutSession      (callable v2)
 *           createStripePortalSession        (callable v2)
 *
 * Visible only to the salon owner (window.ffIsOwner()). Server still enforces
 * the same check via assertOwnerOfSalon() in functions/stripe.js — this is
 * just UI gating.
 *
 * Pricing shown to the user (informational; real prices live in Stripe):
 *   Base Plan            $99/mo  (qty always 1, included)
 *   Additional Location  $79/mo  (qty)
 *   Extra Storage        $10/mo  per 10GB block (qty)
 */

import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260510_firestore_lp";

const FUNCTIONS_REGION = "us-central1";

// Display-only USD prices. Stripe is the source of truth for what's actually
// charged; these labels just mirror the configured price IDs.
const PRICE_BASE = 99;
const PRICE_LOCATION = 79;
const PRICE_STORAGE = 10;

let _unsubBilling = null;
let _unsubOverride = null;
let _currentSalonId = null;
let _wired = false;
let _newCardWired = false;
// Cache the most recent snapshot so the new card can re-render whenever the
// router reopens the Billing section (the listener doesn't re-fire on view
// switches).
let _lastBillingData = null;
// Cache the most recent override snapshot. When the override is active it
// short-circuits all Stripe-derived rendering — the comped/free Internal
// Billing flow (see functions/billing.js).
let _lastOverrideData = null;
// Per-salon guards so we don't loop on a misbehaving sync. Once we've
// attempted a sync for a given salonId we don't auto-retry until the user
// reloads or switches salons.
const _syncAttemptedForSalon = new Set();
let _syncInFlight = false;

// IDs of pre-existing elements inside #userProfileCardBilling (defined in
// public/index.html — we don't add them here).
const NEW_UI = Object.freeze({
  card: "userProfileCardBilling",
  currentPlan: "billingCurrentPlan",
  monthlyPrice: "billingMonthlyPrice",
  status: "billingStatus",
  nextDate: "billingNextDate",
  subscribeBtn: "billingSubscribeBtn",
  manageBtn: "billingManageBtn",
  invoicesBody: "billingInvoicesBody",
});

function $(id) {
  return document.getElementById(id);
}

function functionsClient() {
  return getFunctions(undefined, FUNCTIONS_REGION);
}

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

function fmtPeriodEnd(ts) {
  try {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (_) {
    return "";
  }
}

function fmtMoney(cents, currency) {
  try {
    if (cents == null) return "";
    const amount = Number(cents) / 100;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(amount);
  } catch (_) {
    return "";
  }
}

function readQty(id) {
  const el = $(id);
  if (!el) return 0;
  const n = parseInt(el.value || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function recalcTotal() {
  const totalEl = $("ffBillingTotalLine");
  if (!totalEl) return;
  const locQty = readQty("ffBillingLocationQty");
  const storQty = readQty("ffBillingStorageQty");
  const total = PRICE_BASE + locQty * PRICE_LOCATION + storQty * PRICE_STORAGE;
  totalEl.textContent = `$${total} / month`;
}

function buildCheckoutItems() {
  const locQty = readQty("ffBillingLocationQty");
  const storQty = readQty("ffBillingStorageQty");
  const items = [{ sku: "base", quantity: 1 }];
  if (locQty > 0) items.push({ sku: "location", quantity: locQty });
  if (storQty > 0) items.push({ sku: "storage", quantity: storQty });
  return items;
}

async function showError(message, title) {
  if (typeof window.ffStyledAlert === "function") {
    try {
      await window.ffStyledAlert(message, title || "Billing");
      return;
    } catch (_) {}
  }
  alert(`${title || "Billing"}: ${message}`);
}

/**
 * Inline error strip inside #userProfileCardBilling so failures from a
 * callable are immediately visible (the user explicitly asked for this).
 * Created on demand the first time it's needed; reused thereafter.
 */
function showCardError(message) {
  const card = $(NEW_UI.card);
  if (!card) return;
  let err = card.querySelector(".ff-billing-error");
  if (!err) {
    err = document.createElement("div");
    err.className = "ff-billing-error";
    err.style.cssText =
      "margin-top:12px;padding:10px 14px;border:1px solid #fca5a5;" +
      "border-radius:8px;background:#fef2f2;color:#991b1b;font-size:12px;" +
      "line-height:1.4;";
    card.appendChild(err);
  }
  err.textContent = String(message || "");
  err.style.display = "block";
}

function clearCardError() {
  const card = $(NEW_UI.card);
  if (!card) return;
  const err = card.querySelector(".ff-billing-error");
  if (err) err.style.display = "none";
}

/**
 * Core checkout invocation, shared by both UIs. `btn` is optional; when
 * present, its label is restored on failure.
 */
async function triggerCheckout(btn, items) {
  const salonId = getSalonId();
  if (!salonId) {
    showCardError("No salon selected.");
    return;
  }
  const originalText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Opening checkout…";
  }
  try {
    const fn = httpsCallable(functionsClient(), "createStripeCheckoutSession");
    const origin = window.location.origin;
    const { data } = await fn({
      salonId,
      items,
      // Stripe replaces {CHECKOUT_SESSION_ID} server-side.
      successUrl: `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/?billing=cancel`,
    });
    if (data && data.url) {
      window.location.href = data.url;
    } else {
      throw new Error("No checkout URL returned by server");
    }
  } catch (err) {
    console.error("[BillingCloud] checkout failed", err);
    showCardError(`Could not start checkout: ${err?.message || err}`);
    // Also surface in legacy dialog if the user clicked from there.
    if (btn && btn.id === "ffBillingCheckoutBtn") {
      await showError(err?.message || String(err), "Checkout failed");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      if (originalText) btn.textContent = originalText;
    }
  }
}

/**
 * Core portal invocation, shared by both UIs.
 */
async function triggerPortal(btn) {
  const salonId = getSalonId();
  if (!salonId) {
    showCardError("No salon selected.");
    return;
  }
  const originalText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Opening portal…";
  }
  try {
    const fn = httpsCallable(functionsClient(), "createStripePortalSession");
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
    console.error("[BillingCloud] portal failed", err);
    showCardError(`Could not open billing portal: ${err?.message || err}`);
    if (btn && btn.id === "ffBillingPortalBtn") {
      await showError(err?.message || String(err), "Could not open portal");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      if (originalText) btn.textContent = originalText;
    }
  }
}

/**
 * "Stuck" state = a customer was created (so checkout was started) but the
 * subscription state never landed in Firestore. This is exactly the symptom
 * when Stripe's webhook delivery hasn't reached us yet (still in retry
 * backoff) or the signing secret is mismatched. Either way, the syncing
 * callable will pull from Stripe directly and write the same shape the
 * webhook would.
 */
function isStuckBillingDoc(data) {
  if (!data) return false;
  if (!data.customerId) return false;
  return !data.subscriptionId || !data.status;
}

/**
 * Detects an items map written by `stripeWebhook` while it was running with
 * stale `STRIPE_PRICE_*` env vars. In that case `pickItemsFromSubscription`
 * (functions/stripe.js) couldn't classify the priceIds and fell through to
 * `unknown_${priceId}` keys, which the UI doesn't recognize as base/location/
 * storage — so Current Plan and Monthly Price render as "—" even though the
 * subscription is fully active in Stripe.
 *
 * `syncStripeSubscription` always runs with the latest deployed env vars, so a
 * single sync rewrites items under the correct SKU keys without needing to
 * redeploy the webhook function. The auto-trigger below is one-shot per salon
 * per session (same `_syncAttemptedForSalon` gate as the stuck-doc path).
 */
function hasUnknownItemKeys(data) {
  if (!data || !data.items || typeof data.items !== "object") return false;
  const keys = Object.keys(data.items);
  if (keys.length === 0) return false;
  return keys.some((k) => k.startsWith("unknown_"));
}

/**
 * Fire-and-forget sync. Idempotent at the salon level (one attempt per salon
 * per session). Snapshot listener will pick up the new state automatically
 * once the callable writes to Firestore — no manual re-render needed.
 *
 * If `force=true` (used by the user-facing Refresh link), re-runs even if
 * already attempted.
 */
async function triggerSync({ force = false } = {}) {
  const salonId = getSalonId();
  if (!salonId) return;
  if (_syncInFlight) return;
  if (!force && _syncAttemptedForSalon.has(salonId)) return;
  _syncAttemptedForSalon.add(salonId);
  _syncInFlight = true;
  showSyncingIndicator();
  try {
    const fn = httpsCallable(functionsClient(), "syncStripeSubscription");
    const { data } = await fn({ salonId });
    if (data?.synced) {
      console.info("[BillingCloud] sync completed", data);
      // No re-render here — onSnapshot listener fires automatically when the
      // server-side write lands.
    } else {
      console.info("[BillingCloud] sync returned no_subscriptions", data);
      hideSyncingIndicator();
    }
  } catch (err) {
    console.warn("[BillingCloud] sync failed", err);
    showCardError(`Refresh failed: ${err?.message || err}`);
    hideSyncingIndicator();
  } finally {
    _syncInFlight = false;
  }
}

function showSyncingIndicator() {
  const card = $(NEW_UI.card);
  if (!card) return;
  let el = card.querySelector(".ff-billing-syncing");
  if (!el) {
    el = document.createElement("div");
    el.className = "ff-billing-syncing";
    el.style.cssText =
      "margin-top:8px;font-size:12px;color:#6b7280;font-style:italic;";
    card.appendChild(el);
  }
  el.textContent = "Refreshing subscription from Stripe…";
  el.style.display = "block";
}

function hideSyncingIndicator() {
  const card = $(NEW_UI.card);
  if (!card) return;
  const el = card.querySelector(".ff-billing-syncing");
  if (el) el.style.display = "none";
}

// ─── Legacy dialog (#billingSettingsSection) handlers ────────────────────────
// Read quantities from the legacy form's number inputs.

async function onCheckoutClick() {
  clearCardError();
  return triggerCheckout($("ffBillingCheckoutBtn"), buildCheckoutItems());
}

async function onPortalClick() {
  clearCardError();
  return triggerPortal($("ffBillingPortalBtn"));
}

// ─── New card (#userProfileCardBilling) handlers ─────────────────────────────
// No quantity inputs in the new UI yet — Subscribe always uses { base: 1 } for
// first-time signup; if there's already an active subscription, both buttons
// route to the Stripe Billing Portal where the owner can change quantities.

function isActiveSubscription(data) {
  if (!data) return false;
  const s = String(data.status || "").toLowerCase();
  return s === "active" || s === "trialing" || s === "past_due";
}

async function onSubscribeUpgradeClick() {
  clearCardError();
  const btn = $(NEW_UI.subscribeBtn);
  if (isActiveSubscription(_lastBillingData)) {
    // "Upgrade" path → Stripe Billing Portal (lets owner change quantities,
    // payment method, cancel, etc.)
    return triggerPortal(btn);
  }
  // First-time subscribe: just the base plan ($99). Locations / extra storage
  // can be added immediately afterward via the Billing Portal.
  return triggerCheckout(btn, [{ sku: "base", quantity: 1 }]);
}

async function onManageBillingClick() {
  clearCardError();
  return triggerPortal($(NEW_UI.manageBtn));
}

function statusLabel(status) {
  switch (String(status || "").toLowerCase()) {
    case "active":
      return "Active";
    case "trialing":
      return "Trialing";
    case "past_due":
      return "Past due — please update payment";
    case "canceled":
      return "Canceled";
    case "incomplete":
      return "Incomplete — finish checkout";
    case "incomplete_expired":
      return "Checkout expired";
    case "unpaid":
      return "Unpaid";
    default:
      return status || "Unknown";
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Internal billing override (comped/free access).
 *
 * Mirror of the server-side check in functions/stripe.js → recomputeAccountStatus.
 * When this returns true we ignore Stripe-derived state entirely and render
 * the override view (Active — internal access, $0 / month, etc.).
 */
function isOverrideActive(o) {
  if (!o || o.enabled !== true) return false;
  try {
    if (o.endsAt) {
      const ms = o.endsAt.toMillis ? o.endsAt.toMillis() : Number(o.endsAt);
      if (Number.isFinite(ms) && ms <= Date.now()) return false;
    }
  } catch (_) {
    // If we can't parse endsAt, fail safe → not active.
    return false;
  }
  return true;
}

function renderBilling(data) {
  // Cache so the new card can re-render on next router invocation without
  // waiting for another snapshot.
  _lastBillingData = data || null;
  renderEffective();
}

/**
 * Single source of truth for what the Billing UI should display. Routes to
 * either the override view or the normal Stripe view based on the cached
 * snapshots. Called by both the Stripe and override listeners and by the
 * settings router on view re-entry.
 */
function renderEffective() {
  if (isOverrideActive(_lastOverrideData)) {
    renderLegacyOverrideSection(_lastOverrideData);
    renderNewOverrideCard(_lastOverrideData);
  } else {
    renderLegacyBillingSection(_lastBillingData);
    renderNewBillingCard(_lastBillingData);
  }
}

/**
 * Renders the override state on the new (#userProfileCardBilling) card:
 *   - Status:        "Active — internal access"
 *   - Current Plan:  override.planName
 *   - Monthly Price: $X / month  (typically $0)
 *   - Next Date:     "Until {endsAt}" or "—"
 *   - Subscribe / Manage: hidden (no Stripe interaction needed)
 *   - Invoices:      "—" (no Stripe invoices for comped accounts)
 */
function renderNewOverrideCard(override) {
  const planEl = $(NEW_UI.currentPlan);
  const priceEl = $(NEW_UI.monthlyPrice);
  const statusEl = $(NEW_UI.status);
  const nextDateEl = $(NEW_UI.nextDate);
  const subscribeBtn = $(NEW_UI.subscribeBtn);
  const manageBtn = $(NEW_UI.manageBtn);

  if (!statusEl) return;

  const planName = String(override?.planName || "Fair Flow Internal").trim();
  const price = Number(override?.monthlyPrice ?? 0);

  if (planEl) planEl.textContent = planName || "Fair Flow Internal";
  if (priceEl) {
    priceEl.textContent =
      price === 0 ? "$0 / month" : `$${price} / month`;
  }

  statusEl.textContent = "Active — internal access";
  statusEl.style.color = "#7c3aed"; // Fair Flow purple

  if (nextDateEl) {
    if (override?.endsAt) {
      const dt = fmtPeriodEnd(override.endsAt);
      nextDateEl.textContent = dt ? `Until ${dt}` : "—";
    } else {
      nextDateEl.textContent = "—";
    }
  }

  // Hide payment-related buttons — comped accounts shouldn't go to Stripe.
  if (subscribeBtn) subscribeBtn.style.display = "none";
  if (manageBtn) manageBtn.style.display = "none";

  // No Stripe invoices for an override; clear the table.
  renderInvoicesRow(null);

  hideSyncingIndicator();
}

/**
 * Override variant of the legacy section so users still on the old layout
 * see the comped state correctly. UI parity with the new card.
 */
function renderLegacyOverrideSection(override) {
  const statusLine = $("ffBillingStatusLine");
  const periodLine = $("ffBillingPeriodLine");
  const invoiceLine = $("ffBillingInvoiceLine");
  const subscribeForm = $("ffBillingSubscribeForm");
  const portalBtn = $("ffBillingPortalBtn");
  if (!statusLine || !subscribeForm || !portalBtn) return;

  const planName = String(override?.planName || "Fair Flow Internal").trim();
  statusLine.innerHTML =
    `Status: <strong>Active — internal access</strong>` +
    ` <span style="color:#9ca3af;">(${escapeHtml(planName)})</span>`;

  if (periodLine) {
    if (override?.endsAt) {
      const dt = fmtPeriodEnd(override.endsAt);
      periodLine.textContent = dt ? `Internal access until ${dt}` : "";
    } else {
      periodLine.textContent = "";
    }
  }
  if (invoiceLine) invoiceLine.textContent = "";

  subscribeForm.style.display = "none";
  portalBtn.style.display = "none";
}

function renderLegacyBillingSection(data) {
  const statusLine = $("ffBillingStatusLine");
  const periodLine = $("ffBillingPeriodLine");
  const invoiceLine = $("ffBillingInvoiceLine");
  const subscribeForm = $("ffBillingSubscribeForm");
  const portalBtn = $("ffBillingPortalBtn");
  if (!statusLine || !subscribeForm || !portalBtn) return;

  if (!data) {
    statusLine.textContent = "No subscription yet.";
    if (periodLine) periodLine.textContent = "";
    if (invoiceLine) invoiceLine.textContent = "";
    subscribeForm.style.display = "block";
    portalBtn.style.display = "none";
    return;
  }

  const status = String(data.status || "").toLowerCase();
  const activeStatuses = new Set(["active", "trialing", "past_due"]);
  const hasActive = activeStatuses.has(status);

  const subId = data.subscriptionId ? String(data.subscriptionId) : "";
  statusLine.innerHTML =
    `Status: <strong>${escapeHtml(statusLabel(status))}</strong>` +
    (subId ? ` <span style="color:#9ca3af;">(${escapeHtml(subId)})</span>` : "");

  if (periodLine) {
    if (hasActive && data.currentPeriodEnd) {
      const dt = fmtPeriodEnd(data.currentPeriodEnd);
      const cancel = data.cancelAtPeriodEnd ? " — will cancel at period end" : "";
      periodLine.textContent = dt ? `Current period ends ${dt}${cancel}` : "";
    } else {
      periodLine.textContent = "";
    }
  }

  if (invoiceLine) {
    const inv = data.latestInvoice;
    if (inv && inv.hostedInvoiceUrl) {
      const amount = fmtMoney(inv.amountPaid != null ? inv.amountPaid : inv.amountDue, inv.currency);
      invoiceLine.innerHTML =
        `Latest invoice: <a href="${escapeHtml(inv.hostedInvoiceUrl)}" target="_blank" rel="noopener" style="color:#7c3aed;">${escapeHtml(amount || "view")}</a>`;
    } else {
      invoiceLine.textContent = "";
    }
  }

  subscribeForm.style.display = hasActive ? "none" : "block";
  portalBtn.style.display = data.customerId ? "inline-block" : "none";
}

/**
 * Builds the user-facing plan label from the items map.
 *
 * Examples:
 *   { base:{quantity:1} }                                 → "Fair Flow – Base Plan"
 *   { base:{quantity:1}, location:{quantity:2} }          → "Fair Flow – Base Plan + 2 Locations"
 *   { base:{quantity:1}, storage:{quantity:3} }           → "Fair Flow – Base Plan + 3 × 10GB Storage"
 */
function buildPlanLabel(items) {
  const baseQ = items?.base?.quantity || 0;
  const locQ = items?.location?.quantity || 0;
  const storQ = items?.storage?.quantity || 0;
  if (baseQ === 0 && locQ === 0 && storQ === 0) return "—";
  const extras = [];
  if (locQ > 0) extras.push(`${locQ} Location${locQ > 1 ? "s" : ""}`);
  if (storQ > 0) extras.push(`${storQ} × 10GB Storage`);
  const head = baseQ > 0 ? "Fair Flow – Base Plan" : "Fair Flow – Custom";
  return extras.length ? `${head} + ${extras.join(" + ")}` : head;
}

/** Updates the new mobile-style billing card if it's present in DOM. */
function renderNewBillingCard(data) {
  const statusEl = $(NEW_UI.status);
  if (!statusEl) return; // card not in DOM (legacy-only build)
  const planEl = $(NEW_UI.currentPlan);
  const priceEl = $(NEW_UI.monthlyPrice);
  const nextDateEl = $(NEW_UI.nextDate);
  const subscribeBtn = $(NEW_UI.subscribeBtn);
  const manageBtn = $(NEW_UI.manageBtn);

  if (!data) {
    if (planEl) planEl.textContent = "—";
    if (priceEl) priceEl.textContent = "—";
    statusEl.textContent = "Not connected";
    statusEl.style.color = "#111827";
    if (nextDateEl) nextDateEl.textContent = "—";
    if (subscribeBtn) {
      subscribeBtn.textContent = "Subscribe";
      subscribeBtn.style.display = "";
      subscribeBtn.disabled = false;
    }
    if (manageBtn) manageBtn.style.display = "none";
    renderInvoicesRow(null);
    return;
  }

  const items = data.items || {};
  const baseQ = items.base?.quantity || 0;
  const locQ = items.location?.quantity || 0;
  const storQ = items.storage?.quantity || 0;
  if (planEl) planEl.textContent = buildPlanLabel(items);

  const total = baseQ * PRICE_BASE + locQ * PRICE_LOCATION + storQ * PRICE_STORAGE;
  if (priceEl) priceEl.textContent = total > 0 ? `$${total} / month` : "—";

  const status = String(data.status || "").toLowerCase();
  // While the doc is "stuck" (customerId only — no subscription state yet), we
  // hide the "Unknown" status because triggerSync() is auto-firing in
  // parallel; the syncing indicator below already explains what's happening.
  if (!status && data.customerId) {
    statusEl.textContent = "Updating…";
    statusEl.style.color = "#6b7280";
  } else {
    statusEl.textContent = statusLabel(status);
    if (status === "active" || status === "trialing") {
      statusEl.style.color = "#15803d";
    } else if (status === "past_due") {
      statusEl.style.color = "#b45309";
    } else if (status === "canceled" || status === "incomplete_expired" || status === "unpaid") {
      statusEl.style.color = "#991b1b";
    } else {
      statusEl.style.color = "#111827";
    }
  }

  if (nextDateEl) {
    const dt = data.currentPeriodEnd ? fmtPeriodEnd(data.currentPeriodEnd) : "";
    if (dt && data.cancelAtPeriodEnd) {
      nextDateEl.textContent = `${dt} (cancels at period end)`;
    } else {
      nextDateEl.textContent = dt || "—";
    }
  }

  // Subscribe button: per spec, hide entirely when the subscription is
  // active/trialing — the Manage Billing button takes over from there.
  // Past_due / canceled / incomplete still need a clear call-to-action.
  if (subscribeBtn) {
    if (status === "active" || status === "trialing") {
      subscribeBtn.style.display = "none";
      subscribeBtn.disabled = false;
    } else if (status === "past_due") {
      subscribeBtn.style.display = "";
      subscribeBtn.disabled = false;
      subscribeBtn.textContent = "Update Payment";
    } else if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
      subscribeBtn.style.display = "";
      subscribeBtn.disabled = false;
      subscribeBtn.textContent = "Resubscribe";
    } else if (status === "incomplete") {
      subscribeBtn.style.display = "";
      subscribeBtn.disabled = false;
      subscribeBtn.textContent = "Finish Checkout";
    } else {
      // No status yet (post-checkout, pre-webhook): keep label friendly so
      // the user understands what's happening.
      subscribeBtn.style.display = "";
      subscribeBtn.disabled = false;
      subscribeBtn.textContent = "Subscribe";
    }
  }
  if (manageBtn) {
    // Manage button only useful once a Stripe customer exists.
    manageBtn.style.display = data.customerId ? "" : "none";
  }

  renderInvoicesRow(data.latestInvoice);

  // If the snapshot now has a real subscription, the syncing indicator
  // (if any) is no longer relevant — clear it.
  if (status) hideSyncingIndicator();
}

/** Latest invoice → single row in the Invoices/Receipts table. */
function renderInvoicesRow(inv) {
  const invBody = $(NEW_UI.invoicesBody);
  if (!invBody) return;
  if (inv && inv.id) {
    // Prefer paidAt; fall back to "—" when invoice exists but isn't paid yet.
    const dt = fmtPeriodEnd(inv.paidAt) || "";
    const amount =
      fmtMoney(inv.amountPaid != null ? inv.amountPaid : inv.amountDue, inv.currency) ||
      "—";
    const statusText = String(inv.status || "").replace(/_/g, " ");
    const link = inv.hostedInvoiceUrl
      ? `<a href="${escapeHtml(inv.hostedInvoiceUrl)}" target="_blank" rel="noopener" style="color:#7c3aed;text-decoration:none;font-weight:500;">View</a>`
      : "—";
    invBody.innerHTML =
      `<tr>` +
      `<td style="padding:12px 8px;font-size:12px;color:#111827;">${escapeHtml(dt || "—")}</td>` +
      `<td style="padding:12px 8px;font-size:12px;color:#111827;">Subscription invoice</td>` +
      `<td style="padding:12px 8px;font-size:12px;color:#111827;text-align:right;">${escapeHtml(amount)}</td>` +
      `<td style="padding:12px 8px;font-size:12px;color:#111827;text-align:center;text-transform:capitalize;">${escapeHtml(statusText || "—")}</td>` +
      `<td style="padding:12px 8px;font-size:12px;text-align:center;">${link}</td>` +
      `</tr>`;
  } else {
    invBody.innerHTML =
      `<tr><td colspan="5" style="text-align:center;padding:24px;font-size:12px;color:#111827;">No invoices yet.</td></tr>`;
  }
}

function startListening(salonId) {
  stopListening();
  _currentSalonId = salonId;
  try {
    const stripeRef = doc(db, `salons/${salonId}/billing`, "stripe");
    _unsubBilling = onSnapshot(
      stripeRef,
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        renderBilling(data);
        // Auto-trigger sync if the doc is "stuck" (customer created but
        // webhook hasn't delivered subscription state yet). One attempt per
        // salon per session — once the sync writes, this branch stops firing
        // because data.status / data.subscriptionId are now populated.
        // Skipped entirely when an override is active (no Stripe sub to sync).
        if (
          !isOverrideActive(_lastOverrideData) &&
          (isStuckBillingDoc(data) || hasUnknownItemKeys(data))
        ) {
          triggerSync().catch((e) =>
            console.warn("[BillingCloud] auto-sync raised", e)
          );
        }
      },
      (err) => {
        // Permission errors expected for non-owners; render empty state quietly.
        console.warn("[BillingCloud] subscribe error", err && err.code, err && err.message);
        renderBilling(null);
      }
    );
  } catch (err) {
    console.warn("[BillingCloud] subscribe failed to start", err);
  }

  // Parallel listener for the internal billing override (comped/free
  // accounts). Same auth path as the Stripe doc — owner-only — and falls back
  // to "no override" on permission errors so non-owners still render normally.
  try {
    const overrideRef = doc(db, `salons/${salonId}/billing`, "override");
    _unsubOverride = onSnapshot(
      overrideRef,
      (snap) => {
        _lastOverrideData = snap.exists() ? snap.data() : null;
        // Re-render with whatever Stripe data we already have cached. If the
        // Stripe listener hasn't fired yet, _lastBillingData is null which is
        // fine — renderEffective handles both branches.
        renderEffective();
      },
      (err) => {
        console.warn(
          "[BillingCloud] override subscribe error",
          err && err.code,
          err && err.message
        );
        _lastOverrideData = null;
        renderEffective();
      }
    );
  } catch (err) {
    console.warn("[BillingCloud] override subscribe failed to start", err);
  }
}

function stopListening() {
  if (_unsubBilling) {
    try { _unsubBilling(); } catch (_) {}
    _unsubBilling = null;
  }
  if (_unsubOverride) {
    try { _unsubOverride(); } catch (_) {}
    _unsubOverride = null;
  }
  _currentSalonId = null;
  _lastOverrideData = null;
}

function wireDom() {
  if (_wired) return;
  const checkout = $("ffBillingCheckoutBtn");
  const portal = $("ffBillingPortalBtn");
  const locInput = $("ffBillingLocationQty");
  const storInput = $("ffBillingStorageQty");
  // Section may not exist (e.g. user opened Settings before module finished
  // loading). Try again on next openSettingsSecure call.
  if (!checkout && !portal && !locInput && !storInput) return;
  if (checkout) checkout.addEventListener("click", onCheckoutClick);
  if (portal) portal.addEventListener("click", onPortalClick);
  if (locInput) locInput.addEventListener("input", recalcTotal);
  if (storInput) storInput.addEventListener("input", recalcTotal);
  recalcTotal();
  _wired = true;
}

/** Wires the new-UI #userProfileCardBilling buttons. Idempotent. */
function wireNewCardDom() {
  if (_newCardWired) return;
  const subBtn = $(NEW_UI.subscribeBtn);
  const mgrBtn = $(NEW_UI.manageBtn);
  if (!subBtn && !mgrBtn) return; // card not in DOM yet
  if (subBtn) subBtn.addEventListener("click", onSubscribeUpgradeClick);
  if (mgrBtn) mgrBtn.addEventListener("click", onManageBillingClick);
  _newCardWired = true;
}

/**
 * Called from openSettingsSecure() each time the dialog opens. Idempotent —
 * safe to call repeatedly. Handles owner-gating + listener lifecycle on every
 * open so a salon switch picks up the new salon's billing doc.
 */
function ffInitBillingSection() {
  const section = $("billingSettingsSection");
  if (!section) return;
  const owner = isOwner();
  section.style.display = owner ? "block" : "none";
  if (!owner) {
    stopListening();
    return;
  }
  wireDom();
  const salonId = getSalonId();
  if (!salonId) {
    renderBilling(null);
    return;
  }
  if (salonId !== _currentSalonId) {
    startListening(salonId);
  }
  recalcTotal();
}

window.ffInitBillingSection = ffInitBillingSection;

/**
 * Hook for the new mobile-style Settings UI. The existing router inside
 * initializeUserProfileMenu() (in public/index.html) already calls this if
 * it's defined, so this just needs to:
 *
 *   - Wire the buttons on first call (idempotent).
 *   - Start the Firestore listener if it isn't already running for the
 *     current salon.
 *   - Re-render from cached data so reopening the card while data is
 *     unchanged shows the right state immediately.
 *
 * Owner-gating is enforced both server-side (assertOwnerOfSalon in
 * functions/stripe.js) and via Firestore rules. The new-UI menu item is
 * already hidden for non-owners by ffSyncUserProfileBillingMenuVisibility,
 * so we don't need to hide the card here too.
 */
function updateBillingPanel() {
  // Defense in depth — if a non-owner somehow reaches this code path, do
  // nothing.
  if (!isOwner()) {
    stopListening();
    return;
  }
  wireNewCardDom();
  const salonId = getSalonId();
  if (!salonId) {
    renderEffective();
    return;
  }
  if (salonId !== _currentSalonId) {
    startListening(salonId);
  } else if (_lastBillingData !== null || _lastOverrideData !== null) {
    // Already listening to the right salon — render last known state so the
    // card shows correctly even if neither snapshot refires on reopen.
    renderEffective();
    // If reopened on a stuck doc (e.g. user closed Settings before the
    // webhook arrived and the auto-sync from startListening already ran
    // last time), retry once now. Skip when an override is active — there's
    // no Stripe sub to sync.
    if (
      !isOverrideActive(_lastOverrideData) &&
      _lastBillingData &&
      (isStuckBillingDoc(_lastBillingData) || hasUnknownItemKeys(_lastBillingData))
    ) {
      triggerSync().catch((e) =>
        console.warn("[BillingCloud] reopen sync raised", e)
      );
    }
  } else {
    renderEffective();
  }
}

window.updateBillingPanel = updateBillingPanel;

// ─── Self-bootstrap on late load ─────────────────────────────────────────────
// SafeLoader defers this module by ~3.6s. If the user clicked Settings →
// Billing before the script loaded, the router in initializeUserProfileMenu()
// already rendered the (empty) #userProfileCardBilling card but had to skip
// the call to updateBillingPanel() because window.updateBillingPanel was
// still undefined. The user would see "blank Billing — works only after
// switching tabs and back". Cover that race: if Billing is the visible card
// at script-load time, run updateBillingPanel() now.
//
// Idempotent and cheap — just toggles a Firestore listener that's already
// guarded by `_currentSalonId`.
function bootstrapIfBillingCardVisible() {
  try {
    const card = document.getElementById(NEW_UI.card);
    if (!card) return;
    // Card is shown via inline `style.display = 'block'` from the router;
    // hidden via 'none'. Treat anything non-'none' as visible.
    const styleVisible = card.style.display !== "none";
    // offsetParent === null means the element (or an ancestor) is display:none
    // — required because parents like the userProfileScreen modal might be
    // hidden even if this card has display:'block'.
    const layoutVisible = card.offsetParent !== null;
    if (styleVisible && layoutVisible) {
      updateBillingPanel();
    }
  } catch (e) {
    console.warn("[BillingCloud] bootstrapIfBillingCardVisible failed", e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapIfBillingCardVisible, {
    once: true,
  });
} else {
  bootstrapIfBillingCardVisible();
}

// Stop listener on sign-out so we don't leak across sessions.
onAuthStateChanged(auth, (user) => {
  if (!user) stopListening();
});
