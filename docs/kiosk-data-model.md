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
