/**
 * Kiosk feature — permissions source of truth (Stage 0: data model).
 *
 * A "role" is a named, flat map of capability -> boolean.
 * Capability keys use a dotted "domain.action" convention so they stay
 * consistent with the existing `staff.permissions` map style in Firestore.
 *
 * Roles are stored PER-SALON at: salons/{salonId}/roles/{roleId}
 * The definition below is the DEFAULT TEMPLATE that gets seeded into each
 * salon's own roles subcollection. It is not a single global role — each
 * business owns its copy and may customize it later.
 *
 * This module is the SINGLE place where the default kiosk role and its
 * capabilities are defined. It is consumed by:
 *   - the seed script (functions/seed-kiosk-roles.js)
 *   - later stages: the pairing Cloud Function (to stamp claims) and the
 *     Security Rules reference for server-side enforcement.
 *
 * No business logic here — definitions only.
 */

// Canonical capability keys. Use these constants instead of raw strings so a
// typo fails loudly at import time rather than silently granting/denying.
const CAPABILITIES = Object.freeze({
  QUEUE_JOIN: "queue.join",
  QUEUE_LEAVE: "queue.leave",
  TIMECLOCK_USE: "timeclock.use",
  INVENTORY_ADD_ITEM: "inventory.addItem",
  INVENTORY_EDIT_PRICE: "inventory.editPrice",
});

// Stable identifier for the built-in kiosk role document, stored per salon at:
// salons/{salonId}/roles/{TECHNICIAN_KIOSK_ROLE_ID}
const TECHNICIAN_KIOSK_ROLE_ID = "technician-kiosk";

/**
 * Default role used by shared in-salon kiosk devices.
 * `permissions` is a flat map of capability -> boolean, exactly as it will be
 * stored at salons/{salonId}/roles/technician-kiosk in Firestore.
 */
const TECHNICIAN_KIOSK_ROLE = Object.freeze({
  name: "Technician Kiosk",
  // isSystem marks this as a built-in default template role (seeded into every
  // salon), as opposed to a custom role a business creates for itself later.
  isSystem: true,
  permissions: Object.freeze({
    [CAPABILITIES.QUEUE_JOIN]: true,
    [CAPABILITIES.QUEUE_LEAVE]: true,
    [CAPABILITIES.TIMECLOCK_USE]: true,
    [CAPABILITIES.INVENTORY_ADD_ITEM]: true,
    [CAPABILITIES.INVENTORY_EDIT_PRICE]: false,
  }),
});

module.exports = {
  CAPABILITIES,
  TECHNICIAN_KIOSK_ROLE_ID,
  TECHNICIAN_KIOSK_ROLE,
};
