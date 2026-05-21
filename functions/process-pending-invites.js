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

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Branded Fair Flow transactional email HTML.
 * Kept in sync with functions/index.js#buildFairFlowEmailHTML – pure presentation,
 * no logic / link / token / subject changes.
 */
function buildFairFlowEmailHTML({
  heading,
  intro,
  infoRows = [],
  ctaLabel,
  ctaUrl,
  fallbackUrlNote,
  closingNote,
}) {
  const LOGO_URL = "https://app.fairflowapp.com/fairflow-logo-transparent.png?v=1";
  const APP_URL = APP_BASE_URL;
  const SUPPORT_EMAIL = "support@fairflowapp.com";
  const YEAR = new Date().getFullYear();
  const fontStack = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";

  const rowsHTML = (infoRows || []).map((r) => `
            <tr>
              <td style="padding:6px 12px 6px 0;font:500 14px/1.5 ${fontStack};color:#6b6b80;width:90px;vertical-align:top;white-space:nowrap;">${escapeHtml(r.label)}</td>
              <td style="padding:6px 0;font:600 14px/1.5 ${fontStack};color:#1f1f33;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(r.value)}</td>
            </tr>`).join("");

  const infoBlock = rowsHTML
    ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px 0;background:#faf9fc;border-radius:10px;">
            <tr><td style="padding:14px 18px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rowsHTML}
              </table>
            </td></tr>
          </table>`
    : "";

  const fallbackBlock = (fallbackUrlNote && ctaUrl)
    ? `
          <p style="margin:24px 0 6px 0;font:400 13px/1.6 ${fontStack};color:#6b6b80;">
            ${escapeHtml(fallbackUrlNote)}
          </p>
          <p style="margin:0;word-break:break-all;overflow-wrap:anywhere;font:400 13px/1.6 ${fontStack};">
            <a href="${escapeHtml(ctaUrl)}" style="color:#7c3aed;text-decoration:none;word-break:break-all;overflow-wrap:anywhere;">${escapeHtml(ctaUrl)}</a>
          </p>`
    : "";

  const closingBlock = closingNote
    ? `
          <p style="margin:28px 0 0 0;padding-top:20px;border-top:1px solid #ececf2;font:400 14px/1.6 ${fontStack};color:#6b6b80;">
            ${escapeHtml(closingNote)}
          </p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light" />
  <title>Fair Flow</title>
  <style>
    @media (max-width: 600px) {
      .ff-card { padding: 24px !important; border-radius: 14px !important; }
      .ff-h1   { font-size: 22px !important; }
      .ff-btn  { padding: 13px 22px !important; font-size: 14px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f5f3f7;-webkit-text-size-adjust:100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f3f7;table-layout:fixed;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" style="max-width:560px;margin:0 auto;table-layout:fixed;">
          <tr>
            <td align="center" style="padding:8px 0 24px 0;">
              <a href="${APP_URL}" style="text-decoration:none;">
                <img src="${LOGO_URL}" alt="Fair Flow" width="110" style="display:block;border:0;outline:none;height:auto;max-width:110px;" />
              </a>
            </td>
          </tr>
          <tr>
            <td class="ff-card" style="background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 4px 16px rgba(31,31,51,0.06);">
              <h1 class="ff-h1" style="margin:0 0 12px 0;font:700 26px/1.3 ${fontStack};color:#1f1f33;">
                ${escapeHtml(heading)}
              </h1>
              <p style="margin:0 0 24px 0;font:400 16px/1.6 ${fontStack};color:#4b4b5f;">
                ${escapeHtml(intro)}
              </p>${infoBlock}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 auto;">
                <tr>
                  <td align="center" style="padding:0;">
                    <a class="ff-btn" href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font:700 15px/1.25 ${fontStack};padding:14px 32px;border-radius:999px;mso-padding-alt:0;max-width:100%;box-sizing:border-box;word-break:break-word;overflow-wrap:break-word;">${escapeHtml(ctaLabel)}</a>
                  </td>
                </tr>
              </table>${fallbackBlock}${closingBlock}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 16px 8px 16px;font:400 12px/1.6 ${fontStack};color:#8a8a9c;">
              Need help? Contact
              <a href="mailto:${SUPPORT_EMAIL}" style="color:#7c3aed;text-decoration:none;">${SUPPORT_EMAIL}</a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 16px 16px 16px;font:400 12px/1.6 ${fontStack};color:#a0a0b0;">
              &copy; ${YEAR} Fair Flow &middot; <a href="${APP_URL}" style="color:#a0a0b0;text-decoration:none;">fairflowapp.com</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

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

  const htmlBody = buildFairFlowEmailHTML({
    heading: "You're invited!",
    intro: `You have been invited to join ${salonName} on Fair Flow.`,
    infoRows: [
      { label: "Role", value: roleValue },
      { label: "Expires", value: expiresText },
    ],
    ctaLabel: "Click here to accept your invite",
    ctaUrl: inviteUrl,
    fallbackUrlNote: "If the button above doesn't work, copy and paste this link into your browser:",
    closingNote: "If you have questions, reply to this email.",
  });

  await admin.firestore().collection("mail").add({
    to: emailLower,
    message: {
      subject: `You're invited to join ${salonName} on Fair Flow`,
      text: `You have been invited to join ${salonName} on Fair Flow.\n\nRole: ${roleValue}\nInvite link: ${inviteUrl}\nExpires: ${expiresText}`,
      html: htmlBody
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
