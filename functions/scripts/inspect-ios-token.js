/*
 * One-off diagnostic: inspect the iOS device token for a specific staff.
 * Uses Application Default Credentials from `firebase login`.
 *
 * Usage:
 *   FF_SALON_ID=EtVq2h5xnWj4YEc4d5Vc \
 *   FF_STAFF_ID=staff_1778699466328_c55a71f7h \
 *   node scripts/inspect-ios-token.js
 */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FF_PROJECT_ID || "fairflowapp-db841",
  });
}

(async () => {
  const salonId = process.env.FF_SALON_ID;
  const staffId = process.env.FF_STAFF_ID;
  if (!salonId || !staffId) {
    console.error("Set FF_SALON_ID and FF_STAFF_ID env vars");
    process.exit(1);
  }

  const snap = await admin.firestore()
    .collection(`salons/${salonId}/staffDeviceTokens`)
    .where("staffId", "==", staffId)
    .get();

  console.log(`Found ${snap.size} token doc(s) for staff ${staffId}`);
  snap.forEach((d) => {
    const data = d.data() || {};
    const token = String(data.token || "");
    console.log("---", d.id, "---");
    console.log({
      platform: data.platform,
      enabled: data.enabled,
      deviceId: data.deviceId,
      tokenLength: token.length,
      tokenPrefix: token.slice(0, 24),
      tokenSuffix: token.slice(-24),
      hasColon: token.includes(":"),
      isOnlyHex: /^[0-9a-fA-F]+$/.test(token),
      updatedAt: data.updatedAt && data.updatedAt.toDate ? data.updatedAt.toDate().toISOString() : null,
      disabledReason: data.disabledReason || null,
      disabledAt: data.disabledAt && data.disabledAt.toDate ? data.disabledAt.toDate().toISOString() : null,
    });
  });

  const debugSnap = await admin.firestore()
    .collection(`salons/${salonId}/_debugPushSends`)
    .orderBy("at", "desc")
    .limit(3)
    .get();
  console.log(`\nLatest ${debugSnap.size} _debugPushSends doc(s):`);
  debugSnap.forEach((d) => {
    console.log("---", d.id, "---");
    console.log(JSON.stringify(d.data(), null, 2));
  });

  process.exit(0);
})().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
