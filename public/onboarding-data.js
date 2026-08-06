/**
 * Onboarding data layer — all Firestore reads/writes for the wizard.
 *
 * Extracted verbatim from onboarding-wizard.js. The functions no longer read
 * module-level flow state; everything they need (salonId, user, locationId…)
 * is passed in, and results are returned to the orchestrator. shouldShowOnboarding
 * returns { show, state } so the orchestrator can assign its own flow globals.
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
import { db } from "/app.js?v=20260610_force_lp_ios";
import {
  LS_COMPLETED_KEY,
  scopedCompletedKey,
  validatePin,
  normalizeOnboardingEmail,
} from "./onboarding-utils.js?v=20260625_onboarding_split";

export async function findOwnerStaffForOnboarding({ salonId, user } = {}) {
  const uid = user?.uid ? String(user.uid).trim() : "";
  const email = normalizeOnboardingEmail(user?.email);
  if (!salonId || (!uid && !email)) return null;

  const candidates = [];
  const addCandidate = (staffId, ref, data, source) => {
    if (!staffId || candidates.some((candidate) => candidate.staffId === staffId)) return;
    candidates.push({ staffId, ref, data: data || {}, source });
  };

  try {
    const userSnap = uid ? await getDoc(doc(db, "users", uid)) : null;
    const userStaffId = userSnap && userSnap.exists() ? String((userSnap.data() || {}).staffId || "").trim() : "";
    if (userStaffId) {
      const staffRef = doc(db, `salons/${salonId}/staff`, userStaffId);
      const staffSnap = await getDoc(staffRef);
      if (staffSnap.exists()) addCandidate(userStaffId, staffRef, staffSnap.data() || {}, "users.staffId");
    }
  } catch (e) {
    console.warn("[OnboardingOwnerMerge] users.staffId lookup failed:", e?.code, e?.message);
  }

  try {
    const snap = await getDocs(collection(db, `salons/${salonId}/staff`));
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
      if (source) addCandidate(staffDoc.id, doc(db, `salons/${salonId}/staff`, staffDoc.id), row, source);
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

/**
 * Decides whether to show onboarding. Returns { show, state } where state holds
 * the flow values the orchestrator assigns to its globals (or null on early exit,
 * matching the original behavior of not touching those globals).
 */
export async function shouldShowOnboarding(user) {
  try {
    if (!user || !user.uid) return { show: false, state: null };

    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (!userSnap.exists()) return { show: false, state: null };
    const u = userSnap.data() || {};

    const role = String(u.role || "").toLowerCase();
    if (role !== "owner") return { show: false, state: null };

    const salonId = u.salonId ? String(u.salonId).trim() : "";
    if (!salonId) return { show: false, state: null };
    const hasCompletedMarker = (
      localStorage.getItem(scopedCompletedKey(user, salonId)) === "1" ||
      localStorage.getItem(LS_COMPLETED_KEY) === `${user.uid}:${salonId}` ||
      !!u.onboardingCompletedAt ||
      !!u.onboardingSkippedAt
    );

    const state = {
      currentUser: user,
      currentSalonId: salonId,
      resumeStep: 1,
      needsLocation: true,
      createdLocationId: null,
      createdLocationName: "",
      needsOwnerPin: true,
    };

    const locSnap = await getDocs(collection(db, `salons/${salonId}/locations`));
    state.needsLocation = locSnap.empty;
    if (!locSnap.empty) {
      const firstLocation = locSnap.docs[0];
      state.createdLocationId = firstLocation.id;
      state.createdLocationName = String((firstLocation.data() || {}).name || "");
    }

    const ownerStaff = await findOwnerStaffForOnboarding({ salonId, user });
    const ownerData = ownerStaff?.data || {};
    state.needsOwnerPin = !validatePin(ownerData.pin);

    // Initial onboarding only fills missing setup data. If the owner already
    // has a location and PIN, mark complete locally and do not reopen later.
    if (!state.needsLocation && !state.needsOwnerPin) {
      try {
        if (!hasCompletedMarker) await updateDoc(doc(db, "users", user.uid), { onboardingCompletedAt: serverTimestamp() });
        localStorage.setItem(scopedCompletedKey(user, salonId), "1");
        localStorage.setItem(LS_COMPLETED_KEY, `${user.uid}:${salonId}`);
      } catch (e) {
        console.warn("[Onboarding] mark complete setup failed:", e?.code, e?.message);
      }
      return { show: false, state };
    }
    return { show: true, state };
  } catch (e) {
    console.warn("[Onboarding] shouldShow check failed:", e?.code, e?.message);
    return { show: false, state: null };
  }
}

export async function createLocation({ salonId, name, address }) {
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
  const ref = await addDoc(collection(db, `salons/${salonId}/locations`), payload);
  return { id: ref.id, name: payload.name };
}

export async function attachLocationToOwnerStaff({ salonId, user, locationId, pin = "", assignLocation = true } = {}) {
  try {
    const uid = user?.uid;
    if (!uid) return;
    const ownerStaff = await findOwnerStaffForOnboarding({ salonId, user });
    const staffId = ownerStaff?.staffId || `staff_${uid}`;
    const staffRef = ownerStaff?.ref || doc(db, `salons/${salonId}/staff`, staffId);
    const payload = {
      id: staffId,
      uid,
      userId: uid,
      authUid: uid,
      memberId: uid,
      email: normalizeOnboardingEmail(user?.email),
      emailLower: normalizeOnboardingEmail(user?.email),
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

export async function createTeammate({ salonId, user, createdLocationId, firstName, lastName, role, pin }) {
  const name = `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();
  if (!name) throw new Error("Please enter a name.");
  const safePin = validatePin(pin);
  if (!safePin) throw new Error("PIN must be 4–6 digits.");

  const roleLc = String(role || "technician").toLowerCase();
  const isAdmin = roleLc === "admin";
  const isManager = roleLc === "manager";

  if (isAdmin) {
    const ownerStaff = await findOwnerStaffForOnboarding({ salonId, user });
    const uid = user?.uid ? String(user.uid).trim() : "";
    const staffId = ownerStaff?.staffId || (uid ? `staff_${uid}` : "");
    const staffRef = ownerStaff?.ref || (staffId ? doc(db, `salons/${salonId}/staff`, staffId) : null);
    if (!staffId || !staffRef) throw new Error("Owner staff profile is not ready. Please refresh and try again.");
    const email = normalizeOnboardingEmail(user?.email);
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
        allowedLocationIds: createdLocationId ? [createdLocationId] : [],
        primaryLocationId: createdLocationId || null,
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
    allowedLocationIds: createdLocationId ? [createdLocationId] : [],
    primaryLocationId: createdLocationId || null,
    createdAt: Date.now(),
    _syncedAt: serverTimestamp(),
  };
  const staffRef = doc(db, `salons/${salonId}/staff`, staffId);
  await setDoc(staffRef, payload, { merge: false });
  return staffId;
}

export async function markOnboardingDone({ user, salonId, skipped }) {
  try {
    if (!user?.uid) return;
    await updateDoc(doc(db, "users", user.uid), skipped
      ? { onboardingSkippedAt: serverTimestamp() }
      : { onboardingCompletedAt: serverTimestamp() });
  } catch (e) {
    console.warn("[Onboarding] mark-done write failed:", e?.code, e?.message);
  }
  try {
    localStorage.setItem(scopedCompletedKey(user, salonId), "1");
    localStorage.setItem(LS_COMPLETED_KEY, `${user.uid}:${salonId}`);
  } catch (_) {}
}

/** Clears the onboarding completion flags on the user doc (used by ffResetOnboarding). */
export async function resetOnboardingFlags({ user }) {
  try {
    await updateDoc(doc(db, "users", user.uid), {
      onboardingCompletedAt: null,
      onboardingSkippedAt: null,
    });
  } catch (_) {}
}
