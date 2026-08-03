/**
 * Time Clock – Entries Cloud
 * ==========================
 *
 * Data model for ACTUAL worked time. This is the source of truth for
 * timesheets and (eventually) payroll. It is intentionally decoupled from
 * the schedule: an entry does NOT need a corresponding shift, and shifts
 * are NEVER queried to compute worked hours.
 *
 * --------------------------------------------------------------------
 *  Firestore path
 * --------------------------------------------------------------------
 *   salons/{salonId}/timeEntries/{entryId}
 *
 *   Why flat under the salon (and not under location or staff)?
 *   - Weekly overtime is a workweek-level concept. The engine will aggregate
 *     one staff member's hours across ALL locations in a week. A flat
 *     salon-scoped collection lets that be a single query:
 *       where staffId == X
 *       and   clockInAt >= weekStart
 *       and   clockInAt <  weekEnd
 *   - Scoping queries to one location is still trivial via
 *       where locationId == Y
 *   - Mirrors how `staff` is stored (salon-level, not location-level), and
 *     therefore security rules and indexes stay simple.
 *
 * --------------------------------------------------------------------
 *  Document shape
 * --------------------------------------------------------------------
 *   {
 *     // ── Context ─────────────────────────────────────────────────────
 *     salonId:    string,                 // denormalized for future exports
 *     locationId: string,                 // which branch the work happened at
 *     staffId:    string,                 // ffStaff / salons/.../staff id
 *
 *     // ── Time window ─────────────────────────────────────────────────
 *     clockInAt:  Timestamp,              // required, when work started
 *     clockOutAt: Timestamp | null,       // null while status === "open"
 *
 *     // ── State machine ───────────────────────────────────────────────
 *     status: "open" | "closed" | "void",
 *             // open   → still clocked in; no clockOutAt yet
 *             // closed → finished; clockOutAt set; durationMinutes set
 *             // void   → admin invalidated the entry (will not count toward payroll)
 *
 *     // ── Schedule linkage (decoupled snapshot) ──────────────────────
 *     linkedShiftId: string | null,
 *             // OPAQUE reference. Stored as a plain string, never enforced
 *             // to exist, never used as a Firestore reference / lookup.
 *             // Safe to leave dangling when a shift is later edited or deleted.
 *     scheduled: boolean,
 *             // Snapshot taken at clock-in: did a planned shift exist for
 *             // this staff member today? Never recomputed from live data.
 *             // If scheduling data later changes, this boolean does NOT.
 *
 *     // ── Metadata (future-friendly, optional today) ─────────────────
 *     source: "manual" | "kiosk" | "admin" | "auto",
 *             // who created it; default "manual" for now
 *     notes:  string | null,
 *             // free-text for admin corrections / comments
 *     durationMinutes: number | null,
 *             // populated when clockOutAt is written, to avoid recomputing
 *             // from Timestamps on every read
 *
 *     // ── Audit ───────────────────────────────────────────────────────
 *     createdAt: serverTimestamp,
 *     createdBy: string | null,           // Firebase Auth uid of creator
 *     updatedAt: serverTimestamp,
 *     updatedBy: string | null,
 *   }
 *
 * --------------------------------------------------------------------
 *  Why the schedule cannot be the source of truth
 * --------------------------------------------------------------------
 *   A staff member might be called in without being scheduled, or a
 *   scheduled shift might be skipped. Time Clock must reflect what
 *   actually happened. We therefore:
 *   - Store clockInAt / clockOutAt as Firestore Timestamps independent of
 *     any shift record.
 *   - Keep `linkedShiftId` as an OPTIONAL opaque string — useful for
 *     analytics ("how often are staff clocking in without being scheduled?")
 *     but never required for payroll math.
 *   - Keep `scheduled` as a boolean SNAPSHOT, so that editing or deleting
 *     the linked shift later does not retroactively change payroll.
 *
 *  In the future we can populate `linkedShiftId` at clock-in time by
 *  looking up whether the staff member has a shift on the same day, but
 *  that lookup is ONLY used to fill these two snapshot fields and never
 *  to drive hours calculations.
 * --------------------------------------------------------------------
 *
 * SECURITY MODEL (Time Clock Stage A)
 * -----------------------------------
 * All WRITES go through trusted Cloud Functions — the client never writes
 * timeEntries directly anymore:
 *   - timeClockPunch       : clock in / clock out. The target staffId is
 *                            derived SERVER-SIDE (own profile, or kiosk PIN
 *                            verified in-function, or audited manager
 *                            override). Geofence is enforced server-side.
 *   - timeClockManageEntry : Manage Time Cards add / edit / void, manager
 *                            rights verified server-side, before/after audit.
 * The exported function names and return shapes are preserved so existing
 * UI call sites keep working. READ helpers below still query Firestore
 * directly (read rules are unchanged).
 *
 * PIN SAFETY: a kiosk PIN passed via input.pin is forwarded to the callable
 * and never logged, never persisted, never included in error messages.
 */

import { doc, getDoc, collection, query, where, getDocs, orderBy, limit, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";

// ───────────────────────── salon id resolution ─────────────────────────
// Mirrors the multi-salon modules: the selected membership/session salon is
// the source of truth. users/{uid}.salonId is a legacy fallback only.
async function _ffGetSalonIdForTimeEntries() {
  try {
    if (typeof window !== "undefined" && window.currentSalonId) {
      return String(window.currentSalonId).trim() || null;
    }
  } catch (_) {}
  try {
    const user = auth && auth.currentUser;
    if (user) {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data && data.salonId) return String(data.salonId);
      }
    }
  } catch (e) {
    console.warn("[TimeClockEntries] _ffGetSalonIdForTimeEntries (user lookup) failed", e);
  }
  return null;
}

/**
 * Collection reference for time entries belonging to a salon.
 * Callers who already have a salonId (e.g. background workers) can skip
 * the user lookup by passing it in directly.
 */
export function timeEntriesCollectionRef(salonId) {
  if (!salonId || typeof salonId !== "string") {
    throw new Error("timeEntriesCollectionRef: salonId is required");
  }
  return collection(db, `salons/${salonId}/timeEntries`);
}

// ─────────────────────── callable plumbing ───────────────────────────
// Same pattern as staff-writeups-formal-cloud.js callWriteupFn: v2 onCall
// via the standard httpsCallable protocol, region-pinned us-central1.
async function _ffCallTimeClockFn(name, payload) {
  const { getFunctions, httpsCallable } = await import(
    "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js"
  );
  const fn = httpsCallable(getFunctions(undefined, "us-central1"), name);
  const res = await fn(payload);
  return res && res.data ? res.data : {};
}

function _ffIsKioskSession() {
  try {
    return !!(typeof window !== "undefined" && window.__ff_kiosk_claims);
  } catch (_) {
    return false;
  }
}

// Same stable per-browser id the push registration uses — one identity for
// the device across features (salons/.../staffDeviceTokens and punches).
const _FF_TC_DEVICE_ID_KEY = "ff_push_device_id_v1";
function _ffTimeClockDeviceId() {
  try {
    let id = localStorage.getItem(_FF_TC_DEVICE_ID_KEY);
    if (!id) {
      id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(_FF_TC_DEVICE_ID_KEY, id);
    }
    return id;
  } catch (_) {
    return null;
  }
}

function _ffTimeClockPlatform() {
  try {
    const p = window.Capacitor && typeof window.Capacitor.getPlatform === "function"
      ? String(window.Capacitor.getPlatform())
      : "web";
    return (p === "ios" || p === "android") ? p : "web";
  } catch (_) {
    return "web";
  }
}

// ─────────────────────── kiosk punch photo (Stage B) ───────────────────────

/**
 * Photo fields for a kiosk punch payload. Only attached on kiosk sessions
 * AND only when the UI actually attempted a capture (photo or photoError
 * present) — otherwise the payload stays field-free, which the server
 * treats as a photo-exempt legacy punch. photoOverride carries the quick
 * manager approval (manager PIN + reason); like the employee PIN it is
 * forwarded as-is, never logged and never persisted.
 */
function _ffKioskPhotoFields(input) {
  if (!_ffIsKioskSession()) return {};
  const out = {};
  if (typeof input.photo === "string" && input.photo) out.photo = input.photo;
  else if (typeof input.photoError === "string" && input.photoError) out.photoError = input.photoError.slice(0, 200);
  if (input.photoOverride && typeof input.photoOverride === "object" && input.photoOverride.managerPin) {
    out.photoOverride = {
      managerPin: String(input.photoOverride.managerPin),
      reason: String(input.photoOverride.reason || ""),
    };
  }
  return out;
}

/**
 * Kiosk photo policy from salons/{salonId}/settings/timeClock — the same doc
 * + explicit-true rule the timeClockPunch callable reads. Cached for 5
 * minutes so the PIN pad render doesn't hammer Firestore.
 */
let _ffKioskPhotoPolicyCache = null; // { at, salonId, policy }
export async function ffGetKioskPhotoPolicy(salonIdArg) {
  const fallback = { enabled: false, onFailure: "fallback" };
  try {
    const salonId = (typeof salonIdArg === "string" && salonIdArg.trim())
      ? salonIdArg.trim()
      : await _ffGetSalonIdForTimeEntries();
    if (!salonId) return fallback;
    const c = _ffKioskPhotoPolicyCache;
    if (c && c.salonId === salonId && Date.now() - c.at < 5 * 60 * 1000) return c.policy;
    const snap = await getDoc(doc(db, `salons/${salonId}/settings`, "timeClock"));
    const raw = snap.exists() ? (snap.data() || {}).kioskPhoto : null;
    const policy = {
      enabled: !!(raw && typeof raw === "object" && raw.enabled === true),
      onFailure: raw && raw.onFailure === "block" ? "block" : "fallback",
    };
    _ffKioskPhotoPolicyCache = { at: Date.now(), salonId, policy };
    return policy;
  } catch (e) {
    console.warn("[TimeClockEntries] ffGetKioskPhotoPolicy failed", e);
    return fallback;
  }
}

/**
 * Download URL for a punch photo (Manage Time Cards viewer). Storage rules
 * restrict reads to owner/admin/time_clock_manage, so this only resolves for
 * managers.
 */
export async function ffGetTimeClockPhotoUrl(path) {
  if (typeof path !== "string" || !path.startsWith("timeClockPhotos/")) {
    throw new Error("ffGetTimeClockPhotoUrl: invalid path");
  }
  const { ref, getDownloadURL } = await import(
    "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js"
  );
  const { storage } = await import("/app.js?v=20260610_force_lp_ios");
  return getDownloadURL(ref(storage, path));
}

/**
 * Capture a fresh GPS fix for the punch, without nagging for the
 * geolocation permission when it isn't needed:
 *   - fence enforced for this branch → always attempt (the PIN gate already
 *     prompted, and the server will reject the punch without coords);
 *   - fence off/unknown → only capture silently when permission is already
 *     granted (pure forensics, never a prompt).
 * Errors never block here — the SERVER decides whether coords are required.
 */
async function _ffTimeClockCaptureCoords() {
  try {
    let fenceActive = null;
    try {
      if (typeof window.isTimeClockGeoFenceActive === "function") {
        fenceActive = window.isTimeClockGeoFenceActive() === true;
      }
    } catch (_) {}
    if (fenceActive !== true) {
      try {
        const st = await navigator.permissions.query({ name: "geolocation" });
        if (!st || st.state !== "granted") return null;
      } catch (_) {
        return null;
      }
    }
    if (typeof window.requestCurrentBrowserLocation !== "function") return null;
    const pos = await window.requestCurrentBrowserLocation();
    if (!pos || !isFinite(Number(pos.lat)) || !isFinite(Number(pos.lng))) return null;
    return {
      lat: Number(pos.lat),
      lng: Number(pos.lng),
      accuracy: Math.round(Number(pos.accuracy || 0)),
    };
  } catch (_) {
    return null;
  }
}

// ──────────────────────────── validators ─────────────────────────────
const _FF_VALID_SOURCES = new Set(["manual", "kiosk", "admin", "auto"]);

function _ffCoerceTimestamp(v) {
  if (v == null) return null;
  if (v instanceof Timestamp) return v;
  if (v instanceof Date) {
    return isFinite(v.getTime()) ? Timestamp.fromDate(v) : null;
  }
  if (typeof v === "number" && isFinite(v)) {
    return Timestamp.fromMillis(v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const t = Date.parse(v);
    return isFinite(t) ? Timestamp.fromMillis(t) : null;
  }
  return null;
}

/**
 * Create a new time entry in Firestore.
 *
 * Required:
 *   - staffId    : string
 *   - locationId : string
 *
 * Optional (with sensible defaults):
 *   - clockInAt    : Date | number (ms) | ISO string | Firestore Timestamp.
 *                    Default: server time at write.
 *   - linkedShiftId: string | null. Opaque. Default: null.
 *   - scheduled    : boolean. Snapshot of "was this a scheduled shift?".
 *                    Default: derived from whether linkedShiftId was provided.
 *   - source       : "manual" | "kiosk" | "admin" | "auto". Default: "manual".
 *   - notes        : string | null. Default: null.
 *   - salonId      : string. Default: resolved from the current user.
 *
 * The new entry is always created with:
 *   status: "open", clockOutAt: null, durationMinutes: null.
 * Closing an entry (setting clockOutAt / status / durationMinutes) will be
 * handled by a separate helper in a later stage.
 *
 * Returns: { id, data } where data is exactly what was written (minus the
 * server-resolved timestamps, which come back as placeholders).
 * Throws on validation failure or Firestore error.
 */
export async function ffCreateTimeEntry(input = {}) {
  const staffId = typeof input.staffId === "string" ? input.staffId.trim() : "";
  const locationId = typeof input.locationId === "string" ? input.locationId.trim() : "";
  if (!staffId) throw new Error("ffCreateTimeEntry: staffId is required");
  if (!locationId) throw new Error("ffCreateTimeEntry: locationId is required");

  const salonId = (typeof input.salonId === "string" && input.salonId.trim())
    ? input.salonId.trim()
    : await _ffGetSalonIdForTimeEntries();
  if (!salonId) throw new Error("ffCreateTimeEntry: unable to resolve salonId");

  const notes = (typeof input.notes === "string" && input.notes.trim())
    ? input.notes.trim()
    : null;

  // Manage Time Cards path: admin adds (and any explicit/backdated clockInAt)
  // go through the manager-gated callable, which writes source:"admin" and a
  // before/after audit event. Live punches never pass clockInAt — the server
  // stamps its own time.
  const sourceRaw = typeof input.source === "string" ? input.source.trim().toLowerCase() : "manual";
  const explicitClockIn = _ffCoerceTimestamp(input.clockInAt);
  if (sourceRaw === "admin" || explicitClockIn) {
    const res = await _ffCallTimeClockFn("timeClockManageEntry", {
      op: "add",
      salonId,
      staffId,
      locationId,
      clockInAt: explicitClockIn ? explicitClockIn.toMillis() : Date.now(),
      notes,
    });
    return { id: res.entryId, data: null };
  }

  // Live Clock In. staffId is sent only as expectedStaffId — the server
  // derives the real target (own profile / kiosk PIN) and rejects if it
  // doesn't match what the confirm screen displayed.
  const res = await _ffCallTimeClockFn("timeClockPunch", {
    action: "in",
    salonId,
    locationId,
    coords: await _ffTimeClockCaptureCoords(),
    deviceId: _ffTimeClockDeviceId(),
    platform: _ffTimeClockPlatform(),
    pin: _ffIsKioskSession() && typeof input.pin === "string" ? input.pin : null,
    expectedStaffId: staffId,
    ..._ffKioskPhotoFields(input),
    override: (input.override && typeof input.override === "object" && input.override.staffId)
      ? { staffId: String(input.override.staffId), reason: String(input.override.reason || "") }
      : null,
    notes,
  });
  return { id: res.entryId, data: null };
}

/**
 * Close an open time entry.
 *
 * Required:
 *   - entryId: string (the Firestore doc id under salons/{salonId}/timeEntries)
 *
 * Optional:
 *   - clockOutAt: Date | number (ms) | ISO string | Firestore Timestamp.
 *                 Default: now (client clock). We avoid serverTimestamp()
 *                 here because we need the REAL value to compute the
 *                 duration in this same write — serverTimestamp() is a
 *                 sentinel, not a readable value. A tiny client-clock drift
 *                 is acceptable at this stage; payroll-critical precision
 *                 can switch to a Cloud Function trigger later.
 *   - notes:     string — if provided, replaces the existing notes field.
 *                If omitted, notes are left untouched.
 *   - salonId:   string — override for the resolved salon (mostly for tests).
 *
 * Behavior:
 *   - Reads the entry, verifies it exists.
 *   - Verifies it is still `status: "open"`. Already-closed / voided
 *     entries throw — we never re-close an entry silently.
 *   - Verifies clockOutAt >= clockInAt. Earlier clock-out throws.
 *   - Writes: status="closed", clockOutAt, durationMinutes, updatedAt,
 *     updatedBy. All other fields untouched.
 *
 * Returns: { id, clockOutAt, durationMinutes }
 * Throws:  Error with a distinct message per failure mode so callers / tests
 *          can react precisely.
 *
 * NOTE: Firestore rules currently allow UPDATE only for owner/admin/manager.
 * A regular staff user calling this helper will get a permission-denied
 * error. That is intentional for this stage.
 */
export async function ffCloseTimeEntry(input = {}) {
  const entryId = typeof input.entryId === "string" ? input.entryId.trim() : "";
  if (!entryId) throw new Error("ffCloseTimeEntry: entryId is required");

  const salonId = (typeof input.salonId === "string" && input.salonId.trim())
    ? input.salonId.trim()
    : await _ffGetSalonIdForTimeEntries();
  if (!salonId) throw new Error("ffCloseTimeEntry: unable to resolve salonId");

  // Manage Time Cards path: an explicit clockOutAt is a manager edit
  // (backdated close) and goes through the manager-gated callable with a
  // before/after audit event.
  const explicitClockOut = _ffCoerceTimestamp(input.clockOutAt);
  if (explicitClockOut) {
    const payload = {
      op: "edit",
      salonId,
      entryId,
      clockOutAt: explicitClockOut.toMillis(),
    };
    if (typeof input.notes === "string") payload.notes = input.notes;
    const res = await _ffCallTimeClockFn("timeClockManageEntry", payload);
    return { id: entryId, clockOutAt: explicitClockOut, durationMinutes: null, changed: res.changed !== false };
  }

  // Live Clock Out. The server locates the open entry for the derived staff
  // itself and stamps its own clock-out time; entryId is not trusted. The
  // device binding (same personal device / any salon kiosk / legacy pass) is
  // enforced server-side.
  const res = await _ffCallTimeClockFn("timeClockPunch", {
    action: "out",
    salonId,
    locationId: (typeof input.locationId === "string" && input.locationId.trim()) ? input.locationId.trim() : "default",
    coords: await _ffTimeClockCaptureCoords(),
    deviceId: _ffTimeClockDeviceId(),
    platform: _ffTimeClockPlatform(),
    pin: _ffIsKioskSession() && typeof input.pin === "string" ? input.pin : null,
    expectedStaffId: (typeof input.expectedStaffId === "string" && input.expectedStaffId.trim()) ? input.expectedStaffId.trim() : null,
    ..._ffKioskPhotoFields(input),
    override: (input.override && typeof input.override === "object" && input.override.staffId)
      ? { staffId: String(input.override.staffId), reason: String(input.override.reason || "") }
      : null,
    notes: (typeof input.notes === "string" && input.notes.trim()) ? input.notes.trim() : null,
  });
  return {
    id: res.entryId || entryId,
    clockOutAt: res.clockOutAtMs != null ? Timestamp.fromMillis(res.clockOutAtMs) : null,
    durationMinutes: res.durationMinutes != null ? res.durationMinutes : null,
  };
}

/**
 * Find the currently-open time entry for a staff member, if any.
 *
 * Required:
 *   - staffId: string
 *
 * Optional:
 *   - salonId: string — override for the resolved salon.
 *
 * Returns: the entry as `{ id, ...data }`, or null when none is open.
 *          Never throws on "no matches" or on permission errors — we log
 *          and return null so the UI can render a safe fallback.
 *
 * Query: equality-only on (staffId, status). Firestore does NOT require a
 * composite index for multi-field equality filters, so this runs on the
 * default indexes.
 *
 * We defensively fetch up to 5 matches and pick the most recent by
 * clockInAt on the client. In a healthy system only one entry should ever
 * be "open" at a time for a given staff member, but a past glitch might
 * have left stale open entries — this keeps the UI predictable.
 */
export async function ffGetOpenTimeEntryForStaff(staffId, salonIdOpt) {
  const sid = typeof staffId === "string" ? staffId.trim() : "";
  if (!sid) return null;
  const salonId = (typeof salonIdOpt === "string" && salonIdOpt.trim())
    ? salonIdOpt.trim()
    : await _ffGetSalonIdForTimeEntries();
  if (!salonId) return null;
  try {
    const colRef = timeEntriesCollectionRef(salonId);
    const q = query(
      colRef,
      where("staffId", "==", sid),
      where("status", "==", "open"),
      limit(5)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    let best = null;
    snap.forEach((d) => {
      const data = d.data() || {};
      const ts = (data.clockInAt instanceof Timestamp) ? data.clockInAt.toMillis() : 0;
      if (!best || ts > best.ts) best = { id: d.id, data, ts };
    });
    return best ? Object.assign({ id: best.id }, best.data) : null;
  } catch (e) {
    console.warn("[TimeClockEntries] ffGetOpenTimeEntryForStaff failed", e);
    return null;
  }
}

/**
 * List time entries for the salon, with optional client-side filters.
 *
 * Options:
 *   - locationId : string  — restrict to a single location (optional)
 *   - staffId    : string  — restrict to a single staff member (optional)
 *   - from       : Date|number|string — lower bound for clockInAt (inclusive)
 *   - to         : Date|number|string — upper bound for clockInAt (exclusive)
 *   - statuses   : string[] — defaults to ["open","closed"] (excludes "void")
 *   - salonId    : string  — override for the resolved salon
 *   - maxResults : number  — hard cap on rows returned (default 500)
 *
 * Returns: Array of `{ id, ...data }`, sorted by clockInAt descending.
 *
 * When `from` and/or `to` are set, the query uses Firestore range filters on
 * `clockInAt` so entries inside the period are returned (not "newest 500
 * globally" then clipped). Falls back to the legacy scan if the query fails.
 */
export async function ffListTimeEntriesForSalon(options = {}) {
  const salonId = (typeof options.salonId === "string" && options.salonId.trim())
    ? options.salonId.trim()
    : await _ffGetSalonIdForTimeEntries();
  if (!salonId) return [];

  const wantLoc = typeof options.locationId === "string" ? options.locationId.trim() : "";
  const wantStaff = typeof options.staffId === "string" ? options.staffId.trim() : "";
  const statuses = Array.isArray(options.statuses) && options.statuses.length
    ? options.statuses.map((s) => String(s).trim()).filter(Boolean)
    : ["open", "closed"];

  const fromTs = _ffCoerceTimestamp(options.from);
  const toTs = _ffCoerceTimestamp(options.to);
  const fromMs = fromTs ? fromTs.toMillis() : null;
  const toMs = toTs ? toTs.toMillis() : null;

  const maxResults = (typeof options.maxResults === "number" && options.maxResults > 0)
    ? Math.min(options.maxResults, 2000)
    : 500;

  const colRef = timeEntriesCollectionRef(salonId);
  const mapSnapToRows = (snap) => {
    const rows = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      if (statuses.length && !statuses.includes(String(data.status || ""))) return;
      if (wantLoc && String(data.locationId || "") !== wantLoc) return;
      if (wantStaff && String(data.staffId || "") !== wantStaff) return;
      const ciMs = (data.clockInAt instanceof Timestamp) ? data.clockInAt.toMillis() : 0;
      if (fromMs != null && ciMs < fromMs) return;
      if (toMs != null && ciMs >= toMs) return;
      rows.push(Object.assign({ id: d.id }, data));
    });
    return rows;
  };

  const runQuery = async () => {
    if (fromTs || toTs) {
      const parts = [];
      if (fromTs) parts.push(where("clockInAt", ">=", fromTs));
      if (toTs) parts.push(where("clockInAt", "<", toTs));
      parts.push(orderBy("clockInAt", "desc"));
      parts.push(limit(maxResults));
      return getDocs(query(colRef, ...parts));
    }
    return getDocs(query(colRef, orderBy("clockInAt", "desc"), limit(maxResults)));
  };

  try {
    const snap = await runQuery();
    const rows = mapSnapToRows(snap);
    return rows;
  } catch (e) {
    console.warn("[TimeClockEntries] ffListTimeEntriesForSalon failed", e);
    // Fallback: older clients / index issues — unbounded newest-N scan + in-memory filters.
    try {
      const snap = await getDocs(query(colRef, orderBy("clockInAt", "desc"), limit(maxResults)));
      return mapSnapToRows(snap);
    } catch (e2) {
      console.warn("[TimeClockEntries] ffListTimeEntriesForSalon fallback failed", e2);
      return [];
    }
  }
}

/**
 * Update fields on an existing time entry (admin/manager edit flow).
 *
 * Required:
 *   - entryId: string
 *
 * Optional (any subset):
 *   - clockInAt  : Date | number | ISO string | Timestamp
 *   - clockOutAt : Date | number | ISO string | Timestamp | null
 *                  Passing null explicitly re-opens the entry (status="open",
 *                  clockOutAt=null, durationMinutes=null).
 *   - locationId : string — change the location the entry belongs to
 *   - notes      : string | null — empty string clears notes
 *   - status     : "open" | "closed" | "void"
 *   - salonId    : string — override for the resolved salon
 *
 * Recomputes `durationMinutes` whenever the final clockIn/clockOut pair is
 * known (both sides are real Timestamps and status would be "closed"). If a
 * clockOutAt earlier than clockInAt is requested, the update is rejected.
 *
 * Never touches: createdAt, createdBy, staffId, salonId, scheduled,
 * linkedShiftId, source. Those are set at create-time.
 */
export async function ffUpdateTimeEntry(input = {}) {
  const entryId = typeof input.entryId === "string" ? input.entryId.trim() : "";
  if (!entryId) throw new Error("ffUpdateTimeEntry: entryId is required");

  const salonId = (typeof input.salonId === "string" && input.salonId.trim())
    ? input.salonId.trim()
    : await _ffGetSalonIdForTimeEntries();
  if (!salonId) throw new Error("ffUpdateTimeEntry: unable to resolve salonId");

  // Pure void (soft delete) has its own op for a distinct audit event.
  const statusRaw = typeof input.status === "string" ? input.status.trim().toLowerCase() : null;
  const otherKeys = Object.keys(input).filter((k) => !["entryId", "salonId", "status", "reason"].includes(k));
  if (statusRaw === "void" && otherKeys.length === 0) {
    const res = await _ffCallTimeClockFn("timeClockManageEntry", {
      op: "void",
      salonId,
      entryId,
      reason: typeof input.reason === "string" ? input.reason : null,
    });
    return { id: entryId, changed: res.changed !== false };
  }

  const payload = { op: "edit", salonId, entryId };

  if (Object.prototype.hasOwnProperty.call(input, "clockInAt")) {
    const ts = _ffCoerceTimestamp(input.clockInAt);
    if (!ts) throw new Error("ffUpdateTimeEntry: clockInAt is invalid");
    payload.clockInAt = ts.toMillis();
  }

  if (Object.prototype.hasOwnProperty.call(input, "clockOutAt")) {
    if (input.clockOutAt === null) {
      payload.clockOutAt = null; // explicit null re-opens the entry
    } else {
      const ts = _ffCoerceTimestamp(input.clockOutAt);
      if (!ts) throw new Error("ffUpdateTimeEntry: clockOutAt is invalid");
      payload.clockOutAt = ts.toMillis();
    }
  }

  if (statusRaw) {
    if (!["open", "closed", "void"].includes(statusRaw)) {
      throw new Error(`ffUpdateTimeEntry: invalid status "${input.status}"`);
    }
    payload.status = statusRaw;
  }

  if (typeof input.locationId === "string" && input.locationId.trim()) {
    payload.locationId = input.locationId.trim();
  }

  if (typeof input.notes === "string") {
    payload.notes = input.notes;
  } else if (input.notes === null) {
    payload.notes = null;
  }

  const res = await _ffCallTimeClockFn("timeClockManageEntry", payload);
  return { id: entryId, changed: res.changed !== false };
}

// ───────────────────────────── window exposure ─────────────────────────────
if (typeof window !== "undefined") {
  window.ffCreateTimeEntry = ffCreateTimeEntry;
  window.ffCloseTimeEntry = ffCloseTimeEntry;
  window.ffUpdateTimeEntry = ffUpdateTimeEntry;
  window.ffGetKioskPhotoPolicy = ffGetKioskPhotoPolicy;
  window.ffGetTimeClockPhotoUrl = ffGetTimeClockPhotoUrl;
  window.ffGetOpenTimeEntryForStaff = ffGetOpenTimeEntryForStaff;
  window.ffListTimeEntriesForSalon = ffListTimeEntriesForSalon;
  window.ffTimeEntriesCollectionRef = timeEntriesCollectionRef;
}
