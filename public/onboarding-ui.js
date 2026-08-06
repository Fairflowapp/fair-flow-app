/**
 * Onboarding UI — DOM rendering and event wiring (no Firestore, no app state).
 *
 * Extracted verbatim from onboarding-wizard.js. These functions are pure DOM
 * primitives: they read/write the wizard's elements and take everything they
 * need (current step, which fields are required, click handlers) as arguments.
 * The orchestrator (onboarding-wizard.js) still owns the mutable flow state and
 * calls these renderers.
 */

const WIZARD_ID = "ff-onboarding-wizard";

function $(id) { return document.getElementById(id); }

export function setError(msg) {
  const el = $("ffOnboardingError");
  if (!el) return;
  if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
  el.textContent = String(msg);
  el.style.display = "block";
}

export function setBusy(isBusy, nextLabel) {
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

export function renderStep(step, { needsLocation, needsOwnerPin } = {}) {
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
    if (badge) badge.textContent = "Step 1 of 2";
    const needsBoth = needsLocation && needsOwnerPin;
    if (title) title.textContent = needsBoth ? "Complete your setup" : (needsLocation ? "Add your first location" : "Add your owner PIN");
    if (sub) sub.textContent = needsBoth
      ? "Add the missing details needed to open the app."
      : (needsLocation ? "Where will your team be working from?" : "Set the owner code used for admin actions.");
    const locationDisplay = needsLocation ? "block" : "none";
    const pinDisplay = needsOwnerPin ? "block" : "none";
    const locNameWrap = $("ffOnbLocationNameWrap");
    const locAddressWrap = $("ffOnbLocationAddressWrap");
    const pinWrap = $("ffOnbOwnerPinWrap");
    if (locNameWrap) locNameWrap.style.display = locationDisplay;
    if (locAddressWrap) locAddressWrap.style.display = locationDisplay;
    if (pinWrap) pinWrap.style.display = pinDisplay;
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
    if (badge) badge.textContent = "Step 2 of 2";
    if (title) title.textContent = "You're ready to go";
    if (sub) sub.textContent = "Your salon is set up. Welcome aboard!";
    if (nextBtn) nextBtn.textContent = "Go to my Queue";
    if (backBtn) backBtn.style.display = "none";
    if (skipBtn) skipBtn.style.display = "none";
  }

  setError("");
}

/** Shows the wizard host. Returns false if the host element is not present. */
export function showWizardHost() {
  const host = $(WIZARD_ID);
  if (!host) return false;
  host.style.display = "flex";
  return true;
}

export function focusFirstField({ needsLocation } = {}) {
  setTimeout(() => {
    try {
      const focusTarget = needsLocation ? $("ffOnbLocationName") : $("ffOnbOwnerPin");
      focusTarget?.focus();
    } catch (_) {}
  }, 50);
}

/** Hides the wizard host and clears inputs so a future reopen is clean. */
export function hideWizardHost() {
  const host = $(WIZARD_ID);
  if (host) host.style.display = "none";
  ["ffOnbLocationName","ffOnbLocationAddress","ffOnbOwnerPin","ffOnbStaffFirstName","ffOnbStaffLastName","ffOnbStaffPin"].forEach((id) => {
    const el = $(id); if (el) el.value = "";
  });
}

export function wire({ onNext, onBack, onSkip } = {}) {
  const nextBtn = $("ffOnboardingNext");
  const backBtn = $("ffOnboardingBack");
  const skipBtn = $("ffOnboardingSkip");
  if (nextBtn && !nextBtn.dataset.ffWired) {
    nextBtn.addEventListener("click", onNext);
    nextBtn.dataset.ffWired = "1";
  }
  if (backBtn && !backBtn.dataset.ffWired) {
    backBtn.addEventListener("click", onBack);
    backBtn.dataset.ffWired = "1";
  }
  if (skipBtn && !skipBtn.dataset.ffWired) {
    skipBtn.addEventListener("click", onSkip);
    skipBtn.dataset.ffWired = "1";
  }
  // Enter key submits the current step from the inputs.
  ["ffOnbLocationName","ffOnbLocationAddress","ffOnbOwnerPin","ffOnbStaffFirstName","ffOnbStaffLastName","ffOnbStaffPin"].forEach((id) => {
    const el = $(id);
    if (el && !el.dataset.ffWired) {
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); onNext(); }
      });
      el.dataset.ffWired = "1";
    }
  });
}

/** Step-1 form values. ownerPinRaw is the raw input (validation lives in the orchestrator). */
export function readLocationPinInputs() {
  return {
    name: String($("ffOnbLocationName")?.value || "").trim(),
    address: String($("ffOnbLocationAddress")?.value || "").trim(),
    ownerPinRaw: $("ffOnbOwnerPin")?.value,
  };
}

/** Step-2 form values. */
export function readTeammateInputs() {
  return {
    first: String($("ffOnbStaffFirstName")?.value || "").trim(),
    last: String($("ffOnbStaffLastName")?.value || "").trim(),
    role: String($("ffOnbStaffRole")?.value || "technician"),
    pin: String($("ffOnbStaffPin")?.value || "").trim(),
  };
}
