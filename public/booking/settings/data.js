/**
 * Booking settings repository.
 * Salon-wide policy on salons/{salonId}/settings/main.booking
 */
import { doc, serverTimestamp, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";

function model() {
  return window.ffBookingSettingsModel || null;
}

function currentSalonId() {
  return String(window.currentSalonId || "").trim();
}

function settingsMainRef(salonId) {
  return doc(db, `salons/${salonId}/settings`, "main");
}

function emitChanged() {
  try {
    document.dispatchEvent(new CustomEvent("ff-booking-settings-changed"));
  } catch (_) {}
}

function applyBookingBlob(raw) {
  if (typeof window.settings !== "object" || !window.settings) window.settings = {};
  if (raw && typeof raw === "object") {
    window.settings.booking = {
      allowedOverlapMinutes: model() ? model().normalizeMinutes(raw.allowedOverlapMinutes) : 0
    };
  } else if (window.settings.booking) {
    delete window.settings.booking;
  }
  emitChanged();
}

function canEdit() {
  try {
    if (typeof window.ffIsOwner === "function" && window.ffIsOwner()) return true;
  } catch (_) {}
  try {
    var staff = window.currentUserProfile || window.__ff_authedStaff || {};
    var role = String(staff.role || "").toLowerCase();
    if (role === "owner" || role === "admin" || role === "manager") return true;
    return !!(staff.isOwner || staff.isAdmin || staff.isManager);
  } catch (_) {
    return false;
  }
}

function allowedOverlapMinutes() {
  return model() ? model().allowedMinutes() : 0;
}

function hydrateFromWindow() {
  var raw = window.settings && window.settings.booking;
  if (raw && typeof raw === "object" && model()) {
    window.settings.booking = {
      allowedOverlapMinutes: model().normalizeMinutes(raw.allowedOverlapMinutes)
    };
  }
  return allowedOverlapMinutes();
}

async function saveAllowedOverlapMinutes(minutes) {
  if (!canEdit()) {
    return { ok: false, error: "Only an owner or manager can change booking settings." };
  }
  var api = model();
  if (!api) return { ok: false, error: "Booking settings are not ready." };
  var salonId = currentSalonId();
  if (!salonId) return { ok: false, error: "No salon is selected." };
  var next = api.normalizeMinutes(minutes);
  if (typeof window.settings !== "object" || !window.settings) window.settings = {};
  window.settings.booking = { allowedOverlapMinutes: next };
  emitChanged();
  var payload = {
    "booking.allowedOverlapMinutes": next,
    updatedAt: serverTimestamp()
  };
  try {
    await updateDoc(settingsMainRef(salonId), payload);
  } catch (err) {
    if (err && err.code === "not-found") {
      try {
        await setDoc(settingsMainRef(salonId), {
          booking: { allowedOverlapMinutes: next },
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (inner) {
        return { ok: false, error: inner && inner.message ? inner.message : "Could not save booking settings." };
      }
    } else {
      return { ok: false, error: err && err.message ? err.message : "Could not save booking settings." };
    }
  }
  return { ok: true, allowedOverlapMinutes: next };
}

const api = {
  canEdit: canEdit,
  allowedOverlapMinutes: allowedOverlapMinutes,
  hydrateFromWindow: hydrateFromWindow,
  applyBookingBlob: applyBookingBlob,
  saveAllowedOverlapMinutes: saveAllowedOverlapMinutes
};

window.ffBookingSettings = api;
export {
  canEdit,
  allowedOverlapMinutes,
  hydrateFromWindow,
  applyBookingBlob,
  saveAllowedOverlapMinutes
};
