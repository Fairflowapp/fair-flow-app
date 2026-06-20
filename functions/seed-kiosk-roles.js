/**
 * Seed the built-in kiosk role into each salon's roles subcollection
 * (Stage 0: data model).
 *
 * Roles are stored PER-SALON at: salons/{salonId}/roles/{roleId}
 * This script writes salons/{salonId}/roles/technician-kiosk from the single
 * source of truth in ./kiosk/permissions.js. Idempotent: safe to re-run.
 *
 * STAGING ONLY. This script HARD-REFUSES to run against the production project.
 *
 * Usage:
 *   # Seed the default kiosk role into ALL salons in the project:
 *   FF_SEED_PROJECT=fair-flow-staging node functions/seed-kiosk-roles.js
 *
 *   # Seed only a single salon:
 *   FF_SEED_PROJECT=fair-flow-staging FF_SEED_SALON=<salonId> \
 *     node functions/seed-kiosk-roles.js
 *
 * Credentials: set GOOGLE_APPLICATION_CREDENTIALS to a staging service-account
 * key, or use gcloud application-default credentials pointing at staging.
 */

const admin = require("firebase-admin");
const {
  TECHNICIAN_KIOSK_ROLE_ID,
  TECHNICIAN_KIOSK_ROLE,
} = require("./kiosk/permissions");

// Projects this script must never touch.
const PRODUCTION_PROJECT_IDS = ["fairflowapp-db841"];
const EXPECTED_STAGING_PROJECT_ID = "fair-flow-staging";

function resolveProjectId() {
  return (
    process.env.FF_SEED_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ""
  ).trim();
}

function assertSafeProject(projectId) {
  if (!projectId) {
    throw new Error(
      "No project id resolved. Set FF_SEED_PROJECT=fair-flow-staging before running."
    );
  }
  if (PRODUCTION_PROJECT_IDS.includes(projectId)) {
    throw new Error(
      `Refusing to seed production project "${projectId}". This script is staging-only.`
    );
  }
  if (projectId !== EXPECTED_STAGING_PROJECT_ID) {
    // Allow other non-prod projects (e.g. emulator) but make it loud.
    console.warn(
      `⚠️  Project "${projectId}" is not the expected staging project ` +
        `("${EXPECTED_STAGING_PROJECT_ID}"). Continuing because it is not production.`
    );
  }
}

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

// Seed the default kiosk role into one salon's roles subcollection.
// IMPORTANT: write the default ONLY on first creation. If the role already
// exists, do NOT touch it — a salon may have customized its permissions, and a
// re-run must never clobber that customization.
async function seedSalon(db, salonId) {
  const ref = db
    .collection("salons")
    .doc(salonId)
    .collection("roles")
    .doc(TECHNICIAN_KIOSK_ROLE_ID);

  const existing = await ref.get();
  if (existing.exists) {
    console.log(
      `   ⏭️  salons/${salonId}/roles/${TECHNICIAN_KIOSK_ROLE_ID} ` +
        `already exists — preserving customization, not touching permissions`
    );
    return false;
  }

  await ref.set(buildNewRolePayload());
  console.log(`   ✅ salons/${salonId}/roles/${TECHNICIAN_KIOSK_ROLE_ID} created`);
  return true;
}

async function listTargetSalonIds(db) {
  const single = (process.env.FF_SEED_SALON || "").trim();
  if (single) return [single];
  const snap = await db.collection("salons").get();
  return snap.docs.map((d) => d.id);
}

async function seedKioskRoles() {
  const projectId = resolveProjectId();
  assertSafeProject(projectId);

  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  const db = admin.firestore();

  console.log(`🌱 Seeding kiosk role into project: ${projectId}\n`);

  const salonIds = await listTargetSalonIds(db);
  if (salonIds.length === 0) {
    console.log("   (no salons found — nothing to seed)");
  }
  let created = 0;
  for (const salonId of salonIds) {
    if (await seedSalon(db, salonId)) created += 1;
  }
  const preserved = salonIds.length - created;

  console.log(
    `\n🎉 Done. "${TECHNICIAN_KIOSK_ROLE_ID}": ${created} created, ` +
      `${preserved} preserved (already existed), across ${salonIds.length} salon(s).`
  );
  console.log(
    "   default permissions (applied to new roles only):",
    JSON.stringify(TECHNICIAN_KIOSK_ROLE.permissions, null, 2)
  );
}

seedKioskRoles()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  });
