// ============================================================================
// Stripe billing integration (Firebase Functions v2 + Stripe Checkout/Webhook)
//
// Exports:
//   - createStripeCheckoutSession  (callable v2)
//   - createStripePortalSession    (callable v2)
//   - stripeWebhook                (onRequest v2 — Stripe → Firestore sync)
//
// All exports are registered from index.js via:
//   Object.assign(exports, require("./stripe"));
//
// Required Secret Manager secrets (per-project; NEVER in any .env file):
//   - STRIPE_SECRET_KEY      sk_live_… in fairflowapp-db841 (production)
//                            sk_test_… in fair-flow-staging (staging)
//   - STRIPE_WEBHOOK_SECRET  whsec_… of THAT project's webhook endpoint
//                            (live endpoint in production, test endpoint in staging)
//
// Required env vars (per-project .env.<projectId>; never in shared .env):
//   - STRIPE_PRICE_BASE      → price_…  ($99/mo Base Plan)
//   - STRIPE_PRICE_LOCATION  → price_…  ($79/mo Additional Location, qty)
//   - STRIPE_PRICE_STORAGE   → price_…  ($10/mo Extra Storage, qty per 10GB)
//   See functions/.env.fair-flow-staging  (TEST values) and
//       functions/.env.fairflowapp-db841 (LIVE values).
//
// Firestore writes (Admin SDK — bypasses rules):
//   - salons/{salonId}/billing/stripe        latest subscription state
//   - stripeWebhookEvents/{eventId}          idempotency markers
// ============================================================================

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

const { defineSecret } = require("firebase-functions/params");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

const REGION = "us-central1";

// Pinned Stripe API version — keeps payload shapes deterministic across
// account-default upgrades. Bump intentionally when you've tested a newer one.
const STRIPE_API_VERSION = "2024-12-18.acacia";

// Number of days from the first observed `invoice.payment_failed` until the
// account is moved to the `locked` state. Hard-coded for now per product
// decision; future versions may read a per-salon override from Firestore.
const GRACE_PERIOD_DAYS = 14;

const SKU_TO_ENV = Object.freeze({
  base: "STRIPE_PRICE_BASE",
  location: "STRIPE_PRICE_LOCATION",
  storage: "STRIPE_PRICE_STORAGE",
});

let _stripeClient = null;
function getStripe() {
  if (_stripeClient) return _stripeClient;
  const Stripe = require("stripe");
  const key = STRIPE_SECRET_KEY.value();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not bound to this function");
  }
  _stripeClient = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  return _stripeClient;
}

function priceIdForSku(sku) {
  const envKey = SKU_TO_ENV[sku];
  if (!envKey) {
    throw new HttpsError("invalid-argument", `Unknown sku: ${sku}`);
  }
  const v = process.env[envKey];
  if (!v) {
    throw new HttpsError(
      "failed-precondition",
      `${envKey} is not set in the functions environment`
    );
  }
  return v;
}

function skuForPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_BASE) return "base";
  if (priceId === process.env.STRIPE_PRICE_LOCATION) return "location";
  if (priceId === process.env.STRIPE_PRICE_STORAGE) return "storage";
  return null;
}

/**
 * The app stores the canonical salon-owner uid on `salons/{id}/settings/main.ownerUid`
 * (per the comment in public/app.js:179 and the bootstrap at app.js:2436), but
 * older accounts created via the legacy sign-up flow also have it on the
 * top-level `salons/{id}.ownerUid`. Accept either — both are written by the
 * same auth flow, neither alone is guaranteed to exist on a given account.
 *
 * Returns the salon doc data (used downstream for Stripe customer fields).
 */
async function assertOwnerOfSalon(uid, salonId) {
  if (!uid || !salonId) {
    throw new HttpsError("invalid-argument", "Missing uid/salonId");
  }
  // Reject paths with slashes / control chars that would break .doc(...).
  if (/[\/\.\#\$\[\]]/.test(String(salonId))) {
    throw new HttpsError("invalid-argument", "Invalid salonId");
  }

  const fs = admin.firestore();
  const [salonSnap, mainSnap] = await Promise.all([
    fs.doc(`salons/${salonId}`).get(),
    fs.doc(`salons/${salonId}/settings/main`).get(),
  ]);
  if (!salonSnap.exists) {
    throw new HttpsError("not-found", "Salon not found");
  }
  const salonData = salonSnap.data() || {};
  const mainData = mainSnap.exists ? mainSnap.data() || {} : {};

  const ownerFromSalon = String(salonData.ownerUid || "");
  const ownerFromMain = String(mainData.ownerUid || "");
  const isOwner =
    (ownerFromSalon && ownerFromSalon === String(uid)) ||
    (ownerFromMain && ownerFromMain === String(uid));

  if (!isOwner) {
    logger.warn("[stripe] owner check failed", {
      salonId,
      uid,
      hasOwnerOnSalon: !!ownerFromSalon,
      hasOwnerOnMain: !!ownerFromMain,
    });
    throw new HttpsError(
      "permission-denied",
      "Only the salon owner can manage billing"
    );
  }
  return salonData;
}

/**
 * Resolves a Stripe customer for the given salon, creating one in the current
 * Stripe mode if needed.
 *
 * Cross-mode migration (test → live or live → test):
 *   The Firestore doc may carry a `customerId` that was created in a different
 *   Stripe mode than the secret key currently bound to this function (e.g. a
 *   `cus_…` made in test mode while a live `sk_live_…` is now active). Stripe
 *   responds to `customers.retrieve()` for such an ID with
 *   `StripeInvalidRequestError code=resource_missing` and the message
 *   "No such customer … a similar object exists in test mode but a live mode
 *   key was used to make this request" (or vice-versa). When we detect that,
 *   we transparently:
 *     1. Create a fresh customer in the *current* Stripe mode.
 *     2. Wipe the now-orphaned subscription/state fields on `billing/stripe`
 *        (subscriptionId, status, items, latestInvoice, gracePeriod…) — those
 *        belong to a Stripe mode that this function can no longer reach.
 *     3. Stamp `previousCustomerId`, `migratedFromMode: true`, `migratedAt`
 *        for audit/forensics.
 *     4. Re-derive `accountStatus` on the salon root doc so the Billing Guard
 *        immediately stops applying the old test-mode lock/at-risk state.
 *   The previous Stripe customer (in the other mode) is left untouched —
 *   harmless, and useful for audit if you ever switch the secret back.
 *
 * Returns: `{ customerId, migrated, created }`
 *   - `created`  — no customerId existed in Firestore; freshly created.
 *   - `migrated` — a customerId existed but pointed at the wrong Stripe mode
 *                  (or was deleted) and has been replaced. Callers may want
 *                  to surface a UX message in this case (the previous
 *                  subscription is no longer reachable).
 *
 * Options:
 *   - `allowCreateIfMissing` (default true) — when false, throw
 *     `failed-precondition` if there's no existing customerId. Used by the
 *     portal/sync callables which only make sense for an already-onboarded
 *     salon.
 */
async function getOrCreateCustomer({
  salonId,
  salonData,
  ownerUid,
  ownerEmail,
  allowCreateIfMissing = true,
}) {
  const billingRef = admin.firestore().doc(`salons/${salonId}/billing/stripe`);
  const billingSnap = await billingRef.get();
  const existing = billingSnap.exists
    ? String(billingSnap.data().customerId || "")
    : "";

  const stripe = getStripe();

  if (existing) {
    try {
      const cust = await stripe.customers.retrieve(existing);
      // Stripe returns soft-deleted customers as `{ deleted: true }` shells.
      if (cust && cust.deleted !== true) {
        return { customerId: existing, migrated: false, created: false };
      }
      logger.warn("[stripe] customer is soft-deleted — recreating", {
        salonId,
        oldCustomerId: existing,
      });
    } catch (e) {
      const isCrossMode =
        e?.type === "StripeInvalidRequestError" &&
        e?.code === "resource_missing";
      if (!isCrossMode) {
        // Network errors / auth errors — re-throw, don't recreate blindly.
        throw e;
      }
      logger.warn(
        "[stripe] stale customerId — recreating in current Stripe mode",
        {
          salonId,
          oldCustomerId: existing,
          stripeMessage: e?.message || null,
        }
      );
    }
  } else if (!allowCreateIfMissing) {
    throw new HttpsError(
      "failed-precondition",
      "No Stripe customer linked yet. Complete checkout first."
    );
  }

  const customer = await stripe.customers.create({
    email: ownerEmail || undefined,
    name: salonData?.name || undefined,
    metadata: {
      salonId,
      ownerUid: ownerUid || "",
    },
  });

  const F = admin.firestore.FieldValue;
  const update = {
    salonId,
    customerId: customer.id,
    updatedAt: F.serverTimestamp(),
  };

  if (existing) {
    // Cross-mode migration: stale subscription state would mislead the UI and
    // the Billing Guard. Wipe everything that Stripe LIVE has never heard of.
    Object.assign(update, {
      previousCustomerId: existing,
      migratedFromMode: true,
      migratedAt: F.serverTimestamp(),
      subscriptionId: F.delete(),
      status: F.delete(),
      currentPeriodEnd: F.delete(),
      cancelAtPeriodEnd: F.delete(),
      canceledAt: F.delete(),
      items: F.delete(),
      latestInvoice: F.delete(),
      gracePeriodEndsAt: F.delete(),
      gracePeriodStartedAt: F.delete(),
    });
  } else {
    update.createdAt = F.serverTimestamp();
  }

  await billingRef.set(update, { merge: true });

  if (existing) {
    // Re-derive accountStatus from the (now-cleared) billing doc so the
    // salon root doc stops broadcasting `locked` / `at_risk` based on the
    // orphaned subscription. classifyAccountStatus(undefined) → "active".
    try {
      await recomputeAccountStatus(salonId);
    } catch (e) {
      logger.warn(
        "[stripe] recomputeAccountStatus failed during migration",
        { salonId, message: e?.message || null }
      );
    }
  }

  logger.info(
    existing ? "[stripe] migrated stale customer" : "[stripe] created customer",
    {
      salonId,
      customerId: customer.id,
      previousCustomerId: existing || null,
    }
  );

  return {
    customerId: customer.id,
    migrated: !!existing,
    created: !existing,
  };
}

// ============================================================================
// createStripeCheckoutSession — callable
// ============================================================================
// data: {
//   salonId: string,
//   items: [{ sku: 'base'|'location'|'storage', quantity: number }, ...],
//   successUrl: string,
//   cancelUrl: string,
// }
// returns: { id, url }
exports.createStripeCheckoutSession = onCall(
  { region: REGION, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const auth = req.auth;
    if (!auth) {
      throw new HttpsError("unauthenticated", "Sign in first");
    }
    const data = req.data || {};
    const salonId = String(data.salonId || "").trim();
    const items = Array.isArray(data.items) ? data.items : [];
    const successUrl = String(data.successUrl || "").trim();
    const cancelUrl = String(data.cancelUrl || "").trim();

    if (!salonId) throw new HttpsError("invalid-argument", "salonId required");
    if (items.length === 0) {
      throw new HttpsError("invalid-argument", "items must be a non-empty array");
    }
    if (!successUrl || !cancelUrl) {
      throw new HttpsError("invalid-argument", "successUrl and cancelUrl required");
    }

    // Single point of diagnostic capture. HttpsErrors are forwarded as-is so
    // the client still sees the right code (failed-precondition / not-found /
    // permission-denied / etc). Any unexpected throw — Stripe SDK error,
    // Firestore network error, missing env binding bug — gets logged with a
    // full stack and re-thrown as `internal` with a *useful* message instead
    // of the bare "INTERNAL" string the framework defaults to.
    try {
      logger.info("[stripe checkout] start", {
        uid: auth.uid,
        salonId,
        itemCount: items.length,
        envHasBase: !!process.env.STRIPE_PRICE_BASE,
        envHasLocation: !!process.env.STRIPE_PRICE_LOCATION,
        envHasStorage: !!process.env.STRIPE_PRICE_STORAGE,
      });

      const salonData = await assertOwnerOfSalon(auth.uid, salonId);

      const lineItems = items.map((it, idx) => {
        const sku = String(it?.sku || "").toLowerCase();
        const qty = Math.max(1, parseInt(it?.quantity || 1, 10) || 1);
        if (sku === "base" && qty !== 1) {
          throw new HttpsError(
            "invalid-argument",
            "Base plan quantity must be exactly 1"
          );
        }
        const price = priceIdForSku(sku);
        return { price, quantity: qty, _sku: sku, _idx: idx };
      });

      const hasBase = lineItems.some((li) => li._sku === "base");
      if (!hasBase) {
        throw new HttpsError(
          "invalid-argument",
          "Checkout must include the base plan (sku: 'base')"
        );
      }

      const ownerEmail = auth.token?.email || "";
      const { customerId } = await getOrCreateCustomer({
        salonId,
        salonData,
        ownerUid: auth.uid,
        ownerEmail,
        allowCreateIfMissing: true,
      });

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: lineItems.map(({ price, quantity }) => ({ price, quantity })),
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: salonId,
        metadata: { salonId, ownerUid: auth.uid },
        subscription_data: {
          metadata: { salonId, ownerUid: auth.uid },
        },
        allow_promotion_codes: true,
      });

      logger.info("[stripe checkout] session created", {
        salonId,
        sessionId: session.id,
        customerId,
      });
      return { id: session.id, url: session.url };
    } catch (err) {
      // Pass HttpsErrors through unchanged — they already carry the right code
      // and a useful message that the client renders verbatim.
      if (err instanceof HttpsError) throw err;

      // Stripe SDK errors carry .type / .code / .raw; other errors just .message.
      const msg = err?.message || String(err);
      const stripeType = err?.type || null;
      const stripeCode = err?.code || null;
      logger.error("[stripe checkout] unexpected error", {
        uid: auth.uid,
        salonId,
        message: msg,
        stripeType,
        stripeCode,
        stack: err?.stack,
      });

      // Surface a *useful* message to the client (no secrets) instead of the
      // bare "INTERNAL" the framework returns by default.
      throw new HttpsError(
        "internal",
        stripeType
          ? `Stripe ${stripeType}: ${msg}`
          : `Checkout failed: ${msg}`
      );
    }
  }
);

// ============================================================================
// createStripePortalSession — callable
// ============================================================================
// data: { salonId: string, returnUrl: string }
// returns: { url }
exports.createStripePortalSession = onCall(
  { region: REGION, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const auth = req.auth;
    if (!auth) {
      throw new HttpsError("unauthenticated", "Sign in first");
    }
    const data = req.data || {};
    const salonId = String(data.salonId || "").trim();
    const returnUrl = String(data.returnUrl || "").trim();
    if (!salonId) throw new HttpsError("invalid-argument", "salonId required");
    if (!returnUrl) throw new HttpsError("invalid-argument", "returnUrl required");

    try {
      const salonData = await assertOwnerOfSalon(auth.uid, salonId);

      // Resolves the customerId, validates it against the *current* Stripe
      // mode, and transparently migrates if the stored ID belonged to a
      // different mode (e.g. test → live cutover). Throws failed-precondition
      // if the salon has never started checkout.
      const { customerId, migrated } = await getOrCreateCustomer({
        salonId,
        salonData,
        ownerUid: auth.uid,
        ownerEmail: auth.token?.email || "",
        allowCreateIfMissing: false,
      });

      if (migrated) {
        // The fresh customer has no subscriptions yet, so the billing portal
        // would either error or render an empty surface. Tell the owner to
        // resubscribe — the Subscribe button is already visible because
        // getOrCreateCustomer just wiped the stale subscription state.
        logger.info("[stripe portal] customer was migrated; redirecting to subscribe", {
          salonId,
          customerId,
        });
        throw new HttpsError(
          "failed-precondition",
          "Your previous subscription was set up in a different Stripe mode " +
            "and is no longer active. Please subscribe again to manage billing."
        );
      }

      const stripe = getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      logger.info("[stripe portal] session created", {
        salonId,
        sessionId: session.id,
      });
      return { url: session.url };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = err?.message || String(err);
      const stripeType = err?.type || null;
      logger.error("[stripe portal] unexpected error", {
        uid: auth.uid,
        salonId,
        message: msg,
        stripeType,
        stripeCode: err?.code || null,
        stack: err?.stack,
      });
      throw new HttpsError(
        "internal",
        stripeType
          ? `Stripe ${stripeType}: ${msg}`
          : `Portal failed: ${msg}`
      );
    }
  }
);

// ============================================================================
// syncStripeSubscription — callable
// ============================================================================
// Pulls the current subscription state from Stripe and writes it to Firestore
// using the same shape the webhook would write. This is a fallback for two
// real-world cases:
//
//   1. Webhook delivery hasn't reached us yet (Stripe retries with backoff
//      for up to 3 days). User completed checkout but the Billing UI shows
//      "Unknown" because customer.subscription.created hasn't been delivered.
//   2. Webhook signing-secret rotation broke verification temporarily. Stripe
//      keeps retrying, but the user wants their data NOW.
//
// Owner-only. Idempotent: writes the latest authoritative state whether or
// not a doc already exists. Returns a small status payload for the client.
//
// data: { salonId: string }
// returns: { synced: boolean, subscriptionId?, status?, reason? }
// ============================================================================
exports.syncStripeSubscription = onCall(
  { region: REGION, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const auth = req.auth;
    if (!auth) {
      throw new HttpsError("unauthenticated", "Sign in first");
    }
    const salonId = String(req.data?.salonId || "").trim();
    if (!salonId) throw new HttpsError("invalid-argument", "salonId required");

    try {
      logger.info("[stripe sync] start", { uid: auth.uid, salonId });

      const salonData = await assertOwnerOfSalon(auth.uid, salonId);

      // Validates the stored customer against the current Stripe mode, and
      // transparently migrates on cross-mode mismatch. After migration the
      // customer has no subscriptions, so we short-circuit instead of
      // listing — the client will see `synced:false` and surface Subscribe.
      const { customerId, migrated } = await getOrCreateCustomer({
        salonId,
        salonData,
        ownerUid: auth.uid,
        ownerEmail: auth.token?.email || "",
        allowCreateIfMissing: false,
      });
      if (migrated) {
        logger.info("[stripe sync] customer was migrated; subscription state cleared", {
          salonId,
          customerId,
        });
        return {
          synced: false,
          reason: "stripe_mode_migration",
          customerId,
        };
      }

      const stripe = getStripe();
      // Pull all subscriptions for this customer and pick the most relevant.
      // Active/trialing/past_due win; otherwise the most recently created
      // subscription (canceled/incomplete) — useful when checkout is in
      // progress and only an incomplete sub exists.
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 5,
        expand: ["data.latest_invoice"],
      });
      const ACTIVE = new Set(["active", "trialing", "past_due"]);
      const sub =
        subs.data.find((s) => ACTIVE.has(s.status)) || subs.data[0] || null;

      if (!sub) {
        logger.info("[stripe sync] no subscriptions on customer", {
          salonId,
          customerId,
        });
        return { synced: false, reason: "no_subscriptions" };
      }

      // Reuse the same write shape the webhook uses, so the UI sees identical
      // fields whether data arrived via webhook or via this sync.
      await persistSubscriptionState(salonId, sub);

      // latest_invoice was expanded above; persist it too so the Invoices /
      // Receipts row populates immediately.
      const latestInv = sub.latest_invoice;
      if (latestInv && typeof latestInv === "object") {
        await persistInvoiceState(salonId, latestInv);
      }

      // Mirror the Billing Guard signals onto the salon root doc so non-owner
      // members see the correct lock/at-risk state without needing read access
      // to billing/stripe.
      await recomputeAccountStatus(salonId);

      logger.info("[stripe sync] persisted", {
        salonId,
        customerId,
        subscriptionId: sub.id,
        status: sub.status,
        hasLatestInvoice: !!latestInv,
      });
      return {
        synced: true,
        subscriptionId: sub.id,
        status: sub.status,
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = err?.message || String(err);
      logger.error("[stripe sync] unexpected error", {
        uid: auth.uid,
        salonId,
        message: msg,
        stripeType: err?.type || null,
        stripeCode: err?.code || null,
        stack: err?.stack,
      });
      throw new HttpsError(
        "internal",
        err?.type ? `Stripe ${err.type}: ${msg}` : `Sync failed: ${msg}`
      );
    }
  }
);

// ============================================================================
// stripeWebhook — onRequest (raw body, Stripe-signed)
// ============================================================================
function pickItemsFromSubscription(sub) {
  const out = {};
  const data = sub?.items?.data || [];
  for (const it of data) {
    const sku = skuForPriceId(it?.price?.id) || `unknown_${it?.price?.id || it.id}`;
    out[sku] = {
      priceId: it?.price?.id || null,
      quantity: it?.quantity || 1,
      subscriptionItemId: it.id,
    };
  }
  return out;
}

function tsFromUnix(secs) {
  if (!secs && secs !== 0) return null;
  return admin.firestore.Timestamp.fromMillis(Number(secs) * 1000);
}

async function persistSubscriptionState(salonId, sub) {
  if (!salonId) {
    logger.warn("[stripe webhook] missing salonId — cannot persist subscription", {
      subscriptionId: sub?.id,
    });
    return;
  }
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub?.customer?.id || null;

  // Stripe API ≥ 2025-03-31 moved current_period_end onto the item; fall back.
  const cpe =
    sub.current_period_end ??
    sub.items?.data?.[0]?.current_period_end ??
    null;

  await admin
    .firestore()
    .doc(`salons/${salonId}/billing/stripe`)
    .set(
      {
        salonId,
        customerId,
        subscriptionId: sub.id,
        status: sub.status,
        currentPeriodEnd: tsFromUnix(cpe),
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        canceledAt: tsFromUnix(sub.canceled_at),
        items: pickItemsFromSubscription(sub),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

async function persistInvoiceState(salonId, invoice) {
  if (!salonId) {
    logger.warn("[stripe webhook] missing salonId — cannot persist invoice", {
      invoiceId: invoice?.id,
    });
    return;
  }
  await admin
    .firestore()
    .doc(`salons/${salonId}/billing/stripe`)
    .set(
      {
        salonId,
        latestInvoice: {
          id: invoice.id,
          status: invoice.status,
          hostedInvoiceUrl: invoice.hosted_invoice_url || null,
          amountPaid: invoice.amount_paid ?? null,
          amountDue: invoice.amount_due ?? null,
          currency: invoice.currency || null,
          paidAt: tsFromUnix(invoice.status_transitions?.paid_at),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

// ============================================================================
// Account-status enforcement helpers (Billing Guard)
// ============================================================================
// These live alongside the existing persist helpers because they're called
// from the same webhook switch and from syncStripeSubscription. They write
// only two fields:
//
//   - billing/stripe.gracePeriodEndsAt    (Timestamp | deleted)
//   - salons/{salonId}.{accountStatus, gracePeriodEndsAt}   (denormalized
//                                                            mirror so all
//                                                            salon members can
//                                                            read state)
//
// The denormalization is required because firestore.rules already restricts
// `billing/{docId}` reads to the salon owner — non-owners need a separate,
// safe-to-read signal in order for the client-side Billing Guard to lock
// their UI. The salon doc is already readable by every member today, so
// adding two fields there has minimal blast radius.
// ============================================================================

/**
 * Sets `gracePeriodEndsAt = now + days` on `billing/stripe`, but only if it's
 * not already set. This makes consecutive `invoice.payment_failed` events
 * idempotent (the first failure starts the clock; subsequent failures don't
 * extend it).
 */
async function ensureGracePeriodStarted(salonId, days) {
  if (!salonId) return;
  const ref = admin.firestore().doc(`salons/${salonId}/billing/stripe`);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data().gracePeriodEndsAt : null;
  if (existing) {
    logger.info("[billing guard] grace period already active", {
      salonId,
      existingEndsAt: existing.toMillis ? existing.toMillis() : existing,
    });
    return;
  }
  const endsAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + days * 24 * 60 * 60 * 1000
  );
  await ref.set(
    {
      gracePeriodEndsAt: endsAt,
      gracePeriodStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  logger.info("[billing guard] grace period started", {
    salonId,
    days,
    endsAt: endsAt.toMillis(),
  });
}

/**
 * Removes the grace period from `billing/stripe` (called when a payment
 * succeeds — restoring normal account state).
 */
async function clearGracePeriod(salonId) {
  if (!salonId) return;
  const ref = admin.firestore().doc(`salons/${salonId}/billing/stripe`);
  await ref.set(
    {
      gracePeriodEndsAt: admin.firestore.FieldValue.delete(),
      gracePeriodStartedAt: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  logger.info("[billing guard] grace period cleared", { salonId });
}

/**
 * Pure derivation: maps a Stripe subscription `status` string to one of the
 * three account-state buckets the client UI cares about. Time-based grace
 * expiration is intentionally NOT applied here — clients re-evaluate that
 * locally so the salon doc doesn't go stale between webhook events.
 *
 *   active / trialing                              → 'active'
 *   past_due / incomplete                          → 'at_risk'
 *   unpaid / canceled / incomplete_expired         → 'locked'
 *   anything else (incl. empty/null)               → 'active' (fail-open)
 */
function classifyAccountStatus(subscriptionStatus) {
  const s = String(subscriptionStatus || "").toLowerCase();
  if (s === "active" || s === "trialing") return "active";
  if (s === "unpaid" || s === "canceled" || s === "incomplete_expired") {
    return "locked";
  }
  if (s === "past_due" || s === "incomplete") return "at_risk";
  return "active";
}

/**
 * Reads the current `billing/stripe` doc, computes the account-status bucket,
 * and mirrors `{ accountStatus, gracePeriodEndsAt }` onto the salon root doc
 * so non-owner members can see the lock state without being granted read
 * access to the billing doc.
 *
 * Idempotent and safe to call multiple times in a single webhook.
 */
async function recomputeAccountStatus(salonId) {
  if (!salonId) return;
  const fs = admin.firestore();
  const billingSnap = await fs.doc(`salons/${salonId}/billing/stripe`).get();

  let accountStatus = "active";
  let gracePeriodEndsAt = null;
  if (billingSnap.exists) {
    const data = billingSnap.data() || {};
    accountStatus = classifyAccountStatus(data.status);
    gracePeriodEndsAt = data.gracePeriodEndsAt || null;
  }

  await fs.doc(`salons/${salonId}`).set(
    {
      accountStatus,
      gracePeriodEndsAt:
        gracePeriodEndsAt || admin.firestore.FieldValue.delete(),
      accountStatusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  logger.info("[billing guard] recomputed accountStatus", {
    salonId,
    accountStatus,
    hasGrace: !!gracePeriodEndsAt,
  });
}

async function resolveSalonId(stripe, obj) {
  if (!obj) return null;

  // 1) direct metadata
  if (obj.metadata?.salonId) return String(obj.metadata.salonId);

  // 2) checkout sessions carry client_reference_id
  if (obj.client_reference_id) return String(obj.client_reference_id);

  // 3) subscription metadata (invoice → subscription)
  const subId =
    typeof obj.subscription === "string"
      ? obj.subscription
      : obj.subscription?.id;
  if (subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      if (sub?.metadata?.salonId) return String(sub.metadata.salonId);
    } catch (e) {
      logger.warn("[stripe webhook] subscription lookup failed", e?.message);
    }
  }

  // 4) customer metadata
  const customerId =
    typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
  if (customerId) {
    try {
      const cust = await stripe.customers.retrieve(customerId);
      if (cust && !cust.deleted && cust.metadata?.salonId) {
        return String(cust.metadata.salonId);
      }
    } catch (e) {
      logger.warn("[stripe webhook] customer lookup failed", e?.message);
    }
  }

  return null;
}

exports.stripeWebhook = onRequest(
  {
    region: REGION,
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
    cors: false,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }
    const sig = req.headers["stripe-signature"];
    if (!sig) {
      logger.warn("[stripe webhook] missing stripe-signature header");
      return res.status(400).send("Missing signature");
    }
    if (!req.rawBody) {
      logger.error("[stripe webhook] req.rawBody not available");
      return res.status(400).send("Missing raw body");
    }

    const stripe = getStripe();
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (err) {
      logger.error("[stripe webhook] signature verification failed", err?.message);
      return res.status(400).send(`Webhook Error: ${err?.message}`);
    }

    const eventRef = admin.firestore().doc(`stripeWebhookEvents/${event.id}`);
    const existingEvent = await eventRef.get();
    if (existingEvent.exists) {
      logger.info("[stripe webhook] duplicate event, skipping", { id: event.id });
      return res.status(200).json({ received: true, duplicate: true });
    }

    try {
      const obj = event.data?.object || {};
      const salonId = await resolveSalonId(stripe, obj);

      switch (event.type) {
        case "checkout.session.completed": {
          if (obj.subscription) {
            const subId =
              typeof obj.subscription === "string"
                ? obj.subscription
                : obj.subscription.id;
            const sub = await stripe.subscriptions.retrieve(subId);
            await persistSubscriptionState(salonId, sub);
            await recomputeAccountStatus(salonId);
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          await persistSubscriptionState(salonId, obj);
          await recomputeAccountStatus(salonId);
          break;
        }
        case "invoice.paid": {
          await persistInvoiceState(salonId, obj);
          // Successful payment ends any in-flight grace period.
          await clearGracePeriod(salonId);
          await recomputeAccountStatus(salonId);
          break;
        }
        case "invoice.payment_failed": {
          await persistInvoiceState(salonId, obj);
          // First failure starts the 14-day countdown; consecutive failures
          // are no-ops (ensureGracePeriodStarted is idempotent).
          await ensureGracePeriodStarted(salonId, GRACE_PERIOD_DAYS);
          await recomputeAccountStatus(salonId);
          break;
        }
        default:
          logger.info("[stripe webhook] unhandled event type", {
            type: event.type,
            id: event.id,
          });
      }

      await eventRef.set({
        id: event.id,
        type: event.type,
        salonId: salonId || null,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ received: true });
    } catch (err) {
      logger.error("[stripe webhook] handler error", {
        eventId: event?.id,
        type: event?.type,
        message: err?.message,
        stack: err?.stack,
      });
      return res.status(500).send("Internal handler error");
    }
  }
);
