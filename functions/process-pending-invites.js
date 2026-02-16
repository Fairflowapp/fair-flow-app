#!/usr/bin/env node
/**
 * Run locally to process pending staff invite requests.
 * Usage: node process-pending-invites.js
 * 
 * Requires: Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path,
 * OR run: gcloud auth application-default login
 */
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "fairflowapp-db841" });
}

const APP_BASE_URL = "https://app.fairflowapp.com";

async function sendStaffInviteInternal(data, auth) {
  const { staffId, salonId, email, role } = data;
  const emailValue = String(email || "").trim();
  const roleValue = String(role || "").trim();
  if (!emailValue || !roleValue) throw new Error("Missing email or role");

  let staffEmail = emailValue;
  if (staffId) {
    const staffDoc = await admin.firestore()
      .collection("salons").doc(salonId).collection("staff").doc(staffId)
      .get();
    if (staffDoc.exists) {
      staffEmail = (staffDoc.data()?.email || "").trim() || emailValue;
    }
  }

  const salonDoc = await admin.firestore().collection("salons").doc(salonId).get();
  const salonName = salonDoc.exists ? (salonDoc.data()?.name || "Your salon") : "Your salon";

  const rawToken = crypto.randomBytes(32).toString("hex");
  const inviteUrl = `${APP_BASE_URL}/create-password/${rawToken}`;
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);
  const emailLower = staffEmail.trim().toLowerCase();
  const expiresText = expiresAt.toDate ? expiresAt.toDate().toISOString() : String(expiresAt);

  await admin.firestore().collection("staffInviteTokens").add({
    staffId: staffId || null, salonId, email: staffEmail, tokenHash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt, usedAt: null
  });

  await admin.firestore().collection("salons").doc(salonId).collection("invites").add({
    emailLower, role: roleValue, token: rawToken, status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt, createdByUid: auth.uid, staffId: staffId || null, salonId
  });

  await admin.firestore().collection("mail").add({
    to: emailLower,
    message: {
      subject: `You're invited to join ${salonName} on Fair Flow`,
      text: `You have been invited to join ${salonName} on Fair Flow.\n\nRole: ${roleValue}\nInvite link: ${inviteUrl}\nExpires: ${expiresText}`
    }
  });
}

async function main() {
  const db = admin.firestore();
  const snap = await db.collection("staffInviteRequests")
    .where("status", "==", "pending")
    .get();

  if (snap.empty) {
    console.log("No pending requests found.");
    process.exit(0);
  }

  console.log("Found", snap.size, "pending request(s). Processing...");

  for (const doc of snap.docs) {
    const data = doc.data();
    const { createdByUid, salonId, staffId, email, role } = data;
    try {
      const userDoc = await db.doc(`users/${createdByUid}`).get();
      if (!userDoc.exists) {
        await doc.ref.update({ status: "error", error: "user not found" });
        console.log(doc.id, "-> error: user not found");
        continue;
      }
      const userData = userDoc.data() || {};
      const role2 = String(userData.role || "").toLowerCase();
      if (!["owner", "admin", "manager"].includes(role2)) {
        await doc.ref.update({ status: "error", error: "insufficient role" });
        console.log(doc.id, "-> error: insufficient role");
        continue;
      }
      if (userData.salonId !== salonId) {
        await doc.ref.update({ status: "error", error: "salonId mismatch" });
        console.log(doc.id, "-> error: salonId mismatch");
        continue;
      }
      const auth = { uid: createdByUid, token: { role: role2 } };
      await sendStaffInviteInternal({ staffId, salonId, email, role }, auth);
      await doc.ref.update({ status: "done", doneAt: admin.firestore.FieldValue.serverTimestamp() });
      console.log(doc.id, "-> done, email queued for", email);
    } catch (err) {
      await doc.ref.update({ status: "error", error: err.message });
      console.error(doc.id, "-> error:", err.message);
    }
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
