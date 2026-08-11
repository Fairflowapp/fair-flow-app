/**
 * Onboarding portal — email HTML, mail routing, active-link helper.
 */

const {
  DEFAULT_TTL_DAYS,
  db,
  trimStr,
  portalUrl,
  unsealRawToken,
  issueTokenCore,
} = require("./onboarding-portal-shared");

/** Same Trigger Email routing as write-ups (staging uses a dedicated collection). */
function onboardingMailCollectionForProject(projectId) {
  const p = trimStr(projectId != null ? projectId : process.env.GCLOUD_PROJECT);
  return p === "fair-flow-staging" ? "writeupMailStaging" : "mail";
}

const ONBOARDING_EMAIL_LOGO_URL =
  "https://app.fairflowapp.com/fairflow-logo-transparent.png?v=1";

function escapeHtmlEmail(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDueForEmail(due) {
  if (!due) return "";
  try {
    if (typeof due === "string") {
      const d = new Date(due);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      }
      return due;
    }
    if (due.toDate) {
      return due.toDate().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  } catch (_) {}
  return "";
}

function buildOnboardingPortalEmailHtml({
  salonName,
  staffName,
  packageName,
  dueLabel,
  linkUrl,
  reminder = false,
}) {
  const salon = escapeHtmlEmail(salonName || "your salon");
  const first =
    escapeHtmlEmail(String(staffName || "").trim().split(/\s+/)[0] || "") ||
    "there";
  const pkg = escapeHtmlEmail(packageName || "onboarding");
  const dueLine = dueLabel
    ? `<p style="margin:0 0 14px 0;color:#6b7280;">Due date: <strong style="color:#111827;">${escapeHtmlEmail(
        dueLabel
      )}</strong></p>`
    : "";
  const intro = reminder
    ? `<p style="margin:0 0 14px 0;">This is a friendly reminder from ${salon} to complete <strong>${pkg}</strong>.</p>`
    : `<p style="margin:0 0 14px 0;">Welcome! ${salon} invited you to complete <strong>${pkg}</strong> in Fair Flow.</p>`;
  const eyebrow = reminder ? "Onboarding reminder" : salon;
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6;max-width:560px;margin:0 auto;padding:24px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
    `<td align="center" style="padding:0 0 20px 0;">` +
    `<img src="${ONBOARDING_EMAIL_LOGO_URL}" alt="Fair Flow" width="110" style="display:block;border:0;outline:none;height:auto;max-width:110px;" />` +
    `</td></tr></table>` +
    `<p style="margin:0 0 6px 0;font-size:12px;font-weight:bold;color:#9d68b9;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtmlEmail(
      eyebrow
    )}</p>` +
    `<p style="margin:0 0 14px 0;">Hi ${first},</p>` +
    intro +
    dueLine +
    `<p style="margin:0 0 18px 0;">Tap the button below to open your secure onboarding link. No Fair Flow login is required.</p>` +
    `<p style="margin:22px 0;"><a href="${escapeHtmlEmail(linkUrl)}" ` +
    `style="background:#9d68b9;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">` +
    `Complete Your Onboarding</a></p>` +
    `<p style="margin:18px 0 0 0;font-size:12px;color:#6b7280;">If the button doesn’t work, paste this link into your browser:<br>` +
    `<a href="${escapeHtmlEmail(linkUrl)}" style="color:#9d68b9;word-break:break-all;">${escapeHtmlEmail(
      linkUrl
    )}</a></p>` +
    `<p style="margin:18px 0 0 0;font-size:12px;color:#6b7280;">This message was sent by ${salon} via Fair Flow. Please do not reply to this email.</p>` +
    `</div>`
  );
}

function parseDueMs(due) {
  if (!due) return null;
  try {
    if (typeof due === "string") {
      // Date-only → interpret as end of that local UTC day start for consistency
      const d = new Date(due);
      if (!Number.isNaN(d.getTime())) return d.getTime();
      return null;
    }
    if (due.toMillis) return due.toMillis();
    if (due.toDate) return due.toDate().getTime();
    if (due.seconds != null) return Number(due.seconds) * 1000;
  } catch (_) {}
  return null;
}

function firstEmailSentMs(portal) {
  const p = portal || {};
  if (p.firstEmailSentAt && p.firstEmailSentAt.toMillis) {
    return p.firstEmailSentAt.toMillis();
  }
  if (p.firstEmailSentAt && p.firstEmailSentAt.seconds != null) {
    return Number(p.firstEmailSentAt.seconds) * 1000;
  }
  // Fallback for emails sent before firstEmailSentAt existed
  if (p.lastEmailSentAt && p.lastEmailSentAt.toMillis && Number(p.emailSendCount || 0) >= 1) {
    return p.lastEmailSentAt.toMillis();
  }
  return null;
}

function reminderAlreadySent(portal, kind) {
  const map = (portal && portal.reminders) || {};
  const entry = map[kind];
  return !!(entry && (entry.mailId || entry.status === "queued" || entry.status === "sent"));
}

/**
 * Resolve an active portal URL for a run, issuing a token only when needed.
 * Does not reissue when a sealed active token already exists.
 */
async function ensureActivePortalLink({ salonId, staffId, runId, uid }) {
  const q = await db()
    .collection(`salons/${salonId}/onboardingPortalTokens`)
    .where("runId", "==", runId)
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (!q.empty) {
    const doc = q.docs[0];
    const t = doc.data() || {};
    const exp = t.expiresAt && t.expiresAt.toMillis ? t.expiresAt.toMillis() : 0;
    if (exp && exp >= Date.now()) {
      const raw = unsealRawToken(t.sealedToken);
      if (raw) {
        return {
          url: portalUrl(raw),
          tokenId: doc.id,
          expiresAt: t.expiresAt.toDate().toISOString(),
          issued: false,
        };
      }
    }
  }
  const issued = await issueTokenCore({
    salonId,
    staffId,
    runId,
    uid,
    ttlDays: DEFAULT_TTL_DAYS,
  });
  return {
    url: issued.url,
    tokenId: issued.tokenId,
    expiresAt: issued.expiresAt,
    issued: true,
  };
}

module.exports = {
  onboardingMailCollectionForProject,
  ONBOARDING_EMAIL_LOGO_URL,
  escapeHtmlEmail,
  formatDueForEmail,
  buildOnboardingPortalEmailHtml,
  parseDueMs,
  firstEmailSentMs,
  reminderAlreadySent,
  ensureActivePortalLink,
};
