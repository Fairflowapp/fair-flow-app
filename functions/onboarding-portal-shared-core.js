/**
 * Onboarding portal — shared core (crypto, sessions, tokens, progress).
 */
const crypto = require("crypto");
const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError } = require("firebase-functions/v2/https");

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

function maskEmail(email) {
  const e = trimStr(email).toLowerCase();
  const at = e.indexOf("@");
  if (at < 1) return "***";
  const user = e.slice(0, at);
  const domain = e.slice(at + 1);
  const keep = user.slice(0, Math.min(2, user.length));
  return `${keep}***@${domain}`;
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

module.exports = {
  ONBOARDING_PORTAL_HMAC_SECRET,
  PORTAL_SECRET_OPTS,
  REGION,
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  SESSION_TTL_MS,
  LAST_USED_THROTTLE_MS,
  UPLOAD_URL_TTL_MS,
  RATE_IP_LIMIT,
  RATE_IP_WINDOW_MS,
  RATE_TOKEN_LIMIT,
  RATE_TOKEN_WINDOW_MS,
  RATE_UPLOAD_LIMIT,
  RATE_UPLOAD_WINDOW_MS,
  db,
  resolvePortalBucket,
  trimStr,
  appBaseUrl,
  sessionSecret,
  sha256Hex,
  generateRawToken,
  tokenDocIdFromHash,
  portalUrl,
  maskEmail,
  logPortal,
  clientIp,
  assertRateLimit,
  assertManager,
  requireManagerAuth,
  mintSession,
  sealRawToken,
  unsealRawToken,
  verifySession,
  sanitizePolicyHtml,
  computeProgress,
  loadRunAndTasks,
  revokeActiveTokensForRun,
  issueTokenCore,
  HttpsError,
  admin,
};
