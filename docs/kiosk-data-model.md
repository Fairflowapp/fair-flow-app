# Kiosk Data Model (Stage 0)

A **kiosk** is a shared tablet that sits in the salon. Technicians walk up to it
throughout the day to join/leave the queue and clock in/out, identifying
themselves with their existing short **PIN** — no full login per person.

## Two identity layers (important)

| Question        | Answered by                          | Stored as                                       |
| --------------- | ------------------------------------ | ----------------------------------------------- |
| *Which device?* | pairing + custom token (auth claims) | `salons/{salonId}/kiosks/{kioskId}` + auth acct |
| *Which person?* | the technician's short PIN           | existing `staff` doc (unchanged)                |

- The **token/claims** say *which device* this is.
- The **PIN** says *which person* is acting right now.
- A kiosk is a **device, not a staff member**: it has no commission, no payroll,
  and must never appear in the staff list. It lives in its own `kiosks`
  subcollection and is **never** written to `staff`.

## Collections

Both collections are **nested under the salon**, consistent with the rest of the
app (`salons/{salonId}/...`). This means the `salonId` always comes from the
document path, which keeps Stage 4 Security Rules simple (reuse
`belongsToSalon()`) and isolates data per salon so each business can define its
own roles later.

### `salons/{salonId}/roles/{roleId}`
Per-salon role definitions. `permissions` is a **flat map** of
`capability -> boolean`, matching the existing `staff.permissions` style.

```javascript
{
  name: string,            // display name, e.g. "Technician Kiosk"
  isSystem: boolean,       // true for built-in templates (non-deletable)
  permissions: {           // flat map: "domain.action" -> boolean
    "queue.join": boolean,
    "queue.leave": boolean,
    "timeclock.use": boolean,
    "inventory.addItem": boolean,
    "inventory.editPrice": boolean
  },
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

**Default role `salons/{salonId}/roles/technician-kiosk`** — seeded into every
salon from the shared template (source of truth:
`functions/kiosk/permissions.js`). Every known capability is listed explicitly
(sensitive denials kept as `false` rather than omitted):

| Capability                | Value | Notes                              |
| ------------------------- | ----- | ---------------------------------- |
| `queue.join`              | true  |                                    |
| `queue.leave`             | true  |                                    |
| `queue.pause`             | true  | "be right back" / break from queue |
| `service.start`           | true  |                                    |
| `service.end`             | true  |                                    |
| `timeclock.clockIn`       | true  |                                    |
| `timeclock.clockOut`      | true  |                                    |
| `timeclock.breakStart`    | true  |                                    |
| `timeclock.breakEnd`      | true  |                                    |
| `inventory.addItem`       | true  | add / count items                  |
| `inventory.adjustStock`   | false | denied                             |
| `inventory.editPrice`     | false | denied                             |
| `inventory.createOrder`   | false | denied                             |
| `tasks.complete`          | true  | mark assigned task done            |
| `schedule.viewOwn`        | false | denied for now                     |
| `requests.create`         | false | denied for now                     |

### `salons/{salonId}/kiosks/{kioskId}`
One document per physical device. `businessId` mirrors the path `salonId` and is
kept on the doc for convenience (e.g. when minting auth claims).

```javascript
{
  name: string,            // human label, e.g. "Front desk tablet"
  locationId: string,      // which salon location this tablet lives at
  roleId: string,          // -> salons/{salonId}/roles/{roleId}, e.g. "technician-kiosk"
  businessId: string,      // = salonId (mirrors path; tenant scope)
  status: string,          // "active" | "disabled"
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

## Device pairing — `pairingCodes/{pairId}` (Stage 3a)

Pairing connects a physical tablet to a salon and issues it a kiosk auth token,
using a **trampoline** (Firestore-only, no callable). Security rests on one
idea: the **document id `pairId` is a high-entropy secret** known only to the
tablet, while the human-friendly **4-digit `code` is just a lookup field** for
the owner.

```javascript
// pairingCodes/{pairId}   (pairId = high-entropy random string, >= 20 chars)
{
  code: string,             // 4-digit, for the owner to type (lookup only)
  deviceSecretHash: string, // >=32 chars; hash of a tablet-local secret (never the secret)
  status: string,           // "pending" -> "approved" -> "tokenReady"
  createdAt: Timestamp,     // must equal request.time on create
  expiresAt: Timestamp,     // short, <= 15 min ahead

  // added by the owner on approval:
  salonId: string,          // approver's salon
  kioskName: string,
  locationId: string,

  // added by the Cloud Function (admin SDK) after approval:
  token: string,            // custom auth token (short-lived)
  tokenExpiresAt: Timestamp
}
```

### Flow
1. **Tablet (unauthenticated)** generates `pairId` (high entropy) + a 4-digit
   `code`, stores a local `deviceSecret`, and creates `pairingCodes/{pairId}`
   with `status: "pending"`. It listens to that doc **by its secret id**.
2. **Owner (authenticated admin/owner)** types the code in Settings → Devices.
   The client queries `where code == … && status == "pending"`, finds the
   `pairId`, and updates the doc to `status: "approved"` + `salonId` + kiosk name
   / location.
3. **Cloud Function** (Stage 3b) reacts to the approval, creates
   `salons/{salonId}/kiosks/{kioskId}`, self-heals the role, mints a custom token
   with claims `{ isKiosk, salonId, kioskId, roleId }`, and writes `token` +
   `tokenExpiresAt` back to the doc with `status: "tokenReady"`.
4. **Tablet** sees `tokenReady`, calls `signInWithCustomToken`, then **deletes
   the doc (delete-after-read)** and persists its session.

### Security Rules summary (`firestore.rules`)
| Op       | Who                          | Notes                                              |
| -------- | ---------------------------- | -------------------------------------------------- |
| `get`    | anyone with the exact id     | protected by the unguessable `pairId`              |
| `list`   | **authenticated admin/owner only** | the boundary: tablets can never scan/enumerate |
| `create` | unauthenticated tablet       | tight constraints; cannot pre-set token/salon      |
| `update` | authenticated admin/owner    | only `pending → approved`, own salon; cannot set token |
| `delete` | anyone with the exact id     | tablet's delete-after-read cleanup                 |

The `token` field is only ever written by the Cloud Function via the admin SDK
(which bypasses rules); no client write path can set it.

## Capability keys (canonical)

Defined once in `functions/kiosk/permissions.js` and reused everywhere
(seed script, the pairing Cloud Function that stamps claims in Stage 1, and the
Security Rules enforcement in Stage 4). Use the exported `CAPABILITIES`
constants rather than raw strings.

## Seeding the default role

All seeding paths share one non-destructive implementation in
`functions/kiosk/seed.js` (`ensureKioskRoleForSalon`): the default is written
**only when the role is first created**. If the role already exists it is left
untouched, so customizations are never clobbered. Each salon owns its own
`salons/{salonId}/roles/technician-kiosk`.

### 1. Auto-seed on salon creation (preferred, prod-safe)
`seedKioskRoleOnSalonCreate` — a Firestore trigger
(`onDocumentCreated('salons/{salonId}')`) that seeds the role automatically for
every newly created salon. Runs inside Google with built-in credentials; no
gcloud or service-account key required. Safe to use in production later.

### 2. Backfill existing salons (callable)
`backfillKioskRoles` — a callable function for salons that already existed
before the trigger was deployed:
- **Default mode** (safe, multi-tenant): seeds only the caller's own salon.
  Requires owner/admin of that salon.
- **Sweep mode** `{ allSalons: true }`: seeds every salon. Gated behind a
  platform super-admin custom claim (`token.superAdmin === true`) so a normal
  salon admin can never write into other businesses' salons.

### Deploy (STAGING ONLY)
Deploy **only** these two functions, with an explicit project (the repo's
`.firebaserc` default is production, so `--project` is mandatory):

```bash
firebase deploy \
  --only functions:seedKioskRoleOnSalonCreate,functions:backfillKioskRoles \
  --project fair-flow-staging
```

### 3. Standalone CLI script (optional)
`functions/seed-kiosk-roles.js` still exists for local/manual runs and
**hard-refuses** to run against production. It now reuses the same
`ensureKioskRoleForSalon` logic:

```bash
FF_SEED_PROJECT=fair-flow-staging node functions/seed-kiosk-roles.js
FF_SEED_PROJECT=fair-flow-staging FF_SEED_SALON=<salonId> \
  node functions/seed-kiosk-roles.js
```

## What Stage 0 intentionally does NOT include

- No UI, no `/kiosk` route.
- No pairing codes / custom tokens yet (Stage 1).
- No Security Rules enforcement yet (Stage 4) — `kiosks`, `roles`, and
  `pairingCodes` rules are added in their respective stages.
- No new queue / time-clock logic — those existing functions are reused later.

## Before production checklist

- Confirm the frontend source of truth is complete before any hosting deploy:
  `firebase.json` points to `public/`, so `public/index.html` and every JS asset
  it references must be present and tracked before production.
- Keep the environment switch intact in `public/index.html` (`FF_ENV` /
  hostname-based staging vs production config) so staging never talks to
  production by accident.
- Fix and verify the `backfillKioskRoles` callable deployment/IAM issue before
  production, because existing production salons need the default kiosk role.
- Verify required function service-account IAM in production before deploying
  pairing: `Service Account Token Creator` for custom-token minting and
  `Cloud Datastore User` / equivalent Firestore access for Gen1 triggers.
- Deploy and review Firestore Rules explicitly for the production project only
  after final approval; rules deployment replaces the whole ruleset.
- Run an end-to-end production rehearsal plan on staging first: create pending
  pairing code, approve from Settings -> Devices, confirm kiosk doc creation,
  token delivery, sign-in, and delete-after-read cleanup.
