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

module.exports = {
  SALON_ID,
  FIXTURE_NOTE,
  QA_LOCATION_ID,
  QA_PROVIDER_IDS,
  QA_BLOCK_MARK_RE,
  isQaCalendarBlockMark,
  isQaOwnedCalendarBlock,
  isStaleUpdate,
  cleanupStaleQaCalendarBlocks,
};
