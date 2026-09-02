/**
 * Inbox — data + permissions layer (extracted from inbox.js).
 * Role/permission helpers, user-profile loading + salon-staff merge, and recipient
 * lists. Pure data access: no rendering. Reads window globals directly.
 */
import {
  collection,
  getDoc,
  getDocs,
  doc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import { inboxState } from "./inbox-state.js?v=20260810_owner_inbox_load_v5";
import {
  inboxNormalizeLineStaffRoleLc,
  inboxCanViewInboxEval,
  inboxCanManageInboxEval,
  inboxCanSendRequestsEval,
  ffInboxRuleString,
  inboxMemberAllowedAtActiveLocation,
} from "./inbox-helpers.js?v=20260901_sched_req";

function inboxUserRoleLc() {
  return inboxNormalizeLineStaffRoleLc((inboxState.currentUserProfile && inboxState.currentUserProfile.role) || "");
}

/** Merge salons/{salonId}/staff/{staffId} (permissions, managerType) into a user profile object. */
async function mergeSalonStaffIntoUserProfile(profile) {
  if (!profile?.salonId) return profile;
  const sid = String(profile.staffId || "").trim();
  if (!sid) return profile;
  try {
    const snap = await getDoc(doc(db, `salons/${profile.salonId}/staff`, sid));
    if (snap.exists()) {
      const st = snap.data() || {};
      profile.permissions = { ...(profile.permissions || {}), ...(st.permissions || {}) };
      if (st.managerType) profile.managerType = st.managerType;
      // Multi-salon: prefer the staff doc's display name over users/{uid}.name.
      // Without this, requests created by a user who picked test_salon_001 from
      // Choose Salon are saved with "createdByName" = legacy primary-salon name
      // (e.g. "Test Multi") instead of the staff name in the chosen salon
      // (e.g. "TEST TECH"), which surfaces as the wrong "Requested by" label.
      const staffName = String(st.name || "").trim();
      if (staffName) profile.name = staffName;
    }
  } catch (e) {
    console.warn("[Inbox] merge salon staff", e.message);
  }
  return profile;
}

async function resolveCurrentInboxActorName() {
  const fallback =
    inboxState.currentUserProfile?.name ||
    inboxState.currentUserProfile?.displayName ||
    inboxState.currentUserProfile?.email ||
    "";
  try {
    const w = (typeof window !== "undefined") ? window : {};
    const salonId = w.currentSalonId ? String(w.currentSalonId).trim() : String(inboxState.currentUserProfile?.salonId || "").trim();
    const staffId = w.__ff_authedStaffId ? String(w.__ff_authedStaffId).trim() : String(inboxState.currentUserProfile?.staffId || "").trim();
    if (!salonId || !staffId) return fallback;
    const snap = await getDoc(doc(db, `salons/${salonId}/staff`, staffId));
    if (!snap.exists()) return fallback;
    const st = snap.data() || {};
    const staffName = String(st.name || st.firstName || "").trim();
    return staffName || fallback;
  } catch (e) {
    console.warn("[Inbox] resolve actor name failed", e.message);
    return fallback;
  }
}

function inboxCanViewInbox() {
  return inboxCanViewInboxEval(inboxState.currentUserProfile);
}

function inboxCanManageInbox() {
  return inboxCanManageInboxEval(inboxState.currentUserProfile);
}

function inboxCanSendRequests() {
  return inboxCanSendRequestsEval(inboxState.currentUserProfile);
}

/** Load same-salon users from Firestore (managers/admins/owners can read via updated rules). Cached per session. */
async function loadSalonUsersForRecipients() {
  if (inboxState._inboxUsersCache !== null) return inboxState._inboxUsersCache;
  if (!inboxState.currentUserProfile?.salonId) return [];
  try {
    // Read from salons/{salonId}/members — readable by any salon member, no complex rules
    const snap = await getDocs(collection(db, `salons/${inboxState.currentUserProfile.salonId}/members`));
    inboxState._inboxUsersCache = snap.docs
      .filter(d => d.id !== inboxState.currentUserProfile.uid)
      .map(d => {
        const u = d.data() || {};
        return {
          uid: d.id,
          name: (u.name || '').trim(),
          staffId: u.staffId || '',
          role: inboxNormalizeLineStaffRoleLc(u.role || ''),
        };
      })
      .filter(u => u.name);
    console.log('[Inbox] members loaded:', inboxState._inboxUsersCache.length, '| managers/admins:', inboxState._inboxUsersCache.filter(u => ['manager','admin','owner'].includes(u.role)).length);
    return inboxState._inboxUsersCache;
  } catch (e) {
    console.error('[Inbox] loadSalonUsersForRecipients failed:', e.code, e.message);
    inboxState._inboxUsersCache = [];
    return [];
  }
}

/** Recipients for "Send to": managers/admins from Firestore users cache, falling back to ff_staff_v1. */
function getInboxRecipientsList() {
  // Prefer Firestore cache (has real Firebase UIDs)
  if (inboxState._inboxUsersCache && inboxState._inboxUsersCache.length > 0) {
    return inboxState._inboxUsersCache
      .filter(u => ['manager', 'admin', 'owner'].includes(u.role))
      .filter(u => inboxMemberAllowedAtActiveLocation(u))
      .map(u => ({ uid: u.uid, id: u.staffId || u.uid, name: u.name, role: u.role }));
  }
  // Fallback: ff_staff_v1 (no uid, just staffId)
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ff_staff_v1') : null;
    const store = raw ? JSON.parse(raw) : {};
    const staff = Array.isArray(store.staff) ? store.staff : [];
    const currentStaffId = (inboxState.currentUserProfile?.staffId || inboxState.currentUserProfile?.id) || '';
    const currentName = (inboxState.currentUserProfile?.name) || '';
    return staff
      .filter(s => s && !s.isArchived && (s.isAdmin || s.isManager) && s.id !== currentStaffId && s.name !== currentName)
      .filter(s => inboxMemberAllowedAtActiveLocation({
        id: s.id,
        staffId: s.id,
        role: s.isAdmin ? 'admin' : (s.isManager ? 'manager' : ''),
        allowedLocationIds: s.allowedLocationIds,
        primaryLocationId: s.primaryLocationId,
      }))
      .map(s => ({ uid: '', id: s.id || '', name: (s.name || '').trim() }));
  } catch (e) {
    return [];
  }
}

/** Selected recipients in create-request modal. Returns { uids: string[], staffIds: string[], names: string[] }. */
function getCreateRequestSelectedRecipients() {
  const modal = document.getElementById('createRequestModal');
  if (!modal) return { uids: [], staffIds: [], names: [] };
  const checked = modal.querySelectorAll('.create-request-send-to-cb:checked');
  const uids = []; const staffIds = []; const names = [];
  checked.forEach(cb => {
    const uid = cb.getAttribute('data-uid') || '';
    const id = cb.getAttribute('data-staff-id') || '';
    const n = cb.getAttribute('data-staff-name') || '';
    uids.push(uid); staffIds.push(id); if (n) names.push(n);
  });
  return { uids, staffIds, names };
}

async function loadCurrentUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  inboxState._inboxUsersCache = null; // reset recipients cache on each profile load
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data() || {};
      // Multi-salon: prefer the salon picked from Choose Salon (or the single
      // auto-selected membership) over the legacy users/{uid}.salonId. Without
      // this override, inbox queries below build paths from currentUserProfile
      // .salonId and read items from the legacy primary salon instead of the
      // one the user chose.
      // We also override staffId + role with the membership-scoped values
      // (set by ffApplyActiveMembership in app.js). Otherwise
      // mergeSalonStaffIntoUserProfile would query
      // salons/{newSalonId}/staff/{legacyStaffId} which doesn't exist, so no
      // permissions get merged and the user gets "You do not have permission
      // to open Inbox" even if they have full inbox access in the picked salon.
      const w = (typeof window !== 'undefined') ? window : {};
      const activeSalonId = w.currentSalonId ? String(w.currentSalonId).trim() : '';
      const activeStaffId = w.__ff_authedStaffId ? String(w.__ff_authedStaffId).trim() : '';
      const activeRole = w.__ff_user_role ? String(w.__ff_user_role).trim() : '';
      let resolvedRole = activeRole || data.role || '';
      try {
        if (
          (!resolvedRole || String(resolvedRole).toLowerCase() === 'technician') &&
          typeof w.ffIsOwner === 'function' &&
          w.ffIsOwner() === true
        ) {
          resolvedRole = 'owner';
        }
      } catch (_) {}
      inboxState.currentUserProfile = {
        uid: user.uid,
        ...data,
        salonId: activeSalonId || data.salonId || null,
        staffId: activeStaffId || data.staffId || null,
        role: resolvedRole,
      };
      await mergeSalonStaffIntoUserProfile(inboxState.currentUserProfile);
      // If staff permissions overwrote nothing about role, keep owner from Auth/salon.
      try {
        if (
          typeof w.ffIsOwner === 'function' &&
          w.ffIsOwner() === true &&
          String(inboxState.currentUserProfile.role || '').toLowerCase() !== 'owner'
        ) {
          inboxState.currentUserProfile.role = 'owner';
        }
      } catch (_) {}
      console.log('[Inbox] User profile loaded', { role: inboxState.currentUserProfile.role, permissions: inboxState.currentUserProfile.permissions, isOwner: typeof w.ffIsOwner === 'function' ? w.ffIsOwner() : null });
      // Register in members directory so others can find this user in "Send to"
      if (inboxState.currentUserProfile.salonId) {
        const memberData = {
          name: ffInboxRuleString(
            inboxState.currentUserProfile.name || inboxState.currentUserProfile.displayName || user.email || ''
          ),
          role: ffInboxRuleString(inboxState.currentUserProfile.role),
          staffId: ffInboxRuleString(inboxState.currentUserProfile.staffId),
          email: ffInboxRuleString(user.email)
        };
        // Include avatarUrl so Chat, Tickets, Staff Members show the correct photo
        if (inboxState.currentUserProfile.avatarUrl) {
          memberData.avatarUrl = inboxState.currentUserProfile.avatarUrl;
          if (inboxState.currentUserProfile.avatarUpdatedAtMs) {
            memberData.avatarUpdatedAtMs = inboxState.currentUserProfile.avatarUpdatedAtMs;
          }
        }
        setDoc(doc(db, `salons/${inboxState.currentUserProfile.salonId}/members`, user.uid), memberData, { merge: true })
          .catch(e => console.warn('[Inbox] Could not write member doc', e.message));
        // Birthday Inbox items depend on members + settings; run after directory row exists.
        setTimeout(() => {
          try {
            if (typeof window.ffRunBirthdayChatRemindersSoon === 'function') {
              window.ffRunBirthdayChatRemindersSoon();
            }
          } catch (e) {
            console.warn('[Inbox] ffRunBirthdayChatRemindersSoon', e);
          }
        }, 600);
      }
      return inboxState.currentUserProfile;
    }
  } catch (err) {
    console.error('[Inbox] Failed to load user profile', err);
  }
  return null;
}

export {
  inboxUserRoleLc,
  inboxCanViewInbox,
  inboxCanManageInbox,
  inboxCanSendRequests,
  mergeSalonStaffIntoUserProfile,
  resolveCurrentInboxActorName,
  loadSalonUsersForRecipients,
  loadCurrentUserProfile,
  getInboxRecipientsList,
  getCreateRequestSelectedRecipients,
};
