/**
 * Locations Management UI — lives inside Settings (User Profile) under the
 * "Locations" section. Owners/managers can add, edit, deactivate and reactivate
 * locations. No separate modal is used — this mirrors MangoMint's "Business
 * Setup → Locations" pattern.
 *
 * Reads live state from window.ffLocationsState (populated by locations-cloud.js).
 * Writes go straight to Firestore at salons/{salonId}/locations/{locationId}.
 *
 * Public API:
 *   - window.ffOpenLocationsModal()      → navigates to Settings → Locations
 *     (kept as the legacy name so older callers keep working).
 *   - window.ffRenderLocationsSettings() → re-renders the list into the card.
 */

import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { db, auth } from "/app.js?v=20260602_initial_billing_gate";

const CARD_ID = "userProfileCardLocations";
const FUNCTIONS_REGION = "us-central1";
const PAID_LOCATION_CONFIRM_MESSAGE =
  "Your first location is included in your base plan. Each additional location costs $79/month. If you continue, your subscription will be updated automatically.";

let _editingId = null; // null → add-new; string → editing that location

function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function currentSalonId() {
  return window.currentSalonId || null;
}

function getAllLocations() {
  if (typeof window.ffGetLocations === "function") {
    return window.ffGetLocations();
  }
  const list = window.ffLocationsState?.locations;
  return Array.isArray(list) ? list : [];
}

function countActiveLocations() {
  return getAllLocations().filter((loc) => loc && loc.isActive !== false).length;
}

async function countActiveLocationsFresh(salonId) {
  if (!salonId) return countActiveLocations();
  try {
    const snap = await getDocs(collection(db, `salons/${salonId}/locations`));
    return snap.docs.filter((d) => {
      const data = d.data() || {};
      return data.isActive !== false;
    }).length;
  } catch (e) {
    console.warn("[LocationsManage] fresh active location count failed; using cached count", e?.code, e?.message);
    return countActiveLocations();
  }
}

function isCardVisible() {
  const card = $(CARD_ID);
  if (!card) return false;
  return window.getComputedStyle(card).display !== "none";
}

function renderList() {
  const listEl = $("ffLocationsList");
  if (!listEl) return;
  const locations = getAllLocations();

  if (!locations.length) {
    listEl.innerHTML = `
      <div style="padding:16px;text-align:center;color:#6b7280;font-size:13px;background:#f9fafb;border-radius:10px;">
        No locations yet. Click <strong>Add new location</strong> below to create your first one.
      </div>`;
    return;
  }

  listEl.innerHTML = locations.map((loc) => {
    const id = loc.id || "";
    const name = loc.name || "(unnamed)";
    const address = loc.address || "";
    const isActive = loc.isActive !== false;
    return `
      <div class="ff-loc-row" data-id="${escapeHtml(id)}"
           style="display:flex;align-items:center;gap:8px;padding:4px 10px;margin-bottom:3px;border:1px solid var(--border, #e5e7eb);border-radius:6px;background:#f9fafb;transition:background 0.15s, opacity 0.15s;">
        <div style="width:6px;height:6px;border-radius:50%;background:${isActive ? "#10b981" : "#9ca3af"};flex-shrink:0;" title="${isActive ? "Active" : "Inactive"}"></div>
        <div style="flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;">
          <div style="font-size:11px;font-weight:500;color:${isActive ? "#111827" : "#9ca3af"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${isActive ? "" : "text-decoration:line-through;"}">
            ${escapeHtml(name)}
          </div>
          ${address ? `<div style="font-size:10px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(address)}</div>` : ""}
        </div>
        <button type="button" class="ff-loc-toggle" data-id="${escapeHtml(id)}" data-active="${isActive}"
                title="${isActive ? "Deactivate" : "Reactivate"}"
                style="border:1px solid ${isActive ? "#fecaca" : "#10b981"};background:${isActive ? "#fff" : "#d1fae5"};cursor:pointer;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;color:${isActive ? "#b91c1c" : "#065f46"};">
          ${isActive ? "Deactivate" : "Reactivate"}
        </button>
        <button type="button" class="ff-loc-edit" data-id="${escapeHtml(id)}"
                title="Edit"
                style="border:1px solid #a78bfa;background:#ede9fe;cursor:pointer;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;color:#7c3aed;">
          Edit
        </button>
      </div>`;
  }).join("");

  listEl.querySelectorAll(".ff-loc-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      startEdit(id);
    });
  });
  listEl.querySelectorAll(".ff-loc-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const currentlyActive = btn.getAttribute("data-active") === "true";
      toggleActive(id, !currentlyActive);
    });
  });
}

function openForm(mode, loc) {
  _editingId = mode === "edit" && loc ? loc.id : null;
  const card = $("ffLocationFormCard");
  const title = $("ffLocationFormTitle");
  const nameEl = $("ffLocationFormName");
  const addrEl = $("ffLocationFormAddress");
  const err = $("ffLocationFormError");
  const addBtn = $("ffLocationsAddBtn");

  if (title) title.textContent = mode === "edit" ? "Edit location" : "Add new location";
  if (nameEl) nameEl.value = mode === "edit" ? (loc?.name || "") : "";
  if (addrEl) addrEl.value = mode === "edit" ? (loc?.address || "") : "";
  if (err) { err.style.display = "none"; err.textContent = ""; }
  if (card) card.style.display = "block";
  if (addBtn) addBtn.style.display = mode === "edit" ? "none" : "flex";
  setTimeout(() => { try { nameEl?.focus(); } catch (_) {} }, 30);
}

function closeForm() {
  _editingId = null;
  const card = $("ffLocationFormCard");
  const addBtn = $("ffLocationsAddBtn");
  if (card) card.style.display = "none";
  if (addBtn) addBtn.style.display = "flex";
}

function startEdit(id) {
  const loc = getAllLocations().find((l) => l.id === id);
  if (!loc) return;
  openForm("edit", loc);
}

function setFormBusy(isBusy) {
  const save = $("ffLocationFormSave");
  const cancel = $("ffLocationFormCancel");
  if (save) {
    save.disabled = !!isBusy;
    save.style.opacity = isBusy ? "0.6" : "1";
    save.textContent = isBusy ? "Saving…" : "Save";
  }
  if (cancel) cancel.disabled = !!isBusy;
}

function showFormError(msg) {
  const err = $("ffLocationFormError");
  if (!err) return;
  if (!msg) { err.style.display = "none"; err.textContent = ""; return; }
  err.textContent = msg;
  err.style.display = "block";
}

function showPaidLocationConfirm() {
  return new Promise((resolve) => {
    document.getElementById("ffPaidLocationConfirm")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "ffPaidLocationConfirm";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483500;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;";
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="ffPaidLocationConfirmTitle" style="width:min(460px,100%);background:#fff;border-radius:18px;padding:24px;box-shadow:0 24px 70px rgba(15,23,42,.28);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
        <div id="ffPaidLocationConfirmTitle" style="font-size:18px;font-weight:800;margin-bottom:10px;">Add paid location?</div>
        <div style="font-size:14px;line-height:1.55;color:#4b5563;margin-bottom:22px;">${escapeHtml(PAID_LOCATION_CONFIRM_MESSAGE)}</div>
        <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
          <button type="button" data-ff-paid-location-cancel style="padding:10px 16px;border-radius:999px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-size:13px;font-weight:800;cursor:pointer;">Cancel</button>
          <button type="button" data-ff-paid-location-confirm style="padding:10px 16px;border-radius:999px;border:0;background:#7c3aed;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">Confirm &amp; Add Location</button>
        </div>
      </div>
    `;

    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
    });
    overlay.querySelector("[data-ff-paid-location-cancel]")?.addEventListener("click", () => finish(false));
    overlay.querySelector("[data-ff-paid-location-confirm]")?.addEventListener("click", () => finish(true));
    document.body.appendChild(overlay);
    setTimeout(() => {
      try { overlay.querySelector("[data-ff-paid-location-confirm]")?.focus(); } catch (_) {}
    }, 0);
  });
}

async function syncPaidLocationQuantityOrThrow(desiredActiveLocationCount) {
  const salonId = currentSalonId();
  if (!salonId) throw new Error("Salon not ready. Please try again in a moment.");
  const fn = httpsCallable(
    getFunctions(undefined, FUNCTIONS_REGION),
    "syncStripeLocationQuantity"
  );
  await fn({ salonId, desiredActiveLocationCount });
}

async function confirmAndSyncPaidLocationIfNeeded(desiredActiveLocationCount) {
  if (desiredActiveLocationCount <= 1) return true;
  const confirmed = await showPaidLocationConfirm();
  if (!confirmed) return false;
  await syncPaidLocationQuantityOrThrow(desiredActiveLocationCount);
  return true;
}

async function saveForm() {
  const salonId = currentSalonId();
  if (!salonId) { showFormError("Salon not ready. Please try again in a moment."); return; }

  const name = String($("ffLocationFormName")?.value || "").trim();
  const address = String($("ffLocationFormAddress")?.value || "").trim();

  if (!name) { showFormError("Please enter a location name."); return; }

  try {
    if (_editingId) {
      setFormBusy(true);
      const ref = doc(db, `salons/${salonId}/locations`, _editingId);
      await updateDoc(ref, { name, address, updatedAt: serverTimestamp() });
    } else {
      const desiredActiveLocationCount = (await countActiveLocationsFresh(salonId)) + 1;
      const canContinue = await confirmAndSyncPaidLocationIfNeeded(desiredActiveLocationCount);
      if (!canContinue) return;

      setFormBusy(true);
      const ref = collection(db, `salons/${salonId}/locations`);
      await addDoc(ref, {
        name,
        address,
        lat: null,
        lng: null,
        allowedRadiusMeters: null,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    setFormBusy(false);
    closeForm();
    // onSnapshot in locations-cloud.js will fire ff-locations-updated and we
    // re-render there; do it now too for snappy feedback.
    renderList();
  } catch (e) {
    console.error("[LocationsManage] save failed:", e);
    setFormBusy(false);
    showFormError(e?.message || "Could not save. Please try again.");
  }
}

async function toggleActive(id, makeActive) {
  const salonId = currentSalonId();
  if (!salonId || !id) return;
  try {
    if (makeActive) {
      const loc = getAllLocations().find((item) => item && item.id === id);
      const isCurrentlyActive = loc && loc.isActive !== false;
      if (!isCurrentlyActive) {
        const desiredActiveLocationCount = (await countActiveLocationsFresh(salonId)) + 1;
        const canContinue = await confirmAndSyncPaidLocationIfNeeded(desiredActiveLocationCount);
        if (!canContinue) return;
      }
    }
    const ref = doc(db, `salons/${salonId}/locations`, id);
    await updateDoc(ref, { isActive: !!makeActive, updatedAt: serverTimestamp() });
    renderList();
  } catch (e) {
    console.error("[LocationsManage] toggleActive failed:", e);
    const msg = e?.message || "Could not update the location. Please try again.";
    if (typeof window.ffStyledAlert === "function") window.ffStyledAlert(msg, "Location billing");
    else alert(msg);
  }
}

// Public: render the list into the Settings card (called by the settings
// section switcher in index.html when the user clicks "Locations").
function renderSettings() {
  try {
    if (typeof window.ffLocationsForceLoad === "function") {
      window.ffLocationsForceLoad();
    }
  } catch (_) {}
  closeForm();
  renderList();
}

// Back-compat: older callers (Apps panel tile, etc.) still call
// ffOpenLocationsModal(). Now it just navigates to Settings → Locations.
function openInSettings() {
  try {
    if (typeof window.goToUserProfile === "function") {
      window.goToUserProfile();
    }
  } catch (_) {}
  // Activate the "locations" side-menu item. Its click handler will call
  // renderSettings() via the section dispatcher in index.html.
  setTimeout(() => {
    try {
      const btn = document.querySelector(
        '#userProfileScreen .user-profile-menu-item[data-section="locations"]'
      );
      if (btn) btn.click();
      else renderSettings();
    } catch (_) {
      renderSettings();
    }
  }, 50);
}

window.ffOpenLocationsModal = openInSettings; // legacy alias
window.ffRenderLocationsSettings = renderSettings;

function wire() {
  const addBtn = $("ffLocationsAddBtn");
  if (addBtn && !addBtn.dataset.ffWired) {
    addBtn.addEventListener("click", () => openForm("add"));
    addBtn.dataset.ffWired = "1";
  }
  const saveBtn = $("ffLocationFormSave");
  if (saveBtn && !saveBtn.dataset.ffWired) {
    saveBtn.addEventListener("click", saveForm);
    saveBtn.dataset.ffWired = "1";
  }
  const cancelBtn = $("ffLocationFormCancel");
  if (cancelBtn && !cancelBtn.dataset.ffWired) {
    cancelBtn.addEventListener("click", closeForm);
    cancelBtn.dataset.ffWired = "1";
  }
  if (!window.__ffLocationsManageBound) {
    window.__ffLocationsManageBound = true;
    // Re-render when upstream locations change, but only if the Settings card
    // is currently on-screen — otherwise it's a no-op.
    document.addEventListener("ff-locations-updated", () => {
      if (isCardVisible()) renderList();
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire);
} else {
  wire();
}
