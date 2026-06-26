/**
 * Onboarding Wizard — one-time setup flow for fresh owners.
 *
 * Shown automatically when:
 *   1. The signed-in user has role === "owner".
 *   2. Initial setup is missing a first location or owner PIN.
 *
 * Two-step initial setup:
 *   1. Fill missing first-run setup data: first location and/or owner PIN.
 *   2. Done screen → close wizard and drop the owner into the app.
 *
 * Nothing destructive here — every write is additive. If the user closes the
 * browser mid-way, they can resume on the next login.
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { auth } from "/app.js?v=20260610_force_lp_ios";
import {
  LS_COMPLETED_KEY,
  scopedCompletedKey,
  ffOnbNativeApp,
  validatePin,
} from "./onboarding-utils.js?v=20260625_onboarding_split";
import {
  setError,
  setBusy,
  renderStep,
  showWizardHost,
  focusFirstField,
  hideWizardHost,
  wire,
  readLocationPinInputs,
  readTeammateInputs,
} from "./onboarding-ui.js?v=20260625_onboarding_split";
import {
  shouldShowOnboarding,
  createLocation,
  attachLocationToOwnerStaff,
  createTeammate,
  markOnboardingDone,
  resetOnboardingFlags,
} from "./onboarding-data.js?v=20260625_onboarding_split";

let _running = false;
let _currentStep = 1;
let _resumeStep = 1;
let _createdLocationId = null;
let _createdLocationName = "";
let _currentUser = null;
let _currentSalonId = null;
let _needsLocation = true;
let _needsOwnerPin = true;
let _starting = false;

// -------- UI orchestration (state-owning wrappers over onboarding-ui.js) --------
function showStep(step) {
  _currentStep = step;
  renderStep(step, { needsLocation: _needsLocation, needsOwnerPin: _needsOwnerPin });
}

function openWizard() {
  // New-business onboarding is web-only; never open it in the mobile app.
  if (ffOnbNativeApp()) return;
  if (!showWizardHost()) return;
  _running = true;
  showStep(_resumeStep || 1);
  focusFirstField({ needsLocation: _needsLocation });
}

function closeWizard() {
  hideWizardHost();
  _running = false;
  _currentStep = 1;
  _resumeStep = 1;
  _createdLocationId = null;
  _createdLocationName = "";
}

// -------- Local app integration (non-Firestore side effects) --------
function setActiveLocationLocally(locationId) {
  try {
    window.__ff_active_location_id = locationId;
    localStorage.setItem("ff_active_location_id", locationId);
    document.dispatchEvent(new CustomEvent("ff-active-location-changed", { detail: { id: locationId } }));
  } catch (_) {}
}

// -------- Step handlers --------
async function handleNext() {
  setError("");

  if (_currentStep === 1) {
    const { name, address, ownerPinRaw } = readLocationPinInputs();
    const ownerPin = _needsOwnerPin ? validatePin(ownerPinRaw) : "";
    if (_needsLocation && !name) { setError("Please enter a location name."); return; }
    if (_needsOwnerPin && !ownerPin) { setError("Please enter a 4-6 digit owner PIN."); return; }

    setBusy(true, "Saving…");
    try {
      if (_needsLocation) {
        const created = await createLocation({ salonId: _currentSalonId, name, address });
        _createdLocationId = created.id;
        _createdLocationName = created.name;
        await attachLocationToOwnerStaff({ salonId: _currentSalonId, user: _currentUser, locationId: created.id, pin: ownerPin, assignLocation: true });
        setActiveLocationLocally(created.id);
      } else {
        await attachLocationToOwnerStaff({ salonId: _currentSalonId, user: _currentUser, locationId: _createdLocationId, pin: ownerPin, assignLocation: false });
      }
      await markOnboardingDone({ user: _currentUser, salonId: _currentSalonId, skipped: false });
      setBusy(false, "Continue");
      showStep(3);
    } catch (e) {
      console.error("[Onboarding] createLocation failed:", e);
      setBusy(false, "Continue");
      setError(e?.message || "Could not save. Please try again.");
    }
    return;
  }

  if (_currentStep === 2) {
    const { first, last, role, pin } = readTeammateInputs();

    // Nothing filled in? treat as skip.
    if (!first && !last && !pin) { showStep(3); return; }

    setBusy(true, "Adding…");
    try {
      await createTeammate({ salonId: _currentSalonId, user: _currentUser, createdLocationId: _createdLocationId, firstName: first, lastName: last, role, pin });
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
    await markOnboardingDone({ user: _currentUser, salonId: _currentSalonId, skipped: false });
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
function wireHandlers() {
  wire({ onNext: handleNext, onBack: handleBack, onSkip: handleSkip });
}

async function maybeStart(user) {
  if (_running || _starting) return;
  if (!user) return;
  // Onboarding is web-only. The mobile app is login-only for existing businesses.
  if (ffOnbNativeApp()) return;
  _starting = true;

  try {
    // Wait until currentSalonId is populated (app.js sets this during loadUserRoleAndShowView).
    for (let i = 0; i < 40; i++) {
      if (window.currentSalonId) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    for (let i = 0; i < 10; i++) {
      const body = document.body;
      if (body && !body.classList.contains("ff-logged-out") && !body.classList.contains("ff-auth-resolving")) break;
      await new Promise((r) => setTimeout(r, 150));
    }

    const { show, state } = await shouldShowOnboarding(user);
    if (state) {
      _currentUser = state.currentUser;
      _currentSalonId = state.currentSalonId;
      _resumeStep = state.resumeStep;
      _needsLocation = state.needsLocation;
      _createdLocationId = state.createdLocationId;
      _createdLocationName = state.createdLocationName;
      _needsOwnerPin = state.needsOwnerPin;
    }
    if (!show) return;

    wireHandlers();
    openWizard();
  } finally {
    _starting = false;
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (_running) closeWizard();
    return;
  }
  // Give the rest of the app a short moment to populate profile/role before we check.
  setTimeout(() => { maybeStart(user).catch(() => {}); }, 300);
});

// Manual trigger for debugging / re-opening.
window.ffOpenOnboarding = async function () {
  if (ffOnbNativeApp()) { console.warn("[Onboarding] disabled in mobile app"); return; }
  const user = auth.currentUser;
  if (!user) { console.warn("[Onboarding] not signed in"); return; }
  _currentUser = user;
  for (let i = 0; i < 40; i++) {
    if (window.currentSalonId) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  _currentSalonId = window.currentSalonId || null;
  if (!_currentSalonId) { console.warn("[Onboarding] no salonId"); return; }
  wireHandlers();
  openWizard();
};

// Manual reset for testing: clear the "completed" flag and re-check.
window.ffResetOnboarding = async function () {
  try { localStorage.removeItem(LS_COMPLETED_KEY); } catch (_) {}
  const user = auth.currentUser;
  if (!user) return;
  const salonId = window.currentSalonId || _currentSalonId || "";
  try { localStorage.removeItem(scopedCompletedKey(user, salonId)); } catch (_) {}
  await resetOnboardingFlags({ user });
  console.log("[Onboarding] reset. Call ffOpenOnboarding() or refresh to retrigger.");
};
