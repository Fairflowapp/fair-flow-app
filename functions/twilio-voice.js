const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

const crypto = require("crypto");
const { defineSecret } = require("firebase-functions/params");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");

const REGION = "us-central1";
const STAGING_PROJECT_ID = "fair-flow-staging";
const PRODUCTION_PROJECT_ID = "fairflowapp-db841";
const ALLOWED_PROJECT_IDS = new Set([STAGING_PROJECT_ID, PRODUCTION_PROJECT_ID]);

const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
const TWILIO_PHONE_NUMBER = defineSecret("TWILIO_PHONE_NUMBER");

const VALID_CALL_TYPES = new Set(["client_waiting", "front_desk"]);
const SPOKEN_MESSAGE_MAX_CHARS = 280;
const STATUS_TIMESTAMPS = {
  queued: "queuedAt",
  ringing: "ringingAt",
  "in-progress": "inProgressAt",
  completed: "completedAt",
  busy: "busyAt",
  failed: "failedAt",
  "no-answer": "noAnswerAt",
  canceled: "canceledAt",
};

function projectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    const cfg = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
    return cfg.projectId || "";
  } catch (_) {
    return "";
  }
}

function assertAllowedProject() {
  const pid = projectId();
  if (!ALLOWED_PROJECT_IDS.has(pid)) {
    throw new HttpsError("failed-precondition", "Twilio Voice is not enabled for this Firebase project.");
  }
}

function isAllowedProject() {
  return ALLOWED_PROJECT_IDS.has(projectId());
}

function publicFunctionUrl(name) {
  const pid = projectId();
  return `https://${REGION}-${pid}.cloudfunctions.net/${name}`;
}

function cleanId(value) {
  return String(value || "").trim();
}

function maskPhone(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return "***" + digits;
  return `${raw.slice(0, 2)}***${digits.slice(-4)}`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Hardcoded TTS when no staffCallTemplates.message is configured. */
function defaultSpokenMessage(callType) {
  return callType === "front_desk"
    ? "Hello, this is Fair Flow. Please come to the front desk. Press 1 to confirm."
    : "Hello, this is Fair Flow. Your client is waiting for you. Please come to the front desk. Press 1 to accept.";
}

/**
 * Sanitize text before it is stored on the call log / spoken via <Say>.
 * Subtext (template.detail) is intentionally never used for TTS.
 */
function sanitizeSpokenMessage(raw) {
  if (typeof raw !== "string") return "";
  let value = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  if (value.length > SPOKEN_MESSAGE_MAX_CHARS) {
    value = value.slice(0, SPOKEN_MESSAGE_MAX_CHARS).trim();
  }
  return value;
}

/**
 * Resolve TTS text from per-location staffCallTemplates, then salon-wide
 * legacy staffCallTemplates. Uses message only (not detail/subtext).
 * callType client_waiting → available; front_desk → inService.
 */
async function resolveSpokenMessage(db, businessId, locationId, callType) {
  let templateMessage = "";
  try {
    const settingsSnap = await db.doc(`salons/${businessId}/settings/main`).get();
    if (settingsSnap.exists) {
      const data = settingsSnap.data() || {};
      const locId = cleanId(locationId) || "default";
      const locPrefs =
        data.locationPreferences && typeof data.locationPreferences === "object"
          ? data.locationPreferences[locId]
          : null;
      const templates =
        (locPrefs && typeof locPrefs === "object" && locPrefs.staffCallTemplates) ||
        data.staffCallTemplates ||
        null;
      const kind = callType === "front_desk" ? "inService" : "available";
      const entry = templates && typeof templates === "object" ? templates[kind] : null;
      if (entry && typeof entry === "object") {
        templateMessage = sanitizeSpokenMessage(entry.message);
      }
    }
  } catch (err) {
    logger.warn("[twilioVoice] failed to load staffCallTemplates", {
      businessId,
      locationId: cleanId(locationId) || "default",
      message: err && err.message ? err.message : String(err),
    });
  }
  if (!templateMessage) return defaultSpokenMessage(callType);

  // Template message is screen-oriented and usually omits the digit prompt.
  // Append a short Press-1 instruction so Gather remains usable, unless the
  // configured message already tells the listener to press 1.
  if (/\bpress\s*1\b/i.test(templateMessage)) return templateMessage;
  const suffix = callType === "front_desk" ? "Press 1 to confirm." : "Press 1 to accept.";
  return sanitizeSpokenMessage(`${templateMessage.replace(/[.!?]+$/, "")}. ${suffix}`) || templateMessage;
}

function twimlSay(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(message)}</Say></Response>`;
}

function getRequestParam(req, key) {
  if (req.body && typeof req.body === "object" && req.body[key] != null) return req.body[key];
  if (req.query && req.query[key] != null) return req.query[key];
  return "";
}

function currentRequestUrl(req) {
  const host = req.get("host");
  return `https://${host}${req.originalUrl || req.url || ""}`;
}

function twilioPostParams(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  return Object.keys(body)
    .sort()
    .reduce((out, key) => {
      const value = body[key];
      out[key] = Array.isArray(value) ? value.join("") : String(value ?? "");
      return out;
    }, {});
}

function requestQueryString(req) {
  const raw = String(req.originalUrl || req.url || "");
  const idx = raw.indexOf("?");
  return idx >= 0 ? raw.slice(idx) : "";
}

function twilioSignatureCandidateUrls(req, handlerName) {
  const candidates = new Set();
  const currentUrl = currentRequestUrl(req);
  if (currentUrl) candidates.add(currentUrl);
  const query = requestQueryString(req);
  if (handlerName) candidates.add(`${publicFunctionUrl(handlerName)}${query}`);
  return Array.from(candidates);
}

function validateTwilioSignature(req, handlerName) {
  const authToken = TWILIO_AUTH_TOKEN.value();
  const signature = String(req.get("x-twilio-signature") || "");
  if (!authToken || !signature) return false;
  const params = twilioPostParams(req);
  const actualBuffer = Buffer.from(signature);
  return twilioSignatureCandidateUrls(req, handlerName).some((url) => {
    const payload = Object.keys(params).reduce((acc, key) => acc + key + params[key], url);
    const expected = crypto.createHmac("sha1", authToken).update(payload).digest("base64");
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  });
}

function rejectInvalidTwilioSignature(req, res, handlerName) {
  if (validateTwilioSignature(req, handlerName)) return false;
  logger.warn("[twilioVoice] rejected invalid Twilio signature", {
    handlerName,
    projectId: projectId(),
  });
  res.status(403).send("Forbidden");
  return true;
}

async function assertCanCallStaff(uid, salonId, locationId) {
  const db = admin.firestore();
  const [salonSnap, settingsSnap, userSnap, memberSnap, membershipSnap] = await Promise.all([
    db.doc(`salons/${salonId}`).get().catch(() => null),
    db.doc(`salons/${salonId}/settings/main`).get().catch(() => null),
    db.doc(`users/${uid}`).get().catch(() => null),
    db.doc(`salons/${salonId}/members/${uid}`).get().catch(() => null),
    db.doc(`users/${uid}/memberships/${salonId}`).get().catch(() => null),
  ]);

  const salon = salonSnap && salonSnap.exists ? salonSnap.data() || {} : {};
  const settings = settingsSnap && settingsSnap.exists ? settingsSnap.data() || {} : {};
  const user = userSnap && userSnap.exists ? userSnap.data() || {} : {};
  const member = memberSnap && memberSnap.exists ? memberSnap.data() || {} : {};
  const membership = membershipSnap && membershipSnap.exists ? membershipSnap.data() || {} : {};
  const belongsToSalon =
    cleanId(user.salonId) === salonId ||
    memberSnap?.exists === true ||
    membershipSnap?.exists === true;
  const role = cleanId(membership.role || member.role || user.role).toLowerCase();
  const isOwner = cleanId(settings.ownerUid || salon.ownerUid) === uid;
  const allowedRole = isOwner || ["owner", "admin", "manager"].includes(role);
  if (!belongsToSalon || !allowedRole) {
    throw new HttpsError("permission-denied", "You do not have permission to call staff.");
  }

  const allowedLocationIds = Array.isArray(member.allowedLocationIds)
    ? member.allowedLocationIds.map(cleanId).filter(Boolean)
    : [];
  const loc = cleanId(locationId);
  if (loc && loc !== "default" && allowedLocationIds.length && !allowedLocationIds.includes(loc)) {
    throw new HttpsError("permission-denied", "You do not have access to this location.");
  }
}

async function createTwilioCall({ to, from, promptUrl, statusUrl }) {
  const accountSid = TWILIO_ACCOUNT_SID.value();
  const authToken = TWILIO_AUTH_TOKEN.value();
  if (!accountSid || !authToken || !from) {
    throw new HttpsError("failed-precondition", "Twilio secrets are not configured.");
  }

  const body = new URLSearchParams({
    To: to,
    From: from,
    Url: promptUrl,
    Method: "POST",
    StatusCallback: statusUrl,
    StatusCallbackMethod: "POST",
  });
  ["initiated", "ringing", "answered", "completed"].forEach((eventName) => {
    body.append("StatusCallbackEvent", eventName);
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.error("[twilioVoice] call create failed", { status: res.status, code: json.code, message: json.message });
    throw new HttpsError("internal", json.message || "Twilio call failed.");
  }
  return json;
}

exports.callStaff = onCall(
  { region: REGION, invoker: "public", secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER] },
  async (req) => {
    assertAllowedProject();
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");

    const data = req.data || {};
    const businessId = cleanId(data.businessId);
    const locationId = cleanId(data.locationId) || "default";
    const staffId = cleanId(data.staffId);
    const queueEntryId = cleanId(data.queueEntryId);
    const callType = cleanId(data.callType);

    if (!businessId || !staffId || !VALID_CALL_TYPES.has(callType)) {
      throw new HttpsError("invalid-argument", "Missing or invalid callStaff input.");
    }

    await assertCanCallStaff(req.auth.uid, businessId, locationId);

    const db = admin.firestore();
    const staffRef = db.doc(`salons/${businessId}/staff/${staffId}`);
    const staffSnap = await staffRef.get();
    if (!staffSnap.exists) throw new HttpsError("not-found", "Staff member not found.");

    const staff = staffSnap.data() || {};
    const staffPhone = cleanId(staff.phone);
    if (!staffPhone) throw new HttpsError("failed-precondition", "Staff member does not have a phone number.");

    const fromTwilioNumber = TWILIO_PHONE_NUMBER.value();
    const spokenMessage = await resolveSpokenMessage(db, businessId, locationId, callType);
    const logRef = db.collection(`salons/${businessId}/staffCallLogs`).doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await logRef.set({
      businessId,
      salonId: businessId,
      locationId,
      staffId,
      queueEntryId: queueEntryId || null,
      callType,
      spokenMessage,
      toPhoneMasked: maskPhone(staffPhone),
      fromTwilioNumber: maskPhone(fromTwilioNumber),
      twilioCallSid: null,
      status: "creating",
      acknowledged: false,
      acknowledgedAt: null,
      digitPressed: null,
      createdAt: now,
      updatedAt: now,
      createdByUid: req.auth.uid,
    });

    const commonParams = new URLSearchParams({
      businessId,
      locationId,
      staffId,
      callLogId: logRef.id,
      queueEntryId,
      callType,
    });
    const promptUrl = `${publicFunctionUrl("twilioVoicePrompt")}?${commonParams.toString()}`;
    const statusUrl = `${publicFunctionUrl("twilioCallStatus")}?${commonParams.toString()}`;

    const call = await createTwilioCall({
      to: staffPhone,
      from: fromTwilioNumber,
      promptUrl,
      statusUrl,
    });

    await logRef.set({
      twilioCallSid: cleanId(call.sid),
      status: cleanId(call.status) || "queued",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      ok: true,
      callLogId: logRef.id,
      twilioCallSid: cleanId(call.sid),
      status: cleanId(call.status) || "queued",
    };
  }
);

exports.twilioVoicePrompt = onRequest({ region: REGION, invoker: "public", secrets: [TWILIO_AUTH_TOKEN] }, async (req, res) => {
  if (!isAllowedProject()) {
    res.type("text/xml").send(twimlSay("Thank you. Goodbye."));
    return;
  }
  if (rejectInvalidTwilioSignature(req, res, "twilioVoicePrompt")) return;

  const callType = cleanId(getRequestParam(req, "callType"));
  const businessId = cleanId(getRequestParam(req, "businessId"));
  const callLogId = cleanId(getRequestParam(req, "callLogId"));
  let message = defaultSpokenMessage(callType);

  // Prefer spokenMessage written on the call log by callStaff (template message,
  // or the hardcoded default). Do not trust a long free-text query param.
  if (businessId && callLogId) {
    try {
      const logSnap = await admin.firestore().doc(`salons/${businessId}/staffCallLogs/${callLogId}`).get();
      const fromLog = logSnap.exists ? sanitizeSpokenMessage((logSnap.data() || {}).spokenMessage) : "";
      if (fromLog) message = fromLog;
    } catch (err) {
      logger.warn("[twilioVoice] failed to load spokenMessage from call log", {
        businessId,
        callLogId,
        message: err && err.message ? err.message : String(err),
      });
    }
  }

  const responseUrl = `${publicFunctionUrl("twilioVoiceResponse")}?${new URLSearchParams({
    businessId,
    locationId: cleanId(getRequestParam(req, "locationId")),
    staffId: cleanId(getRequestParam(req, "staffId")),
    queueEntryId: cleanId(getRequestParam(req, "queueEntryId")),
    callLogId,
    callType,
  }).toString()}`;

  res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Gather numDigits="1" action="${escapeXml(responseUrl)}" method="POST" timeout="8"><Say>${escapeXml(message)}</Say></Gather><Say>We did not receive a response. Goodbye.</Say></Response>`);
});

exports.twilioVoiceResponse = onRequest({ region: REGION, invoker: "public", secrets: [TWILIO_AUTH_TOKEN] }, async (req, res) => {
  const businessId = cleanId(getRequestParam(req, "businessId"));
  const locationId = cleanId(getRequestParam(req, "locationId")) || "default";
  const queueEntryId = cleanId(getRequestParam(req, "queueEntryId"));
  const callLogId = cleanId(getRequestParam(req, "callLogId"));
  const digit = cleanId(getRequestParam(req, "Digits"));

  if (!isAllowedProject() || !businessId || !callLogId) {
    res.type("text/xml").send(twimlSay("Thank you. Goodbye."));
    return;
  }
  if (rejectInvalidTwilioSignature(req, res, "twilioVoiceResponse")) return;

  const db = admin.firestore();
  const update = {
    digitPressed: digit || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (digit === "1") {
    update.status = "acknowledged";
    update.acknowledged = true;
    update.acknowledgedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await db.doc(`salons/${businessId}/staffCallLogs/${callLogId}`).set(update, { merge: true });

  if (digit === "1" && queueEntryId) {
    await db.doc(`salons/${businessId}/queueState/${locationId}`).set({
      staffCallAcknowledgements: {
        [queueEntryId]: {
          callLogId,
          acknowledged: true,
          acknowledgedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  res.type("text/xml").send(twimlSay("Thank you. Your response has been recorded. Goodbye."));
});

exports.twilioCallStatus = onRequest({ region: REGION, invoker: "public", secrets: [TWILIO_AUTH_TOKEN] }, async (req, res) => {
  const businessId = cleanId(getRequestParam(req, "businessId"));
  const callLogId = cleanId(getRequestParam(req, "callLogId"));
  const status = cleanId(getRequestParam(req, "CallStatus"));
  const callSid = cleanId(getRequestParam(req, "CallSid"));

  if (isAllowedProject() && businessId && callLogId) {
    if (rejectInvalidTwilioSignature(req, res, "twilioCallStatus")) return;
    const update = {
      status: status || null,
      twilioCallSid: callSid || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const timestampField = STATUS_TIMESTAMPS[status];
    if (timestampField) update[timestampField] = admin.firestore.FieldValue.serverTimestamp();
    await admin.firestore().doc(`salons/${businessId}/staffCallLogs/${callLogId}`).set(update, { merge: true });
  }

  res.status(204).send("");
});
