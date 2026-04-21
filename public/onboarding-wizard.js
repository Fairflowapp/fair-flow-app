/**
 * Onboarding Wizard — one-time setup flow for fresh owners.
 *
 * Shown automatically when:
 *   1. The signed-in user has role === "owner".
 *   2. Their users/{uid} doc has no onboardingCompletedAt / onboardingSkippedAt.
 *   3. Their salons/{salonId}/locations collection is empty.
 *
 * Three steps:
 *   1. Create the first location  (required).
 *   2. Create the first teammate (optional — skip allowed).
 *   3. Done screen → close wizard and drop the owner into the app.
 *
 * Nothing destructive here — every write is additive. If the user closes the
 * browser mid-way, they can resume on the next login (as long as no location
 * exists yet).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "./app.js?v=20260411_chat_reminder_attrfix";

const LS_COMPLETED_KEY = "ff_onboarding_completed_v1";
const WIZARD_ID = "ff-onboarding-wizard";

let _running = false;
let _currentStep = 1;
let _createdLocationId = null;
let _createdLocationName = "";
let _currentUser = null;
let _currentSalonId = null;

// -------- UI helpers --------
function $(id) { return document.getElementById(id); }

function setError(msg) {
  const el = $("ffOnboardingError");
  if (!el) return;
  if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
  el.textContent = String(msg);
  el.style.display = "block";
}

function setBusy(isBusy, nextLabel) {
  const nextBtn = $("ffOnboardingNext");
  const backBtn = $("ffOnboardingBack");
  const skipBtn = $("ffOnboardingSkip");
  if (nextBtn) {
    nextBtn.disabled = !!isBusy;
    nextBtn.style.opacity = isBusy ? "0.6" : "1";
    nextBtn.style.cursor = isBusy ? "wait" : "pointer";
    if (nextLabel) nextBtn.textContent = nextLabel;
  }
  if (backBtn) backBtn.disabled = !!isBusy;
  if (skipBtn) skipBtn.disabled = !!isBusy;
}

function paintPills(step) {
  document.querySelectorAll(".ff-onb-pill").forEach((pill) => {
    const n = Number(pill.getAttribute("data-step") || "0");
    pill.style.background = n <= step ? "#a855f7" : "#e5e7eb";
  });
}

function showStep(step) {
  _currentStep = step;
  paintPills(step);

  const s1 = $("ffOnboardingStep1");
  const s2 = $("ffOnboardingStep2");
  const s3 = $("ffOnboardingStep3");
  if (s1) s1.style.display = step === 1 ? "block" : "none";
  if (s2) s2.style.display = step === 2 ? "block" : "none";
  if (s3) s3.style.display = step === 3 ? "block" : "none";

  const badge = $("ffOnboardingStepBadge");
  const title = $("ffOnboardingTitle");
  const sub = $("ffOnboardingSubtitle");
  const nextBtn = $("ffOnboardingNext");
  const backBtn = $("ffOnboardingBack");
  const skipBtn = $("ffOnboardingSkip");

  if (step === 1) {
    if (badge) badge.textContent = "Step 1 of 3";
    if (title) title.textContent = "Add your first location";
    if (sub) sub.textContent = "Where will your team be working from?";
    if (nextBtn) nextBtn.textContent = "Continue";
    if (backBtn) backBtn.style.display = "none";
    if (skipBtn) skipBtn.style.display = "none"; // step 1 is required
  } else if (step === 2) {
    if (badge) badge.textContent = "Step 2 of 3";
    if (title) title.textContent = "Add your first teammate";
    if (sub) sub.textContent = "Optional — you can always add staff later.";
    if (nextBtn) nextBtn.textContent = "Add teammate";
    if (backBtn) backBtn.style.display = "inline-block";
    if (skipBtn) skipBtn.style.display = "inline-block";
  } else if (step === 3) {
    if (badge) badge.textContent = "Step 3 of 3";
    if (title) title.textContent = "You're ready to go";
    if (sub) sub.textContent = "Your salon is set up. Welcome aboard!";
    if (nextBtn) nextBtn.textContent = "Go to my Queue";
    if (backBtn) backBtn.style.display = "none";
    if (skipBtn) skipBtn.style.display = "none";
  }

  setError("");
}

function openWizard() {
  const host = $(WIZARD_ID);
  if (!host) return;
  host.style.display = "flex";
  _running = true;
  showStep(1);
  setTimeout(() => { try { $("ffOnbLocationName")?.focus(); } catch (_) {} }, 50);
}

function closeWizard() {
  const host = $(WIZARD_ID);
  if (host) host.style.display = "none";
  _running = false;
  _currentStep = 1;
  _createdLocationId = null;
  _createdLocationName = "";
  // Clear inputs so a future reopen is clean
  ["ffOnbLocationName","ffOnbLocationAddress","ffOnbStaffFirstName","ffOnbStaffLastName","ffOnbStaffPin"].forEach((id) => {
    const el = $(id); if (el) el.value = "";
  });
}

// -------- Business logic --------
async function shouldShowOnboarding(user) {
  try {
    if (!user || !user.uid) return false;
    if (localStorage.getItem(LS_COMPLETED_KEY) === "1") return false;

    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (!userSnap.exists()) return false;
    const u = userSnap.data() || {};

    const role = String(u.role || "").toLowerCase();
    if (role !== "owner") return false;
    if (u.onboardingCompletedAt || u.onboardingSkippedAt) {
      try { localStorage.setItem(LS_COMPLETED_KEY, "1"); } catch (_) {}
      return false;
    }

    const salonId = u.salonId ? String(u.salonId).trim() : "";
    if (!salonId) return false;

    // If there's already any location, skip the wizard — owner has used the app before.
    const locSnap = await getDocs(collection(db, `salons/${salonId}/locations`));
    if (!locSnap.empty) {
      try { await updateDoc(doc(db, "users", user.uid), { onboardingCompletedAt: serverTimestamp() }); } catch (_) {}
      try { localStorage.setItem(LS_COMPLETED_KEY, "1"); } catch (_) {}
      return false;
    }

    _currentUser = user;
    _currentSalonId = salonId;
    return true;
  } catch (e) {
    console.warn("[Onboarding] shouldShow check failed:", e?.code, e?.message);
    return false;
  }
}

async function createLocation({ name, address }) {
  const payload = {
    name: String(name || "").trim(),
    address: String(address || "").trim(),
    lat: null,
    lng: null,
    allowedRadiusMeters: null,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, `salons/${_currentSalonId}/locations`), payload);
  return { id: ref.id, name: payload.name };
}

async function attachLocationToOwnerStaff(locationId) {
  try {
    const uid = _currentUser?.uid;
    if (!uid) return;
    const staffId = `staff_${uid}`;
    const staffRef = doc(db, `salons/${_currentSalonId}/staff`, staffId);
    await setDoc(
      staffRef,
      {
        allowedLocationIds: [locationId],
        primaryLocationId: locationId,
      },
      { merge: true },
    );
  } catch (e) {
    console.warn("[Onboarding] could not attach location to owner staff:", e?.code, e?.message);
  }
}

function setActiveLocationLocally(locationId) {
  try {
    window.__ff_active_location_id = locationId;
    localStorage.setItem("ff_active_location_id", locationId);
    document.dispatchEvent(new CustomEvent("ff-active-location-changed", { detail: { id: locationId } }));
  } catch (_) {}
}

function validatePin(raw) {
  const v = String(raw || "").trim();
  if (!/^[0-9]{4,6}$/.test(v)) return null;
  return v;
}

async function createTeammate({ firstName, lastName, role, pin }) {
  const name = `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();
  if (!name) throw new Error("Please enter a name.");
  const safePin = validatePin(pin);
  if (!safePin) throw new Error("PIN must be 4–6 digits.");

  const roleLc = String(role || "technician").toLowerCase();
  const isAdmin = roleLc === "admin";
  const isManager = roleLc === "manager";

  const staffId = `staff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    id: staffId,
    name,
    email: "",
    role: roleLc,
    isAdmin,
    isManager,
    isArchived: false,
    invited: false,
    inviteStatus: "not_invited",
    pin: safePin,
    technicianTypes: [],
    allowedLocationIds: _createdLocationId ? [_createdLocationId] : [],
    primaryLocationId: _createdLocationId || null,
    createdAt: Date.now(),
    _syncedAt: serverTimestamp(),
  };
  const staffRef = doc(db, `salons/${_currentSalonId}/staff`, staffId);
  await setDoc(staffRef, payload, { merge: false });
  return staffId;
}

async function markOnboardingDone({ skipped }) {
  try {
    if (!_currentUser?.uid) return;
    await updateDoc(doc(db, "users", _currentUser.uid), skipped
      ? { onboardingSkippedAt: serverTimestamp() }
      : { onboardingCompletedAt: serverTimestamp() });
  } catch (e) {
    console.warn("[Onboarding] mark-done write failed:", e?.code, e?.message);
  }
  try { localStorage.setItem(LS_COMPLETED_KEY, "1"); } catch (_) {}
}

// -------- Step handlers --------
async function handleNext() {
  setError("");

  if (_currentStep === 1) {
    const name = String($("ffOnbLocationName")?.value || "").trim();
    const address = String($("ffOnbLocationAddress")?.value || "").trim();
    if (!name) { setError("Please enter a location name."); return; }

    setBusy(true, "Saving…");
    try {
      const created = await createLocation({ name, address });
      _createdLocationId = created.id;
      _createdLocationName = created.name;
      await attachLocationToOwnerStaff(created.id);
      setActiveLocationLocally(created.id);
      setBusy(false, "Continue");
      showStep(2);
    } catch (e) {
      console.error("[Onboarding] createLocation failed:", e);
      setBusy(false, "Continue");
      setError(e?.message || "Could not save. Please try again.");
    }
    return;
  }

  if (_currentStep === 2) {
    const first = String($("ffOnbStaffFirstName")?.value || "").trim();
    const last = String($("ffOnbStaffLastName")?.value || "").trim();
    const role = String($("ffOnbStaffRole")?.value || "technician");
    const pin = String($("ffOnbStaffPin")?.value || "").trim();

    // Nothing filled in? treat as skip.
    if (!first && !last && !pin) { showStep(3); return; }

    setBusy(true, "Adding…");
    try {
      await createTeammate({ firstName: first, lastName: last, role, pin });
      setBusy(false, "Add teammate");
      showStep(3);
    } catch (e) {
      console.error("[Onboarding] createTeammate failed:", e);
      setBusy(false, "Add teammate");
      setError(e?.message || "Could not add teammate. Please try again.");
    }
    return;
  }

  if (_currentStep === 3) {
    setBusy(true, "Finishing…");
    await markOnboardingDone({ skipped: false });
    setBusy(false, "Go to my Queue");
    closeWizard();
    try { if (typeof window.goToQueue === "function") window.goToQueue(); } catch (_) {}
    return;
  }
}

function handleBack() {
  if (_currentStep === 2) showStep(1);
  else if (_currentStep === 3) showStep(2);
}

async function handleSkip() {
  // Skip is only shown on step 2. It jumps to the done screen without writing a staff doc.
  if (_currentStep === 2) { showStep(3); return; }
}

// -------- Boot --------
function wire() {
  const nextBtn = $("ffOnboardingNext");
  const backBtn = $("ffOnboardingBack");
  const skipBtn = $("ffOnboardingSkip");
  if (nextBtn && !nextBtn.dataset.ffWired) {
    nextBtn.addEventListener("click", handleNext);
    nextBtn.dataset.ffWired = "1";
  }
  if (backBtn && !backBtn.dataset.ffWired) {
    backBtn.addEventListener("click", handleBack);
    backBtn.dataset.ffWired = "1";
  }
  if (skipBtn && !skipBtn.dataset.ffWired) {
    skipBtn.addEventListener("click", handleSkip);
    skipBtn.dataset.ffWired = "1";
  }
  // Enter key submits the current step from the inputs.
  ["ffOnbLocationName","ffOnbLocationAddress","ffOnbStaffFirstName","ffOnbStaffLastName","ffOnbStaffPin"].forEach((id) => {
    const el = $(id);
    if (el && !el.dataset.ffWired) {
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); handleNext(); }
      });
      el.dataset.ffWired = "1";
    }
  });
}

async function maybeStart(user) {
  if (_running) return;
  if (!user) return;

  // Wait until currentSalonId is populated (app.js sets this during loadUserRoleAndShowView).
  for (let i = 0; i < 40; i++) {
    if (window.currentSalonId) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  const ok = await shouldShowOnboarding(user);
  if (!ok) return;

  wire();
  openWizard();
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (_running) closeWizard();
    return;
  }
  // Give the rest of the app a moment to load profile/role before we check.
  setTimeout(() => { maybeStart(user).catch(() => {}); }, 1500);
});

// Manual trigger for debugging / re-opening.
window.ffOpenOnboarding = async function () {
  const user = auth.currentUser;
  if (!user) { console.warn("[Onboarding] not signed in"); return; }
  _currentUser = user;
  for (let i = 0; i < 40; i++) {
    if (window.currentSalonId) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  _currentSalonId = window.currentSalonId || null;
  if (!_currentSalonId) { console.warn("[Onboarding] no salonId"); return; }
  wire();
  openWizard();
};

// Manual reset for testing: clear the "completed" flag and re-check.
window.ffResetOnboarding = async function () {
  try { localStorage.removeItem(LS_COMPLETED_KEY); } catch (_) {}
  const user = auth.currentUser;
  if (!user) return;
  try {
    await updateDoc(doc(db, "users", user.uid), {
      onboardingCompletedAt: null,
      onboardingSkippedAt: null,
    });
  } catch (_) {}
  console.log("[Onboarding] reset. Call ffOpenOnboarding() or refresh to retrigger.");
};
