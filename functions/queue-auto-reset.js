// Server-side scheduled queue auto-reset.
//
// WHY: the queue auto-reset used to run only on the client (in the browser/app).
// A salon that schedules a 04:00 reset but is closed at 04:00 has no device open,
// so the reset never actually ran, and yesterday's / overnight leftovers carried
// into the morning. This module runs the reset on the SERVER on a schedule, so it
// fires reliably at the configured local time regardless of whether any device is
// open. Admin SDK writes bypass security rules, so there is no rev/permission
// contention (and at 04:00 there are no concurrent client writes anyway).
//
// Cloud is the sole authority for automatic queue reset (clients no longer wipe
// on a timer). Semantics:
//   - queue is always cleared
//   - service is cleared only when resetWhileInService (force) is true
//   - history log is preserved
//   - runtime.lastAutoResetDate is stamped so it runs once per local day
//   - rev is bumped so live clients pick up the cleared state
//
// Catch-up: once the scheduled local time has passed today, any sweep until end
// of that local day will still reset if lastAutoResetDate !== today. The stamp
// prevents a second wipe later the same day (e.g. after a mid-day deploy).

const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

// Fallback timezone when a salon has no timezone / preferences.salonTimeZone yet.
const DEFAULT_TZ = "America/New_York";

/** Local wall-clock parts {y,m,d,minutes,dateKey} for `date` in IANA `tz`. */
function localParts(date, tz) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch (_) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TZ,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  }
  const p = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  let hh = parseInt(p.hour, 10);
  if (hh === 24) hh = 0; // some ICU builds emit "24" for midnight
  const mm = parseInt(p.minute, 10);
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    minutes: hh * 60 + mm,
  };
}

/** Parse "HH:mm" or "hh:mm AM/PM" → minutes since midnight, or null. */
function parseResetTimeToMinutes(timeStr) {
  if (typeof timeStr !== "string") return null;
  const s = timeStr.trim();
  let m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let h = parseInt(m[1], 10) % 12;
    if (/PM/i.test(m[3])) h += 12;
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  return null;
}

function arrLen(v) {
  return Array.isArray(v) ? v.length : 0;
}

/**
 * Resolve salon IANA timezone for a queueState location.
 * Prefer: salon.timezone → locationPreferences[loc].salonTimeZone →
 * preferences.salonTimeZone (salon root or settings/main) → default.
 */
async function resolveSalonTimezone(salonDoc, locationId) {
  const top = salonDoc.get("timezone");
  if (top && String(top).trim()) return String(top).trim();

  const rootPrefs = salonDoc.get("preferences");
  if (rootPrefs && typeof rootPrefs === "object") {
    const fromPrefs = rootPrefs.salonTimeZone;
    if (fromPrefs && String(fromPrefs).trim()) return String(fromPrefs).trim();
  }

  try {
    const mainSnap = await salonDoc.ref.collection("settings").doc("main").get();
    if (mainSnap.exists) {
      const data = mainSnap.data() || {};
      const locPrefs = data.locationPreferences;
      if (locationId && locPrefs && typeof locPrefs === "object") {
        const loc = locPrefs[locationId];
        if (loc && loc.salonTimeZone && String(loc.salonTimeZone).trim()) {
          return String(loc.salonTimeZone).trim();
        }
      }
      if (data.preferences && data.preferences.salonTimeZone &&
          String(data.preferences.salonTimeZone).trim()) {
        return String(data.preferences.salonTimeZone).trim();
      }
      // Any location preference as last fallback before default.
      if (locPrefs && typeof locPrefs === "object") {
        for (const key of Object.keys(locPrefs)) {
          const loc = locPrefs[key];
          if (loc && loc.salonTimeZone && String(loc.salonTimeZone).trim()) {
            return String(loc.salonTimeZone).trim();
          }
        }
      }
    }
  } catch (e) {
    console.warn("[queueAutoReset] timezone settings/main read failed", salonDoc.id, e && e.message);
  }

  return DEFAULT_TZ;
}

/**
 * Run the reset sweep across all salons/locations.
 * @param {Date} now
 * @param {{dryRun?: boolean}} opts
 * @returns {Promise<object>} summary
 */
async function runQueueAutoResetSweep(now, opts = {}) {
  const dryRun = opts.dryRun === true;
  const db = admin.firestore();
  const summary = { now: now.toISOString(), dryRun, salons: 0, docsChecked: 0, reset: 0, skipped: 0, errors: 0, actions: [] };

  let salonsSnap;
  try {
    salonsSnap = await db.collection("salons").get();
  } catch (e) {
    console.error("[queueAutoReset] list salons failed", e && e.message);
    summary.errors += 1;
    return summary;
  }

  for (const salonDoc of salonsSnap.docs) {
    summary.salons += 1;
    const salonId = salonDoc.id;

    let qsSnap;
    try {
      qsSnap = await salonDoc.ref.collection("queueState").get();
    } catch (e) {
      summary.errors += 1;
      console.warn("[queueAutoReset] list queueState failed", salonId, e && e.message);
      continue;
    }

    for (const qDoc of qsSnap.docs) {
      summary.docsChecked += 1;
      const docId = qDoc.id; // location id, or "default"
      try {
        const tz = await resolveSalonTimezone(salonDoc, docId);
        const lp = localParts(now, tz);
        const data = qDoc.data() || {};
        const settingsBlob = data.queueSettings || {};
        // Per-location bucket inside the settings blob; fall back to "default".
        const bucket = settingsBlob[docId] || (docId === "default" ? settingsBlob.default : null) || {};
        const autoReset = (bucket.settings && bucket.settings.autoReset) || null;

        if (!autoReset || autoReset.enabled !== true) { summary.skipped += 1; continue; }

        const resetMin = parseResetTimeToMinutes(autoReset.time || "04:00");
        if (resetMin === null) { summary.skipped += 1; continue; }

        // Catch-up until end of local day: fire once after scheduled time if not
        // already stamped for today. Stamp prevents repeat wipes later the same day.
        if (lp.minutes < resetMin) {
          console.log("[queueAutoReset] skip before-reset-time", JSON.stringify({
            salonId, docId, tz, nowLocalMin: lp.minutes, resetMin, rawTime: autoReset.time || null, dateKey: lp.dateKey,
          }));
          summary.skipped += 1;
          continue;
        }

        const lastDate = (bucket.runtime && bucket.runtime.lastAutoResetDate) || null;
        if (lastDate === lp.dateKey) {
          console.log("[queueAutoReset] skip already-reset-today", JSON.stringify({
            salonId, docId, lastDate, dateKey: lp.dateKey, resetMin, nowLocalMin: lp.minutes,
          }));
          summary.skipped += 1;
          continue;
        } // already reset today (local)

        const force = autoReset.resetWhileInService === true;
        const serviceLen = arrLen(data.service);

        // Force off + someone in service → don't wipe; retry on a later run.
        if (!force && serviceLen > 0) {
          console.log("[queueAutoReset] skip in-service (force off)", JSON.stringify({
            salonId, docId, serviceLen, resetMin, nowLocalMin: lp.minutes, dateKey: lp.dateKey,
          }));
          summary.skipped += 1;
          continue;
        }

        const action = {
          salonId, docId, tz, localTime: lp.minutes, resetMin, dateKey: lp.dateKey,
          clearedQueue: arrLen(data.queue), clearedService: force ? serviceLen : 0, force,
        };

        if (dryRun) { summary.actions.push({ ...action, dryRun: true }); summary.reset += 1; continue; }

        await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(qDoc.ref);
          const freshData = freshSnap.exists ? (freshSnap.data() || {}) : {};
          const serverRev = (typeof freshData.rev === "number" && freshData.rev >= 0) ? freshData.rev : 0;
          const update = {
            queue: [],
            rev: serverRev + 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdateReason: "auto-reset",
            lastUpdatedByUid: "server:queueAutoReset",
          };
          if (force) update.service = [];
          // Stamp lastAutoResetDate inside the same per-location settings bucket.
          update[`queueSettings.${docId}.runtime.lastAutoResetDate`] = lp.dateKey;
          tx.update(qDoc.ref, update);
        });
        summary.reset += 1;
        summary.actions.push(action);
        console.log("[queueAutoReset] reset", JSON.stringify(action));
      } catch (e) {
        summary.errors += 1;
        console.warn("[queueAutoReset] doc failed", salonId, docId, e && e.message);
      }
    }
  }

  console.log("[queueAutoReset] sweep done", JSON.stringify({
    salons: summary.salons, docsChecked: summary.docsChecked,
    reset: summary.reset, skipped: summary.skipped, errors: summary.errors,
  }));
  return summary;
}

// Scheduled sweep — every 15 minutes; catch-up until end of local day after
// the configured reset time, in every timezone, without any device being open.
exports.scheduledQueueAutoReset = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 300, memory: "256MB" })
  .pubsub.schedule("every 15 minutes")
  .onRun(async () => {
    await runQueueAutoResetSweep(new Date());
    return null;
  });

// Manual trigger for testing (staging). Guarded by a shared key so it cannot be
// invoked anonymously. Supports ?dryRun=1 to preview without writing.
//   GET /debugRunQueueAutoReset?key=ff-queue-reset-debug&dryRun=1
exports.debugRunQueueAutoReset = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    if ((req.query.key || "") !== "ff-queue-reset-debug") {
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }
    try {
      const dryRun = String(req.query.dryRun || "") === "1";
      const summary = await runQueueAutoResetSweep(new Date(), { dryRun });
      res.status(200).json({ ok: true, summary });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
    }
  });

module.exports.runQueueAutoResetSweep = runQueueAutoResetSweep;
module.exports.parseResetTimeToMinutes = parseResetTimeToMinutes;
module.exports.localParts = localParts;
module.exports.resolveSalonTimezone = resolveSalonTimezone;
