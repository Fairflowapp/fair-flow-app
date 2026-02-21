// Config updated: 2026-01-22
// Cloud Functions for Admin PIN Reset
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

const functions = require("firebase-functions");
const functionsV1 = require("firebase-functions/v1");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
functions.region = functionsV1.region;

/**
 * Simple test callable – use to verify IAM/CORS/region work.
 * Call from console: httpsCallable(getFunctions(app,"us-central1"),"testCallable")({test:1})
 */
exports.testCallable = functions.region("us-central1").https.onCall((data, context) => {
  console.log("[testCallable] invoked", { data, hasAuth: !!context?.auth, uid: context?.auth?.uid });
  return { ok: true, message: "testCallable works", ts: Date.now() };
});

/**
 * Minimal Gen1 callable to verify project/infra allows callable execution.
 * Deploy: firebase deploy --only functions:testCallablePing
 */
exports.testCallablePing = functions.region("us-central1").https.onCall((data, context) => {
  console.log("testCallablePing called", { data, auth: !!context.auth, uid: context.auth?.uid });
  return { ok: true, ts: Date.now() };
});

/**
 * Diagnostic: writes a test email to mail collection.
 * Call from console (signed in): httpsCallable(getFunctions(app,"us-central1"),"testSendEmail")({to:"your@email.com"})
 * If you get the email, Trigger Email extension works. If not, check Extensions + SMTP config.
 */
/** Test A: Writes to mail collection → Trigger Email extension sends. */
exports.testSendEmail = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in first");
  const to = (data && data.to) ? String(data.to).trim() : context.auth.token?.email;
  if (!to) throw new functions.https.HttpsError("invalid-argument", "Pass { to: 'your@email.com' }");
  const ref = await admin.firestore().collection("mail").add({
    to: to.toLowerCase(),
    message: {
      subject: "[Fair Flow] Test A – Trigger Email",
      text: "If you got this, Trigger Email extension works.",
      html: "<p>If you got this, Trigger Email extension works.</p>"
    }
  });
  console.log("[testSendEmail] wrote mail doc", ref.id);
  return { ok: true, method: "Trigger Email (mail collection)", docId: ref.id };
});

/** Test B: Sends directly via nodemailer (SMTP). */
exports.testSendEmailNodemailer = functions.region("us-central1").https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in first");
  const to = (data && data.to) ? String(data.to).trim() : context.auth.token?.email;
  if (!to) throw new functions.https.HttpsError("invalid-argument", "Pass { to: 'your@email.com' }");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST;
  if (!user || !pass) {
    return { ok: false, method: "Nodemailer", error: "SMTP_USER/SMTP_PASS not set in .env" };
  }
  const nodemailer = require("nodemailer");
  const opts = host
    ? { host, port: parseInt(process.env.SMTP_PORT || "587", 10), secure: process.env.SMTP_SECURE === "true", auth: { user, pass } }
    : { service: "gmail", auth: { user, pass } };
  const transporter = nodemailer.createTransport(opts);
  try {
    await transporter.sendMail({
      from: `"Fair Flow" <${user}>`,
      to: to.toLowerCase(),
      subject: "[Fair Flow] Test B – Nodemailer",
      text: "If you got this, Nodemailer/SMTP works.",
      html: "<p>If you got this, Nodemailer/SMTP works.</p>"
    });
    console.log("[testSendEmailNodemailer] sent to", to);
    return { ok: true, method: "Nodemailer" };
  } catch (err) {
    console.error("[testSendEmailNodemailer] error", err);
    return { ok: false, method: "Nodemailer", error: err?.message || String(err) };
  }
});

const crypto = require('crypto');

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// CRITICAL: Set the final public domain for the main application
const APP_BASE_URL = 'https://app.fairflowapp.com';

/**
 * Firestore-triggered: no HTTP/Invoker needed. Client writes to staffInviteRequests,
 * this function runs when doc is created. Bypasses IAM allUsers restriction.
 */
async function _markRequestError(snap, msg) {
  try {
    await snap.ref.update({ status: "error", error: msg, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (e) {
    console.error("[onStaffInviteRequest] failed to update error status", e);
  }
}

/** V2 Firestore trigger – runs immediately. NEW name = no upgrade conflict. */
async function handleInviteRequest(snap) {
  const data = snap.data() || {};
  if (data.status !== "pending") return; // already processed by other trigger
  const { createdByUid, salonId, staffId, email, role } = data;
  if (!createdByUid || !salonId || !email || !role) {
    await _markRequestError(snap, "missing fields");
    return;
  }
  const userSnap = await admin.firestore().doc(`users/${createdByUid}`).get();
  if (!userSnap.exists) {
    await _markRequestError(snap, "user not found");
    return;
  }
  const userData = userSnap.data() || {};
  const senderRole = String(userData.role || "").toLowerCase();
  if (!["owner", "admin", "manager"].includes(senderRole)) {
    await _markRequestError(snap, "insufficient role");
    return;
  }
  if (userData.salonId !== salonId) {
    await _markRequestError(snap, "salonId mismatch");
    return;
  }
  const auth = { uid: createdByUid, token: { role: senderRole } };
  const fresh = await snap.ref.get();
  if (fresh.data()?.status !== "pending") return;
  try {
    await _sendStaffInviteInternal({ data: { staffId, salonId, email, role }, auth });
    await snap.ref.update({ status: "done", doneAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (err) {
    await _markRequestError(snap, err?.message || String(err));
  }
}

exports.onStaffInviteCreatedV2 = onDocumentCreated(
  { document: "staffInviteRequests/{requestId}", region: "us-central1" },
  (event) => {
    const snap = event.data;
    if (!snap) return;
    return handleInviteRequest(snap);
  }
);

/** V1 Firestore trigger – backup in case v2 doesn't fire. */
exports.processStaffInviteOnCreate = functions
  .region("us-central1")
  .firestore.document("staffInviteRequests/{requestId}")
  .onCreate((snap) => handleInviteRequest(snap));

/** Trampoline: client writes here to force immediate processing (triggers may not fire on staffInviteRequests). */
exports.onProcessInviteNow = functions
  .region("us-central1")
  .firestore.document("processInviteNow/{docId}")
  .onCreate(async (snap) => {
    const requestId = snap.data()?.requestId;
    if (!requestId) return;
    const reqSnap = await admin.firestore().doc(`staffInviteRequests/${requestId}`).get();
    if (!reqSnap.exists) return;
    await handleInviteRequest(reqSnap);
  });

// ============================================================================
// Finalize invite flow (Create password -> attach user to salon)
// Client writes: finalizeInviteRequests/{id} with { inviteToken, uid, email }
// Server updates status to done/error so the client can continue.
// ============================================================================

async function _markFinalizeError(snap, msg) {
  try {
    await snap.ref.set(
      {
        status: "error",
        error: String(msg || "Unknown error"),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    console.error("[finalizeInvite] failed to update error status", e);
  }
}

async function handleFinalizeInviteRequest(snap) {
  const data = snap.data() || {};
  if (data.status === "done") return;

  const inviteToken = String(data.inviteToken || "").trim();
  const uid = String(data.uid || "").trim();
  const email = String(data.email || "").trim().toLowerCase();

  if (!inviteToken || !uid) {
    await _markFinalizeError(snap, "missing inviteToken/uid");
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(inviteToken).digest("hex");
  const tokenRef = admin.firestore().collection("staffInviteTokens").doc(tokenHash);
  const userRef = admin.firestore().doc(`users/${uid}`);

  try {
    await admin.firestore().runTransaction(async (tx) => {
      // IMPORTANT: Firestore transactions require ALL reads before ANY writes.
      // Read everything we might need up front.
      const tokSnap = await tx.get(tokenRef);
      if (!tokSnap.exists) throw new Error("Invite invalid or expired.");

      const tok = tokSnap.data() || {};
      const expiresAt = tok.expiresAt;
      const usedAt = tok.usedAt;

      if (usedAt) throw new Error("Invite already used.");
      if (expiresAt && typeof expiresAt.toMillis === "function" && expiresAt.toMillis() < Date.now()) {
        throw new Error("Invite expired.");
      }

      const salonId = String(tok.salonId || "").trim();
      if (!salonId) throw new Error("Invite missing salon.");

      const role = String(tok.role || "technician").trim();
      const staffId = tok.staffId ? String(tok.staffId) : null;
      const tokEmailLower = String(tok.emailLower || tok.email || "").trim().toLowerCase();

      if (email && tokEmailLower && email !== tokEmailLower) {
        throw new Error("Invite email mismatch.");
      }

      const memberRef = admin.firestore().collection("salons").doc(salonId).collection("members").doc(uid);
      const staffRef = staffId
        ? admin.firestore().collection("salons").doc(salonId).collection("staff").doc(staffId)
        : null;

      const userSnap = await tx.get(userRef);
      const memberSnap = await tx.get(memberRef);
      const staffSnap = staffRef ? await tx.get(staffRef) : null;

      // Guard: if user already belongs to a different salon, block.
      if (userSnap.exists) {
        const ud = userSnap.data() || {};
        if (ud.salonId && String(ud.salonId) !== salonId) {
          throw new Error("Account already belongs to another salon.");
        }
      }

      // Resolve name from staff doc if available
      let staffName = "";
      if (staffSnap && staffSnap.exists) {
        const sd = staffSnap.data() || {};
        staffName = String(sd.name || "").trim();
      }

      // ---- Writes (after all reads) ----

      // Update staff doc (if linked)
      if (staffRef) {
        tx.set(
          staffRef,
          {
            uid,
            invited: true,
            invitedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      // Write user profile (server-authoritative)
      const userPayload = {
        salonId,
        role,
        email: tokEmailLower || email || null,
        staffId: staffId || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!userSnap.exists) userPayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      if (staffName) userPayload.name = staffName;
      tx.set(userRef, userPayload, { merge: true });

      // Write salon member directory
      const memberPayload = {
        email: (tokEmailLower || email || "").trim(),
        name: staffName || (tokEmailLower || email || "").trim(),
        role,
        staffId: staffId || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!memberSnap.exists) memberPayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      tx.set(memberRef, memberPayload, { merge: true });

      // Mark token used
      tx.set(
        tokenRef,
        {
          usedAt: admin.firestore.FieldValue.serverTimestamp(),
          usedByUid: uid,
          usedEmail: tokEmailLower || email || null,
        },
        { merge: true }
      );

      // Mark finalize request done (client waits for this)
      tx.set(
        snap.ref,
        {
          status: "done",
          doneAt: admin.firestore.FieldValue.serverTimestamp(),
          salonId,
          staffId: staffId || null,
        },
        { merge: true }
      );
    });
  } catch (err) {
    console.error("[finalizeInvite] error", err);
    await _markFinalizeError(snap, err?.message || String(err));
  }
}

exports.onFinalizeInviteCreatedV2 = onDocumentCreated(
  { document: "finalizeInviteRequests/{requestId}", region: "us-central1" },
  (event) => {
    const snap = event.data;
    if (!snap) return;
    return handleFinalizeInviteRequest(snap);
  }
);

exports.onFinalizeInviteCreatedV1 = functions
  .region("us-central1")
  .firestore.document("finalizeInviteRequests/{requestId}")
  .onCreate((snap) => handleFinalizeInviteRequest(snap));

/**
 * Processes pending staffInviteRequests every 1 min (instant for SaaS).
 * Scheduled runs don't need HTTP Invoker.
 */
async function _processOneRequest(snap) {
  const data = snap.data() || {};
  const { createdByUid, salonId, staffId, email, role } = data;
  if (!createdByUid || !salonId || !email || !role) {
    await _markRequestError(snap, "missing fields");
    return;
  }
  const userSnap = await admin.firestore().doc(`users/${createdByUid}`).get();
  if (!userSnap.exists) {
    await _markRequestError(snap, "user not found");
    return;
  }
  const userData = userSnap.data() || {};
  const senderRole = String(userData.role || "").toLowerCase();
  if (!["owner", "admin", "manager"].includes(senderRole)) {
    await _markRequestError(snap, "insufficient role: " + senderRole);
    return;
  }
  if (userData.salonId !== salonId) {
    await _markRequestError(snap, "salonId mismatch");
    return;
  }
  const auth = { uid: createdByUid, token: { role: senderRole } };
  try {
    await _sendStaffInviteInternal({ data: { staffId, salonId, email, role }, auth });
    await snap.ref.update({ status: "done", doneAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log("[processPendingInvites] processed", snap.id);
  } catch (err) {
    await _markRequestError(snap, err?.message || String(err));
    console.error("[processPendingInvites] error", snap.id, err);
  }
}

exports.processPendingInvites = functions
  .region("us-central1")
  .pubsub.schedule("every 1 minutes")
  .onRun(async () => {
    console.log("[processPendingInvites] run started");
    try {
      const snapshot = await admin.firestore()
        .collection("staffInviteRequests")
        .where("status", "==", "pending")
        .limit(10)
        .get();
      console.log("[processPendingInvites] found", snapshot.size, "pending");
      if (snapshot.empty) return null;
      for (const doc of snapshot.docs) {
        await _processOneRequest(doc);
      }
      return null;
    } catch (err) {
      console.error("[processPendingInvites] error", err);
      throw err;
    }
  });

/**
 * Sends a staff invite email to a specific staff member.
 * Requires caller to be authenticated and authorized (admin/manager).
 */
async function _sendStaffInviteInternal({ data, auth }) {
  console.log("[sendStaffInvite] called", { dataKeys: data ? Object.keys(data) : [], hasAuth: !!auth, uid: auth?.uid });
  console.log("FUNCTION STARTED - VERY FIRST LINE");
  console.error("=== sendStaffInvite START ===", JSON.stringify({ staffId: data.staffId, salonId: data.salonId }));
  console.log('[sendStaffInvite] invoked', {
    hasAuth: !!auth,
    uid: auth?.uid || null,
    staffId: data?.staffId || null,
    salonId: data?.salonId || null
  });

  console.log("[sendStaffInvite] STEP 1: auth check - start");
  if (!auth) {
    console.log('[sendStaffInvite] unauthenticated');
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to send staff invites.');
  }
  console.log("[sendStaffInvite] STEP 1: auth check - done");

  console.log("[sendStaffInvite] STEP 2: validate input - start");
  const { staffId, salonId, email, role } = data || {};
  const emailValue = String(email || data?.emailLower || '').trim();
  const roleValue = String(role || '').trim();
  if (!emailValue || !roleValue) {
    console.log('[sendStaffInvite] invalid-argument', { staffId, salonId, hasEmail: !!emailValue, hasRole: !!roleValue });
    throw new functions.https.HttpsError('invalid-argument', 'Missing email or role.');
  }
  console.log("[sendStaffInvite] STEP 2: validate input - done");

  console.log("[sendStaffInvite] STEP 3: permission check - start");
  const authToken = auth.token || {};
  console.log('[sendStaffInvite] auth token role', { role: authToken.role || null });
  const authorized = ['owner', 'admin', 'manager'].includes(authToken.role);
  if (!authorized) {
    console.log('[sendStaffInvite] permission-denied');
    throw new functions.https.HttpsError('permission-denied', 'Not authorized to send staff invites.');
  }
  console.log("[sendStaffInvite] STEP 3: permission check - done");

  let staffEmail = emailValue;
  if (staffId) {
    console.log('[sendStaffInvite] authorized, loading staff doc');
    const staffRef = admin.firestore().collection('salons').doc(salonId).collection('staff').doc(staffId);
    const staffDoc = await staffRef.get();
    if (!staffDoc.exists) {
      console.log('[sendStaffInvite] staff not found');
      throw new functions.https.HttpsError('not-found', 'Staff member not found.');
    }
    const staffData = staffDoc.data() || {};
    const fromStaff = (staffData.email || '').trim();
    staffEmail = fromStaff || emailValue;
    console.log('[sendStaffInvite] staff email', { fromStaff: !!fromStaff, using: staffEmail ? 'ok' : 'none' });
  }
  if (!staffEmail) {
    throw new functions.https.HttpsError('not-found', 'Staff email not found.');
  }

  console.log('[sendStaffInvite] loading salon doc');
  const salonDoc = await admin.firestore().collection('salons').doc(salonId).get();
  const salonName = salonDoc.exists ? (salonDoc.data()?.name || 'Your salon') : 'Your salon';
  console.log('[sendStaffInvite] salon loaded', { salonName });

  console.log("[sendStaffInvite] STEP 4: generate token + store token - start");
  const rawToken = crypto.randomBytes(32).toString('hex');
  const inviteUrl = `${APP_BASE_URL}/create-password/${rawToken}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + (24 * 60 * 60 * 1000));

  console.log('[sendStaffInvite] storing invite token');
  // IMPORTANT: client loads by docId = sha256(token). Store under tokenHash id.
  await admin.firestore().collection('staffInviteTokens').doc(tokenHash).set({
    staffId: staffId || null,
    salonId: salonId,
    email: staffEmail,
    emailLower: String(staffEmail || emailValue || '').trim().toLowerCase(),
    role: roleValue,
    tokenHash: tokenHash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: expiresAt,
    usedAt: null
  }, { merge: true });
  console.log("[sendStaffInvite] STEP 4: generate token + store token - done");

  const emailLower = String(staffEmail || emailValue || '').trim().toLowerCase();
  const expiresText = expiresAt?.toDate ? expiresAt.toDate().toISOString() : String(expiresAt || '');

  console.log("[sendStaffInvite] STEP 6: create invite doc - start");
  await admin.firestore().collection('salons').doc(salonId).collection('invites').add({
    emailLower: emailLower,
    role: roleValue,
    token: rawToken,
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: expiresAt,
    createdByUid: auth.uid,
    staffId: staffId || null,
    salonId: salonId
  });
  console.log("[sendStaffInvite] STEP 6: create invite doc - done");

  const subject = `You're invited to join ${salonName} on Fair Flow`;
  const textBody = `You have been invited to join ${salonName} on Fair Flow.

Role: ${roleValue}
Invite link: ${inviteUrl}
Expires: ${expiresText}

If you have questions, reply to this email.`;
  const htmlBody = `<p>You have been invited to join ${escapeHtml(salonName)} on Fair Flow.</p>
<p><strong>Role:</strong> ${escapeHtml(roleValue)}</p>
<p><a href="${escapeHtml(inviteUrl)}">Click here to accept your invite</a></p>
<p>Expires: ${escapeHtml(expiresText)}</p>
<p>If you have questions, reply to this email.</p>`;

  console.log("[sendStaffInvite] STEP 7: write to mail (Trigger Email) - start", { to: emailLower });
  await admin.firestore().collection('mail').add({
    to: emailLower,
    message: { subject, text: textBody, html: htmlBody }
  });
  console.log("[sendStaffInvite] STEP 7: write to mail - done");

  return { ok: true, token: rawToken, inviteLink: inviteUrl, data: { success: true } };
}

async function _sendStaffInviteHttpAuth(req) {
  const authHeader = req.get("Authorization") || req.get("authorization") || "";
  let idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken && req.body && typeof req.body.__idToken === "string") {
    idToken = req.body.__idToken.trim();
    console.log("[AuthDebug] Using token from body (Hosting may strip Authorization header)");
  }
  console.log("[AuthDebug] Authorization header exists:", !!authHeader);
  console.log("[AuthDebug] Token length:", idToken?.length ?? 0);

  if (!idToken) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("[AUTH] decoded uid:", decoded.uid);
    return decoded;
  } catch (err) {
    console.error("[AuthDebug] verifyIdToken failed:", {
      code: err?.code,
      message: err?.message,
      stack: err?.stack,
    });
    throw new functions.https.HttpsError("unauthenticated", "Invalid ID token");
  }
}

/**
 * Callable version of sendStaffInvite – bypasses Hosting rewrite.
 * Firebase Hosting can strip Authorization header when proxying to HTTP functions.
 * Callable functions receive auth automatically from the SDK (no header needed).
 */
exports.sendStaffInviteCallable = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    }
    const uid = context.auth.uid;
    const requestData = typeof data === "object" ? data : {};
    const { email, role } = requestData;

    const userRef = admin.firestore().doc(`users/${uid}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new functions.https.HttpsError("permission-denied", "User profile not found.");
    }
    const userData = userSnap.data() || {};
    const senderRole = String(userData.role || "").toLowerCase();
    const allowedRoles = ["owner", "admin", "manager"];
    if (!allowedRoles.includes(senderRole)) {
      throw new functions.https.HttpsError("permission-denied", "Insufficient role to send invites.");
    }
    const salonId = userData.salonId;
    if (!salonId) {
      throw new functions.https.HttpsError("failed-precondition", "No salonId on user profile.");
    }
    if (requestData?.salonId && requestData.salonId !== salonId) {
      throw new functions.https.HttpsError("permission-denied", "Not authorized to send invites for this salon.");
    }

    const auth = { uid, token: { role: senderRole } };
    return await _sendStaffInviteInternal({ data: { ...requestData, email, role, salonId }, auth });
  });

/** Shared logic: resolve recipientStaffId -> uid and create inbox item. Used by trigger onInboxRequestDraftCreated. */
async function _createInboxRequestFromDraft(creatorUid, salonId, recipientStaffId, recipientName, requestData) {
  const creatorDoc = await admin.firestore().doc(`users/${creatorUid}`).get();
  if (!creatorDoc.exists) throw new Error("User profile not found");
  const creatorData = creatorDoc.data() || {};
  if (String(creatorData.salonId || "") !== String(salonId)) throw new Error("Wrong salon");

  let forUid = creatorUid;
  let forStaffId = creatorData.staffId || "";
  let forStaffName = creatorData.name || "";

  if (recipientStaffId && String(recipientStaffId).trim()) {
    const rid = String(recipientStaffId).trim();
    const recName = (recipientName && String(recipientName).trim()) || "";
    const recNameNorm = recName ? recName.toLowerCase().replace(/\s+/g, " ").trim() : "";
    const allUsersSnap = await admin.firestore().collection("users").where("salonId", "==", salonId).get();
    for (const d of allUsersSnap.docs) {
      const data = d.data() || {};
      const docStaffId = String(data.staffId || d.id || "").trim();
      const docNameNorm = (data.name || "").trim().toLowerCase().replace(/\s+/g, " ").trim();
      const matchById = rid && (docStaffId === rid || d.id === rid);
      const matchByName = recNameNorm && docNameNorm && (docNameNorm === recNameNorm || docNameNorm.includes(recNameNorm) || recNameNorm.includes(docNameNorm));
      if (matchById || matchByName) {
        forUid = d.id;
        forStaffId = data.staffId || rid;
        forStaffName = recName || data.name || "";
        break;
      }
    }
    if (forUid === creatorUid) {
      const directDoc = await admin.firestore().doc(`users/${rid}`).get();
      if (directDoc.exists) {
        const d = directDoc.data() || {};
        if (String(d.salonId || "") === String(salonId)) {
          forUid = rid;
          forStaffId = d.staffId || rid;
          forStaffName = recName || d.name || "";
        }
      }
    }
    if (forUid === creatorUid && rid !== creatorData.staffId)
      throw new Error("Recipient not found. Make sure they have signed in at least once.");
  }
  if (recipientStaffId && String(recipientStaffId).trim() && forUid === creatorUid)
    throw new Error("Could not resolve recipient. They may need to sign in first.");

  const safeRequestData = { ...requestData };
  delete safeRequestData.createdByUid;
  delete safeRequestData.forUid;
  delete safeRequestData.forStaffId;
  delete safeRequestData.forStaffName;

  const docToWrite = {
    ...safeRequestData,
    forUid,
    forStaffId,
    forStaffName,
    createdByUid: creatorUid,
    createdByStaffId: creatorData.staffId || "",
    createdByName: creatorData.name || "",
    createdByRole: creatorData.role || "",
    tenantId: salonId,
  };
  delete docToWrite.createdAt;
  delete docToWrite.lastActivityAt;
  delete docToWrite.updatedAt;
  Object.keys(docToWrite).forEach((k) => { if (docToWrite[k] === undefined) delete docToWrite[k]; });

  const docRef = await admin.firestore().collection("salons").doc(salonId).collection("inboxItems").add({
    ...docToWrite,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: null,
  });
  return docRef.id;
}

/** Firestore trigger: draft created → resolve recipient, create inbox item, delete draft. No CORS. */
exports.onInboxRequestDraftCreated = onDocumentCreated(
  { document: "salons/{salonId}/inboxRequestDrafts/{draftId}", region: "us-central1" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const salonId = event.params.salonId;
    const draftId = event.params.draftId;
    const { createdByUid, recipientStaffId, recipientName, requestDoc } = data || {};
    if (!createdByUid || !requestDoc) {
      console.warn("[onInboxRequestDraftCreated] missing fields", { createdByUid: !!createdByUid, requestDoc: !!requestDoc });
      return;
    }
    try {
      const docId = await _createInboxRequestFromDraft(createdByUid, salonId, recipientStaffId || "", recipientName || "", requestDoc);
      console.log("[onInboxRequestDraftCreated] created", docId, "recipientStaffId=", recipientStaffId, "recipientName=", recipientName);
      await snap.ref.delete();
    } catch (err) {
      console.error("[onInboxRequestDraftCreated] Error:", err.message, "recipientStaffId=", recipientStaffId, "recipientName=", recipientName);
    }
  }
);

/* sendStaffInvite HTTP removed – org policy blocks. Deploy with: firebase deploy --only "functions:testCallable,functions:testCallablePing,functions:testSendEmail,functions:onStaffInviteCreatedV2,functions:processPendingInvites,functions:sendStaffInviteCallable" */

