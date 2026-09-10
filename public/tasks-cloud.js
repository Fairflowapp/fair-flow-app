/**
 * Tasks Cloud – sync TASKS per-location to Firestore.
 *
 * Firestore path (location-aware):
 *   - salons/{salonId}/tasksState/{locationId}  when the user has picked an
 *     active location in the header switcher. Each branch gets its own
 *     Tasks catalog, per-tab active/pending/done state, alert windows,
 *     enforce-select, auto-reset state and tombstone — like two different
 *     businesses.
 *   - salons/{salonId}/tasksState/default       fallback for single-location
 *     salons (no locations configured yet). Preserves all pre-multi-location
 *     data without any migration.
 *
 * Firestore doc shape (per branch):
 *   { catalog, opening, closing, weekly, monthly, yearly,
 *     tombstone, alertWindows, enforceSelectSettings, autoResetState, updatedAt }
 */

import { collection, doc, getDoc, getDocFromServer, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";

const TASKS_STATE_DEFAULT = "default";
const TABS = ["opening", "closing", "weekly", "monthly", "yearly"];
const KINDS = ["active", "pending", "done"];

// Per-location localStorage keys that mirror the cloud doc. When the user
// switches locations we flush these so the previous branch's tasks don't
// leak into the new branch's UI for a split second.
const LS_KEYS_STATIC = [
  "ff_tasks_catalog_v1",
  "ff_tasks_active_deleted_v1",
  "ff_tasks_alert_windows_v1",
  "ff_tasks_enforce_select_v1",
  "ff_tasks_auto_reset_state_v1",
  "ff_tasks_reset_stamps_v1",
  "ff_tasks_ls_location_id_v1",
  "ff_tasks_isolate_clear_at_v1"
];

let _salonId = null;
let _locationId = null;
let _unsubscribe = null;
let _applyState = null;
let _getState = null;
let _onRefresh = null;
let _writeTimeout = null;
let _subscriptionSeq = 0;

// Last revision we observed from the active branch's tasksState doc. Tasks no
// longer uses a server-side rev compare-and-swap because stale iOS WebView
// listeners can freeze rev and cause legitimate technician selections to be
// rejected as permission-denied. Conflict handling is based on reset stamps and
// per-row action timestamps ("newest action wins").
let _lastCloudRev = 0;

// The most recent server doc delivered by the onSnapshot listener. Used as the
// merge base for writes so we never have to do a blocking getDoc/getDocFromServer
// (those can hang inside the iOS WKWebView).
let _lastServerData = null;

const SALON_ID_CACHE_KEY = "ff_salonId_v1";

function currentWindowSalonId() {
  if (typeof window === "undefined") return "";
  try {
    return String(window.currentSalonId || "").trim();
  } catch (_) {
    return "";
  }
}

function kioskClaimSalonId() {
  if (typeof window === "undefined") return "";
  try {
    const claims = window.__ff_kiosk_claims || null;
    return String((claims && claims.salonId) || "").trim();
  } catch (_) {
    return "";
  }
}

function tasksCloudScopeStillCurrent(expectedSalonId, expectedDocId, expectedSeq) {
  if (expectedSeq !== _subscriptionSeq) return false;
  if (String(_salonId || "") !== String(expectedSalonId || "")) return false;
  if (tasksStateDocIdFor(_locationId) !== String(expectedDocId || "")) return false;
  const activeSalon = currentWindowSalonId();
  if (activeSalon && activeSalon !== String(expectedSalonId || "")) return false;
  const kioskSalon = kioskClaimSalonId();
  if (kioskSalon && kioskSalon !== String(expectedSalonId || "")) return false;
  return true;
}

async function getSalonId() {
  const user = auth.currentUser;
  let salonId = null;

  // Multi-salon: when the user has chosen a salon (single membership auto-
  // selected, or one explicitly picked from Choose Salon), that selection is
  // the source of truth. Reading users/{uid}.salonId first would leak data
  // from the legacy primary salon into whichever salon the user picked.
  if (typeof window !== "undefined" && window.currentSalonId) {
    return String(window.currentSalonId).trim() || null;
  }

  // 1) From Firebase auth user doc (legacy fallback for users with no membership yet)
  if (user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        salonId = data.salonId || null;
      }
    } catch (e) {
      console.warn("[TasksCloud] getSalonId from user doc failed", e);
    }
  }

  // 2) Fallback: window.currentSalonId (set by app.js auth listener – helps shared device / PIN flow)
  if (!salonId && typeof window !== "undefined" && window.currentSalonId) {
    salonId = window.currentSalonId;
  }

  // 3) Fallback: cached from previous session (helps when auth loads slowly)
  if (!salonId && typeof localStorage !== "undefined") {
    try {
      const cached = localStorage.getItem(SALON_ID_CACHE_KEY);
      if (cached && cached.trim()) salonId = cached.trim();
    } catch (e) {}
  }

  // Persist for next load (when auth may be slow)
  if (salonId && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(SALON_ID_CACHE_KEY, salonId);
    } catch (e) {}
  }

  return salonId || null;
}

function readStoredActiveLocationId() {
  if (typeof localStorage === "undefined") return "";
  try {
    return String(localStorage.getItem("ff_active_location_id") || "").trim();
  } catch (_) {
    return "";
  }
}

function cachedActiveLocationCount() {
  try {
    if (typeof window !== "undefined" && typeof window.ffGetLocations === "function") {
      const locs = window.ffGetLocations() || [];
      return locs.filter((loc) => loc && loc.isActive !== false).length;
    }
  } catch (_) {}
  return 0;
}

function locationsReady() {
  try {
    if (typeof window !== "undefined" && window.ffLocationsState && window.ffLocationsState.loaded) return true;
  } catch (_) {}
  return cachedActiveLocationCount() > 0;
}

/**
 * Resolve the active location id from the header switcher. When nothing is
 * active (single-location salon, or locations not loaded yet), returns "".
 * Also reads the persisted header location so Tasks does not attach to the
 * legacy salon-wide "default" doc during boot.
 */
function readActiveLocationId() {
  if (typeof window === "undefined") return "";
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const v = window.ffGetActiveLocationId();
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch (_) {}
  const raw = typeof window.__ff_active_location_id === "string" ? window.__ff_active_location_id.trim() : "";
  return raw || readStoredActiveLocationId();
}

/** Header location, or the staff member's only allowed branch.
 *  Brickell technicians often have no switcher; without this fallback their
 *  takes/completions write to tasksState/default and View-All users on the
 *  real branch never see them. */
function resolveTasksLocationId() {
  const active = readActiveLocationId();
  if (active) return active;
  try {
    if (typeof window.ffGetUserAllowedLocations === "function") {
      const allowed = window.ffGetUserAllowedLocations() || [];
      const ids = allowed.map((l) => (l && l.id ? String(l.id).trim() : "")).filter(Boolean);
      if (ids.length === 1) return ids[0];
    }
  } catch (_) {}
  try {
    if (typeof window.ffResolveCurrentStaff === "function" && typeof window.ffEnsureStaffLocationFields === "function") {
      const staff = window.ffResolveCurrentStaff();
      if (staff) {
        const fields = window.ffEnsureStaffLocationFields(staff);
        const ids = Array.isArray(fields.allowedLocationIds)
          ? fields.allowedLocationIds.map((id) => String(id || "").trim()).filter(Boolean)
          : [];
        if (ids.length === 1) return ids[0];
        if (fields.primaryLocationId) return String(fields.primaryLocationId).trim();
      }
    }
  } catch (_) {}
  return "";
}

function userHasMultipleLocations() {
  try {
    if (typeof window !== "undefined" && typeof window.ffUserHasMultipleLocations === "function") {
      return !!window.ffUserHasMultipleLocations();
    }
  } catch (_) {}
  return cachedActiveLocationCount() > 1;
}

/** Multi-location (or not yet known): never fall back to tasksState/default. */
function mustNotUseDefaultDoc(locationId) {
  const loc = typeof locationId === "string" ? locationId.trim() : "";
  if (loc) return false;
  if (userHasMultipleLocations()) return true;
  if (cachedActiveLocationCount() > 1) return true;
  if (!locationsReady()) return true;
  return false;
}

function readTasksLsLocationId() {
  try {
    return String(localStorage.getItem("ff_tasks_ls_location_id_v1") || "").trim();
  } catch (_) {
    return "";
  }
}

function writeTasksLsLocationId(locationId) {
  try {
    const v = typeof locationId === "string" ? locationId.trim() : "";
    if (v) localStorage.setItem("ff_tasks_ls_location_id_v1", v);
    else localStorage.removeItem("ff_tasks_ls_location_id_v1");
  } catch (_) {}
}

/** doc id for the tasksState document — locationId per branch, otherwise "default". */
function tasksStateDocIdFor(locationId) {
  const v = typeof locationId === "string" ? locationId.trim() : "";
  return v || TASKS_STATE_DEFAULT;
}

function tasksStateRef(salonId, locationId) {
  return doc(db, `salons/${salonId}/tasksState`, tasksStateDocIdFor(locationId));
}

function firestoreProjectId() {
  try {
    return (db && db.app && db.app.options && db.app.options.projectId) || "fairflowapp-db841";
  } catch (_) {
    return "fairflowapp-db841";
  }
}

function tasksStateRestUrl(salonId, locationId) {
  const projectId = firestoreProjectId();
  const docId = tasksStateDocIdFor(locationId);
  const path = ["salons", salonId, "tasksState", docId].map(encodeURIComponent).join("/");
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`;
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== "object") return undefined;
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return !!value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("stringValue" in value) return String(value.stringValue || "");
  if ("arrayValue" in value) return ((value.arrayValue && value.arrayValue.values) || []).map(firestoreValueToJs);
  if ("mapValue" in value) {
    const out = {};
    const fields = (value.mapValue && value.mapValue.fields) || {};
    Object.keys(fields).forEach((key) => { out[key] = firestoreValueToJs(fields[key]); });
    return out;
  }
  return undefined;
}

function firestoreDocToJs(docJson) {
  const out = {};
  const fields = (docJson && docJson.fields) || {};
  Object.keys(fields).forEach((key) => { out[key] = firestoreValueToJs(fields[key]); });
  return out;
}

function jsToFirestoreValue(value) {
  if (value === null || typeof value === "undefined") return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(jsToFirestoreValue) } };
  if (value && typeof value === "object") {
    if (typeof value.toISOString === "function") return { timestampValue: value.toISOString() };
    if (typeof value.seconds === "number") {
      return { timestampValue: new Date(value.seconds * 1000).toISOString() };
    }
    const fields = {};
    Object.keys(value).forEach((key) => {
      const v = value[key];
      if (typeof v !== "undefined" && typeof v !== "function") fields[key] = jsToFirestoreValue(v);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

async function readTasksStateViaRest(salonId, locationId) {
  const user = auth.currentUser;
  if (!user || typeof user.getIdToken !== "function") throw new Error("No auth token for Tasks REST read");
  const token = await user.getIdToken();
  const res = await fetch(tasksStateRestUrl(salonId, locationId), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Tasks REST read failed: ${res.status}`);
  return firestoreDocToJs(await res.json());
}

async function writeTasksStateViaRest(salonId, locationId, payload) {
  const user = auth.currentUser;
  if (!user || typeof user.getIdToken !== "function") throw new Error("No auth token for Tasks REST write");
  const token = await user.getIdToken();
  const cleanPayload = { ...payload, updatedAt: new Date().toISOString() };
  const fieldsValue = jsToFirestoreValue(cleanPayload);
  const res = await fetch(tasksStateRestUrl(salonId, locationId), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: fieldsValue.mapValue.fields || {} })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tasks REST write failed: ${res.status} ${text.slice(0, 180)}`);
  }
}

function sharedTaskTemplatesRef(accountId) {
  return collection(db, `accounts/${accountId}/shared/taskTemplates/items`);
}

function mapSharedTaskTemplateToCatalogTask(template) {
  if (!template || template.active === false) return null;
  const tab = TABS.includes(template.tab) ? template.tab : "opening";
  const id = `shared:${template.id}`;
  const task = {
    id,
    taskId: id,
    title: String(template.title || "").trim(),
    instructions: String(template.instructions || "").trim(),
    assignTo: template.assignTo || "all",
    technicianTypes: Array.isArray(template.technicianTypes) ? template.technicianTypes : [],
    sharedTemplateId: template.id,
    isSharedTemplate: true
  };
  const schedule = template.schedule && typeof template.schedule === "object" ? template.schedule : null;
  if (tab === "weekly") {
    task.scheduleWeekdays = schedule?.weekday ? [schedule.weekday] : "any";
  } else if (tab === "monthly") {
    task.scheduleDayOfMonth = schedule?.day || "any";
  } else if (tab === "yearly") {
    task.scheduleMonth = Number(schedule?.month) || null;
    task.scheduleDay = Number(schedule?.day) || null;
  }
  if (!task.title) return null;
  return { tab, task };
}

async function loadSharedTaskCatalog(accountId) {
  if (!accountId) return {};
  try {
    const snap = await getDocs(sharedTaskTemplatesRef(accountId));
    const catalog = {};
    TABS.forEach((tab) => { catalog[tab] = []; });
    snap.docs.forEach((d) => {
      const mapped = mapSharedTaskTemplateToCatalogTask({ id: d.id, ...d.data() });
      if (!mapped) return;
      catalog[mapped.tab].push(mapped.task);
    });
    TABS.forEach((tab) => {
      catalog[tab].sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    });
    return catalog;
  } catch (e) {
    console.warn("[SharedTasks] load templates failed", e);
    return {};
  }
}

async function isTaskTemplatesShareEnabled(accountId) {
  if (!accountId) return false;
  try {
    const snap = await getDoc(doc(db, `accounts/${accountId}/shared/taskTemplates`));
    const data = snap.exists() ? (snap.data() || {}) : {};
    return data.shareEnabled === true || data.enabled === true;
  } catch (_) {
    return false;
  }
}

async function mergeSharedTaskTemplatesIntoState(state, accountId) {
  const base = state || emptyCloudState();
  if (!(await isTaskTemplatesShareEnabled(accountId))) return base;
  const sharedCatalog = await loadSharedTaskCatalog(accountId);
  const mergedCatalog = { ...(base.catalog || {}) };
  TABS.forEach((tab) => {
    const localList = Array.isArray(mergedCatalog[tab]) ? mergedCatalog[tab] : [];
    const byId = new Map();
    localList.forEach((task) => {
      const key = String(task?.taskId || task?.id || "").trim();
      if (key) byId.set(key, task);
    });
    (sharedCatalog[tab] || []).forEach((task) => {
      const key = String(task.taskId || task.id || "").trim();
      if (key) byId.set(key, { ...(byId.get(key) || {}), ...task });
    });
    mergedCatalog[tab] = Array.from(byId.values());
  });
  return { ...base, catalog: mergedCatalog };
}

let _firstSnapshot = true;

function stateHasData(state) {
  if (!state) return false;
  if (Object.keys(state.catalog || {}).length > 0) return true;
  return TABS.some((tab) => {
    const t = state[tab];
    if (!t) return false;
    return (t.active?.length || 0) + (t.pending?.length || 0) + (t.done?.length || 0) > 0;
  });
}

/**
 * Flush every Tasks localStorage key that is tied to a specific location so
 * the previous branch's tasks don't remain visible while we wait for the
 * new location's snapshot. The cloud listener will repopulate whatever
 * exists for the newly active branch.
 */
function flushLocalTasksState() {
  if (typeof localStorage === "undefined") return;
  const _wasHook = typeof window !== "undefined" ? window.__ffTasksApplyingRemote : false;
  if (typeof window !== "undefined") window.__ffTasksApplyingRemote = true;
  try {
    LS_KEYS_STATIC.forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
    TABS.forEach((tab) => {
      KINDS.forEach((kind) => {
        try { localStorage.removeItem(`ff_tasks_${tab}_${kind}_v1`); } catch (_) {}
      });
    });
    if (typeof window !== "undefined") window.ff_tasks_catalog_v1 = {};
  } finally {
    if (typeof window !== "undefined") window.__ffTasksApplyingRemote = _wasHook;
  }
}

function emptyCloudState() {
  return {
    catalog: {},
    opening: { active: [], pending: [], done: [] },
    closing: { active: [], pending: [], done: [] },
    weekly:  { active: [], pending: [], done: [] },
    monthly: { active: [], pending: [], done: [] },
    yearly:  { active: [], pending: [], done: [] },
    tombstone: {},
    alertWindows: {},
    enforceSelectSettings: {},
    autoResetState: {},
    resetStamps: {}
  };
}

function beginLocationHardReplace() {
  if (_writeTimeout) {
    clearTimeout(_writeTimeout);
    _writeTimeout = null;
  }
  if (typeof window !== "undefined") {
    window.__ffTasksHardReplace = true;
    window.__ffTasksLastLocalWrite = 0;
    window.__ffTasksReturnLocalWriteUntil = 0;
  }
  flushLocalTasksState();
  if (typeof _applyState === "function") {
    try {
      if (typeof window !== "undefined") window.__ffTasksApplyingRemote = true;
      _applyState(emptyCloudState());
    } finally {
      if (typeof window !== "undefined") window.__ffTasksApplyingRemote = false;
    }
    if (typeof _onRefresh === "function") {
      try { _onRefresh(); } catch (_) {}
    }
  }
}

let _hasSubscribedOnce = false;

function subscribe(salonId, locationId) {
  let loc = typeof locationId === "string" ? locationId.trim() : "";
  if (!loc) loc = resolveTasksLocationId();
  locationId = loc;
  // Multi-location, or locations not loaded yet: never attach to the legacy
  // salon-wide "default" doc. That document is the old mixed catalog and is
  // why Key Biscayne still showed Brickell completions.
  if (mustNotUseDefaultDoc(loc)) {
    if (_unsubscribe) {
      _unsubscribe();
      _unsubscribe = null;
    }
    _salonId = salonId;
    _locationId = "";
    _subscriptionSeq += 1;
    _lastServerData = null;
    _lastCloudRev = 0;
    if (typeof window !== "undefined") window.__ffTasksApplyingDocId = "";
    // Wait for the real branch id. Do not wipe — technicians already have
    // today's takes in localStorage and View-All users need those flushed.
    if (typeof window !== "undefined") window.__ffTasksHardReplace = false;
    return;
  }

  const nextDocId = tasksStateDocIdFor(locationId);
  const prevDocId = tasksStateDocIdFor(_locationId);
  const lsLoc = readTasksLsLocationId();
  const lsMismatch = !!(lsLoc && lsLoc !== nextDocId);
  if (_salonId === salonId && prevDocId === nextDocId && _unsubscribe && !lsMismatch) return;
  const switchingRealBranch = !!(
    prevDocId &&
    nextDocId &&
    prevDocId !== TASKS_STATE_DEFAULT &&
    nextDocId !== TASKS_STATE_DEFAULT &&
    prevDocId !== nextDocId
  );
  const switchingByLs = !!(lsLoc && lsLoc !== TASKS_STATE_DEFAULT && lsLoc !== nextDocId);
  let preservedLocal = null;
  try { preservedLocal = _getState ? _getState() : null; } catch (_) { preservedLocal = null; }
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _salonId = salonId;
  _locationId = locationId;
  _firstSnapshot = true;
  _lastCloudRev = 0;
  _lastServerData = null;
  if (typeof window !== "undefined") window.__ffTasksApplyingDocId = nextDocId;

  // Only wipe when moving between two real branches (Brickell ↔ Key Biscayne).
  // First attach / default → Brickell must keep today's local takes so they
  // can be written to the branch doc that View-All users actually read.
  if (switchingRealBranch || switchingByLs) {
    beginLocationHardReplace();
    preservedLocal = null;
  } else if (typeof window !== "undefined") {
    window.__ffTasksHardReplace = false;
  }
  _hasSubscribedOnce = true;

  const ref = tasksStateRef(salonId, locationId);
  const logTag = locationId ? `loc=${locationId}` : "default";
  const subscriptionSeq = ++_subscriptionSeq;
  const expectedSalonId = salonId;
  const expectedDocId = nextDocId;
  _unsubscribe = onSnapshot(ref, async (snap) => {
    if (!tasksCloudScopeStillCurrent(expectedSalonId, expectedDocId, subscriptionSeq)) {
      console.warn("[TasksCloud] ignored stale snapshot", {
        expectedSalonId,
        currentSalonId: _salonId,
        expectedDocId,
        currentDocId: tasksStateDocIdFor(_locationId),
        subscriptionSeq,
        activeSeq: _subscriptionSeq
      });
      return;
    }
    if (!_applyState) return;
    if (
      typeof window !== "undefined" &&
      window.__ffTasksHardReplace !== true &&
      Number(window.__ffTasksReturnLocalWriteUntil || 0) > Date.now()
    ) {
      return;
    }

    // NOTE: We deliberately do NOT push local state → cloud when the salon is empty.
    // For a brand-new owner account the cloud is legitimately empty, and copying up
    // localStorage tasks from the previous account leaks data across tenants.
    // Instead, when the cloud is empty we clear the local applied state so stale
    // tasks from a previous account cannot leak into the UI.
    //
    // Additionally: when we just switched to a different LOCATION whose cloud doc
    // does not exist yet, we must NOT migrate the default/other-location data.
    // Each branch is "its own business" and starts fresh.
    if (!snap.exists()) {
      _lastServerData = null;
      const isFirstEmpty = _firstSnapshot;
      _firstSnapshot = false;
      let emptyApply = emptyCloudState();
      let flushEmpty = false;
      if (isFirstEmpty && preservedLocal && localStateHasRecentTakes(preservedLocal)) {
        const mergedEmpty = mergeRecentLocalTakesIntoServer(preservedLocal, emptyApply);
        if (mergedEmpty.changed) {
          emptyApply = mergedEmpty.state;
          flushEmpty = true;
        }
      }
      try {
        if (typeof window !== "undefined") {
          window.__ffTasksApplyingRemote = true;
          window.__ffTasksHardReplace = true;
          window.__ffTasksApplyingDocId = nextDocId;
        }
        writeTasksLsLocationId(nextDocId);
        _applyState(await mergeSharedTaskTemplatesIntoState(emptyApply, salonId));
        if (typeof _onRefresh === "function") _onRefresh();
      } catch (e) {
        console.warn("[TasksCloud] clear-local-on-empty-cloud failed", e, logTag);
      } finally {
        if (typeof window !== "undefined") {
          window.__ffTasksApplyingRemote = false;
          window.__ffTasksHardReplace = false;
        }
      }
      if (flushEmpty) writeState("flush-local-takes");
      return;
    }
    const data = snap.data();
    const isFirst = _firstSnapshot;
    _firstSnapshot = false;

    // Always keep the freshest server doc as the write merge base + rev source,
    // even for snapshots we don't re-apply to the UI (echoes / equal rev). This
    // is what lets writes use a correct rev WITHOUT a blocking server read.
    _lastServerData = data;

    let toApply = data;
    let flushTakes = false;
    if (isFirst && preservedLocal && localStateHasRecentTakes(preservedLocal, undefined, data.resetStamps)) {
      const merged = mergeRecentLocalTakesIntoServer(preservedLocal, data);
      if (merged.changed) {
        toApply = merged.state;
        flushTakes = true;
      }
    }
    if (isFirst && typeof window !== "undefined") {
      window.__ffTasksHardReplace = true;
      window.__ffTasksApplyingDocId = nextDocId;
    }

    // Revision gate: a snapshot whose rev we have already seen is either the
    // echo of our own transaction or a stale read — never re-apply it (this is
    // what allows "the newest write is authoritative" without flapping).
    const snapRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
    if (snapRev > 0 && snapRev <= _lastCloudRev) return;
    if (snapRev > _lastCloudRev) _lastCloudRev = snapRev;

    if (typeof window !== "undefined") {
      window.__ffTasksApplyingRemote = true;
      window.__ffTasksApplyingDocId = nextDocId;
    }
    try {
      writeTasksLsLocationId(nextDocId);
      _applyState(await mergeSharedTaskTemplatesIntoState(toApply, salonId));
      if (typeof _onRefresh === "function") _onRefresh();
    } finally {
      if (typeof window !== "undefined") {
        window.__ffTasksApplyingRemote = false;
        window.__ffTasksHardReplace = false;
      }
    }
    if (flushTakes) writeState("flush-local-takes");
  }, (err) => {
    if (!tasksCloudScopeStillCurrent(expectedSalonId, expectedDocId, subscriptionSeq)) return;
    console.error("[TasksCloud] subscribe error", logTag, err);
  });
}

function buildFirestoreState(state) {
  const out = {
    catalog: state.catalog || {},
    tombstone: state.tombstone || {},
    alertWindows: state.alertWindows || {},
    enforceSelectSettings: state.enforceSelectSettings || {},
    autoResetState: state.autoResetState || {},
    resetStamps: state.resetStamps || {},
    updatedAt: serverTimestamp()
  };
  const isolateClearAt = Number(state.isolateClearAt || 0);
  if (isolateClearAt > 0) out.isolateClearAt = isolateClearAt;
  TABS.forEach((tab) => {
    out[tab] = {
      active: Array.isArray(state[tab]?.active) ? state[tab].active : [],
      pending: Array.isArray(state[tab]?.pending) ? state[tab].pending : [],
      done: Array.isArray(state[tab]?.done) ? state[tab].done : []
    };
  });
  return out;
}

function rowTimeValue(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (v && typeof v.seconds === "number") return v.seconds * 1000;
  const p = Date.parse(v);
  return Number.isFinite(p) ? p : 0;
}

function taskRowTime(row) {
  return rowTimeValue(row && (row.completedAt || row.updatedAt || row.createdAt));
}

/** Time of the last action on a row (take / done / return), used for merge. */
function rowActionTime(row) {
  return rowTimeValue(row && (row.completedAt || row.updatedAt || row.selectedAt || row.createdAt));
}

function rowId(row) {
  return String((row && (row.taskId || row.id)) || "").trim();
}

/** Union of done rows by task id — the row with the newest timestamp wins. */
function unionDoneNewestWins(localRows, serverRows) {
  const byId = new Map();
  const put = (row) => {
    const id = rowId(row);
    if (!id) return;
    const normalized = { ...row, id, taskId: id, status: "done" };
    const existing = byId.get(id);
    if (!existing || taskRowTime(normalized) >= taskRowTime(existing)) byId.set(id, normalized);
  };
  (Array.isArray(serverRows) ? serverRows : []).forEach(put);
  (Array.isArray(localRows) ? localRows : []).forEach(put);
  return Array.from(byId.values());
}

/** Newest-wins merge of the active roster by task id. Take / mark-done / return
 *  all update the active row with a fresh timestamp, so the row carrying the
 *  latest action wins — no device can blind-overwrite another's selection. */
function mergeActiveNewestWins(localRows, serverRows) {
  const byId = new Map();
  const put = (row) => {
    const id = rowId(row);
    if (!id) return;
    const existing = byId.get(id);
    if (!existing || rowActionTime(row) >= rowActionTime(existing)) byId.set(id, row);
  };
  (Array.isArray(serverRows) ? serverRows : []).forEach(put);
  (Array.isArray(localRows) ? localRows : []).forEach(put);
  return Array.from(byId.values());
}

function newestPendingRowById(localRows, serverRows) {
  const byId = new Map();
  const put = (row) => {
    const id = rowId(row);
    if (!id) return;
    const existing = byId.get(id);
    if (!existing || rowActionTime(row) >= rowActionTime(existing)) byId.set(id, row);
  };
  (Array.isArray(serverRows) ? serverRows : []).forEach(put);
  (Array.isArray(localRows) ? localRows : []).forEach(put);
  return byId;
}

/**
 * Three-list merge for one tab, used by BOTH the cloud write (so a writer never
 * clobbers another device's pending/active) and applyState (so a reader never
 * loses its own just-made selection). Only called when both sides share the
 * same reset generation — a fresh reset is handled separately by resetStamps.
 *
 * Rules (all driven by per-row action timestamps):
 *   - active : newest action per id wins (the roster row reflects take/done/return).
 *   - done   : union, newest per id wins.
 *   - pending: a pending row stays only if no NEWER active row moved the task
 *              away from "pending" (i.e. it was marked done or returned). This
 *              makes removals (return / done) win over a stale pending copy
 *              without resurrecting it.
 */
function mergeTabAllLists(localTab, serverTab) {
  const L = localTab || {};
  const S = serverTab || {};
  const mergedActive = mergeActiveNewestWins(L.active, S.active);
  const mergedDone = unionDoneNewestWins(L.done, S.done);

  // Index merged active rows by id for the pending cross-check.
  const activeById = new Map();
  mergedActive.forEach((row) => {
    const id = rowId(row);
    if (id) activeById.set(id, row);
  });

  const pendingById = newestPendingRowById(L.pending, S.pending);
  const mergedPending = [];
  pendingById.forEach((pRow, id) => {
    const aRow = activeById.get(id);
    if (aRow) {
      const status = String((aRow.status || "")).toLowerCase();
      const movedAway = status !== "pending";
      // A strictly newer active row that is no longer "pending" means the task
      // was completed or returned after it was taken → drop the stale pending.
      if (movedAway && rowActionTime(aRow) > rowActionTime(pRow)) return;
    }
    mergedPending.push(pRow);
  });

  return { active: mergedActive, pending: mergedPending, done: mergedDone };
}

// Opening/closing reset daily. Keep same-day local takes long enough to flush
// them to the branch doc after a reload. July leftovers from tasksState/default
// are older than this and must not be copied onto Brickell.
const LOCAL_TAKE_FLUSH_MAX_AGE_MS = 36 * 60 * 60 * 1000;

function resetStampForTab(resetStamps, tab) {
  return Number((resetStamps && resetStamps[tab]) || 0) || 0;
}

function takeSurvivesReset(row, tab, resetStamps) {
  const resetAt = resetStampForTab(resetStamps, tab);
  const t = rowActionTime(row);
  if (resetAt && t && t < resetAt) return false;
  return true;
}

function localStateHasRecentTakes(state, maxAgeMs, resetStamps) {
  if (!state) return false;
  const cutoff = Date.now() - (typeof maxAgeMs === "number" ? maxAgeMs : LOCAL_TAKE_FLUSH_MAX_AGE_MS);
  return TABS.some((tab) => {
    const t = state[tab];
    if (!t) return false;
    const rows = []
      .concat(Array.isArray(t.pending) ? t.pending : [])
      .concat(Array.isArray(t.done) ? t.done : [])
      .concat((Array.isArray(t.active) ? t.active : []).filter((r) => {
        const status = String((r && r.status) || "").toLowerCase();
        return status === "pending" || status === "done" || !!(r && (r.assignedTo || r.completedAt));
      }));
    return rows.some((r) => rowActionTime(r) >= cutoff && takeSurvivesReset(r, tab, resetStamps));
  });
}

function mergeRecentLocalTakesIntoServer(local, server, maxAgeMs) {
  const cutoff = Date.now() - (typeof maxAgeMs === "number" ? maxAgeMs : LOCAL_TAKE_FLUSH_MAX_AGE_MS);
  const base = (server && typeof server === "object") ? server : {};
  const out = { ...base };
  let changed = false;
  TABS.forEach((tab) => {
    const L = (local && local[tab]) || {};
    const S = (out[tab] && typeof out[tab] === "object")
      ? out[tab]
      : { active: [], pending: [], done: [] };
    const stamps = (base && base.resetStamps && typeof base.resetStamps === "object")
      ? base.resetStamps
      : {};
    const recentPending = (Array.isArray(L.pending) ? L.pending : []).filter((r) => (
      rowActionTime(r) >= cutoff && takeSurvivesReset(r, tab, stamps)
    ));
    const recentDone = (Array.isArray(L.done) ? L.done : []).filter((r) => (
      rowActionTime(r) >= cutoff && takeSurvivesReset(r, tab, stamps)
    ));
    const recentActive = (Array.isArray(L.active) ? L.active : []).filter((r) => {
      const status = String((r && r.status) || "").toLowerCase();
      if (!(status === "pending" || status === "done" || (r && (r.assignedTo || r.completedAt)))) return false;
      return rowActionTime(r) >= cutoff && takeSurvivesReset(r, tab, stamps);
    });
    if (!recentPending.length && !recentDone.length && !recentActive.length) return;
    const serverPending = Array.isArray(S.pending) ? S.pending : [];
    const serverDone = Array.isArray(S.done) ? S.done : [];
    const missing = recentPending.some((r) => {
      const id = rowId(r);
      return id && !serverPending.some((s) => rowId(s) === id);
    }) || recentDone.some((r) => {
      const id = rowId(r);
      return id && !serverDone.some((s) => rowId(s) === id);
    });
    if (!missing && !recentActive.length) return;
    out[tab] = mergeTabAllLists(S, {
      active: recentActive.length ? recentActive : (L.active || []),
      pending: recentPending,
      done: recentDone
    });
    changed = true;
  });
  return { state: out, changed };
}

function serverRev(server) {
  return (server && typeof server.rev === "number" && server.rev >= 0) ? server.rev : 0;
}

// Retention (business rule): "done" rows in the SHORT-cycle tabs older than
// 60 days are dead weight — opening/closing reset daily and weekly resets
// weekly, so a done marker that old can no longer affect anything shown.
// Monthly/yearly are NOT pruned: they must remember completions for their
// whole period. This keeps the doc from slowly accumulating stale rows (the
// queue history log hit Firestore's 1MiB doc limit exactly this way and every
// write started failing). FairFlow Points live in separate pointsEvents docs
// written at completion time — pruning these display rows never touches them.
const TASKS_DONE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const TASKS_DONE_PRUNE_TABS = ["opening", "closing", "weekly"];
function ffPruneOldDoneRows(out) {
  const cutoff = Date.now() - TASKS_DONE_MAX_AGE_MS;
  TASKS_DONE_PRUNE_TABS.forEach((tab) => {
    const t = out && out[tab];
    if (!t || !Array.isArray(t.done)) return;
    t.done = t.done.filter((row) => {
      const raw = row && (row.completedAt || row.ts);
      const ts = typeof raw === "number" ? raw
        : (typeof raw === "string" ? (Date.parse(raw) || 0) : 0);
      return !ts || ts >= cutoff;
    });
  });
}

/** Keep server auto-reset fields when a flushed/partial local object omitted them. */
function mergeAlertWindows(localAw, serverAw) {
  const local = (localAw && typeof localAw === "object") ? localAw : {};
  const server = (serverAw && typeof serverAw === "object") ? serverAw : {};
  const localKeys = Object.keys(local);
  const serverKeys = Object.keys(server);
  if (!localKeys.length && serverKeys.length) return { ...server };
  const tabs = new Set([...localKeys, ...serverKeys, ...TABS]);
  const out = {};
  tabs.forEach((tab) => {
    const L = (local[tab] && typeof local[tab] === "object") ? local[tab] : {};
    const S = (server[tab] && typeof server[tab] === "object") ? server[tab] : {};
    if (!Object.keys(L).length && !Object.keys(S).length) return;
    const merged = { ...S, ...L };
    if (L.autoResetEnabled === undefined && S.autoResetEnabled !== undefined) {
      merged.autoResetEnabled = S.autoResetEnabled;
    }
    if ((L.autoResetTime == null || L.autoResetTime === "") && S.autoResetTime) {
      merged.autoResetTime = S.autoResetTime;
    }
    if (L.autoResetForce === undefined && S.autoResetForce !== undefined) {
      merged.autoResetForce = S.autoResetForce;
    }
    out[tab] = merged;
  });
  return out;
}

function buildMergedWritePayload(state, server, reason, baseRevOverride) {
  const out = buildFirestoreState(state);
  const baseRev = typeof baseRevOverride === "number" && baseRevOverride >= 0
    ? baseRevOverride
    : serverRev(server);

  if (server && typeof server === "object") {
    const serverIsolate = Number(server.isolateClearAt || 0);
    const localIsolate = Number(state.isolateClearAt || 0);
    // Only the first apply of a newer wipe replaces lists. After this device
    // already has the same isolate stamp, merge normally — otherwise every
    // take/done on Brickell is discarded and View-All stays empty.
    if (serverIsolate > 0 && serverIsolate > localIsolate) {
      // A location-isolate wipe won. Do not restore the old shared catalog
      // from a device that still has Brickell leftovers in localStorage.
      out.catalog = (server.catalog && typeof server.catalog === "object") ? server.catalog : {};
      TABS.forEach((tab) => {
        out[tab] = {
          active: Array.isArray(server[tab]?.active) ? server[tab].active : [],
          pending: Array.isArray(server[tab]?.pending) ? server[tab].pending : [],
          done: Array.isArray(server[tab]?.done) ? server[tab].done : []
        };
      });
      out.resetStamps = (server.resetStamps && typeof server.resetStamps === "object")
        ? { ...server.resetStamps }
        : (out.resetStamps || {});
      out.isolateClearAt = serverIsolate;
      ffPruneOldDoneRows(out);
      out.rev = baseRev + 1;
      out.lastUpdateReason = typeof reason === "string" && reason ? reason : "task-update";
      out.lastUpdatedByUid = (auth.currentUser && auth.currentUser.uid) || null;
      if (server.alertWindows) out.alertWindows = mergeAlertWindows(out.alertWindows, server.alertWindows);
      if (server.autoResetState) out.autoResetState = server.autoResetState;
      return { payload: out, rev: out.rev, baseRev };
    }
    const serverStamps = (server.resetStamps && typeof server.resetStamps === "object") ? server.resetStamps : {};
    const localStamps = (state.resetStamps && typeof state.resetStamps === "object") ? state.resetStamps : {};
    const mergedStamps = { ...localStamps };
    const isManualReset = reason === "manual-reset";
    TABS.forEach((tab) => {
      const sv = Number(serverStamps[tab] || 0);
      const lv = Number(localStamps[tab] || 0);
      if (isManualReset && lv >= sv) {
        // This device just reset — keep the clean local lists. Merging here
        // is what used to write yesterday's done rows back onto a fresh reset.
        mergedStamps[tab] = lv;
        return;
      }
      if (sv > lv) {
        // Server tab was reset after our local copy — server lists win.
        out[tab] = {
          active: Array.isArray(server[tab]?.active) ? server[tab].active : [],
          pending: Array.isArray(server[tab]?.pending) ? server[tab].pending : [],
          done: Array.isArray(server[tab]?.done) ? server[tab].done : []
        };
        mergedStamps[tab] = sv;
      } else if (sv === lv) {
        // Same reset generation — three-list merge so concurrent selections,
        // completions and returns from other devices are never dropped by our
        // full-state write.
        out[tab] = mergeTabAllLists(out[tab], server[tab]);
      }
      // lv > sv: this device just reset this tab — local clean lists win.
    });
    out.resetStamps = mergedStamps;

    // Never let an empty local catalog clobber a non-empty server catalog.
    // Day-to-day list merges can succeed while catalog was wiped on one device;
    // without this guard every subsequent write re-empties catalog in the cloud.
    const serverCatalog = (server.catalog && typeof server.catalog === "object") ? server.catalog : {};
    const localCatalog = (out.catalog && typeof out.catalog === "object") ? out.catalog : {};
    const mergedCatalog = { ...localCatalog };
    TABS.forEach((tab) => {
      const localList = Array.isArray(localCatalog[tab]) ? localCatalog[tab] : [];
      const serverList = Array.isArray(serverCatalog[tab]) ? serverCatalog[tab] : [];
      if (serverList.length > 0 && localList.length === 0) {
        mergedCatalog[tab] = serverList;
      } else if (localList.length > 0) {
        mergedCatalog[tab] = localList;
      } else {
        mergedCatalog[tab] = serverList;
      }
    });
    out.catalog = mergedCatalog;

    // Never let a stale local autoResetState clobber a newer server lastRunDate
    // (scheduledTasksAutoReset stamps opening/closing on the server).
    const serverARS = (server.autoResetState && typeof server.autoResetState === "object")
      ? server.autoResetState
      : {};
    const localARS = (out.autoResetState && typeof out.autoResetState === "object")
      ? out.autoResetState
      : {};
    const mergedARS = { ...localARS };
    const arsTabs = new Set([...Object.keys(localARS), ...Object.keys(serverARS), ...TABS]);
    arsTabs.forEach((tab) => {
      const lDate = (localARS[tab] && localARS[tab].lastRunDate) ? String(localARS[tab].lastRunDate) : "";
      const sDate = (serverARS[tab] && serverARS[tab].lastRunDate) ? String(serverARS[tab].lastRunDate) : "";
      const keepDate = (!lDate && sDate) ? sDate
        : (!sDate && lDate) ? lDate
        : (sDate >= lDate ? sDate : lDate);
      if (!keepDate && !localARS[tab] && !serverARS[tab]) return;
      mergedARS[tab] = { ...(localARS[tab] || {}), ...(serverARS[tab] || {}) };
      if (keepDate) mergedARS[tab].lastRunDate = keepDate;
    });
    out.autoResetState = mergedARS;
    out.alertWindows = mergeAlertWindows(out.alertWindows, server.alertWindows);
  }

  ffPruneOldDoneRows(out);
  out.rev = baseRev + 1;
  out.lastUpdateReason = typeof reason === "string" && reason ? reason : "task-update";
  out.lastUpdatedByUid = (auth.currentUser && auth.currentUser.uid) || null;
  return { payload: out, rev: out.rev, baseRev };
}

/**
 * Push local state → cloud with queue-style optimistic concurrency:
 *
 *   1. rev compare-and-swap — the write lands at rev = server rev + 1 and the
 *      security rules reject anything else, so concurrent writers from any
 *      device are serialized by the server. If our tracked rev is stale, we
 *      pull the fresh server doc, merge, and retry rather than blind-overwrite.
 *   2. Reset stamps — a tab whose server resetStamp is NEWER than this
 *      device's is stale here: the server's clean lists are kept (a stale
 *      device can never resurrect pre-reset tasks). A tab whose LOCAL stamp
 *      is newer means WE just reset it — local lists win wholesale.
 *   3. Newest-wins done merge — when stamps are equal (normal work), done
 *      rows are unioned per task id with the newest timestamp winning, so
 *      two staff marking tasks at the same moment never erase each other.
 */
function writeState(reason) {
  if (typeof window !== "undefined" && window.__ffTasksHardReplace) {
    console.warn("[TasksCloud] writeState skipped — location hard-replace in progress");
    return Promise.resolve();
  }
  if (typeof window !== "undefined") window.__ffTasksLastLocalWrite = Date.now();
  const resolvedLoc = resolveTasksLocationId();
  if (resolvedLoc && resolvedLoc !== _locationId) {
    _locationId = resolvedLoc;
    _lastServerData = null;
    _lastCloudRev = 0;
  }
  const writeLocId = tasksStateDocIdFor(_locationId);
  if (mustNotUseDefaultDoc(_locationId) || (userHasMultipleLocations() && writeLocId === TASKS_STATE_DEFAULT) || (cachedActiveLocationCount() > 1 && writeLocId === TASKS_STATE_DEFAULT)) {
    console.warn("[TasksCloud] blocked write to default on a multi-location salon", {
      locationId: _locationId || null,
      writeLocId
    });
    return Promise.resolve();
  }
  const lsLocForWrite = readTasksLsLocationId();
  if (lsLocForWrite && writeLocId && lsLocForWrite !== writeLocId && !(lsLocForWrite === TASKS_STATE_DEFAULT && writeLocId !== TASKS_STATE_DEFAULT)) {
    console.warn("[TasksCloud] blocked write — localStorage belongs to another location", {
      lsLocForWrite,
      writeLocId
    });
    return Promise.resolve();
  }
  const isManualReset = reason === "manual-reset";
  const toast = (msg, kind) => {
    if (typeof window !== "undefined" && typeof window.showToast === "function") {
      try { window.showToast(msg, kind || "error"); } catch (_) {}
    }
  };
  if (!_salonId || !_getState) {
    console.warn("[TasksCloud] writeState skipped — no salonId or getState", { salonId: _salonId });
    if (isManualReset) toast("Reset NOT saved: no cloud connection (salon not linked)", "error");
    return Promise.resolve();
  }
  if (!tasksCloudScopeStillCurrent(_salonId, tasksStateDocIdFor(_locationId), _subscriptionSeq)) {
    const activeSalon = currentWindowSalonId();
    const kioskSalon = kioskClaimSalonId();
    console.warn("[TasksCloud] blocked write for stale scope", {
      salonId: _salonId,
      activeSalon,
      kioskSalon,
      activeLocationId: _locationId || null,
      tasksStateDocId: tasksStateDocIdFor(_locationId)
    });
    if (isManualReset) toast("Reset NOT saved: stale salon scope", "error");
    return Promise.resolve();
  }
  let state = null;
  try {
    state = _getState();
  } catch (e) {
    console.error("[TasksCloud] getState threw — local tasks data unreadable", e);
    if (typeof window !== "undefined" && typeof window.showToast === "function") {
      window.showToast("Tasks save failed: local data unreadable", "error");
    }
    return Promise.resolve();
  }
  if (!state) return Promise.resolve();
  const ref = tasksStateRef(_salonId, _locationId);
  console.log("[TasksCloud] write attempt", { loc: _locationId || "default", reason: reason || "task-update" });

  const isPermissionDenied = (e) => {
    const code = e && (e.code || e.name);
    return code === "permission-denied" || code === "PERMISSION_DENIED";
  };
  const writePayload = ({ payload, rev }) => setDoc(ref, payload, { merge: true }).then(() => rev);
  const commitViaRest = () => {
    return readTasksStateViaRest(_salonId, _locationId).then((server) => {
      const sRev = serverRev(server);
      if (sRev > _lastCloudRev) _lastCloudRev = sRev;
      const freshLocal = _getState ? (_getState() || state) : state;
      const next = buildMergedWritePayload(freshLocal, server, reason, sRev);
      const adopt = () => {
        _lastServerData = next.payload;
        if (typeof next.rev === "number" && next.rev > _lastCloudRev) _lastCloudRev = next.rev;
        return next.rev;
      };
      return writeTasksStateViaRest(_salonId, _locationId, next.payload).then(() => {
        console.log("[TasksCloud] REST fallback write OK at rev", next.rev);
        return adopt();
      }).catch((restErr) => {
        console.warn("[TasksCloud] REST fallback failed", restErr);
        throw restErr;
      });
    });
  };

  // Merge our local state into the latest server doc BEFORE writing, so we never
  // clobber another device's pending/active selection ("newest action wins").
  //
  // CRITICAL: we do NOT read the doc here (no getDoc / getDocFromServer). Both
  // forms of one-shot read HANG inside the iOS WKWebView (Firestore long-polling
  // channel quirk) which left every technician write stuck "in progress", and
  // the cache-first read returned a STALE rev which the security rules rejected
  // with permission-denied. Instead we use the doc + rev that the live
  // onSnapshot listener last delivered (that channel works where one-shot reads
  // do not). rev = base + 1; if the base is stale or the staff/location rule
  // rejects the write, we immediately fall back to REST/member-intent sync.
  const commit = () => {
    const server = _lastServerData || null;
    const sRev = Math.max(_lastCloudRev || 0, serverRev(server));
    const freshLocal = _getState ? (_getState() || state) : state;
    const next = buildMergedWritePayload(freshLocal, server, reason, sRev);
    return writePayload(next).then((rev) => {
      // Adopt our own write as the freshest base so the next write merges on top
      // of it without waiting for the echo snapshot.
      _lastServerData = next.payload;
      if (typeof rev === "number" && rev > _lastCloudRev) _lastCloudRev = rev;
      return rev;
    }).catch((e) => {
      if (isPermissionDenied(e)) {
        // iOS WKWebView can keep the Firestore SDK listener/cache stale. A plain
        // REST read/write uses the current server rev and satisfies the existing
        // Firestore rules without relying on the SDK's stuck channel.
        return commitViaRest();
      }
      throw e;
    });
  };

  return commit().then((rev) => {
    if (typeof rev === "number" && rev > _lastCloudRev) _lastCloudRev = rev;
    console.log("[TasksCloud] write OK at rev", rev);
    if (isManualReset) toast("Reset saved to cloud (rev " + rev + ")", "success");
    const listenLoc = resolveTasksLocationId() || _locationId;
    if (_salonId && listenLoc && (!_unsubscribe || _locationId !== listenLoc)) {
      subscribe(_salonId, listenLoc);
    }
    if (String(reason || "").startsWith("alert-windows")) {
      const aw = (state && state.alertWindows) || {};
      return syncAlertWindowsToAllLocations(_salonId, aw, writeLocId);
    }
  }).catch((e) => {
    console.error("[TasksCloud] write FAILED", e && (e.code || e.name), e && e.message, e);
    toast("Tasks save FAILED: " + ((e && (e.code || e.message)) || "unknown error"), "error");
  });
}

async function syncAlertWindowsToAllLocations(salonId, alertWindows, currentDocId) {
  if (!salonId || !alertWindows || typeof alertWindows !== "object") return;
  const ids = new Set();
  try {
    const tsSnap = await getDocs(collection(db, `salons/${salonId}/tasksState`));
    tsSnap.forEach((d) => { if (d.id) ids.add(d.id); });
  } catch (e) {
    console.warn("[TasksCloud] list tasksState for salon-wide alert windows failed", e);
  }
  try {
    const locSnap = await getDocs(collection(db, `salons/${salonId}/locations`));
    locSnap.forEach((d) => { if (d.id) ids.add(d.id); });
  } catch (e) {
    console.warn("[TasksCloud] list locations for salon-wide alert windows failed", e);
  }
  if (currentDocId) ids.delete(currentDocId);
  if (!ids.size) return;
  await Promise.all([...ids].map(async (id) => {
    try {
      await setDoc(doc(db, `salons/${salonId}/tasksState`, id), {
        alertWindows,
        updatedAt: serverTimestamp(),
        lastUpdateReason: "alert-windows-salon"
      }, { merge: true });
    } catch (e) {
      console.warn("[TasksCloud] salon-wide alert windows write failed", id, e && e.message);
    }
  }));
  console.log("[TasksCloud] copied alert windows to", ids.size, "other location docs");
}

function scheduleWrite() {
  if (!_salonId) return;
  if (typeof window !== "undefined" && window.__ffTasksApplyingRemote) return;
  if (typeof window !== "undefined" && window.__ffTasksHardReplace) return;
  if (typeof window !== "undefined") window.__ffTasksLastLocalWrite = Date.now();
  const resolvedLoc = resolveTasksLocationId();
  if (resolvedLoc && resolvedLoc !== _locationId) {
    _locationId = resolvedLoc;
  }
  const writeSalon = _salonId;
  const writeDocId = tasksStateDocIdFor(_locationId);
  const writeSeq = _subscriptionSeq;
  if (_writeTimeout) clearTimeout(_writeTimeout);
  _writeTimeout = setTimeout(() => {
    _writeTimeout = null;
    if (
      _salonId !== writeSalon ||
      tasksStateDocIdFor(_locationId) !== writeDocId ||
      _subscriptionSeq !== writeSeq
    ) {
      console.warn("[TasksCloud] dropped stale scheduled write after location switch");
      return;
    }
    writeState();
  }, 600);
}

function installStorageHook() {
  if (typeof localStorage === "undefined" || window.__ffTasksCloudStorageHook) return;
  window.__ffTasksCloudStorageHook = true;
  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (String(key || "").startsWith("ff_tasks_")) scheduleWrite();
  };
}

/**
 * getState must return: { catalog, tombstone, alertWindows, enforceSelectSettings, opening, closing, weekly, monthly, yearly }
 * each tab: { active: [], pending: [], done: [] }
 */
export function initTasksCloud(opts) {
  if (!opts || typeof opts.applyState !== "function" || typeof opts.getState !== "function") {
    console.warn("[TasksCloud] initTasksCloud: applyState and getState required");
    return;
  }
  _applyState = opts.applyState;
  _getState = opts.getState;
  _onRefresh = opts.onRefresh || null;
  installStorageHook();
  function tryConnect() {
    if (typeof window !== "undefined" && window.__ff_waiting_for_salon_choice === true) {
      if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
      _salonId = null;
      _locationId = null;
      _subscriptionSeq++;
      return;
    }
    getSalonId().then((sid) => {
      const loc = resolveTasksLocationId();
      if (sid && (sid !== _salonId || loc !== _locationId)) {
        subscribe(sid, loc);
        console.log("[TasksCloud] Subscribed to salon", sid, "location", loc || "(default)");
      } else if (!sid) {
        _salonId = null;
        _locationId = null;
        _subscriptionSeq++;
        if (_unsubscribe) {
          _unsubscribe();
          _unsubscribe = null;
        }
      }
    });
  }
  tryConnect();
  onAuthStateChanged(auth, () => {
    tryConnect();
  });

  // When the header switcher changes the active branch, swap the Firestore
  // subscription to that branch's tasksState doc. The subscribe() helper
  // also clears in-memory state so the previous branch's tasks don't flash
  // on screen.
  if (typeof document !== "undefined" && !window.__ffTasksCloudLocListenerBound) {
    window.__ffTasksCloudLocListenerBound = true;
    document.addEventListener("ff-active-location-changed", () => {
      const loc = resolveTasksLocationId();
      if (!_salonId) return;
      if (loc === _locationId) return;
      subscribe(_salonId, loc);
      console.log("[TasksCloud] Re-subscribed after location switch →", loc || "(default)");
    });
    document.addEventListener("ff-locations-updated", () => {
      tryConnect();
    });
    document.addEventListener("ff-staff-cloud-updated", () => {
      tryConnect();
    });
  }
}

export function tasksCloudWrite(reason) {
  return writeState(reason);
}

export function tasksCloudReconnect() {
  if (typeof window !== "undefined" && window.__ff_waiting_for_salon_choice === true) return Promise.resolve();
  getSalonId().then((sid) => {
    const loc = resolveTasksLocationId();
    if (sid === _salonId && loc === _locationId) return;
    if (sid) subscribe(sid, loc);
    else {
      _salonId = null;
      _locationId = null;
      _subscriptionSeq++;
    }
  });
}

/** Force fetch current state from server (bypass cache) and apply so other computer sees updates. */
export function tasksCloudRefresh() {
  if (typeof window !== "undefined" && window.__ff_waiting_for_salon_choice === true) return Promise.resolve();
  if (!_salonId || !_applyState) return Promise.resolve();
  if (typeof window !== "undefined" && window.__ffTasksLastLocalWrite != null && (Date.now() - window.__ffTasksLastLocalWrite) < 12000) return Promise.resolve();
  const expectedSalonId = _salonId;
  const expectedDocId = tasksStateDocIdFor(_locationId);
  const expectedSeq = _subscriptionSeq;
  if (!tasksCloudScopeStillCurrent(expectedSalonId, expectedDocId, expectedSeq)) return Promise.resolve();
  const ref = tasksStateRef(_salonId, _locationId);
  return getDocFromServer(ref).then(async (snap) => {
    if (!tasksCloudScopeStillCurrent(expectedSalonId, expectedDocId, expectedSeq)) {
      console.warn("[TasksCloud] ignored stale refresh", {
        expectedSalonId,
        currentSalonId: _salonId,
        expectedDocId,
        currentDocId: tasksStateDocIdFor(_locationId)
      });
      return;
    }
    if (snap.exists()) {
      if (typeof window !== "undefined" && window.__ffTasksLastLocalWrite != null && (Date.now() - window.__ffTasksLastLocalWrite) < 12000) return;
      const data = snap.data();
      const r = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
      if (r > _lastCloudRev) _lastCloudRev = r;
      window.__ffTasksApplyingRemote = true;
      try {
        writeTasksLsLocationId(expectedDocId);
        _applyState(await mergeSharedTaskTemplatesIntoState(data, _salonId));
        if (typeof _onRefresh === "function") _onRefresh();
      } finally {
        window.__ffTasksApplyingRemote = false;
      }
    } else {
      window.__ffTasksApplyingRemote = true;
      try {
        writeTasksLsLocationId(expectedDocId);
        _applyState(await mergeSharedTaskTemplatesIntoState(emptyCloudState(), _salonId));
        if (typeof _onRefresh === "function") _onRefresh();
      } finally {
        window.__ffTasksApplyingRemote = false;
      }
    }
  }).catch((e) => console.warn("[TasksCloud] refresh failed", e));
}

// ─── Public: one-click purge of tasks doc for the current salon+location ──────
// Recovery helper — wipes ONLY the active location's Tasks document. Use via
// browser console:
//   await window.ffClearAllTasksFromCloud();
async function ffClearAllTasksFromCloud() {
  const sid = _salonId || (await getSalonId());
  if (!sid) {
    console.warn("[TasksCloud] Cannot clear — no salonId.");
    return { cleared: false };
  }
  const loc = _locationId || readActiveLocationId();
  try {
    await deleteDoc(tasksStateRef(sid, loc));
    // Also wipe local tasks caches so the UI re-applies an empty state.
    flushLocalTasksState();
    if (_applyState) {
      try {
        window.__ffTasksApplyingRemote = true;
        _applyState(emptyCloudState());
        if (typeof _onRefresh === "function") _onRefresh();
      } finally {
        window.__ffTasksApplyingRemote = false;
      }
    }
    console.log("[TasksCloud] Cleared tasks for salon", sid, "location", loc || "(default)");
    return { cleared: true };
  } catch (e) {
    console.error("[TasksCloud] ffClearAllTasksFromCloud error:", e);
    throw e;
  }
}

export async function loadTasksStateForDashboard() {
  const salonId = _salonId || currentWindowSalonId() || (await getSalonId());
  const locationId = _locationId || readActiveLocationId();
  const docId = (typeof locationId === "string" && locationId.trim()) ? locationId.trim() : TASKS_STATE_DEFAULT;
  if (_lastServerData && _salonId && salonId && _salonId === salonId) {
    const memDocId = (_locationId && String(_locationId).trim()) ? String(_locationId).trim() : TASKS_STATE_DEFAULT;
    if (memDocId === docId) {
      return { source: "tasks-cloud-memory", state: _lastServerData };
    }
  }
  if (!salonId) return { source: "none", state: null };
  try {
    const snap = await getDoc(doc(db, `salons/${salonId}/tasksState`, docId));
    if (snap.exists()) return { source: "firestore", state: snap.data() || {} };
  } catch (err) {
    console.warn("[TasksCloud] loadTasksStateForDashboard failed", err);
  }
  return { source: "none", state: null };
}

if (typeof window !== "undefined") {
  window.initTasksCloud = initTasksCloud;
  window.tasksCloudWrite = tasksCloudWrite;
  window.tasksCloudReconnect = tasksCloudReconnect;
  window.tasksCloudRefresh = tasksCloudRefresh;
  window.ffClearAllTasksFromCloud = ffClearAllTasksFromCloud;
  window.ffLoadTasksStateForDashboard = loadTasksStateForDashboard;
  // Shared three-list merge so applyState (index.html) merges remote ⇄ local
  // with exactly the same "newest action wins" rules as the cloud write.
  window.__ffTasksMergeTab = mergeTabAllLists;
  window.__ffTasksMergeAlertWindows = mergeAlertWindows;
  if (typeof window.__ffTasksCloudInit === "function") {
    window.__ffTasksCloudInit();
  }
}
