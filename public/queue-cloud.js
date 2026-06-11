/**
 * Queue Cloud – sync QUEUE (Available + In service + History log) to Firestore.
 * Replaces localStorage for queue/service/log when user is signed in and has salonId.
 *
 * Firestore path (location-aware):
 *   - salons/{salonId}/queueState/{locationId}  when the user has picked an
 *     active location in the header switcher. Each branch gets its own
 *     queue, its own "in service" cards, and its own history log — just like
 *     two different businesses.
 *   - salons/{salonId}/queueState/default       fallback for single-location
 *     salons (no locations configured yet). Preserves all pre-multi-location
 *     data without any migration.
 */

import { doc, getDoc, getDocFromServer, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";

const QUEUE_STATE_DEFAULT = "default";
const RECENT_LOCAL_WRITE_GRACE_MS = 10000;
let _salonId = null;
let _locationId = null;
let _unsubscribe = null;
let _applyState = null;
let _getState = null;
let _onLogChange = null;
// History length of the last AUTHORITATIVE (server-confirmed) cloud snapshot for
// the active branch. Used by the stale-overwrite guard in writeState: if our
// local history is shorter than this, another device advanced the queue and we
// must not roll it back. Reset to 0 on a real location switch.
let _lastCloudLogLen = 0;
// Monotonic revision of the active branch's queueState doc (Phase A: optimistic
// concurrency / compare-and-swap). Every full-state write stamps rev = base+1,
// and the security rules reject any update whose rev isn't exactly previous+1 —
// so two devices writing at once are serialized by the server and the stale one
// is rejected (no silent overwrite), with NO client transaction (so the old
// runTransaction 400s can't recur). Tracked from authoritative snapshots and
// bumped optimistically on our own successful writes so rapid sequential local
// writes still increment correctly. Reset to 0 on a real location switch.
let _lastCloudRev = 0;
// Deep copy of the last AUTHORITATIVE server state we observed (snapshot or
// confirmed write). Phase B uses it as the common ancestor ("base") for a
// 3-way merge: when our optimistic write is rejected (stale rev), we diff our
// local state against this base to recover OUR intent (who we added / removed),
// then replay that intent on top of the fresh server state and retry — so the
// device that "lost" the race never loses its change (no data loss, not just
// no overwrite). Reset to empty on a real location switch.
let _lastServerState = { queue: [], service: [], log: [] };

function ffCloneArray(a) {
  if (!Array.isArray(a)) return [];
  try { return JSON.parse(JSON.stringify(a)); } catch (_) { return a.slice(); }
}

// `runtime.*` (e.g. runtime.lastAutoResetDate) inside queueSettings is SERVER-
// OWNED: the scheduled auto-reset stamps it so it only fires once per local day.
// The client must NEVER write it — a stale local copy of ff_queues_v1 would
// clobber that stamp, and the 15-min sweep would then re-fire within its window
// and wipe names added right after the morning reset (the recurring morning
// queue-wipe bug). We strip every `runtime` key before sending; because client
// writes use { merge: true }, the server's runtime is preserved untouched.
function ffStripServerOwnedRuntime(qs) {
  if (!qs || typeof qs !== "object") return qs;
  try {
    const clone = JSON.parse(JSON.stringify(qs));
    if (clone.runtime) delete clone.runtime;
    for (const k of Object.keys(clone)) {
      const v = clone[k];
      if (v && typeof v === "object" && v.runtime) delete v.runtime;
    }
    return clone;
  } catch (_) {
    return qs;
  }
}

function setLastServerState(queue, service, log) {
  _lastServerState = {
    queue: ffCloneArray(queue),
    service: ffCloneArray(service),
    log: ffCloneArray(log),
  };
}

// Identity of a queue/service entry: prefer staffId, fall back to name, then a
// stable stringification. Two entries with the same identity are "the same
// person" for merge purposes.
function ffQueueItemKey(it) {
  if (it == null) return "∅";
  if (typeof it !== "object") return "v:" + String(it);
  if (it.staffId != null && String(it.staffId).trim() !== "") return "s:" + String(it.staffId);
  if (it.name != null && String(it.name).trim() !== "") return "n:" + String(it.name).trim().toLowerCase();
  try { return "j:" + JSON.stringify(it); } catch (_) { return "?"; }
}

/**
 * 3-way merge of one list (queue or service). base = common ancestor (last
 * server state we held), local = our current list (with our pending change),
 * server = fresh authoritative list. Returns server with OUR additions added
 * and OUR removals removed, so concurrent changes from both devices survive.
 */
function ffMergeList(base, local, server) {
  base = Array.isArray(base) ? base : [];
  local = Array.isArray(local) ? local : [];
  server = Array.isArray(server) ? server : [];
  const baseKeys = new Set(base.map(ffQueueItemKey));
  const localKeys = new Set(local.map(ffQueueItemKey));
  // What WE added (in local, not in base) and removed (in base, not in local).
  const localAdded = local.filter((it) => !baseKeys.has(ffQueueItemKey(it)));
  const weRemoved = new Set(
    base.filter((it) => !localKeys.has(ffQueueItemKey(it))).map(ffQueueItemKey)
  );
  // Start from server, drop the entries we intentionally removed, then append
  // our additions that aren't already present.
  const result = server.filter((it) => !weRemoved.has(ffQueueItemKey(it)));
  const present = new Set(result.map(ffQueueItemKey));
  for (const it of localAdded) {
    const k = ffQueueItemKey(it);
    if (!present.has(k)) { result.push(it); present.add(k); }
  }
  return result;
}

function ffLogEntryKey(e) {
  if (e == null) return "∅";
  if (typeof e !== "object") return "v:" + String(e);
  const ts = (typeof e.ts === "number") ? e.ts : "";
  return "t:" + ts + "|a:" + String(e.action || "") + "|w:" + String(e.worker || "") + "|p:" + String(e.performedBy || "");
}

/**
 * Union the history log: keep the server log (authoritative order) and append
 * any local-only entries (our new history rows) that the server hasn't seen.
 * Never drops entries from either side.
 */
function ffMergeLog(server, local) {
  server = Array.isArray(server) ? server : [];
  local = Array.isArray(local) ? local : [];
  const out = server.slice();
  const seen = new Set(server.map(ffLogEntryKey));
  for (const e of local) {
    const k = ffLogEntryKey(e);
    if (!seen.has(k)) { out.push(e); seen.add(k); }
  }
  return out;
}

function ffMerge3(base, local, server) {
  return {
    queue: ffMergeList(base.queue, local.queue, server.queue),
    service: ffMergeList(base.service, local.service, server.service),
    log: ffMergeLog(server.log, local.log),
  };
}

// Detect a "resurrection" write: a freshly-opened device whose stale localStorage
// still holds yesterday's queue tries to push people back AFTER the server already
// removed them (e.g. the 04:00 server auto-reset cleared the queue but PRESERVED
// the history log). Every legitimate add/move logs a history row, so a real change
// always grows the log past the last authoritative server log. A stale cache push
// re-adds people present in NEITHER the server queue nor service, WITHOUT any new
// log row to justify them — that is the exact morning-resurrection bug. We compare
// against the last authoritative server state (set only from server-confirmed
// snapshots), so a cache snapshot can never lower the bar for itself.
function ffWriteResurrectsRemoved(localState) {
  if (!localState) return false;
  const base = _lastServerState || { queue: [], service: [], log: [] };
  const serverKeys = new Set(
    []
      .concat(Array.isArray(base.queue) ? base.queue : [])
      .concat(Array.isArray(base.service) ? base.service : [])
      .map(ffQueueItemKey)
  );
  const localItems = []
    .concat(Array.isArray(localState.queue) ? localState.queue : [])
    .concat(Array.isArray(localState.service) ? localState.service : []);
  const hasUnbackedNewPerson = localItems.some(
    (it) => !serverKeys.has(ffQueueItemKey(it))
  );
  if (!hasUnbackedNewPerson) return false;
  const localLogLen = Array.isArray(localState.log) ? localState.log.length : 0;
  const baseLogLen = Array.isArray(base.log) ? base.log.length : 0;
  // A genuine add/move grows the log; if ours did not, the "new" person is an
  // unlogged stale-cache resurrection, not a real action.
  return localLogLen <= baseLogLen;
}

async function getSalonId() {
  // Multi-salon: when the user has chosen a salon (single membership auto-
  // selected, or one explicitly picked from Choose Salon), that selection is
  // the source of truth. Reading users/{uid}.salonId first would leak data
  // from the legacy primary salon into whichever salon the user picked.
  if (typeof window !== "undefined") {
    if (window.currentSalonId) {
      return String(window.currentSalonId).trim() || null;
    }
    if (window.__ff_waiting_for_salon_choice !== false) {
      return null;
    }
  }
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return data.salonId || null;
    }
  } catch (e) {
    console.warn("[QueueCloud] getSalonId failed", e);
  }
  return null;
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
  if (raw) return raw;
  // Mobile boot: active location may not be in memory yet but is persisted from
  // the last session. Subscribing to the wrong queueState doc (default) and
  // applying its empty snapshot caused a visible empty-queue flash on phone.
  try {
    const stored = localStorage.getItem("ff_active_location_id");
    if (typeof stored === "string" && stored.trim()) return stored.trim();
  } catch (_) {}
  return "";
}

/** doc id for the queueState document — locationId per branch, otherwise "default". */
function queueStateDocIdFor(locationId) {
  const v = typeof locationId === "string" ? locationId.trim() : "";
  return v || QUEUE_STATE_DEFAULT;
}

function queueStateRef(salonId, locationId) {
  return doc(db, `salons/${salonId}/queueState`, queueStateDocIdFor(locationId));
}

let _firstSnapshot = true;
let _subscribedDocId = null;

function storedActiveLocationIdForQueue() {
  const fromRead = readActiveLocationId();
  if (fromRead) return fromRead;
  return "";
}

/** Skip applying an empty cloud snapshot while we are still subscribed to a
 *  different branch doc than the user's persisted active location. */
function shouldSkipEmptyCloudSnapshot(subscribedLocationId, cloudHasData, localHasAnyData) {
  if (cloudHasData || !localHasAnyData) return false;
  const stored = storedActiveLocationIdForQueue();
  if (!stored) return false;
  return queueStateDocIdFor(subscribedLocationId) !== queueStateDocIdFor(stored);
}

function hasRecentLocalQueueWrite() {
  if (typeof window === "undefined") return false;
  const lastSave = Number(window.__ff_lastSaveTime || 0);
  return lastSave > 0 && (Date.now() - lastSave) < RECENT_LOCAL_WRITE_GRACE_MS;
}

function queueStateHasData(state) {
  return !!state &&
    ((state.queue?.length || 0) + (state.service?.length || 0) + (state.log?.length || 0)) > 0;
}

function stateCounts(state) {
  return {
    queue: Array.isArray(state?.queue) ? state.queue.length : 0,
    service: Array.isArray(state?.service) ? state.service.length : 0,
    log: Array.isArray(state?.log) ? state.log.length : 0,
  };
}

function hasExplicitEmptyOverwriteIntent() {
  if (typeof window === "undefined") return false;
  return Number(window.__ff_allow_empty_queue_cloud_write_until || 0) > Date.now();
}

function snapshotFromCache(snap) {
  return !!(snap && snap.metadata && snap.metadata.fromCache);
}

/** During boot, never paint an empty cloud snapshot over a good local cache. */
function shouldDeferBootSnapshot(snap, subscribedLocationId, cloudHasData, localHasAnyData) {
  if (!_firstSnapshot || !localHasAnyData || cloudHasData) return false;
  if (snapshotFromCache(snap)) return true;
  return shouldSkipEmptyCloudSnapshot(subscribedLocationId, cloudHasData, localHasAnyData);
}

function queueCloudWriteReason() {
  if (typeof window === "undefined") return "unknown";
  return String(window.__ff_queue_cloud_write_reason || "").trim() || "app-save";
}

function subscribe(salonId, locationId, opts = {}) {
  const nextDocId = queueStateDocIdFor(locationId);
  // Already listening to this branch doc — avoid tearing down the listener and
  // replaying cached snapshots (mobile hard refresh showed list → blank → list).
  if (_salonId === salonId && _subscribedDocId === nextDocId && _unsubscribe) {
    return;
  }
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _firstSnapshot = true;
  const locationDocChanged = _subscribedDocId !== null && _subscribedDocId !== nextDocId;
  // Switching to a different branch — require a fresh server snapshot before we
  // trust an empty queue again.
  if (locationDocChanged && typeof window !== "undefined") {
    window.__ff_queueCloudServerConfirmed = false;
  }
  const preserveRecentLocalWrite =
    opts.reason !== "manual" &&
    hasRecentLocalQueueWrite() &&
    queueStateHasData(_getState ? _getState() : null);
  // Clear in-memory queue/service/log only when switching to a DIFFERENT branch
  // doc. Re-subscribing to the same branch (staff/location recompute on boot)
  // must not wipe the locally cached queue — that caused empty flashes on phone.
  if (locationDocChanged && !preserveRecentLocalWrite && typeof _applyState === "function") {
    try { _applyState([], [], [], null, { force: true, reason: "queue-cloud-resubscribe" }); } catch (_) {}
    if (typeof _onLogChange === "function") {
      try { _onLogChange(); } catch (_) {}
    }
  }
  _subscribedDocId = nextDocId;
  // Clear ff_queues_v1 (Queue Auto Reset + GeoFence settings) on a real
  // location switch so the previous branch's settings don't leak into the new
  // branch. We deliberately DO NOT clear on initial connect/reconnect: clearing
  // there made the Auto Reset toggle flash OFF for a moment on every app load
  // (until the cloud snapshot repopulated it). On a normal load the locally
  // cached settings are for this same device/branch, and the snapshot below
  // still reconciles (it repopulates when the cloud has queueSettings, and
  // removes them when it doesn't), so correctness is preserved without flicker.
  const isLocationSwitch = opts.reason !== 'connect' && opts.reason !== 'reconnect';
  if (isLocationSwitch) {
    _lastCloudLogLen = 0;
    _lastCloudRev = 0;
    _lastServerState = { queue: [], service: [], log: [] };
    try {
      localStorage.removeItem('ff_queues_v1');
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('ff-queue-settings-changed', { detail: { reason: 'location-switch' } }));
      }
    } catch (_) {}
  }
  const ref = queueStateRef(salonId, locationId);
  const logTag = locationId ? `loc=${locationId}` : "default";
  _unsubscribe = onSnapshot(ref, (snap) => {
    if (!_applyState) return;
    const localState = _getState ? _getState() : null;
    // We only treat localStorage as a seed for the "default" (no-location)
    // doc. For per-location docs the cloud is the only source of truth,
    // otherwise switching between locations would copy one branch's queue
    // into another branch's empty cloud doc.
    const isDefaultDoc = queueStateDocIdFor(locationId) === QUEUE_STATE_DEFAULT;
    const localHasAnyData = queueStateHasData(localState);
    const canSeedFromLocal = (isDefaultDoc || preserveRecentLocalWrite) && localHasAnyData;

    if (!snap.exists()) {
      if (shouldDeferBootSnapshot(snap, locationId, false, localHasAnyData)) {
        console.log("[QueueCloud] Defer cached missing-doc snapshot during boot", logTag);
        return;
      }
      if (canSeedFromLocal) {
        console.log("[QueueCloud] No cloud doc, pushing local state", logTag);
        setDoc(ref, {
          queue: localState.queue || [],
          service: localState.service || [],
          log: localState.log || [],
          rev: (_lastCloudRev || 0) + 1,
          updatedAt: serverTimestamp()
        }).then(() => { _lastCloudRev = (_lastCloudRev || 0) + 1; })
          .catch((e) => console.warn("[QueueCloud] Initial write failed", e));
      } else {
        if (!snapshotFromCache(snap) && typeof window !== "undefined") {
          window.__ff_queueCloudServerConfirmed = true;
        }
        _applyState([], [], [], null, { force: true, reason: "queue-cloud-missing-doc" });
        if (typeof _onLogChange === "function") _onLogChange();
      }
      _firstSnapshot = false;
      return;
    }
    const data = snap.data();
    const queue = Array.isArray(data.queue) ? data.queue : [];
    const service = Array.isArray(data.service) ? data.service : [];
    const log = Array.isArray(data.log) ? data.log : [];
    const cloudHasData = (queue.length + service.length + log.length) > 0;

    if (shouldDeferBootSnapshot(snap, locationId, cloudHasData, localHasAnyData)) {
      console.log("[QueueCloud] Defer empty boot snapshot until server data", logTag, {
        fromCache: snapshotFromCache(snap),
      });
      return;
    }

    // On first snapshot for an existing but empty cloud doc, do not seed from
    // localStorage unless this tab just performed a local queue write. Otherwise
    // an old mobile cache can resurrect an employee after the 4 AM cloud reset.
    if (_firstSnapshot && !cloudHasData && preserveRecentLocalWrite && localHasAnyData) {
      console.log("[QueueCloud] Cloud empty but local has data, pushing local", logTag);
      // Base the new rev on THIS snapshot's rev (the doc already exists), so the
      // compare-and-swap rule accepts the write.
      const baseRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
      setDoc(ref, {
        queue: localState.queue || [],
        service: localState.service || [],
        log: localState.log || [],
        rev: baseRev + 1,
        updatedAt: serverTimestamp()
      }).then(() => { _lastCloudRev = baseRev + 1; })
        .catch((e) => console.warn("[QueueCloud] Push local failed", e));
      _firstSnapshot = false;
      return;
    }

    _firstSnapshot = false;
    // Mark that an authoritative (non-cache) snapshot has been seen so the app
    // may now accept an empty cloud state as real (e.g. a genuine reset).
    const isAuthoritative = !snapshotFromCache(snap);
    const snapRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
    if (isAuthoritative && typeof window !== "undefined") {
      window.__ff_queueCloudServerConfirmed = true;
    }
    // A GENUINE remote change carries a HIGHER rev than the last state we
    // reconciled with. Such updates must be applied even inside the app's
    // post-save grace window — otherwise two active devices ignore each other
    // for several seconds after every save and the queue "flaps" forever
    // (names jump/disappear) without ever converging.
    const isGenuineRemote = isAuthoritative && snapRev > _lastCloudRev;
    // Expose when the cloud queue was last modified so the morning auto-reset
    // can tell "yesterday's leftover queue" (safe to clear on fresh open) from
    // "a queue already used today" (must never be wiped).
    if (typeof window !== "undefined") {
      try {
        const ms = data.updatedAt && typeof data.updatedAt.toMillis === "function"
          ? data.updatedAt.toMillis()
          : (typeof data.updatedAt === "number" ? data.updatedAt : 0);
        if (ms) window.__ff_queueLastCloudUpdateMs = ms;
      } catch (_) {}
    }
    // applyState returns false when the app DEFERS this snapshot (e.g. the echo
    // of our own very recent write). When it defers we have NOT reconciled the
    // local/on-screen state with the server, so we must NOT advance the merge
    // base / rev / log markers below. Advancing them while the screen still
    // shows the OLD list is exactly what made the next write re-add
    // ("resurrect") a list the server had already cleared.
    const applied = _applyState(queue, service, log, null, { remote: isGenuineRemote });
    if (isAuthoritative && applied !== false) {
      // Track the authoritative cloud history length for the stale-overwrite
      // guard. Only reconciled server snapshots count, so a stale local cache
      // can't lower the bar for itself.
      _lastCloudLogLen = log.length;
      // Track the authoritative revision for optimistic concurrency. Legacy
      // docs without a rev field are treated as rev 0 so the first write
      // bootstraps it to 1.
      _lastCloudRev = snapRev;
      // Remember this authoritative state as the 3-way merge base (Phase B).
      setLastServerState(queue, service, log);
    }
    if (typeof _onLogChange === "function") _onLogChange();
    // Apply queue settings (ff_queues_v1) from cloud — each location has its
    // own queueState doc, so these settings are already per-location server-side.
    // BUT: if the user just edited the settings locally (e.g. toggled Auto
    // Reset), an in-flight snapshot may still carry the PREVIOUS value. Applying
    // it would revert the toggle back (the "toggle flips ON then OFF" bug). So
    // during a short local-edit grace window we keep the local value and let the
    // dedicated merge write (queueCloudWriteSettings) land; the next snapshot
    // after the window will already reflect the new value.
    const localSettingsEditActive = typeof window !== "undefined" &&
      typeof window.__ff_queueSettingsLocalEditUntil === "number" &&
      Date.now() < window.__ff_queueSettingsLocalEditUntil;
    if (localSettingsEditActive) {
      console.log("[QueueCloud] Skipped queueSettings from cloud (recent local edit)", logTag);
    } else if (data.queueSettings && typeof data.queueSettings === 'object') {
      try {
        localStorage.setItem('ff_queues_v1', JSON.stringify(data.queueSettings));
        console.log("[QueueCloud] Applied queueSettings from cloud", logTag);
      } catch (_) {}
    } else {
      // Cloud doc has no queueSettings for THIS branch. Do NOT delete the local
      // settings here. A real location switch already clears ff_queues_v1 before
      // subscribing (see above), so any local settings present now belong to
      // THIS branch and simply haven't been persisted to the cloud yet (e.g. the
      // dedicated settings write raced or hasn't run). Deleting them here is
      // exactly what made the Auto Reset toggle revert to OFF on every refresh.
      // Instead, self-heal by pushing the local settings up to the cloud.
      let localSettings = null;
      try {
        const raw = localStorage.getItem('ff_queues_v1');
        if (raw) localSettings = JSON.parse(raw);
      } catch (_) {}
      if (localSettings && typeof localSettings === 'object') {
        console.log("[QueueCloud] Cloud missing queueSettings — healing from local cache", logTag);
        try { queueCloudWriteSettings(); } catch (_) {}
      }
    }
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      try {
        document.dispatchEvent(new CustomEvent('ff-queue-settings-changed', { detail: { reason: 'snapshot-applied', locationId: locationId || null } }));
      } catch (_) {}
    }
  }, (err) => console.error("[QueueCloud] subscribe error", logTag, err));
}

function writeState() {
  if (!_salonId || !_getState) return Promise.resolve();
  const state = _getState();
  if (!state) return Promise.resolve();
  const ref = queueStateRef(_salonId, _locationId);
  const localCounts = stateCounts(state);
  const localEmpty = localCounts.queue + localCounts.service + localCounts.log === 0;
  const reason = queueCloudWriteReason();
  const payload = {
    queue: state.queue || [],
    service: state.service || [],
    log: state.log || [],
    updatedAt: serverTimestamp(),
    lastUpdateReason: reason,
    lastUpdatedByUid: auth.currentUser?.uid || null,
  };
  // Also sync ff_queues_v1 (auto-reset settings). runtime.* is server-owned and
  // is stripped so this write can never clobber the auto-reset once-per-day stamp.
  try {
    const raw = localStorage.getItem('ff_queues_v1');
    if (raw) payload.queueSettings = ffStripServerOwnedRuntime(JSON.parse(raw));
  } catch (_) {}
  // Optimistic-concurrency commit. rev is stamped at the moment of the write
  // from the freshest tracked revision (snapshots + guard reads keep it
  // current), so the security rule serializes concurrent writers. On a stale-rev
  // rejection (permission-denied) we do NOT blindly overwrite — Phase B replays
  // OUR intent on top of the fresh server state via a 3-way merge and retries,
  // so the device that "lost" the race keeps its change (no data loss).
  const isPermissionDenied = (e) => {
    const code = e && (e.code || e.name);
    return code === "permission-denied" || code === "PERMISSION_DENIED";
  };
  const isExplicitIntent = hasExplicitEmptyOverwriteIntent()
    || reason === "manual-reset"
    || reason === "auto-reset"
    || reason === "clear-history"
    || reason === "retention-prune";

  // Attempt the write with the given body at rev = baseRev + 1.
  // merge:true so server-owned fields we intentionally do NOT send (queueSettings
  // .runtime.lastAutoResetDate stamped by the scheduled reset) survive the write.
  // queue/service/log are arrays and are replaced wholesale by merge (Firestore
  // does not element-merge arrays), so add/remove/reset semantics are unchanged.
  const writeAt = (body, baseRev) => setDoc(ref, Object.assign({}, body, { rev: baseRev + 1 }), { merge: true })
    .then(() => {
      if (_lastCloudRev <= baseRev) _lastCloudRev = baseRev + 1;
      // Our write is now the authoritative state — make it the next merge base.
      setLastServerState(body.queue || [], body.service || [], body.log || []);
      _lastCloudLogLen = Array.isArray(body.log) ? body.log.length : _lastCloudLogLen;
    });

  const commit = (attempt) => {
    attempt = attempt || 0;
    const baseRev = _lastCloudRev;
    return writeAt(payload, baseRev).catch((e) => {
      if (!isPermissionDenied(e)) {
        console.warn("[QueueCloud] write failed", e);
        return;
      }
      // Stale rev: another device advanced the queue between our read and write.
      if (attempt >= 5) {
        console.warn("[QueueCloud] merge retries exhausted — pulling server state");
        return pullServerInto();
      }
      return getDocFromServer(ref).then((snap) => {
        const data = snap.exists() ? (snap.data() || {}) : {};
        const serverRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
        const serverState = {
          queue: Array.isArray(data.queue) ? data.queue : [],
          service: Array.isArray(data.service) ? data.service : [],
          log: Array.isArray(data.log) ? data.log : [],
        };
        _lastCloudRev = serverRev;
        _lastCloudLogLen = serverState.log.length;

        // For explicit reset/clear/seed intent there is no "merge" — the intent
        // is to replace, so just retry on top of the fresh rev.
        if (isExplicitIntent) {
          return writeAt(payload, serverRev).catch((e2) => {
            if (isPermissionDenied(e2) && attempt < 5) return commit(attempt + 1);
            return pullServerInto(serverState, serverRev);
          });
        }

        // Normal write that lost the race. Replay OUR intent on top of the
        // fresh server state via a 3-way merge keyed by staffId: keep every
        // person both devices have, honor the removals WE made since our last
        // server sync, and append people WE added at the back of the queue
        // (correct queue semantics). This means a concurrent "add me" from
        // another device is never dropped (the lost-add bug), and because the
        // identity key is the stable staffId there are no duplicates. The log
        // is unioned so no history is rolled back. We do NOT push the merged
        // result onto the local UI here — the authoritative snapshot that
        // follows our write drives the display, which avoids the mid-merge
        // flashing/“wrong order” churn under heavy concurrency.
        const localNow = _getState
          ? _getState()
          : { queue: payload.queue, service: payload.service, log: payload.log };
        const merged = ffMerge3(_lastServerState, localNow, serverState);
        const mergedBody = Object.assign({}, payload, {
          queue: merged.queue,
          service: merged.service,
          log: merged.log,
        });
        return writeAt(mergedBody, serverRev).catch((e2) => {
          if (isPermissionDenied(e2) && attempt < 5) return commit(attempt + 1);
          if (isPermissionDenied(e2)) return pullServerInto(serverState, serverRev);
          console.warn("[QueueCloud] merged write failed", e2);
        });
      }).catch((e2) => {
        console.warn("[QueueCloud] conflict resolution read failed", e2);
      });
    });
  };

  // Fallback: adopt the authoritative server state locally (used when retries
  // are exhausted). Never loses server data; our unmerged change is dropped only
  // as a last resort after 5 failed merge attempts (extremely unlikely).
  const pullServerInto = (serverState, serverRev) => {
    const apply = (st, rev) => {
      if (typeof rev === "number") _lastCloudRev = rev;
      _lastCloudLogLen = Array.isArray(st.log) ? st.log.length : _lastCloudLogLen;
      setLastServerState(st.queue || [], st.service || [], st.log || []);
      if (typeof _applyState === "function") {
        _applyState(st.queue || [], st.service || [], st.log || [], null, { force: true });
        if (typeof _onLogChange === "function") _onLogChange();
      }
    };
    if (serverState) { apply(serverState, serverRev); return Promise.resolve(); }
    return getDocFromServer(ref).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      apply({
        queue: Array.isArray(data.queue) ? data.queue : [],
        service: Array.isArray(data.service) ? data.service : [],
        log: Array.isArray(data.log) ? data.log : [],
      }, (typeof data.rev === "number" && data.rev >= 0) ? data.rev : _lastCloudRev);
    }).catch((e2) => console.warn("[QueueCloud] post-reject pull failed", e2));
  };

  // Stale-device guard (pre-sync): until this device has applied the FIRST cloud
  // snapshot for the active branch, its local queue may be stale — e.g. a device
  // that just opened is still holding an older localStorage cache. Letting it
  // write would overwrite a live cloud queue with stale data (this is how a
  // freshly-opened phone wiped a branch's real queue). While we have not yet
  // reconciled with the cloud, never overwrite a non-empty cloud queue: pull the
  // cloud state instead. Legitimate reset/seed flows set the explicit-empty
  // intent flag and are allowed through unchanged.
  if (_firstSnapshot && !hasExplicitEmptyOverwriteIntent()) {
    return getDocFromServer(ref).then((snap) => {
      if (!snap.exists()) return commit();
      const preData = snap.data() || {};
      _lastCloudRev = (typeof preData.rev === "number" && preData.rev >= 0) ? preData.rev : _lastCloudRev;
      const cloudCounts = stateCounts(preData);
      const cloudHasData =
        cloudCounts.queue + cloudCounts.service + cloudCounts.log > 0;
      if (!cloudHasData) return commit();
      console.warn("[QueueCloud] blocked pre-sync overwrite of non-empty cloud state", {
        salonId: _salonId,
        locationId: _locationId || QUEUE_STATE_DEFAULT,
        reason,
        localCounts,
        cloudCounts,
      });
      if (typeof _applyState === "function") {
        const data = snap.data() || {};
        const sq = Array.isArray(data.queue) ? data.queue : [];
        const ss = Array.isArray(data.service) ? data.service : [];
        const sl = Array.isArray(data.log) ? data.log : [];
        setLastServerState(sq, ss, sl);
        _applyState(sq, ss, sl, null, { force: true });
        if (typeof _onLogChange === "function") _onLogChange();
      }
      return Promise.resolve();
    }).catch((e) => {
      console.warn("[QueueCloud] pre-sync write guard failed; skipping risky write", e);
    });
  }

  if (hasExplicitEmptyOverwriteIntent()) return commit();

  // ── Resurrection guard (server reset wins over stale cache) ───────────────
  // After a server-side auto-reset the queue is empty but the history log is
  // preserved, so the log-length guard below cannot see that the queue was
  // wiped. A device opened in the morning with yesterday's queue still in
  // localStorage would otherwise re-push those people (the recurring "wrong
  // people every morning" bug). If our write re-adds people the server no
  // longer has WITHOUT a new history row to justify them, treat it as a stale
  // resurrection: confirm against the server and adopt its state instead of
  // overwriting. Only enforced once we have a server-confirmed snapshot, so a
  // freshly-opened device with no cloud knowledge is unaffected.
  const serverConfirmed = typeof window !== "undefined" && window.__ff_queueCloudServerConfirmed === true;
  if (!localEmpty && serverConfirmed && ffWriteResurrectsRemoved(state)) {
    return getDocFromServer(ref).then((snap) => {
      if (!snap.exists()) return commit();
      const data = snap.data() || {};
      _lastCloudRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : _lastCloudRev;
      const sq = Array.isArray(data.queue) ? data.queue : [];
      const ss = Array.isArray(data.service) ? data.service : [];
      const sl = Array.isArray(data.log) ? data.log : [];
      // Re-check against the FRESH server state (not just our cached baseline)
      // so a concurrent legitimate change elsewhere is respected.
      const freshKeys = new Set(sq.concat(ss).map(ffQueueItemKey));
      const localItems = []
        .concat(Array.isArray(state.queue) ? state.queue : [])
        .concat(Array.isArray(state.service) ? state.service : []);
      const stillResurrecting = localItems.some((it) => !freshKeys.has(ffQueueItemKey(it)))
        && (Array.isArray(state.log) ? state.log.length : 0) <= sl.length;
      if (!stillResurrecting) return commit();
      console.warn("[QueueCloud] blocked stale-cache resurrection after server reset", {
        salonId: _salonId,
        locationId: _locationId || QUEUE_STATE_DEFAULT,
        reason,
        localQueueLen: Array.isArray(state.queue) ? state.queue.length : 0,
        serverQueueLen: sq.length,
      });
      _lastCloudLogLen = sl.length;
      setLastServerState(sq, ss, sl);
      if (typeof _applyState === "function") {
        _applyState(sq, ss, sl, null, { force: true });
        if (typeof _onLogChange === "function") _onLogChange();
      }
      return Promise.resolve();
    }).catch((e) => {
      console.warn("[QueueCloud] resurrection guard read failed; skipping risky write", e);
    });
  }

  // ── Stale-overwrite guard (Option A, non-transactional) ───────────────────
  // For a NON-empty local queue: if the last authoritative cloud snapshot we
  // saw had MORE history than we currently hold, another device has already
  // advanced this branch and our write would roll it back (an old/backgrounded
  // phone clobbering the live queue). Confirm against the server and, if the
  // cloud is genuinely ahead, pull it instead of overwriting. The common case
  // (we are current or ahead) takes the fast path with NO extra read, so normal
  // queue flow keeps full speed. No transaction is used, so there is no risk of
  // the commit-400 failures the earlier transactional attempt caused.
  if (!localEmpty) {
    const localLogLen = Array.isArray(state.log) ? state.log.length : 0;
    if (_lastCloudLogLen > localLogLen) {
      return getDocFromServer(ref).then((snap) => {
        if (!snap.exists()) return commit();
        const data = snap.data() || {};
        _lastCloudRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : _lastCloudRev;
        const cloudLogLen = Array.isArray(data.log) ? data.log.length : 0;
        const cc = stateCounts(data);
        const cloudHasData = cc.queue + cc.service + cc.log > 0;
        if (cloudHasData && cloudLogLen > localLogLen) {
          console.warn("[QueueCloud] blocked stale overwrite (cloud history ahead)", {
            salonId: _salonId,
            locationId: _locationId || QUEUE_STATE_DEFAULT,
            reason,
            localLogLen,
            cloudLogLen,
          });
          _lastCloudLogLen = cloudLogLen;
          if (typeof _applyState === "function") {
            const sq = Array.isArray(data.queue) ? data.queue : [];
            const ss = Array.isArray(data.service) ? data.service : [];
            const sl = Array.isArray(data.log) ? data.log : [];
            setLastServerState(sq, ss, sl);
            _applyState(sq, ss, sl, null, { force: true });
            if (typeof _onLogChange === "function") _onLogChange();
          }
          return Promise.resolve();
        }
        return commit();
      }).catch((e) => {
        console.warn("[QueueCloud] stale guard read failed; committing local", e);
        return commit();
      });
    }
    return commit();
  }

  // Guard against stale tabs/kiosks overwriting a live queue with an all-empty
  // local cache. Legitimate reset flows set __ff_allow_empty_queue_cloud_write_until.
  return getDocFromServer(ref).then((snap) => {
    if (!snap.exists()) return commit();
    const emptyData = snap.data() || {};
    _lastCloudRev = (typeof emptyData.rev === "number" && emptyData.rev >= 0) ? emptyData.rev : _lastCloudRev;
    const cloudCounts = stateCounts(emptyData);
    const cloudHasData =
      cloudCounts.queue + cloudCounts.service + cloudCounts.log > 0;
    if (!cloudHasData) return commit();

    console.warn("[QueueCloud] blocked empty overwrite of non-empty cloud state", {
      salonId: _salonId,
      locationId: _locationId || QUEUE_STATE_DEFAULT,
      reason,
      localCounts,
      cloudCounts,
    });
    if (typeof _applyState === "function") {
      const sq = Array.isArray(emptyData.queue) ? emptyData.queue : [];
      const ss = Array.isArray(emptyData.service) ? emptyData.service : [];
      const sl = Array.isArray(emptyData.log) ? emptyData.log : [];
      setLastServerState(sq, ss, sl);
      _applyState(sq, ss, sl, null, { force: true });
      if (typeof _onLogChange === "function") _onLogChange();
    }
    return Promise.resolve();
  }).catch((e) => {
    console.warn("[QueueCloud] empty write guard failed; skipping risky write", e);
  });
}

/**
 * Call from index.html after queue, service, log and renderQueue, renderService exist.
 * @param {Object} opts
 * @param {function(number[], number[], any[])} opts.applyState - (queue, service, log) => mutate app state and re-render
 * @param {function(): { queue: any[], service: any[], log: any[] }} opts.getState - return current queue, service, log
 * @param {function()} [opts.onLogChange] - optional; called after applying state to refresh log UI
 */
export function initQueueCloud(opts) {
  if (!opts || typeof opts.applyState !== "function" || typeof opts.getState !== "function") {
    console.warn("[QueueCloud] initQueueCloud: applyState and getState required");
    return;
  }
  _applyState = opts.applyState;
  _getState = opts.getState;
  _onLogChange = opts.onLogChange || null;
  function tryConnect() {
    getSalonId().then((sid) => {
      const loc = readActiveLocationId();
      if (sid && (sid !== _salonId || loc !== _locationId)) {
        _salonId = sid;
        _locationId = loc;
        subscribe(sid, loc, { reason: "connect" });
        console.log("[QueueCloud] Subscribed to salon", sid, "location", loc || "(default)");
      } else if (!sid) {
        _salonId = null;
        _locationId = null;
        if (_unsubscribe) {
          _unsubscribe();
          _unsubscribe = null;
        }
      }
    });
  }
  tryConnect();
  onAuthStateChanged(auth, () => { tryConnect(); });
  // When the header switcher changes the active branch, swap the Firestore
  // subscription to that branch's queueState doc. The subscribe() helper
  // also clears in-memory queue/service/log so the previous branch's cards
  // don't flash on screen.
  if (typeof document !== "undefined" && !window.__ffQueueCloudLocListenerBound) {
    window.__ffQueueCloudLocListenerBound = true;
    document.addEventListener("ff-active-location-changed", (event) => {
      const loc = readActiveLocationId();
      if (!_salonId) return;
      if (loc === _locationId) return;
      _locationId = loc;
      const reason = event?.detail?.reason || "location-changed";
      subscribe(_salonId, loc, { reason });
      console.log("[QueueCloud] Re-subscribed after location switch →", loc || "(default)");
    });
  }
}

/**
 * Write current queue state to Firestore. Call from save() in index.html.
 */
export function queueCloudWrite() {
  return writeState();
}

/**
 * Persist ONLY the queue settings (ff_queues_v1: Auto Reset, location
 * restriction, runtime) to the per-location queueState doc using merge.
 *
 * This is decoupled from writeState() on purpose: writeState() can be blocked
 * by the empty-queue overwrite guard (when the local queue is empty but the
 * cloud has data), which would silently drop the settings and make the Auto
 * Reset toggle revert to OFF on the next load. A dedicated merge write always
 * lands, regardless of queue contents.
 */
export async function queueCloudWriteSettings() {
  // Resolve the salon id even if the live subscription hasn't cached it yet,
  // so toggling Auto Reset right after open still persists to the cloud.
  let sid = _salonId;
  if (!sid) {
    try { sid = await getSalonId(); } catch (_) {}
  }
  if (!sid) {
    console.warn("[QueueCloud] settings write skipped: no salonId");
    return { ok: false, reason: "no-salon" };
  }
  let settings = null;
  try {
    const raw = localStorage.getItem('ff_queues_v1');
    if (raw) settings = JSON.parse(raw);
  } catch (_) {}
  if (!settings || typeof settings !== 'object') {
    console.warn("[QueueCloud] settings write skipped: no local ff_queues_v1");
    return { ok: false, reason: "no-settings" };
  }
  const loc = _locationId || readActiveLocationId();
  const ref = queueStateRef(sid, loc);
  try {
    await setDoc(ref, {
      queueSettings: ffStripServerOwnedRuntime(settings),
      updatedAt: serverTimestamp()
    }, { merge: true });
    console.log("[QueueCloud] settings written to cloud", sid, loc || "(default)");
    return { ok: true };
  } catch (e) {
    console.warn("[QueueCloud] settings write failed", e);
    return { ok: false, reason: "write-error", error: String((e && e.message) || e) };
  }
}

/**
 * Reconnect after salonId or active location might have changed.
 */
export function queueCloudReconnect() {
  getSalonId().then((sid) => {
    const loc = readActiveLocationId();
    if (sid === _salonId && loc === _locationId) return;
    _salonId = sid;
    _locationId = loc;
    if (sid) subscribe(sid, loc, { reason: "reconnect" });
  });
}

/** Fetch current state from server (bypass cache) and apply so other computer sees updates. */
export function queueCloudRefresh() {
  if (!_salonId || !_applyState) return Promise.resolve();
  // Respect cooldown from local writes
  if (typeof window !== "undefined" && (Date.now() - (window.__ff_lastSaveTime || 0)) < 6000) return Promise.resolve();
  const ref = queueStateRef(_salonId, _locationId);
  return getDocFromServer(ref).then((snap) => {
    if (snap.exists()) {
      const data = snap.data();
      const queue = Array.isArray(data.queue) ? data.queue : [];
      const service = Array.isArray(data.service) ? data.service : [];
      const log = Array.isArray(data.log) ? data.log : [];
      _lastCloudRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : _lastCloudRev;
      _lastCloudLogLen = log.length;
      setLastServerState(queue, service, log);
      _applyState(queue, service, log, null, { force: true });
      if (typeof _onLogChange === "function") _onLogChange();
      // Apply queue settings from cloud — but never clobber a just-made local
      // edit (Auto Reset toggle) that hasn't round-tripped yet.
      const localSettingsEditActive = typeof window !== "undefined" &&
        typeof window.__ff_queueSettingsLocalEditUntil === "number" &&
        Date.now() < window.__ff_queueSettingsLocalEditUntil;
      if (!localSettingsEditActive && data.queueSettings && typeof data.queueSettings === 'object') {
        try { localStorage.setItem('ff_queues_v1', JSON.stringify(data.queueSettings)); } catch (_) {}
      }
    }
  }).catch((e) => console.warn("[QueueCloud] refresh failed", e));
}

if (typeof window !== "undefined") {
  window.initQueueCloud = initQueueCloud;
  window.queueCloudWrite = queueCloudWrite;
  window.queueCloudWriteSettings = queueCloudWriteSettings;
  window.queueCloudReconnect = queueCloudReconnect;
  window.queueCloudRefresh = queueCloudRefresh;
  if (typeof window.__ffQueueCloudInit === "function") {
    window.__ffQueueCloudInit();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (typeof window.queueCloudReconnect === "function") window.queueCloudReconnect();
    if (typeof window.tasksCloudReconnect === "function") window.tasksCloudReconnect();
    setTimeout(() => {
      if (typeof window.queueCloudRefresh === "function") window.queueCloudRefresh();
      if (typeof window.tasksCloudRefresh === "function") window.tasksCloudRefresh();
      if (typeof window.ticketsRefreshAvatars === "function") window.ticketsRefreshAvatars();
    }, 300);
  });

  // Poll every 2s: reconnect then fetch from server so both computers stay in sync
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (typeof window.queueCloudReconnect === "function") window.queueCloudReconnect();
    setTimeout(() => {
      if (typeof window.queueCloudRefresh === "function") window.queueCloudRefresh();
    }, 100);
  }, 2000);
}
