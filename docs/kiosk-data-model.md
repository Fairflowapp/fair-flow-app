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
`functions/kiosk/permissions.js`):

| Capability             | Value |
| ---------------------- | ----- |
| `queue.join`           | true  |
| `queue.leave`          | true  |
| `timeclock.use`        | true  |
| `inventory.addItem`    | true  |
| `inventory.editPrice`  | false |

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

## Seeding (staging only)

The default role is seeded **per salon** by an idempotent script that
**hard-refuses** to run against production (`fairflowapp-db841`):

```bash
# All salons in the project:
FF_SEED_PROJECT=fair-flow-staging node functions/seed-kiosk-roles.js

# A single salon:
FF_SEED_PROJECT=fair-flow-staging FF_SEED_SALON=<salonId> \
  node functions/seed-kiosk-roles.js
```

Each salon gets its own `salons/{salonId}/roles/technician-kiosk` document, so a
business can later customize its copy without affecting other salons.

**Re-run behavior (non-destructive):** the default permissions are written
**only when the role is first created**. If the role already exists, the seed
**skips it entirely** and never touches `permissions` — so re-running the script
can never clobber a salon's customizations.

## What Stage 0 intentionally does NOT include

- No UI, no `/kiosk` route.
- No pairing codes / custom tokens yet (Stage 1).
- No Security Rules enforcement yet (Stage 4) — `kiosks`, `roles`, and
  `pairingCodes` rules are added in their respective stages.
- No new queue / time-clock logic — those existing functions are reused later.
