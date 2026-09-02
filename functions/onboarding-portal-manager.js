/**
 * Onboarding portal — manager callables (tokens, send email, extend).
 */

const { onCall } = require("firebase-functions/v2/https");
const {
  admin,
  HttpsError,
  PORTAL_SECRET_OPTS,
  REGION,
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  db,
  trimStr,
  portalUrl,
  maskEmail,
  logPortal,
  assertManager,
  requireManagerAuth,
  unsealRawToken,
  revokeActiveTokensForRun,
  issueTokenCore,
} = require("./onboarding-portal-shared");
const {
  onboardingMailCollectionForProject,
  formatDueForEmail,
  buildOnboardingPortalEmailHtml,
  ensureActivePortalLink,
  firstEmailSentMs,
} = require("./onboarding-portal-email");

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
              portal: {
                activeTokenId: null,
                revokedAt: now,
                bootstrappedAt: admin.firestore.FieldValue.delete(),
              },
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
      return {
        active: false,
        url: null,
        tokenId: null,
        expiresAt: null,
        opened: false,
        openedAt: null,
      };
    }
    const doc = q.docs[0];
    const t = doc.data() || {};
    const opened = !!t.bootstrappedAt;
    const openedAt =
      t.bootstrappedAt && t.bootstrappedAt.toDate
        ? t.bootstrappedAt.toDate().toISOString()
        : null;
    const exp = t.expiresAt && t.expiresAt.toMillis ? t.expiresAt.toMillis() : 0;
    if (!exp || exp < Date.now()) {
      return {
        active: false,
        url: null,
        tokenId: doc.id,
        expiresAt: null,
        opened,
        openedAt,
      };
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
        opened,
        openedAt,
      };
    }
    logPortal("get_active_link", { salonId, staffId, runId, tokenId: doc.id });
    return {
      active: true,
      url: portalUrl(raw),
      tokenId: doc.id,
      expiresAt: t.expiresAt.toDate().toISOString(),
      needsReissue: false,
      opened,
      openedAt,
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
