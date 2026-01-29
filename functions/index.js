// Config updated: 2026-01-22
// Cloud Functions for Admin PIN Reset
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  admin.initializeApp();
}

// CRITICAL: Set the final public domain for the main application
const APP_BASE_URL = 'https://app.fairflowapp.com';


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
    throw new HttpsError('unauthenticated', 'User must be logged in to send staff invites.');
  }
  console.log("[sendStaffInvite] STEP 1: auth check - done");

  console.log("[sendStaffInvite] STEP 2: validate input - start");
  const { staffId, salonId, email, role } = data || {};
  const emailValue = String(email || data?.emailLower || '').trim();
  const roleValue = String(role || '').trim();
  if (!emailValue || !roleValue) {
    console.log('[sendStaffInvite] invalid-argument', { staffId, salonId, hasEmail: !!emailValue, hasRole: !!roleValue });
    throw new HttpsError('invalid-argument', 'Missing email or role.');
  }
  console.log("[sendStaffInvite] STEP 2: validate input - done");

  console.log("[sendStaffInvite] STEP 3: permission check - start");
  const authToken = auth.token || {};
  console.log('[sendStaffInvite] auth token role', { role: authToken.role || null });
  const authorized = ['owner', 'admin', 'manager'].includes(authToken.role);
  if (!authorized) {
    console.log('[sendStaffInvite] permission-denied');
    throw new HttpsError('permission-denied', 'Not authorized to send staff invites.');
  }
  console.log("[sendStaffInvite] STEP 3: permission check - done");

  let staffEmail = emailValue;
  if (staffId) {
    console.log('[sendStaffInvite] authorized, loading staff doc');
    const staffRef = admin.firestore().collection('salons').doc(salonId).collection('staff').doc(staffId);
    const staffDoc = await staffRef.get();
    if (!staffDoc.exists) {
      console.log('[sendStaffInvite] staff not found');
      throw new HttpsError('not-found', 'Staff member not found.');
    }

    const staffData = staffDoc.data() || {};
    staffEmail = (staffData.email || '').trim();
    console.log('[sendStaffInvite] staff email loaded', { hasEmail: !!staffEmail });
  }
  if (!staffEmail) {
    throw new HttpsError('not-found', 'Staff email not found.');
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
  await admin.firestore().collection('staffInviteTokens').add({
    staffId: staffId || null,
    salonId: salonId,
    email: staffEmail,
    tokenHash: tokenHash,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: expiresAt,
    usedAt: null
  });
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

  console.log("[sendStaffInvite] STEP 7: write email job to Firestore - start");
  await admin.firestore().collection('mail').add({
    to: emailLower,
    message: {
      subject: `You're invited to join ${salonName} on Fair Flow`,
      text: `You have been invited to join ${salonName} on Fair Flow.

Role: ${roleValue}
Invite link: ${inviteUrl}
Expires: ${expiresText}

If you have questions, reply to this email.`
    }
  });
  console.log("[sendStaffInvite] STEP 7: write email job to Firestore - done");

  return { ok: true, token: rawToken, inviteLink: inviteUrl, data: { success: true } };
}

exports.sendStaffInvite = onCall(
  { region: "us-central1" },
  async (request) => {
    try {
      console.log("[sendStaffInvite] STEP 1: entered");
      console.log("[sendStaffInvite] STEP 2: auth check");
      if (!request.auth || !request.auth.uid) {
        throw new HttpsError(
          "unauthenticated",
          "Must be signed in."
        );
      }
      const uid = request.auth.uid;
      const data = request.data || {};
      console.log("[sendStaffInvite] START - data:", data);

      console.log("[sendStaffInvite] RAW DATA", JSON.stringify(request.data || null));
      const { email, role } = request.data || {};
      console.log("[sendStaffInvite] STEP 3: load user doc");
      const userRef = admin.firestore().doc(`users/${uid}`);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        throw new HttpsError("permission-denied", "User profile not found.");
      }
      const userData = userSnap.data() || {};
      const senderRole = String(userData.role || "").toLowerCase();

      console.log("[sendStaffInvite] STEP 4: role check");
      const allowedRoles = ["owner", "admin", "manager"];
      if (!allowedRoles.includes(senderRole)) {
        throw new HttpsError("permission-denied", "Insufficient role to send invites.");
      }

      console.log("[sendStaffInvite] STEP 5: determine salonId");
      const salonId = userData.salonId;
      if (!salonId) {
        throw new HttpsError("failed-precondition", "No salonId on user profile.");
      }
      if (data?.salonId && data.salonId !== salonId) {
        throw new HttpsError("permission-denied", "Not authorized to send invites for this salon.");
      }

      try {
        await admin.firestore().collection("_debug").add({
          tag: "sendStaffInvite_entered",
          at: admin.firestore.FieldValue.serverTimestamp(),
          uid: uid,
          role: senderRole,
          salonId: salonId,
          email: data?.email || data?.emailLower || null,
        });
        console.log("[sendStaffInvite] entered");
      } catch (e) {
        console.error("[sendStaffInvite] debug write failed", {
          message: e?.message || String(e),
          stack: e?.stack || null,
        });
      }

      console.log("[sendStaffInvite] auth snapshot", {
        hasAuth: !!request.auth,
        uid: uid || null,
      });

      console.log("[sendStaffInvite] data keys", Object.keys(request.data || {}));

      console.log("[sendStaffInvite] data snapshot", {
        email: request.data?.email || null,
        salonId: request.data?.salonId || null,
        role: request.data?.role || null,
        staffId: request.data?.staffId || null,
      });

      const auth = {
        uid: uid,
        token: { role: senderRole },
      };
      return await _sendStaffInviteInternal({ data: { ...data, email, role, salonId }, auth });
    } catch (err) {
      console.error("[sendStaffInvite] failed", {
        message: err?.message || String(err),
        code: err?.code,
        name: err?.name,
        stack: err?.stack,
      });
      if (err instanceof HttpsError) {
        throw err;
      }
      throw new HttpsError("internal", "sendStaffInvite failed: " + (err?.message || "unknown"));
    }
  }
);

