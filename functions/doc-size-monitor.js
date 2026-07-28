// Scheduled monitor for oversized Firestore docs (queueState / tasksState).
//
// WHY: Firestore caps a document at 1MiB. The queue history log grew unbounded
// inside the per-location queueState doc until security-rule evaluation failed
// and EVERY client write was rejected (the "queue jump-back" outage of
// 2026-07-27). Clients now prune on write (60-day / 1500-entry cap), but this
// server-side sweep is the safety net that does not depend on which app
// version a device runs:
//
//   - WARN  (> WARN_BYTES):      email platform admins (alerts permission).
//   - CRITICAL (> CRIT_BYTES, queueState only): archive the full history log
//     to salons/{id}/queueLogArchive and trim the live doc, then email what
//     was done. This prevents a repeat outage even with zero human response.
//
// Alert throttling: at most one email per doc per ALERT_COOLDOWN_MS, tracked
// in system/docSizeMonitor.

const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

const WARN_BYTES = 600 * 1024;
const CRIT_BYTES = 850 * 1024;
const ALERT_COOLDOWN_MS = 72 * 60 * 60 * 1000; // 72h per doc
const LOG_KEEP_ENTRIES = 1500;
const LOG_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const ALERT_EMAIL = "support@fairflowapp.com";

function jsonSize(data) {
  try { return Buffer.byteLength(JSON.stringify(data)); } catch (_) { return 0; }
}

function buildAlertEmail(findings, opts = {}) {
  const isTest = opts.test === true;
  const critCount = findings.filter((f) => f.level === "CRITICAL").length;
  const levelBadge = (level) => level === "CRITICAL"
    ? '<span style="background:#dc2626;color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">CRITICAL</span>'
    : '<span style="background:#f59e0b;color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">WARN</span>';
  const pctOf1MB = (kb) => Math.min(100, Math.round((kb / 1024) * 100));
  const rows = findings.map((f) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${levelBadge(f.level)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
        <strong>${f.salonName || f.salonId}</strong><br>
        <span style="color:#6b7280;font-size:12px;">${f.salonId}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:13px;">${f.coll}/${f.docId}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">
        <strong>${f.sizeKB} KB</strong> <span style="color:#6b7280;font-size:12px;">(${pctOf1MB(f.sizeKB)}% of 1MB)</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${f.action === "none" ? "—" : f.action}</td>
    </tr>`).join("");
  return {
    subject: `${isTest ? "[TEST] " : ""}[Fair Flow] Document size alert — ${findings.length} doc(s) near the 1MB limit${critCount ? ` (${critCount} critical)` : ""}`,
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;color:#111827;">
  <div style="background:#111827;border-radius:12px 12px 0 0;padding:20px 24px;">
    <div style="color:#fff;font-size:18px;font-weight:700;">Fair Flow · Platform Alert</div>
    <div style="color:#9ca3af;font-size:13px;margin-top:4px;">Firestore document size monitor</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
    ${isTest ? '<div style="background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;"><strong>This is a test email.</strong> The data below is sample data showing how a real alert will look.</div>' : ""}
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">
      The following salon documents are approaching Firestore's <strong>1MB per-document limit</strong>.
      Above ~950KB, writes start failing and the queue/tasks stop syncing for that salon.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f9fafb;text-align:left;">
        <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;">Level</th>
        <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;">Salon</th>
        <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;">Document</th>
        <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;">Size</th>
        <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;">Automatic action</th>
      </tr>
      ${rows}
    </table>
    <div style="background:#f9fafb;border-radius:8px;padding:12px 16px;margin-top:20px;font-size:13px;color:#4b5563;line-height:1.6;">
      <strong>Thresholds:</strong> WARN at ${Math.round(WARN_BYTES / 1024)}KB · CRITICAL at ${Math.round(CRIT_BYTES / 1024)}KB.<br>
      At CRITICAL, queue history is automatically archived to <code>queueLogArchive</code> and the live document is trimmed — no data is lost and FairFlow Points are not affected.
    </div>
    <p style="color:#9ca3af;font-size:12px;margin:20px 0 0;">Sent automatically by the daily doc-size monitor · fairflowapp-db841</p>
  </div>
</div>`,
  };
}

function trimLog(log) {
  const cutoff = Date.now() - LOG_MAX_AGE_MS;
  let out = (Array.isArray(log) ? log : []).filter((e) => {
    const ts = e && typeof e.ts === "number" ? e.ts : 0;
    return !ts || ts >= cutoff;
  });
  if (out.length > LOG_KEEP_ENTRIES) out = out.slice(-LOG_KEEP_ENTRIES);
  return out;
}

async function archiveAndTrimQueueDoc(db, salonId, docSnap) {
  const d = docSnap.data() || {};
  const log = Array.isArray(d.log) ? d.log : [];
  const stamp = Date.now();
  const CHUNK = 2000;
  for (let i = 0, n = 0; i < log.length; i += CHUNK, n++) {
    await db.doc(`salons/${salonId}/queueLogArchive/${docSnap.id}_${stamp}_${n}`).set({
      sourceDoc: docSnap.id,
      archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      fromIndex: i,
      count: Math.min(CHUNK, log.length - i),
      entries: log.slice(i, i + CHUNK),
    });
  }
  const trimmed = trimLog(log);
  await docSnap.ref.update({
    log: trimmed,
    rev: (typeof d.rev === "number" ? d.rev : 0) + 1,
    lastUpdateReason: "doc-size-monitor-trim",
    lastUpdatedByUid: "server:docSizeMonitor",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { before: log.length, after: trimmed.length };
}

async function runDocSizeSweep(opts = {}) {
  const db = admin.firestore();
  const dryRun = opts.dryRun === true;
  const stateRef = db.doc("system/docSizeMonitor");
  const stateSnap = await stateRef.get();
  const lastAlerts = (stateSnap.exists && stateSnap.data().lastAlerts) || {};
  const findings = [];

  const salons = await db.collection("salons").listDocuments();
  for (const salonRef of salons) {
    for (const coll of ["queueState", "tasksState"]) {
      const snap = await salonRef.collection(coll).get();
      for (const docSnap of snap.docs) {
        const size = jsonSize(docSnap.data());
        if (size < WARN_BYTES) continue;
        let salonName = "";
        try {
          const salonDoc = await salonRef.get();
          const sd = salonDoc.data() || {};
          salonName = sd.salonName || sd.name || sd.businessName || "";
        } catch (_) {}
        const finding = {
          salonName,
          salonId: salonRef.id,
          coll,
          docId: docSnap.id,
          sizeKB: Math.round(size / 1024),
          level: size >= CRIT_BYTES ? "CRITICAL" : "WARN",
          action: "none",
        };
        if (finding.level === "CRITICAL" && coll === "queueState" && !dryRun) {
          try {
            const r = await archiveAndTrimQueueDoc(db, salonRef.id, docSnap);
            finding.action = `archived + trimmed log ${r.before} -> ${r.after} entries`;
          } catch (e) {
            finding.action = "TRIM FAILED: " + ((e && e.message) || String(e));
          }
        }
        findings.push(finding);
      }
    }
  }

  // Throttle: only email findings we haven't alerted on recently (always email
  // CRITICAL ones that were auto-trimmed, so the action is visible).
  const now = Date.now();
  const toEmail = findings.filter((f) => {
    const key = `${f.salonId}_${f.coll}_${f.docId}`;
    if (f.action.startsWith("archived")) return true;
    return !(lastAlerts[key] && now - lastAlerts[key] < ALERT_COOLDOWN_MS);
  });

  if (toEmail.length && !dryRun) {
    await db.collection("mail").add({
      to: ALERT_EMAIL,
      message: buildAlertEmail(toEmail),
    });
    const nextAlerts = { ...lastAlerts };
    toEmail.forEach((f) => { nextAlerts[`${f.salonId}_${f.coll}_${f.docId}`] = now; });
    await stateRef.set({ lastAlerts: nextAlerts, lastRunAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } else if (!dryRun) {
    await stateRef.set({ lastRunAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }

  console.log("[DocSizeMonitor] sweep done", JSON.stringify({ findings, emailed: toEmail.length }));
  return { findings, emailed: toEmail.length };
}

exports.scheduledDocSizeMonitor = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 300, memory: "256MB" })
  .pubsub.schedule("every 24 hours")
  .onRun(async () => {
    await runDocSizeSweep();
    return null;
  });

// Manual trigger for verification:
//   GET /debugRunDocSizeMonitor?key=ff-doc-size-debug&dryRun=1
exports.debugRunDocSizeMonitor = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    if ((req.query.key || "") !== "ff-doc-size-debug") {
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }
    try {
      const summary = await runDocSizeSweep({ dryRun: String(req.query.dryRun || "") === "1" });
      res.status(200).json({ ok: true, summary });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
    }
  });

module.exports.runDocSizeSweep = runDocSizeSweep;
module.exports.buildAlertEmail = buildAlertEmail;
