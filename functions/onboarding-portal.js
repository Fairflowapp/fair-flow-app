/**
 * Employee Onboarding Portal — Phase 1 backend (tokens + portal actions).
 *
 * Manager (Firebase Auth):
 *   issueOnboardingPortalToken
 *   reissueOnboardingPortalToken
 *   revokeOnboardingPortalToken
 *   extendOnboardingPortalToken
 *   getOnboardingPortalActiveLink
 *   sendOnboardingPortalEmail
 *   sendOnboardingPortalReminder
 *   runOnboardingRemindersSweep
 *
 * Scheduled:
 *   onboardingRemindersHourly
 *
 * Portal (token / session — no Fair Flow login):
 *   onboardingPortalBootstrap
 *   onboardingPortalGetState
 *   onboardingPortalAckPolicy
 *   onboardingPortalCreateUpload
 *   onboardingPortalFinalizeUpload
 *   onboardingPortalGetSignaturePacket
 *   onboardingPortalSubmitSignature
 *
 * Trigger:
 *   onOnboardingRunWriteForPortal — revoke tokens when run → cancelled
 *
 * Deploy (staging):
 *   firebase deploy --only \
 *     functions:issueOnboardingPortalToken,functions:reissueOnboardingPortalToken,functions:revokeOnboardingPortalToken,functions:extendOnboardingPortalToken,functions:getOnboardingPortalActiveLink,functions:sendOnboardingPortalEmail,functions:sendOnboardingPortalReminder,functions:runOnboardingRemindersSweep,functions:onboardingRemindersHourly,functions:onboardingPortalBootstrap,functions:onboardingPortalGetState,functions:onboardingPortalAckPolicy,functions:onboardingPortalCreateUpload,functions:onboardingPortalFinalizeUpload,functions:onOnboardingRunWriteForPortal \
 *     --project fair-flow-staging
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

if (!admin.apps.length) admin.initializeApp();

/** Portal HMAC — required in Cloud; predictable fallback only for emulator. */
const ONBOARDING_PORTAL_HMAC_SECRET = defineSecret(
  "ONBOARDING_PORTAL_HMAC_SECRET"
);

const REGION = "us-central1";
const DEFAULT_TTL_DAYS = 30;
const MAX_TTL_DAYS = 90;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
const UPLOAD_URL_TTL_MS = 30 * 60 * 1000;
const RATE_IP_LIMIT = 40;
const RATE_IP_WINDOW_MS = 10 * 60 * 1000;
const RATE_TOKEN_LIMIT = 80;
const RATE_TOKEN_WINDOW_MS = 10 * 60 * 1000;
const RATE_UPLOAD_LIMIT = 20;
const RATE_UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const REMINDER_AFTER_SEND_MS = 24 * 60 * 60 * 1000;
const REMINDER_BEFORE_DUE_MS = 24 * 60 * 60 * 1000;
const REMINDER_KIND_AFTER_SEND = "after_send_24h";
const REMINDER_KIND_BEFORE_DUE = "before_due_24h";
const REMINDER_KIND_MANUAL = "manual";
const REMINDER_ELIGIBLE_STATUSES = new Set(["sent", "in_progress"]);
/** Manager Inbox alert when onboarding stays incomplete after first invite email. */
const MANAGER_INCOMPLETE_INBOX_MS = 7 * 24 * 60 * 60 * 1000;
const MANAGER_INCOMPLETE_INBOX_TYPE = "onboarding_incomplete";

function db() {
  return admin.firestore();
}

/** Project-derived Storage bucket (never hardcode production). */
let _portalBucketPromise = null;
function resolvePortalBucket() {
  if (!_portalBucketPromise) {
    _portalBucketPromise = (async () => {
      const project =
        process.env.GCLOUD_PROJECT ||
        trimStr((admin.app().options || {}).projectId);
      for (const id of [
        `${project}.firebasestorage.app`,
        `${project}.appspot.com`,
      ]) {
        try {
          const bucket = admin.storage().bucket(id);
          const [exists] = await bucket.exists();
          if (exists) return bucket;
        } catch (_) {
          /* try next */
        }
      }
      return admin.storage().bucket();
    })();
  }
  return _portalBucketPromise;
}

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

function appBaseUrl() {
  const project = process.env.GCLOUD_PROJECT || "";
  if (project === "fair-flow-staging") return "https://fair-flow-staging.web.app";
  return "https://app.fairflowapp.com";
}

function sessionSecret() {
  try {
    const fromSecret = ONBOARDING_PORTAL_HMAC_SECRET.value();
    if (fromSecret && String(fromSecret).trim()) {
      return String(fromSecret).trim();
    }
  } catch (_) {
    /* secret not bound on this function / local */
  }
  const env = process.env.ONBOARDING_PORTAL_HMAC_SECRET;
  if (env && String(env).trim()) return String(env).trim();
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    return "ff-onboarding-portal-emulator";
  }
  throw new HttpsError(
    "failed-precondition",
    "Portal signing secret is not configured."
  );
}

const PORTAL_SECRET_OPTS = { secrets: [ONBOARDING_PORTAL_HMAC_SECRET] };

function sha256Hex(raw) {
  return crypto.createHash("sha256").update(String(raw), "utf8").digest("hex");
}

function generateRawToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function tokenDocIdFromHash(tokenHash) {
  return String(tokenHash).slice(0, 32);
}

function portalUrl(rawToken) {
  return `${appBaseUrl()}/onboarding/${rawToken}`;
}

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

function maskEmail(email) {
  const e = trimStr(email).toLowerCase();
  const at = e.indexOf("@");
  if (at < 1) return "***";
  const user = e.slice(0, at);
  const domain = e.slice(at + 1);
  const keep = user.slice(0, Math.min(2, user.length));
  return `${keep}***@${domain}`;
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

/** Safe log payload — never includes raw token or full portal URL. */
function logPortal(action, fields) {
  const safe = { action, ...(fields || {}) };
  delete safe.token;
  delete safe.rawToken;
  delete safe.sessionToken;
  delete safe.url;
  delete safe.linkUrl;
  delete safe.portalUrl;
  if (safe.toEmail) safe.toEmail = maskEmail(safe.toEmail);
  if (safe.email) safe.email = maskEmail(safe.email);
  console.log("[onboarding-portal]", JSON.stringify(safe));
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

function clientIp(request) {
  try {
    const hdr =
      request.rawRequest &&
      (request.rawRequest.headers["x-forwarded-for"] ||
        request.rawRequest.headers["x-appengine-user-ip"]);
    if (hdr) return String(hdr).split(",")[0].trim().slice(0, 64);
    if (request.rawRequest && request.rawRequest.ip) {
      return String(request.rawRequest.ip).slice(0, 64);
    }
  } catch (_) {}
  return "unknown";
}

async function assertRateLimit(bucketPath, limit, windowMs) {
  const ref = db().doc(bucketPath);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    let count = 0;
    let windowStartMs = now;
    if (snap.exists) {
      const d = snap.data() || {};
      windowStartMs = Number(d.windowStartMs) || now;
      count = Number(d.count) || 0;
      if (now - windowStartMs > windowMs) {
        count = 0;
        windowStartMs = now;
      }
    }
    if (count >= limit) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many requests. Please try again later."
      );
    }
    tx.set(
      ref,
      {
        count: count + 1,
        windowStartMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

async function assertManager(uid, salonId) {
  const [userSnap, salonSnap, memberSnap] = await Promise.all([
    db().doc(`users/${uid}`).get(),
    db().doc(`salons/${salonId}`).get(),
    db().doc(`salons/${salonId}/members/${uid}`).get(),
  ]);
  if (!salonSnap.exists) throw new HttpsError("not-found", "Salon not found.");
  if (salonSnap.get("ownerUid") === uid) return { role: "owner" };

  const u = userSnap.exists ? userSnap.data() || {} : {};
  const userRole = trimStr(u.role).toLowerCase();
  if (
    trimStr(u.salonId) === salonId &&
    (userRole === "owner" || userRole === "admin" || userRole === "manager")
  ) {
    return { role: userRole };
  }
  const m = memberSnap.exists ? memberSnap.data() || {} : {};
  const memberRole = trimStr(m.role).toLowerCase();
  if (
    memberRole === "owner" ||
    memberRole === "admin" ||
    memberRole === "manager"
  ) {
    return { role: memberRole };
  }
  throw new HttpsError(
    "permission-denied",
    "Only managers can manage onboarding portal links."
  );
}

function requireManagerAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return request.auth.uid;
}

function mintSession(claims) {
  const body = {
    tokenId: claims.tokenId,
    salonId: claims.salonId,
    staffId: claims.staffId,
    runId: claims.runId,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Seal raw portal token for manager re-copy only (CF-readable docs).
 * Portal auth still uses SHA-256 hash lookup — sealed blob is never logged.
 */
function sealRawToken(rawToken) {
  const payload = Buffer.from(String(rawToken), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", sessionSecret())
    .update(`seal:${payload}`)
    .digest("base64url");
  return `${payload}.${sig}`;
}

function unsealRawToken(sealed) {
  const raw = trimStr(sealed);
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto
    .createHmac("sha256", sessionSecret())
    .update(`seal:${payload}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch (_) {
    return null;
  }
}

function verifySession(sessionToken) {
  const raw = trimStr(sessionToken);
  const parts = raw.split(".");
  if (parts.length !== 2) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const [payload, sig] = parts;
  const expected = crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  let body;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (_) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  if (!body || Number(body.exp) < Date.now()) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  return {
    tokenId: trimStr(body.tokenId),
    salonId: trimStr(body.salonId),
    staffId: trimStr(body.staffId),
    runId: trimStr(body.runId),
  };
}

function sanitizePolicyHtml(html) {
  let s = String(html == null ? "" : html);
  s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "");
  s = s.replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "");
  s = s.replace(/<embed[\s\S]*?>/gi, "");
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/javascript:/gi, "");
  s = s.replace(/data:/gi, "");
  s = s.replace(/vbscript:/gi, "");
  // Allow only safe tags.
  s = s.replace(
    /<\/?(?!\/?(p|br|ul|ol|li|strong|em|b|i|a|h1|h2|h3)\b)[^>]*>/gi,
    ""
  );
  // Links: only http(s); force rel/target. Unsafe href → unwrap to text container.
  s = s.replace(/<a\b([^>]*)>/gi, (full, attrs) => {
    const m = String(attrs || "").match(
      /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
    );
    const href = m ? m[2] || m[3] || m[4] || "" : "";
    if (!/^https?:\/\//i.test(href)) return "<span>";
    const safe = href.replace(/"/g, "&quot;").slice(0, 2000);
    return `<a href="${safe}" rel="noopener noreferrer" target="_blank">`;
  });
  return s.slice(0, 100000);
}

function computeProgress(tasks, currentStatus) {
  const list = Array.isArray(tasks) ? tasks : [];
  const required = list.filter((t) => t && t.required !== false);
  const requiredCompleted = required.filter((t) => t.status === "completed").length;
  const completed = list.filter((t) => t && t.status === "completed").length;
  const missing = required.filter((t) => t.status !== "completed").length;
  const progress = {
    total: list.length,
    requiredTotal: required.length,
    completed,
    requiredCompleted,
    missing,
  };
  let status = currentStatus || "draft";
  if (status !== "cancelled") {
    if (required.length > 0 && missing === 0) status = "completed";
    else if (
      list.some((t) =>
        [
          "in_progress",
          "waiting_approval",
          "sealing",
          "completed",
          "rejected",
          "skipped",
        ].includes(String(t.status || ""))
      )
    ) {
      if (status === "draft" || status === "sent") status = "in_progress";
    }
  }
  return { progress, status };
}

async function loadRunAndTasks(salonId, staffId, runId) {
  const runRef = db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
  );
  const runSnap = await runRef.get();
  if (!runSnap.exists) return { run: null, tasks: [], runRef };
  const tasksSnap = await db()
    .collection(
      `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks`
    )
    .get();
  const tasks = tasksSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  return { run: { id: runSnap.id, ...runSnap.data() }, tasks, runRef };
}

async function revokeActiveTokensForRun(salonId, staffId, runId, reason, uid) {
  const q = await db()
    .collection(`salons/${salonId}/onboardingPortalTokens`)
    .where("runId", "==", runId)
    .where("status", "==", "active")
    .get();
  if (q.empty) return 0;
  const batch = db().batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const status = reason === "reissue" ? "superseded" : "revoked";
  q.docs.forEach((d) => {
    const data = d.data() || {};
    batch.update(d.ref, {
      status,
      revokedAt: now,
      revokedByUid: uid || null,
      revokeReason: reason || "manual",
      updatedAt: now,
    });
    if (data.tokenHash) {
      batch.set(
        db().doc(`onboardingPortalTokenLookup/${data.tokenHash}`),
        { status, updatedAt: now },
        { merge: true }
      );
    }
  });
  const runRef = db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
  );
  batch.set(
    runRef,
    {
      portal: {
        activeTokenId: null,
        revokedAt: now,
      },
      updatedAt: now,
    },
    { merge: true }
  );
  await batch.commit();
  return q.size;
}

async function issueTokenCore({
  salonId,
  staffId,
  runId,
  uid,
  ttlDays,
  replacesTokenId,
}) {
  const { run } = await loadRunAndTasks(salonId, staffId, runId);
  if (!run) throw new HttpsError("not-found", "Onboarding run not found.");
  if (run.status === "cancelled") {
    throw new HttpsError(
      "failed-precondition",
      "Cannot issue a portal link for a cancelled run."
    );
  }

  const days = Math.min(
    MAX_TTL_DAYS,
    Math.max(1, Number(ttlDays) || DEFAULT_TTL_DAYS)
  );
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + days * 24 * 60 * 60 * 1000
  );

  await revokeActiveTokensForRun(salonId, staffId, runId, "reissue", uid);

  const rawToken = generateRawToken();
  const tokenHash = sha256Hex(rawToken);
  const tokenId = tokenDocIdFromHash(tokenHash);
  const tokenRef = db().doc(
    `salons/${salonId}/onboardingPortalTokens/${tokenId}`
  );
  const lookupRef = db().doc(`onboardingPortalTokenLookup/${tokenHash}`);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db().batch();
  batch.set(tokenRef, {
    tokenHash,
    // Manager re-copy only (rules deny all client access). Portal auth uses tokenHash.
    sealedToken: sealRawToken(rawToken),
    salonId,
    staffId,
    runId,
    status: "active",
    expiresAt,
    createdAt: now,
    createdByUid: uid,
    revokedAt: null,
    revokedByUid: null,
    revokeReason: null,
    lastUsedAt: null,
    useCount: 0,
    replacedByTokenId: null,
    replacesTokenId: replacesTokenId || null,
    schemaVersion: 1,
    updatedAt: now,
  });
  // Root lookup so bootstrap can resolve without knowing salonId (hash only).
  batch.set(lookupRef, {
    salonId,
    tokenId,
    staffId,
    runId,
    status: "active",
    createdAt: now,
  });
  const runRef = db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
  );
  batch.set(
    runRef,
    {
      portal: {
        activeTokenId: tokenId,
        lastIssuedAt: now,
        lastIssuedByUid: uid,
        revokedAt: null,
        expiresAt,
      },
      updatedAt: now,
    },
    { merge: true }
  );
  await batch.commit();

  logPortal("issue", { salonId, staffId, runId, tokenId, ttlDays: days });
  return {
    tokenId,
    expiresAt: expiresAt.toDate().toISOString(),
    url: portalUrl(rawToken),
    ttlDays: days,
  };
}

/**
 * Resolve portal token → context. Never trusts client salon/staff/run IDs.
 * @param {object} opts
 * @param {boolean} opts.allowCompletedRead — bootstrap/getState OK when completed
 * @param {boolean} opts.mutating — deny when completed / cancelled
 */
async function resolvePortalAccess(rawToken, request, opts = {}) {
  const allowCompletedRead = opts.allowCompletedRead === true;
  const mutating = opts.mutating === true;
  const ip = clientIp(request);
  await assertRateLimit(
    `onboardingPortalRateLimits/ip_${sha256Hex(ip).slice(0, 24)}`,
    RATE_IP_LIMIT,
    RATE_IP_WINDOW_MS
  );

  const token = trimStr(rawToken);
  if (!token || token.length < 20) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const tokenHash = sha256Hex(token);
  const lookupSnap = await db()
    .doc(`onboardingPortalTokenLookup/${tokenHash}`)
    .get();
  if (!lookupSnap.exists) {
    logPortal("resolve_miss", { hashPrefix: tokenHash.slice(0, 8) });
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const lookup = lookupSnap.data() || {};
  if (lookup.status && lookup.status !== "active") {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const salonId = trimStr(lookup.salonId);
  const tokenId = trimStr(lookup.tokenId);
  if (!salonId || !tokenId) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const tokenDoc = await db()
    .doc(`salons/${salonId}/onboardingPortalTokens/${tokenId}`)
    .get();
  if (!tokenDoc.exists) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const t = tokenDoc.data() || {};
  const staffId = trimStr(t.staffId);
  const runId = trimStr(t.runId);

  await assertRateLimit(
    `salons/${salonId}/onboardingPortalRateLimits/tok_${tokenDoc.id}`,
    RATE_TOKEN_LIMIT,
    RATE_TOKEN_WINDOW_MS
  );

  if (t.status !== "active") {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const exp = t.expiresAt && t.expiresAt.toMillis ? t.expiresAt.toMillis() : 0;
  if (!exp || exp < Date.now()) {
    try {
      const now = admin.firestore.FieldValue.serverTimestamp();
      await tokenDoc.ref.set(
        { status: "expired", updatedAt: now },
        { merge: true }
      );
      await lookupSnap.ref.set({ status: "expired", updatedAt: now }, { merge: true });
    } catch (_) {}
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }

  const { run, tasks, runRef } = await loadRunAndTasks(salonId, staffId, runId);
  if (!run) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  if (run.status === "cancelled") {
    throw new HttpsError("failed-precondition", "This onboarding was cancelled.");
  }
  if (mutating && run.status === "completed") {
    throw new HttpsError(
      "failed-precondition",
      "This onboarding is complete. Viewing only."
    );
  }
  if (!allowCompletedRead && !mutating && run.status === "completed") {
    // getState/bootstrap allow completed — handled by allowCompletedRead
  }

  // Throttled lastUsedAt
  try {
    const last =
      t.lastUsedAt && t.lastUsedAt.toMillis ? t.lastUsedAt.toMillis() : 0;
    if (!last || Date.now() - last > LAST_USED_THROTTLE_MS) {
      await tokenDoc.ref.set(
        {
          lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
          useCount: admin.firestore.FieldValue.increment(1),
        },
        { merge: true }
      );
    }
  } catch (_) {}

  return {
    tokenId: tokenDoc.id,
    salonId,
    staffId,
    runId,
    tokenRef: tokenDoc.ref,
    lookupRef: lookupSnap.ref,
    run,
    tasks,
    runRef,
    readOnly: run.status === "completed",
  };
}

async function resolveSessionAccess(sessionToken, request, opts = {}) {
  const claims = verifySession(sessionToken);
  const ip = clientIp(request);
  await assertRateLimit(
    `onboardingPortalRateLimits/ip_${sha256Hex(ip).slice(0, 24)}`,
    RATE_IP_LIMIT,
    RATE_IP_WINDOW_MS
  );
  await assertRateLimit(
    `salons/${claims.salonId}/onboardingPortalRateLimits/tok_${claims.tokenId}`,
    RATE_TOKEN_LIMIT,
    RATE_TOKEN_WINDOW_MS
  );

  const tokenRef = db().doc(
    `salons/${claims.salonId}/onboardingPortalTokens/${claims.tokenId}`
  );
  const tokenSnap = await tokenRef.get();
  if (!tokenSnap.exists) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const t = tokenSnap.data() || {};
  if (t.status !== "active") {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  const exp = t.expiresAt && t.expiresAt.toMillis ? t.expiresAt.toMillis() : 0;
  if (!exp || exp < Date.now()) {
    try {
      await tokenRef.set(
        { status: "expired", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (_) {}
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }
  if (
    trimStr(t.staffId) !== claims.staffId ||
    trimStr(t.runId) !== claims.runId
  ) {
    throw new HttpsError("unauthenticated", "Invalid or expired link.");
  }

  const { run, tasks, runRef } = await loadRunAndTasks(
    claims.salonId,
    claims.staffId,
    claims.runId
  );
  if (!run || run.status === "cancelled") {
    throw new HttpsError("failed-precondition", "This onboarding was cancelled.");
  }
  if (opts.mutating && run.status === "completed") {
    throw new HttpsError(
      "failed-precondition",
      "This onboarding is complete. Viewing only."
    );
  }
  return {
    tokenId: claims.tokenId,
    salonId: claims.salonId,
    staffId: claims.staffId,
    runId: claims.runId,
    tokenRef,
    run,
    tasks,
    runRef,
    readOnly: run.status === "completed",
  };
}

function buildPortalDto(ctx, sessionToken) {
  const { run, tasks, salonId, staffId, readOnly } = ctx;
  const taskDtos = (tasks || []).map((t) => {
    const cfg = t.configSnapshot || {};
    const base = {
      id: t.id,
      templateNameSnapshot: t.templateNameSnapshot || "",
      taskType: t.taskType,
      categoryNameSnapshot: t.categoryNameSnapshot || "",
      required: t.required !== false,
      sortOrder: t.sortOrder || 0,
      status: t.status || "pending",
      resultPublic: {},
    };
    if (t.status === "rejected" && t.result && t.result.rejectionReason) {
      base.resultPublic.rejectionReason = String(t.result.rejectionReason).slice(
        0,
        500
      );
    }
    if (t.taskType === "policy_acknowledgement") {
      base.config = {
        version: String(cfg.version || "1.0"),
        requireTypedName: cfg.requireTypedName === true,
        requireScrollToEnd: cfg.requireScrollToEnd === true,
        bodyHtml: sanitizePolicyHtml(cfg.bodyHtml || ""),
      };
    } else if (t.taskType === "document" || t.taskType === "file_upload") {
      base.config = {
        requiresExpiration: cfg.requiresExpiration === true,
        maxSizeMb: Number(cfg.maxSizeMb) || 10,
        acceptedMime: Array.isArray(cfg.acceptedMime)
          ? cfg.acceptedMime.slice(0, 20)
          : ["application/pdf", "image/*"],
      };
    } else if (t.taskType === "electronic_signature") {
      const esignSeal = require("./onboarding-esign-seal");
      base.config = {
        documentTitle: String(cfg.documentTitle || t.templateNameSnapshot || ""),
        pageCount: Number(cfg.pageCount) || null,
        requireTypedName: cfg.requireTypedName === true,
        requireDrawnSignature: cfg.requireDrawnSignature !== false,
        consentText: String(cfg.consentText || "").slice(0, 4000),
        fieldSchema: esignSeal.publicFieldSchema(cfg.fieldSchema),
        // Never expose IP / hashes of source beyond what's needed for UI
        documentVersion:
          cfg.documentVersion != null ? cfg.documentVersion : null,
      };
      if (t.status === "completed" || t.status === "sealing") {
        base.resultPublic = esignSeal.publicEsignResult(t.result || {});
        // Manager-side task.result may include signerName even if older seals
        // omitted it from resultPublic — prefer result, fall back to public.
        if (
          !base.resultPublic.signerName &&
          t.result &&
          t.result.signerName
        ) {
          base.resultPublic.signerName = String(t.result.signerName).slice(
            0,
            120
          );
        }
      }
    } else {
      base.config = {};
    }
    return base;
  });

  return {
    sessionToken: sessionToken || null,
    readOnly: !!readOnly,
    expiresAt: null, // filled by caller from token
    salon: { id: salonId },
    staff: { id: staffId },
    run: {
      id: run.id,
      status: run.status,
      progress: run.progress || null,
      dueDate: run.dueDate || null,
      packageNameSnapshot: run.packageNameSnapshot || "",
      packageDescriptionSnapshot: run.packageDescriptionSnapshot || "",
    },
    tasks: taskDtos,
  };
}

async function enrichSalonStaffNames(dto, salonId, staffId) {
  try {
    const [salonSnap, staffSnap] = await Promise.all([
      db().doc(`salons/${salonId}`).get(),
      db().doc(`salons/${salonId}/staff/${staffId}`).get(),
    ]);
    if (salonSnap.exists) {
      const s = salonSnap.data() || {};
      dto.salon.name = String(s.name || s.salonName || "Salon");
    }
    if (staffSnap.exists) {
      const st = staffSnap.data() || {};
      dto.staff.displayName = String(st.name || st.displayName || "Team member");
    }
  } catch (_) {}
  return dto;
}

async function recomputeRunInTxn(salonId, staffId, runId) {
  const runRef = db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
  );
  await db().runTransaction(async (tx) => {
    const runSnap = await tx.get(runRef);
    if (!runSnap.exists) return;
    const run = runSnap.data() || {};
    if (run.status === "cancelled") return;
    const tasksSnap = await tx.get(
      db().collection(
        `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}/tasks`
      )
    );
    const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const { progress, status } = computeProgress(tasks, run.status);
    const patch = {
      progress,
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (status === "completed" && run.status !== "completed") {
      patch.completedAt = admin.firestore.FieldValue.serverTimestamp();
    }
    tx.update(runRef, patch);
  });
}

// ─── Manager callables ───────────────────────────────────────────────────────

exports.issueOnboardingPortalToken = onCall(
  { region: REGION, ...PORTAL_SECRET_OPTS },
  async (request) => {
    const uid = requireManagerAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    if (!salonId || !staffId || !runId) {
      throw new HttpsError("invalid-argument", "Missing salonId, staffId, or runId.");
    }
    await assertManager(uid, salonId);
    return issueTokenCore({
      salonId,
      staffId,
      runId,
      uid,
      ttlDays: request.data && request.data.ttlDays,
    });
  }
);

exports.reissueOnboardingPortalToken = onCall(
  { region: REGION, ...PORTAL_SECRET_OPTS },
  async (request) => {
    const uid = requireManagerAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    if (!salonId || !staffId || !runId) {
      throw new HttpsError("invalid-argument", "Missing salonId, staffId, or runId.");
    }
    await assertManager(uid, salonId);
    const prev = await db()
      .collection(`salons/${salonId}/onboardingPortalTokens`)
      .where("runId", "==", runId)
      .where("status", "==", "active")
      .limit(1)
      .get();
    const replacesTokenId = prev.empty ? null : prev.docs[0].id;
    return issueTokenCore({
      salonId,
      staffId,
      runId,
      uid,
      ttlDays: request.data && request.data.ttlDays,
      replacesTokenId,
    });
  }
);

exports.revokeOnboardingPortalToken = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireManagerAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    const tokenId = trimStr(request.data && request.data.tokenId);
    if (!salonId) throw new HttpsError("invalid-argument", "Missing salonId.");
    await assertManager(uid, salonId);

    if (tokenId) {
      const ref = db().doc(
        `salons/${salonId}/onboardingPortalTokens/${tokenId}`
      );
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError("not-found", "Token not found.");
      const t = snap.data() || {};
      if (t.status === "active") {
        const now = admin.firestore.FieldValue.serverTimestamp();
        const batch = db().batch();
        batch.set(
          ref,
          {
            status: "revoked",
            revokedAt: now,
            revokedByUid: uid,
            revokeReason: "manual",
            updatedAt: now,
          },
          { merge: true }
        );
        if (t.tokenHash) {
          batch.set(
            db().doc(`onboardingPortalTokenLookup/${t.tokenHash}`),
            { status: "revoked", updatedAt: now },
            { merge: true }
          );
        }
        if (trimStr(t.runId) && trimStr(t.staffId)) {
          batch.set(
            db().doc(
              `salons/${salonId}/staff/${t.staffId}/onboardingRuns/${t.runId}`
            ),
            {
              portal: { activeTokenId: null, revokedAt: now },
              updatedAt: now,
            },
            { merge: true }
          );
        }
        await batch.commit();
      }
      logPortal("revoke_token", { salonId, tokenId });
      return { ok: true, revoked: 1 };
    }

    if (!staffId || !runId) {
      throw new HttpsError(
        "invalid-argument",
        "Provide tokenId or staffId+runId."
      );
    }
    const n = await revokeActiveTokensForRun(
      salonId,
      staffId,
      runId,
      "manual",
      uid
    );
    logPortal("revoke_run", { salonId, staffId, runId, revoked: n });
    return { ok: true, revoked: n };
  }
);

/**
 * Return active portal URL for a run without reissuing (manager Copy Link).
 * Uses sealedToken stored on the token doc (client rules deny read).
 */
exports.getOnboardingPortalActiveLink = onCall(
  { region: REGION, ...PORTAL_SECRET_OPTS },
  async (request) => {
    const uid = requireManagerAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    if (!salonId || !staffId || !runId) {
      throw new HttpsError("invalid-argument", "Missing salonId, staffId, or runId.");
    }
    await assertManager(uid, salonId);
    const q = await db()
      .collection(`salons/${salonId}/onboardingPortalTokens`)
      .where("runId", "==", runId)
      .where("status", "==", "active")
      .limit(1)
      .get();
    if (q.empty) {
      return { active: false, url: null, tokenId: null, expiresAt: null };
    }
    const doc = q.docs[0];
    const t = doc.data() || {};
    const exp = t.expiresAt && t.expiresAt.toMillis ? t.expiresAt.toMillis() : 0;
    if (!exp || exp < Date.now()) {
      return { active: false, url: null, tokenId: doc.id, expiresAt: null };
    }
    const raw = unsealRawToken(t.sealedToken);
    if (!raw) {
      // Legacy tokens issued before sealedToken — manager must reissue once.
      return {
        active: true,
        url: null,
        tokenId: doc.id,
        expiresAt: t.expiresAt.toDate().toISOString(),
        needsReissue: true,
      };
    }
    logPortal("get_active_link", { salonId, staffId, runId, tokenId: doc.id });
    return {
      active: true,
      url: portalUrl(raw),
      tokenId: doc.id,
      expiresAt: t.expiresAt.toDate().toISOString(),
      needsReissue: false,
    };
  }
);

/**
 * Manager-explicit Send / Resend of the onboarding portal link.
 * Reuses the active token when still valid; issues one only if missing/expired/unsealed.
 * Queues email via Trigger Email extension (writeupMailStaging on staging).
 */
exports.sendOnboardingPortalEmail = onCall(
  { region: REGION, ...PORTAL_SECRET_OPTS },
  async (request) => {
    const uid = requireManagerAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    if (!salonId || !staffId || !runId) {
      throw new HttpsError(
        "invalid-argument",
        "Missing salonId, staffId, or runId."
      );
    }
    await assertManager(uid, salonId);

    const runRef = db().doc(
      `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
    );
    const [runSnap, staffSnap, salonSnap] = await Promise.all([
      runRef.get(),
      db().doc(`salons/${salonId}/staff/${staffId}`).get(),
      db().doc(`salons/${salonId}`).get(),
    ]);
    if (!runSnap.exists) throw new HttpsError("not-found", "Onboarding run not found.");
    const run = runSnap.data() || {};
    if (run.status === "cancelled") {
      throw new HttpsError(
        "failed-precondition",
        "Cannot email a cancelled onboarding run."
      );
    }
    if (!staffSnap.exists) throw new HttpsError("not-found", "Staff not found.");
    const staff = staffSnap.data() || {};
    const toEmail = trimStr(staff.email).toLowerCase();
    if (!toEmail || !toEmail.includes("@")) {
      await runRef.set(
        {
          portal: {
            lastEmailStatus: "failed",
            lastEmailError: "no_email",
            lastEmailAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      throw new HttpsError(
        "failed-precondition",
        "This team member has no email address on file."
      );
    }

    let link;
    try {
      link = await ensureActivePortalLink({ salonId, staffId, runId, uid });
    } catch (e) {
      await runRef.set(
        {
          portal: {
            lastEmailStatus: "failed",
            lastEmailError: "link_issue_failed",
            lastEmailAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      throw e;
    }

    const salonName =
      trimStr(salonSnap.exists && (salonSnap.data() || {}).name) ||
      trimStr(salonSnap.exists && (salonSnap.data() || {}).salonName) ||
      "your salon";
    const staffName =
      trimStr(staff.name) || trimStr(staff.displayName) || "Team member";
    const packageName =
      trimStr(run.packageNameSnapshot) || "your onboarding";
    const dueLabel = formatDueForEmail(run.dueDate);

    const prevCount = Number((run.portal && run.portal.emailSendCount) || 0);
    const attempt = prevCount + 1;
    const mailId = `onboarding_${runId}_a${attempt}`;
    const subject = `Complete your onboarding at ${salonName}`.slice(0, 200);
    const textLines = [
      `Hi ${staffName.split(/\s+/)[0] || "there"},`,
      "",
      `Welcome! ${salonName} invited you to complete ${packageName} in Fair Flow.`,
      dueLabel ? `Due date: ${dueLabel}` : null,
      "",
      "Open your secure onboarding link (no Fair Flow login required):",
      link.url,
      "",
      `${salonName} via Fair Flow`,
    ].filter((x) => x != null);

    try {
      await db()
        .collection(onboardingMailCollectionForProject())
        .doc(mailId)
        .create({
          to: toEmail,
          message: {
            subject,
            text: textLines.join("\n"),
            html: buildOnboardingPortalEmailHtml({
              salonName,
              staffName,
              packageName,
              dueLabel,
              linkUrl: link.url,
            }),
          },
          salonId,
          staffId,
          runId,
          tokenId: link.tokenId,
          attempt,
          kind: "onboarding_portal_link",
          createdByUid: uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
      if (!err || err.code !== 6) {
        await runRef.set(
          {
            portal: {
              lastEmailStatus: "failed",
              lastEmailError: "queue_failed",
              lastEmailAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
              lastEmailToMasked: maskEmail(toEmail),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        logPortal("email_queue_failed", {
          salonId,
          staffId,
          runId,
          mailId,
          code: err && err.code,
        });
        throw new HttpsError(
          "internal",
          "Could not queue the onboarding email. Please try again."
        );
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const portalPatch = {
      lastEmailSentAt: now,
      lastEmailAttemptAt: now,
      lastEmailStatus: "queued",
      lastEmailError: null,
      lastEmailMailId: mailId,
      lastEmailToMasked: maskEmail(toEmail),
      emailSendCount: attempt,
      lastEmailTokenId: link.tokenId,
    };
    // Freeze first send time for the 24h automatic reminder clock.
    if (!firstEmailSentMs(run.portal)) {
      portalPatch.firstEmailSentAt = now;
    }
    const runPatch = {
      portal: portalPatch,
      updatedAt: now,
    };
    // First Send moves draft → sent so automatic reminders can target it.
    if (String(run.status || "") === "draft") {
      runPatch.status = "sent";
      runPatch.sentAt = now;
    }
    await runRef.set(runPatch, { merge: true });

    // Audit (best-effort)
    try {
      await runRef
        .collection("auditEvents")
        .doc(`email_${mailId}`)
        .create({
          type: "portal_email_queued",
          mailId,
          attempt,
          toMasked: maskEmail(toEmail),
          tokenId: link.tokenId,
          issuedNewToken: !!link.issued,
          byUid: uid,
          createdAt: now,
        });
    } catch (_) {}

    logPortal("email_queued", {
      salonId,
      staffId,
      runId,
      mailId,
      attempt,
      tokenId: link.tokenId,
      issuedNewToken: !!link.issued,
      toEmail,
    });

    return {
      ok: true,
      mailId,
      attempt,
      toMasked: maskEmail(toEmail),
      tokenId: link.tokenId,
      issuedNewToken: !!link.issued,
      expiresAt: link.expiresAt,
      status: "queued",
    };
  }
);

/**
 * Queue a reminder email for one run. Idempotent for automatic kinds via
 * deterministic mail IDs + portal.reminders[kind].mailId.
 *
 * @returns {{ ok, skipped?, reason?, mailId?, issuedNewToken?, kind }}
 */
async function queueOnboardingReminder({
  salonId,
  staffId,
  runId,
  kind,
  uid,
  forceManual = false,
}) {
  const runRef = db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
  );
  const [runSnap, staffSnap, salonSnap] = await Promise.all([
    runRef.get(),
    db().doc(`salons/${salonId}/staff/${staffId}`).get(),
    db().doc(`salons/${salonId}`).get(),
  ]);
  if (!runSnap.exists) {
    return { ok: false, skipped: true, reason: "run_missing", kind };
  }
  const run = runSnap.data() || {};
  if (!REMINDER_ELIGIBLE_STATUSES.has(String(run.status || ""))) {
    return { ok: false, skipped: true, reason: "status_" + (run.status || "none"), kind };
  }
  if (!forceManual && kind !== REMINDER_KIND_MANUAL && reminderAlreadySent(run.portal, kind)) {
    return { ok: true, skipped: true, reason: "already_sent", kind };
  }

  const staff = staffSnap.exists ? staffSnap.data() || {} : {};
  const toEmail = trimStr(staff.email).toLowerCase();
  if (!toEmail || !toEmail.includes("@")) {
    await runRef.set(
      {
        portal: {
          lastReminderStatus: "failed",
          lastReminderError: "no_email",
          lastReminderAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: false, skipped: true, reason: "no_email", kind };
  }

  let link;
  try {
    link = await ensureActivePortalLink({
      salonId,
      staffId,
      runId,
      uid: uid || "onboarding_reminder",
    });
  } catch (e) {
    await runRef.set(
      {
        portal: {
          lastReminderStatus: "failed",
          lastReminderError: "link_issue_failed",
          lastReminderAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    logPortal("reminder_link_failed", {
      salonId,
      staffId,
      runId,
      kind,
      message: String((e && e.message) || "").slice(0, 120),
    });
    return { ok: false, skipped: true, reason: "link_issue_failed", kind };
  }

  const salonName =
    trimStr(salonSnap.exists && (salonSnap.data() || {}).name) ||
    trimStr(salonSnap.exists && (salonSnap.data() || {}).salonName) ||
    "your salon";
  const staffName =
    trimStr(staff.name) || trimStr(staff.displayName) || "Team member";
  const packageName = trimStr(run.packageNameSnapshot) || "your onboarding";
  const dueLabel = formatDueForEmail(run.dueDate);

  let mailId;
  let manualAttempt = null;
  if (kind === REMINDER_KIND_MANUAL) {
    manualAttempt = Number((run.portal && run.portal.reminderManualCount) || 0) + 1;
    mailId = `onboarding_reminder_${runId}_manual_a${manualAttempt}`;
  } else {
    mailId = `onboarding_reminder_${runId}_${kind}`;
  }

  const subject = (
    kind === REMINDER_KIND_BEFORE_DUE
      ? `Reminder: onboarding due soon at ${salonName}`
      : `Reminder: complete your onboarding at ${salonName}`
  ).slice(0, 200);

  const textLines = [
    `Hi ${staffName.split(/\s+/)[0] || "there"},`,
    "",
    `This is a friendly reminder from ${salonName} to complete ${packageName}.`,
    dueLabel ? `Due date: ${dueLabel}` : null,
    "",
    "Open your secure onboarding link:",
    link.url,
    "",
    `${salonName} via Fair Flow`,
  ].filter((x) => x != null);

  let alreadyExisted = false;
  try {
    await db()
      .collection(onboardingMailCollectionForProject())
      .doc(mailId)
      .create({
        to: toEmail,
        message: {
          subject,
          text: textLines.join("\n"),
          html: buildOnboardingPortalEmailHtml({
            salonName,
            staffName,
            packageName,
            dueLabel,
            linkUrl: link.url,
            reminder: true,
          }),
        },
        salonId,
        staffId,
        runId,
        tokenId: link.tokenId,
        kind: `onboarding_reminder_${kind}`,
        reminderKind: kind,
        createdByUid: uid || "onboarding_reminder",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (err) {
    if (err && err.code === 6) {
      alreadyExisted = true;
    } else {
      await runRef.set(
        {
          portal: {
            lastReminderStatus: "failed",
            lastReminderError: "queue_failed",
            lastReminderAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
            lastReminderToMasked: maskEmail(toEmail),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      logPortal("reminder_queue_failed", {
        salonId,
        staffId,
        runId,
        kind,
        mailId,
        code: err && err.code,
      });
      return { ok: false, skipped: true, reason: "queue_failed", kind };
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const prevReminderCount = Number((run.portal && run.portal.reminderCount) || 0);
  const prevReminders = (run.portal && run.portal.reminders) || {};
  const portalUpdate = {
    lastReminderAt: now,
    lastReminderAttemptAt: now,
    lastReminderStatus: "queued",
    lastReminderError: null,
    lastReminderMailId: mailId,
    lastReminderKind: kind,
    lastReminderToMasked: maskEmail(toEmail),
    reminderCount: alreadyExisted ? prevReminderCount : prevReminderCount + 1,
    reminders: {
      ...prevReminders,
      [kind]: {
        status: "queued",
        mailId,
        sentAt: now,
        tokenId: link.tokenId,
      },
    },
  };
  if (kind === REMINDER_KIND_MANUAL && manualAttempt != null) {
    portalUpdate.reminderManualCount = manualAttempt;
  }

  await runRef.set(
    {
      portal: portalUpdate,
      updatedAt: now,
    },
    { merge: true }
  );

  try {
    await runRef
      .collection("auditEvents")
      .doc(`reminder_${mailId}`)
      .create({
        type: "portal_reminder_queued",
        mailId,
        kind,
        toMasked: maskEmail(toEmail),
        tokenId: link.tokenId,
        issuedNewToken: !!link.issued,
        byUid: uid || "onboarding_reminder",
        duplicate: alreadyExisted,
        createdAt: now,
      });
  } catch (_) {}

  logPortal(alreadyExisted ? "reminder_deduped" : "reminder_queued", {
    salonId,
    staffId,
    runId,
    kind,
    mailId,
    tokenId: link.tokenId,
    issuedNewToken: !!link.issued,
    toEmail,
  });

  return {
    ok: true,
    skipped: alreadyExisted,
    reason: alreadyExisted ? "already_sent" : null,
    mailId,
    kind,
    issuedNewToken: !!link.issued,
    tokenId: link.tokenId,
    status: "queued",
  };
}

function shouldSendAfterSend24h(run, nowMs) {
  if (!REMINDER_ELIGIBLE_STATUSES.has(String(run.status || ""))) return false;
  if (reminderAlreadySent(run.portal, REMINDER_KIND_AFTER_SEND)) return false;
  const firstMs = firstEmailSentMs(run.portal);
  if (!firstMs) return false;
  return nowMs >= firstMs + REMINDER_AFTER_SEND_MS;
}

function shouldSendBeforeDue24h(run, nowMs) {
  if (!REMINDER_ELIGIBLE_STATUSES.has(String(run.status || ""))) return false;
  if (reminderAlreadySent(run.portal, REMINDER_KIND_BEFORE_DUE)) return false;
  const dueMs = parseDueMs(run.dueDate);
  if (!dueMs) return false;
  if (nowMs > dueMs) return false; // due already passed
  return nowMs >= dueMs - REMINDER_BEFORE_DUE_MS;
}

function managerIncompleteInboxAlreadyCreated(portal) {
  const p = portal || {};
  if (p.managerIncompleteInboxAt) return true;
  if (Array.isArray(p.managerIncompleteInboxIds) && p.managerIncompleteInboxIds.length) {
    return true;
  }
  return false;
}

function shouldCreateManagerIncompleteInbox(run, nowMs) {
  if (!REMINDER_ELIGIBLE_STATUSES.has(String(run.status || ""))) return false;
  if (managerIncompleteInboxAlreadyCreated(run.portal)) return false;
  const firstMs = firstEmailSentMs(run.portal);
  if (!firstMs) return false;
  return nowMs >= firstMs + MANAGER_INCOMPLETE_INBOX_MS;
}

async function getSalonManagersForOnboardingInbox(salonId) {
  const snap = await db()
    .collection("users")
    .where("salonId", "==", salonId)
    .get();
  const out = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    const r = String(x.role || "").toLowerCase();
    if (["owner", "admin", "manager"].includes(r)) {
      out.push({
        uid: d.id,
        staffId: String(x.staffId || ""),
        name: String(x.name || x.displayName || "").trim() || d.id,
        role: r,
      });
    }
  });
  return out;
}

function buildManagerIncompleteInboxId(managerUid, staffId, runId) {
  const clean = (s) =>
    String(s || "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 120);
  const id = `auto_odonboard_${clean(managerUid)}_${clean(staffId)}_${clean(runId)}`;
  return id.length > 1400 ? id.slice(0, 1400) : id;
}

/**
 * One Inbox item per manager when a run stays incomplete 7+ days after first email.
 * Deterministic doc ids + portal.managerIncompleteInboxAt prevent duplicates.
 */
async function queueManagerIncompleteOnboardingInbox({
  salonId,
  staffId,
  runId,
  run,
} = {}) {
  const managers = await getSalonManagersForOnboardingInbox(salonId);
  if (!managers.length) {
    logPortal("manager_incomplete_inbox_no_managers", { salonId, staffId, runId });
    return { ok: false, skipped: true, reason: "no_managers" };
  }

  const staffSnap = await db().doc(`salons/${salonId}/staff/${staffId}`).get();
  const staff = staffSnap.exists ? staffSnap.data() || {} : {};
  const staffName =
    trimStr(staff.name) ||
    trimStr(staff.displayName) ||
    "A staff member";
  const packageName =
    trimStr(run && run.packageNameSnapshot) || "onboarding";
  const prog = (run && run.progress) || {};
  const reqDone = Number(prog.requiredCompleted || 0);
  const reqTotal = Number(prog.requiredTotal || 0);
  const progressLabel =
    reqTotal > 0 ? `${reqDone}/${reqTotal} required` : String(run.status || "in progress");
  const message = `${staffName} has not finished ${packageName} (${progressLabel}). Onboarding was sent over a week ago.`;

  const batch = db().batch();
  const createdIds = [];
  const creator = managers.find((m) => m.role === "owner") || managers[0];

  for (const m of managers) {
    const itemId = buildManagerIncompleteInboxId(m.uid, staffId, runId);
    const ref = db().collection(`salons/${salonId}/inboxItems`).doc(itemId);
    // eslint-disable-next-line no-await-in-loop
    const existing = await ref.get();
    if (existing.exists) {
      createdIds.push(itemId);
      continue;
    }
    batch.set(ref, {
      tenantId: salonId,
      locationId: null,
      type: MANAGER_INCOMPLETE_INBOX_TYPE,
      status: "open",
      priority: "normal",
      assignedTo: null,
      sentToStaffIds: [],
      sentToNames: [],
      message,
      source: "employee_onboarding",
      staffId,
      data: {
        source: "employee_onboarding",
        staffId,
        runId,
        packageName,
        subjectStaffName: staffName,
        progressRequiredCompleted: reqDone,
        progressRequiredTotal: reqTotal,
        runStatus: String((run && run.status) || ""),
        message,
        automated: true,
        daysThreshold: 7,
      },
      managerNotes: null,
      responseNote: null,
      decidedBy: null,
      decidedAt: null,
      needsInfoQuestion: null,
      staffReply: null,
      visibility: "managers_only",
      unreadForManagers: true,
      createdByUid: creator.uid,
      createdByStaffId: creator.staffId || "",
      createdByName: "Onboarding",
      createdByRole: "system",
      forUid: m.uid,
      forStaffId: m.staffId || "",
      forStaffName: m.name || "Manager",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: null,
    });
    createdIds.push(itemId);
  }

  const runRef = db().doc(
    `salons/${salonId}/staff/${staffId}/onboardingRuns/${runId}`
  );
  batch.set(
    runRef,
    {
      portal: {
        managerIncompleteInboxAt: admin.firestore.FieldValue.serverTimestamp(),
        managerIncompleteInboxIds: createdIds,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();
  logPortal("manager_incomplete_inbox_queued", {
    salonId,
    staffId,
    runId,
    count: createdIds.length,
  });
  return { ok: true, inboxIds: createdIds };
}

/**
 * Sweep open onboarding runs and queue due automatic reminders.
 * Safe to re-run: deterministic mail IDs + reminder stamps dedupe.
 */
async function processOnboardingReminders({ limit = 200 } = {}) {
  const nowMs = Date.now();
  const summary = {
    scanned: 0,
    afterSend: 0,
    beforeDue: 0,
    managerInbox: 0,
    skipped: 0,
    failed: 0,
  };

  let snap;
  try {
    snap = await db()
      .collectionGroup("onboardingRuns")
      .where("status", "in", ["sent", "in_progress"])
      .limit(Math.max(1, Math.min(500, Number(limit) || 200)))
      .get();
  } catch (e) {
    // Fallback: iterate salons if collection-group index missing
    logPortal("reminder_sweep_fallback", {
      message: String((e && e.message) || "").slice(0, 160),
    });
    const salons = await db().collection("salons").select().limit(100).get();
    const docs = [];
    for (const salonDoc of salons.docs) {
      const staffSnap = await db()
        .collection(`salons/${salonDoc.id}/staff`)
        .select()
        .limit(80)
        .get();
      for (const staffDoc of staffSnap.docs) {
        const runs = await db()
          .collection(
            `salons/${salonDoc.id}/staff/${staffDoc.id}/onboardingRuns`
          )
          .where("status", "in", ["sent", "in_progress"])
          .limit(20)
          .get();
        docs.push(...runs.docs);
        if (docs.length >= limit) break;
      }
      if (docs.length >= limit) break;
    }
    snap = { docs, empty: docs.length === 0, size: docs.length };
  }

  for (const doc of snap.docs) {
    summary.scanned += 1;
    const parts = doc.ref.path.split("/");
    // salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}
    if (parts.length < 6) continue;
    const salonId = parts[1];
    const staffId = parts[3];
    const runId = parts[5];
    const run = doc.data() || {};

    const jobs = [];
    if (shouldSendAfterSend24h(run, nowMs)) {
      jobs.push(REMINDER_KIND_AFTER_SEND);
    }
    if (shouldSendBeforeDue24h(run, nowMs)) {
      jobs.push(REMINDER_KIND_BEFORE_DUE);
    }
    let didWork = false;

    for (const kind of jobs) {
      try {
        const result = await queueOnboardingReminder({
          salonId,
          staffId,
          runId,
          kind,
          uid: null,
        });
        if (result.ok && !result.skipped) {
          didWork = true;
          if (kind === REMINDER_KIND_AFTER_SEND) summary.afterSend += 1;
          if (kind === REMINDER_KIND_BEFORE_DUE) summary.beforeDue += 1;
        } else if (result.skipped) {
          summary.skipped += 1;
        } else {
          summary.failed += 1;
        }
      } catch (e) {
        summary.failed += 1;
        logPortal("reminder_sweep_item_error", {
          salonId,
          staffId,
          runId,
          kind,
          message: String((e && e.message) || "").slice(0, 120),
        });
      }
    }

    if (shouldCreateManagerIncompleteInbox(run, nowMs)) {
      try {
        const inboxRes = await queueManagerIncompleteOnboardingInbox({
          salonId,
          staffId,
          runId,
          run,
        });
        if (inboxRes && inboxRes.ok) {
          didWork = true;
          summary.managerInbox += 1;
        } else if (inboxRes && inboxRes.skipped) {
          summary.skipped += 1;
        } else {
          summary.failed += 1;
        }
      } catch (e) {
        summary.failed += 1;
        logPortal("manager_incomplete_inbox_error", {
          salonId,
          staffId,
          runId,
          message: String((e && e.message) || "").slice(0, 120),
        });
      }
    }

    if (!jobs.length && !didWork) {
      summary.skipped += 1;
    }
  }

  logPortal("reminder_sweep_done", summary);
  return summary;
}

exports.onboardingRemindersHourly = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "UTC",
    region: REGION,
    timeoutSeconds: 540,
    memory: "256MiB",
    retryCount: 0,
    secrets: [ONBOARDING_PORTAL_HMAC_SECRET],
  },
  async () => {
    await processOnboardingReminders({ limit: 300 });
  }
);

/** Manager: Send Reminder Now (manual). */
exports.sendOnboardingPortalReminder = onCall(
  { region: REGION, ...PORTAL_SECRET_OPTS },
  async (request) => {
    const uid = requireManagerAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const staffId = trimStr(request.data && request.data.staffId);
    const runId = trimStr(request.data && request.data.runId);
    if (!salonId || !staffId || !runId) {
      throw new HttpsError(
        "invalid-argument",
        "Missing salonId, staffId, or runId."
      );
    }
    await assertManager(uid, salonId);
    const result = await queueOnboardingReminder({
      salonId,
      staffId,
      runId,
      kind: REMINDER_KIND_MANUAL,
      uid,
      forceManual: true,
    });
    if (!result.ok) {
      const map = {
        no_email: "This team member has no email address on file.",
        status_completed: "This onboarding is already complete.",
        status_cancelled: "This onboarding was cancelled.",
        status_draft: "Send the onboarding email before sending a reminder.",
        link_issue_failed: "Could not prepare a portal link for the reminder.",
        queue_failed: "Could not queue the reminder email. Please try again.",
        run_missing: "Onboarding run not found.",
      };
      const key = String(result.reason || "");
      const msg =
        map[key] ||
        (key.startsWith("status_")
          ? "Reminders are only sent for in-progress onboarding."
          : "Could not send reminder.");
      throw new HttpsError(
        key === "run_missing" ? "not-found" : "failed-precondition",
        msg
      );
    }
    return result;
  }
);

/**
 * Manager/ops: run the automatic reminder sweep immediately (staging verify / catch-up).
 * Idempotent — safe if the hourly job also runs.
 */
exports.runOnboardingRemindersSweep = onCall(
  { region: REGION, ...PORTAL_SECRET_OPTS },
  async (request) => {
    const uid = requireManagerAuth(request);
    const userSnap = await db().doc(`users/${uid}`).get();
    const salonId = trimStr(userSnap.exists && (userSnap.data() || {}).salonId);
    if (!salonId) {
      throw new HttpsError("permission-denied", "Managers only.");
    }
    await assertManager(uid, salonId);
    const summary = await processOnboardingReminders({
      limit: Number(request.data && request.data.limit) || 200,
    });
    return { ok: true, summary };
  }
);

exports.extendOnboardingPortalToken = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireManagerAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const tokenId = trimStr(request.data && request.data.tokenId);
    const runId = trimStr(request.data && request.data.runId);
    const staffId = trimStr(request.data && request.data.staffId);
    const addDays = Math.min(
      MAX_TTL_DAYS,
      Math.max(1, Number(request.data && request.data.addDays) || DEFAULT_TTL_DAYS)
    );
    if (!salonId) throw new HttpsError("invalid-argument", "Missing salonId.");
    await assertManager(uid, salonId);

    let ref;
    if (tokenId) {
      ref = db().doc(`salons/${salonId}/onboardingPortalTokens/${tokenId}`);
    } else if (runId) {
      const q = await db()
        .collection(`salons/${salonId}/onboardingPortalTokens`)
        .where("runId", "==", runId)
        .where("status", "==", "active")
        .limit(1)
        .get();
      if (q.empty) throw new HttpsError("not-found", "No active portal token.");
      ref = q.docs[0].ref;
    } else {
      throw new HttpsError("invalid-argument", "Missing tokenId or runId.");
    }

    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Token not found.");
    const t = snap.data() || {};
    if (t.status !== "active") {
      throw new HttpsError("failed-precondition", "Token is not active.");
    }
    const baseMs =
      t.expiresAt && t.expiresAt.toMillis
        ? Math.max(t.expiresAt.toMillis(), Date.now())
        : Date.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      baseMs + addDays * 24 * 60 * 60 * 1000
    );
    await ref.set(
      {
        expiresAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    const sid = staffId || trimStr(t.staffId);
    const rid = runId || trimStr(t.runId);
    if (sid && rid) {
      await db()
        .doc(`salons/${salonId}/staff/${sid}/onboardingRuns/${rid}`)
        .set(
          {
            portal: { expiresAt },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    }
    logPortal("extend", { salonId, tokenId: ref.id, addDays });
    return { ok: true, tokenId: ref.id, expiresAt: expiresAt.toDate().toISOString() };
  }
);

// ─── Portal HTTP actions (unauthenticated; auth via token/session) ───────────
// Uses onRequest (not onCall+invoker:public) because org policy blocks setting
// Cloud Run invoker IAM from the Firebase CLI on this project.

function httpsErrorToHttp(err) {
  const code = (err && err.code) || "internal";
  const map = {
    "invalid-argument": 400,
    unauthenticated: 401,
    "permission-denied": 403,
    "not-found": 404,
    "failed-precondition": 409,
    aborted: 409,
    "resource-exhausted": 429,
    "deadline-exceeded": 504,
  };
  return map[code] || 500;
}

function wrapPortalHttp(handler) {
  return onRequest(
    {
      region: REGION,
      cors: true,
      ...PORTAL_SECRET_OPTS,
      // invoker omitted — same pattern as mediaDownloadFile on this project
    },
    async (req, res) => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }
      if (req.method !== "POST") {
        res.status(405).json({ error: "POST only" });
        return;
      }
      try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const data = body.data && typeof body.data === "object" ? body.data : body;
        const request = { data, rawRequest: req, auth: null };
        const result = await handler(request);
        res.status(200).json({ result });
      } catch (e) {
        const message =
          (e && e.message) || "Request failed.";
        // Never echo token-like payloads
        logPortal("http_error", {
          message: String(message).slice(0, 200),
          code: e && e.code,
        });
        res.status(httpsErrorToHttp(e)).json({
          error: { message, status: (e && e.code) || "internal" },
        });
      }
    }
  );
}

async function handleBootstrap(request) {
  const ctx = await resolvePortalAccess(request.data && request.data.token, request, {
    allowCompletedRead: true,
    mutating: false,
  });
  const sessionToken = mintSession(ctx);
  const tokenSnap = await ctx.tokenRef.get();
  const t = tokenSnap.data() || {};
  let dto = buildPortalDto(ctx, sessionToken);
  dto.expiresAt =
    t.expiresAt && t.expiresAt.toDate
      ? t.expiresAt.toDate().toISOString()
      : null;
  dto = await enrichSalonStaffNames(dto, ctx.salonId, ctx.staffId);
  logPortal("bootstrap", {
    salonId: ctx.salonId,
    staffId: ctx.staffId,
    runId: ctx.runId,
    tokenId: ctx.tokenId,
    readOnly: ctx.readOnly,
  });
  return dto;
}

async function handleGetState(request) {
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  const sessionToken = mintSession(ctx);
  const tokenSnap = await ctx.tokenRef.get();
  const t = tokenSnap.data() || {};
  let dto = buildPortalDto(ctx, sessionToken);
  dto.expiresAt =
    t.expiresAt && t.expiresAt.toDate
      ? t.expiresAt.toDate().toISOString()
      : null;
  dto = await enrichSalonStaffNames(dto, ctx.salonId, ctx.staffId);
  return dto;
}

async function handleAckPolicy(request) {
  // Resolve read-first so already-completed policy acks stay idempotent
  // even after the run flips to completed (read-only).
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  const taskId = trimStr(request.data && request.data.taskId);
  const typedName = trimStr(request.data && request.data.typedName);
  if (!taskId) throw new HttpsError("invalid-argument", "Missing taskId.");

  const existing = (ctx.tasks || []).find((t) => t.id === taskId);
  if (!existing) throw new HttpsError("not-found", "Task not found.");
  if (existing.taskType !== "policy_acknowledgement") {
    throw new HttpsError("failed-precondition", "Not a policy task.");
  }
  if (existing.status === "completed") {
    return buildPortalDto(ctx, mintSession(ctx));
  }
  if (ctx.readOnly || ctx.run.status === "completed") {
    throw new HttpsError(
      "failed-precondition",
      "This onboarding is complete. Viewing only."
    );
  }

  const taskRef = db().doc(
    `salons/${ctx.salonId}/staff/${ctx.staffId}/onboardingRuns/${ctx.runId}/tasks/${taskId}`
  );

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
    const task = snap.data() || {};
    if (task.taskType !== "policy_acknowledgement") {
      throw new HttpsError("failed-precondition", "Not a policy task.");
    }
    if (task.status === "completed") return;
    const cfg = task.configSnapshot || {};
    if (cfg.requireTypedName === true && !typedName) {
      throw new HttpsError("invalid-argument", "Full name is required.");
    }
    tx.update(taskRef, {
      status: "completed",
      result: {
        acknowledgedAt: admin.firestore.Timestamp.now(),
        acknowledgedByUid: null,
        acknowledgedByName: cfg.requireTypedName ? typedName : null,
        policyVersion: String(cfg.version || "1.0"),
        via: "portal",
      },
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedBy: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await recomputeRunInTxn(ctx.salonId, ctx.staffId, ctx.runId);
  logPortal("ack_policy", {
    salonId: ctx.salonId,
    runId: ctx.runId,
    taskId,
    tokenId: ctx.tokenId,
  });

  const fresh = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  return buildPortalDto(fresh, mintSession(fresh));
}

async function handleCreateUpload(request) {
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: true }
  );
  await assertRateLimit(
    `salons/${ctx.salonId}/onboardingPortalRateLimits/up_${ctx.runId}`,
    RATE_UPLOAD_LIMIT,
    RATE_UPLOAD_WINDOW_MS
  );

  const taskId = trimStr(request.data && request.data.taskId);
  const fileName = trimStr(request.data && request.data.fileName).slice(0, 120);
  const contentType =
    trimStr(request.data && request.data.contentType) || "application/octet-stream";
  const size = Number(request.data && request.data.size) || 0;
  if (!taskId || !fileName) {
    throw new HttpsError("invalid-argument", "Missing taskId or fileName.");
  }

  const task = (ctx.tasks || []).find((t) => t.id === taskId);
  if (!task) throw new HttpsError("not-found", "Task not found.");
  if (task.taskType !== "document" && task.taskType !== "file_upload") {
    throw new HttpsError("failed-precondition", "Not an upload task.");
  }
  if (task.status === "completed") {
    throw new HttpsError("failed-precondition", "Task already completed.");
  }
  const cfg = task.configSnapshot || {};
  const maxMb = Number(cfg.maxSizeMb) || 10;
  if (size > maxMb * 1024 * 1024) {
    throw new HttpsError("invalid-argument", `File must be under ${maxMb} MB.`);
  }

  const uploadId = db()
    .collection(`salons/${ctx.salonId}/onboardingPortalUploads`)
    .doc().id;
  const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 80);
  const storagePath = `salons/${ctx.salonId}/onboarding-portal/${ctx.staffId}/${ctx.runId}/${taskId}/${uploadId}_${safeName}`;
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + UPLOAD_URL_TTL_MS
  );

  await db()
    .doc(`salons/${ctx.salonId}/onboardingPortalUploads/${uploadId}`)
    .set({
      salonId: ctx.salonId,
      staffId: ctx.staffId,
      runId: ctx.runId,
      taskId,
      tokenId: ctx.tokenId,
      storagePath,
      contentType,
      maxSize: maxMb * 1024 * 1024,
      fileName,
      status: "reserved",
      expiresAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  const bucket = await resolvePortalBucket();
  const file = bucket.file(storagePath);
  const [uploadUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_TTL_MS,
    contentType,
  });

  logPortal("create_upload", {
    salonId: ctx.salonId,
    runId: ctx.runId,
    taskId,
    uploadId,
    tokenId: ctx.tokenId,
  });

  return {
    uploadId,
    uploadUrl,
    storagePath,
    contentType,
    expiresAt: expiresAt.toDate().toISOString(),
  };
}

async function handleFinalizeUpload(request) {
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: true }
  );
  const uploadId = trimStr(request.data && request.data.uploadId);
  const expirationDate =
    trimStr(request.data && request.data.expirationDate) || null;
  const notes = trimStr(request.data && request.data.notes) || null;
  if (!uploadId) throw new HttpsError("invalid-argument", "Missing uploadId.");

  const uploadRef = db().doc(
    `salons/${ctx.salonId}/onboardingPortalUploads/${uploadId}`
  );
  const uploadSnap = await uploadRef.get();
  if (!uploadSnap.exists) throw new HttpsError("not-found", "Upload not found.");
  const up = uploadSnap.data() || {};
  if (up.status === "finalized" && up.inboxItemId) {
    const fresh = await resolveSessionAccess(
      request.data && request.data.sessionToken,
      request,
      { mutating: false }
    );
    return {
      ok: true,
      inboxItemId: up.inboxItemId,
      state: buildPortalDto(fresh, mintSession(fresh)),
    };
  }
  if (
    trimStr(up.staffId) !== ctx.staffId ||
    trimStr(up.runId) !== ctx.runId ||
    trimStr(up.tokenId) !== ctx.tokenId
  ) {
    throw new HttpsError("permission-denied", "Upload does not match session.");
  }
  const exp = up.expiresAt && up.expiresAt.toMillis ? up.expiresAt.toMillis() : 0;
  if (exp && exp < Date.now() && up.status !== "finalized") {
    throw new HttpsError("deadline-exceeded", "Upload slot expired.");
  }

  const taskId = trimStr(up.taskId);
  const task = (ctx.tasks || []).find((t) => t.id === taskId);
  if (!task) throw new HttpsError("not-found", "Task not found.");
  if (task.status === "completed") {
    throw new HttpsError("failed-precondition", "Task already completed.");
  }

  const storagePath = trimStr(up.storagePath);
  const bucket = await resolvePortalBucket();
  const portalFile = bucket.file(storagePath);
  const [exists] = await portalFile.exists();
  if (!exists) {
    throw new HttpsError("failed-precondition", "File not uploaded yet.");
  }
  const [meta] = await portalFile.getMetadata();
  const size = Number(meta.size || 0);
  if (up.maxSize && size > Number(up.maxSize)) {
    throw new HttpsError("invalid-argument", "File too large.");
  }

  const documentType = String(
    task.templateNameSnapshot || task.templateId || "Other"
  ).replace(/[^a-zA-Z0-9._ -]/g, "_");
  const yyyyMm = new Date().toISOString().slice(0, 7);
  const safeName = String(up.fileName || "file")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .slice(0, 80);
  const destPath = `salons/${ctx.salonId}/staff/${ctx.staffId}/documents/${documentType}/${yyyyMm}/${uploadId}_${safeName}`;
  const destFile = bucket.file(destPath);
  await portalFile.copy(destFile);
  const [fileUrl] = await destFile.getSignedUrl({
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  const inboxRef = db().collection(`salons/${ctx.salonId}/inboxItems`).doc();
  await inboxRef.set({
    tenantId: ctx.salonId,
    locationId: null,
    type: "document_upload",
    status: "open",
    priority: "normal",
    assignedTo: null,
    sentToStaffIds: [],
    sentToNames: [],
    data: {
      documentType,
      expirationDate,
      filePath: destPath,
      fileUrl,
      fileName: up.fileName || safeName,
      notes,
      documentOwnerStaffId: ctx.staffId,
      onboardingRunId: ctx.runId,
      onboardingTaskId: taskId,
      templateId: task.templateId || taskId,
      taskType: task.taskType,
      via: "portal",
    },
    managerNotes: null,
    responseNote: null,
    decidedBy: null,
    decidedAt: null,
    needsInfoQuestion: null,
    staffReply: null,
    visibility: "managers_only",
    unreadForManagers: true,
    documentOwnerStaffId: ctx.staffId,
    createdByUid: "onboarding_portal",
    createdByStaffId: ctx.staffId,
    createdByName: "Onboarding Portal",
    createdByRole: "portal",
    forUid: "onboarding_portal",
    forStaffId: ctx.staffId,
    forStaffName: "Onboarding Portal",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: null,
  });

  const taskRef = db().doc(
    `salons/${ctx.salonId}/staff/${ctx.staffId}/onboardingRuns/${ctx.runId}/tasks/${taskId}`
  );
  await db().runTransaction(async (tx) => {
    const ts = await tx.get(taskRef);
    if (!ts.exists) return;
    const cur = ts.data() || {};
    if (cur.status === "completed") return;
    tx.update(taskRef, {
      status: "waiting_approval",
      result: {
        ...(cur.result || {}),
        inboxItemId: inboxRef.id,
        fileName: up.fileName || safeName,
        storagePath: destPath,
        portalUploadId: uploadId,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await uploadRef.set(
    {
      status: "finalized",
      inboxItemId: inboxRef.id,
      destPath,
      finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await recomputeRunInTxn(ctx.salonId, ctx.staffId, ctx.runId);
  logPortal("finalize_upload", {
    salonId: ctx.salonId,
    runId: ctx.runId,
    taskId,
    uploadId,
    inboxItemId: inboxRef.id,
    tokenId: ctx.tokenId,
  });

  const fresh = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  return {
    ok: true,
    inboxItemId: inboxRef.id,
    state: buildPortalDto(fresh, mintSession(fresh)),
  };
}

async function handleGetSignaturePacket(request) {
  const esign = require("./onboarding-esign-seal");
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  const taskId = trimStr(request.data && request.data.taskId);
  if (!taskId) throw new HttpsError("invalid-argument", "Missing taskId.");
  const task = (ctx.tasks || []).find((t) => t.id === taskId);
  if (!task) throw new HttpsError("not-found", "Task not found.");
  if (task.taskType !== "electronic_signature") {
    throw new HttpsError("failed-precondition", "Not an e-sign task.");
  }
  const cfg = esign.esignCfg(task);
  esign.assertEsignAllowed(cfg);

  // Always verify snapshot hash still matches library bytes
  const source = await esign.downloadSourcePdf(ctx.salonId, cfg);
  const bucket = await esign.resolveBucket();
  const [readUrl] = await bucket.file(source.storagePath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + esign.PACKET_URL_TTL_MS,
  });

  const ip = clientIp(request);
  const ua = String(
    (request.rawRequest &&
      request.rawRequest.headers &&
      request.rawRequest.headers["user-agent"]) ||
      ""
  ).slice(0, 300);
  try {
    await esign.writeAudit(
      ctx.salonId,
      ctx.staffId,
      ctx.runId,
      taskId,
      `packet_viewed_${Date.now()}`,
      {
        type: "packet_viewed",
        portalTokenId: ctx.tokenId,
        ip,
        userAgent: ua,
        documentVersionId: source.documentVersionId,
        documentSha256: source.sha,
      }
    );
  } catch (_) {}

  return {
    taskId,
    readOnly: !!ctx.readOnly || task.status === "completed",
    status: task.status || "pending",
    documentTitle: String(cfg.documentTitle || task.templateNameSnapshot || ""),
    documentVersion:
      cfg.documentVersion != null ? cfg.documentVersion : source.documentVersionId,
    pageCount: Number(cfg.pageCount) || null,
    requireTypedName: cfg.requireTypedName === true,
    requireDrawnSignature: cfg.requireDrawnSignature !== false,
    consentText: String(cfg.consentText || ""),
    fieldSchema: esign.publicFieldSchema(cfg.fieldSchema),
    pdfReadUrl: readUrl,
    pdfReadUrlExpiresAt: new Date(
      Date.now() + esign.PACKET_URL_TTL_MS
    ).toISOString(),
    // Intentionally omit IP, source storage path internals beyond signed URL
    resultPublic: esign.publicEsignResult(task.result || {}),
  };
}

async function handleSubmitSignature(request) {
  const esign = require("./onboarding-esign-seal");
  // Read-first so completed stays idempotent after run completes
  const ctx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  const taskId = trimStr(request.data && request.data.taskId);
  if (!taskId) throw new HttpsError("invalid-argument", "Missing taskId.");

  const existing = (ctx.tasks || []).find((t) => t.id === taskId);
  if (!existing) throw new HttpsError("not-found", "Task not found.");
  if (existing.taskType !== "electronic_signature") {
    throw new HttpsError("failed-precondition", "Not an e-sign task.");
  }

  const cfg = esign.esignCfg(existing);
  const { documentVersionId } = esign.documentIds(cfg);
  const sealId = esign.sealIdFor(taskId, documentVersionId);

  if (existing.status === "completed" && existing.result && existing.result.sealId) {
    return {
      ok: true,
      alreadyCompleted: true,
      sealId: existing.result.sealId,
      result: esign.publicEsignResult(existing.result),
      state: buildPortalDto(ctx, mintSession(ctx)),
    };
  }

  if (ctx.readOnly || ctx.run.status === "completed" || ctx.run.status === "cancelled") {
    throw new HttpsError(
      "failed-precondition",
      "This onboarding cannot accept signatures right now."
    );
  }
  if (existing.status === "completed") {
    throw new HttpsError("failed-precondition", "Task already completed.");
  }

  const validated = esign.validateEsignSubmission(existing, request.data || {});
  const ip = clientIp(request);
  const ua = String(
    (request.rawRequest &&
      request.rawRequest.headers &&
      request.rawRequest.headers["user-agent"]) ||
      ""
  ).slice(0, 300);

  const taskRef = db().doc(
    `salons/${ctx.salonId}/staff/${ctx.staffId}/onboardingRuns/${ctx.runId}/tasks/${taskId}`
  );

  // Lock → sealing (or no-op if already sealing/completed)
  let skipSeal = false;
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) throw new HttpsError("not-found", "Task not found.");
    const cur = snap.data() || {};
    if (cur.taskType !== "electronic_signature") {
      throw new HttpsError("failed-precondition", "Not an e-sign task.");
    }
    if (cur.status === "completed" && cur.result && cur.result.sealId) {
      skipSeal = true;
      return;
    }
    if (cur.status === "sealing") {
      // Another request is sealing — allow this request to retry/finish seal
      return;
    }
    if (
      !["pending", "in_progress", "rejected"].includes(String(cur.status || "pending"))
    ) {
      throw new HttpsError(
        "failed-precondition",
        `Task cannot be signed from status ${cur.status}.`
      );
    }
    tx.set(
      taskRef,
      {
        status: "sealing",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        result: {
          ...(cur.result || {}),
          sealId,
          sealingStartedAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );
  });

  // Re-read if completed during lock
  const freshSnap = await taskRef.get();
  const freshTask = { id: taskId, ...(freshSnap.data() || {}) };
  if (freshTask.status === "completed" && freshTask.result && freshTask.result.sealId) {
    const freshCtx = await resolveSessionAccess(
      request.data && request.data.sessionToken,
      request,
      { mutating: false }
    );
    return {
      ok: true,
      alreadyCompleted: true,
      sealId: freshTask.result.sealId,
      result: esign.publicEsignResult(freshTask.result),
      state: buildPortalDto(freshCtx, mintSession(freshCtx)),
    };
  }

  try {
    await esign.writeAudit(
      ctx.salonId,
      ctx.staffId,
      ctx.runId,
      taskId,
      `submit_accepted_${sealId}`,
      {
        type: "submit_accepted",
        sealId,
        portalTokenId: ctx.tokenId,
        ip,
        userAgent: ua,
        signatureMethod: validated.signatureMethod,
        consentTextVersion: esign.sha256Text(validated.consentText),
        fieldValuesHash: esign.sha256Text(
          JSON.stringify(validated.fieldValues || {})
        ),
      }
    );
  } catch (_) {}

  let sealOut;
  try {
    sealOut = await esign.sealEsignSubmission({
      salonId: ctx.salonId,
      staffId: ctx.staffId,
      runId: ctx.runId,
      taskId,
      task: freshTask,
      tokenId: ctx.tokenId,
      ip,
      userAgent: ua,
      validated,
    });
  } catch (e) {
    // Never leave task completed on failure — revert sealing → in_progress
    try {
      await taskRef.set(
        {
          status: "in_progress",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          result: {
            ...(freshTask.result || {}),
            sealId,
            lastSealError: String((e && e.message) || e).slice(0, 300),
          },
        },
        { merge: true }
      );
    } catch (_) {}
    throw e;
  }

  // Complete task only after seal succeeded
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return;
    const cur = snap.data() || {};
    if (cur.status === "completed" && cur.result && cur.result.signedPdfSha256) {
      return;
    }
    tx.set(
      taskRef,
      {
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedBy: "portal_esign",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        result: {
          ...(cur.result || {}),
          ...sealOut.result,
          signerName: sealOut.signerName || null,
        },
      },
      { merge: true }
    );
  });

  await recomputeRunInTxn(ctx.salonId, ctx.staffId, ctx.runId);
  const freshCtx = await resolveSessionAccess(
    request.data && request.data.sessionToken,
    request,
    { mutating: false }
  );
  return {
    ok: true,
    alreadyCompleted: !!sealOut.alreadySealed,
    sealId: sealOut.sealId,
    result: esign.publicEsignResult(sealOut.result),
    state: buildPortalDto(freshCtx, mintSession(freshCtx)),
  };
}

exports.onboardingPortalBootstrap = wrapPortalHttp(handleBootstrap);
exports.onboardingPortalGetState = wrapPortalHttp(handleGetState);
exports.onboardingPortalAckPolicy = wrapPortalHttp(handleAckPolicy);
exports.onboardingPortalCreateUpload = wrapPortalHttp(handleCreateUpload);
exports.onboardingPortalFinalizeUpload = wrapPortalHttp(handleFinalizeUpload);
exports.onboardingPortalGetSignaturePacket = wrapPortalHttp(
  handleGetSignaturePacket
);
exports.onboardingPortalSubmitSignature = onRequest(
  {
    region: REGION,
    cors: true,
    timeoutSeconds: 120,
    memory: "1GiB",
    ...PORTAL_SECRET_OPTS,
  },
  async (req, res) => {
    // Same contract as wrapPortalHttp but with higher resources for seal.
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const data = body.data && typeof body.data === "object" ? body.data : body;
      const request = { data, rawRequest: req, auth: null };
      const result = await handleSubmitSignature(request);
      res.status(200).json({ result });
    } catch (e) {
      const message = (e && e.message) || "Request failed.";
      logPortal("http_error", {
        message: String(message).slice(0, 200),
        code: e && e.code,
      });
      res.status(httpsErrorToHttp(e)).json({
        error: { message, status: (e && e.code) || "internal" },
      });
    }
  }
);

// Revoke portal tokens when a run is cancelled.
exports.onOnboardingRunWriteForPortal = onDocumentWritten(
  {
    document:
      "salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}",
    region: REGION,
  },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return;
    const run = after.data() || {};
    if (run.status !== "cancelled") return;
    const before = event.data && event.data.before;
    const prev = before && before.exists ? before.data() || {} : {};
    if (prev.status === "cancelled") return;
    const { salonId, staffId, runId } = event.params || {};
    try {
      const n = await revokeActiveTokensForRun(
        salonId,
        staffId,
        runId,
        "run_cancelled",
        null
      );
      logPortal("auto_revoke_on_cancel", { salonId, staffId, runId, revoked: n });
    } catch (e) {
      console.error("[onboarding-portal] auto revoke failed", e && e.message);
    }
  }
);
