/**
 * media-profile.js — user profile + media-handling permission checks for the Media module.
 * Resolves the signed-in user's salon staff doc / role, hydrates mediaState.currentUserProfile,
 * and exposes the permission helpers used across the Media UI. Extracted verbatim from
 * media-upload.js (M2).
 */
import { getDoc, getDocs, doc, collection, setDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import { mediaState } from "./media-state.js?v=20260719_media_esm_unify";

/** Same defaults as Staff → Permissions → Media → "To handle" in index.html */
function legacyMediaHandleFromStaffDoc(st) {
  if (!st) return false;
  if (st.isAdmin === true || st.isManager === true) return true;
  const r = String(st.role || "").toLowerCase();
  return (
    r === "manager" ||
    r === "admin" ||
    r === "owner" ||
    r === "front_desk" ||
    r === "assistant_manager"
  );
}

/** Same rules as Staff → Permissions → Media → "To handle" (index.html getValue) + users.role if no staff doc */
function computeMediaHandleAllowed(staffData, roleLower) {
  const p = staffData?.permissions;
  if (p && typeof p === "object" && Object.prototype.hasOwnProperty.call(p, "media_handle")) {
    const v = p.media_handle;
    return v === true || v === "true" || v === 1;
  }
  if (legacyMediaHandleFromStaffDoc(staffData)) return true;
  return ["manager", "admin", "owner"].includes(String(roleLower || "").toLowerCase());
}

/**
 * Staff docs are keyed by salon staff id, not always Firebase uid. Match app.js / PIN: staffId, __ff_authedStaffId, firebaseUid, email.
 */
async function waitForSalonId(maxMs = 3500) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const sid = typeof window !== "undefined" && window.currentSalonId;
    if (sid) return sid;
    await new Promise((r) => setTimeout(r, 90));
  }
  return typeof window !== "undefined" ? window.currentSalonId : null;
}

async function resolveSalonStaffDoc(salonId, user, userData) {
  if (!salonId) {
    return { data: null, docId: (typeof window !== "undefined" && window.__ff_authedStaffId) || userData?.staffId || user.uid };
  }
  const tryIds = [];
  if (typeof window !== "undefined" && window.__ff_authedStaffId) tryIds.push(window.__ff_authedStaffId);
  try {
    const membershipSnap = await getDoc(doc(db, `users/${user.uid}/memberships/${salonId}`));
    if (membershipSnap.exists()) {
      const membershipStaffId = membershipSnap.data()?.staffId;
      if (membershipStaffId && typeof membershipStaffId === "string") tryIds.push(membershipStaffId);
    }
  } catch (_) {}
  try {
    const memSnap = await getDoc(doc(db, `salons/${salonId}/members`, user.uid));
    if (memSnap.exists()) {
      const mid = memSnap.data()?.staffId;
      if (mid && typeof mid === "string") tryIds.push(mid);
    }
  } catch (_) {}
  try {
    const ls = typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : "";
    if (ls) tryIds.push(ls);
  } catch (_) {}
  if (userData?.staffId) tryIds.push(userData.staffId);
  tryIds.push(user.uid);
  const seen = new Set();
  for (const id of tryIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const staffSnap = await getDoc(doc(db, `salons/${salonId}/staff`, id));
      if (staffSnap.exists()) {
        return { data: staffSnap.data(), docId: staffSnap.id };
      }
    } catch (_) {}
  }
  try {
    const staffColl = await getDocs(collection(db, `salons/${salonId}/staff`));
    const userEmail = (user.email || "").toLowerCase();
    for (const docSnap of staffColl.docs) {
      const s = docSnap.data();
      if (s.firebaseUid && s.firebaseUid === user.uid) {
        return { data: s, docId: docSnap.id };
      }
      if (s.uid && s.uid === user.uid) {
        return { data: s, docId: docSnap.id };
      }
      if (userEmail && (s.email || "").toLowerCase() === userEmail) {
        return { data: s, docId: docSnap.id };
      }
    }
  } catch (_) {}
  return { data: null, docId: (typeof window !== "undefined" && window.__ff_authedStaffId) || userData?.staffId || user.uid };
}

/** When direct paths miss, one full scan — must attach full doc for permissions.media_handle */
async function enrichStaffDocIfMissing(salonId, user, userData, existing) {
  if (existing || !salonId) return null;
  try {
    const staffColl = await getDocs(collection(db, `salons/${salonId}/staff`));
    const userEmail = (user.email || "").toLowerCase();
    for (const docSnap of staffColl.docs) {
      const s = docSnap.data();
      if (s.firebaseUid && s.firebaseUid === user.uid) return { data: s, docId: docSnap.id };
      if (s.uid && s.uid === user.uid) return { data: s, docId: docSnap.id };
      if (userEmail && (s.email || "").toLowerCase() === userEmail) return { data: s, docId: docSnap.id };
      if (userData?.staffId && (docSnap.id === userData.staffId || s.staffId === userData.staffId)) {
        return { data: s, docId: docSnap.id };
      }
    }
  } catch (_) {}
  return null;
}

async function loadUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  const sidPre = typeof window !== "undefined" && window.currentSalonId ? String(window.currentSalonId).trim() : "";
  const authedPre =
    typeof window !== "undefined" && window.__ff_authedStaffId ? String(window.__ff_authedStaffId).trim() : "";
  const profileCacheKey = `${user.uid}|${sidPre}|${authedPre}`;
  if (mediaState.currentUserProfile && mediaState.currentUserProfile._ffMediaProfileKey === profileCacheKey) {
    return mediaState.currentUserProfile;
  }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    let d;
    if (snap.exists()) {
      d = snap.data();
    } else {
      console.warn("[Media] users/" + user.uid + " missing — using salon/globals (PIN / partial account)");
      const gRole = typeof window !== "undefined" ? window.__ff_user_role : "";
      d = {
        salonId: typeof window !== "undefined" ? window.currentSalonId : null,
        role: gRole != null && String(gRole).trim() !== "" ? String(gRole).toLowerCase() : "technician",
        staffId:
          (typeof window !== "undefined" && window.__ff_authedStaffId) ||
          (typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : null) ||
          user.uid,
        name: user.displayName || user.email || "User",
      };
    }

    let salonId = (typeof window !== "undefined" && window.currentSalonId) ? window.currentSalonId : d.salonId;
    if (!salonId) {
      salonId = await waitForSalonId();
    }
    let role = (d.role || "technician").toLowerCase();

    let { data: staffDocData, docId: staffId } = await resolveSalonStaffDoc(salonId, user, d);
    const enriched = await enrichStaffDocIfMissing(salonId, user, d, staffDocData);
    if (enriched) {
      staffDocData = enriched.data;
      staffId = enriched.docId;
    }

    if (staffDocData) {
      if (staffDocData.isAdmin === true) role = "admin";
      else if (staffDocData.isManager === true) role = "manager";
      else {
        const sr = String(staffDocData.role || "").toLowerCase();
        if (["manager", "admin", "owner"].includes(sr)) role = sr;
      }
    }

    if (salonId && ["technician", ""].includes(role)) {
      try {
        const memberSnap = await getDoc(doc(db, `salons/${salonId}/members`, user.uid));
        if (memberSnap.exists()) {
          const mr = ((memberSnap.data().role || "") + "").toLowerCase();
          if (["manager", "admin", "owner"].includes(mr)) role = mr;
        }
      } catch (_) {}
    }

    const mediaHandleAllowed = computeMediaHandleAllowed(staffDocData, role);
    const staffName = String(
      staffDocData?.name ||
      staffDocData?.displayName ||
      d.name ||
      d.displayName ||
      user.displayName ||
      user.email ||
      "User"
    ).trim() || "User";

    mediaState.currentUserProfile = {
      uid: user.uid,
      staffId,
      staffName,
      createdByRole: role,
      salonId,
      mediaHandleAllowed,
      _ffMediaProfileKey: profileCacheKey,
    };
    if (salonId) {
      setDoc(doc(db, `salons/${salonId}/members`, user.uid), {
        name: mediaState.currentUserProfile.staffName,
        role: mediaState.currentUserProfile.createdByRole,
        staffId: mediaState.currentUserProfile.staffId,
      }, { merge: true }).catch(() => {});
    }
    return mediaState.currentUserProfile;
  } catch (e) {
    console.warn("[Media] loadUserProfile failed", e);
  }
  return null;
}

function canHandleMediaWork() {
  if (mediaState.currentUserProfile?.mediaHandleAllowed === true) return true;
  if (mediaState.currentUserProfile && mediaState.currentUserProfile.mediaHandleAllowed === false) return false;
  const wr =
    typeof window !== "undefined" && window.__ff_user_role
      ? String(window.__ff_user_role).toLowerCase().trim()
      : "";
  if (["manager", "admin", "owner"].includes(wr)) return true;
  return false;
}

function isAdmin() {
  const r = (mediaState.currentUserProfile?.createdByRole || "").toLowerCase();
  return ["admin", "owner"].includes(r);
}

export { loadUserProfile, canHandleMediaWork, isAdmin };
