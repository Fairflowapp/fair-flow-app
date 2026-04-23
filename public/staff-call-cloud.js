import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "./app.js?v=20260412_inbox_rules_fix";

const HEARTBEAT_INTERVAL_MS = 15000;
const OFFLINE_THRESHOLD_MS = 45000;
const IDLE_THRESHOLD_MS = 120000;
const CALL_TIMEOUT_MS = 30000;
const STAFF_CALL_DIAG_PREFIX = "[StaffCallDiag]";

let _salonId = null;
let _staffId = null;
let _uid = null;
let _userRole = "";
let _presenceUnsub = null;
let _myPresenceUnsub = null;
let _heartbeatTimer = null;
let _activityBound = false;
let _lastActivityMs = Date.now();
let _presenceCache = {};
let _lastShownCallId = null;
let _timedOutCalls = new Set();
let _queuedQueuePresenceSync = null;
let _callExpiryTimers = {};

function diagLog(label, data) {
  if (data === undefined) {
    console.log(`${STAFF_CALL_DIAG_PREFIX} ${label}`);
    return;
  }
  console.log(`${STAFF_CALL_DIAG_PREFIX} ${label}`, data);
}

function diagWarn(label, data) {
  if (data === undefined) {
    console.warn(`${STAFF_CALL_DIAG_PREFIX} ${label}`);
    return;
  }
  console.warn(`${STAFF_CALL_DIAG_PREFIX} ${label}`, data);
}

function getCallTimeoutMs() {
  const seconds =
    typeof window !== "undefined" && typeof window.ffGetStaffCallTimeoutSeconds === "function"
      ? Number(window.ffGetStaffCallTimeoutSeconds() || 30)
      : 30;
  const normalizedSeconds = Math.min(3600, Math.max(10, Math.round(Number(seconds) || 30)));
  return normalizedSeconds * 1000;
}

function readStaffStore() {
  try {
    const raw = JSON.parse(localStorage.getItem("ff_staff_v1") || "{}");
    return Array.isArray(raw.staff) ? raw.staff : [];
  } catch (e) {
    console.warn("[StaffCall] Failed to read ff_staff_v1", e);
    return [];
  }
}

function scoreStaffCandidate(staff) {
  let score = 0;
  if (String(staff?.role || "").trim().toLowerCase() === "technician") score += 100;
  if (staff?.isArchived !== true) score += 40;
  if (staff?.uid) score += 30;
  if (staff?.firebaseUid) score += 20;
  if (staff?.email) score += 10;
  if (staff?.invited === true) score += 5;
  if (staff?.updatedAtMs) score += Number(staff.updatedAtMs) / 1000000000000;
  if (staff?.createdAt) score += Number(staff.createdAt) / 1000000000000;
  return score;
}

function findBestStaffByName(staffList, staffName) {
  const normalizedName = normalizeText(staffName);
  const candidates = (staffList || []).filter((staff) => normalizeText(staff?.name) === normalizedName);
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => scoreStaffCandidate(b) - scoreStaffCandidate(a))[0] || null;
}

function resolveStaffByIdOrName(staffIdOrName) {
  if (!staffIdOrName) return null;
  const staffList = readStaffStore();
  return staffList.find((staff) => staff.id === staffIdOrName) || findBestStaffByName(staffList, staffIdOrName) || null;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

async function resolveOwnStaffFromCloud(salonId, userData = {}, memberData = {}, user = null) {
  if (!salonId) return { staff: null, source: "none" };
  const staffSnap = await getDocs(collection(db, `salons/${salonId}/staff`));
  const staffList = staffSnap.docs.map((snap) => ({ id: snap.id, ...(snap.data() || {}) }));

  const userStaffId = String(userData.staffId || "").trim();
  if (userStaffId) {
    const byUserStaffId = staffList.find((staff) => String(staff.id || "").trim() === userStaffId);
    if (byUserStaffId) return { staff: byUserStaffId, source: "users.staffId" };
  }

  const memberStaffId = String(memberData.staffId || "").trim();
  if (memberStaffId) {
    const byMemberStaffId = staffList.find((staff) => String(staff.id || "").trim() === memberStaffId);
    if (byMemberStaffId) return { staff: byMemberStaffId, source: "members.staffId" };
  }

  const byUid = staffList.find((staff) => String(staff.uid || "").trim() === String(user?.uid || "").trim());
  if (byUid) return { staff: byUid, source: "staff.uid" };

  const emailCandidates = [
    userData.email,
    memberData.email,
    user?.email,
    auth.currentUser?.email
  ].map(normalizeText).filter(Boolean);

  if (emailCandidates.length) {
    const byEmail = staffList.find((staff) => emailCandidates.includes(normalizeText(staff.email)));
    if (byEmail) return { staff: byEmail, source: "email fallback" };
  }

  const nameCandidates = [
    userData.name,
    userData.displayName,
    memberData.name,
    user?.displayName
  ].map(normalizeText).filter(Boolean);

  if (nameCandidates.length) {
    const byName = staffList.find((staff) => nameCandidates.includes(normalizeText(staff.name)));
    if (byName) return { staff: byName, source: "name fallback" };
  }

  return { staff: null, source: "none" };
}

function resolveStaffIdByName(name) {
  const staff = resolveStaffByIdOrName(name);
  return staff ? staff.id : null;
}

function presenceRef(salonId, staffId) {
  return doc(db, `salons/${salonId}/staffPresence`, staffId);
}

function scorePresenceCandidate(presence) {
  let score = 0;
  const status = explainPresenceStatus(presence).status;
  if (status === "online") score += 1000;
  else if (status === "idle") score += 500;
  if (presence?.inShift === true) score += 200;
  if (presence?.queueStatus === "available") score += 150;
  else if (presence?.queueStatus === "in_service") score += 120;
  else if (presence?.queueStatus === "held") score += 90;
  if (presence?.lastHeartbeatMs) score += Number(presence.lastHeartbeatMs) / 1000000000000;
  const updatedSeconds = Number(presence?.updatedAt?.seconds || 0);
  if (updatedSeconds) score += updatedSeconds / 1000000;
  return score;
}

function resolvePresenceKey(staffIdOrName) {
  if (!staffIdOrName) return null;
  if (typeof staffIdOrName === "object") {
    if (staffIdOrName.staffId && _presenceCache[staffIdOrName.staffId]) return staffIdOrName.staffId;
    if (staffIdOrName.staffId) return staffIdOrName.staffId;
    staffIdOrName = staffIdOrName.name || null;
    if (!staffIdOrName) return null;
  }

  if (_presenceCache[staffIdOrName]) return staffIdOrName;

  const normalizedName = normalizeText(staffIdOrName);
  const candidates = Object.values(_presenceCache).filter((presence) => normalizeText(presence?.name) === normalizedName);
  if (candidates.length) {
    const best = [...candidates].sort((a, b) => scorePresenceCandidate(b) - scorePresenceCandidate(a))[0];
    if (best?.staffId) return best.staffId;
  }

  const staff = resolveStaffByIdOrName(staffIdOrName);
  if (staff?.id) return staff.id;
  return staffIdOrName;
}

async function ensureOwnStaffLink(user, salonId, userData = {}, memberData = {}, ownStaffResolution = {}) {
  const ownStaff = ownStaffResolution?.staff || null;
  const source = String(ownStaffResolution?.source || "none");
  const resolvedStaffId = String(ownStaff?.id || "").trim();
  if (!user?.uid || !salonId || !resolvedStaffId) return { linked: false, reason: "missing context" };

  const currentUserStaffId = String(userData?.staffId || "").trim();
  const currentMemberStaffId = String(memberData?.staffId || "").trim();
  const needsUserLink = currentUserStaffId !== resolvedStaffId;
  const needsMemberLink = currentMemberStaffId !== resolvedStaffId;
  if (!needsUserLink && !needsMemberLink) {
    return { linked: false, reason: "already linked" };
  }

  diagLog("ensureOwnStaffLink start", {
    uid: user.uid,
    salonId,
    resolvedStaffId,
    source,
    currentUserStaffId,
    currentMemberStaffId
  });

  if (needsUserLink) {
    await setDoc(doc(db, "users", user.uid), {
      staffId: resolvedStaffId
    }, { merge: true });
  }

  if (needsMemberLink) {
    await setDoc(doc(db, `salons/${salonId}/members`, user.uid), {
      name: String(memberData?.name || userData?.name || user.displayName || user.email || "").trim(),
      role: String(memberData?.role || userData?.role || _userRole || "").trim(),
      staffId: resolvedStaffId,
      email: String(memberData?.email || userData?.email || user.email || "").trim()
    }, { merge: true });
  }

  diagLog("ensureOwnStaffLink complete", {
    uid: user.uid,
    salonId,
    resolvedStaffId,
    source,
    updatedUserDoc: needsUserLink,
    updatedMemberDoc: needsMemberLink
  });

  return {
    linked: true,
    updatedUserDoc: needsUserLink,
    updatedMemberDoc: needsMemberLink
  };
}

function getPresenceFor(staffIdOrName) {
  const resolvedId = resolvePresenceKey(staffIdOrName);
  return resolvedId ? (_presenceCache[resolvedId] || null) : null;
}

function explainPresenceStatus(presence) {
  if (!presence) return { status: "offline", reason: "missing presence doc", ageMs: null };
  if (!presence.lastHeartbeatMs) return { status: "offline", reason: "missing lastHeartbeatMs", ageMs: null };
  const age = Date.now() - Number(presence.lastHeartbeatMs || 0);
  if (age > OFFLINE_THRESHOLD_MS) return { status: "offline", reason: `heartbeat older than ${OFFLINE_THRESHOLD_MS}ms`, ageMs: age };
  if (presence.onlineStatus === "idle") return { status: "idle", reason: "onlineStatus is idle", ageMs: age };
  if (presence.lastActivityMs && (Date.now() - Number(presence.lastActivityMs)) > IDLE_THRESHOLD_MS) {
    return { status: "idle", reason: `lastActivity older than ${IDLE_THRESHOLD_MS}ms`, ageMs: age };
  }
  return { status: "online", reason: "fresh heartbeat", ageMs: age };
}

function getPresenceStatus(presence) {
  return explainPresenceStatus(presence).status;
}

function dispatchPresenceUpdate() {
  window.__ffStaffPresenceCache = { ..._presenceCache };
  document.dispatchEvent(
    new CustomEvent("ff-staff-presence-updated", {
      detail: { presence: window.__ffStaffPresenceCache }
    })
  );
}

function currentActorName() {
  return (
    window.__ff_actorName ||
    sessionStorage.getItem("ff_actor_name") ||
    auth.currentUser?.displayName ||
    auth.currentUser?.email ||
    "Admin"
  );
}

function persistPresenceStaffContext(staffId, staffName) {
  try {
    localStorage.removeItem("ff_presence_staff_id_v1");
    localStorage.removeItem("ff_presence_staff_name_v1");
  } catch (e) {}
  if (staffId) window.__ff_presence_staff_id_runtime = staffId;
  else delete window.__ff_presence_staff_id_runtime;
  if (staffName) window.__ff_presence_staff_name_runtime = staffName;
  else delete window.__ff_presence_staff_name_runtime;
}

function queueStatusFromState(queue = [], service = [], staffRef = {}) {
  const staffId = typeof staffRef === "object" ? (staffRef.staffId || staffRef.id || null) : null;
  const staffName = typeof staffRef === "object" ? (staffRef.name || "") : String(staffRef || "");
  if (!staffId && !staffName) return "none";

  const serviceItem = service.find((item) =>
    item && (
      (staffId && item.staffId === staffId) ||
      (!staffId && item.name === staffName) ||
      (!item.staffId && item.name === staffName)
    )
  );
  if (serviceItem) return "in_service";

  const queueItem = queue.find((item) =>
    item && (
      (staffId && item.staffId === staffId) ||
      (!staffId && item.name === staffName) ||
      (!item.staffId && item.name === staffName)
    )
  );
  if (!queueItem) return "none";
  return queueItem.held ? "held" : "available";
}

/** Same queue/service keys as index.html save() — source of truth for who is in Available / In service on this device. */
function readQueueAndServiceFromLocalStorage() {
  try {
    const queue = JSON.parse(localStorage.getItem("ffv24_queue") || "[]");
    const service = JSON.parse(localStorage.getItem("ffv24_service") || "[]");
    return {
      queue: Array.isArray(queue) ? queue : [],
      service: Array.isArray(service) ? service : []
    };
  } catch (e) {
    return { queue: [], service: [] };
  }
}

/**
 * If the manager sees this staff on the queue board, allow the call even when Firestore presence
 * is stale (snapshot race with ffSyncPresenceFromQueueState / heartbeat-only docs without inShift).
 */
function deriveQueueEligibility(staffRecord, staffIdFallback, allowedQueueStatuses) {
  const id = (staffRecord && staffRecord.id) || staffIdFallback;
  if (!id) return { derivedStatus: "none", derivedEligible: false };
  const name = (staffRecord && staffRecord.name) || "";
  const { queue, service } = readQueueAndServiceFromLocalStorage();
  const derivedStatus = queueStatusFromState(queue, service, { staffId: id, name });
  const derivedEligible =
    derivedStatus !== "none" && allowedQueueStatuses.includes(derivedStatus);
  return { derivedStatus, derivedEligible };
}

function buildPresenceModal() {
  let modal = document.getElementById("ffStaffCallModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "ffStaffCallModal";
  modal.style.cssText = [
    "display:none",
    "position:fixed",
    "inset:0",
    "background:rgba(0,0,0,0.45)",
    "z-index:100005",
    "align-items:center",
    "justify-content:center",
    "padding:24px"
  ].join(";");

  modal.innerHTML = `
    <div style="width:min(420px,100%);background:#fff;border-radius:16px;padding:24px;box-shadow:0 18px 40px rgba(0,0,0,0.22);border:1px solid #e5e7eb;text-align:center;">
      <div id="ffStaffCallModalTitle" style="font-size:22px;font-weight:700;color:#111827;margin-bottom:12px;">Your client is waiting</div>
      <div id="ffStaffCallModalDetail" style="font-size:14px;color:#6b7280;margin-bottom:20px;">Please return to the queue.</div>
      <button id="ffStaffCallAcceptBtn" type="button" style="min-width:160px;padding:12px 20px;border:none;border-radius:999px;background:#7c3aed;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">Accept</button>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function hideIncomingCallModal() {
  const modal = document.getElementById("ffStaffCallModal");
  if (modal) modal.style.display = "none";
}

async function acceptCurrentCall(callId) {
  if (!_salonId || !_staffId || !callId) return;
  const ref = presenceRef(_salonId, _staffId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() || {};
  const currentCall = data.currentCall || null;
  if (!currentCall || currentCall.callId !== callId || currentCall.status !== "sent") return;
  await updateDoc(ref, {
    currentCall: {
      ...currentCall,
      status: "accepted",
      acceptedAt: serverTimestamp(),
      acceptedAtMs: Date.now()
    },
    updatedAt: serverTimestamp()
  });
  hideIncomingCallModal();
}

function showIncomingCallModal(call) {
  if (!call || !call.callId) return;
  const modal = buildPresenceModal();
  const acceptBtn = document.getElementById("ffStaffCallAcceptBtn");
  const titleEl = document.getElementById("ffStaffCallModalTitle");
  const detailEl = document.getElementById("ffStaffCallModalDetail");
  if (!acceptBtn) return;
  if (titleEl) titleEl.textContent = String(call.message || "Your client is waiting");
  if (detailEl) detailEl.textContent = String(call.detail || "Please return to the queue.");
  acceptBtn.disabled = false;
  acceptBtn.textContent = "Accept";
  acceptBtn.onclick = async () => {
    acceptBtn.disabled = true;
    acceptBtn.textContent = "Accepting...";
    try {
      await acceptCurrentCall(call.callId);
    } catch (e) {
      console.error("[StaffCall] Failed to accept call", e);
      acceptBtn.disabled = false;
      acceptBtn.textContent = "Accept";
    }
  };
  modal.style.display = "flex";
}

async function maybeTimeoutCall(staffId, presence) {
  const currentCall = presence?.currentCall;
  if (!_salonId || !staffId || !currentCall || currentCall.status !== "sent") return;
  const callId = currentCall.callId;
  const expiresAtMs = Number(currentCall.expiresAtMs || 0);
  if (!callId || !expiresAtMs || expiresAtMs > Date.now()) return;
  if (_timedOutCalls.has(callId)) return;

  const isPrivileged = ["owner", "admin", "manager"].includes((_userRole || "").toLowerCase());
  const isOwnCallDoc = _staffId && _staffId === staffId;
  if (!isPrivileged && !isOwnCallDoc) return;

  _timedOutCalls.add(callId);
  try {
    const ref = presenceRef(_salonId, staffId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const latest = snap.data() || {};
    const latestCall = latest.currentCall || null;
    if (!latestCall || latestCall.callId !== callId || latestCall.status !== "sent") return;
    await updateDoc(ref, {
      currentCall: {
        ...latestCall,
        status: "no_response",
        noResponseAt: serverTimestamp(),
        noResponseAtMs: Date.now()
      },
      updatedAt: serverTimestamp()
    });
  } catch (e) {
    console.warn("[StaffCall] Failed to mark no_response", e);
    _timedOutCalls.delete(callId);
  }
}

function clearScheduledCallExpiry(staffId) {
  if (_callExpiryTimers[staffId]) {
    clearTimeout(_callExpiryTimers[staffId]);
    delete _callExpiryTimers[staffId];
  }
}

function scheduleCallExpiry(staffId, presence) {
  clearScheduledCallExpiry(staffId);
  const currentCall = presence?.currentCall;
  if (!currentCall || currentCall.status !== "sent") return;
  const expiresAtMs = Number(currentCall.expiresAtMs || 0);
  if (!expiresAtMs) return;
  const delay = Math.max(0, expiresAtMs - Date.now());
  _callExpiryTimers[staffId] = setTimeout(() => {
    delete _callExpiryTimers[staffId];
    maybeTimeoutCall(staffId, presence);
  }, delay + 25);
}

function handleMyPresenceSnapshot(staffId, presence) {
  if (!_staffId || staffId !== _staffId) return;
  if (!presence) {
    hideIncomingCallModal();
    return;
  }
  const currentCall = presence.currentCall || null;
  if (!currentCall || currentCall.status !== "sent") {
    hideIncomingCallModal();
    return;
  }
  if (Number(currentCall.expiresAtMs || 0) <= Date.now()) {
    hideIncomingCallModal();
    return;
  }
  // Gate by location: if the call was sent from branch A but this staff
  // member is currently viewing branch B, suppress the modal. Legacy calls
  // without a locationId still pop (preserves old behavior / single-branch).
  try {
    const callLocId = currentCall.locationId ? String(currentCall.locationId).trim() : "";
    if (callLocId) {
      let myActiveLocId = "";
      if (typeof window !== "undefined") {
        if (typeof window.ffGetActiveLocationId === "function") {
          myActiveLocId = String(window.ffGetActiveLocationId() || "").trim();
        } else if (typeof window.__ff_active_location_id === "string") {
          myActiveLocId = String(window.__ff_active_location_id || "").trim();
        }
      }
      if (myActiveLocId && myActiveLocId !== callLocId) {
        hideIncomingCallModal();
        return;
      }
    }
  } catch (_) { /* fail-open: show modal if location resolution fails */ }
  if (_lastShownCallId === currentCall.callId && document.getElementById("ffStaffCallModal")?.style.display === "flex") {
    return;
  }
  _lastShownCallId = currentCall.callId;
  showIncomingCallModal(currentCall);
}

function subscribePresenceCollection() {
  if (_presenceUnsub) {
    _presenceUnsub();
    _presenceUnsub = null;
  }
  if (!_salonId) return;
  const isPrivileged = ["owner", "admin", "manager"].includes((_userRole || "").toLowerCase());

  if (!isPrivileged && _staffId) {
    const ownRef = presenceRef(_salonId, _staffId);
    _presenceUnsub = onSnapshot(ownRef, (snap) => {
      const nextCache = {};
      if (snap.exists()) {
        const data = snap.data() || {};
        nextCache[snap.id] = { ...data, staffId: snap.id };
        scheduleCallExpiry(snap.id, nextCache[snap.id]);
        maybeTimeoutCall(snap.id, nextCache[snap.id]);
        handleMyPresenceSnapshot(snap.id, nextCache[snap.id]);
      } else {
        clearScheduledCallExpiry(_staffId);
        handleMyPresenceSnapshot(_staffId, null);
      }
      _presenceCache = nextCache;
      diagLog("own presence snapshot applied", {
        salonId: _salonId,
        ownStaffId: _staffId,
        docIds: Object.keys(nextCache),
        ownPresence: _staffId ? nextCache[_staffId] || null : null
      });
      dispatchPresenceUpdate();
    }, (err) => {
      console.error("[StaffCall] Presence subscribe error", err);
      diagWarn("own presence subscribe error", {
        salonId: _salonId,
        ownStaffId: _staffId,
        code: err?.code || null,
        message: err?.message || String(err)
      });
    });
    return;
  }

  _presenceUnsub = onSnapshot(collection(db, `salons/${_salonId}/staffPresence`), (snap) => {
    const nextCache = {};
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      nextCache[docSnap.id] = { ...data, staffId: docSnap.id };
      scheduleCallExpiry(docSnap.id, nextCache[docSnap.id]);
      maybeTimeoutCall(docSnap.id, nextCache[docSnap.id]);
      handleMyPresenceSnapshot(docSnap.id, nextCache[docSnap.id]);
    });
    Object.keys(_callExpiryTimers).forEach((staffId) => {
      if (!nextCache[staffId]) clearScheduledCallExpiry(staffId);
    });
    _presenceCache = nextCache;
    diagLog("presence snapshot applied", {
      salonId: _salonId,
      ownStaffId: _staffId,
      docIds: Object.keys(nextCache),
      ownPresence: _staffId ? nextCache[_staffId] || null : null
    });
    dispatchPresenceUpdate();
  }, (err) => {
    console.error("[StaffCall] Presence subscribe error", err);
    diagWarn("presence subscribe error", {
      salonId: _salonId,
      ownStaffId: _staffId,
      code: err?.code || null,
      message: err?.message || String(err)
    });
  });
}

function bindActivityTracking() {
  if (_activityBound) return;
  _activityBound = true;

  const markActive = () => {
    _lastActivityMs = Date.now();
  };

  ["pointerdown", "keydown", "touchstart", "mousemove"].forEach((evt) => {
    window.addEventListener(evt, markActive, { passive: true });
  });
  document.addEventListener("visibilitychange", () => {
    _lastActivityMs = Date.now();
    if (document.visibilityState === "visible") {
      writeOwnPresenceHeartbeat(true);
    }
  });
}

function buildOwnPresencePayload(forceWrite) {
  if (!_staffId || !_salonId || !_uid) return null;
  const existing = _presenceCache[_staffId] || {};
  const staff = resolveStaffByIdOrName(_staffId);
  const now = Date.now();
  const desiredStatus =
    document.visibilityState === "visible" && (now - _lastActivityMs) <= IDLE_THRESHOLD_MS
      ? "online"
      : "idle";

  const payload = {
    staffId: _staffId,
    uid: _uid,
    role: (_userRole || staff?.role || "").toLowerCase(),
    name: staff?.name || auth.currentUser?.displayName || auth.currentUser?.email || existing.name || "",
    onlineStatus: desiredStatus,
    lastHeartbeatAt: serverTimestamp(),
    lastHeartbeatMs: now,
    lastSeenAt: serverTimestamp(),
    lastActivityMs: _lastActivityMs,
    updatedAt: serverTimestamp()
  };

  if (forceWrite && existing.inShift === undefined) payload.inShift = false;
  if (forceWrite && !existing.queueStatus) payload.queueStatus = "none";
  return payload;
}

async function writeOwnPresenceHeartbeat(forceWrite = false) {
  const payload = buildOwnPresencePayload(forceWrite);
  if (!payload) {
    diagWarn("writeOwnPresenceHeartbeat skipped", {
      ran: true,
      uid: _uid,
      salonId: _salonId,
      staffId: _staffId,
      reason: "payload is null"
    });
    return;
  }
  const path = `salons/${_salonId}/staffPresence/${_staffId}`;
  diagLog("writeOwnPresenceHeartbeat start", {
    ran: true,
    forceWrite,
    uid: _uid,
    salonId: _salonId,
    staffId: _staffId,
    path,
    payload
  });
  try {
    await setDoc(presenceRef(_salonId, _staffId), payload, { merge: true });
    diagLog("writeOwnPresenceHeartbeat success", {
      forceWrite,
      uid: _uid,
      salonId: _salonId,
      staffId: _staffId,
      path
    });
  } catch (e) {
    console.warn("[StaffCall] Heartbeat write failed", e);
    diagWarn("writeOwnPresenceHeartbeat failed", {
      forceWrite,
      uid: _uid,
      salonId: _salonId,
      staffId: _staffId,
      path,
      code: e?.code || null,
      message: e?.message || String(e)
    });
  }
}

function startHeartbeatLoop() {
  stopHeartbeatLoop();
  bindActivityTracking();
  writeOwnPresenceHeartbeat(true);
  _heartbeatTimer = setInterval(() => {
    writeOwnPresenceHeartbeat(false);
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeatLoop() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

async function loadContextForUser(user) {
  if (!user) {
    diagLog("auth cleared", { uid: null, salonId: null, staffId: null });
    _salonId = null;
    _staffId = null;
    _uid = null;
    _userRole = "";
    _presenceCache = {};
    _lastShownCallId = null;
    _timedOutCalls = new Set();
    persistPresenceStaffContext(null, null);
    Object.keys(_callExpiryTimers).forEach(clearScheduledCallExpiry);
    dispatchPresenceUpdate();
    hideIncomingCallModal();
    stopHeartbeatLoop();
    if (_presenceUnsub) _presenceUnsub();
    if (_myPresenceUnsub) _myPresenceUnsub();
    _presenceUnsub = null;
    _myPresenceUnsub = null;
    return;
  }

  _uid = user.uid;
  diagLog("auth user detected", {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null
  });
  for (let i = 0; i < 40; i += 1) {
    if (window.currentSalonId) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
    _salonId = userData.salonId || window.currentSalonId || null;
    _userRole = String(userData.role || window.__ff_user_role || "").toLowerCase();
    let memberData = {};
    if (_salonId) {
      try {
        const memberSnap = await getDoc(doc(db, `salons/${_salonId}/members`, user.uid));
        memberData = memberSnap.exists() ? (memberSnap.data() || {}) : {};
      } catch (memberErr) {
        console.warn("[StaffCall] Failed to load salon member doc", memberErr);
        diagWarn("members doc load failed", {
          uid: user.uid,
          salonId: _salonId,
          code: memberErr?.code || null,
          message: memberErr?.message || String(memberErr)
        });
      }
    }
    const ownStaffResolution = await resolveOwnStaffFromCloud(_salonId, userData, memberData, user);
    if (ownStaffResolution?.staff?.id) {
      try {
        await ensureOwnStaffLink(user, _salonId, userData, memberData, ownStaffResolution);
        userData.staffId = ownStaffResolution.staff.id;
        memberData.staffId = ownStaffResolution.staff.id;
      } catch (linkErr) {
        console.warn("[StaffCall] Failed to persist own staff link", linkErr);
        diagWarn("ensureOwnStaffLink failed", {
          uid: user.uid,
          salonId: _salonId,
          resolvedStaffId: ownStaffResolution.staff.id,
          source: ownStaffResolution.source,
          code: linkErr?.code || null,
          message: linkErr?.message || String(linkErr)
        });
      }
    }
    const ownStaff = ownStaffResolution.staff;
    let selectedSource = "none";
    _staffId = null;
    if (ownStaff?.id && ownStaffResolution.source === "users.staffId") {
      _staffId = userData.staffId;
      selectedSource = "users.staffId";
    } else if (ownStaff?.id && ownStaffResolution.source === "members.staffId") {
      _staffId = memberData.staffId;
      selectedSource = "members.staffId";
    } else if (ownStaff?.id) {
      _staffId = ownStaff.id;
      selectedSource = ownStaffResolution.source;
    }
    persistPresenceStaffContext(_staffId, ownStaff?.name || memberData.name || userData.name || window.__ff_authedStaffName || "");
    diagLog("loadContext resolved identity", {
      uid: user.uid,
      salonId: _salonId,
      userRole: _userRole,
      userDoc: userData,
      memberDoc: memberData,
      selectedStaffId: _staffId,
      selectedSource,
      matchedStaffRecord: ownStaff || null,
      heartbeatPath: _staffId && _salonId ? `salons/${_salonId}/staffPresence/${_staffId}` : null
    });
  } catch (e) {
    console.warn("[StaffCall] Failed to load user context", e);
    _salonId = window.currentSalonId || null;
    _userRole = String(window.__ff_user_role || "").toLowerCase();
    _staffId = null;
    persistPresenceStaffContext(null, null);
    diagWarn("loadContext fallback after error", {
      uid: user.uid,
      salonId: _salonId,
      userRole: _userRole,
      selectedStaffId: _staffId,
      selectedSource: "none",
      matchedStaffRecord: null,
      errorCode: e?.code || null,
      errorMessage: e?.message || String(e),
      heartbeatPath: _staffId && _salonId ? `salons/${_salonId}/staffPresence/${_staffId}` : null
    });
  }

  subscribePresenceCollection();
  if (_staffId) {
    startHeartbeatLoop();
  } else {
    stopHeartbeatLoop();
  }
}

onAuthStateChanged(auth, (user) => {
  loadContextForUser(user);
});

document.addEventListener("ff-staff-cloud-updated", () => {
  if (auth.currentUser && !_staffId) {
    loadContextForUser(auth.currentUser);
  }
});

window.ffGetStaffPresenceFor = function(staffIdOrName) {
  return getPresenceFor(staffIdOrName);
};

window.ffGetStaffPresenceStatus = function(staffIdOrName) {
  return getPresenceStatus(getPresenceFor(staffIdOrName));
};

window.ffStaffCallDiagSnapshot = function(staffIdOrName) {
  const requested = staffIdOrName || _staffId;
  const resolvedRequestedStaff = resolveStaffByIdOrName(requested);
  const resolvedRequestedStaffId = resolvedRequestedStaff?.id || requested || null;
  const presence = getPresenceFor(resolvedRequestedStaffId);
  return {
    uid: _uid,
    salonId: _salonId,
    ownStaffId: _staffId,
    requestedStaff: requested,
    requestedStaffId: resolvedRequestedStaffId,
    presence,
    presenceStatus: explainPresenceStatus(presence)
  };
};

window.ffMarkStaffJoinedShift = async function(staffIdOrName, staffName) {
  const resolvedStaff = resolveStaffByIdOrName(staffIdOrName || staffName);
  const targetStaffId = resolvedStaff?.id || staffIdOrName;
  if (!_salonId || !targetStaffId) return;
  try {
    await setDoc(presenceRef(_salonId, targetStaffId), {
      staffId: targetStaffId,
      name: resolvedStaff?.name || staffName || "",
      inShift: true,
      queueStatus: "available",
      currentCall: null,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn("[StaffCall] Failed to mark joined shift", e);
  }
};

window.ffSetPresenceStaffContext = function(staffIdOrName, staffName) {
  const resolvedStaff = resolveStaffByIdOrName(staffIdOrName || staffName);
  const nextStaffId = resolvedStaff?.id || staffIdOrName || null;
  const nextStaffName =
    resolvedStaff?.name ||
    staffName ||
    "";

  if (nextStaffName) window.__ff_authedStaffName = nextStaffName;
  persistPresenceStaffContext(null, nextStaffName || "");
  diagLog("ffSetPresenceStaffContext", {
    uid: _uid,
    salonId: _salonId,
    selectedStaffId: _staffId,
    selectedSource: "cloud identity only",
    matchedStaffRecord: resolvedStaff || null,
    requestedStaffId: nextStaffId,
    heartbeatPath: _salonId && _staffId ? `salons/${_salonId}/staffPresence/${_staffId}` : null
  });
};

window.ffSyncPresenceFromQueueState = function(queue = [], service = []) {
  if (!_salonId) return;
  if (_queuedQueuePresenceSync) clearTimeout(_queuedQueuePresenceSync);
  const staffList = readStaffStore();
  if (!staffList.length) return;
  const previousCache = { ..._presenceCache };

  // Optimistically update local presence cache so Queue/Service UI reacts immediately.
  const nextCache = { ...previousCache };
  staffList.forEach((staff) => {
    if (!staff?.id) return;
    const current = previousCache[staff.id] || {};
    const nextQueueStatus = queueStatusFromState(queue, service, { staffId: staff.id, name: staff.name || "" });
    nextCache[staff.id] = {
      ...current,
      staffId: staff.id,
      name: staff.name || current.name || "",
      inShift: nextQueueStatus !== "none",
      queueStatus: nextQueueStatus
    };
    if (String(current.queueStatus || "none") !== String(nextQueueStatus || "none") || nextQueueStatus === "none") {
      nextCache[staff.id].currentCall = null;
    }
  });
  _presenceCache = nextCache;
  dispatchPresenceUpdate();

  _queuedQueuePresenceSync = setTimeout(async () => {
    try {
      const batch = writeBatch(db);
      staffList.forEach((staff) => {
        if (!staff?.id) return;
        const current = previousCache[staff.id] || {};
        const nextQueueStatus = queueStatusFromState(queue, service, { staffId: staff.id, name: staff.name || "" });
        const queueStatusChanged = String(current.queueStatus || "none") !== String(nextQueueStatus || "none");
        const payload = {
          staffId: staff.id,
          name: staff.name || current.name || "",
          inShift: nextQueueStatus !== "none",
          queueStatus: nextQueueStatus,
          updatedAt: serverTimestamp()
        };
        if (queueStatusChanged || nextQueueStatus === "none") {
          payload.currentCall = null;
        }
        batch.set(presenceRef(_salonId, staff.id), payload, { merge: true });
      });
      await batch.commit();
    } catch (e) {
      console.warn("[StaffCall] Failed to sync queue presence", e);
    }
  }, 250);
};

window.ffSendStaffCall = async function(staffIdOrName, options = {}) {
  const targetStaff = resolveStaffByIdOrName(staffIdOrName);
  const targetStaffId = targetStaff?.id || staffIdOrName;
  const allowedQueueStatuses = Array.isArray(options.allowedQueueStatuses) && options.allowedQueueStatuses.length
    ? options.allowedQueueStatuses
    : ["available"];
  const callMessage = String(options.message || "Your client is waiting");
  const callDetail = String(options.detail || "Please return to the queue.");
  if (!_salonId || !targetStaffId) {
    diagWarn("ffSendStaffCall blocked", {
      salonId: _salonId,
      targetStaffId,
      reason: "missing-target"
    });
    return { ok: false, reason: "missing-target" };
  }

  const presence = getPresenceFor(targetStaffId);
  const presenceStatusInfo = explainPresenceStatus(presence);
  const presenceStatus = presenceStatusInfo.status;
  const { derivedStatus, derivedEligible } = deriveQueueEligibility(targetStaff, targetStaffId, allowedQueueStatuses);
  const presenceEligible =
    presence &&
    presence.inShift === true &&
    allowedQueueStatuses.includes(presence.queueStatus);
  const eligible = presenceEligible || derivedEligible;
  if (!eligible) {
    diagWarn("ffSendStaffCall blocked", {
      salonId: _salonId,
      targetStaffId,
      reason: "not-eligible",
      presence,
      eligibilityFailure: {
        inShift: presence?.inShift === true,
        queueStatus: presence?.queueStatus || null,
        allowedQueueStatuses,
        derivedStatus,
        derivedEligible
      }
    });
    return { ok: false, reason: "not-eligible" };
  }
  if (presenceStatus === "offline" && !derivedEligible) {
    diagWarn("ffSendStaffCall blocked", {
      salonId: _salonId,
      targetStaffId,
      reason: "offline",
      presence,
      presenceStatus: presenceStatusInfo
    });
    return { ok: false, reason: "offline" };
  }

  const callId = "call_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const sentAtMs = Date.now();
  const callTimeoutMs = getCallTimeoutMs() || CALL_TIMEOUT_MS;
  // Stamp the sender's active location on the call so the receiving client
  // can decide whether to pop the incoming-call modal. A staff member who
  // happens to be viewing branch B shouldn't get a modal for a call sent
  // from branch A — the staffCallTemplates are shared, but the call itself
  // is branch-local (the client is physically waiting at that branch).
  let sendingLocationId = "";
  try {
    if (typeof window !== "undefined") {
      if (typeof window.ffGetActiveLocationId === "function") {
        sendingLocationId = String(window.ffGetActiveLocationId() || "").trim();
      } else if (typeof window.__ff_active_location_id === "string") {
        sendingLocationId = String(window.__ff_active_location_id || "").trim();
      }
    }
  } catch (_) { sendingLocationId = ""; }
  const currentCall = {
    callId,
    message: callMessage,
    detail: callDetail,
    status: "sent",
    sentAt: serverTimestamp(),
    sentAtMs,
    expiresAt: new Date(sentAtMs + callTimeoutMs),
    expiresAtMs: sentAtMs + callTimeoutMs,
    sentBy: currentActorName(),
    locationId: sendingLocationId || null
  };

  await setDoc(
    presenceRef(_salonId, targetStaffId),
    {
      staffId: targetStaffId,
      name: targetStaff?.name || presence?.name || "",
      currentCall,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  diagLog("ffSendStaffCall success", {
    salonId: _salonId,
    targetStaffId,
    path: `salons/${_salonId}/staffPresence/${targetStaffId}`,
    currentCall,
    callTimeoutMs
  });

  return { ok: true, callId };
};

window.ffAcceptStaffCall = acceptCurrentCall;
