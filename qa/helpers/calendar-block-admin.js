"use strict";

/**
 * Stale QA calendarBlocks cleanup. ffBookingQa / qaLoc1 only.
 * Deletes only blocks whose note or label is an FF-QA-* marker.
 */
const { REPO_ROOT } = require("./env");
const {
  REQUIRED_PROJECT,
  SALON_ID,
  abort,
  openStagingAdmin,
  assertQaSalonPath,
} = require("./staging-admin");

const FIXTURE_NOTE = "FF-QA-FIXTURE";
const QA_LOCATION_ID = "qaLoc1";
const QA_PROVIDER_IDS = ["qaProv1", "qaProv2"];
const BLOCKS_PREFIX = "salons/" + SALON_ID + "/calendarBlocks/";
const QA_BLOCK_MARK_RE = /^FF-QA-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?:\s|$)/;

function isQaCalendarBlockMark(text) {
  const value = String(text || "").trim();
  if (!value || value === FIXTURE_NOTE) return false;
  return QA_BLOCK_MARK_RE.test(value);
}

function isQaOwnedCalendarBlock(data) {
  const row = data && typeof data === "object" ? data : {};
  if (row.locationId && row.locationId !== QA_LOCATION_ID) return false;
  if (row.providerId && QA_PROVIDER_IDS.indexOf(row.providerId) === -1) return false;
  return isQaCalendarBlockMark(row.note) || isQaCalendarBlockMark(row.label);
}

function isStaleUpdate(updateTimeMs, cutoffMs) {
  const updated = Number(updateTimeMs);
  const cutoff = Number(cutoffMs);
  if (!updated || !Number.isFinite(updated) || !Number.isFinite(cutoff)) return false;
  return updated <= cutoff;
}

async function withAdmin(fn) {
  const { admin, db } = await openStagingAdmin(REPO_ROOT);
  if (admin.app().options.projectId !== REQUIRED_PROJECT) {
    abort("Admin projectId is not fair-flow-staging.");
  }
  return fn(db, admin);
}

function summarizeBlock(id, data) {
  const row = data && typeof data === "object" ? data : {};
  return {
    blockId: id,
    salonId: SALON_ID,
    projectId: REQUIRED_PROJECT,
    locationId: row.locationId || "",
    providerId: row.providerId || "",
    dateKey: row.dateKey || "",
    startMin: Number(row.startMin) || 0,
    endMin: Number(row.endMin) || 0,
    reason: row.reason || "",
    note: row.note || "",
    label: row.label || "",
  };
}

function noteBelongsToRun(text, runId) {
  const value = String(text || "");
  const id = String(runId || "");
  if (!id) return false;
  return value === id || value.indexOf(id + " ") === 0;
}

function isRunOwnedCalendarBlock(data, runId) {
  const row = data && typeof data === "object" ? data : {};
  if (!isQaOwnedCalendarBlock(row)) return false;
  return noteBelongsToRun(row.note, runId) || noteBelongsToRun(row.label, runId);
}

async function listQaCalendarBlocks(runId) {
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/calendarBlocks").limit(400).get();
    const rows = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (runId && !isRunOwnedCalendarBlock(data, runId)) return;
      if (!runId && !isQaOwnedCalendarBlock(data)) return;
      rows.push(summarizeBlock(docSnap.id, data));
    });
    return rows;
  });
}

async function waitForQaCalendarBlockByNote(note, timeoutMs) {
  const started = Date.now();
  const limit = Number(timeoutMs) || 20000;
  const want = String(note || "").trim();
  if (!want) abort("waitForQaCalendarBlockByNote requires a note.");
  while (Date.now() - started < limit) {
    const rows = await withAdmin(async (db) => {
      const snap = await db.collection("salons/" + SALON_ID + "/calendarBlocks").limit(400).get();
      const found = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (!isQaOwnedCalendarBlock(data)) return;
        if (String(data.note || "").trim() !== want && String(data.label || "").trim() !== want) return;
        found.push(summarizeBlock(docSnap.id, data));
      });
      return found;
    });
    if (rows.length) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  abort("Timed out waiting for QA Time Block note: " + want);
}

async function getQaCalendarBlock(blockId) {
  const id = String(blockId || "").trim();
  if (!id) abort("getQaCalendarBlock requires a blockId.");
  return withAdmin(async (db) => {
    const docPath = BLOCKS_PREFIX + id;
    assertQaSalonPath(docPath);
    const snap = await db.doc(docPath).get();
    if (!snap.exists) return null;
    return summarizeBlock(snap.id, snap.data() || {});
  });
}

async function cleanupQaCalendarBlocksForDay(dateKey) {
  const day = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) abort("cleanupQaCalendarBlocksForDay requires a dateKey.");
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/calendarBlocks").limit(400).get();
    const deleted = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      if (data.locationId !== QA_LOCATION_ID) continue;
      if (QA_PROVIDER_IDS.indexOf(String(data.providerId || "")) === -1) continue;
      if (String(data.dateKey || "") !== day) continue;
      const docPath = BLOCKS_PREFIX + docSnap.id;
      assertQaSalonPath(docPath);
      await db.doc(docPath).delete();
      deleted.push(docSnap.id);
    }
    return deleted;
  });
}

async function deleteCalendarBlocksByIds(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!list.length) return [];
  return withAdmin(async (db) => {
    const deleted = [];
    for (const id of list) {
      const docPath = BLOCKS_PREFIX + id;
      assertQaSalonPath(docPath);
      const snap = await db.doc(docPath).get();
      if (!snap.exists) continue;
      const data = snap.data() || {};
      if (data.locationId && data.locationId !== QA_LOCATION_ID) continue;
      if (data.providerId && QA_PROVIDER_IDS.indexOf(data.providerId) === -1) continue;
      await db.doc(docPath).delete();
      deleted.push(id);
    }
    return deleted;
  });
}

async function cleanupQaCalendarBlocks(runId) {
  const id = String(runId || "").trim();
  if (!id) abort("cleanupQaCalendarBlocks requires a runId so concurrent QA runs are not deleted.");
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/calendarBlocks").limit(400).get();
    const deleted = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      if (!isRunOwnedCalendarBlock(data, id)) continue;
      const docPath = BLOCKS_PREFIX + docSnap.id;
      assertQaSalonPath(docPath);
      await db.doc(docPath).delete();
      deleted.push(docSnap.id);
    }
    return deleted;
  });
}

async function cleanupStaleQaCalendarBlocks(maxAgeMs) {
  const age = Number(maxAgeMs) || 6 * 60 * 60 * 1000;
  const cutoff = Date.now() - age;
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/calendarBlocks").limit(400).get();
    const deleted = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      if (!isQaOwnedCalendarBlock(data)) continue;
      const updated = docSnap.updateTime && docSnap.updateTime.toMillis ? docSnap.updateTime.toMillis() : 0;
      if (!isStaleUpdate(updated, cutoff)) continue;
      const docPath = BLOCKS_PREFIX + docSnap.id;
      assertQaSalonPath(docPath);
      await db.doc(docPath).delete();
      deleted.push(docSnap.id);
    }
    return deleted;
  });
}

const SERIES_PREFIX = "salons/" + SALON_ID + "/calendarBlockSeries/";
const EXCEPTION_PREFIX = "salons/" + SALON_ID + "/calendarBlockExceptions/";

function isQaOwnedSeries(data) {
  return isQaOwnedCalendarBlock(data);
}

function isRunOwnedSeries(data, runId) {
  return isRunOwnedCalendarBlock(data, runId);
}

function summarizeSeries(id, data) {
  const row = data && typeof data === "object" ? data : {};
  return {
    seriesId: id,
    salonId: SALON_ID,
    projectId: REQUIRED_PROJECT,
    locationId: row.locationId || "",
    providerId: row.providerId || "",
    startDateKey: row.startDateKey || "",
    note: row.note || "",
    label: row.label || "",
    repeatFrequency: row.repeatFrequency || "",
    flexibilityMode: row.flexibilityMode || "",
    preferredStartMin: Number(row.preferredStartMin) || 0,
    durationMinutes: Number(row.durationMinutes) || 0,
    earliestStartMin: Number(row.earliestStartMin) || 0,
    latestEndMin: Number(row.latestEndMin) || 0,
    requiredDurationMinutes: Number(row.requiredDurationMinutes) || 0,
    reason: row.reason || "",
  };
}

function summarizeException(id, data) {
  const row = data && typeof data === "object" ? data : {};
  return {
    exceptionId: id,
    salonId: SALON_ID,
    projectId: REQUIRED_PROJECT,
    seriesId: row.seriesId || "",
    occurrenceDateKey: row.occurrenceDateKey || row.dateKey || "",
    kind: row.kind || "",
    startMin: Number.isFinite(Number(row.startMin)) ? Number(row.startMin) : null,
    endMin: Number.isFinite(Number(row.endMin)) ? Number(row.endMin) : null,
    providerId: row.providerId || "",
    note: row.note || "",
  };
}

async function listQaCalendarSeries(runId) {
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/calendarBlockSeries").limit(400).get();
    const rows = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (runId && !isRunOwnedSeries(data, runId)) return;
      if (!runId && !isQaOwnedSeries(data)) return;
      rows.push(summarizeSeries(docSnap.id, data));
    });
    return rows;
  });
}

async function getQaCalendarSeries(seriesId) {
  const id = String(seriesId || "").trim();
  if (!id) abort("getQaCalendarSeries requires a seriesId.");
  return withAdmin(async (db) => {
    const docPath = SERIES_PREFIX + id;
    assertQaSalonPath(docPath);
    const snap = await db.doc(docPath).get();
    if (!snap.exists) return null;
    return summarizeSeries(snap.id, snap.data() || {});
  });
}

async function listQaExceptionsForSeries(seriesId) {
  const id = String(seriesId || "").trim();
  if (!id) abort("listQaExceptionsForSeries requires a seriesId.");
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/calendarBlockExceptions")
      .where("seriesId", "==", id)
      .limit(400)
      .get();
    return snap.docs.map((docSnap) => summarizeException(docSnap.id, docSnap.data() || {}));
  });
}

async function waitForQaException(seriesId, dateKey, timeoutMs) {
  const id = String(seriesId || "").trim();
  const day = String(dateKey || "").trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    abort("waitForQaException requires seriesId and dateKey.");
  }
  const started = Date.now();
  const limit = Number(timeoutMs) || 20000;
  while (Date.now() - started < limit) {
    const rows = await listQaExceptionsForSeries(id);
    const hit = rows.find((row) => row.occurrenceDateKey === day);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  abort("Timed out waiting for QA Time Block exception " + id + " " + day);
}

async function waitForQaCalendarSeriesByNote(note, timeoutMs) {
  const started = Date.now();
  const limit = Number(timeoutMs) || 20000;
  const want = String(note || "").trim();
  if (!want) abort("waitForQaCalendarSeriesByNote requires a note.");
  while (Date.now() - started < limit) {
    const rows = await withAdmin(async (db) => {
      const snap = await db.collection("salons/" + SALON_ID + "/calendarBlockSeries").limit(400).get();
      const found = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (!isQaOwnedSeries(data)) return;
        if (String(data.note || "").trim() !== want && String(data.label || "").trim() !== want) return;
        found.push(summarizeSeries(docSnap.id, data));
      });
      return found;
    });
    if (rows.length) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  abort("Timed out waiting for QA Time Block series note: " + want);
}

async function cleanupQaCalendarSeries(runId) {
  const id = String(runId || "").trim();
  if (!id) abort("cleanupQaCalendarSeries requires a runId so concurrent QA runs are not deleted.");
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/calendarBlockSeries").limit(400).get();
    const deleted = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      if (!isRunOwnedSeries(data, id)) continue;
      const seriesPath = SERIES_PREFIX + docSnap.id;
      assertQaSalonPath(seriesPath);
      const exSnap = await db.collection("salons/" + SALON_ID + "/calendarBlockExceptions")
        .where("seriesId", "==", docSnap.id)
        .limit(400)
        .get();
      for (const ex of exSnap.docs) {
        const exPath = EXCEPTION_PREFIX + ex.id;
        assertQaSalonPath(exPath);
        await db.doc(exPath).delete();
      }
      await db.doc(seriesPath).delete();
      deleted.push(docSnap.id);
    }
    return deleted;
  });
}

async function cleanupStaleQaCalendarSeries(maxAgeMs) {
  const age = Number(maxAgeMs) || 6 * 60 * 60 * 1000;
  const cutoff = Date.now() - age;
  return withAdmin(async (db) => {
    const snap = await db.collection("salons/" + SALON_ID + "/calendarBlockSeries").limit(400).get();
    const deleted = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      if (!isQaOwnedSeries(data)) continue;
      const updated = docSnap.updateTime && docSnap.updateTime.toMillis ? docSnap.updateTime.toMillis() : 0;
      if (!isStaleUpdate(updated, cutoff)) continue;
      const seriesPath = SERIES_PREFIX + docSnap.id;
      assertQaSalonPath(seriesPath);
      const exSnap = await db.collection("salons/" + SALON_ID + "/calendarBlockExceptions")
        .where("seriesId", "==", docSnap.id)
        .limit(400)
        .get();
      for (const ex of exSnap.docs) {
        const exPath = EXCEPTION_PREFIX + ex.id;
        assertQaSalonPath(exPath);
        await db.doc(exPath).delete();
      }
      await db.doc(seriesPath).delete();
      deleted.push(docSnap.id);
    }
    return deleted;
  });
}

async function deleteCalendarSeriesByIds(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!list.length) return [];
  return withAdmin(async (db) => {
    const deleted = [];
    for (const id of list) {
      const seriesPath = SERIES_PREFIX + id;
      assertQaSalonPath(seriesPath);
      const snap = await db.doc(seriesPath).get();
      if (!snap.exists) continue;
      const data = snap.data() || {};
      if (data.locationId && data.locationId !== QA_LOCATION_ID) continue;
      if (data.providerId && QA_PROVIDER_IDS.indexOf(data.providerId) === -1) continue;
      const exSnap = await db.collection("salons/" + SALON_ID + "/calendarBlockExceptions")
        .where("seriesId", "==", id)
        .limit(400)
        .get();
      for (const ex of exSnap.docs) {
        const exPath = EXCEPTION_PREFIX + ex.id;
        assertQaSalonPath(exPath);
        await db.doc(exPath).delete();
      }
      await db.doc(seriesPath).delete();
      deleted.push(id);
    }
    return deleted;
  });
}

module.exports = {
  SALON_ID,
  FIXTURE_NOTE,
  QA_LOCATION_ID,
  QA_PROVIDER_IDS,
  QA_BLOCK_MARK_RE,
  isQaCalendarBlockMark,
  isQaOwnedCalendarBlock,
  isRunOwnedCalendarBlock,
  noteBelongsToRun,
  isStaleUpdate,
  summarizeBlock,
  listQaCalendarBlocks,
  waitForQaCalendarBlockByNote,
  getQaCalendarBlock,
  cleanupQaCalendarBlocksForDay,
  deleteCalendarBlocksByIds,
  cleanupQaCalendarBlocks,
  cleanupStaleQaCalendarBlocks,
  isQaOwnedSeries,
  isRunOwnedSeries,
  summarizeSeries,
  summarizeException,
  listQaCalendarSeries,
  getQaCalendarSeries,
  listQaExceptionsForSeries,
  waitForQaException,
  waitForQaCalendarSeriesByNote,
  cleanupQaCalendarSeries,
  cleanupStaleQaCalendarSeries,
  deleteCalendarSeriesByIds,
};
