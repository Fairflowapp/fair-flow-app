// Server-side scheduled Tasks auto-reset (Opening + Closing only).
//
// Mirrors queue-auto-reset.js: runs every 15 minutes using the salon IANA
// timezone, catch-up until end of the local day, once-per-day stamp via
// autoResetState.{tab}.lastRunDate. Clients still sync via onSnapshot; this
// module does not touch client code.
//
// Per tab (opening / closing), independently:
//   - enable + time from tasksState.alertWindows[tab] (default time 21:00)
//   - at that time, reset that branch's list even if some tasks were left
//     incomplete (a new salon day must start clean; skipping here left
//     locations stuck on yesterday's tasks)
//   - rebuild active from catalog[tab], clear pending/done
//   - stamp autoResetState[tab].lastRunDate + resetStamps[tab]
//
// Both tabs that qualify in the same sweep are applied in ONE transaction.

const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

const DEFAULT_TZ = "America/New_York";
const TABS = ["opening", "closing"];
const DEFAULT_RESET_TIME = "21:00";

/** Local wall-clock parts {dateKey, minutes} for `date` in IANA `tz`. */
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
  if (hh === 24) hh = 0;
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

/**
 * Resolve salon IANA timezone for a tasksState location.
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
    console.warn("[tasksAutoReset] timezone settings/main read failed", salonDoc.id, e && e.message);
  }

  return DEFAULT_TZ;
}

/**
 * Done check aligned with getFilteredMyListTasksForTab / ffMaybeAutoResetOpening:
 *   isCompleted = task.status === 'done' || !!task.completedAt
 * (does not use completed / isCompleted flags — those are interval-only).
 */
function isTaskDone(t) {
  if (!t || typeof t !== "object") return false;
  return t.status === "done" || !!t.completedAt;
}

/**
 * Count incomplete tasks on the ACTIVE list only — same source list as
 * ffGetUncompletedCountForTab → getFilteredMyListTasksForTab (active only).
 * Server cannot apply per-user relevance / one-time visibility filters; those
 * stay client-only. For opening/closing auto-reset we count all active rows.
 */
function countIncomplete(tabState) {
  const active = Array.isArray(tabState && tabState.active) ? tabState.active : [];
  let n = 0;
  for (const t of active) {
    if (!t || typeof t !== "object") continue;
    const isActiveFlag = t.active == null ? true : !!t.active;
    if (!isActiveFlag) continue;
    // Same hide rules as getFilteredMyListTasksForTab (before relevance filters).
    if (t.status === "pending" || !!t.assignedTo) continue;
    if (!isTaskDone(t)) n += 1;
  }
  return n;
}

function cloneCatalogRows(catalogTab) {
  if (!Array.isArray(catalogTab) || catalogTab.length === 0) return null;
  try {
    return JSON.parse(JSON.stringify(catalogTab));
  } catch (_) {
    return catalogTab.slice();
  }
}

/**
 * Decide whether a tab should reset given fresh (or outer) doc data + local clock.
 * Returns { ok: true, force, resetMin, catalogActive } or { ok: false, reason }.
 */
function evaluateTabReset(data, tab, lp) {
  const alertWindows = (data && data.alertWindows && typeof data.alertWindows === "object")
    ? data.alertWindows
    : {};
  const cfg = alertWindows[tab] || {};
  if (cfg.autoResetEnabled !== true) {
    return { ok: false, reason: "disabled" };
  }

  const resetMin = parseResetTimeToMinutes(cfg.autoResetTime || DEFAULT_RESET_TIME);
  if (resetMin === null) {
    return { ok: false, reason: "invalid-time" };
  }
  if (lp.minutes < resetMin) {
    return { ok: false, reason: "before-reset-time", resetMin };
  }

  const autoResetState = (data && data.autoResetState && typeof data.autoResetState === "object")
    ? data.autoResetState
    : {};
  const tabState = autoResetState[tab] || {};
  if (tabState.lastRunDate === lp.dateKey) {
    return { ok: false, reason: "already-reset-today" };
  }

  const catalog = (data && data.catalog && typeof data.catalog === "object") ? data.catalog : {};
  const catalogActive = cloneCatalogRows(catalog[tab]);
  if (!catalogActive) {
    return { ok: false, reason: "empty-catalog" };
  }

  // Opening/Closing are daily lists. When auto-reset is on and the time has
  // passed, always reset this branch — do not wait for every task to be done.
  const incomplete = countIncomplete(data[tab]);
  return { ok: true, force: true, resetMin, catalogActive, incomplete };
}

/**
 * Run the Tasks Opening/Closing auto-reset sweep.
 * @param {Date} now
 * @param {{dryRun?: boolean}} opts
 */
async function runTasksAutoResetSweep(now, opts = {}) {
  const dryRun = opts.dryRun === true;
  const db = admin.firestore();
  const summary = {
    now: now.toISOString(),
    dryRun,
    salons: 0,
    docsChecked: 0,
    reset: 0,
    skipped: 0,
    errors: 0,
    actions: [],
  };

  let salonsSnap;
  try {
    salonsSnap = await db.collection("salons").get();
  } catch (e) {
    console.error("[tasksAutoReset] list salons failed", e && e.message);
    summary.errors += 1;
    return summary;
  }

  for (const salonDoc of salonsSnap.docs) {
    summary.salons += 1;
    const salonId = salonDoc.id;

    let tsSnap;
    try {
      tsSnap = await salonDoc.ref.collection("tasksState").get();
    } catch (e) {
      summary.errors += 1;
      console.warn("[tasksAutoReset] list tasksState failed", salonId, e && e.message);
      continue;
    }

    for (const tDoc of tsSnap.docs) {
      summary.docsChecked += 1;
      const docId = tDoc.id;
      try {
        if (!tDoc.exists) {
          console.log("[tasksAutoReset] skip missing-doc", JSON.stringify({ salonId, docId }));
          summary.skipped += 1;
          continue;
        }

        const tz = await resolveSalonTimezone(salonDoc, docId);
        const lp = localParts(now, tz);
        const data = tDoc.data() || {};

        // Pre-filter which tabs look eligible (transaction re-validates on fresh data).
        const outerEligible = [];
        for (const tab of TABS) {
          const ev = evaluateTabReset(data, tab, lp);
          if (ev.ok) {
            outerEligible.push({ tab, ...ev });
          } else {
            console.log("[tasksAutoReset] skip tab", JSON.stringify({
              salonId, docId, tab, reason: ev.reason, tz, dateKey: lp.dateKey,
              nowLocalMin: lp.minutes, resetMin: ev.resetMin != null ? ev.resetMin : null,
            }));
            summary.skipped += 1;
          }
        }

        if (outerEligible.length === 0) continue;

        const action = {
          salonId,
          docId,
          tz,
          dateKey: lp.dateKey,
          localTime: lp.minutes,
          tabs: outerEligible.map((e) => ({
            tab: e.tab,
            force: e.force,
            resetMin: e.resetMin,
            catalogLen: Array.isArray(e.catalogActive) ? e.catalogActive.length : 0,
          })),
        };

        if (dryRun) {
          summary.actions.push({ ...action, dryRun: true });
          summary.reset += 1;
          continue;
        }

        const resetResult = await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(tDoc.ref);
          if (!freshSnap.exists) {
            console.log("[tasksAutoReset] skip missing-doc (tx)", JSON.stringify({ salonId, docId }));
            return { wrote: false, reason: "missing-doc", tabs: [] };
          }
          const fresh = freshSnap.data() || {};
          const tabsReset = [];
          const update = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdateReason: "tasks-auto-reset",
            lastUpdatedByUid: "server:tasksAutoReset",
          };

          for (const tab of TABS) {
            const ev = evaluateTabReset(fresh, tab, lp);
            if (!ev.ok) {
              if (ev.reason === "empty-catalog") {
                console.log("[tasksAutoReset] skip empty-catalog (tx)", JSON.stringify({ salonId, docId, tab }));
              }
              continue;
            }
            update[tab] = {
              active: ev.catalogActive,
              pending: [],
              done: [],
            };
            update[`autoResetState.${tab}.lastRunDate`] = lp.dateKey;
            update[`resetStamps.${tab}`] = Date.now();
            tabsReset.push({
              tab,
              force: ev.force,
              resetMin: ev.resetMin,
              catalogLen: ev.catalogActive.length,
            });
          }

          if (tabsReset.length === 0) {
            return { wrote: false, reason: "no-tabs-after-tx-check", tabs: [] };
          }

          const curRev = (typeof fresh.rev === "number" && fresh.rev >= 0) ? fresh.rev : 0;
          update.rev = curRev + 1;

          tx.update(tDoc.ref, update);
          return { wrote: true, tabs: tabsReset };
        });

        if (resetResult && resetResult.wrote) {
          summary.reset += 1;
          const doneAction = { ...action, tabs: resetResult.tabs };
          summary.actions.push(doneAction);
          console.log("[tasksAutoReset] reset", JSON.stringify(doneAction));
        } else {
          summary.skipped += 1;
          console.log("[tasksAutoReset] skip after-tx", JSON.stringify({
            salonId, docId, reason: resetResult && resetResult.reason,
          }));
        }
      } catch (e) {
        summary.errors += 1;
        console.warn("[tasksAutoReset] doc failed", salonId, docId, e && e.message);
      }
    }
  }

  console.log("[tasksAutoReset] sweep done", JSON.stringify({
    salons: summary.salons,
    docsChecked: summary.docsChecked,
    reset: summary.reset,
    skipped: summary.skipped,
    errors: summary.errors,
  }));
  return summary;
}

exports.scheduledTasksAutoReset = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 300, memory: "256MB" })
  .pubsub.schedule("every 15 minutes")
  .onRun(async () => {
    await runTasksAutoResetSweep(new Date());
    return null;
  });

// Manual trigger for testing. Guarded by shared key. Supports ?dryRun=1.
//   GET /debugRunTasksAutoReset?key=ff-tasks-reset-debug&dryRun=1
exports.debugRunTasksAutoReset = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    if ((req.query.key || "") !== "ff-tasks-reset-debug") {
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }
    try {
      const dryRun = String(req.query.dryRun || "") === "1";
      const summary = await runTasksAutoResetSweep(new Date(), { dryRun });
      res.status(200).json({ ok: true, summary });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
    }
  });

module.exports.runTasksAutoResetSweep = runTasksAutoResetSweep;
module.exports.parseResetTimeToMinutes = parseResetTimeToMinutes;
module.exports.localParts = localParts;
module.exports.resolveSalonTimezone = resolveSalonTimezone;
module.exports.evaluateTabReset = evaluateTabReset;
module.exports.countIncomplete = countIncomplete;
