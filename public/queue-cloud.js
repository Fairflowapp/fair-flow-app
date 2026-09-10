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
let _subscriptionSeq = 0;
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
let _writeChain = Promise.resolve();

// Version marker + rolling client-side event trace. The trace rides along on
// every queueState write (payload.debugTrace) so a bad write observed in the
// cloud can be traced back to the exact client-side sequence that produced it.
const QUEUE_CLIENT_VER = "20260904_no_resurrect";
function ffQueueTrace(ev, info) {
  try {
    if (typeof window === "undefined") return;
    const arr = (window.__ff_queueTrace = window.__ff_queueTrace || []);
    arr.push(new Date().toISOString().slice(11, 23) + " " + ev + (info ? " " + JSON.stringify(info) : ""));
    if (arr.length > 30) arr.splice(0, arr.length - 30);
  } catch (_) {}
}

// ── Remote diagnostics (salons/{id}/queueDiag/{device}) ─────────────────────
// The queue "jump back" has been a SILENT failure: the device's cloud write
// never reaches the server, so nothing shows up in the queueState doc to
// debug with. This side-channel reports each save attempt + the rolling trace
// on a SEPARATE doc with a direct setDoc (not chained on _writeChain), so a
// stuck/blocked write pipeline is itself observable from the cloud.
function ffDiagDeviceId() {
  try {
    let id = localStorage.getItem("ff_queue_diag_device");
    if (!id) {
      id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem("ff_queue_diag_device", id);
    }
    return id;
  } catch (_) { return "unknown"; }
}
let _pendingWrites = 0;
function writeQueueDiag(event, extra) {
  try {
    if (!_salonId) return;
    const ref = doc(db, "salons", _salonId, "queueDiag", ffDiagDeviceId());
    const body = Object.assign({
      updatedAt: serverTimestamp(),
      event,
      uid: (auth.currentUser && auth.currentUser.uid) || null,
      clientVer: QUEUE_CLIENT_VER,
      pendingWrites: _pendingWrites,
      docId: queueStateDocIdFor(_locationId),
      trace: (typeof window !== "undefined" && Array.isArray(window.__ff_queueTrace)) ? window.__ff_queueTrace.slice(-30) : [],
    }, extra || {});
    setDoc(ref, body, { merge: true }).catch(() => {});
  } catch (_) {}
}

function queueWriteResult(ok, reason, extra = {}) {
  return Object.assign({
    ok: ok === true,
    reason: reason || (ok === true ? "ok" : "write-failed"),
    salonId: _salonId || null,
    activeLocationId: _locationId || readActiveLocationId() || null,
    queueStateDocId: queueStateDocIdFor(_locationId),
  }, extra);
}

function queueErrorMessage(err) {
  if (!err) return "";
  return String(err.message || err.code || err.name || err);
}

function logQueueWrite(label, extra = {}) {
  try {
    console.log("[QueueCloud]", label, Object.assign({
      salonId: _salonId || null,
      activeLocationId: _locationId || readActiveLocationId() || null,
      queueStateDocId: queueStateDocIdFor(_locationId),
      rev: _lastCloudRev,
    }, extra));
  } catch (_) {}
}

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

function queueCloudScopeStillCurrent(expectedSalonId, expectedDocId, expectedSeq) {
  if (expectedSeq !== _subscriptionSeq) return false;
  if (String(_salonId || "") !== String(expectedSalonId || "")) return false;
  if (String(_subscribedDocId || "") !== String(expectedDocId || "")) return false;
  const activeSalon = currentWindowSalonId();
  if (activeSalon && activeSalon !== String(expectedSalonId || "")) return false;
  const kioskSalon = kioskClaimSalonId();
  if (kioskSalon && kioskSalon !== String(expectedSalonId || "")) return false;
  return true;
}

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
  setAuthServerState(queue, service, log);
}

// Freshest AUTHORITATIVE cloud state this device has seen. Unlike
// _lastServerState (the 3-way merge base, which only advances when the UI
// actually reconciled a snapshot), this advances on EVERY server-confirmed
// snapshot — even ones the UI deferred — and on every fresh server read. It is
// the reference for the data-loss guard below: "what is in the cloud right
// now" must never be silently deleted by a write from this device.
let _lastAuthServerState = null;
function setAuthServerState(queue, service, log) {
  _lastAuthServerState = {
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

// All identity keys for one entry. Available→Service often enriches a name-only
// row with staffId; treating that as a brand-new person made the resurrection
// guard block the write and force-apply the old server state (person jumps back
// to Available).
function ffQueueItemAllKeys(it) {
  if (it == null) return ["∅"];
  if (typeof it !== "object") return ["v:" + String(it)];
  const keys = [];
  if (it.staffId != null && String(it.staffId).trim() !== "") {
    keys.push("s:" + String(it.staffId));
  }
  if (it.name != null && String(it.name).trim() !== "") {
    keys.push("n:" + String(it.name).trim().toLowerCase());
  }
  if (!keys.length) {
    try { keys.push("j:" + JSON.stringify(it)); } catch (_) { keys.push("?"); }
  }
  return keys;
}

function ffKeysOverlap(aKeys, bKeySet) {
  for (const k of aKeys) {
    if (bKeySet.has(k)) return true;
  }
  return false;
}

function ffCollectAllKeys(items) {
  const keys = new Set();
  (Array.isArray(items) ? items : []).forEach((it) => {
    ffQueueItemAllKeys(it).forEach((k) => keys.add(k));
  });
  return keys;
}

/**
 * 3-way merge of one list (queue or service). base = common ancestor (last
 * server state we held), local = our current list (with our pending change),
 * server = fresh authoritative list. Returns server with OUR additions added
 * and OUR removals removed, so concurrent changes from both devices survive.
 *
 * Uses all identity keys (staffId + name) so a name-only Available row that is
 * moved to In Service with a staffId still counts as the same person.
 */
function ffMergeList(base, local, server) {
  base = Array.isArray(base) ? base : [];
  local = Array.isArray(local) ? local : [];
  server = Array.isArray(server) ? server : [];
  const baseKeys = ffCollectAllKeys(base);
  const localKeys = ffCollectAllKeys(local);
  // What WE added (in local, not in base) and removed (in base, not in local).
  const localAdded = local.filter((it) => !ffKeysOverlap(ffQueueItemAllKeys(it), baseKeys));
  const weRemoved = ffCollectAllKeys(
    base.filter((it) => !ffKeysOverlap(ffQueueItemAllKeys(it), localKeys))
  );
  // Start from server, drop the entries we intentionally removed, then append
  // our additions that aren't already present.
  const result = server.filter((it) => !ffKeysOverlap(ffQueueItemAllKeys(it), weRemoved));
  const present = ffCollectAllKeys(result);
  for (const it of localAdded) {
    const keys = ffQueueItemAllKeys(it);
    if (!ffKeysOverlap(keys, present)) {
      result.push(it);
      keys.forEach((k) => present.add(k));
    }
  }
  return result;
}

function ffLogEntryKey(e) {
  if (e == null) return "∅";
  if (typeof e !== "object") return "v:" + String(e);
  const ts = (typeof e.ts === "number") ? e.ts : "";
  return "t:" + ts + "|a:" + String(e.action || "") + "|w:" + String(e.worker || "") + "|p:" + String(e.performedBy || "");
}

function ffLogEntryLocationId(e) {
  if (!e || typeof e !== "object") return "";
  return typeof e.locationId === "string" ? e.locationId.trim() : "";
}

function ffLogBelongsToLocation(e, locationId) {
  const stamped = ffLogEntryLocationId(e);
  const active = String(locationId || "").trim();
  if (stamped) return stamped === active;
  return !active;
}

function ffFilterLogForLocation(list, locationId) {
  return (Array.isArray(list) ? list : []).filter((e) => ffLogBelongsToLocation(e, locationId));
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

// RETENTION for the history log stored in the queueState doc. The log grew
// unbounded (5,700+ entries ≈ 975KB) and pushed the doc against Firestore's
// 1MiB limit — at that size the security-rules evaluation (diff of old vs new
// doc) fails and EVERY write is rejected with permission-denied. That silent
// rejection is what made queue moves "jump back".
// Two limits, applied on every cloud write:
//   1. Age: entries older than 60 days are dropped (business decision — no
//      need to keep queue history longer than that).
//   2. Count: hard cap as a size safety net for very busy salons.
// Newest entries live at the END of the array, so we keep the tail. Entries
// without a usable timestamp are kept (can't date them) and age out via the
// count cap. Older history was archived server-side (queueLogArchive).
const QUEUE_CLOUD_LOG_CAP = 1500;
const QUEUE_CLOUD_LOG_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const QUEUE_REMOVAL_JUSTIFY_WINDOW_MS = 10 * 60 * 1000;
function ffLogHasUnknownRows(localLog, knownLog) {
  const known = new Set((Array.isArray(knownLog) ? knownLog : []).map(ffLogEntryKey));
  return (Array.isArray(localLog) ? localLog : []).some((e) => !known.has(ffLogEntryKey(e)));
}
function ffIsQueueIntentAction(action) {
  const a = String(action || "").trim();
  if (/^join blocked/i.test(a)) return false;
  return /^(start|finish|join|remove|add technician|queue reset|automatic queue reset)/i.test(a);
}
function ffIsQueueAddAction(action) {
  const a = String(action || "").trim();
  if (/^join blocked/i.test(a)) return false;
  return /^(join|add technician)/i.test(a);
}
function ffJustifiedAddNames(localLog, knownLog) {
  const names = new Set();
  const known = new Set((Array.isArray(knownLog) ? knownLog : []).map(ffLogEntryKey));
  const now = Date.now();
  (Array.isArray(localLog) ? localLog : []).forEach((e) => {
    if (!e || typeof e !== "object") return;
    if (known.has(ffLogEntryKey(e))) return;
    if (!ffIsQueueAddAction(e.action)) return;
    const ts = typeof e.ts === "number" ? e.ts : 0;
    if (!ts || Math.abs(now - ts) > QUEUE_REMOVAL_JUSTIFY_WINDOW_MS) return;
    const w = ffNormWorkerName(e.worker);
    if (w) names.add(w);
  });
  return names;
}
function ffJustifiedWorkerNames(localLog, knownLog) {
  const names = new Set();
  const known = new Set((Array.isArray(knownLog) ? knownLog : []).map(ffLogEntryKey));
  const now = Date.now();
  (Array.isArray(localLog) ? localLog : []).forEach((e) => {
    if (!e || typeof e !== "object") return;
    if (known.has(ffLogEntryKey(e))) return;
    if (!ffIsQueueIntentAction(e.action)) return;
    const ts = typeof e.ts === "number" ? e.ts : 0;
    if (!ts || Math.abs(now - ts) > QUEUE_REMOVAL_JUSTIFY_WINDOW_MS) return;
    const w = ffNormWorkerName(e.worker);
    if (w) names.add(w);
  });
  return names;
}
function ffKeepServerPositions(out, server, justified) {
  const queue = Array.isArray(out.queue) ? out.queue.slice() : [];
  const service = Array.isArray(out.service) ? out.service.slice() : [];
  const srvQueue = Array.isArray(server && server.queue) ? server.queue : [];
  const srvService = Array.isArray(server && server.service) ? server.service : [];
  srvService.forEach((it) => {
    const keys = ffQueueItemAllKeys(it);
    if (ffKeysOverlap(keys, ffCollectAllKeys(service))) return;
    if (justified.has(ffNormWorkerName(it && it.name))) return;
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (ffKeysOverlap(ffQueueItemAllKeys(queue[i]), new Set(keys))) queue.splice(i, 1);
    }
    service.push(it);
  });
  srvQueue.forEach((it) => {
    const keys = ffQueueItemAllKeys(it);
    const qKeys = ffCollectAllKeys(queue);
    const sKeys = ffCollectAllKeys(service);
    if (ffKeysOverlap(keys, qKeys) || ffKeysOverlap(keys, sKeys)) return;
    if (justified.has(ffNormWorkerName(it && it.name))) return;
    queue.push(it);
  });
  return { queue, service, log: out.log };
}
function ffCapLog(list) {
  if (!Array.isArray(list)) return [];
  const cutoff = Date.now() - QUEUE_CLOUD_LOG_MAX_AGE_MS;
  let out = list.filter((e) => {
    const ts = e && typeof e.ts === "number" ? e.ts : 0;
    return !ts || ts >= cutoff;
  });
  if (out.length > QUEUE_CLOUD_LOG_CAP) out = out.slice(-QUEUE_CLOUD_LOG_CAP);
  return out;
}

function ffMerge3(base, local, server) {
  // Stale device with no new history: adopt the live server lists. The Aug 13
  // Neo Nails jump-back was a backgrounded phone whose captured q=9/s=0 had no
  // new log rows; after a snapshot advanced `base` to the live q=2/s=10, merge
  // treated that as a mass Finish and stripped In Service.
  if (!ffLogHasUnknownRows(local && local.log, server && server.log)) {
    return {
      queue: Array.isArray(server && server.queue) ? server.queue.slice() : [],
      service: Array.isArray(server && server.service) ? server.service.slice() : [],
      log: ffCapLog(ffMergeLog(server && server.log, ffFilterLogForLocation(local && local.log, _locationId))),
    };
  }
  let queue = ffMergeList(base.queue, local.queue, server.queue);
  let service = ffMergeList(base.service, local.service, server.service);
  // Cross-list move enforcement — ONLY for people THIS device moved since its
  // last server sync (present in local list but not in base list). Using the
  // full local lists here was the jump-back bug: a second device whose stale
  // local queue still held the person stripped them out of In Service on its
  // next merged write, undoing the move made on the first device.
  // Even with a new log row (e.g. one real Start), only strip the other list
  // for workers named on a fresh justifying row — not everyone in the stale list.
  const justified = ffJustifiedWorkerNames(local && local.log, server && server.log);
  const baseServiceKeys = ffCollectAllKeys(base && base.service);
  const baseQueueKeys = ffCollectAllKeys(base && base.queue);
  const weMovedToService = ffCollectAllKeys(
    (Array.isArray(local && local.service) ? local.service : [])
      .filter((it) => !ffKeysOverlap(ffQueueItemAllKeys(it), baseServiceKeys))
      .filter((it) => justified.has(ffNormWorkerName(it && it.name)))
  );
  const weMovedToQueue = ffCollectAllKeys(
    (Array.isArray(local && local.queue) ? local.queue : [])
      .filter((it) => !ffKeysOverlap(ffQueueItemAllKeys(it), baseQueueKeys))
      .filter((it) => justified.has(ffNormWorkerName(it && it.name)))
  );
  if (weMovedToService.size) {
    queue = queue.filter((it) => !ffKeysOverlap(ffQueueItemAllKeys(it), weMovedToService));
  }
  if (weMovedToQueue.size) {
    service = service.filter((it) => !ffKeysOverlap(ffQueueItemAllKeys(it), weMovedToQueue));
  }
  return ffKeepServerPositions({
    queue,
    service,
    log: ffCapLog(ffMergeLog(server.log, ffFilterLogForLocation(local.log, _locationId))),
  }, server, justified);
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
  const serverKeys = new Set();
  []
    .concat(Array.isArray(base.queue) ? base.queue : [])
    .concat(Array.isArray(base.service) ? base.service : [])
    .forEach((it) => {
      ffQueueItemAllKeys(it).forEach((k) => serverKeys.add(k));
    });
  const localItems = []
    .concat(Array.isArray(localState.queue) ? localState.queue : [])
    .concat(Array.isArray(localState.service) ? localState.service : []);
  const hasUnbackedNewPerson = localItems.some(
    (it) => !ffQueueItemAllKeys(it).some((k) => serverKeys.has(k))
  );
  if (!hasUnbackedNewPerson) return false;
  // A genuine add/move writes a NEW history row. Detect by entry keys, not by
  // array length: with the log capped, appending a row + dropping the oldest
  // keeps the length equal, so length comparison would falsely flag real
  // actions as resurrections.
  const baseLogKeys = new Set((Array.isArray(base.log) ? base.log : []).map(ffLogEntryKey));
  const hasNewLogRows = (Array.isArray(localState.log) ? localState.log : [])
    .some((e) => !baseLogKeys.has(ffLogEntryKey(e)));
  return !hasNewLogRows;
}

// ── Cloud data-loss guard (final funnel — the cloud always wins) ─────────────
// Root cause of the 2026-07-28 queue wipe: a phone whose write was delayed
// (backgrounded / offline / stuck for an hour) eventually pushed its OLD
// snapshot with a valid rev, silently deleting 4 people who had joined in the
// meantime AND their history rows. Every guard upstream can be bypassed by
// some timing, so this is enforced at the single point every content write
// passes through (writeAt):
//   1. The history log is append-only: the authoritative cloud log is unioned
//      into the outgoing write, so a stale payload can never roll history back.
//   2. A person present in the cloud may only be REMOVED by a write that also
//      carries a FRESH new history row (unknown to the cloud, stamped within
//      the last few minutes) naming that worker — which every genuine
//      remove/leave action creates. A stale payload has no such rows, so
//      everyone it would have wiped is restored into the write.
// Explicit replace flows (manual/auto reset, clear-history, retention-prune)
// skip this guard — those intentionally shrink the doc.
function ffNormWorkerName(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}
function ffProtectCloudData(body, allowExplicitReplace) {
  try {
    if (allowExplicitReplace) return body;
    const srv = _lastAuthServerState;
    if (!srv) return body;
    const srvQueue = Array.isArray(srv.queue) ? srv.queue : [];
    const srvService = Array.isArray(srv.service) ? srv.service : [];
    const srvLog = Array.isArray(srv.log) ? srv.log : [];
    const out = Object.assign({}, body, {
      queue: Array.isArray(body.queue) ? body.queue.slice() : [],
      service: Array.isArray(body.service) ? body.service.slice() : [],
      log: Array.isArray(body.log) ? body.log.slice() : [],
    });
    // 1. History is append-only relative to the cloud.
    out.log = ffCapLog(ffMergeLog(srvLog, out.log));
    // 2. Removals / cross-list moves must be justified by a fresh queue action
    // (Start / Finish / Join / Remove). Task Completed and similar noise must
    // not count — that was enough to strip In Service in the extra sync tests.
    const justified = ffJustifiedWorkerNames(body.log, srvLog);
    const presentKeys = ffCollectAllKeys(out.queue.concat(out.service));
    const restored = [];
    const restoreMissing = (srvList, outList, tag) => {
      srvList.forEach((it) => {
        if (ffKeysOverlap(ffQueueItemAllKeys(it), presentKeys)) return;
        if (justified.has(ffNormWorkerName(it && it.name))) return;
        outList.push(it);
        ffQueueItemAllKeys(it).forEach((k) => presentKeys.add(k));
        restored.push(tag + ":" + ((it && it.name) || "?"));
      });
    };
    restoreMissing(srvQueue, out.queue, "q");
    restoreMissing(srvService, out.service, "s");
    // 3. Cross-list moves need the same fresh justifying row. Being "present"
    // in either list is not enough: a stale Available snapshot can keep people
    // who are In Service on the server (Aug 13 Neo Nails: 10 in service → 2).
    const bounce = [];
    const bounceUnjustified = (srvList, fromKey, toKey) => {
      srvList.forEach((it) => {
        const keys = ffQueueItemAllKeys(it);
        const fromKeys = ffCollectAllKeys(out[fromKey]);
        const toKeys = ffCollectAllKeys(out[toKey]);
        if (ffKeysOverlap(keys, toKeys)) return;
        if (!ffKeysOverlap(keys, fromKeys)) return;
        if (justified.has(ffNormWorkerName(it && it.name))) return;
        out[fromKey] = out[fromKey].filter((x) => !ffKeysOverlap(ffQueueItemAllKeys(x), new Set(keys)));
        out[toKey].push(it);
        bounce.push(toKey + "<-" + fromKey + ":" + ((it && it.name) || "?"));
      });
    };
    bounceUnjustified(srvService, "queue", "service");
    bounceUnjustified(srvQueue, "service", "queue");
    if (restored.length) {
      ffQueueTrace("write:guard-restored", { n: restored.length });
      console.warn("[QueueCloud] write would drop people present in cloud — restored them", restored);
      writeQueueDiag("guard-restored", { restored: restored.slice(0, 12) });
    }
    if (bounce.length) {
      ffQueueTrace("write:guard-bounced-move", { n: bounce.length });
      console.warn("[QueueCloud] write would move people without a fresh action — bounced them", bounce);
      writeQueueDiag("guard-bounced-move", { bounced: bounce.slice(0, 12) });
    }
    // 4. Adds must be a fresh Join / Add technician. Overnight tablets still
    // hold yesterday's names; the restore-only guard used to KEEP those extras
    // on top of whoever already joined this morning (Sep 4 Brickell).
    const addJustified = ffJustifiedAddNames(body.log, srvLog);
    const liveKeys = ffCollectAllKeys(srvQueue.concat(srvService));
    const stripped = [];
    const keepLiveOrJustified = (it) => {
      if (ffKeysOverlap(ffQueueItemAllKeys(it), liveKeys)) return true;
      if (addJustified.has(ffNormWorkerName(it && it.name))) return true;
      stripped.push((it && it.name) || "?");
      return false;
    };
    out.queue = out.queue.filter(keepLiveOrJustified);
    out.service = out.service.filter(keepLiveOrJustified);
    if (stripped.length) {
      ffQueueTrace("write:guard-stripped-adds", { n: stripped.length });
      console.warn("[QueueCloud] write would resurrect people the cloud already cleared — stripped them", stripped);
      writeQueueDiag("guard-stripped-adds", { stripped: stripped.slice(0, 12) });
    }
    return out;
  } catch (e) {
    console.warn("[QueueCloud] cloud data-loss guard failed; writing unguarded", e);
    return body;
  }
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

/** During a fresh local save, do not force-clobber the on-screen queue with a
 *  server pull — that is exactly the Available→Service jump-back. Auto-reset
 *  may still force-apply. */
function shouldProtectRecentLocalQueueUi(applyReason) {
  if (applyReason === "server-auto-reset" || applyReason === "auto-reset") return false;
  return hasRecentLocalQueueWrite();
}

function forceApplyCloudState(queue, service, log, applyOpts) {
  const reason = applyOpts && applyOpts.reason;
  if (shouldProtectRecentLocalQueueUi(reason)) {
    console.warn("[QueueCloud] skipped force-apply during recent local save", { reason: reason || null });
    ffQueueTrace("apply:skip-recent-save", { reason: reason || null });
    return false;
  }
  if (reason !== "cloud-refresh") {
    ffQueueTrace("apply:force", { reason: reason || null, q: Array.isArray(queue) ? queue.length : 0, s: Array.isArray(service) ? service.length : 0 });
  }
  if (typeof _applyState === "function") {
    _applyState(queue, service, log, null, applyOpts || { force: true });
    if (typeof _onLogChange === "function") _onLogChange();
  }
  return true;
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
  const salonChanged = _salonId !== null && _salonId !== salonId;
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  _firstSnapshot = true;
  const locationDocChanged = _subscribedDocId !== null && _subscribedDocId !== nextDocId;
  const scopeChanged = salonChanged || locationDocChanged;
  // Switching to a different branch — require a fresh server snapshot before we
  // trust an empty queue again.
  if (scopeChanged && typeof window !== "undefined") {
    window.__ff_queueCloudServerConfirmed = false;
  }
  const preserveRecentLocalWrite =
    !salonChanged &&
    opts.reason !== "manual" &&
    hasRecentLocalQueueWrite() &&
    queueStateHasData(_getState ? _getState() : null);
  // Clear in-memory queue/service/log only when switching to a DIFFERENT branch
  // doc. Re-subscribing to the same branch (staff/location recompute on boot)
  // must not wipe the locally cached queue — that caused empty flashes on phone.
  if (scopeChanged && !preserveRecentLocalWrite && typeof _applyState === "function") {
    try { _applyState([], [], [], null, { force: true, reason: salonChanged ? "queue-cloud-salon-switch" : "queue-cloud-resubscribe" }); } catch (_) {}
    if (typeof _onLogChange === "function") {
      try { _onLogChange(); } catch (_) {}
    }
  }
  _salonId = salonId;
  _locationId = locationId;
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
    _lastAuthServerState = null;
    try {
      localStorage.removeItem('ff_queues_v1');
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('ff-queue-settings-changed', { detail: { reason: 'location-switch' } }));
      }
    } catch (_) {}
  }
  const ref = queueStateRef(salonId, locationId);
  const logTag = locationId ? `loc=${locationId}` : "default";
  const subscriptionSeq = ++_subscriptionSeq;
  const expectedSalonId = salonId;
  const expectedDocId = nextDocId;
  console.log("[QueueCloud] subscribe", {
    salonId,
    activeLocationId: locationId || null,
    queueStateDocId: queueStateDocIdFor(locationId),
    reason: opts.reason || "unknown",
    rev: _lastCloudRev,
    subscriptionSeq,
  });
  _unsubscribe = onSnapshot(ref, (snap) => {
    if (!queueCloudScopeStillCurrent(expectedSalonId, expectedDocId, subscriptionSeq)) {
      console.warn("[QueueCloud] ignored stale snapshot", {
        expectedSalonId,
        currentSalonId: _salonId,
        expectedDocId,
        currentDocId: _subscribedDocId,
        subscriptionSeq,
        activeSeq: _subscriptionSeq,
      });
      return;
    }
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
          log: ffCapLog(localState.log || []),
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
    const cloudUpdateReason = typeof data.lastUpdateReason === "string" ? data.lastUpdateReason : "";
    const cloudFromServerAutoReset =
      cloudUpdateReason === "auto-reset" ||
      data.lastUpdatedByUid === "server:queueAutoReset";
    if (typeof window !== "undefined") {
      window.__ff_queueLastCloudUpdateReason = cloudUpdateReason || "";
      if (cloudFromServerAutoReset) {
        window.__ff_queueLastCloudWasAutoReset = true;
      }
    }

    if (shouldDeferBootSnapshot(snap, locationId, cloudHasData, localHasAnyData)) {
      console.log("[QueueCloud] Defer empty boot snapshot until server data", logTag, {
        fromCache: snapshotFromCache(snap),
      });
      return;
    }

    // On first snapshot for an existing but empty cloud doc, do not seed from
    // localStorage unless this tab just performed a local queue write. Otherwise
    // an old mobile cache can resurrect an employee after the 4 AM cloud reset.
    // NEVER push local over a server auto-reset (even if queue+service empty but
    // log preserved — cloudHasData may be true via log; this path is for fully empty).
    if (_firstSnapshot && !cloudHasData && preserveRecentLocalWrite && localHasAnyData) {
      if (cloudFromServerAutoReset) {
        console.warn("[QueueCloud] skip push-local after server auto-reset", logTag);
      } else {
        console.log("[QueueCloud] Cloud empty but local has data, pushing local", logTag);
        // Base the new rev on THIS snapshot's rev (the doc already exists), so the
        // compare-and-swap rule accepts the write.
        const baseRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
        setDoc(ref, {
          queue: localState.queue || [],
          service: localState.service || [],
          log: ffCapLog(localState.log || []),
          rev: baseRev + 1,
          updatedAt: serverTimestamp()
        }).then(() => { _lastCloudRev = baseRev + 1; })
          .catch((e) => console.warn("[QueueCloud] Push local failed", e));
        _firstSnapshot = false;
        return;
      }
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
    // Server auto-reset must always win over local grace / stale cache.
    const isGenuineRemote = isAuthoritative && (snapRev > _lastCloudRev || cloudFromServerAutoReset);
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
    const applyOpts = cloudFromServerAutoReset && isAuthoritative
      ? { remote: true, force: true, reason: "server-auto-reset" }
      : { remote: isGenuineRemote };
    const applied = _applyState(queue, service, log, null, applyOpts);
    ffQueueTrace(applied !== false ? "snap:applied" : "snap:deferred", {
      rev: snapRev,
      remote: isGenuineRemote,
      q: queue.length,
      s: service.length,
    });
    if (applied !== false) {
      console.log("[QueueCloud] snapshot applied", {
        salonId,
        activeLocationId: locationId || null,
        queueStateDocId: queueStateDocIdFor(locationId),
        rev: snapRev,
        queueLen: queue.length,
        serviceLen: service.length,
        logLen: log.length,
        fromCache: snapshotFromCache(snap),
        remote: isGenuineRemote,
        updateReason: cloudUpdateReason || null,
      });
    }
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
    } else if (isAuthoritative) {
      // Snapshot deferred by the UI: do NOT advance the merge base / rev (that
      // caused the resurrection bug), but DO remember what the cloud holds so
      // the data-loss guard measures every write against the freshest truth.
      setAuthServerState(queue, service, log);
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
  }, (err) => {
    if (!queueCloudScopeStillCurrent(expectedSalonId, expectedDocId, subscriptionSeq)) return;
    console.error("[QueueCloud] subscribe error", logTag, err);
  });
}

function writeState(capturedState) {
  if (!_salonId || !_getState) return Promise.resolve();
  if (!queueCloudScopeStillCurrent(_salonId, queueStateDocIdFor(_locationId), _subscriptionSeq)) {
    const activeSalon = currentWindowSalonId();
    const kioskSalon = kioskClaimSalonId();
    ffQueueTrace("write:blocked-stale-scope");
    console.warn("[QueueCloud] blocked write for stale scope", {
      salonId: _salonId,
      activeSalon,
      kioskSalon,
      activeLocationId: _locationId || null,
      queueStateDocId: queueStateDocIdFor(_locationId),
    });
    return Promise.resolve(queueWriteResult(false, "stale-scope", { activeSalon, kioskSalon }));
  }
  // Prefer the state captured at action time over the live state: the live
  // state may have been clobbered while this write waited in the chain.
  const state = capturedState || _getState();
  if (!state) return Promise.resolve();
  const ref = queueStateRef(_salonId, _locationId);
  const localCounts = stateCounts(state);
  const localEmpty = localCounts.queue + localCounts.service + localCounts.log === 0;
  const reason = queueCloudWriteReason();
  ffQueueTrace("write:start", { reason, q: localCounts.queue, s: localCounts.service, captured: !!capturedState });
  const payload = {
    queue: state.queue || [],
    service: state.service || [],
    log: ffCapLog(ffFilterLogForLocation(state.log || [], _locationId)),
    updatedAt: serverTimestamp(),
    lastUpdateReason: reason,
    lastUpdatedByUid: auth.currentUser?.uid || null,
    clientVer: QUEUE_CLIENT_VER,
  };
  try {
    if (typeof window !== "undefined" && Array.isArray(window.__ff_queueTrace)) {
      payload.debugTrace = window.__ff_queueTrace.slice(-25);
    }
  } catch (_) {}
  // Do NOT attach queueSettings here. A queue move/save from a device whose
  // local ff_queues_v1 is missing queueGeoFence would REPLACE the whole
  // queueSettings map (Firestore merge is top-level only) and wipe Salon
  // Location + Time Clock enforcement. Settings persist only via
  // queueCloudWriteSettings.
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
  const persistAt = (body, revBase) => {
    return setDoc(ref, Object.assign({}, body, { rev: revBase + 1 }), { merge: true })
    .then(() => {
      if (_lastCloudRev <= revBase) _lastCloudRev = revBase + 1;
      // Our write is now the authoritative state — make it the next merge base.
      setLastServerState(body.queue || [], body.service || [], body.log || []);
      _lastCloudLogLen = Array.isArray(body.log) ? body.log.length : _lastCloudLogLen;
      // A successful user write means we are past the morning auto-reset window
      // for this device — stop treating later moves/adds as post-reset resurrection.
      if (typeof window !== "undefined" && reason !== "auto-reset") {
        window.__ff_queueLastCloudWasAutoReset = false;
        if (window.__ff_queueLastCloudUpdateReason === "auto-reset") {
          window.__ff_queueLastCloudUpdateReason = body.lastUpdateReason || reason || "";
        }
      }
      const result = queueWriteResult(true, "ok", { rev: revBase + 1, reason: body.lastUpdateReason || reason });
      ffQueueTrace("write:ok", { rev: revBase + 1, q: Array.isArray(body.queue) ? body.queue.length : 0, s: Array.isArray(body.service) ? body.service.length : 0 });
      logQueueWrite("write ok", result);
      return result;
    });
  };

  const writeAt = (rawBody, baseRev) => {
    if (isExplicitIntent) {
      return persistAt(ffProtectCloudData(rawBody, true), baseRev);
    }
    // Always reconcile against the LIVE cloud before writing. An overnight
    // tablet's in-memory "last server state" still holds yesterday's names,
    // so the old resurrection check thought the leftover list was already
    // known and let it through.
    return getDocFromServer(ref).then((snap) => {
      let revBase = baseRev;
      if (snap.exists()) {
        const data = snap.data() || {};
        const sq = Array.isArray(data.queue) ? data.queue : [];
        const ss = Array.isArray(data.service) ? data.service : [];
        const sl = Array.isArray(data.log) ? data.log : [];
        setAuthServerState(sq, ss, sl);
        if (typeof data.rev === "number" && data.rev >= 0) {
          _lastCloudRev = data.rev;
          revBase = data.rev;
        }
        _lastCloudLogLen = sl.length;
        const liveKeys = ffCollectAllKeys(sq.concat(ss));
        const baseGhosts = []
          .concat(_lastServerState.queue || [])
          .concat(_lastServerState.service || [])
          .some((it) => !ffKeysOverlap(ffQueueItemAllKeys(it), liveKeys));
        if (baseGhosts) setLastServerState(sq, ss, sl);
      }
      const body = ffProtectCloudData(rawBody, false);
      const rawPeople = (Array.isArray(rawBody.queue) ? rawBody.queue.length : 0)
        + (Array.isArray(rawBody.service) ? rawBody.service.length : 0);
      const keptPeople = (Array.isArray(body.queue) ? body.queue.length : 0)
        + (Array.isArray(body.service) ? body.service.length : 0);
      if (keptPeople < rawPeople) {
        forceApplyCloudState(body.queue || [], body.service || [], body.log || [], {
          force: true,
          reason: "strip-unjustified-adds",
        });
      }
      return persistAt(body, revBase);
    }).catch((e) => {
      if (isPermissionDenied(e)) throw e;
      console.warn("[QueueCloud] refused write without a fresh server read", e);
      return queueWriteResult(false, "pre-write-refresh-failed", { error: queueErrorMessage(e) });
    });
  };

  const commit = (attempt) => {
    attempt = attempt || 0;
    const baseRev = _lastCloudRev;
    logQueueWrite("write start", { reason, baseRev, attempt, localCounts });
    return writeAt(payload, baseRev).catch((e) => {
      if (!isPermissionDenied(e)) {
        console.warn("[QueueCloud] write failed", e);
        return queueWriteResult(false, "write-failed", { error: queueErrorMessage(e), rev: baseRev + 1 });
      }
      // Stale rev: another device advanced the queue between our read and write.
      if (attempt >= 5) {
        console.warn("[QueueCloud] merge retries exhausted — pulling server state");
        return pullServerInto().then(() => queueWriteResult(false, "merge-retries-exhausted", { rev: baseRev }));
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
        setAuthServerState(serverState.queue, serverState.service, serverState.log);

        // For explicit reset/clear/seed intent there is no "merge" — the intent
        // is to replace, so just retry on top of the fresh rev.
        if (isExplicitIntent) {
          return writeAt(payload, serverRev).catch((e2) => {
            if (isPermissionDenied(e2) && attempt < 5) return commit(attempt + 1);
            return pullServerInto(serverState, serverRev).then(() => queueWriteResult(false, "explicit-intent-write-rejected", { error: queueErrorMessage(e2), rev: serverRev }));
          });
        }

        // Normal write that lost the race. Replay OUR ORIGINAL WRITE INTENT
        // (the payload captured at the start of writeState), NOT live getState().
        // A concurrent snapshot can force-apply the old server list into the UI
        // while this write is in flight; if we merged from getState() after that
        // clobber, Available→Service moves were lost and the person jumped back.
        const localNow = {
          queue: Array.isArray(payload.queue) ? payload.queue : [],
          service: Array.isArray(payload.service) ? payload.service : [],
          log: Array.isArray(payload.log) ? payload.log : [],
        };
        const merged = ffMerge3(_lastServerState, localNow, serverState);
        ffQueueTrace("write:rev-conflict-merge", { attempt, serverRev, q: merged.queue.length, s: merged.service.length });
        const mergedBody = Object.assign({}, payload, {
          queue: merged.queue,
          service: merged.service,
          log: merged.log,
        });
        return writeAt(mergedBody, serverRev).catch((e2) => {
          if (isPermissionDenied(e2) && attempt < 5) return commit(attempt + 1);
          if (isPermissionDenied(e2)) return pullServerInto(serverState, serverRev).then(() => queueWriteResult(false, "merged-write-rejected", { error: queueErrorMessage(e2), rev: serverRev }));
          console.warn("[QueueCloud] merged write failed", e2);
          return queueWriteResult(false, "merged-write-failed", { error: queueErrorMessage(e2), rev: serverRev + 1 });
        });
      }).catch((e2) => {
        console.warn("[QueueCloud] conflict resolution read failed", e2);
        return queueWriteResult(false, "conflict-resolution-read-failed", { error: queueErrorMessage(e2) });
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
      forceApplyCloudState(st.queue || [], st.service || [], st.log || [], { force: true });
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
      ffQueueTrace("write:blocked-pre-sync");
      console.warn("[QueueCloud] blocked pre-sync overwrite of non-empty cloud state", {
        salonId: _salonId,
        locationId: _locationId || QUEUE_STATE_DEFAULT,
        reason,
        localCounts,
        cloudCounts,
      });
      {
        const data = snap.data() || {};
        const sq = Array.isArray(data.queue) ? data.queue : [];
        const ss = Array.isArray(data.service) ? data.service : [];
        const sl = Array.isArray(data.log) ? data.log : [];
        setLastServerState(sq, ss, sl);
        forceApplyCloudState(sq, ss, sl, { force: true, reason: "pre-sync-overwrite-blocked" });
      }
      return queueWriteResult(false, "pre-sync-overwrite-blocked", { cloudCounts });
    }).catch((e) => {
      console.warn("[QueueCloud] pre-sync write guard failed; skipping risky write", e);
      return queueWriteResult(false, "pre-sync-guard-read-failed", { error: queueErrorMessage(e) });
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
  const lastWasAutoReset = typeof window !== "undefined" && (
    window.__ff_queueLastCloudWasAutoReset === true ||
    window.__ff_queueLastCloudUpdateReason === "auto-reset"
  );
  // After a known server auto-reset, never push a non-empty queue unless this
  // tab has an explicit empty-overwrite window (manual/local reset) — the
  // resurrection check below still covers the general case.
  if (!localEmpty && serverConfirmed && lastWasAutoReset && !isExplicitIntent && ffWriteResurrectsRemoved(state)) {
    ffQueueTrace("write:blocked-auto-reset-resurrection");
    console.warn("[QueueCloud] blocked write after server auto-reset (stale local queue)", {
      salonId: _salonId,
      locationId: _locationId || QUEUE_STATE_DEFAULT,
      reason,
      localQueueLen: localCounts.queue,
    });
    return getDocFromServer(ref).then((snap) => {
      if (!snap.exists()) return queueWriteResult(false, "auto-reset-resurrection-blocked");
      const data = snap.data() || {};
      _lastCloudRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : _lastCloudRev;
      const sq = Array.isArray(data.queue) ? data.queue : [];
      const ss = Array.isArray(data.service) ? data.service : [];
      const sl = Array.isArray(data.log) ? data.log : [];
      _lastCloudLogLen = sl.length;
      setLastServerState(sq, ss, sl);
      forceApplyCloudState(sq, ss, sl, { force: true, reason: "server-auto-reset" });
      return queueWriteResult(false, "auto-reset-resurrection-blocked", {
        localQueueLen: localCounts.queue,
        serverQueueLen: sq.length,
      });
    }).catch((e) => {
      console.warn("[QueueCloud] auto-reset resurrection guard read failed", e);
      return queueWriteResult(false, "auto-reset-guard-read-failed", { error: queueErrorMessage(e) });
    });
  }
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
      const freshKeys = new Set();
      sq.concat(ss).forEach((it) => {
        ffQueueItemAllKeys(it).forEach((k) => freshKeys.add(k));
      });
      const localItems = []
        .concat(Array.isArray(state.queue) ? state.queue : [])
        .concat(Array.isArray(state.service) ? state.service : []);
      const freshLogKeys = new Set(sl.map(ffLogEntryKey));
      const localHasNewLogRows = (Array.isArray(state.log) ? state.log : [])
        .some((e) => !freshLogKeys.has(ffLogEntryKey(e)));
      const stillResurrecting = localItems.some(
        (it) => !ffQueueItemAllKeys(it).some((k) => freshKeys.has(k))
      ) && !localHasNewLogRows;
      if (!stillResurrecting) return commit();
      ffQueueTrace("write:blocked-stale-cache-resurrection");
      console.warn("[QueueCloud] blocked stale-cache resurrection after server reset", {
        salonId: _salonId,
        locationId: _locationId || QUEUE_STATE_DEFAULT,
        reason,
        localQueueLen: Array.isArray(state.queue) ? state.queue.length : 0,
        serverQueueLen: sq.length,
      });
      _lastCloudLogLen = sl.length;
      setLastServerState(sq, ss, sl);
      // During a fresh local move/save, keep the on-screen intent; only block the
      // risky write. Force-applying here was snapping people back to Available.
      forceApplyCloudState(sq, ss, sl, { force: true, reason: "stale-cache-resurrection-blocked" });
      return queueWriteResult(false, "stale-cache-resurrection-blocked", {
        localQueueLen: Array.isArray(state.queue) ? state.queue.length : 0,
        serverQueueLen: sq.length,
      });
    }).catch((e) => {
      console.warn("[QueueCloud] resurrection guard read failed; skipping risky write", e);
      return queueWriteResult(false, "resurrection-guard-read-failed", { error: queueErrorMessage(e) });
    });
  }

  // ── Stale-overwrite guard (merge, not block) ───────────────────────────────
  // For a NON-empty local queue: if the cloud history is LONGER than what we
  // hold locally, our raw write would roll the shared log back. This is NOT
  // only the "old backgrounded phone" case — History retention pruning makes
  // the LOCAL log legitimately shorter than the cloud log on healthy devices.
  // Blocking here silently dropped every queue action from such a device (the
  // Available→In Service move "jumped back" as other devices kept writing the
  // old state). Instead of blocking, MERGE: keep the server's fuller history
  // (union) and replay OUR queue/service intent on top of the fresh server
  // state via the same 3-way merge used for rev conflicts. A truly stale
  // device contributes no changes relative to its base, so its merged write
  // degenerates to the server state — same safety as blocking, no data loss.
  if (!localEmpty) {
    const localLogLen = Array.isArray(state.log) ? state.log.length : 0;
    if (_lastCloudLogLen > localLogLen) {
      return getDocFromServer(ref).then((snap) => {
        if (!snap.exists()) return commit();
        const data = snap.data() || {};
        const serverRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
        _lastCloudRev = serverRev;
        const cloudLogLen = Array.isArray(data.log) ? data.log.length : 0;
        const cc = stateCounts(data);
        const cloudHasData = cc.queue + cc.service + cc.log > 0;
        if (cloudHasData && cloudLogLen > localLogLen) {
          const serverState = {
            queue: Array.isArray(data.queue) ? data.queue : [],
            service: Array.isArray(data.service) ? data.service : [],
            log: Array.isArray(data.log) ? data.log : [],
          };
          _lastCloudLogLen = cloudLogLen;
          setAuthServerState(serverState.queue, serverState.service, serverState.log);
          const localNow = {
            queue: Array.isArray(payload.queue) ? payload.queue : [],
            service: Array.isArray(payload.service) ? payload.service : [],
            log: Array.isArray(payload.log) ? payload.log : [],
          };
          const merged = ffMerge3(_lastServerState, localNow, serverState);
          const mergedBody = Object.assign({}, payload, {
            queue: merged.queue,
            service: merged.service,
            log: merged.log,
          });
          ffQueueTrace("write:history-ahead-merge", { localLogLen, cloudLogLen });
          console.warn("[QueueCloud] cloud history ahead — merging local intent (was: blocked)", {
            salonId: _salonId,
            locationId: _locationId || QUEUE_STATE_DEFAULT,
            reason,
            localLogLen,
            cloudLogLen,
          });
          return writeAt(mergedBody, serverRev).catch((e2) => {
            if (isPermissionDenied(e2)) return commit();
            console.warn("[QueueCloud] history-ahead merged write failed", e2);
            return queueWriteResult(false, "history-ahead-merge-failed", { error: queueErrorMessage(e2) });
          });
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
    {
      const sq = Array.isArray(emptyData.queue) ? emptyData.queue : [];
      const ss = Array.isArray(emptyData.service) ? emptyData.service : [];
      const sl = Array.isArray(emptyData.log) ? emptyData.log : [];
      setLastServerState(sq, ss, sl);
      forceApplyCloudState(sq, ss, sl, { force: true, reason: "empty-overwrite-blocked" });
    }
    return queueWriteResult(false, "empty-overwrite-blocked", { localCounts, cloudCounts });
  }).catch((e) => {
    console.warn("[QueueCloud] empty write guard failed; skipping risky write", e);
    return queueWriteResult(false, "empty-guard-read-failed", { error: queueErrorMessage(e) });
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
        subscribe(sid, loc, { reason: "connect" });
        console.log("[QueueCloud] Subscribed to salon", sid, "location", loc || "(default)");
      } else if (!sid) {
        _salonId = null;
        _locationId = null;
        _subscribedDocId = null;
        _subscriptionSeq++;
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
  // Capture the state SYNCHRONOUSLY, at the moment the user acted. The write
  // chain may run this write seconds later (previous write still merging); by
  // then the on-screen state can have been replaced by a cloud apply, and
  // reading _getState() at that point would write the WRONG (reverted) state —
  // the device itself then pushed its own move-undo to the cloud.
  const captured = captureQueueIntent();
  _pendingWrites++;
  writeQueueDiag("save-queued", {
    q: captured ? captured.queue.length : -1,
    s: captured ? captured.service.length : -1,
  });
  // Race against a timeout so one hung Firestore call can never silently jam
  // the write chain forever (every later queue action would then be dropped).
  const step = () => Promise.race([
    writeState(captured),
    new Promise((resolve) => setTimeout(
      () => resolve(queueWriteResult(false, "write-timeout")), 20000)),
  ]);
  _writeChain = _writeChain
    .catch(() => {})
    .then(step)
    .then((result) => {
      const r = result && typeof result === "object" && "ok" in result
        ? result
        : queueWriteResult(true, "ok");
      _pendingWrites = Math.max(0, _pendingWrites - 1);
      writeQueueDiag("write-settled", { ok: r.ok === true, reason: r.reason || null });
      return r;
    });
  return _writeChain;
}

/** Deep-frozen snapshot of the app state at call time (user intent). */
function captureQueueIntent() {
  if (!_getState) return null;
  try {
    const st = _getState();
    if (!st) return null;
    return JSON.parse(JSON.stringify({
      queue: Array.isArray(st.queue) ? st.queue : [],
      service: Array.isArray(st.service) ? st.service : [],
      log: Array.isArray(st.log) ? st.log : [],
    }));
  } catch (e) {
    console.warn("[QueueCloud] captureQueueIntent failed", e);
    return null;
  }
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
    if (sid) subscribe(sid, loc, { reason: "reconnect" });
    else {
      _salonId = null;
      _locationId = null;
      _subscribedDocId = null;
      _subscriptionSeq++;
    }
  });
}

/** Fetch current state from server (bypass cache) and apply so other computer sees updates. */
export function queueCloudRefresh() {
  if (!_salonId || !_applyState) return Promise.resolve();
  // Respect cooldown from local writes. Must be AT LEAST as long as the
  // recent-local-write UI protection: this poll runs every 2s and used to
  // force-apply the server state ~6s after a move, before the cloud write
  // round-tripped — the Available→In Service jump-back.
  if (hasRecentLocalQueueWrite()) return Promise.resolve();
  const expectedSalonId = _salonId;
  const expectedDocId = queueStateDocIdFor(_locationId);
  const expectedSeq = _subscriptionSeq;
  if (!queueCloudScopeStillCurrent(expectedSalonId, expectedDocId, expectedSeq)) {
    return Promise.resolve(queueWriteResult(false, "stale-refresh-scope"));
  }
  const ref = queueStateRef(_salonId, _locationId);
  return getDocFromServer(ref).then((snap) => {
    if (!queueCloudScopeStillCurrent(expectedSalonId, expectedDocId, expectedSeq)) {
      console.warn("[QueueCloud] ignored stale refresh", {
        expectedSalonId,
        currentSalonId: _salonId,
        expectedDocId,
        currentDocId: _subscribedDocId,
      });
      return;
    }
    if (snap.exists()) {
      const data = snap.data();
      const queue = Array.isArray(data.queue) ? data.queue : [];
      const service = Array.isArray(data.service) ? data.service : [];
      const log = Array.isArray(data.log) ? data.log : [];
      const prevRev = _lastCloudRev;
      _lastCloudRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : _lastCloudRev;
      if (_lastCloudRev !== prevRev) {
        ffQueueTrace("refresh:new-rev", { from: prevRev, to: _lastCloudRev, q: queue.length, s: service.length });
      }
      _lastCloudLogLen = log.length;
      setLastServerState(queue, service, log);
      // Protected apply: never clobber the on-screen queue during a fresh local
      // save (the direct _applyState here bypassed that guard).
      forceApplyCloudState(queue, service, log, { force: true, reason: "cloud-refresh" });
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
