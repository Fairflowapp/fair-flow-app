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

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260509_staffid_notify";

const LS_COMPLETED_KEY = "ff_onboarding_completed_v1";
const WIZARD_ID = "ff-onboarding-wizard";

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

// -------- UI helpers --------
function $(id) { return document.getElementById(id); }

function scopedCompletedKey(user, salonId) {
  const uid = user?.uid ? String(user.uid).trim() : "anon";
  const sid = salonId ? String(salonId).trim() : "nosalon";
  return `${LS_COMPLETED_KEY}_${uid}_${sid}`;
}

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
    if (badge) badge.textContent = "Step 1 of 2";
    const needsBoth = _needsLocation && _needsOwnerPin;
    if (title) title.textContent = needsBoth ? "Complete your setup" : (_needsLocation ? "Add your first location" : "Add your owner PIN");
    if (sub) sub.textContent = needsBoth
      ? "Add the missing details needed to open the app."
      : (_needsLocation ? "Where will your team be working from?" : "Set the owner code used for admin actions.");
    const locationDisplay = _needsLocation ? "block" : "none";
    const pinDisplay = _needsOwnerPin ? "block" : "none";
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

function openWizard() {
  const host = $(WIZARD_ID);
  if (!host) return;
  host.style.display = "flex";
  _running = true;
  showStep(_resumeStep || 1);
  setTimeout(() => {
    try {
      const focusTarget = _needsLocation ? $("ffOnbLocationName") : $("ffOnbOwnerPin");
      focusTarget?.focus();
    } catch (_) {}
  }, 50);
}

function closeWizard() {
  const host = $(WIZARD_ID);
  if (host) host.style.display = "none";
  _running = false;
  _currentStep = 1;
  _resumeStep = 1;
  _createdLocationId = null;
  _createdLocationName = "";
  // Clear inputs so a future reopen is clean
  ["ffOnbLocationName","ffOnbLocationAddress","ffOnbOwnerPin","ffOnbStaffFirstName","ffOnbStaffLastName","ffOnbStaffPin"].forEach((id) => {
    const el = $(id); if (el) el.value = "";
  });
}

// -------- Business logic --------
async function shouldShowOnboarding(user) {
  try {
    if (!user || !user.uid) return false;

    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (!userSnap.exists()) return false;
    const u = userSnap.data() || {};

    const role = String(u.role || "").toLowerCase();
    if (role !== "owner") return false;

    const salonId = u.salonId ? String(u.salonId).trim() : "";
    if (!salonId) return false;
    const hasCompletedMarker = (
      localStorage.getItem(scopedCompletedKey(user, salonId)) === "1" ||
      localStorage.getItem(LS_COMPLETED_KEY) === `${user.uid}:${salonId}` ||
      !!u.onboardingCompletedAt ||
      !!u.onboardingSkippedAt
    );

    _currentUser = user;
    _currentSalonId = salonId;
    _resumeStep = 1;

    const locSnap = await getDocs(collection(db, `salons/${salonId}/locations`));
    _needsLocation = locSnap.empty;
    if (!locSnap.empty) {
      const firstLocation = locSnap.docs[0];
      _createdLocationId = firstLocation.id;
      _createdLocationName = String((firstLocation.data() || {}).name || "");
    }

    const ownerStaff = await findOwnerStaffForOnboarding();
    const ownerData = ownerStaff?.data || {};
    _needsOwnerPin = !validatePin(ownerData.pin);

    // Initial onboarding only fills missing setup data. If the owner already
    // has a location and PIN, mark complete locally and do not reopen later.
    if (!_needsLocation && !_needsOwnerPin) {
      try {
        if (!hasCompletedMarker) await updateDoc(doc(db, "users", user.uid), { onboardingCompletedAt: serverTimestamp() });
        localStorage.setItem(scopedCompletedKey(user, salonId), "1");
        localStorage.setItem(LS_COMPLETED_KEY, `${user.uid}:${salonId}`);
      } catch (e) {
        console.warn("[Onboarding] mark complete setup failed:", e?.code, e?.message);
      }
      return false;
    }
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

async function attachLocationToOwnerStaff(locationId, { pin = "", assignLocation = true } = {}) {
  try {
    const uid = _currentUser?.uid;
    if (!uid) return;
    const ownerStaff = await findOwnerStaffForOnboarding();
    const staffId = ownerStaff?.staffId || `staff_${uid}`;
    const staffRef = ownerStaff?.ref || doc(db, `salons/${_currentSalonId}/staff`, staffId);
    const payload = {
      id: staffId,
      uid,
      userId: uid,
      authUid: uid,
      memberId: uid,
      email: normalizeOnboardingEmail(_currentUser?.email),
      emailLower: normalizeOnboardingEmail(_currentUser?.email),
      updatedAt: serverTimestamp(),
    };
    if (assignLocation && locationId) {
      payload.allowedLocationIds = [locationId];
      payload.primaryLocationId = locationId;
    }
    if (pin) payload.pin = pin;
    await setDoc(
      staffRef,
      payload,
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

function normalizeOnboardingEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function findOwnerStaffForOnboarding() {
  const uid = _currentUser?.uid ? String(_currentUser.uid).trim() : "";
  const email = normalizeOnboardingEmail(_currentUser?.email);
  if (!_currentSalonId || (!uid && !email)) return null;

  const candidates = [];
  const addCandidate = (staffId, ref, data, source) => {
    if (!staffId || candidates.some((candidate) => candidate.staffId === staffId)) return;
    candidates.push({ staffId, ref, data: data || {}, source });
  };

  try {
    const userSnap = uid ? await getDoc(doc(db, "users", uid)) : null;
    const userStaffId = userSnap && userSnap.exists() ? String((userSnap.data() || {}).staffId || "").trim() : "";
    if (userStaffId) {
      const staffRef = doc(db, `salons/${_currentSalonId}/staff`, userStaffId);
      const staffSnap = await getDoc(staffRef);
      if (staffSnap.exists()) addCandidate(userStaffId, staffRef, staffSnap.data() || {}, "users.staffId");
    }
  } catch (e) {
    console.warn("[OnboardingOwnerMerge] users.staffId lookup failed:", e?.code, e?.message);
  }

  try {
    const snap = await getDocs(collection(db, `salons/${_currentSalonId}/staff`));
    snap.docs.forEach((staffDoc) => {
      const row = staffDoc.data() || {};
      const rowEmail = normalizeOnboardingEmail(row.email);
      const rowEmailLower = normalizeOnboardingEmail(row.emailLower);
      const linkedIds = [
        row.uid,
        row.userId,
        row.authUid,
        row.memberId,
        row.firebaseUid,
        row.firebaseAuthUid,
      ].map((value) => value == null ? "" : String(value).trim()).filter(Boolean);

      let source = "";
      if (uid && linkedIds.indexOf(uid) !== -1) source = "uid";
      if (!source && email && ((rowEmail && rowEmail === email) || (rowEmailLower && rowEmailLower === email))) source = "email";
      if (!source && email && linkedIds.some((value) => normalizeOnboardingEmail(value) === email)) source = "linkedEmail";
      if (source) addCandidate(staffDoc.id, doc(db, `salons/${_currentSalonId}/staff`, staffDoc.id), row, source);
    });
  } catch (e) {
    console.warn("[OnboardingOwnerMerge] staff scan failed:", e?.code, e?.message);
  }

  if (!candidates.length) return null;
  const score = (candidate) => {
    const row = candidate.data || {};
    const hasUid = [row.uid, row.userId, row.authUid, row.memberId, row.firebaseUid, row.firebaseAuthUid]
      .some((value) => uid && String(value || "").trim() === uid);
    const hasEmail = !!(normalizeOnboardingEmail(row.email) || normalizeOnboardingEmail(row.emailLower));
    let total = 0;
    if (candidate.source === "users.staffId") total += 1000;
    if (hasUid) total += 100;
    if (hasEmail) total += 10;
    return total;
  };
  candidates.sort((a, b) => score(b) - score(a));
  const winner = candidates[0];
  winner.duplicates = candidates.slice(1);
  console.log("[OnboardingOwnerMerge] owner staff resolved", {
    staffId: winner.staffId,
    source: winner.source,
    duplicateCount: winner.duplicates.length,
  });
  return winner;
}

async function createTeammate({ firstName, lastName, role, pin }) {
  const name = `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();
  if (!name) throw new Error("Please enter a name.");
  const safePin = validatePin(pin);
  if (!safePin) throw new Error("PIN must be 4–6 digits.");

  const roleLc = String(role || "technician").toLowerCase();
  const isAdmin = roleLc === "admin";
  const isManager = roleLc === "manager";

  if (isAdmin) {
    const ownerStaff = await findOwnerStaffForOnboarding();
    const uid = _currentUser?.uid ? String(_currentUser.uid).trim() : "";
    const staffId = ownerStaff?.staffId || (uid ? `staff_${uid}` : "");
    const staffRef = ownerStaff?.ref || (staffId ? doc(db, `salons/${_currentSalonId}/staff`, staffId) : null);
    if (!staffId || !staffRef) throw new Error("Owner staff profile is not ready. Please refresh and try again.");
    const email = normalizeOnboardingEmail(_currentUser?.email);
    await setDoc(
      staffRef,
      {
        id: staffId,
        uid,
        userId: uid,
        authUid: uid,
        memberId: uid,
        email,
        emailLower: email,
        name,
        role: "owner",
        isAdmin: true,
        isManager: false,
        pin: safePin,
        allowedLocationIds: _createdLocationId ? [_createdLocationId] : [],
        primaryLocationId: _createdLocationId || null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    for (const duplicate of Array.isArray(ownerStaff?.duplicates) ? ownerStaff.duplicates : []) {
      if (!duplicate || duplicate.staffId === staffId || !duplicate.ref) continue;
      try {
        await deleteDoc(duplicate.ref);
        console.log("[OnboardingOwnerMerge] removed duplicate staff", { staffId: duplicate.staffId, keptStaffId: staffId });
      } catch (e) {
        console.warn("[OnboardingOwnerMerge] duplicate delete failed:", duplicate.staffId, e?.code, e?.message);
      }
    }
    console.log("[OnboardingOwnerMerge] merged admin step into owner staff", { staffId });
    return staffId;
  }

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
  try {
    localStorage.setItem(scopedCompletedKey(_currentUser, _currentSalonId), "1");
    localStorage.setItem(LS_COMPLETED_KEY, `${_currentUser.uid}:${_currentSalonId}`);
  } catch (_) {}
}

// -------- Step handlers --------
async function handleNext() {
  setError("");

  if (_currentStep === 1) {
    const name = String($("ffOnbLocationName")?.value || "").trim();
    const address = String($("ffOnbLocationAddress")?.value || "").trim();
    const ownerPin = _needsOwnerPin ? validatePin($("ffOnbOwnerPin")?.value) : "";
    if (_needsLocation && !name) { setError("Please enter a location name."); return; }
    if (_needsOwnerPin && !ownerPin) { setError("Please enter a 4-6 digit owner PIN."); return; }

    setBusy(true, "Saving…");
    try {
      if (_needsLocation) {
        const created = await createLocation({ name, address });
        _createdLocationId = created.id;
        _createdLocationName = created.name;
        await attachLocationToOwnerStaff(created.id, { pin: ownerPin, assignLocation: true });
        setActiveLocationLocally(created.id);
      } else {
        await attachLocationToOwnerStaff(_createdLocationId, { pin: ownerPin, assignLocation: false });
      }
      await markOnboardingDone({ skipped: false });
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
  ["ffOnbLocationName","ffOnbLocationAddress","ffOnbOwnerPin","ffOnbStaffFirstName","ffOnbStaffLastName","ffOnbStaffPin"].forEach((id) => {
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
  if (_running || _starting) return;
  if (!user) return;
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

    const ok = await shouldShowOnboarding(user);
    if (!ok) return;

    wire();
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
  const salonId = window.currentSalonId || _currentSalonId || "";
  try { localStorage.removeItem(scopedCompletedKey(user, salonId)); } catch (_) {}
  try {
    await updateDoc(doc(db, "users", user.uid), {
      onboardingCompletedAt: null,
      onboardingSkippedAt: null,
    });
  } catch (_) {}
  console.log("[Onboarding] reset. Call ffOpenOnboarding() or refresh to retrigger.");
};
