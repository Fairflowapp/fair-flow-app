"use strict";

/**
 * Focused Time Block Calendar polish against the isolated ffBookingQa salon.
 * Creates only QA-owned temporary Time Blocks and deletes them afterward.
 */
const { test, expect } = require("../../helpers/qa-test");
const { gotoStagingApp, waitForAppReady, assertStagingFirebase } = require("../../helpers/auth");
const { makeRunId, noteFor } = require("../../helpers/appointment-admin");
const {
  cleanupQaCalendarBlocks,
  waitForQaCalendarBlockByNote,
  getQaCalendarBlock,
} = require("../../helpers/calendar-block-admin");
const ui = require("../../helpers/time-block-ui");
const { attachDiagnostics, printDiagnostics } = require("../../helpers/diagnostics");
const { maybeAcquireWriteLock, maybeReleaseWriteLock } = require("../../helpers/write-lock");

let RUN_ID = "";
let WRITE_LOCK = null;
const DAYS_AHEAD = 3;
const START_MIN = 14 * 60;

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
  WRITE_LOCK = await maybeAcquireWriteLock({
    runId: RUN_ID,
    targetLabel: process.env.FF_QA_TARGET_LABEL || "time-block",
    targetSha: process.env.FF_QA_TARGET_SHA || "",
  });
  await cleanupQaCalendarBlocks(RUN_ID);
});

test.afterAll(async () => {
  let deleted = [];
  try {
    if (RUN_ID) deleted = await cleanupQaCalendarBlocks(RUN_ID);
  } finally {
    await maybeReleaseWriteLock(WRITE_LOCK);
  }
  console.log("[QA] time-block-polish cleanup", JSON.stringify({
    runId: RUN_ID,
    deleted: deleted.length,
  }));
});

test("Time Block card, editor, and cross-provider confirm", async ({ page }) => {
  test.setTimeout(150000);
  const diag = attachDiagnostics(page);
  const dateKey = await readyPage(page);
  const note = noteFor(RUN_ID, "personal-doctor");

  await ui.clickSlotForTimeBlock(page, ui.FIXTURE.providerOneId, START_MIN);
  await ui.selectReason(page, "personal");
  await ui.setNote(page, note);
  await ui.saveEditor(page);

  const created = await waitForQaCalendarBlockByNote(note, 20000);
  expect(created.salonId).toBe(ui.FIXTURE.salonId);
  expect(created.locationId).toBe(ui.FIXTURE.locationId);
  expect(created.providerId).toBe(ui.FIXTURE.providerOneId);
  expect(created.dateKey).toBe(dateKey);
  expect(created.reason).toBe("personal");
  expect(created.note).toBe(note);
  expect(created.endMin - created.startMin).toBe(30);

  const card = await ui.waitForBlockCard(page, created.blockId);
  await expect(card.locator(".ff-cal-block-reason")).toHaveText("Personal");
  await expect(card.locator(".ff-cal-block-time")).toHaveText("2:00 PM – 2:30 PM");
  await expect(card.locator(".ff-cal-block-note")).toHaveText(note);
  await expect(page.locator('#ffBookingCalendarRoot [data-ff-cal-card]')).toHaveCount(0);

  await ui.openBlockEditor(page, created.blockId);
  const facts = await ui.readEditorFacts(page);
  expect(facts.title).toBe("Time Block");
  expect(facts.facts).toMatch(/Provider:/);
  expect(facts.facts).toMatch(/Date:/);
  expect(facts.facts).toMatch(/Time:\s*2:00 PM – 2:30 PM/);
  expect(facts.reason).toBe("personal");
  expect(facts.note).toBe(note);
  expect(facts.startMin).toBe(START_MIN);
  expect(facts.duration).toBe(30);
  await ui.saveEditor(page);

  const unchanged = await getQaCalendarBlock(created.blockId);
  expect(unchanged.startMin).toBe(created.startMin);
  expect(unchanged.endMin).toBe(created.endMin);
  expect(unchanged.reason).toBe("personal");

  await ui.openBlockEditor(page, created.blockId);
  await ui.setNote(page, note + " stay");
  await ui.saveEditor(page);
  const noteOnly = await getQaCalendarBlock(created.blockId);
  expect(noteOnly.note).toBe(note + " stay");
  expect(noteOnly.startMin).toBe(created.startMin);
  expect(noteOnly.endMin).toBe(created.endMin);

  await ui.dragBlockToProvider(page, created.blockId, ui.FIXTURE.providerTwoId, START_MIN);
  await ui.confirmMove(page, false);
  const afterCancel = await getQaCalendarBlock(created.blockId);
  expect(afterCancel.providerId).toBe(ui.FIXTURE.providerOneId);
  expect(afterCancel.reason).toBe("personal");
  expect(afterCancel.note).toBe(note + " stay");
  expect(afterCancel.endMin - afterCancel.startMin).toBe(30);
  await expect(page.locator(
    '#ffBookingCalendarRoot [data-ff-cal-emp="' + ui.FIXTURE.providerOneId + '"] [data-ff-cal-block="' + created.blockId + '"]'
  )).toBeVisible();

  await ui.dragBlockToProvider(page, created.blockId, ui.FIXTURE.providerTwoId, START_MIN);
  await ui.confirmMove(page, true);
  await expect(page.locator(
    '#ffBookingCalendarRoot [data-ff-cal-emp="' + ui.FIXTURE.providerTwoId + '"] [data-ff-cal-block="' + created.blockId + '"]'
  )).toBeVisible({ timeout: 20000 });
  const afterMove = await getQaCalendarBlock(created.blockId);
  expect(afterMove.providerId).toBe(ui.FIXTURE.providerTwoId);
  expect(afterMove.reason).toBe("personal");
  expect(afterMove.note).toBe(note + " stay");
  expect(afterMove.startMin).toBe(created.startMin);
  expect(afterMove.endMin).toBe(created.endMin);

  printDiagnostics(diag, "time-block-polish");
});
