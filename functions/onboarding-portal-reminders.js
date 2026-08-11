/**
 * Onboarding portal — reminders, incomplete-inbox, scheduled sweep.
 */

const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  admin,
  HttpsError,
  ONBOARDING_PORTAL_HMAC_SECRET,
  PORTAL_SECRET_OPTS,
  REGION,
  db,
  trimStr,
  maskEmail,
  logPortal,
  assertManager,
  requireManagerAuth,
} = require("./onboarding-portal-shared");
const {
  onboardingMailCollectionForProject,
  formatDueForEmail,
  buildOnboardingPortalEmailHtml,
  parseDueMs,
  firstEmailSentMs,
  reminderAlreadySent,
  ensureActivePortalLink,
} = require("./onboarding-portal-email");

// Reminder / incomplete-inbox constants
const REMINDER_AFTER_SEND_MS = 24 * 60 * 60 * 1000;
const REMINDER_BEFORE_DUE_MS = 24 * 60 * 60 * 1000;
const REMINDER_KIND_AFTER_SEND = "after_send_24h";
const REMINDER_KIND_BEFORE_DUE = "before_due_24h";
const REMINDER_KIND_MANUAL = "manual";
const REMINDER_ELIGIBLE_STATUSES = new Set(["sent", "in_progress"]);
/** Manager Inbox alert when onboarding stays incomplete after first invite email. */
const MANAGER_INCOMPLETE_INBOX_MS = 7 * 24 * 60 * 60 * 1000;
const MANAGER_INCOMPLETE_INBOX_TYPE = "onboarding_incomplete";

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
