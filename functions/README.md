# Cloud Functions for Admin PIN Reset

This directory contains Firebase Cloud Functions for the secure email-based admin PIN reset workflow.

## Setup Instructions

### 1. Install Dependencies

```bash
cd functions
npm install
```

### 2. Configure Email Settings

Set up Firebase Functions config for email authentication:

```bash
firebase functions:config:set email.user="your_email@gmail.com" email.password="your_app_password"
```

**Note:** For Gmail, you'll need to:
- Enable 2-factor authentication
- Generate an "App Password" (not your regular password)
- Use the app password in the config

### 3. Update APP_BASE_URL

Edit `functions/index.js` and update the `APP_BASE_URL` constant to your actual domain:

```javascript
const APP_BASE_URL = 'https://your-actual-domain.com';
```

### 4. Deploy Functions

```bash
firebase deploy --only functions
```

## Functions

### `generatePinResetLink`

- **Type:** Callable Function (requires authentication)
- **Purpose:** Generates a secure reset token and emails a reset link to the logged-in owner
- **Returns:** Success message

### `confirmPinReset`

- **Type:** Callable Function (public, no authentication required)
- **Purpose:** Validates a reset token and updates the admin PIN in Firestore
- **Parameters:** `{ token: string, newPin: string }`
- **Returns:** Success message

## Security Notes

⚠️ **Important:** The PIN is stored as a **hashed value** using bcrypt. If your existing PIN verification code performs direct string comparison, you'll need to update it to use `bcrypt.compare()` instead.

## Firestore Structure

- **Tokens Collection:** `pinResetTokens/{token}`
  - `salonId`: string
  - `createdAt`: Timestamp
  - `expiresAt`: Timestamp (1 hour from creation)
  - `ownerEmail`: string

- **Salon Document:** `salons/{salonId}`
  - `adminPin`: string (hashed with bcrypt)
  - `pinLastReset`: Timestamp

## Testing

1. Test `generatePinResetLink`:
   - Log in as an owner
   - Click "Forgot Admin PIN?"
   - Check email for reset link

2. Test `confirmPinReset`:
   - Click the reset link from email
   - Enter new PIN
   - Verify PIN is updated in Firestore

---

## Stripe Subscriptions

Lives entirely in `functions/stripe.js` and is registered from `index.js` via a single `Object.assign(exports, require("./stripe"))` line.

### Modes & strict per-project isolation

Two Firebase projects, two Stripe modes, no shared values:

| Firebase project        | Stripe mode | env file                              | Secret Manager values                                  |
| ----------------------- | ----------- | ------------------------------------- | ------------------------------------------------------ |
| `fair-flow-staging`     | TEST        | `functions/.env.fair-flow-staging`    | `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET=whsec_…` (test endpoint) |
| `fairflowapp-db841`     | LIVE        | `functions/.env.fairflowapp-db841`    | `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_WEBHOOK_SECRET=whsec_…` (live endpoint) |

The shared `functions/.env` MUST NOT contain any `STRIPE_PRICE_*` line — only project-agnostic vars (e.g. SMTP). This guarantees a deploy can never silently pick test prices in production or vice-versa.

### Products / Prices

| SKU        | Product                       | Price        | Quantity                     |
| ---------- | ----------------------------- | ------------ | ---------------------------- |
| `base`     | Fair Flow – Base Plan         | $99 / month  | always `1`                   |
| `location` | Fair Flow – Additional Location | $79 / month | number of extra locations    |
| `storage`  | Fair Flow – Extra Storage     | $10 / month  | number of 10 GB blocks       |

### One-time setup — PRODUCTION (`fairflowapp-db841`, Stripe LIVE mode)

1. **Stripe Secret Key (LIVE):**

   ```bash
   firebase functions:secrets:set STRIPE_SECRET_KEY --project fairflowapp-db841
   # paste sk_live_… from Stripe Dashboard (LIVE mode) → Developers → API keys
   ```

   Verify (does NOT print the value, only confirms it exists):

   ```bash
   firebase functions:secrets:access STRIPE_SECRET_KEY --project fairflowapp-db841 | head -c 8
   # → sk_live_  (any other prefix is wrong; must be exactly `sk_live_`)
   ```

2. **Webhook endpoint in Stripe Dashboard (LIVE mode):**

   - Toggle Stripe Dashboard from "Test mode" → "Live mode" (top-right).
   - Developers → Webhooks → "Add endpoint":
     - URL: `https://us-central1-fairflowapp-db841.cloudfunctions.net/stripeWebhook`
     - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
   - After saving, click "Reveal" on the Signing Secret and copy the `whsec_…`.

3. **Webhook Signing Secret (LIVE):**

   ```bash
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project fairflowapp-db841
   # paste whsec_… from the LIVE webhook endpoint created in step 2
   ```

4. **Price IDs (LIVE)** — fill in `functions/.env.fairflowapp-db841` (the file already exists with placeholders):

   ```
   STRIPE_PRICE_BASE=price_...      ← LIVE Base Plan
   STRIPE_PRICE_LOCATION=price_...  ← LIVE Additional Location
   STRIPE_PRICE_STORAGE=price_...   ← LIVE Extra Storage
   ```

   Find these in Stripe Dashboard (LIVE mode) → Products → each product's recurring price.

5. **Deploy** the four Stripe functions to production:

   ```bash
   firebase deploy \
     --only functions:createStripeCheckoutSession,functions:createStripePortalSession,functions:syncStripeSubscription,functions:stripeWebhook \
     --project fairflowapp-db841
   ```

### One-time setup — STAGING (`fair-flow-staging`, Stripe TEST mode)

Mirror of the above using TEST-mode values:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY     --project fair-flow-staging   # sk_test_…
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project fair-flow-staging   # whsec_… of TEST webhook
```

`functions/.env.fair-flow-staging` already contains the existing TEST price IDs.

### Switching production from TEST to LIVE — checklist

When migrating an existing test-mode production deployment to live mode:

- [ ] LIVE products + prices created in Stripe Dashboard (LIVE mode).
- [ ] `functions/.env.fairflowapp-db841` updated with the three LIVE `price_…` values (no `REPLACE_WITH_LIVE_…` placeholders left).
- [ ] `STRIPE_SECRET_KEY` in Secret Manager (project `fairflowapp-db841`) replaced with `sk_live_…`.
- [ ] LIVE webhook endpoint created in Stripe Dashboard pointing to `https://us-central1-fairflowapp-db841.cloudfunctions.net/stripeWebhook`.
- [ ] `STRIPE_WEBHOOK_SECRET` in Secret Manager (project `fairflowapp-db841`) replaced with the LIVE endpoint's `whsec_…`.
- [ ] Old TEST webhook endpoint disabled or deleted from Stripe Dashboard (TEST mode) to avoid stale events.
- [ ] `firebase deploy --only functions:createStripeCheckoutSession,functions:createStripePortalSession,functions:syncStripeSubscription,functions:stripeWebhook --project fairflowapp-db841`
- [ ] First real $1 sanity charge on a real card → verify `salons/{salonId}/billing/stripe.status === "active"`.

### Functions

#### `createStripeCheckoutSession` — callable v2

Auth: signed-in user who is the salon owner (`salons/{salonId}.ownerUid === auth.uid`).

```js
const fns = getFunctions(app, "us-central1");
const callCheckout = httpsCallable(fns, "createStripeCheckoutSession");
const { data } = await callCheckout({
  salonId,
  items: [
    { sku: "base", quantity: 1 },
    { sku: "location", quantity: 2 }, // 2 extra locations
    { sku: "storage", quantity: 3 },  // 3 × 10 GB blocks
  ],
  successUrl: "https://app.fairflowapp.com/billing?status=success&session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://app.fairflowapp.com/billing?status=cancel",
});
window.location.href = data.url;
```

#### `createStripePortalSession` — callable v2

Returns a Stripe Billing Portal URL so the owner can update payment method, cancel, etc.

```js
const callPortal = httpsCallable(fns, "createStripePortalSession");
const { data } = await callPortal({
  salonId,
  returnUrl: "https://app.fairflowapp.com/billing",
});
window.location.href = data.url;
```

#### `stripeWebhook` — onRequest v2

Stripe → Firebase signed POST. Verifies the signature with `STRIPE_WEBHOOK_SECRET`, deduplicates per `event.id`, and writes to:

- `salons/{salonId}/billing/stripe` — single doc with the latest snapshot
- `stripeWebhookEvents/{eventId}` — idempotency markers

### Firestore data model

```
salons/{salonId}/billing/stripe           ← latest state, written by webhook
  customerId         "cus_…"
  subscriptionId     "sub_…"
  status             "active"|"trialing"|"past_due"|"canceled"|"incomplete"|…
  currentPeriodEnd   Timestamp
  cancelAtPeriodEnd  bool
  canceledAt         Timestamp | null
  items: {
    base:     { priceId, quantity, subscriptionItemId }
    location: { priceId, quantity, subscriptionItemId }
    storage:  { priceId, quantity, subscriptionItemId }
  }
  latestInvoice: { id, status, hostedInvoiceUrl, amountPaid, amountDue, paidAt }
  updatedAt          Timestamp

stripeWebhookEvents/{eventId}              ← idempotency markers (top-level)
  type, salonId, receivedAt
```

> Firestore rules are not modified by this PR — all writes happen via the
> Admin SDK, which bypasses rules. Add a manager-read rule for
> `salons/{salonId}/billing/{docId}` when wiring up the UI.

### Testing on staging (TEST mode, `fair-flow-staging`)

1. Confirm the active project is staging: `firebase use fair-flow-staging`.
2. Deploy `createStripeCheckoutSession` + `stripeWebhook` (and friends) to staging.
3. From a signed-in owner session in your front-end, call
   `createStripeCheckoutSession` with a `base` item and any optional
   location/storage quantities. Open the returned `url` in the browser.
4. Use Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC.
5. After completion, check `salons/{salonId}/billing/stripe` in Firestore —
   `status` should be `active` and `items.base.quantity` should be `1`.
6. To watch webhooks locally without deploying, use the Stripe CLI in test mode:

   ```bash
   stripe listen --forward-to https://us-central1-fair-flow-staging.cloudfunctions.net/stripeWebhook
   stripe trigger checkout.session.completed
   ```

> **Never** use `4242 4242 4242 4242` against the production project. Live mode requires a real card; testing in production should be limited to a single $1 sanity charge that is then refunded from Stripe Dashboard.

