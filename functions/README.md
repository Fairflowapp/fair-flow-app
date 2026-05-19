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

## Stripe Subscriptions (test mode)

Lives entirely in `functions/stripe.js` and is registered from `index.js` via a single `Object.assign(exports, require("./stripe"))` line.

### Products / Prices

| SKU        | Product                       | Price        | Quantity                     |
| ---------- | ----------------------------- | ------------ | ---------------------------- |
| `base`     | Fair Flow – Base Plan         | $99 / month  | always `1`                   |
| `location` | Fair Flow – Additional Location | $79 / month | number of extra locations    |
| `storage`  | Fair Flow – Extra Storage     | $10 / month  | number of 10 GB blocks       |

### One-time setup (production project: `fairflowapp-db841`)

1. **Stripe Secret Key** — already set:

   ```bash
   firebase functions:secrets:access STRIPE_SECRET_KEY --project fairflowapp-db841
   # → starts with sk_test_…
   ```

2. **Webhook Signing Secret** — create after deploying `stripeWebhook`:

   ```bash
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project fairflowapp-db841
   # paste whsec_… from Stripe Dashboard → Developers → Webhooks → reveal signing secret
   ```

3. **Price IDs** — add to `functions/.env` (or `.env.fairflowapp-db841`):

   ```
   STRIPE_PRICE_BASE=price_...
   STRIPE_PRICE_LOCATION=price_...
   STRIPE_PRICE_STORAGE=price_...
   ```

4. **Deploy** (first time, all three new functions):

   ```bash
   firebase deploy \
     --only functions:createStripeCheckoutSession,functions:createStripePortalSession,functions:stripeWebhook \
     --project fairflowapp-db841
   ```

5. **Register the webhook in Stripe** — Dashboard → Developers → Webhooks → "Add endpoint":

   - URL: `https://us-central1-fairflowapp-db841.cloudfunctions.net/stripeWebhook`
   - Listen to events:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`
   - After creating, copy the signing secret into `STRIPE_WEBHOOK_SECRET` (step 2) and redeploy `stripeWebhook` once.

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

### Testing in test mode

1. Deploy `createStripeCheckoutSession` + `stripeWebhook`.
2. From a signed-in owner session in your front-end, call
   `createStripeCheckoutSession` with a `base` item and any optional
   location/storage quantities. Open the returned `url` in the browser.
3. Use Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC.
4. After completion, check `salons/{salonId}/billing/stripe` in Firestore —
   `status` should be `active` and `items.base.quantity` should be `1`.
5. To watch webhooks locally without deploying, use the Stripe CLI:

   ```bash
   stripe listen --forward-to https://us-central1-fairflowapp-db841.cloudfunctions.net/stripeWebhook
   stripe trigger checkout.session.completed
   ```

