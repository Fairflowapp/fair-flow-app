// Email owners who created a salon but never finished billing.
//
// Sweep every 15 minutes. Per salon, at most two emails:
//   - 4 hours after createdAt, if still locked for billing
//   - 24 hours after createdAt, if still locked for billing
// If the salon is already past 24 hours when we first see it, send only the
// 24-hour email (do not dump both in the same minute).
//
// Delivery uses the Trigger Email extension (`mail` in production,
// `writeupMailStaging` on staging — that is the collection the staging
// extension already watches).
//
// State: salons/{salonId}/billing/signupReminders
//   { email4hSentAt, email24hSentAt, lastTo, lastKind }

const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const DEBUG_KEY = "ff-signup-billing-remind-debug";

function projectId() {
  return String(process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID || "").trim();
}

function appBaseUrl() {
  return projectId() === "fair-flow-staging"
    ? "https://fair-flow-staging.web.app"
    : "https://app.fairflowapp.com";
}

function mailCollection() {
  return projectId() === "fair-flow-staging" ? "writeupMailStaging" : "mail";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LOGO_URL = "https://app.fairflowapp.com/fairflow-logo-transparent.png?v=1";
const WEBSITE_URL = "https://fairflowapp.com";
const SUPPORT_EMAIL = "support@fairflowapp.com";

function buildBrandedHtml({ heading, intro, ctaLabel, ctaUrl, closingNote }) {
  const year = new Date().getFullYear();
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Fair Flow</title>
</head>
<body style="margin:0;padding:0;background:#f5f3f7;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f3f7;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
          <tr>
            <td align="center" style="padding:8px 0 24px 0;">
              <a href="${WEBSITE_URL}" style="text-decoration:none;">
                <img src="${LOGO_URL}" alt="Fair Flow" width="110" style="display:block;border:0;height:auto;max-width:110px;" />
              </a>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 4px 16px rgba(31,31,51,0.06);">
              <h1 style="margin:0 0 12px 0;font:700 24px/1.3 ${font};color:#1f1f33;">${escapeHtml(heading)}</h1>
              <p style="margin:0 0 24px 0;font:400 16px/1.6 ${font};color:#4b4b5f;">${escapeHtml(intro)}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:0 0 8px 0;">
                    <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font:700 15px/1.25 ${font};padding:14px 32px;border-radius:999px;">${escapeHtml(ctaLabel)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0 0;font:400 13px/1.6 ${font};color:#6b6b80;">
                Or open this link:<br />
                <a href="${escapeHtml(ctaUrl)}" style="color:#7c3aed;word-break:break-all;">${escapeHtml(ctaUrl)}</a>
              </p>
              <p style="margin:28px 0 0 0;padding-top:20px;border-top:1px solid #ececf2;font:400 14px/1.6 ${font};color:#6b6b80;">
                ${escapeHtml(closingNote)}
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 16px 8px 16px;font:400 12px/1.6 ${font};color:#8a8a9c;">
              Fair Flow &nbsp;&middot;&nbsp;
              <a href="${WEBSITE_URL}" style="color:#7c3aed;text-decoration:none;">fairflowapp.com</a><br />
              Need help?
              <a href="mailto:${SUPPORT_EMAIL}" style="color:#7c3aed;text-decoration:none;">${SUPPORT_EMAIL}</a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 16px 16px 16px;font:400 12px/1.6 ${font};color:#a0a0b0;">
              &copy; ${year} Fair Flow
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function firstNameFrom(name, email) {
  const n = String(name || "").trim();
  if (n) return n.split(/\s+/)[0];
  const local = String(email || "").split("@")[0] || "";
  return local || "there";
}

function createdAtMs(salon) {
  const raw = salon && salon.createdAt;
  if (!raw) return 0;
  if (typeof raw.toMillis === "function") return raw.toMillis();
  if (typeof raw === "number") return raw;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stillNeedsBilling(salon, stripeSnap) {
  if (!salon) return false;
  if (String(salon.accountStatus || "") !== "locked") return false;
  if (String(salon.accountStatusReason || "") !== "billing_required") return false;
  if (stripeSnap && stripeSnap.exists) {
    const data = stripeSnap.data() || {};
    if (data.status || data.customerId || data.subscriptionId) return false;
  }
  return true;
}

function chooseKind(ageMs, reminders) {
  const sent4 = !!(reminders && reminders.email4hSentAt);
  const sent24 = !!(reminders && reminders.email24hSentAt);
  if (ageMs >= TWENTY_FOUR_HOURS_MS && !sent24) return "24h";
  if (ageMs >= FOUR_HOURS_MS && ageMs < TWENTY_FOUR_HOURS_MS && !sent4) return "4h";
  return null;
}

function buildEmail(kind, { firstName, salonName, loginUrl }) {
  const safeName = firstName || "there";
  const safeSalon = salonName || "your salon";
  const footerText =
    `Website: ${WEBSITE_URL}\n` +
    `Support: ${SUPPORT_EMAIL}\n` +
    `Fair Flow`;
  if (kind === "24h") {
    const heading = `Still need help finishing Fair Flow?`;
    const intro =
      `Hi ${safeName}, your Fair Flow account for ${safeSalon} is still waiting on billing. ` +
      `Add a card when you are ready and you can start.`;
    const closingNote = "Reply if you want a quick walkthrough. We're here to help.";
    const subject = `Still need help finishing Fair Flow for ${safeSalon}?`;
    const text =
      `${heading}\n\n${intro}\n\nLog in: ${loginUrl}\n\n${closingNote}\n\n${footerText}\n`;
    const html = buildBrandedHtml({
      heading,
      intro,
      ctaLabel: "Log in to Fair Flow",
      ctaUrl: loginUrl,
      closingNote,
    });
    return { subject, text, html };
  }
  const heading = `Your Fair Flow account is ready`;
  const intro =
    `Hi ${safeName}, you started a Fair Flow account for ${safeSalon}. ` +
    `The next step is adding a card so you can get in.`;
  const closingNote = "If anything was unclear, reply to this email. Happy to help.";
  const subject = `Your Fair Flow account for ${safeSalon}`;
  const text =
    `${heading}\n\n${intro}\n\nLog in: ${loginUrl}\n\n${closingNote}\n\n${footerText}\n`;
  const html = buildBrandedHtml({
    heading,
    intro,
    ctaLabel: "Log in to Fair Flow",
    ctaUrl: loginUrl,
    closingNote,
  });
  return { subject, text, html };
}

async function resolveOwnerEmail(db, salon, salonId) {
  const ownerUid = String((salon && salon.ownerUid) || "").trim();
  if (ownerUid) {
    const userSnap = await db.collection("users").doc(ownerUid).get();
    if (userSnap.exists) {
      const u = userSnap.data() || {};
      const email = String(u.email || "").trim().toLowerCase();
      if (email && email.includes("@")) {
        return { email, name: String(u.name || "").trim(), ownerUid };
      }
    }
    try {
      const authUser = await admin.auth().getUser(ownerUid);
      const email = String((authUser && authUser.email) || "").trim().toLowerCase();
      if (email && email.includes("@")) {
        return { email, name: String((authUser && authUser.displayName) || "").trim(), ownerUid };
      }
    } catch (_) {}
  }
  return { email: "", name: "", ownerUid };
}

async function enqueueMail(db, { to, subject, text, html, salonId, kind }) {
  const col = mailCollection();
  const ref = db.collection(col).doc();
  await ref.set({
    to,
    message: { subject, text, html },
    salonId,
    kind: `signup-billing-${kind}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { collection: col, id: ref.id };
}

async function runSignupBillingReminderSweep(now, opts = {}) {
  const dryRun = opts.dryRun === true;
  const db = admin.firestore();
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const loginUrl = appBaseUrl();
  const summary = {
    now: new Date(nowMs).toISOString(),
    dryRun,
    project: projectId(),
    salons: 0,
    skipped: 0,
    sent4h: 0,
    sent24h: 0,
    errors: 0,
    actions: [],
  };

  let salonsSnap;
  try {
    salonsSnap = await db.collection("salons").get();
  } catch (e) {
    summary.errors += 1;
    console.error("[signupBillingRemind] list salons failed", e && e.message);
    return summary;
  }

  for (const salonDoc of salonsSnap.docs) {
    summary.salons += 1;
    const salonId = salonDoc.id;
    const salon = salonDoc.data() || {};
    try {
      const ageMs = nowMs - createdAtMs(salon);
      if (ageMs < FOUR_HOURS_MS) {
        summary.skipped += 1;
        continue;
      }

      const [stripeSnap, reminderSnap] = await Promise.all([
        salonDoc.ref.collection("billing").doc("stripe").get(),
        salonDoc.ref.collection("billing").doc("signupReminders").get(),
      ]);
      if (!stillNeedsBilling(salon, stripeSnap)) {
        summary.skipped += 1;
        continue;
      }

      const reminders = reminderSnap.exists ? reminderSnap.data() || {} : {};
      const kind = chooseKind(ageMs, reminders);
      if (!kind) {
        summary.skipped += 1;
        continue;
      }

      const owner = await resolveOwnerEmail(db, salon, salonId);
      if (!owner.email) {
        summary.skipped += 1;
        summary.actions.push({ salonId, skip: "no-owner-email" });
        continue;
      }

      const salonName = String(salon.name || "").trim() || "your salon";
      const firstName = firstNameFrom(owner.name, owner.email);
      const message = buildEmail(kind, { firstName, salonName, loginUrl });
      const action = {
        salonId,
        kind,
        to: owner.email,
        salonName,
        ageHours: Math.round(ageMs / 3600000),
      };

      if (dryRun) {
        summary.actions.push({ ...action, dryRun: true });
        if (kind === "24h") summary.sent24h += 1;
        else summary.sent4h += 1;
        continue;
      }

      const mailed = await enqueueMail(db, {
        to: owner.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        salonId,
        kind,
      });

      const patch = {
        lastTo: owner.email,
        lastKind: kind,
        lastMailId: mailed.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (kind === "24h") {
        patch.email24hSentAt = admin.firestore.FieldValue.serverTimestamp();
        if (!reminders.email4hSentAt) patch.email4hSkipped = true;
        summary.sent24h += 1;
      } else {
        patch.email4hSentAt = admin.firestore.FieldValue.serverTimestamp();
        summary.sent4h += 1;
      }
      await salonDoc.ref.collection("billing").doc("signupReminders").set(patch, { merge: true });
      summary.actions.push({ ...action, mailId: mailed.id, collection: mailed.collection });
      console.log("[signupBillingRemind] sent", JSON.stringify(action));
    } catch (e) {
      summary.errors += 1;
      console.warn("[signupBillingRemind] salon failed", salonId, e && e.message);
    }
  }

  console.log("[signupBillingRemind] sweep done", JSON.stringify({
    salons: summary.salons,
    sent4h: summary.sent4h,
    sent24h: summary.sent24h,
    skipped: summary.skipped,
    errors: summary.errors,
  }));
  return summary;
}

exports.scheduledSignupBillingReminders = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 300, memory: "256MB" })
  .pubsub.schedule("every 15 minutes")
  .onRun(async () => {
    await runSignupBillingReminderSweep(new Date());
    return null;
  });

exports.debugRunSignupBillingReminders = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    if ((req.query.key || "") !== DEBUG_KEY) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }
    try {
      const dryRun = String(req.query.dryRun || "") === "1";
      const summary = await runSignupBillingReminderSweep(new Date(), { dryRun });
      res.status(200).json({ ok: true, summary });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
    }
  });

exports.runSignupBillingReminderSweep = runSignupBillingReminderSweep;
exports.chooseKind = chooseKind;
exports.buildEmail = buildEmail;
exports.stillNeedsBilling = stillNeedsBilling;
