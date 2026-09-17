"use strict";

/**
 * Recurring + Flexible Time Blocks real-browser flow.
 * Creates only FF-QA temporary Time Blocks / series and deletes them afterward
 * when staging Admin ADC is available.
 */
const { test, expect } = require("../../helpers/qa-test");
const { gotoStagingApp, waitForAppReady, assertStagingFirebase } = require("../../helpers/auth");
const { makeRunId } = require("../../helpers/appointment-admin");
const {
  cleanupQaCalendarBlocks,
  cleanupQaCalendarBlocksForDay,
  deleteCalendarBlocksByIds,
  waitForQaCalendarBlockByNote,
  cleanupQaCalendarSeries,
  deleteCalendarSeriesByIds,
} = require("../../helpers/calendar-block-admin");
const ui = require("../../helpers/time-block-ui");
const { attachDiagnostics, printDiagnostics } = require("../../helpers/diagnostics");
const { maybeAcquireWriteLock, maybeReleaseWriteLock } = require("../../helpers/write-lock");

let RUN_ID = "";
let WRITE_LOCK = null;
let DATE_KEY = "";
let ADMIN_OK = false;
const CREATED_IDS = [];
const CREATED_SERIES = [];
const DAYS_AHEAD = 4;

async function readyPage(page) {
  await gotoStagingApp(page);
  await waitForAppReady(page);
  await assertStagingFirebase(page);
  await ui.openReadyCalendar(page);
  const dateKey = await ui.goToFutureDay(page, DAYS_AHEAD);
  await ui.waitForProviders(page);
  return dateKey;
}

test.beforeAll(async () => {
  RUN_ID = makeRunId();
  try {
    WRITE_LOCK = await maybeAcquireWriteLock({
      runId: RUN_ID,
      targetLabel: process.env.FF_QA_TARGET_LABEL || "recurring-flex",
      targetSha: process.env.FF_QA_TARGET_SHA || "",
    });
    await cleanupQaCalendarBlocks(RUN_ID);
    await cleanupQaCalendarSeries(RUN_ID);
    ADMIN_OK = true;
  } catch (err) {
    ADMIN_OK = false;
    console.log("[QA] recurring-flex Admin unavailable; UI-only path.", err && err.message ? err.message : err);
  }
});

test.afterAll(async () => {
  let deletedBlocks = [];
  let deletedSeries = [];
  try {
    if (ADMIN_OK) {
      if (CREATED_IDS.length) deletedBlocks = await deleteCalendarBlocksByIds(CREATED_IDS);
      if (CREATED_SERIES.length) deletedSeries = await deleteCalendarSeriesByIds(CREATED_SERIES);
      if (DATE_KEY) deletedBlocks = deletedBlocks.concat(await cleanupQaCalendarBlocksForDay(DATE_KEY));
      if (RUN_ID) {
        deletedBlocks = deletedBlocks.concat(await cleanupQaCalendarBlocks(RUN_ID));
        deletedSeries = deletedSeries.concat(await cleanupQaCalendarSeries(RUN_ID));
      }
    }
  } finally {
    if (WRITE_LOCK) await maybeReleaseWriteLock(WRITE_LOCK);
  }
  console.log("[QA] recurring-flex-blocks cleanup", JSON.stringify({
    runId: RUN_ID,
    adminOk: ADMIN_OK,
    created: CREATED_IDS,
    createdSeries: CREATED_SERIES,
    deletedBlocks,
    deletedSeries,
  }));
});

test("Recurring and Flexible Time Block editor + Calendar", async ({ page }) => {
  test.setTimeout(180000);
  const diag = attachDiagnostics(page);
  const dateKey = await readyPage(page);
  DATE_KEY = dateKey;
  const note = RUN_ID + " flex-lunch";

  await ui.clickSlotForTimeBlock(page, ui.FIXTURE.providerOneId, 14 * 60);
  await ui.assertNoBlockTimeCopy(page, "#ffBookingBlockEditor");
  await expect(page.locator('#ffBookingBlockEditor [name="ff-block-repeat"]')).toBeVisible();
  await expect(page.locator('#ffBookingBlockEditor [data-ff-block-flex="fixed"]')).toBeVisible();
  await expect(page.locator('#ffBookingBlockEditor [data-ff-block-flex="flexible"]')).toBeVisible();

  await page.locator('#ffBookingBlockEditor [name="ff-block-repeat"]').selectOption("custom");
  await expect(page.locator("#ffBookingBlockEditor [data-ff-block-custom-days]")).toBeVisible();
  await expect(page.locator("#ffBookingBlockEditor [data-ff-block-day]")).toHaveCount(7);

  await page.locator('#ffBookingBlockEditor [data-ff-block-flex="flexible"]').click();
  await expect(page.locator("#ffBookingBlockEditor [data-ff-block-flex-fields]")).toBeVisible();
  await expect(page.locator("#ffBookingBlockEditor [data-ff-block-preferred]")).toContainText("Preferred time");
  await expect(page.locator("#ffBookingBlockEditor [data-ff-block-required]")).toContainText("30 min");
  await expect(page.locator('#ffBookingBlockEditor [name="ff-block-earliest"]')).toBeVisible();
  await expect(page.locator('#ffBookingBlockEditor [name="ff-block-latest"]')).toBeVisible();

  if (ADMIN_OK) {
    await page.locator('#ffBookingBlockEditor [name="ff-block-repeat"]').selectOption("none");
    await ui.setStartMin(page, 14 * 60);
    await ui.setDuration(page, 30);
    await ui.selectReason(page, "lunch");
    await ui.setNote(page, note);
    await ui.saveEditor(page);
    const created = await waitForQaCalendarBlockByNote(note, 20000);
    CREATED_IDS.push(created.blockId);
    const card = await ui.waitForBlockCard(page, created.blockId);
    const lines = await ui.readCardLines(card);
    expect(lines.reason).toBe("Lunch Break");
    expect(lines.time).toMatch(/2:00 PM/);
    expect(lines.note).toBe(note);
    await ui.assertCardLineVisible(card, ".ff-cal-block-reason");
    await ui.assertCardLineVisible(card, ".ff-cal-block-time");
    await ui.assertCardLineVisible(card, ".ff-cal-block-note");
    await ui.assertBlockCardGeometry(card, 30);
    await expect(card).toHaveAttribute("data-ff-cal-block-flex", "flexible");
  } else {
    await page.locator('#ffBookingBlockEditor [data-ff-block-act="close"]').click();
    await page.locator("#ffBookingBlockEditor").waitFor({ state: "hidden", timeout: 10000 });
  }

  const painted = await page.evaluate(({ providerId, dateKey }) => {
    const sm = window.ffBookingBlockSeriesModel;
    const cache = window.ffBookingCalBlocks;
    if (!sm || !cache) throw new Error("series model is not loaded");
    const seriesRow = sm.normalizeSeries({
      seriesId: "qaMemSeries",
      providerId,
      locationId: "qaLoc1",
      reason: "lunch",
      preferredStartMin: 15 * 60,
      durationMinutes: 30,
      repeatFrequency: "weekdays",
      startDateKey: dateKey,
      flexibilityMode: "flexible",
      earliestStartMin: 13 * 60,
      latestEndMin: 16 * 60 + 30,
    });
    const week = [];
    const parts = String(dateKey).split("-").map(Number);
    const start = new Date(parts[0], parts[1] - 1, parts[2]);
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      week.push(key);
    }
    const occ = sm.generateOccurrences([seriesRow], week.concat([dateKey]), []);
    occ.forEach((row) => cache.upsert(row));
    cache.paint();
    return {
      count: occ.length,
      ids: occ.map((row) => row.blockId),
      days: occ.map((row) => row.dateKey),
    };
  }, { providerId: ui.FIXTURE.providerOneId, dateKey });

  expect(painted.count).toBeGreaterThan(0);
  expect(painted.ids.every((id) => String(id).indexOf("series:qaMemSeries:") === 0)).toBe(true);
  if (painted.days.indexOf(dateKey) !== -1) {
    const memCard = page.locator('#ffBookingCalendarRoot [data-ff-cal-block-series="qaMemSeries"]').first();
    await expect(memCard).toBeVisible();
    await expect(memCard.locator(".ff-cal-block-reason")).toHaveText("Lunch Break");
    await expect(memCard.locator(".ff-cal-block-time")).toContainText("3:00 PM");
  }

  await page.evaluate(() => {
    const cache = window.ffBookingCalBlocks;
    if (!cache || typeof cache.getAll !== "function") return;
    cache.getAll().forEach((row) => {
      if (row && String(row.seriesId || "") === "qaMemSeries") cache.remove(row.blockId);
    });
    cache.paint();
  });

  printDiagnostics(diag, "recurring-flex-blocks");
});
