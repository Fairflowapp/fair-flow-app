/**
 * Internal Billing Override — comped/free access for owner-managed accounts.
 *
 * What it does:
 *   - Lets a platform admin (membership tracked in `platformAdmins/{uid}`)
 *     mark a salon as "internally comped" without going through Stripe.
 *   - The override doc lives at `salons/{salonId}/billing/override`.
 *   - When `enabled === true` AND (`endsAt` is null OR in the future), the
 *     account is treated as `active` regardless of Stripe state.
 *   - All recomputation is delegated to `recomputeAccountStatus()` in
 *     `stripe.js` — this module never touches Stripe payment logic.
 *
 * Surface:
 *   - setBillingOverride       (callable — platform admin only)
 *   - clearBillingOverride     (callable — platform admin only)
 *   - onBillingOverrideWritten (Firestore trigger — keeps mirror in sync)
 *   - expireBillingOverridesDaily (scheduled — auto-disables expired overrides)
 *
 * Security:
 *   - All callables verify `platformAdmins/{uid}` exists (Admin SDK read).
 *   - Firestore rules deny all client reads/writes to `platformAdmins`.
 *   - Firestore rules let platform admin clients write
 *     `salons/{id}/billing/override` only; all other docs in the `billing`
 *     subcollection (notably `stripe`) remain Admin-SDK-only.
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions/v2");

const { recomputeAccountStatus } = require("./stripe");

const REGION = "us-central1";

// Whitelist: anything outside this set is rejected at the callable boundary.
// Keep aligned with the UI dropdown and the user's spec.
const VALID_REASONS = Object.freeze([
  "internal",
  "family",
  "partner",
  "tester",
  "manual",
]);

// Hard caps on free-form fields to keep Firestore docs predictable and to
// blunt any abuse if a platform admin account is ever compromised.
const MAX_PLAN_NAME_LEN = 100;
const MAX_NOTES_LEN = 500;
const MAX_MONTHLY_PRICE = 100000; // unit: dollars (UI shows "$0 / month")

// ─── Helpers ──────────────────────────────────────────────────────────────

async function assertPlatformAdmin(uid) {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  const snap = await admin.firestore().doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Platform admin access required."
    );
  }
}

function sanitizeSalonId(raw) {
  const salonId = String(raw || "").trim();
  if (!salonId) {
    throw new HttpsError("invalid-argument", "salonId required.");
  }
  // Mirror the validation pattern used elsewhere in the codebase: reject any
  // characters that have meaning in Firestore document paths.
  if (/[\/\.\#\$\[\]]/.test(salonId)) {
    throw new HttpsError("invalid-argument", "Invalid salonId.");
  }
  return salonId;
}

function validateOverrideInput(data) {
  const out = {};

  const reason = String(data?.reason || "").trim().toLowerCase();
  if (!VALID_REASONS.includes(reason)) {
    throw new HttpsError(
      "invalid-argument",
      `reason must be one of: ${VALID_REASONS.join(", ")}.`
    );
  }
  out.reason = reason;

  const planName = String(data?.planName || "").trim();
  if (!planName) {
    throw new HttpsError("invalid-argument", "planName is required.");
  }
  if (planName.length > MAX_PLAN_NAME_LEN) {
    throw new HttpsError(
      "invalid-argument",
      `planName must be ${MAX_PLAN_NAME_LEN} characters or less.`
    );
  }
  out.planName = planName;

  const monthlyPrice = Number(data?.monthlyPrice);
  if (
    !Number.isFinite(monthlyPrice) ||
    monthlyPrice < 0 ||
    monthlyPrice > MAX_MONTHLY_PRICE
  ) {
    throw new HttpsError(
      "invalid-argument",
      "monthlyPrice must be a non-negative number."
    );
  }
  out.monthlyPrice = monthlyPrice;

  if (data?.endsAt !== undefined && data?.endsAt !== null) {
    const endsAtMs = Number(data.endsAt);
    if (!Number.isFinite(endsAtMs) || endsAtMs <= Date.now()) {
      throw new HttpsError(
        "invalid-argument",
        "endsAt must be a future timestamp (ms since epoch)."
      );
    }
    out.endsAt = admin.firestore.Timestamp.fromMillis(endsAtMs);
  } else {
    out.endsAt = null;
  }

  if (data?.notes) {
    const notes = String(data.notes).trim();
    if (notes.length > MAX_NOTES_LEN) {
      throw new HttpsError(
        "invalid-argument",
        `notes must be ${MAX_NOTES_LEN} characters or less.`
      );
    }
    out.notes = notes;
  } else {
    out.notes = null;
  }

  return out;
}

// ─── Callables ────────────────────────────────────────────────────────────

/**
 * Enable (or update) an internal billing override on a salon.
 *
 * Caller: platform admin (entry in `platformAdmins/{uid}`).
 * Data:   { salonId, reason, planName, monthlyPrice, endsAt?, notes? }
 *         endsAt is unix ms (number) or null/omitted for indefinite.
 */
exports.setBillingOverride = onCall(
  { region: REGION },
  async (req) => {
    const auth = req.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");

    const data = req.data || {};
    const salonId = sanitizeSalonId(data.salonId);

    try {
      await assertPlatformAdmin(auth.uid);

      const fs = admin.firestore();
      const salonSnap = await fs.doc(`salons/${salonId}`).get();
      if (!salonSnap.exists) {
        throw new HttpsError("not-found", "Salon not found.");
      }

      const validated = validateOverrideInput(data);
      const F = admin.firestore.FieldValue;
      const overrideRef = fs.doc(`salons/${salonId}/billing/override`);
      const existing = await overrideRef.get();

      const payload = {
        enabled: true,
        reason: validated.reason,
        planName: validated.planName,
        monthlyPrice: validated.monthlyPrice,
        endsAt: validated.endsAt,
        notes: validated.notes,
        createdBy: existing.exists
          ? (existing.data() || {}).createdBy || auth.uid
          : auth.uid,
        updatedBy: auth.uid,
        updatedAt: F.serverTimestamp(),
      };
      if (!existing.exists) {
        payload.createdAt = F.serverTimestamp();
      }
      // If we're re-enabling, clear stale auto-expire/cleared markers.
      if (existing.exists && (existing.data() || {}).enabled === false) {
        payload.clearedAt = F.delete();
        payload.clearedBy = F.delete();
        payload.autoExpiredAt = F.delete();
      }

      await overrideRef.set(payload, { merge: true });

      // The Firestore trigger will recompute too, but call directly so the
      // callable returns AFTER the mirror is in sync (avoids a UI flicker).
      await recomputeAccountStatus(salonId);

      logger.info("[billing override] set", {
        adminUid: auth.uid,
        salonId,
        reason: validated.reason,
        planName: validated.planName,
        monthlyPrice: validated.monthlyPrice,
        hasEndsAt: !!validated.endsAt,
      });

      return {
        ok: true,
        enabled: true,
        salonId,
        reason: validated.reason,
        planName: validated.planName,
        monthlyPrice: validated.monthlyPrice,
        endsAt: validated.endsAt ? validated.endsAt.toMillis() : null,
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("[billing override] setBillingOverride failed", {
        adminUid: auth?.uid || null,
        salonId,
        message: err?.message || String(err),
        stack: err?.stack,
      });
      throw new HttpsError(
        "internal",
        err?.message || "setBillingOverride failed."
      );
    }
  }
);

/**
 * Disable an existing internal billing override.
 *
 * Caller: platform admin.
 * Data:   { salonId }
 *
 * Soft-disable (`enabled: false`) rather than delete so the doc retains an
 * audit trail (createdBy/createdAt/clearedBy/clearedAt). To wipe completely,
 * delete the doc directly via Admin SDK / Firebase Console.
 */
exports.clearBillingOverride = onCall(
  { region: REGION },
  async (req) => {
    const auth = req.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");

    const salonId = sanitizeSalonId(req.data?.salonId);

    try {
      await assertPlatformAdmin(auth.uid);

      const fs = admin.firestore();
      const overrideRef = fs.doc(`salons/${salonId}/billing/override`);
      const F = admin.firestore.FieldValue;

      const existing = await overrideRef.get();
      if (!existing.exists) {
        // Nothing to clear — still recompute so the salon root doc is clean.
        await recomputeAccountStatus(salonId);
        return { ok: true, enabled: false, salonId, alreadyCleared: true };
      }

      await overrideRef.set(
        {
          enabled: false,
          clearedAt: F.serverTimestamp(),
          clearedBy: auth.uid,
          updatedAt: F.serverTimestamp(),
        },
        { merge: true }
      );

      await recomputeAccountStatus(salonId);

      logger.info("[billing override] cleared", {
        adminUid: auth.uid,
        salonId,
      });

      return { ok: true, enabled: false, salonId };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("[billing override] clearBillingOverride failed", {
        adminUid: auth?.uid || null,
        salonId,
        message: err?.message || String(err),
        stack: err?.stack,
      });
      throw new HttpsError(
        "internal",
        err?.message || "clearBillingOverride failed."
      );
    }
  }
);

// ─── Triggers ─────────────────────────────────────────────────────────────

/**
 * Idempotent: any change to `salons/{salonId}/billing/override` (callable,
 * Firebase Console, future admin UI, etc.) triggers a fresh recomputation
 * of the salon's denormalized accountStatus.
 */
exports.onBillingOverrideWritten = onDocumentWritten(
  { document: "salons/{salonId}/billing/override", region: REGION },
  async (event) => {
    const salonId = event.params?.salonId;
    if (!salonId) return;
    try {
      await recomputeAccountStatus(salonId);
    } catch (err) {
      logger.error(
        "[billing override] onBillingOverrideWritten recompute failed",
        {
          salonId,
          message: err?.message || String(err),
        }
      );
    }
  }
);

/**
 * Daily sweep: disable any override whose `endsAt` has passed. The Firestore
 * trigger above then fires for each one and recomputes accountStatus, which
 * lets non-owner members fall back to the underlying Stripe state (or
 * fail-open if no Stripe doc exists).
 *
 * Strategy: iterate `salons` and probe each `billing/override`. For typical
 * SaaS scale this is cheap (one read per salon per day) and avoids needing
 * a composite index on a collection-group query.
 */
exports.expireBillingOverridesDaily = onSchedule(
  {
    schedule: "0 3 * * *", // 03:00 UTC daily
    timeZone: "UTC",
    region: REGION,
  },
  async () => {
    const fs = admin.firestore();
    const F = admin.firestore.FieldValue;
    const nowMs = Date.now();

    let processed = 0;
    let expired = 0;
    let errors = 0;

    try {
      const salonsSnap = await fs.collection("salons").select().get();
      for (const salonDoc of salonsSnap.docs) {
        processed += 1;
        const salonId = salonDoc.id;
        try {
          const overrideSnap = await fs
            .doc(`salons/${salonId}/billing/override`)
            .get();
          if (!overrideSnap.exists) continue;

          const data = overrideSnap.data() || {};
          if (!data.enabled) continue;

          const endsAtMs =
            data.endsAt && typeof data.endsAt.toMillis === "function"
              ? data.endsAt.toMillis()
              : null;
          if (endsAtMs == null || endsAtMs > nowMs) continue;

          await overrideSnap.ref.set(
            {
              enabled: false,
              autoExpiredAt: F.serverTimestamp(),
              updatedAt: F.serverTimestamp(),
            },
            { merge: true }
          );
          expired += 1;
          // The onBillingOverrideWritten trigger recomputes accountStatus.
        } catch (e) {
          errors += 1;
          logger.warn("[billing override] expire scan: salon failed", {
            salonId,
            message: e?.message || String(e),
          });
        }
      }
    } catch (err) {
      logger.error("[billing override] expire scan: fatal", {
        message: err?.message || String(err),
      });
      throw err;
    }

    logger.info("[billing override] expire scan complete", {
      processed,
      expired,
      errors,
    });
  }
);
