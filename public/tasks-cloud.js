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
  "ff_tasks_reset_stamps_v1"
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

/**
 * Resolve the active location id from the header switcher. When nothing is
 * active (single-location salon, or locations not loaded yet), returns "".
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
  return raw || "";
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

async function mergeSharedTaskTemplatesIntoState(state, accountId) {
  const base = state || emptyCloudState();
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

let _hasSubscribedOnce = false;

function subscribe(salonId, locationId) {
  const nextDocId = tasksStateDocIdFor(locationId);
  const salonChanged = _salonId !== null && _salonId !== salonId;
  const locationChanged = _hasSubscribedOnce && tasksStateDocIdFor(_locationId) !== nextDocId;
  const scopeChanged = salonChanged || locationChanged;
  if (_salonId === salonId && tasksStateDocIdFor(_locationId) === nextDocId && _unsubscribe) return;
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _salonId = salonId;
  _locationId = locationId;
  _firstSnapshot = true;
  _lastCloudRev = 0;
  _lastServerData = null;

  // CRITICAL: when switching between locations (not on the very first
  // subscribe after app startup), wipe in-memory / local state before the
  // new snapshot arrives so the previous branch's tasks don't flash on
  // screen. On the initial subscribe we keep localStorage intact so the
  // UI paints instantly from cache while Firestore catches up.
  if (scopeChanged) {
    flushLocalTasksState();
    // Reset the "just wrote locally" cooldown so the incoming apply (empty
    // + then the new branch's snapshot) is NOT suppressed as an echo.
    if (typeof window !== "undefined") window.__ffTasksLastLocalWrite = 0;
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
      try {
        _applyState(await mergeSharedTaskTemplatesIntoState(emptyCloudState(), salonId));
        if (typeof _onRefresh === "function") _onRefresh();
      } catch (e) {
        console.warn("[TasksCloud] clear-local-on-empty-cloud failed", e, logTag);
      }
      _firstSnapshot = false;
      return;
    }
    const data = snap.data();
    _firstSnapshot = false;

    // Always keep the freshest server doc as the write merge base + rev source,
    // even for snapshots we don't re-apply to the UI (echoes / equal rev). This
    // is what lets writes use a correct rev WITHOUT a blocking server read.
    _lastServerData = data;

    // Revision gate: a snapshot whose rev we have already seen is either the
    // echo of our own transaction or a stale read — never re-apply it (this is
    // what allows "the newest write is authoritative" without flapping).
    const snapRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
    if (snapRev > 0 && snapRev <= _lastCloudRev) return;
    if (snapRev > _lastCloudRev) _lastCloudRev = snapRev;

    if (typeof window !== "undefined") window.__ffTasksApplyingRemote = true;
    try {
      _applyState(await mergeSharedTaskTemplatesIntoState(data, salonId));
      if (typeof _onRefresh === "function") _onRefresh();
    } finally {
      if (typeof window !== "undefined") window.__ffTasksApplyingRemote = false;
    }
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

function serverRev(server) {
  return (server && typeof server.rev === "number" && server.rev >= 0) ? server.rev : 0;
}

function buildMergedWritePayload(state, server, reason, baseRevOverride) {
  const out = buildFirestoreState(state);
  const baseRev = typeof baseRevOverride === "number" && baseRevOverride >= 0
    ? baseRevOverride
    : serverRev(server);

  if (server && typeof server === "object") {
    const serverStamps = (server.resetStamps && typeof server.resetStamps === "object") ? server.resetStamps : {};
    const localStamps = (state.resetStamps && typeof state.resetStamps === "object") ? state.resetStamps : {};
    const mergedStamps = { ...localStamps };
    TABS.forEach((tab) => {
      const sv = Number(serverStamps[tab] || 0);
      const lv = Number(localStamps[tab] || 0);
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
  }

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
  }).catch((e) => {
    console.error("[TasksCloud] write FAILED", e && (e.code || e.name), e && e.message, e);
    toast("Tasks save FAILED: " + ((e && (e.code || e.message)) || "unknown error"), "error");
  });
}

function scheduleWrite() {
  if (!_salonId) return;
  if (typeof window !== "undefined" && window.__ffTasksApplyingRemote) return;
  if (typeof window !== "undefined") window.__ffTasksLastLocalWrite = Date.now();
  if (_writeTimeout) clearTimeout(_writeTimeout);
  _writeTimeout = setTimeout(() => {
    _writeTimeout = null;
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
      const loc = readActiveLocationId();
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
      const loc = readActiveLocationId();
      if (!_salonId) return;
      if (loc === _locationId) return;
      subscribe(_salonId, loc);
      console.log("[TasksCloud] Re-subscribed after location switch →", loc || "(default)");
    });
  }
}

export function tasksCloudWrite(reason) {
  return writeState(reason);
}

export function tasksCloudReconnect() {
  if (typeof window !== "undefined" && window.__ff_waiting_for_salon_choice === true) return Promise.resolve();
  getSalonId().then((sid) => {
    const loc = readActiveLocationId();
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
        _applyState(await mergeSharedTaskTemplatesIntoState(data, _salonId));
        if (typeof _onRefresh === "function") _onRefresh();
      } finally {
        window.__ffTasksApplyingRemote = false;
      }
    } else {
      window.__ffTasksApplyingRemote = true;
      try {
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

if (typeof window !== "undefined") {
  window.initTasksCloud = initTasksCloud;
  window.tasksCloudWrite = tasksCloudWrite;
  window.tasksCloudReconnect = tasksCloudReconnect;
  window.tasksCloudRefresh = tasksCloudRefresh;
  window.ffClearAllTasksFromCloud = ffClearAllTasksFromCloud;
  // Shared three-list merge so applyState (index.html) merges remote ⇄ local
  // with exactly the same "newest action wins" rules as the cloud write.
  window.__ffTasksMergeTab = mergeTabAllLists;
  if (typeof window.__ffTasksCloudInit === "function") {
    window.__ffTasksCloudInit();
  }
}
