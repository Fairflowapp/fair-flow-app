"use strict";

/**
 * Real-browser Time Block polish against ffBookingQa.
 * Creates only temporary QA Time Blocks and deletes them afterward.
 */
const { test, expect } = require("../../helpers/qa-test");
const { gotoStagingApp, waitForAppReady, assertStagingFirebase } = require("../../helpers/auth");
const { makeRunId, noteFor } = require("../../helpers/appointment-admin");
const {
  cleanupQaCalendarBlocks,
  cleanupQaCalendarBlocksForDay,
  deleteCalendarBlocksByIds,
  waitForQaCalendarBlockByNote,
  getQaCalendarBlock,
} = require("../../helpers/calendar-block-admin");
const ui = require("../../helpers/time-block-ui");
const { attachDiagnostics, printDiagnostics } = require("../../helpers/diagnostics");
const { maybeAcquireWriteLock, maybeReleaseWriteLock } = require("../../helpers/write-lock");

let RUN_ID = "";
let WRITE_LOCK = null;
let DATE_KEY = "";
const CREATED_IDS = [];
const DAYS_AHEAD = 3;
const SLOT = {
  other: 11 * 60,
  lunch: 12 * 60,
  meeting: 13 * 60 + 30,
  personal: 15 * 60,
  meetingMoved: 14 * 60,
};

async function readyPage(page) {
  await gotoStagingApp(page);
  await waitForAppReady(page);
  await assertStagingFirebase(page);
  await ui.openReadyCalendar(page);
  const dateKey = await ui.goToFutureDay(page, DAYS_AHEAD);
  await ui.waitForProviders(page);
  return dateKey;
}

async function createBlock(page, spec) {
  await ui.clickSlotForTimeBlock(page, spec.providerId || ui.FIXTURE.providerOneId, spec.startMin);
  await ui.assertNoBlockTimeCopy(page, "#ffBookingBlockEditor");
  await expect(page.locator('#ffBookingBlockEditor [data-ff-block-act="save"]')).toHaveText("Time Block");
  if (spec.reason) await ui.selectReason(page, spec.reason);
  if (spec.startMin != null) await ui.setStartMin(page, spec.startMin);
  if (spec.durationMinutes) await ui.setDuration(page, spec.durationMinutes);
  if (spec.note) await ui.setNote(page, spec.note);
  else await ui.setNote(page, "");
  await ui.saveEditor(page);
  const providerId = spec.providerId || ui.FIXTURE.providerOneId;
  const painted = await ui.waitForBlockCardAt(page, providerId, spec.startMin);
  let created;
  if (spec.note) {
    created = await waitForQaCalendarBlockByNote(spec.note, 20000);
    expect(await painted.getAttribute("data-ff-cal-block")).toBe(created.blockId);
  } else {
    const started = Date.now();
    while (Date.now() - started < 20000) {
      const blockId = await page.evaluate(({ providerId, startMin }) => {
        const col = document.querySelector('#ffBookingCalendarRoot [data-ff-cal-emp="' + providerId + '"]');
        const el = col && col.querySelector('[data-ff-cal-block][data-ff-cal-start="' + startMin + '"]');
        return el ? el.getAttribute("data-ff-cal-block") : "";
      }, { providerId, startMin: spec.startMin });
      if (blockId) {
        created = await getQaCalendarBlock(blockId);
        if (created) break;
      }
      await page.waitForTimeout(400);
    }
    if (!created) throw new Error("Time Block did not persist at " + spec.startMin);
  }
  CREATED_IDS.push(created.blockId);
  return created;
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
  let deletedById = [];
  let deletedByRun = [];
  try {
    if (CREATED_IDS.length) deletedById = await deleteCalendarBlocksByIds(CREATED_IDS);
    if (DATE_KEY) deletedById = deletedById.concat(await cleanupQaCalendarBlocksForDay(DATE_KEY));
    if (RUN_ID) deletedByRun = await cleanupQaCalendarBlocks(RUN_ID);
  } finally {
    await maybeReleaseWriteLock(WRITE_LOCK);
  }
  console.log("[QA] time-block-polish cleanup", JSON.stringify({
    runId: RUN_ID,
    created: CREATED_IDS,
    deletedById,
    deletedByRun,
  }));
});

test("Time Block polish real UI", async ({ page }) => {
  test.setTimeout(180000);
  const diag = attachDiagnostics(page);
  const dateKey = await readyPage(page);
  DATE_KEY = dateKey;
  const stale = await cleanupQaCalendarBlocksForDay(dateKey);
  if (stale.length) console.log("[QA] cleared leftover QA Time Blocks on", dateKey, stale);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await ui.openReadyCalendar(page);
  await ui.goToFutureDay(page, DAYS_AHEAD);
  await ui.waitForProviders(page);
  const meetingNote = noteFor(RUN_ID, "Staff meeting");
  const personalNote = noteFor(RUN_ID, "Doctor appointment");
  const otherNote = noteFor(RUN_ID, "Inventory delivery");

  await ui.assertNoBlockTimeCopy(page, "#ffBookingCalProviderMenu", {
    reopenProviderId: ui.FIXTURE.providerOneId,
  });
  await page.keyboard.press("Escape");

  const other = await createBlock(page, {
    startMin: SLOT.other,
    durationMinutes: 30,
    reason: "other",
    note: otherNote,
  });
  const lunch = await createBlock(page, {
    startMin: SLOT.lunch,
    durationMinutes: 30,
    reason: "lunch",
  });
  const meeting = await createBlock(page, {
    startMin: SLOT.meeting,
    durationMinutes: 30,
    reason: "meeting",
    note: meetingNote,
  });
  const personal = await createBlock(page, {
    startMin: SLOT.personal,
    durationMinutes: 60,
    reason: "personal",
    note: personalNote,
  });

  expect(other.reason).toBe("other");
  expect(lunch.reason).toBe("lunch");
  expect(meeting.reason).toBe("meeting");
  expect(personal.reason).toBe("personal");
  expect(meeting.startMin).toBe(SLOT.meeting);
  expect(meeting.endMin).toBe(SLOT.meeting + 30);
  expect(personal.endMin).toBe(SLOT.personal + 60);

  const meetingCard = await ui.waitForBlockCard(page, meeting.blockId);
  const meetingLines = await ui.readCardLines(meetingCard);
  expect(meetingLines.reason).toBe("Meeting");
  expect(meetingLines.time).toBe("1:30 PM – 2:00 PM");
  expect(meetingLines.note).toContain("Staff meeting");
  expect(meetingLines.hasNoteLine).toBe(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await ui.openReadyCalendar(page);
  await ui.goToFutureDay(page, DAYS_AHEAD);
  await ui.waitForProviders(page);
  const meetingAfterReload = await ui.waitForBlockCard(page, meeting.blockId);
  const reloadLines = await ui.readCardLines(meetingAfterReload);
  expect(reloadLines.reason).toBe("Meeting");
  expect(reloadLines.time).toBe("1:30 PM – 2:00 PM");
  expect(reloadLines.note).toContain("Staff meeting");

  const personalCard = await ui.waitForBlockCard(page, personal.blockId);
  const personalLines = await ui.readCardLines(personalCard);
  expect(personalLines.reason).toBe("Personal");
  expect(personalLines.time).toBe("3:00 PM – 4:00 PM");
  expect(personalLines.note).toContain("Doctor appointment");

  const otherCard = await ui.waitForBlockCard(page, other.blockId);
  const otherLines = await ui.readCardLines(otherCard);
  expect(otherLines.reason).toBe("Other");
  expect(otherLines.time).toBe("11:00 AM – 11:30 AM");
  expect(otherLines.note).toContain("Inventory delivery");

  const lunchCard = await ui.waitForBlockCard(page, lunch.blockId);
  const lunchLines = await ui.readCardLines(lunchCard);
  expect(lunchLines.reason).toBe("Lunch Break");
  expect(lunchLines.time).toBe("12:00 PM – 12:30 PM");
  expect(lunchLines.hasNoteLine).toBe(false);
  expect(lunchLines.note).toBe("");
  await ui.assertCardLineVisible(lunchCard, ".ff-cal-block-reason");
  await ui.assertCardLineVisible(lunchCard, ".ff-cal-block-time");
  await ui.assertCardLineVisible(meetingAfterReload, ".ff-cal-block-reason");
  await ui.assertCardLineVisible(meetingAfterReload, ".ff-cal-block-time");
  await ui.assertCardLineVisible(meetingAfterReload, ".ff-cal-block-note");
  await ui.assertCardLineVisible(personalCard, ".ff-cal-block-reason");
  await ui.assertCardLineVisible(personalCard, ".ff-cal-block-time");
  await ui.assertCardLineVisible(personalCard, ".ff-cal-block-note");

  await expect(meetingAfterReload).not.toHaveClass(/ff-cal-card/);
  const appointmentCards = page.locator("#ffBookingCalendarRoot [data-ff-cal-card]");
  const appointmentCount = await appointmentCards.count();
  for (let i = 0; i < appointmentCount; i += 1) {
    const card = appointmentCards.nth(i);
    await expect(card).toHaveAttribute("data-ff-cal-card", /.+/);
    await expect(card.locator(".ff-cal-block-reason")).toHaveCount(0);
  }

  await ui.openBlockEditor(page, meeting.blockId);
  await ui.assertNoBlockTimeCopy(page, "#ffBookingBlockEditor");
  const opened = await ui.readEditorFacts(page);
  expect(opened.title).toBe("Time Block");
  expect(opened.facts).toMatch(/Provider:/);
  expect(opened.facts).toMatch(/Date:/);
  expect(opened.facts).toMatch(/Time:\s*1:30 PM – 2:00 PM/);
  expect(opened.reason).toBe("meeting");
  expect(opened.note).toBe(meetingNote);
  expect(opened.startMin).toBe(SLOT.meeting);
  expect(opened.duration).toBe(30);
  await ui.saveEditor(page);
  const savedSame = await getQaCalendarBlock(meeting.blockId);
  expect(savedSame.startMin).toBe(meeting.startMin);
  expect(savedSame.endMin).toBe(meeting.endMin);
  expect(savedSame.reason).toBe("meeting");
  expect(savedSame.note).toBe(meetingNote);

  await ui.openBlockEditor(page, meeting.blockId);
  await ui.selectReason(page, "training");
  await ui.saveEditor(page);
  const reasonOnly = await getQaCalendarBlock(meeting.blockId);
  expect(reasonOnly.reason).toBe("training");
  expect(reasonOnly.startMin).toBe(meeting.startMin);
  expect(reasonOnly.endMin).toBe(meeting.endMin);
  expect(reasonOnly.note).toBe(meetingNote);
  const trainingCard = await ui.waitForBlockCard(page, meeting.blockId);
  expect((await ui.readCardLines(trainingCard)).reason).toBe("Training");

  await ui.openBlockEditor(page, meeting.blockId);
  await ui.selectReason(page, "meeting");
  const noteOnlyValue = meetingNote + " stay";
  await ui.setNote(page, noteOnlyValue);
  await ui.saveEditor(page);
  const noteOnly = await getQaCalendarBlock(meeting.blockId);
  expect(noteOnly.note).toBe(noteOnlyValue);
  expect(noteOnly.reason).toBe("meeting");
  expect(noteOnly.startMin).toBe(meeting.startMin);
  expect(noteOnly.endMin).toBe(meeting.endMin);

  await ui.dragBlockByMinutes(page, meeting.blockId, 30);
  await ui.expectNoProviderMoveConfirm(page);
  await expect(page.locator(
    '#ffBookingCalendarRoot [data-ff-cal-emp="' + ui.FIXTURE.providerOneId + '"] [data-ff-cal-block="' + meeting.blockId + '"]'
  )).toBeVisible();
  const sameProvider = await getQaCalendarBlock(meeting.blockId);
  expect(sameProvider.providerId).toBe(ui.FIXTURE.providerOneId);
  expect(sameProvider.reason).toBe("meeting");
  expect(sameProvider.note).toBe(noteOnlyValue);
  expect(sameProvider.startMin).toBe(SLOT.meetingMoved);
  expect(sameProvider.endMin).toBe(SLOT.meetingMoved + 30);

  await ui.dragBlockToProvider(page, personal.blockId, ui.FIXTURE.providerTwoId, SLOT.personal);
  const dialog = page.locator("#ffCalMoveConfirm");
  await dialog.waitFor({ state: "visible", timeout: 15000 });
  await expect(page.locator("#ffCalMoveTitle")).toHaveText("Move Time Block?");
  const copy = await page.locator("#ffCalMoveCopy").innerText();
  expect(copy).toMatch(/QA Provider One/);
  expect(copy).toMatch(/QA Provider Two/);
  expect(copy).not.toMatch(/Block Time/);
  await page.locator('#ffCalMoveConfirm [data-ff-cal-move="no"]').click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
  const afterCancel = await getQaCalendarBlock(personal.blockId);
  expect(afterCancel.providerId).toBe(ui.FIXTURE.providerOneId);
  expect(afterCancel.reason).toBe("personal");
  expect(afterCancel.note).toBe(personalNote);
  expect(afterCancel.startMin).toBe(SLOT.personal);
  expect(afterCancel.endMin).toBe(SLOT.personal + 60);

  await ui.dragBlockToProvider(page, personal.blockId, ui.FIXTURE.providerTwoId, SLOT.personal);
  await ui.confirmMove(page, true);
  await expect(page.locator(
    '#ffBookingCalendarRoot [data-ff-cal-emp="' + ui.FIXTURE.providerTwoId + '"] [data-ff-cal-block="' + personal.blockId + '"]'
  )).toBeVisible({ timeout: 20000 });
  const afterMove = await getQaCalendarBlock(personal.blockId);
  expect(afterMove.providerId).toBe(ui.FIXTURE.providerTwoId);
  expect(afterMove.reason).toBe("personal");
  expect(afterMove.note).toBe(personalNote);
  expect(afterMove.startMin).toBe(SLOT.personal);
  expect(afterMove.endMin).toBe(SLOT.personal + 60);

  await ui.openBlockEditor(page, personal.blockId);
  const movedOpen = await ui.readEditorFacts(page);
  expect(movedOpen.title).toBe("Time Block");
  expect(movedOpen.reason).toBe("personal");
  expect(movedOpen.note).toBe(personalNote);
  expect(movedOpen.startMin).toBe(SLOT.personal);
  expect(movedOpen.duration).toBe(60);
  expect(movedOpen.facts).toMatch(/Time:\s*3:00 PM – 4:00 PM/);
  await page.locator('#ffBookingBlockEditor [data-ff-block-act="close"]').click();

  const bodyHasBlockTime = await page.evaluate(() => {
    const root = document.getElementById("ffBookingCalendarRoot");
    return !!(root && /Block Time/.test(root.innerText || ""));
  });
  expect(bodyHasBlockTime).toBe(false);

  expect(diag.pageErrors, "uncaught page errors").toEqual([]);
  const featureConsole = (diag.consoleErrors || []).filter((msg) => /Time Block|Block Time|ff-cal-block|calendarBlocks/i.test(String(msg)));
  expect(featureConsole, "Time Block console errors").toEqual([]);
  printDiagnostics(diag, "time-block-polish");
  void dateKey;
});
