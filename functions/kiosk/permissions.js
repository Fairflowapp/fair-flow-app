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

// Canonical capability catalog. This is the full known surface of kiosk
// capabilities. Use these constants instead of raw strings so a typo fails
// loudly at import time rather than silently granting/denying.
const CAPABILITIES = Object.freeze({
  // Queue / floor
  QUEUE_VIEW: "queue.view",
  QUEUE_JOIN: "queue.join",
  QUEUE_LEAVE: "queue.leave",
  QUEUE_PAUSE: "queue.pause", // temporary "be right back" / break from queue
  SERVICE_START: "service.start",
  SERVICE_END: "service.end",

  // Time clock
  TIMECLOCK_VIEW: "timeclock.view",
  TIMECLOCK_CLOCK_IN: "timeclock.clockIn",
  TIMECLOCK_CLOCK_OUT: "timeclock.clockOut",
  TIMECLOCK_BREAK_START: "timeclock.breakStart",
  TIMECLOCK_BREAK_END: "timeclock.breakEnd",

  // Inventory
  INVENTORY_ADD_ITEM: "inventory.addItem",
  INVENTORY_ADJUST_STOCK: "inventory.adjustStock",
  INVENTORY_EDIT_PRICE: "inventory.editPrice",
  INVENTORY_CREATE_ORDER: "inventory.createOrder",

  // Other modules
  TASKS_VIEW_TECHNICIANS: "tasks.viewTechnicians",
  TASKS_VIEW_MANAGERS: "tasks.viewManagers",
  TASKS_COMPLETE: "tasks.complete",
  SCHEDULE_VIEW_OWN: "schedule.viewOwn",
  REQUESTS_CREATE: "requests.create",
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
  // Every known capability is listed explicitly (true = allowed, false =
  // denied). Listing sensitive denials explicitly — rather than omitting them —
  // makes intent unambiguous for Stage 4 Security Rules enforcement.
  permissions: Object.freeze({
    // Queue / floor — daily personal floor actions
    [CAPABILITIES.QUEUE_VIEW]: true,
    [CAPABILITIES.QUEUE_JOIN]: true,
    [CAPABILITIES.QUEUE_LEAVE]: true,
    [CAPABILITIES.QUEUE_PAUSE]: true,
    [CAPABILITIES.SERVICE_START]: true,
    [CAPABILITIES.SERVICE_END]: true,

    // Time clock — clock in/out + breaks
    [CAPABILITIES.TIMECLOCK_VIEW]: true,
    [CAPABILITIES.TIMECLOCK_CLOCK_IN]: true,
    [CAPABILITIES.TIMECLOCK_CLOCK_OUT]: true,
    [CAPABILITIES.TIMECLOCK_BREAK_START]: true,
    [CAPABILITIES.TIMECLOCK_BREAK_END]: true,

    // Inventory — may add/count items only; everything money/management is off
    [CAPABILITIES.INVENTORY_ADD_ITEM]: true,
    [CAPABILITIES.INVENTORY_ADJUST_STOCK]: false,
    [CAPABILITIES.INVENTORY_EDIT_PRICE]: false,
    [CAPABILITIES.INVENTORY_CREATE_ORDER]: false,

    // Other modules
    [CAPABILITIES.TASKS_VIEW_TECHNICIANS]: true,
    [CAPABILITIES.TASKS_VIEW_MANAGERS]: false,
    [CAPABILITIES.TASKS_COMPLETE]: true,
    [CAPABILITIES.SCHEDULE_VIEW_OWN]: false,
    [CAPABILITIES.REQUESTS_CREATE]: false,
  }),
});

module.exports = {
  CAPABILITIES,
  TECHNICIAN_KIOSK_ROLE_ID,
  TECHNICIAN_KIOSK_ROLE,
};
