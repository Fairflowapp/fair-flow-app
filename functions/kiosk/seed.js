/**
 * Kiosk feature — shared seeding logic (Stage 2).
 *
 * Single source of truth for HOW the default kiosk role is written, reused by:
 *   - the Firestore trigger seedKioskRoleOnSalonCreate (new salons)
 *   - the callable backfillKioskRoles (existing salons)
 *   - the standalone CLI seed script (functions/seed-kiosk-roles.js)
 *
 * NON-DESTRUCTIVE by design: the default role is written ONLY on first
 * creation. If the role already exists, it is left untouched so a salon's
 * customizations to its permissions are never clobbered.
 */

const admin = require("firebase-admin");
const {
  TECHNICIAN_KIOSK_ROLE_ID,
  TECHNICIAN_KIOSK_ROLE,
} = require("./permissions");

// Full default payload, written ONLY when the role is first created.
function buildNewRolePayload() {
  return {
    name: TECHNICIAN_KIOSK_ROLE.name,
    isSystem: TECHNICIAN_KIOSK_ROLE.isSystem,
    permissions: TECHNICIAN_KIOSK_ROLE.permissions,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Ensure salons/{salonId}/roles/technician-kiosk exists.
 * Creates it from the default template only if missing.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} salonId
 * @return {Promise<boolean>} true if created, false if it already existed.
 */
async function ensureKioskRoleForSalon(db, salonId) {
  if (!salonId) throw new Error("ensureKioskRoleForSalon: salonId is required");

  const ref = db
    .collection("salons")
    .doc(salonId)
    .collection("roles")
    .doc(TECHNICIAN_KIOSK_ROLE_ID);

  const existing = await ref.get();
  if (existing.exists) return false;

  await ref.set(buildNewRolePayload());
  return true;
}

/**
 * Seed the default kiosk role into every salon in the project.
 * Used by the one-time backfill paths. Non-destructive per salon.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @return {Promise<{total:number, created:number, preserved:number}>}
 */
async function backfillAllSalons(db) {
  const snap = await db.collection("salons").get();
  let created = 0;
  for (const doc of snap.docs) {
    if (await ensureKioskRoleForSalon(db, doc.id)) created += 1;
  }
  return { total: snap.size, created, preserved: snap.size - created };
}

module.exports = {
  buildNewRolePayload,
  ensureKioskRoleForSalon,
  backfillAllSalons,
};
