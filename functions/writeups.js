/**
 * Employee Write-Ups — Phase 2 backend (trusted send + employee actions).
 *
 * Exports (wired in index.js):
 *   approveAndSendWriteup  — Owner/Admin ONLY. Approves a draft formal
 *                            write-up and performs the full idempotent send
 *                            pipeline. Also resumes a stuck "sending" state,
 *                            handles explicit email resends, and records
 *                            "declined to acknowledge" (markDeclined mode).
 *   writeupEmployeeAction  — The employee the document was issued to:
 *                            open / respond / acknowledge.
 *
 * State machine (admin workflow doc at
 * salons/{salonId}/staff/{staffId}/writeups/{writeupId}):
 *
 *   draft ──(approveAndSendWriteup: validate + mark approved)──▶ sending
 *   sending ──(steps A–E below all complete)────────────────────▶ sent
 *   sent ──(a corrected version v(n+1) is sent)─────────────────▶ superseded
 *
 * Send pipeline (every step is idempotent — deterministic IDs, create-if-
 * missing semantics — so re-invoking the callable after a partial failure
 * completes the remaining steps without duplicating anything):
 *   A. create issued document   writeupDocuments/{writeupId}   (reused if exists)
 *   B. create notification      staffPrivateNotifications/writeup_sent_{writeupId}
 *   C. create mail attempt      mail/writeup_{writeupId}_a{n}  (ALREADY_EXISTS = done)
 *   D. flip selected incidents  status -> included_in_writeup  (skip if already)
 *   E. mark previous version superseded, then draft -> sent (+ sentAt once)
 *
 * Security: permissions.writeups_manage does NOT authorize sending. The final
 * authorization here is Owner/Admin role, verified server-side. Client UI
 * gates are cosmetic only.
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

// v2 callables (like billing.js / stripe.js): required on this project
// because v1 function IAM cannot be opened to callable clients under the
// org policy — v2 Cloud Run services use the invoker-check-disabled setting
// while authentication stays enforced in-function via request.auth.
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const REGION = "us-central1";

const WARNING_LEVELS = new Set(["coaching_verbal", "written", "final_written"]);

const ACK_TEXT =
  "My acknowledgment confirms that I received and reviewed this write-up. It does not necessarily mean that I agree with it.";

/** Staging emails must link to staging; production to the live app domain. */
function appBaseUrl() {
  const project = process.env.GCLOUD_PROJECT || "";
  if (project === "fair-flow-staging") return "https://fair-flow-staging.web.app";
  return "https://app.fairflowapp.com";
}

/**
 * Which collection the Trigger Email extension watches. Resolved ONLY from
 * the actual Firebase project ID — never from anything the client sends.
 * Staging uses a dedicated writeupMailStaging collection so installing the
 * extension there can never process old test documents accumulated in the
 * shared `mail` collection; production keeps `mail`.
 */
function writeupMailCollectionForProject(projectId) {
  const p = trimStr(projectId != null ? projectId : process.env.GCLOUD_PROJECT);
  return p === "fair-flow-staging" ? "writeupMailStaging" : "mail";
}
exports.writeupMailCollectionForProject = writeupMailCollectionForProject;

function db() {
  return admin.firestore();
}

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

function requireParams(data, names) {
  const out = {};
  for (const n of names) {
    const v = trimStr(data && data[n]);
    if (!v) throw new HttpsError("invalid-argument", `Missing ${n}.`);
    if (v.includes("/")) throw new HttpsError("invalid-argument", `Invalid ${n}.`);
    out[n] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

/**
 * Owner/Admin of this salon — the ONLY roles that may approve/send/resend.
 * Mirrors firestore.rules isAdminOrOwner() + isFirestoreSalonOwnerUid().
 */
async function assertOwnerOrAdmin(uid, salonId) {
  const [userSnap, salonSnap, memberSnap] = await Promise.all([
    db().doc(`users/${uid}`).get(),
    db().doc(`salons/${salonId}`).get(),
    db().doc(`salons/${salonId}/members/${uid}`).get(),
  ]);
  if (!salonSnap.exists) throw new HttpsError("not-found", "Salon not found.");
  if (salonSnap.get("ownerUid") === uid) return { role: "owner" };

  const u = userSnap.exists ? userSnap.data() || {} : {};
  const userRole = trimStr(u.role).toLowerCase();
  if (trimStr(u.salonId) === salonId && (userRole === "owner" || userRole === "admin")) {
    return { role: userRole };
  }
  const m = memberSnap.exists ? memberSnap.data() || {} : {};
  const memberRole = trimStr(m.role).toLowerCase();
  if (memberRole === "owner" || memberRole === "admin") return { role: memberRole };

  throw new HttpsError(
    "permission-denied",
    "Only the salon owner or an admin can approve and send a formal write-up.",
  );
}

/**
 * The employee a document was issued to. Mirrors firestore.rules
 * matchesOwnStaffId(): users/{uid}.staffId, salon member staffId, membership
 * staffId, or a uid/email link on the staff doc itself.
 */
async function assertIsThisEmployee(uid, token, salonId, staffId) {
  const [userSnap, memberSnap, membershipSnap, staffSnap] = await Promise.all([
    db().doc(`users/${uid}`).get(),
    db().doc(`salons/${salonId}/members/${uid}`).get(),
    db().doc(`users/${uid}/memberships/${salonId}`).get(),
    db().doc(`salons/${salonId}/staff/${staffId}`).get(),
  ]);
  const u = userSnap.exists ? userSnap.data() || {} : {};
  if (trimStr(u.staffId) === staffId) return;
  if (memberSnap.exists && trimStr((memberSnap.data() || {}).staffId) === staffId) return;
  if (membershipSnap.exists && trimStr((membershipSnap.data() || {}).staffId) === staffId) return;
  if (staffSnap.exists) {
    const s = staffSnap.data() || {};
    if ([s.uid, s.firebaseUid, s.firebaseAuthUid, s.authUid, s.userUid].some((x) => x === uid)) {
      return;
    }
    const tokenEmail = trimStr(token && token.email).toLowerCase();
    if (tokenEmail && trimStr(s.email).toLowerCase() === tokenEmail) return;
  }
  throw new HttpsError("permission-denied", "This document was not issued to you.");
}

// ---------------------------------------------------------------------------
// Snapshot building (employee-facing — allowlist only, never copies
// private notes / internal manager comments / any unexpected field)
// ---------------------------------------------------------------------------

function sanitizeIncidentSummaries(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const incidentId = trimStr(s.incidentId);
      const description = trimStr(s.description).slice(0, 4000);
      if (!incidentId || !description) return null;
      return {
        incidentId,
        type: trimStr(s.type).slice(0, 60),
        incidentAt: s.incidentAt || null, // Firestore Timestamp passed through
        description,
      };
    })
    .filter(Boolean);
}

/**
 * Authoritative employee-facing salon name = the selected location's saved
 * name (salons/{salonId}/locations/{locationId}.name). The path is scoped to
 * the caller's salon, so a cross-salon locationId simply does not exist.
 * The top-level salon doc `name` is NEVER used (it can hold the owner's
 * personal name), and settings/main.brandName is only an optional parent
 * brand that never blocks anything.
 */
async function fetchWriteupLocation(salonId, locationId) {
  const locId = trimStr(locationId);
  if (!locId) {
    throw new HttpsError(
      "failed-precondition",
      "Select a location for this write-up.",
    );
  }
  const snap = await db().doc(`salons/${salonId}/locations/${locId}`).get();
  if (!snap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "The selected location does not exist in this salon.",
    );
  }
  const data = snap.data() || {};
  const name = trimStr(data.name).slice(0, 200);
  if (!name) {
    throw new HttpsError(
      "failed-precondition",
      "The selected location has no saved name. Fix it in Settings first.",
    );
  }
  return { id: locId, name, isActive: data.isActive !== false };
}
exports.fetchWriteupLocation = fetchWriteupLocation;

/** Optional parent brand — display-only, never required, never blocks. */
async function fetchOptionalParentBrand(salonId) {
  try {
    const snap = await db().doc(`salons/${salonId}/settings/main`).get();
    return snap.exists ? trimStr((snap.data() || {}).brandName).slice(0, 200) : "";
  } catch (_) {
    return "";
  }
}

function buildIssuedSnapshot(draft, ctx) {
  return {
    salonId: ctx.salonId,
    employeeId: ctx.staffId,
    writeupId: ctx.writeupId,
    version: Number(draft.version) || 1,
    previousWriteupId: trimStr(draft.previousWriteupId) || null,
    // Header facts (salonName/locationName are the server-fetched saved name
    // of the selected location — see fetchWriteupLocation)
    locationId: trimStr(draft.locationId) || null,
    salonName: trimStr(draft.salonName).slice(0, 200),
    locationName: trimStr(draft.locationName).slice(0, 200) || null,
    parentBrandName: trimStr(draft.parentBrandName).slice(0, 200) || null,
    employeeName: trimStr(draft.employeeName).slice(0, 200),
    employeePosition: trimStr(draft.employeePosition).slice(0, 120) || null,
    writeupDate: draft.writeupDate || null,
    warningLevel: trimStr(draft.warningLevel),
    // Body (employee-facing only; managerComments is deliberately ABSENT)
    incidentSummaries: sanitizeIncidentSummaries(draft.incidentSummaries),
    policyViolated: trimStr(draft.policyViolated).slice(0, 2000) || null,
    requiredImprovement: trimStr(draft.requiredImprovement).slice(0, 4000) || null,
    followUpDate: trimStr(draft.followUpDate).slice(0, 40) || null,
    potentialNextSteps: trimStr(draft.potentialNextSteps).slice(0, 4000) || null,
    employeeFacingStatement: trimStr(draft.employeeFacingStatement).slice(0, 4000) || null,
    managerName: trimStr(draft.managerName).slice(0, 200) || null,
    acknowledgmentText: ACK_TEXT,
    // Lifecycle
    status: "sent",
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    openedInAppAt: null,
    employeeResponse: null,
    employeeResponseAt: null,
    acknowledgedAt: null,
    supersededBy: null,
  };
}

function escapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml(bodyText, linkUrl, salonName) {
  const paragraphs = String(bodyText || "")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px 0;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.6;max-width:560px;margin:0 auto;padding:24px;">` +
    `<div style="font-size:18px;font-weight:bold;color:#7c3aed;margin-bottom:18px;">Fair Flow</div>` +
    paragraphs +
    `<p style="margin:22px 0;"><a href="${escapeHtml(linkUrl)}" ` +
    `style="background:#7c3aed;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">` +
    `Review Document</a></p>` +
    `<p style="margin:18px 0 0 0;font-size:12px;color:#6b7280;">This message was sent by ${escapeHtml(
      trimStr(salonName) || "your salon",
    )} via Fair Flow. Please do not reply to this email.</p>` +
    `</div>`
  );
}

async function appendAuditEvent(parentRef, eventId, payload) {
  // Deterministic event IDs keep retries from duplicating audit entries.
  await parentRef
    .collection("auditEvents")
    .doc(eventId)
    .set(
      {
        ...payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: false },
    )
    .catch((err) => {
      // Audit best-effort on retries: never fail the send because an audit
      // doc already exists.
      if (err && err.code === 6) return; // ALREADY_EXISTS
      throw err;
    });
}

// ---------------------------------------------------------------------------
// approveAndSendWriteup
// ---------------------------------------------------------------------------

exports.approveAndSendWriteup = onCall({ region: REGION }, async (req) =>
  approveAndSendWriteupHandler(req.data || {}, { auth: req.auth }),
);

async function approveAndSendWriteupHandler(data, context) {
    if (!context.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = context.auth.uid;
    const { salonId, staffId, writeupId } = requireParams(data, [
      "salonId",
      "staffId",
      "writeupId",
    ]);
    const resendEmail = data && data.resendEmail === true;
    const markDeclined = data && data.markDeclined === true;

    await assertOwnerOrAdmin(uid, salonId);

    const draftRef = db().doc(`salons/${salonId}/staff/${staffId}/writeups/${writeupId}`);
    const issuedRef = db().doc(
      `salons/${salonId}/staff/${staffId}/writeupDocuments/${writeupId}`,
    );

    const draftSnap = await draftRef.get();
    if (!draftSnap.exists) throw new HttpsError("not-found", "Write-up not found.");
    const draft = draftSnap.data() || {};
    if (trimStr(draft.salonId) !== salonId || trimStr(draft.employeeId) !== staffId) {
      throw new HttpsError("failed-precondition", "Write-up does not match this employee.");
    }

    const status = trimStr(draft.status);

    if (status === "superseded") {
      throw new HttpsError(
        "failed-precondition",
        "This write-up was superseded by a corrected version.",
      );
    }

    // ---- Mark "declined to acknowledge" on an already-sent write-up ----
    // Owner/Admin only (same gate as sending). Updates the workflow doc AND
    // the issued employee-facing snapshot consistently, with server
    // timestamps and an append-only audit event. Idempotent: a second call
    // returns alreadyDeclined without changing anything.
    if (markDeclined) {
      if (status !== "sent") {
        throw new HttpsError(
          "failed-precondition",
          "Only a sent write-up can be marked as declined to acknowledge.",
        );
      }
      const issuedSnap = await issuedRef.get();
      const issued = issuedSnap.exists ? issuedSnap.data() || {} : {};
      if (issued.acknowledgedAt || draft.acknowledgedAt) {
        throw new HttpsError(
          "failed-precondition",
          "The employee already acknowledged this write-up.",
        );
      }
      if (draft.declinedToAcknowledgeAt) {
        return { ok: true, status: "sent", alreadyDeclined: true };
      }
      const note = trimStr(data && data.declineNote).slice(0, 2000) || null;
      const now = admin.firestore.FieldValue.serverTimestamp();
      const declinePatch = {
        declinedToAcknowledgeAt: now,
        declinedToAcknowledgeByUid: uid,
        declinedToAcknowledgeNote: note,
      };
      await draftRef.update({ ...declinePatch, updatedAt: now });
      if (issuedSnap.exists && !issued.declinedToAcknowledgeAt) {
        await issuedRef.update(declinePatch);
      }
      await appendAuditEvent(draftRef, "declined_to_acknowledge", {
        action: "declined_to_acknowledge",
        performedByUid: uid,
        ...(note ? { note } : {}),
      });
      return { ok: true, status: "sent", declined: true };
    }

    // ---- Authoritative location (never trusted from the client) ----
    // Fetched server-side for every path that issues a document or sends an
    // email (send + resend). The location's SAVED name overrides whatever
    // salonName/locationName the client stored in the draft, so an injected
    // name can never reach the issued snapshot or the email. markDeclined
    // (above) does not need it.
    const location = await fetchWriteupLocation(salonId, draft.locationId);
    draft.locationId = location.id;
    draft.salonName = location.name;
    draft.locationName = location.name;
    draft.parentBrandName = await fetchOptionalParentBrand(salonId);

    // ---- Explicit email resend on an already-sent write-up ----
    if (status === "sent") {
      if (!resendEmail) return { ok: true, status: "sent", alreadySent: true };
      const attempt = (Number(draft.emailAttempts) || 1) + 1;
      const mailId = await queueWriteupEmail({
        salonId,
        staffId,
        writeupId,
        draft,
        attempt,
      });
      await draftRef.update({
        emailAttempts: attempt,
        lastMailId: mailId,
        lastMailCollection: writeupMailCollectionForProject(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await appendAuditEvent(draftRef, `email_resent_a${attempt}`, {
        action: "email_resent",
        attempt,
        performedByUid: uid,
      });
      return { ok: true, status: "sent", resent: true, mailId };
    }

    if (status !== "draft" && status !== "sending") {
      throw new HttpsError("failed-precondition", `Unexpected write-up status "${status}".`);
    }

    // ---- Validate before anything becomes visible ----
    if (!WARNING_LEVELS.has(trimStr(draft.warningLevel))) {
      throw new HttpsError("failed-precondition", "Select a warning level first.");
    }
    const incidentIds = Array.isArray(draft.selectedIncidentIds)
      ? draft.selectedIncidentIds.map(trimStr).filter(Boolean)
      : [];
    const summaries = sanitizeIncidentSummaries(draft.incidentSummaries);
    if (!incidentIds.length || !summaries.length) {
      throw new HttpsError("failed-precondition", "Select at least one incident.");
    }
    if (!trimStr(draft.employeeName)) {
      throw new HttpsError("failed-precondition", "Employee name is missing.");
    }
    const staffSnap = await db().doc(`salons/${salonId}/staff/${staffId}`).get();
    if (!staffSnap.exists) throw new HttpsError("not-found", "Employee not found.");
    const employeeEmail = trimStr((staffSnap.data() || {}).email).toLowerCase();
    if (!employeeEmail || !employeeEmail.includes("@")) {
      throw new HttpsError(
        "failed-precondition",
        "The employee has no email address on file. Add one on their Details tab first.",
      );
    }

    // ---- Mark approval + move draft -> sending (first run only) ----
    await db().runTransaction(async (tx) => {
      const s = await tx.get(draftRef);
      const d = s.data() || {};
      if (trimStr(d.status) === "sent") return; // concurrent retry already finished
      const patch = {
        status: "sending",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!d.approvedAt) {
        patch.approvedAt = admin.firestore.FieldValue.serverTimestamp();
        patch.approvedByUid = uid;
      }
      tx.update(draftRef, patch);
    });
    await appendAuditEvent(draftRef, "approved", {
      action: "approved",
      performedByUid: uid,
      warningLevel: trimStr(draft.warningLevel),
      incidentCount: incidentIds.length,
    });

    // ---- Step A: issued immutable document (reused if it already exists) ----
    const issuedSnap = await issuedRef.get();
    if (!issuedSnap.exists) {
      await issuedRef.set(buildIssuedSnapshot(draft, { salonId, staffId, writeupId }));
    }

    // ---- Step B: in-app notification (deterministic ID, reused on retry) ----
    const notifRef = db().doc(
      `salons/${salonId}/staffPrivateNotifications/writeup_sent_${writeupId}`,
    );
    const notifSnap = await notifRef.get();
    if (!notifSnap.exists) {
      await notifRef.set({
        type: "writeup_sent",
        forStaffId: staffId,
        salonId,
        writeupId,
        // Deliberately generic — no incident details, no warning level.
        title: "You have received an important document",
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // ---- Step C: email attempt #1 (ALREADY_EXISTS on retry = already done) ----
    const mailId = await queueWriteupEmail({
      salonId,
      staffId,
      writeupId,
      draft,
      attempt: 1,
      toEmail: employeeEmail,
    });

    // ---- Step D: flip incidents to included_in_writeup (only now — after the
    //      document, notification and email all succeeded) ----
    const batch = db().batch();
    for (const incId of incidentIds) {
      const incRef = db().doc(
        `salons/${salonId}/staff/${staffId}/writeupIncidents/${incId}`,
      );
      batch.update(incRef, {
        status: "included_in_writeup",
        includedInWriteupId: writeupId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batch.set(
        incRef.collection("auditEvents").doc(`included_${writeupId}`),
        {
          action: "status_changed",
          from: "documented",
          to: "included_in_writeup",
          writeupId,
          performedByUid: uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }, // retry-safe
      );
    }
    await batch.commit();

    // ---- Step E: supersede previous version, then finalize draft -> sent ----
    const previousWriteupId = trimStr(draft.previousWriteupId);
    if (previousWriteupId && previousWriteupId !== writeupId) {
      const prevDraftRef = db().doc(
        `salons/${salonId}/staff/${staffId}/writeups/${previousWriteupId}`,
      );
      const prevIssuedRef = db().doc(
        `salons/${salonId}/staff/${staffId}/writeupDocuments/${previousWriteupId}`,
      );
      const [pd, pi] = await Promise.all([prevDraftRef.get(), prevIssuedRef.get()]);
      const supersedePatch = {
        status: "superseded",
        supersededBy: writeupId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (pd.exists && trimStr((pd.data() || {}).status) !== "superseded") {
        await prevDraftRef.update(supersedePatch);
      }
      if (pi.exists && trimStr((pi.data() || {}).status) !== "superseded") {
        await prevIssuedRef.update(supersedePatch);
      }
    }

    await draftRef.update({
      status: "sent",
      sentAt: draft.sentAt || admin.firestore.FieldValue.serverTimestamp(),
      emailAttempts: Number(draft.emailAttempts) || 1,
      lastMailId: mailId,
      lastMailCollection: writeupMailCollectionForProject(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await appendAuditEvent(draftRef, "sent_a1", {
      action: "sent",
      performedByUid: uid,
      mailId,
      incidentIds,
    });

    return { ok: true, status: "sent", mailId };
}

/**
 * Queue the notification email via the Trigger Email extension (`mail`
 * collection). Deterministic doc ID + create() = a retry can never produce a
 * duplicate email; ALREADY_EXISTS is treated as "this step already completed".
 */
async function queueWriteupEmail({ salonId, staffId, writeupId, draft, attempt, toEmail }) {
  const mailId = `writeup_${writeupId}_a${attempt}`;
  let to = trimStr(toEmail).toLowerCase();
  if (!to) {
    const staffSnap = await db().doc(`salons/${salonId}/staff/${staffId}`).get();
    to = trimStr((staffSnap.data() || {}).email).toLowerCase();
  }
  if (!to || !to.includes("@")) {
    throw new HttpsError("failed-precondition", "The employee has no email address on file.");
  }
  // draft.salonName was overridden by the caller with the server-fetched
  // location name (fetchWriteupLocation) — never a client-supplied value.
  const salonName = trimStr(draft.salonName) || "your salon";
  const firstName = trimStr(draft.employeeName).split(/\s+/)[0] || "";
  const subject =
    trimStr(draft.emailSubject).slice(0, 200) || `Important document from ${salonName}`;
  const bodyText =
    trimStr(draft.emailBody).slice(0, 6000) ||
    `${firstName ? `Hi ${firstName},` : "Hello,"}\n\n` +
      `You have received an important document from ${salonName} Management.\n\n` +
      `Please sign in to Fair Flow to review and acknowledge it. ` +
      `The document is available in your profile under "My Write-Ups."\n\n` +
      `Thank you,\n${salonName} Management`;
  const linkUrl = `${appBaseUrl()}/?ff_writeup=${encodeURIComponent(writeupId)}`;

  try {
    await db()
      .collection(writeupMailCollectionForProject())
      .doc(mailId)
      .create({
        to,
        message: {
          subject,
          text: `${bodyText}\n\nReview the document: ${linkUrl}`,
          html: buildEmailHtml(bodyText, linkUrl, salonName),
        },
        // Scoping metadata so owner/admin clients may read delivery status
        // (firestore.rules only opens writeup_* docs in mail /
        // writeupMailStaging to that salon's owner/admin — nothing else in
        // either collection is client-readable).
        salonId,
        staffId,
        writeupId,
        attempt,
        kind: "writeup_sent",
      });
  } catch (err) {
    if (!err || err.code !== 6) throw err; // 6 = ALREADY_EXISTS -> step done
  }
  return mailId;
}

// ---------------------------------------------------------------------------
// writeupEmployeeAction — open / respond / acknowledge
// ---------------------------------------------------------------------------

const EMPLOYEE_ACTIONS = new Set(["open", "respond", "acknowledge"]);

exports.writeupEmployeeAction = onCall({ region: REGION }, async (req) =>
  writeupEmployeeActionHandler(req.data || {}, { auth: req.auth }),
);

async function writeupEmployeeActionHandler(data, context) {
    if (!context.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = context.auth.uid;
    const { salonId, staffId, writeupId } = requireParams(data, [
      "salonId",
      "staffId",
      "writeupId",
    ]);
    const action = trimStr(data && data.action);
    if (!EMPLOYEE_ACTIONS.has(action)) {
      throw new HttpsError("invalid-argument", "Unknown action.");
    }

    await assertIsThisEmployee(uid, context.auth.token, salonId, staffId);

    const issuedRef = db().doc(
      `salons/${salonId}/staff/${staffId}/writeupDocuments/${writeupId}`,
    );
    const draftRef = db().doc(`salons/${salonId}/staff/${staffId}/writeups/${writeupId}`);
    const issuedSnap = await issuedRef.get();
    if (!issuedSnap.exists) throw new HttpsError("not-found", "Document not found.");
    const issued = issuedSnap.data() || {};
    if (trimStr(issued.employeeId) !== staffId) {
      throw new HttpsError("permission-denied", "This document was not issued to you.");
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const mirror = {}; // reflected onto the admin workflow doc

    if (action === "open") {
      if (!issued.openedInAppAt) {
        await issuedRef.update({ openedInAppAt: now });
        mirror.openedInAppAt = now;
        await appendAuditEvent(draftRef, "opened_in_app", {
          action: "opened_in_app",
          performedByUid: uid,
        });
      }
      // Mark the in-app notification read (best effort).
      await db()
        .doc(`salons/${salonId}/staffPrivateNotifications/writeup_sent_${writeupId}`)
        .set({ read: true, readAt: now }, { merge: true })
        .catch(() => {});
    } else if (action === "respond") {
      const response = trimStr(data && data.response).slice(0, 5000);
      if (!response) throw new HttpsError("invalid-argument", "Response is empty.");
      if (issued.acknowledgedAt) {
        throw new HttpsError(
          "failed-precondition",
          "This write-up was already acknowledged — the response can no longer be changed.",
        );
      }
      await issuedRef.update({ employeeResponse: response, employeeResponseAt: now });
      mirror.employeeResponse = response;
      mirror.employeeResponseAt = now;
      await appendAuditEvent(draftRef, `employee_responded_${Date.now()}`, {
        action: "employee_responded",
        performedByUid: uid,
      });
    } else if (action === "acknowledge") {
      if (trimStr(issued.status) === "superseded") {
        throw new HttpsError("failed-precondition", "This document was superseded.");
      }
      if (!issued.acknowledgedAt) {
        await issuedRef.update({ acknowledgedAt: now, status: "acknowledged" });
        mirror.acknowledgedAt = now;
        await appendAuditEvent(draftRef, "acknowledged", {
          action: "acknowledged",
          performedByUid: uid,
        });
      }
    }

    if (Object.keys(mirror).length) {
      await draftRef
        .update({ ...mirror, updatedAt: now })
        .catch(() => {}); // mirroring is cosmetic for the admin list
    }
    return { ok: true };
}
