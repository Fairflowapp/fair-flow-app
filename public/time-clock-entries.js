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
 * This file is intentionally narrow: only the CREATE helper is provided
 * in this stage. Close / void / query / subscribe helpers come later.
 *
 * NOTE ON SECURITY RULES
 * ----------------------
 * `firestore.rules` does not yet include a block for
 * `salons/{salonId}/timeEntries/**`. Until that block is added, calls to
 * ffCreateTimeEntry() will fail with `permission-denied`. This file is
 * ready to be tested locally against the Firestore emulator or once
 * rules are authored in a follow-up step.
 */

import { doc, getDoc, addDoc, updateDoc, collection, query, where, getDocs, orderBy, limit, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "./app.js?v=20260412_salon_owner_uid";

// ───────────────────────── salon id resolution ─────────────────────────
// Mirrors settings-cloud.js so both modules agree on how to find the salon
// when called from anywhere in the app.
async function _ffGetSalonIdForTimeEntries() {
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
  try {
    if (typeof window !== "undefined" && window.currentSalonId) {
      return String(window.currentSalonId);
    }
  } catch (_) {}
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

  const clockInAtCoerced = _ffCoerceTimestamp(input.clockInAt);
  const clockInAt = clockInAtCoerced || serverTimestamp();

  let linkedShiftId = null;
  if (typeof input.linkedShiftId === "string" && input.linkedShiftId.trim()) {
    linkedShiftId = input.linkedShiftId.trim();
  }

  // If the caller didn't set `scheduled` explicitly, infer it from
  // whether we have a linked shift — a reasonable default.
  const scheduled = (input.scheduled === true)
    ? true
    : (input.scheduled === false ? false : !!linkedShiftId);

  const sourceRaw = typeof input.source === "string" ? input.source.trim().toLowerCase() : "manual";
  const source = _FF_VALID_SOURCES.has(sourceRaw) ? sourceRaw : "manual";

  const notes = (typeof input.notes === "string" && input.notes.trim())
    ? input.notes.trim()
    : null;

  const uid = (auth && auth.currentUser && auth.currentUser.uid) || null;

  const payload = {
    // context
    salonId,
    locationId,
    staffId,
    // time window
    clockInAt,
    clockOutAt: null,
    // state
    status: "open",
    // schedule linkage (snapshot — never live)
    linkedShiftId,
    scheduled,
    // metadata
    source,
    notes,
    durationMinutes: null,
    // audit
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };

  const colRef = timeEntriesCollectionRef(salonId);
  const docRef = await addDoc(colRef, payload);
  return { id: docRef.id, data: payload };
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

  const entryRef = doc(db, `salons/${salonId}/timeEntries/${entryId}`);
  const snap = await getDoc(entryRef);
  if (!snap.exists()) {
    throw new Error(`ffCloseTimeEntry: entry not found (id=${entryId})`);
  }
  const data = snap.data() || {};

  if (data.status !== "open") {
    throw new Error(
      `ffCloseTimeEntry: entry is not open (current status="${data.status}")`
    );
  }

  const clockInTs = (data.clockInAt instanceof Timestamp) ? data.clockInAt : null;
  if (!clockInTs) {
    // clockInAt may legitimately be a pending serverTimestamp if this is
    // called immediately after create — re-reading before updating is the
    // safe path, but we still need a real value. If missing, we refuse.
    throw new Error("ffCloseTimeEntry: entry has no clockInAt timestamp yet");
  }

  // Resolve clockOutAt. Default to client-side "now" so durationMinutes can
  // be computed synchronously in the same update.
  let clockOutTs = _ffCoerceTimestamp(input.clockOutAt);
  if (!clockOutTs) clockOutTs = Timestamp.now();

  const clockInMs = clockInTs.toMillis();
  const clockOutMs = clockOutTs.toMillis();
  if (clockOutMs < clockInMs) {
    throw new Error(
      "ffCloseTimeEntry: clockOutAt is earlier than clockInAt — refusing to close"
    );
  }

  // durationMinutes is a plain number; rounded to the nearest minute so UI
  // totals stay tidy and payroll reads are trivial. Precision of seconds
  // is preserved in the Timestamps themselves for any future re-compute.
  const durationMinutes = Math.round((clockOutMs - clockInMs) / 60000);

  const uid = (auth && auth.currentUser && auth.currentUser.uid) || null;

  const patch = {
    status: "closed",
    clockOutAt: clockOutTs,
    durationMinutes,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };
  if (typeof input.notes === "string") {
    // Only touch notes when explicitly provided. Empty string clears notes.
    patch.notes = input.notes.trim() ? input.notes.trim() : null;
  }

  await updateDoc(entryRef, patch);

  return { id: entryId, clockOutAt: clockOutTs, durationMinutes };
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
 * Rationale for doing the bounds filter client-side: the callers we have
 * today already load locations + staff in memory and filter on them, and the
 * full time-entries collection is expected to stay small (< few thousand
 * docs per salon per year). A single `orderBy(clockInAt)` query keeps the
 * index requirements minimal. If volume grows, this can be swapped for a
 * `where("clockInAt", ">=", from)` compound query without changing callers.
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

  try {
    const colRef = timeEntriesCollectionRef(salonId);
    // orderBy(clockInAt, desc) so newest first. No `where` so we avoid needing
    // a composite index while the collection stays small.
    const q = query(colRef, orderBy("clockInAt", "desc"), limit(maxResults));
    const snap = await getDocs(q);
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
  } catch (e) {
    console.warn("[TimeClockEntries] ffListTimeEntriesForSalon failed", e);
    return [];
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

  const entryRef = doc(db, `salons/${salonId}/timeEntries/${entryId}`);
  const snap = await getDoc(entryRef);
  if (!snap.exists()) {
    throw new Error(`ffUpdateTimeEntry: entry not found (id=${entryId})`);
  }
  const current = snap.data() || {};

  const patch = {};

  // clockInAt
  let finalClockIn = (current.clockInAt instanceof Timestamp) ? current.clockInAt : null;
  if (Object.prototype.hasOwnProperty.call(input, "clockInAt")) {
    const ts = _ffCoerceTimestamp(input.clockInAt);
    if (!ts) throw new Error("ffUpdateTimeEntry: clockInAt is invalid");
    patch.clockInAt = ts;
    finalClockIn = ts;
  }

  // clockOutAt (null allowed to re-open)
  let finalClockOut = (current.clockOutAt instanceof Timestamp) ? current.clockOutAt : null;
  let reopen = false;
  if (Object.prototype.hasOwnProperty.call(input, "clockOutAt")) {
    if (input.clockOutAt === null) {
      patch.clockOutAt = null;
      finalClockOut = null;
      reopen = true;
    } else {
      const ts = _ffCoerceTimestamp(input.clockOutAt);
      if (!ts) throw new Error("ffUpdateTimeEntry: clockOutAt is invalid");
      patch.clockOutAt = ts;
      finalClockOut = ts;
    }
  }

  if (finalClockIn && finalClockOut && finalClockOut.toMillis() < finalClockIn.toMillis()) {
    throw new Error(
      "ffUpdateTimeEntry: clockOutAt is earlier than clockInAt — refusing to save"
    );
  }

  // status
  if (typeof input.status === "string") {
    const s = input.status.trim().toLowerCase();
    if (!["open", "closed", "void"].includes(s)) {
      throw new Error(`ffUpdateTimeEntry: invalid status "${input.status}"`);
    }
    patch.status = s;
  } else if (reopen) {
    patch.status = "open";
  } else if (finalClockOut && current.status !== "void") {
    // If we're providing a real clock-out and the caller didn't override
    // status, transitioning to closed is the expected behavior.
    patch.status = "closed";
  }

  // durationMinutes: recompute based on the final pair (or null when reopen)
  if (patch.clockInAt !== undefined || patch.clockOutAt !== undefined || patch.status !== undefined) {
    if (finalClockIn && finalClockOut && (patch.status || current.status) === "closed") {
      patch.durationMinutes = Math.round((finalClockOut.toMillis() - finalClockIn.toMillis()) / 60000);
    } else if (reopen || (patch.status === "open")) {
      patch.durationMinutes = null;
    }
  }

  // locationId
  if (typeof input.locationId === "string" && input.locationId.trim()) {
    patch.locationId = input.locationId.trim();
  }

  // notes (empty string explicitly clears)
  if (typeof input.notes === "string") {
    patch.notes = input.notes.trim() ? input.notes.trim() : null;
  } else if (input.notes === null) {
    patch.notes = null;
  }

  if (Object.keys(patch).length === 0) {
    // Nothing to change; treat as a no-op success.
    return { id: entryId, changed: false };
  }

  const uid = (auth && auth.currentUser && auth.currentUser.uid) || null;
  patch.updatedAt = serverTimestamp();
  patch.updatedBy = uid;

  await updateDoc(entryRef, patch);
  return { id: entryId, changed: true, patch };
}

// ───────────────────────────── window exposure ─────────────────────────────
if (typeof window !== "undefined") {
  window.ffCreateTimeEntry = ffCreateTimeEntry;
  window.ffCloseTimeEntry = ffCloseTimeEntry;
  window.ffUpdateTimeEntry = ffUpdateTimeEntry;
  window.ffGetOpenTimeEntryForStaff = ffGetOpenTimeEntryForStaff;
  window.ffListTimeEntriesForSalon = ffListTimeEntriesForSalon;
  window.ffTimeEntriesCollectionRef = timeEntriesCollectionRef;
}
