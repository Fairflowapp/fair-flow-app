/*
 * Diagnostic: list every staffDeviceTokens doc for a salon and group by
 * staffId, deviceId and token. Helps detect duplicates or mis-tagged tokens
 * that cause "all staff get notified" bugs.
 *
 * Usage:
 *   FF_SALON_ID=EtVq2h5xnWj4YEc4d5Vc node scripts/list-staff-tokens.js
 */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FF_PROJECT_ID || "fairflowapp-db841",
  });
}

(async () => {
  const salonId = process.env.FF_SALON_ID;
  if (!salonId) {
    console.error("Set FF_SALON_ID env var");
    process.exit(1);
  }

  const snap = await admin.firestore()
    .collection(`salons/${salonId}/staffDeviceTokens`)
    .get();

  console.log(`Salon ${salonId}: ${snap.size} token doc(s) total\n`);

  const byStaffId = new Map();
  const byDeviceId = new Map();
  const byTokenValue = new Map();

  snap.forEach((d) => {
    const data = d.data() || {};
    const token = String(data.token || "");
    const row = {
      docId: d.id,
      staffId: data.staffId || "",
      staffName: data.staffName || "",
      uid: data.uid || "",
      deviceId: data.deviceId || "",
      platform: data.platform || "",
      enabled: data.enabled !== false,
      tokenLength: token.length,
      tokenSuffix: token.length > 16 ? `...${token.slice(-16)}` : token,
      isApnsRaw: /^[0-9a-fA-F]+$/.test(token) && token.length === 64,
      updatedAt: data.updatedAt && data.updatedAt.toDate ? data.updatedAt.toDate().toISOString() : null,
      disabledReason: data.disabledReason || null,
    };

    if (!byStaffId.has(row.staffId)) byStaffId.set(row.staffId, []);
    byStaffId.get(row.staffId).push(row);

    if (!byDeviceId.has(row.deviceId)) byDeviceId.set(row.deviceId, []);
    byDeviceId.get(row.deviceId).push(row);

    if (token) {
      if (!byTokenValue.has(token)) byTokenValue.set(token, []);
      byTokenValue.get(token).push(row);
    }
  });

  console.log("=== By staffId (who would receive on call) ===");
  Array.from(byStaffId.entries()).forEach(([staffId, rows]) => {
    console.log(`\nstaffId=${staffId} (${rows.length} doc(s))`);
    rows.forEach((r) => {
      const flags = [];
      if (!r.enabled) flags.push("disabled");
      if (r.isApnsRaw) flags.push("APNs-raw!");
      console.log(`  - ${r.docId}`);
      console.log(`    platform=${r.platform} deviceId=${r.deviceId} uid=${r.uid}`);
      console.log(`    staffName="${r.staffName}" tokenLen=${r.tokenLength} suffix=${r.tokenSuffix}`);
      console.log(`    enabled=${r.enabled} updatedAt=${r.updatedAt} ${flags.join(" ")}`);
    });
  });

  console.log("\n=== Same deviceId across multiple staffIds (likely cause of all-staff bug) ===");
  let foundDeviceDup = false;
  Array.from(byDeviceId.entries()).forEach(([deviceId, rows]) => {
    const distinctStaffIds = new Set(rows.map((r) => r.staffId));
    if (distinctStaffIds.size > 1) {
      foundDeviceDup = true;
      console.log(`\ndeviceId=${deviceId} attached to ${distinctStaffIds.size} different staffIds:`);
      rows.forEach((r) => {
        console.log(`  - staffId=${r.staffId} staffName="${r.staffName}" enabled=${r.enabled} suffix=${r.tokenSuffix}`);
      });
    }
  });
  if (!foundDeviceDup) console.log("(none)");

  console.log("\n=== Same token value attached to multiple staffIds ===");
  let foundTokenDup = false;
  Array.from(byTokenValue.entries()).forEach(([token, rows]) => {
    const distinctStaffIds = new Set(rows.map((r) => r.staffId));
    if (distinctStaffIds.size > 1) {
      foundTokenDup = true;
      console.log(`\ntoken=${token.slice(0, 16)}...${token.slice(-16)} attached to ${distinctStaffIds.size} staffIds:`);
      rows.forEach((r) => {
        console.log(`  - staffId=${r.staffId} staffName="${r.staffName}" enabled=${r.enabled}`);
      });
    }
  });
  if (!foundTokenDup) console.log("(none)");

  process.exit(0);
})().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
