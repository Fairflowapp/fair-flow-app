/**
 * Time Clock — trusted server-side punch + manage (Stage A).
 *
 * Exports (wired in index.js):
 *   timeClockPunch        — Clock In / Clock Out. The target staffId is NEVER
 *                           taken from the client:
 *                             - regular session → derived from the caller's
 *                               own linked staff profile (self-punch only);
 *                             - kiosk session (custom-token claims) → resolved
 *                               from a PIN that is verified HERE, server-side;
 *                             - manager override → explicit staffId allowed,
 *                               but only for managers and with a mandatory
 *                               reason, recorded in the audit trail.
 *   timeClockManageEntry  — Manage Time Cards (add / edit / void). Requires
 *                           manager rights (or the time_clock_manage staff
 *                           permission) verified server-side. Every change is
 *                           appended to the entry's auditEvents subcollection
 *                           with before/after values.
 *
 * Data written to salons/{salonId}/timeEntries/{entryId} keeps the existing
 * client shape (see public/time-clock-entries.js) and adds punch forensics:
 * device id, platform, ip, geo (+accuracy), kioskId, source, override reason.
 *
 * Audit trail: salons/{salonId}/timeEntries/{entryId}/auditEvents/{eventId}
 * follows the writeups auditEvents pattern (deterministic event IDs so
 * retries never duplicate entries; Admin-SDK-only writes).
 *
 * Geofence: mirrors the client gate (public/index.html
 * verifyTimeClockGeoFence). Settings live in the per-branch queueState doc:
 *   salons/{salonId}/queueState/{locKey}.queueSettings[locKey].settings.queueGeoFence
 * Active when enforceTimeClock === true and a lat/lng is saved. Bypassed for
 * owner staff rows and permissions.time_clock_bypass_location === true.
 * Constants match the client: accuracy limit 150m, default radius 100m.
 *
 * PIN safety: the kiosk PIN is verified in-memory only. It is never written
 * to Firestore, never included in thrown errors, and never passed to
 * console.* — keep it that way when editing this file.
 *
 * Rate limiting: consecutive failed PIN attempts per kiosk are throttled via
 * salons/{salonId}/kioskPinThrottle/{kioskId} (server-only doc; no client
 * rules exist for it, so default-deny applies). 5 consecutive failures within
 * 10 minutes → locked for 5 minutes.
 *
 * Photo capture (Stage B, kiosk punches only): the kiosk sends one JPEG frame
 * as base64 with the punch. It is uploaded HERE via the Admin SDK to
 *   timeClockPhotos/{salonId}/{entryId}/{in|out}-{ts}.jpg
 * BEFORE the entry is written (clients have no Storage write access to that
 * path at all — see storage.rules). Policy lives in
 * salons/{salonId}/settings/timeClock.kioskPhoto:
 *   { enabled: boolean (explicit true required), onFailure: "fallback"|"block" }
 * On capture/upload failure: "fallback" records the punch with a
 * photoIn/OutFailed flag + a push alert to managers; "block" rejects with
 * reason "photo_required" unless a photoOverride (manager PIN + mandatory
 * reason, verified here) accompanies the retry. Legacy kiosk clients that
 * send no photo* fields are exempt so stale devices keep punching during
 * rollout. Photos are purged after 90 days by timeClockPhotosPurgeDaily;
 * time entries themselves are never deleted by the purge.
 *
 * Schedule enforcement helpers live in ./time-clock-schedule.js (S0). Punch
 * wiring for early clock-in / lateClockOutFlag follows in S1–S2.
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

// v2 callables (same reason as writeups.js): v1 function IAM cannot be opened
// to callable clients under the org policy.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");

const REGION = "us-central1";

// Mirrors public/index.html getQueueGeoFenceActionAccuracyLimitMeters().
const ACCURACY_LIMIT_METERS = 150;
// Mirrors public/navigation-helpers.js sanitizeQueueGeoFenceRadius() default.
const DEFAULT_RADIUS_METERS = 100;

// PIN throttle policy (per kiosk device).
const PIN_MAX_FAILURES = 5;
const PIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const PIN_LOCK_MS = 5 * 60 * 1000;

// Kiosk photo capture (Stage B).
const PHOTO_MAX_BYTES = 1.5 * 1024 * 1024; // decoded JPEG; kiosk sends ~640px ≈ 50-120KB
const PHOTO_ERROR_MAX_CHARS = 200; // client-reported failure text is capped + sanitized
const PHOTO_OVERRIDE_REASON_MAX_CHARS = 500;
const PHOTO_RETENTION_DAYS = 90;
const PHOTO_STORAGE_PREFIX = "timeClockPhotos/";

const VALID_PLATFORMS = new Set(["web", "ios", "android"]);

function db() {
  return admin.firestore();
}

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

function serverNow() {
  return admin.firestore.FieldValue.serverTimestamp();
}

/** Coerce ms-number / ISO string / Timestamp-shaped input to a Timestamp. */
function coerceTs(v) {
  if (v == null) return null;
  if (v instanceof admin.firestore.Timestamp) return v;
  if (typeof v === "number" && isFinite(v)) {
    return admin.firestore.Timestamp.fromMillis(v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const t = Date.parse(v);
    return isFinite(t) ? admin.firestore.Timestamp.fromMillis(t) : null;
  }
  // Serialized {seconds,nanoseconds} (httpsCallable JSON round-trip).
  if (typeof v === "object" && typeof v.seconds === "number") {
    return new admin.firestore.Timestamp(v.seconds, Number(v.nanoseconds) || 0);
  }
  return null;
}

function tsToMillisOrNull(v) {
  return v instanceof admin.firestore.Timestamp ? v.toMillis() : null;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** First client IP from the callable's raw request (best effort). */
function extractIp(rawRequest) {
  try {
    if (!rawRequest) return null;
    const fwd = trimStr(rawRequest.headers && rawRequest.headers["x-forwarded-for"]);
    if (fwd) return fwd.split(",")[0].trim() || null;
    return trimStr(rawRequest.ip) || null;
  } catch (_) {
    return null;
  }
}

function sanitizeCoords(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const accuracy = Number(raw.accuracy);
  if (!isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!isFinite(lng) || lng < -180 || lng > 180) return null;
  return {
    lat,
    lng,
    accuracy: isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null,
  };
}

function sanitizeDeviceId(raw) {
  const v = trimStr(raw);
  if (!v) return null;
  return v.slice(0, 128);
}

function sanitizePlatform(raw) {
  const v = trimStr(raw).toLowerCase();
  return VALID_PLATFORMS.has(v) ? v : null;
}

function sanitizeNotes(raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v ? v.slice(0, 2000) : null;
}

/** Mirrors public/index.html staffIsOwnerRow(): owner rows bypass gates. */
function staffRowIsOwner(staffData) {
  if (!staffData || typeof staffData !== "object") return false;
  return staffData.isOwner === true ||
    trimStr(staffData.role).toLowerCase() === "owner";
}

// ---------------------------------------------------------------------------
// Audit (writeups appendAuditEvent pattern — deterministic IDs, server time)
// ---------------------------------------------------------------------------

async function appendAuditEvent(entryRef, eventId, payload) {
  await entryRef
    .collection("auditEvents")
    .doc(eventId)
    .set(
      {
        ...payload,
        createdAt: serverNow(),
      },
      { merge: true },
    );
}

// ---------------------------------------------------------------------------
// Caller identity
// ---------------------------------------------------------------------------

/**
 * Classify the caller from the decoded token.
 *   kiosk → { kind:"kiosk", salonId, kioskId }  (custom-token claims minted
 *            by onPairingApproved; the auth identity is the DEVICE)
 *   user  → { kind:"user", uid }                (a person's session)
 */
function classifyCaller(auth) {
  if (!auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const token = auth.token || {};
  if (token.isKiosk === true) {
    const salonId = trimStr(token.salonId);
    const kioskId = trimStr(token.kioskId);
    if (!salonId || !kioskId) {
      throw new HttpsError("permission-denied", "Kiosk token is missing salon/kiosk claims.");
    }
    return { kind: "kiosk", salonId, kioskId, uid: auth.uid };
  }
  return { kind: "user", uid: auth.uid, token };
}

/**
 * Verify the signed-in user belongs to this salon. Mirrors the membership
 * shapes used across the app (users/{uid}.salonId legacy field, salon
 * members doc, user memberships doc). Returns the loaded docs for reuse.
 */
async function assertUserBelongsToSalon(uid, salonId) {
  const [userSnap, memberSnap, membershipSnap, salonSnap] = await Promise.all([
    db().doc(`users/${uid}`).get(),
    db().doc(`salons/${salonId}/members/${uid}`).get(),
    db().doc(`users/${uid}/memberships/${salonId}`).get(),
    db().doc(`salons/${salonId}`).get(),
  ]);
  if (!salonSnap.exists) throw new HttpsError("not-found", "Salon not found.");
  const u = userSnap.exists ? userSnap.data() || {} : {};
  const isOwnerUid = salonSnap.get("ownerUid") === uid;
  const belongs =
    isOwnerUid ||
    trimStr(u.salonId) === salonId ||
    memberSnap.exists ||
    membershipSnap.exists;
  if (!belongs) {
    throw new HttpsError("permission-denied", "You are not a member of this salon.");
  }
  return { userSnap, memberSnap, membershipSnap, salonSnap, isOwnerUid };
}

/**
 * Resolve the caller's OWN staff profile in this salon. Mirrors
 * writeups.js assertIsThisEmployee() sources, in reverse (uid → staffId):
 * users/{uid}.staffId, members doc, memberships doc, then a staff-row link
 * by uid or verified token email.
 */
async function resolveOwnStaffId(uid, token, salonId, membership) {
  const u = membership.userSnap.exists ? membership.userSnap.data() || {} : {};
  let staffId = trimStr(u.staffId);
  if (staffId) return staffId;
  if (membership.memberSnap.exists) {
    staffId = trimStr((membership.memberSnap.data() || {}).staffId);
    if (staffId) return staffId;
  }
  if (membership.membershipSnap.exists) {
    staffId = trimStr((membership.membershipSnap.data() || {}).staffId);
    if (staffId) return staffId;
  }
  const staffCol = db().collection(`salons/${salonId}/staff`);
  const byUid = await staffCol.where("uid", "==", uid).limit(1).get();
  if (!byUid.empty) return byUid.docs[0].id;
  const tokenEmail = trimStr(token && token.email).toLowerCase();
  if (tokenEmail) {
    const byEmail = await staffCol.where("email", "==", tokenEmail).limit(1).get();
    if (!byEmail.empty) return byEmail.docs[0].id;
  }
  return null;
}

/**
 * Manager rights for Time Clock: owner/admin/manager role (users doc, salon
 * ownerUid, or members doc), OR the caller's own staff row has the
 * time_clock_manage permission. This is the server-side counterpart of the
 * client's _ffTCCurrentUserCanManage() UI gate.
 */
async function callerCanManageTimeClock(uid, token, salonId, membership) {
  if (membership.isOwnerUid) return true;
  const u = membership.userSnap.exists ? membership.userSnap.data() || {} : {};
  const userRole = trimStr(u.role).toLowerCase();
  if (trimStr(u.salonId) === salonId &&
      ["owner", "admin", "manager"].includes(userRole)) {
    return true;
  }
  if (membership.memberSnap.exists) {
    const memberRole = trimStr((membership.memberSnap.data() || {}).role).toLowerCase();
    if (["owner", "admin", "manager"].includes(memberRole)) return true;
  }
  const ownStaffId = await resolveOwnStaffId(uid, token, salonId, membership);
  if (ownStaffId) {
    const staffSnap = await db().doc(`salons/${salonId}/staff/${ownStaffId}`).get();
    if (staffSnap.exists) {
      const s = staffSnap.data() || {};
      if (staffRowIsOwner(s)) return true;
      const p = s.permissions;
      if (p && typeof p === "object" && p.time_clock_manage === true) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Kiosk PIN verification (+ per-kiosk throttle)
// ---------------------------------------------------------------------------

function pinThrottleRef(salonId, kioskId) {
  return db().doc(`salons/${salonId}/kioskPinThrottle/${kioskId}`);
}

/** Throws resource-exhausted while the kiosk is locked out. */
async function assertPinThrottleOpen(salonId, kioskId) {
  const snap = await pinThrottleRef(salonId, kioskId).get();
  if (!snap.exists) return;
  const lockedUntilMs = Number(snap.get("lockedUntilMs")) || 0;
  const now = Date.now();
  if (lockedUntilMs > now) {
    const waitMin = Math.max(1, Math.ceil((lockedUntilMs - now) / 60000));
    throw new HttpsError(
      "resource-exhausted",
      `Too many incorrect PIN attempts. Try again in ${waitMin} minute${waitMin === 1 ? "" : "s"}.`,
      { reason: "pin_locked", retryAfterMs: lockedUntilMs - now },
    );
  }
}

async function recordPinFailure(salonId, kioskId) {
  const ref = pinThrottleRef(salonId, kioskId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const data = snap.exists ? snap.data() || {} : {};
    const windowStartMs = Number(data.windowStartMs) || 0;
    const inWindow = now - windowStartMs < PIN_FAILURE_WINDOW_MS;
    const failCount = (inWindow ? Number(data.failCount) || 0 : 0) + 1;
    const patch = {
      failCount,
      windowStartMs: inWindow ? windowStartMs : now,
      updatedAt: serverNow(),
    };
    if (failCount >= PIN_MAX_FAILURES) {
      patch.lockedUntilMs = now + PIN_LOCK_MS;
      patch.failCount = 0;
      patch.windowStartMs = now;
    }
    tx.set(ref, patch, { merge: true });
  });
}

async function clearPinFailures(salonId, kioskId) {
  await pinThrottleRef(salonId, kioskId)
    .set({ failCount: 0, lockedUntilMs: 0, updatedAt: serverNow() }, { merge: true })
    .catch(() => {});
}

/**
 * Resolve a staff row by PIN, server-side. Mirrors the client's ffAuthByPin
 * normalization: trimmed string compare, archived rows skipped. Some legacy
 * rows store the pin as a number, so we query both representations.
 *
 * SECURITY: the failure message is deliberately generic — it never reveals
 * whether a PIN exists. The pin value itself must never be logged or echoed.
 */
async function resolveStaffByPin(salonId, pin) {
  const normalized = trimStr(pin);
  if (!normalized) {
    throw new HttpsError("invalid-argument", "PIN is required on this device.");
  }
  const staffCol = db().collection(`salons/${salonId}/staff`);
  const queries = [staffCol.where("pin", "==", normalized).get()];
  const asNumber = Number(normalized);
  if (isFinite(asNumber) && String(asNumber) === normalized) {
    queries.push(staffCol.where("pin", "==", asNumber).get());
  }
  const results = await Promise.all(queries);
  for (const snap of results) {
    for (const docSnap of snap.docs) {
      const s = docSnap.data() || {};
      if (s.isArchived === true) continue;
      return { staffId: docSnap.id, staffData: s };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Kiosk photo capture (Stage B)
// ---------------------------------------------------------------------------

/**
 * Client-reported capture failure text. Sanitized BEFORE it can reach the
 * audit trail: control characters stripped, whitespace collapsed, hard cap.
 */
function sanitizePhotoError(raw) {
  if (typeof raw !== "string") return null;
  const v = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return v ? v.slice(0, PHOTO_ERROR_MAX_CHARS) : null;
}

/**
 * Decode the punch photo (data-URL or bare base64) into a Buffer.
 * Returns null when absent; throws invalid-argument when malformed,
 * oversized, or not a JPEG (magic-byte check — content type is not trusted).
 */
function parsePhotoPayload(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new HttpsError("invalid-argument", "photo must be a base64 JPEG string.");
  }
  let b64 = raw;
  const dataUrl = /^data:image\/jpe?g;base64,/i.exec(raw);
  if (dataUrl) {
    b64 = raw.slice(dataUrl[0].length);
  } else if (raw.startsWith("data:")) {
    throw new HttpsError("invalid-argument", "photo must be a JPEG data URL.");
  }
  // Cheap pre-decode bound (base64 inflates ~4/3) so a huge payload is
  // rejected before Buffer allocation.
  if (b64.length > Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 8) {
    throw new HttpsError("invalid-argument", "photo is too large.");
  }
  const buf = Buffer.from(b64, "base64");
  if (!buf || buf.length < 100) {
    throw new HttpsError("invalid-argument", "photo payload is not valid base64.");
  }
  if (buf.length > PHOTO_MAX_BYTES) {
    throw new HttpsError("invalid-argument", "photo is too large.");
  }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new HttpsError("invalid-argument", "photo must be a JPEG image.");
  }
  return buf;
}

/**
 * Photo policy from salons/{salonId}/settings/timeClock.kioskPhoto.
 * enabled requires an EXPLICIT true (privacy feature — salons opt in via
 * Time Clock Settings); onFailure defaults to "fallback".
 */
async function loadKioskPhotoPolicy(salonId) {
  try {
    const snap = await db().doc(`salons/${salonId}/settings/timeClock`).get();
    const raw = snap.exists ? snap.get("kioskPhoto") : null;
    const enabled = !!(raw && typeof raw === "object" && raw.enabled === true);
    const onFailure =
      raw && trimStr(raw.onFailure).toLowerCase() === "block" ? "block" : "fallback";
    return { enabled, onFailure };
  } catch (e) {
    console.warn("[timeClockPunch] loadKioskPhotoPolicy failed — treating as disabled", e);
    return { enabled: false, onFailure: "fallback" };
  }
}

/**
 * Resolve the bucket punch photos live in. The client config uses
 * {project}.firebasestorage.app in both staging and production, so that is
 * tried first; legacy *.appspot.com is the fallback (same duality
 * index.js resolveFileForPath handles — but derived from the project, never
 * hardcoded, so staging deploys never touch the production bucket).
 */
let _photoBucketPromise = null;
function resolvePhotoBucket() {
  if (!_photoBucketPromise) {
    _photoBucketPromise = (async () => {
      const project =
        process.env.GCLOUD_PROJECT || trimStr((admin.app().options || {}).projectId);
      for (const id of [`${project}.firebasestorage.app`, `${project}.appspot.com`]) {
        try {
          const bucket = admin.storage().bucket(id);
          const [exists] = await bucket.exists();
          if (exists) return bucket;
        } catch (_) { /* try next candidate */ }
      }
      return admin.storage().bucket();
    })();
  }
  return _photoBucketPromise;
}

/**
 * Upload one punch photo. Runs BEFORE the entry write — a punch is only
 * recorded with a photo path if the object actually exists. The custom
 * metadata lets the 90-day purge clear the matching entry field.
 */
async function uploadPunchPhoto({ salonId, entryId, direction, buffer }) {
  const bucket = await resolvePhotoBucket();
  const field = direction === "in" ? "photoInPath" : "photoOutPath";
  const path = `${PHOTO_STORAGE_PREFIX}${salonId}/${entryId}/${direction}-${Date.now()}.jpg`;
  await bucket.file(path).save(buffer, {
    resumable: false,
    contentType: "image/jpeg",
    metadata: { metadata: { salonId, entryId, field } },
  });
  return path;
}

/**
 * Verify the quick kiosk photo-override: a MANAGER's PIN + mandatory reason,
 * entered on the kiosk without leaving the confirm screen. Shares the kiosk
 * PIN throttle. Approver must be owner/admin/manager or hold
 * time_clock_manage, and cannot be the staff member being punched.
 * Same PIN safety rules as the employee PIN: never logged, never echoed.
 */
async function verifyPhotoManagerOverride({ salonId, kioskId, raw, targetStaffId }) {
  const reason = trimStr(raw && raw.reason).slice(0, PHOTO_OVERRIDE_REASON_MAX_CHARS);
  if (!reason) {
    throw new HttpsError("invalid-argument", "An override reason is required.", {
      reason: "photo_override_reason_required",
    });
  }
  await assertPinThrottleOpen(salonId, kioskId);
  const match = await resolveStaffByPin(salonId, raw && raw.managerPin);
  if (!match) {
    await recordPinFailure(salonId, kioskId);
    throw new HttpsError("permission-denied", "Incorrect manager PIN.", {
      reason: "bad_manager_pin",
    });
  }
  const s = match.staffData || {};
  const role = trimStr(s.role).toLowerCase();
  const canApprove =
    staffRowIsOwner(s) ||
    ["owner", "admin", "manager"].includes(role) ||
    (s.permissions && typeof s.permissions === "object" && s.permissions.time_clock_manage === true);
  if (!canApprove) {
    // Correct PIN, insufficient rights — not a throttle event.
    throw new HttpsError("permission-denied", "This PIN does not belong to a manager.", {
      reason: "photo_override_not_manager",
    });
  }
  if (match.staffId === trimStr(targetStaffId)) {
    throw new HttpsError("permission-denied", "You cannot approve a photo override for your own punch.", {
      reason: "photo_override_self",
    });
  }
  await clearPinFailures(salonId, kioskId);
  return { managerStaffId: match.staffId, reason };
}

/**
 * Decide what happens photo-wise for a KIOSK punch. Returns null when the
 * photo feature does not apply (legacy client that sent no photo* fields, or
 * the salon has not enabled kioskPhoto). Otherwise:
 *   { policy, buffer|null, error|null, override|null }
 * Throws photo_required (block mode, no valid override) — the client shows
 * the quick manager-PIN override form on that reason code.
 */
async function resolveKioskPhotoPlan({ salonId, kioskId, data, staffId }) {
  const clientSupportsPhoto =
    Object.prototype.hasOwnProperty.call(data, "photo") ||
    Object.prototype.hasOwnProperty.call(data, "photoError") ||
    Object.prototype.hasOwnProperty.call(data, "photoOverride");
  if (!clientSupportsPhoto) return null;

  const policy = await loadKioskPhotoPolicy(salonId);
  if (!policy.enabled) return null;

  const buffer = parsePhotoPayload(data.photo);
  if (buffer) return { policy, buffer, error: null, override: null };

  const error = sanitizePhotoError(data.photoError) || "no_photo";
  const overrideRaw =
    data.photoOverride && typeof data.photoOverride === "object" ? data.photoOverride : null;
  if (overrideRaw) {
    const override = await verifyPhotoManagerOverride({
      salonId, kioskId, raw: overrideRaw, targetStaffId: staffId,
    });
    return { policy, buffer: null, error, override };
  }
  if (policy.onFailure === "block") {
    throw new HttpsError(
      "failed-precondition",
      "Photo is mandatory. If it fails, only authorized staff can record the punch.",
      { reason: "photo_required" },
    );
  }
  return { policy, buffer: null, error, override: null };
}

/**
 * Push alert to managers when a punch was recorded without its photo.
 * Idempotent per entry+direction (marker doc created BEFORE the FCM attempt,
 * same trade-off as writeups sendWriteupPushOnce). Recipients: owner/admin
 * staff and time_clock_manage holders — the same audience that can read the
 * photos. Every error here is non-fatal; the punch is already recorded.
 */
async function sendPhotoFailedAlert({ salonId, entryId, direction, staffId }) {
  const markerRef = db().doc(`salons/${salonId}/timeClockPhotoAlerts/${entryId}_${direction}`);
  try {
    await markerRef.create({
      entryId, direction, staffId, createdAt: serverNow(),
    });
  } catch (err) {
    if (err && err.code === 6) return { skipped: "already_attempted" }; // ALREADY_EXISTS
    throw err;
  }

  const staffSnap = await db().collection(`salons/${salonId}/staff`).get();
  const managerIds = new Set();
  staffSnap.forEach((d) => {
    const s = d.data() || {};
    if (s.isArchived === true) return;
    const role = trimStr(s.role).toLowerCase();
    const isMgr =
      staffRowIsOwner(s) ||
      ["owner", "admin"].includes(role) ||
      (s.permissions && typeof s.permissions === "object" && s.permissions.time_clock_manage === true);
    if (isMgr) managerIds.add(d.id);
  });
  if (!managerIds.size) return { skipped: "no_managers" };

  const tokensSnap = await db()
    .collection(`salons/${salonId}/staffDeviceTokens`)
    .where("enabled", "==", true)
    .get();
  const tokens = [
    ...new Set(
      tokensSnap.docs
        .filter((d) => managerIds.has(trimStr((d.data() || {}).staffId)))
        .map((d) => trimStr((d.data() || {}).token))
        .filter(Boolean),
    ),
  ];
  if (!tokens.length) return { skipped: "no_tokens" };

  // Deliberately generic — no staff name or entry details in the push.
  const response = await admin.messaging().sendEachForMulticast({
    tokens: tokens.slice(0, 500),
    notification: {
      title: "Fair Flow — Time Clock",
      body: `Photo capture failed during a kiosk clock-${direction}. Open Manage Time Cards to review.`,
    },
    data: { type: "time_clock_photo_failed", salonId, entryId },
    android: {
      priority: "high",
      notification: { channelId: "fairflow_alerts", defaultSound: true },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { sound: "default", badge: 1 } },
    },
  });
  return { successCount: response.successCount, failureCount: response.failureCount };
}

// ---------------------------------------------------------------------------
// Geofence (server-authoritative mirror of verifyTimeClockGeoFence)
// ---------------------------------------------------------------------------

/**
 * Load the per-branch Time Clock geofence. Settings ride in the branch's
 * queueState doc under queueSettings[locKey].settings.queueGeoFence — the
 * same bucket the client reads (no fallback to "default" for non-default
 * branches, matching getQueueGeoFenceSettings()).
 */
async function loadTimeClockGeoFence(salonId, locationId) {
  const locKey = trimStr(locationId) || "default";
  const snap = await db().doc(`salons/${salonId}/queueState/${locKey}`).get();
  if (!snap.exists) return { active: false };
  const queueSettings = snap.get("queueSettings");
  const raw =
    queueSettings &&
    queueSettings[locKey] &&
    queueSettings[locKey].settings &&
    queueSettings[locKey].settings.queueGeoFence;
  if (!raw || typeof raw !== "object") return { active: false };
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const active =
    raw.enforceTimeClock === true && isFinite(lat) && isFinite(lng);
  if (!active) return { active: false };
  const radiusNum = Math.round(Number(raw.allowedRadiusMeters));
  return {
    active: true,
    lat,
    lng,
    allowedRadiusMeters:
      isFinite(radiusNum) && radiusNum > 0 ? radiusNum : DEFAULT_RADIUS_METERS,
  };
}

/**
 * Enforce the geofence for a punch. `staffData` is the TARGET staff row
 * (bypass follows the target's permissions, same as the client gate).
 * Throws failed-precondition with a machine-readable details.reason the UI
 * maps to the same messages it shows today.
 */
async function assertWithinTimeClockFence({ salonId, locationId, staffData, coords }) {
  const mayBypass =
    staffRowIsOwner(staffData) ||
    (staffData.permissions &&
      typeof staffData.permissions === "object" &&
      staffData.permissions.time_clock_bypass_location === true);
  if (mayBypass) return { checked: false, bypassed: true };

  const fence = await loadTimeClockGeoFence(salonId, locationId);
  if (!fence.active) return { checked: false, bypassed: false };

  if (!coords) {
    throw new HttpsError(
      "failed-precondition",
      "Location access is required to clock in or out at this salon.",
      { reason: "location_required" },
    );
  }
  if (coords.accuracy == null || coords.accuracy > ACCURACY_LIMIT_METERS) {
    throw new HttpsError(
      "failed-precondition",
      "Your location reading is not accurate enough. Move to an open area and try again.",
      { reason: "low_accuracy", accuracy: coords.accuracy, accuracyLimit: ACCURACY_LIMIT_METERS },
    );
  }
  const distanceMeters = Math.round(
    haversineMeters(coords.lat, coords.lng, fence.lat, fence.lng),
  );
  if (distanceMeters > fence.allowedRadiusMeters) {
    throw new HttpsError(
      "failed-precondition",
      "You must be at the salon to clock in or out.",
      {
        reason: "outside_radius",
        distanceMeters,
        allowedRadiusMeters: fence.allowedRadiusMeters,
      },
    );
  }
  return { checked: true, bypassed: false, distanceMeters };
}

// ---------------------------------------------------------------------------
// Entry lookup / duration
// ---------------------------------------------------------------------------

/** Latest open entry for a staff member (defensive: same pick as the client). */
async function findOpenEntry(salonId, staffId) {
  const snap = await db()
    .collection(`salons/${salonId}/timeEntries`)
    .where("staffId", "==", staffId)
    .where("status", "==", "open")
    .limit(5)
    .get();
  if (snap.empty) return null;
  let best = null;
  snap.forEach((d) => {
    const data = d.data() || {};
    const ts = tsToMillisOrNull(data.clockInAt) || 0;
    if (!best || ts > best.ts) best = { id: d.id, data, ts };
  });
  return best ? { id: best.id, data: best.data } : null;
}

function durationMinutesBetween(clockInTs, clockOutTs) {
  return Math.round((clockOutTs.toMillis() - clockInTs.toMillis()) / 60000);
}

// ---------------------------------------------------------------------------
// timeClockPunch
// ---------------------------------------------------------------------------

exports.timeClockPunch = onCall({ region: REGION }, async (req) =>
  timeClockPunchHandler(req.data || {}, { auth: req.auth, rawRequest: req.rawRequest }),
);

async function timeClockPunchHandler(data, context) {
  const caller = classifyCaller(context.auth);

  const action = trimStr(data.action).toLowerCase();
  if (action !== "in" && action !== "out") {
    throw new HttpsError("invalid-argument", "action must be \"in\" or \"out\".");
  }
  const locationId = trimStr(data.locationId) || "default";
  const coords = sanitizeCoords(data.coords);
  const deviceId = sanitizeDeviceId(data.deviceId);
  const platform = sanitizePlatform(data.platform);
  const notes = sanitizeNotes(data.notes);
  const ip = extractIp(context.rawRequest);

  const overrideRaw = data.override && typeof data.override === "object" ? data.override : null;

  // ── Resolve salon + target staff (NEVER trusting a client-sent staffId
  //    outside the audited manager-override path) ─────────────────────────
  let salonId;
  let staffId;
  let staffData;
  let performedAs; // "self" | "kiosk_pin" | "manager_override"
  let overrideReason = null;
  let kioskId = null;

  if (caller.kind === "kiosk") {
    if (overrideRaw) {
      throw new HttpsError("permission-denied", "Manager override is not available on a kiosk session.");
    }
    salonId = caller.salonId;
    kioskId = caller.kioskId;
    performedAs = "kiosk_pin";

    await assertPinThrottleOpen(salonId, kioskId);
    const match = await resolveStaffByPin(salonId, data.pin);
    if (!match) {
      await recordPinFailure(salonId, kioskId);
      throw new HttpsError("permission-denied", "Incorrect PIN.", { reason: "bad_pin" });
    }
    await clearPinFailures(salonId, kioskId);
    staffId = match.staffId;
    staffData = match.staffData;
  } else {
    salonId = trimStr(data.salonId);
    if (!salonId || salonId.includes("/")) {
      throw new HttpsError("invalid-argument", "Missing salonId.");
    }
    const membership = await assertUserBelongsToSalon(caller.uid, salonId);

    if (overrideRaw) {
      overrideReason = trimStr(overrideRaw.reason).slice(0, 1000);
      const overrideStaffId = trimStr(overrideRaw.staffId);
      if (!overrideReason) {
        throw new HttpsError("invalid-argument", "An override reason is required.");
      }
      if (!overrideStaffId || overrideStaffId.includes("/")) {
        throw new HttpsError("invalid-argument", "override.staffId is required.");
      }
      const canManage = await callerCanManageTimeClock(caller.uid, caller.token, salonId, membership);
      if (!canManage) {
        throw new HttpsError("permission-denied", "Only a manager can clock another staff member in or out.");
      }
      staffId = overrideStaffId;
      performedAs = "manager_override";
    } else {
      staffId = await resolveOwnStaffId(caller.uid, caller.token, salonId, membership);
      if (!staffId) {
        throw new HttpsError(
          "failed-precondition",
          "No staff profile is linked to your account. On this device you can only clock yourself — use a paired kiosk for shared stations.",
          { reason: "no_staff_profile" },
        );
      }
      performedAs = "self";
    }

    const staffSnap = await db().doc(`salons/${salonId}/staff/${staffId}`).get();
    if (!staffSnap.exists) throw new HttpsError("not-found", "Staff member not found.");
    staffData = staffSnap.data() || {};
  }

  // UX safety net: the client sends the staffId it DISPLAYED on the confirm
  // screen. It is never trusted for authorization — only compared against the
  // server-derived target so we never silently clock a different person than
  // the one shown on screen.
  const expectedStaffId = trimStr(data.expectedStaffId);
  if (expectedStaffId && expectedStaffId !== staffId) {
    throw new HttpsError(
      "failed-precondition",
      caller.kind === "kiosk"
        ? "The staff roster changed — please re-enter your PIN."
        : "On this device you can only clock yourself in or out. Use a paired kiosk for shared stations.",
      { reason: "staff_mismatch" },
    );
  }

  const isOverride = performedAs === "manager_override";
  const isOwnerRow = staffRowIsOwner(staffData);
  const perms = (staffData.permissions && typeof staffData.permissions === "object")
    ? staffData.permissions
    : {};

  // ── Access gates (mirror the client PIN gates; override skips them) ────
  if (!isOverride) {
    if (staffData.isArchived === true) {
      throw new HttpsError("permission-denied", "This staff profile is archived.");
    }
    if (!isOwnerRow && perms.time_clock_use === false) {
      throw new HttpsError(
        "permission-denied",
        "Time Clock access is disabled for this staff member.",
        { reason: "time_clock_disabled" },
      );
    }
    const allowed = Array.isArray(staffData.allowedLocationIds)
      ? staffData.allowedLocationIds.map((x) => String(x))
      : [];
    const mayBypassLoc = isOwnerRow || perms.time_clock_bypass_location === true;
    if (!mayBypassLoc && allowed.length && !allowed.includes(locationId)) {
      throw new HttpsError(
        "permission-denied",
        "You are not assigned to this location. Ask a manager to enable location bypass.",
        { reason: "location_not_assigned" },
      );
    }
    await assertWithinTimeClockFence({ salonId, locationId, staffData, coords });
  }

  // ── Kiosk photo (Stage B). Resolved AFTER all gates so a photo is never
  //    uploaded for a punch that would be rejected anyway. null → feature not
  //    applicable (personal device, legacy client, or salon opt-out).
  const photoPlan = caller.kind === "kiosk"
    ? await resolveKioskPhotoPlan({ salonId, kioskId, data, staffId })
    : null;

  const source = caller.kind === "kiosk" ? "kiosk" : (isOverride ? "admin" : "manual");
  const geo = coords ? { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy } : null;
  const auditBase = {
    performedByUid: caller.uid,
    performedAs,
    staffId,
    source,
    kioskId,
    deviceId,
    platform,
    ip,
    geo,
    ...(overrideReason ? { overrideReason } : {}),
  };

  const entriesCol = db().collection(`salons/${salonId}/timeEntries`);

  // Uploads the punch photo (if any) for the given entry id and returns the
  // photo fields to merge into the entry + audit event. Upload happens BEFORE
  // the entry write; an upload failure downgrades to the same failure policy
  // as a capture failure (block mode without an approved override rejects).
  async function settlePunchPhoto(entryId, direction) {
    if (!photoPlan) return { entry: {}, audit: {}, failed: false };
    const failedFields = (error) => ({
      entry: { [direction === "in" ? "photoInFailed" : "photoOutFailed"]: true },
      audit: {
        photoFailed: true,
        photoError: error,
        ...(photoPlan.override
          ? { photoOverride: { managerStaffId: photoPlan.override.managerStaffId, reason: photoPlan.override.reason } }
          : {}),
      },
      failed: true,
    });
    if (!photoPlan.buffer) return failedFields(photoPlan.error);
    try {
      const path = await uploadPunchPhoto({ salonId, entryId, direction, buffer: photoPlan.buffer });
      return {
        entry: { [direction === "in" ? "photoInPath" : "photoOutPath"]: path },
        audit: { photoPath: path },
        failed: false,
      };
    } catch (e) {
      console.error("[timeClockPunch] photo upload failed", { salonId, entryId, direction, message: e && e.message });
      if (photoPlan.policy.onFailure === "block" && !photoPlan.override) {
        throw new HttpsError(
          "failed-precondition",
          "Photo is mandatory. The photo could not be saved — only authorized staff can record the punch.",
          { reason: "photo_required", detail: "upload_failed" },
        );
      }
      return failedFields("upload_failed");
    }
  }

  async function alertPhotoFailed(entryId, direction) {
    try {
      await sendPhotoFailedAlert({ salonId, entryId, direction, staffId });
    } catch (e) {
      console.warn("[timeClockPunch] photo-failed alert error (non-fatal)", e && e.message);
    }
  }

  // ── Clock In ────────────────────────────────────────────────────────────
  if (action === "in") {
    const open = await findOpenEntry(salonId, staffId);
    if (open) {
      throw new HttpsError(
        "failed-precondition",
        "This staff member is already clocked in. Clock out before starting another shift.",
        { reason: "already_open", entryId: open.id },
      );
    }
    // Entry id is generated up-front so the photo (uploaded first) and the
    // entry share it — the punch is only recorded after a successful upload.
    const docRef = entriesCol.doc();
    const photo = await settlePunchPhoto(docRef.id, "in");
    const payload = {
      // context (existing shape)
      salonId,
      locationId,
      staffId,
      // time window — server-authoritative
      clockInAt: serverNow(),
      clockOutAt: null,
      // state
      status: "open",
      // schedule linkage snapshot (unchanged semantics)
      linkedShiftId: null,
      scheduled: false,
      // metadata
      source,
      notes,
      durationMinutes: null,
      // punch forensics (new in Stage A)
      kioskId,
      clockInDeviceId: caller.kind === "kiosk" ? null : deviceId,
      clockInPlatform: platform,
      clockInIp: ip,
      clockInGeo: geo,
      clockInByUid: caller.uid,
      overrideReason,
      // kiosk photo (Stage B)
      photoInPath: null,
      photoOutPath: null,
      photoInFailed: false,
      photoOutFailed: false,
      ...photo.entry,
      // audit (existing shape)
      createdAt: serverNow(),
      createdBy: caller.uid,
      updatedAt: serverNow(),
      updatedBy: caller.uid,
    };
    await docRef.set(payload);
    await appendAuditEvent(docRef, "clock_in", { action: "clock_in", ...auditBase, ...photo.audit });
    if (photo.failed) await alertPhotoFailed(docRef.id, "in");
    console.log("[timeClockPunch] clock_in", {
      salonId, staffId, locationId, entryId: docRef.id, performedAs, source, kioskId, hasGeo: !!geo,
      hasPhoto: !!photo.entry.photoInPath, photoFailed: photo.failed,
    });
    return { ok: true, action: "in", entryId: docRef.id, staffId };
  }

  // ── Clock Out ───────────────────────────────────────────────────────────
  const open = await findOpenEntry(salonId, staffId);
  if (!open) {
    throw new HttpsError(
      "failed-precondition",
      "No open shift found — this staff member is not clocked in.",
      { reason: "not_clocked_in" },
    );
  }
  const entry = open.data;

  // Device binding. Kiosk-created entries close from ANY kiosk of the same
  // salon (kiosks are registered on-premises devices); personal-device
  // entries require the same deviceId. Legacy entries (created before Stage
  // A: no kioskId, no clockInDeviceId) close with no device check.
  if (!isOverride) {
    const entryKioskId = trimStr(entry.kioskId);
    const entryDeviceId = trimStr(entry.clockInDeviceId);
    if (entryKioskId) {
      if (caller.kind !== "kiosk") {
        throw new HttpsError(
          "failed-precondition",
          "This shift was started on a salon kiosk — clock out on a kiosk, or ask a manager.",
          { reason: "device_mismatch" },
        );
      }
    } else if (entryDeviceId) {
      if (caller.kind === "kiosk" || !deviceId || deviceId !== entryDeviceId) {
        throw new HttpsError(
          "failed-precondition",
          "Clock out must be done from the same device used to clock in, or by a manager.",
          { reason: "device_mismatch" },
        );
      }
    }
    // else: legacy transition path — no device check.
  }

  const clockInTs = coerceTs(entry.clockInAt);
  if (!clockInTs) {
    throw new HttpsError("failed-precondition", "This entry has no clock-in timestamp yet. Try again in a moment.");
  }
  const clockOutTs = admin.firestore.Timestamp.now();
  if (clockOutTs.toMillis() < clockInTs.toMillis()) {
    throw new HttpsError("failed-precondition", "Clock-out time is earlier than clock-in time.");
  }

  const entryRef = entriesCol.doc(open.id);
  const photo = await settlePunchPhoto(open.id, "out");
  const patch = {
    status: "closed",
    clockOutAt: clockOutTs,
    durationMinutes: durationMinutesBetween(clockInTs, clockOutTs),
    clockOutDeviceId: caller.kind === "kiosk" ? null : deviceId,
    clockOutKioskId: kioskId,
    clockOutPlatform: platform,
    clockOutIp: ip,
    clockOutGeo: geo,
    clockOutByUid: caller.uid,
    ...(overrideReason ? { clockOutOverrideReason: overrideReason } : {}),
    ...photo.entry,
    updatedAt: serverNow(),
    updatedBy: caller.uid,
  };
  if (notes != null) patch.notes = notes;
  await entryRef.update(patch);
  await appendAuditEvent(entryRef, "clock_out", { action: "clock_out", ...auditBase, ...photo.audit });
  if (photo.failed) await alertPhotoFailed(open.id, "out");
  console.log("[timeClockPunch] clock_out", {
    salonId, staffId, locationId, entryId: open.id, performedAs, source, kioskId,
    durationMinutes: patch.durationMinutes, hasGeo: !!geo,
    hasPhoto: !!photo.entry.photoOutPath, photoFailed: photo.failed,
  });
  return {
    ok: true,
    action: "out",
    entryId: open.id,
    staffId,
    clockOutAtMs: clockOutTs.toMillis(),
    durationMinutes: patch.durationMinutes,
  };
}

// ---------------------------------------------------------------------------
// timeClockManageEntry (Manage Time Cards: add / edit / void)
// ---------------------------------------------------------------------------

exports.timeClockManageEntry = onCall({ region: REGION }, async (req) =>
  timeClockManageEntryHandler(req.data || {}, { auth: req.auth, rawRequest: req.rawRequest }),
);

async function timeClockManageEntryHandler(data, context) {
  const caller = classifyCaller(context.auth);
  if (caller.kind === "kiosk") {
    throw new HttpsError("permission-denied", "Time card management is not available on a kiosk session.");
  }

  const op = trimStr(data.op).toLowerCase();
  if (!["add", "edit", "void"].includes(op)) {
    throw new HttpsError("invalid-argument", "op must be \"add\", \"edit\" or \"void\".");
  }
  const salonId = trimStr(data.salonId);
  if (!salonId || salonId.includes("/")) {
    throw new HttpsError("invalid-argument", "Missing salonId.");
  }

  const membership = await assertUserBelongsToSalon(caller.uid, salonId);
  const canManage = await callerCanManageTimeClock(caller.uid, caller.token, salonId, membership);
  if (!canManage) {
    throw new HttpsError("permission-denied", "You do not have permission to manage time cards.");
  }

  const ip = extractIp(context.rawRequest);
  const entriesCol = db().collection(`salons/${salonId}/timeEntries`);
  const auditBase = {
    performedByUid: caller.uid,
    performedAs: "admin_manage",
    ip,
  };

  // ── add ──────────────────────────────────────────────────────────────────
  if (op === "add") {
    const staffId = trimStr(data.staffId);
    if (!staffId || staffId.includes("/")) {
      throw new HttpsError("invalid-argument", "staffId is required.");
    }
    const staffSnap = await db().doc(`salons/${salonId}/staff/${staffId}`).get();
    if (!staffSnap.exists) throw new HttpsError("not-found", "Staff member not found.");

    const locationId = trimStr(data.locationId) || "default";
    const clockInTs = coerceTs(data.clockInAt);
    if (!clockInTs) throw new HttpsError("invalid-argument", "clockInAt is required.");
    const clockOutTs = coerceTs(data.clockOutAt);
    if (clockOutTs && clockOutTs.toMillis() < clockInTs.toMillis()) {
      throw new HttpsError("invalid-argument", "clockOutAt is earlier than clockInAt.");
    }

    const open = await findOpenEntry(salonId, staffId);
    if (!clockOutTs && open) {
      throw new HttpsError(
        "failed-precondition",
        "This staff member already has an open shift.",
        { reason: "already_open", entryId: open.id },
      );
    }

    const payload = {
      salonId,
      locationId,
      staffId,
      clockInAt: clockInTs,
      clockOutAt: clockOutTs || null,
      status: clockOutTs ? "closed" : "open",
      linkedShiftId: null,
      scheduled: false,
      source: "admin",
      notes: sanitizeNotes(data.notes),
      durationMinutes: clockOutTs ? durationMinutesBetween(clockInTs, clockOutTs) : null,
      kioskId: null,
      clockInDeviceId: null,
      clockInPlatform: null,
      clockInIp: null,
      clockInGeo: null,
      clockInByUid: caller.uid,
      overrideReason: null,
      photoInPath: null,
      photoOutPath: null,
      photoInFailed: false,
      photoOutFailed: false,
      createdAt: serverNow(),
      createdBy: caller.uid,
      updatedAt: serverNow(),
      updatedBy: caller.uid,
    };
    const docRef = await entriesCol.add(payload);
    await appendAuditEvent(docRef, "created_admin", {
      action: "created_admin",
      staffId,
      locationId,
      clockInAtMs: clockInTs.toMillis(),
      clockOutAtMs: clockOutTs ? clockOutTs.toMillis() : null,
      ...auditBase,
    });
    console.log("[timeClockManageEntry] add", { salonId, staffId, entryId: docRef.id, byUid: caller.uid });
    return { ok: true, op: "add", entryId: docRef.id };
  }

  // ── edit / void (shared load) ────────────────────────────────────────────
  const entryId = trimStr(data.entryId);
  if (!entryId || entryId.includes("/")) {
    throw new HttpsError("invalid-argument", "entryId is required.");
  }
  const entryRef = entriesCol.doc(entryId);
  const snap = await entryRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Time entry not found.");
  const current = snap.data() || {};

  if (op === "void") {
    if (current.status === "void") {
      return { ok: true, op: "void", entryId, changed: false };
    }
    await entryRef.update({
      status: "void",
      updatedAt: serverNow(),
      updatedBy: caller.uid,
    });
    await appendAuditEvent(entryRef, "voided", {
      action: "voided",
      staffId: trimStr(current.staffId) || null,
      changes: { status: { from: current.status || null, to: "void" } },
      ...(sanitizeNotes(data.reason) ? { reason: sanitizeNotes(data.reason) } : {}),
      ...auditBase,
    });
    console.log("[timeClockManageEntry] void", { salonId, entryId, byUid: caller.uid });
    return { ok: true, op: "void", entryId, changed: true };
  }

  // ── edit (mirrors public/time-clock-entries.js ffUpdateTimeEntry) ───────
  const patch = {};
  const changes = {};

  let finalClockIn = coerceTs(current.clockInAt);
  if (Object.prototype.hasOwnProperty.call(data, "clockInAt")) {
    const ts = coerceTs(data.clockInAt);
    if (!ts) throw new HttpsError("invalid-argument", "clockInAt is invalid.");
    patch.clockInAt = ts;
    changes.clockInAt = { from: tsToMillisOrNull(coerceTs(current.clockInAt)), to: ts.toMillis() };
    finalClockIn = ts;
  }

  let finalClockOut = coerceTs(current.clockOutAt);
  let reopen = false;
  if (Object.prototype.hasOwnProperty.call(data, "clockOutAt")) {
    if (data.clockOutAt === null) {
      patch.clockOutAt = null;
      changes.clockOutAt = { from: tsToMillisOrNull(coerceTs(current.clockOutAt)), to: null };
      finalClockOut = null;
      reopen = true;
    } else {
      const ts = coerceTs(data.clockOutAt);
      if (!ts) throw new HttpsError("invalid-argument", "clockOutAt is invalid.");
      patch.clockOutAt = ts;
      changes.clockOutAt = { from: tsToMillisOrNull(coerceTs(current.clockOutAt)), to: ts.toMillis() };
      finalClockOut = ts;
    }
  }

  if (finalClockIn && finalClockOut && finalClockOut.toMillis() < finalClockIn.toMillis()) {
    throw new HttpsError("invalid-argument", "clockOutAt is earlier than clockInAt — refusing to save.");
  }

  if (typeof data.status === "string") {
    const s = trimStr(data.status).toLowerCase();
    if (!["open", "closed", "void"].includes(s)) {
      throw new HttpsError("invalid-argument", `Invalid status "${data.status}".`);
    }
    if (s !== current.status) {
      patch.status = s;
      changes.status = { from: current.status || null, to: s };
    }
  } else if (reopen) {
    patch.status = "open";
    changes.status = { from: current.status || null, to: "open" };
  } else if (finalClockOut && current.status !== "void" && current.status !== "closed") {
    patch.status = "closed";
    changes.status = { from: current.status || null, to: "closed" };
  }

  if (patch.clockInAt !== undefined || patch.clockOutAt !== undefined || patch.status !== undefined) {
    const effectiveStatus = patch.status || current.status;
    if (finalClockIn && finalClockOut && effectiveStatus === "closed") {
      patch.durationMinutes = durationMinutesBetween(finalClockIn, finalClockOut);
    } else if (reopen || patch.status === "open") {
      patch.durationMinutes = null;
    }
  }

  if (typeof data.locationId === "string" && data.locationId.trim()) {
    const loc = data.locationId.trim();
    if (loc !== current.locationId) {
      patch.locationId = loc;
      changes.locationId = { from: current.locationId || null, to: loc };
    }
  }

  if (typeof data.notes === "string" || data.notes === null) {
    const nextNotes = typeof data.notes === "string" ? sanitizeNotes(data.notes) : null;
    if (nextNotes !== (current.notes || null)) {
      patch.notes = nextNotes;
      changes.notes = { from: current.notes || null, to: nextNotes };
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, op: "edit", entryId, changed: false };
  }

  patch.updatedAt = serverNow();
  patch.updatedBy = caller.uid;
  await entryRef.update(patch);
  await appendAuditEvent(entryRef, `edited_${Date.now()}`, {
    action: "edited",
    staffId: trimStr(current.staffId) || null,
    changes,
    ...auditBase,
  });
  console.log("[timeClockManageEntry] edit", {
    salonId, entryId, byUid: caller.uid, changedFields: Object.keys(changes),
  });
  return { ok: true, op: "edit", entryId, changed: true };
}

// ---------------------------------------------------------------------------
// timeClockPhotosPurgeDaily — 90-day photo retention (Stage B)
// ---------------------------------------------------------------------------

/**
 * Daily sweep of timeClockPhotos/ (one flat prefix listing — cheap even
 * across all salons). Objects older than PHOTO_RETENTION_DAYS are deleted
 * and, using the custom metadata stamped at upload, the matching entry field
 * is nulled with a photoIn/OutPurgedAt marker + an audit event. The time
 * entries themselves are NEVER deleted or otherwise modified here.
 */
exports.timeClockPhotosPurgeDaily = onSchedule(
  {
    schedule: "30 3 * * *", // 03:30 UTC daily
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 540,
    memory: "256MiB",
    retryCount: 0,
  },
  async () => {
    const bucket = await resolvePhotoBucket();
    const cutoffMs = Date.now() - PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const [files] = await bucket.getFiles({ prefix: PHOTO_STORAGE_PREFIX });

    let deleted = 0;
    let errors = 0;
    for (const file of files) {
      try {
        const createdMs = Date.parse(file.metadata && file.metadata.timeCreated);
        if (!isFinite(createdMs) || createdMs > cutoffMs) continue;

        const meta = (file.metadata && file.metadata.metadata) || {};
        const salonId = trimStr(meta.salonId);
        const entryId = trimStr(meta.entryId);
        const field =
          meta.field === "photoInPath" || meta.field === "photoOutPath" ? meta.field : null;

        await file.delete();
        deleted += 1;

        if (salonId && entryId && field) {
          const direction = field === "photoInPath" ? "in" : "out";
          const entryRef = db().doc(`salons/${salonId}/timeEntries/${entryId}`);
          await entryRef
            .set(
              {
                [field]: null,
                [direction === "in" ? "photoInPurgedAt" : "photoOutPurgedAt"]: serverNow(),
                updatedAt: serverNow(),
              },
              { merge: true },
            )
            .catch(() => {});
          await appendAuditEvent(entryRef, `photo_purged_${direction}`, {
            action: "photo_purged",
            field,
            path: file.name,
            retentionDays: PHOTO_RETENTION_DAYS,
            performedAs: "system_retention",
          }).catch(() => {});
        }
      } catch (e) {
        errors += 1;
        console.warn("[timeClockPhotosPurgeDaily] file purge failed", {
          name: file && file.name, message: e && e.message,
        });
      }
    }
    console.log("[timeClockPhotosPurgeDaily] done", {
      scanned: files.length, deleted, errors, retentionDays: PHOTO_RETENTION_DAYS,
    });
  },
);
