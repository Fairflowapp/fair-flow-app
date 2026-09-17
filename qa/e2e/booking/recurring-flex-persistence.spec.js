"use strict";

/**
 * Real staging Firestore round-trip for Recurring + Flexible Time Blocks.
 * Uses this worktree's public/ with staging Auth. Writes only FF-QA data
 * inside salons/ffBookingQa and deletes it afterward.
 */
const { test, expect } = require("../../helpers/qa-test");
const { gotoStagingApp, waitForAppReady, assertStagingFirebase } = require("../../helpers/auth");
const { waitForCalendarReady } = require("../../helpers/booking");
const {
  makeRunId,
  noteFor,
  cleanupQaAppointments,
  waitForQaAppointmentByNote,
  listQaAppointments,
} = require("../../helpers/appointment-admin");
const {
  cleanupQaCalendarBlocks,
  cleanupQaCalendarSeries,
  waitForQaCalendarSeriesByNote,
  getQaCalendarSeries,
  listQaCalendarSeries,
  listQaCalendarBlocks,
  listQaExceptionsForSeries,
  waitForQaException,
  deleteCalendarSeriesByIds,
  deleteCalendarBlocksByIds,
} = require("../../helpers/calendar-block-admin");
const ui = require("../../helpers/time-block-ui");
const appt = require("../../helpers/appointment-ui");
const { attachDiagnostics, printDiagnostics } = require("../../helpers/diagnostics");
const { maybeAcquireWriteLock, maybeReleaseWriteLock } = require("../../helpers/write-lock");

const PREFERRED_START = 14 * 60;
const PREFERRED_END = 14 * 60 + 30;
const MOVED_START = 13 * 60 + 30;
const MOVED_END = 14 * 60;
const WINDOW_START = 13 * 60;
const WINDOW_END = 15 * 60 + 30;
const FIXED_START = 16 * 60;
const FIXED_END = 16 * 60 + 30;

let RUN_ID = "";
let WRITE_LOCK = null;
const CREATED_SERIES = [];
const CREATED_BLOCKS = [];
const results = {
  seriesPersistence: "FAIL",
  occurrenceGeneration: "FAIL",
  occurrenceOverride: "FAIL",
  singleOccurrenceDelete: "FAIL",
  flexibleRelocation: "FAIL",
  fixedBlockConstraint: "FAIL",
  duplicatePrevention: "FAIL",
  cardDisplay: "FAIL",
  productBug: "",
  cleanup: "FAIL",
};

function weekdayOf(dateKey) {
  const p = String(dateKey).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]).getDay();
}

function addDays(dateKey, days) {
  const p = String(dateKey).split("-").map(Number);
  const d = new Date(p[0], p[1] - 1, p[2] + Number(days || 0));
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}

function nextWeekday(dateKey) {
  let key = addDays(dateKey, 1);
  while (weekdayOf(key) === 0 || weekdayOf(key) === 6) key = addDays(key, 1);
  return key;
}

function weekdaysFrom(startKey, count) {
  const out = [];
  let key = startKey;
  for (let i = 0; i < count; i += 1) {
    if (i > 0) key = nextWeekday(key);
    out.push(key);
  }
  return out;
}

async function getDateKey(page) {
  return page.evaluate(() => {
    const st = window.ffBookingCalState;
    return st && typeof st.getSelectedDateKey === "function" ? st.getSelectedDateKey() : "";
  });
}

async function goToDateKey(page, dateKey) {
  await page.evaluate((key) => {
    const st = window.ffBookingCalState;
    if (st && typeof st.setView === "function") st.setView("day");
    if (st && typeof st.setSelectedDateKey === "function") st.setSelectedDateKey(key);
    if (typeof window.ffRefreshBookingCalendar === "function") window.ffRefreshBookingCalendar();
  }, dateKey);
  await waitForCalendarReady(page);
  await ui.waitForProviders(page);
  await expect.poll(async () => getDateKey(page), { timeout: 15000 }).toBe(dateKey);
}

async function goToFutureWeekday(page, minAhead) {
  await page.locator('#ffBookingCalendarRoot [data-ff-cal-act="today"]').click();
  await waitForCalendarReady(page);
  const n = Number(minAhead) > 0 ? Number(minAhead) : 4;
  for (let i = 0; i < n; i += 1) {
    await page.locator('#ffBookingCalendarRoot [data-ff-cal-act="next"]').click();
    await waitForCalendarReady(page);
  }
  let dateKey = await getDateKey(page);
  for (let i = 0; i < 7; i += 1) {
    const dow = weekdayOf(dateKey);
    if (dow >= 1 && dow <= 5) return dateKey;
    await page.locator('#ffBookingCalendarRoot [data-ff-cal-act="next"]').click();
    await waitForCalendarReady(page);
    dateKey = await getDateKey(page);
  }
  throw new Error("Could not reach a weekday on the Calendar.");
}

async function waitForSeriesOccurrence(page, seriesId, dateKey) {
  const blockId = "series:" + seriesId + ":" + dateKey;
  await expect.poll(async () => {
    const snap = await readPaintedSeries(page, seriesId);
    const painted = snap.painted.find((row) => row.blockId === blockId || row.dateKey === dateKey);
    const cached = snap.cache.find((row) => row.blockId === blockId || row.dateKey === dateKey);
    return painted || cached || null;
  }, { timeout: 20000 }).toBeTruthy();
  return ui.waitForBlockCard(page, blockId);
}

async function reloadCalendarOn(page, dateKey) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await assertStagingFirebase(page);
  await ui.openReadyCalendar(page);
  await goToDateKey(page, dateKey);
}

async function readyPage(page) {
  await gotoStagingApp(page);
  await waitForAppReady(page);
  await assertStagingFirebase(page);
  await ui.openReadyCalendar(page);
  const dateKey = await goToFutureWeekday(page, 4);
  await ui.waitForProviders(page);
  return dateKey;
}

async function countOccurrenceDocs(note) {
  const blocks = await listQaCalendarBlocks(RUN_ID);
  return blocks.filter((row) => {
    const text = String(row.note || row.label || "");
    return text === note || text.indexOf(note) === 0 || String(row.blockId).indexOf("series:") === 0;
  });
}

async function readPaintedSeries(page, seriesId) {
  return page.evaluate((id) => {
    const cache = window.ffBookingCalBlocks;
    const rows = cache && typeof cache.getAll === "function" ? cache.getAll() : [];
    const painted = Array.from(document.querySelectorAll(
      '#ffBookingCalendarRoot [data-ff-cal-block-series="' + id + '"]'
    )).map((el) => ({
      blockId: el.getAttribute("data-ff-cal-block") || "",
      dateKey: el.getAttribute("data-ff-cal-block-date") || "",
      startMin: Number(el.getAttribute("data-ff-cal-start")),
      endMin: Number(el.getAttribute("data-ff-cal-end")),
      reason: el.querySelector(".ff-cal-block-reason")
        ? String(el.querySelector(".ff-cal-block-reason").textContent || "").trim()
        : "",
      time: el.querySelector(".ff-cal-block-time")
        ? String(el.querySelector(".ff-cal-block-time").textContent || "").trim()
        : "",
      note: el.querySelector(".ff-cal-block-note")
        ? String(el.querySelector(".ff-cal-block-note").textContent || "").trim()
        : "",
    }));
    return {
      cache: rows.filter((row) => row && row.seriesId === id).map((row) => ({
        blockId: row.blockId,
        dateKey: row.dateKey || row.occurrenceDateKey,
        startMin: row.startMin,
        endMin: row.endMin,
        isOccurrence: !!row.isOccurrence,
      })),
      painted,
    };
  }, seriesId);
}

async function waitForWeekReady(page, providerId) {
  await page.locator("#ffBookingCalendarRoot .ff-cal.is-week").waitFor({ state: "visible", timeout: 20000 });
  await page.evaluate((id) => {
    const st = window.ffBookingCalState;
    if (!st || typeof st.setWeekProviderId !== "function") return;
    st.setWeekProviderId(id);
    if (typeof window.ffRefreshBookingCalendar === "function") window.ffRefreshBookingCalendar();
  }, providerId);
  await page.waitForFunction((id) => {
    const root = document.getElementById("ffBookingCalendarRoot");
    const st = window.ffBookingCalState;
    if (!root || !root.querySelector(".ff-cal.is-week")) return false;
    if (root.querySelector("[data-ff-cal-week-empty]")) return false;
    if (st && typeof st.getWeekProviderId === "function" && st.getWeekProviderId() !== id) return false;
    return root.querySelectorAll("[data-ff-cal-day]").length > 0;
  }, providerId, { timeout: 20000 });
}

async function openWeekView(page, providerId) {
  await page.locator('#ffBookingCalendarRoot [data-ff-cal-act="view-week"]').click();
  await waitForWeekReady(page, providerId);
}

async function openDayView(page, dateKey) {
  const dayBtn = page.locator('#ffBookingCalendarRoot [data-ff-cal-act="view-day"]');
  if (await dayBtn.count()) await dayBtn.click();
  await goToDateKey(page, dateKey);
}

async function closeBlockEditor(page) {
  const editor = page.locator("#ffBookingBlockEditor");
  if (await editor.isVisible().catch(() => false)) {
    const closeBtn = editor.locator('[data-ff-block-act="close"]');
    if (await closeBtn.count()) await closeBtn.click();
    await editor.waitFor({ state: "hidden", timeout: 10000 });
  }
}

async function tryBookQaAppointment(page, startMin, scenario) {
  const note = noteFor(RUN_ID, scenario);
  await closeBlockEditor(page);
  // Occupied preferred Time Block slots open the editor, not New Appointment.
  // Book from an empty morning slot, then set the real start time in the drawer.
  await appt.clickCalendarSlot(page, ui.FIXTURE.providerOneId, 10 * 60);
  await appt.chooseQaClient(page);
  const firstLine = appt.serviceLine(page, "#ffApptLines", 0);
  await appt.pickServiceOnLine(page, firstLine, ui.FIXTURE.serviceManiId);
  await appt.setLineStart(page, firstLine, startMin);
  await appt.setQaNote(page, note);
  await page.locator("#ffApptCreate").click();
  const closed = await page.locator("#ffBookingApptDrawer")
    .waitFor({ state: "hidden", timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) {
    const error = String(await page.locator("#ffApptError").textContent().catch(() => "") || "").trim();
    const closeBtn = page.locator('#ffBookingApptDrawer [data-ff-appt-act="close"]');
    if (await closeBtn.count()) await closeBtn.click();
    await page.locator("#ffBookingApptDrawer").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    return { ok: false, note, error };
  }
  const created = await waitForQaAppointmentByNote(note, 20000);
  return { ok: true, note, created };
}

async function createOneOffBlock(page, spec) {
  await ui.clickSlotForTimeBlock(page, spec.providerId || ui.FIXTURE.providerOneId, spec.startMin);
  await page.locator('#ffBookingBlockEditor [name="ff-block-repeat"]').selectOption("none");
  await page.locator('#ffBookingBlockEditor [data-ff-block-flex="fixed"]').click();
  await ui.setStartMin(page, spec.startMin);
  await ui.setDuration(page, spec.durationMinutes || 30);
  if (spec.reason) await ui.selectReason(page, spec.reason);
  await ui.setNote(page, spec.note);
  await ui.saveEditor(page);
  const created = await page.evaluate(({ providerId, startMin }) => {
    const el = document.querySelector(
      '#ffBookingCalendarRoot [data-ff-cal-emp="' + providerId + '"] [data-ff-cal-block][data-ff-cal-start="' + startMin + '"]'
    );
    return el ? el.getAttribute("data-ff-cal-block") : "";
  }, { providerId: spec.providerId || ui.FIXTURE.providerOneId, startMin: spec.startMin });
  if (created) CREATED_BLOCKS.push(created);
  return created;
}

async function leftovers() {
  const series = await listQaCalendarSeries(RUN_ID);
  const blocks = await listQaCalendarBlocks(RUN_ID);
  const appointments = await listQaAppointments(RUN_ID);
  let exceptions = [];
  for (const id of CREATED_SERIES) {
    exceptions = exceptions.concat(await listQaExceptionsForSeries(id));
  }
  return { series, blocks, appointments, exceptions };
}

async function cleanupRun() {
  const deleted = {
    appointments: [],
    blocks: [],
    series: [],
  };
  if (CREATED_BLOCKS.length) deleted.blocks = deleted.blocks.concat(await deleteCalendarBlocksByIds(CREATED_BLOCKS));
  if (CREATED_SERIES.length) deleted.series = deleted.series.concat(await deleteCalendarSeriesByIds(CREATED_SERIES));
  if (RUN_ID) {
    deleted.appointments = await cleanupQaAppointments(RUN_ID);
    deleted.blocks = deleted.blocks.concat(await cleanupQaCalendarBlocks(RUN_ID));
    deleted.series = deleted.series.concat(await cleanupQaCalendarSeries(RUN_ID));
  }
  return deleted;
}

test.beforeAll(async () => {
  RUN_ID = makeRunId();
  WRITE_LOCK = await maybeAcquireWriteLock({
    runId: RUN_ID,
    targetLabel: process.env.FF_QA_TARGET_LABEL || "recurring-flex-persistence",
    targetSha: process.env.FF_QA_TARGET_SHA || "f7451757dde0b54b9320d9dac584082ed9d92469",
  });
  await cleanupQaAppointments(RUN_ID);
  await cleanupQaCalendarBlocks(RUN_ID);
  await cleanupQaCalendarSeries(RUN_ID);
});

test.afterAll(async () => {
  try {
    const deleted = await cleanupRun();
    const left = await leftovers();
    const clean = !left.series.length && !left.blocks.length && !left.appointments.length && !left.exceptions.length;
    results.cleanup = clean ? "PASS" : "FAIL leftovers " + JSON.stringify(left);
    console.log("[QA] recurring-flex-persistence cleanup", JSON.stringify({
      runId: RUN_ID,
      deleted,
      leftovers: left,
      results,
    }));
  } finally {
    if (WRITE_LOCK) await maybeReleaseWriteLock(WRITE_LOCK);
  }
});

test("Recurring + Flexible Time Blocks real Firestore persistence", async ({ page }) => {
  test.setTimeout(240000);
  const diag = attachDiagnostics(page);
  page.on("dialog", (dialog) => dialog.accept());

  const lunchNote = noteFor(RUN_ID, "recurring lunch");
  const fixedNote = noteFor(RUN_ID, "recurring fixed");
  const dateA = await readyPage(page);
  const [startDate, dateB, dateC, dateD, dateE] = weekdaysFrom(dateA, 5);

  await ui.clickSlotForTimeBlock(page, ui.FIXTURE.providerOneId, PREFERRED_START);
  await expect(page.locator('#ffBookingBlockEditor [name="ff-block-repeat"]')).toBeVisible();
  await page.locator('#ffBookingBlockEditor [name="ff-block-repeat"]').selectOption("weekdays");
  await page.locator('#ffBookingBlockEditor [data-ff-block-flex="flexible"]').click();
  await ui.setStartMin(page, PREFERRED_START);
  await ui.setDuration(page, 30);
  await page.locator('#ffBookingBlockEditor [name="ff-block-earliest"]').selectOption(String(WINDOW_START));
  await page.locator('#ffBookingBlockEditor [name="ff-block-latest"]').selectOption(String(WINDOW_END));
  await ui.selectReason(page, "lunch");
  await ui.setNote(page, lunchNote);
  await expect(page.locator("#ffBookingBlockEditor [data-ff-block-preferred]")).toContainText("2:00 PM");
  await expect(page.locator("#ffBookingBlockEditor [data-ff-block-required]")).toContainText("30 min");
  await ui.saveEditor(page);

  const series = await waitForQaCalendarSeriesByNote(lunchNote, 20000);
  CREATED_SERIES.push(series.seriesId);
  const persisted = await getQaCalendarSeries(series.seriesId);
  expect(persisted, "series document must exist in calendarBlockSeries").toBeTruthy();
  expect(persisted.projectId).toBe("fair-flow-staging");
  expect(persisted.salonId).toBe("ffBookingQa");
  expect(persisted.providerId).toBe("qaProv1");
  expect(persisted.locationId).toBe("qaLoc1");
  expect(persisted.repeatFrequency).toBe("weekdays");
  expect(persisted.flexibilityMode).toBe("flexible");
  expect(persisted.preferredStartMin).toBe(PREFERRED_START);
  expect(persisted.durationMinutes).toBe(30);
  expect(persisted.requiredDurationMinutes).toBe(30);
  expect(persisted.earliestStartMin).toBe(WINDOW_START);
  expect(persisted.latestEndMin).toBe(WINDOW_END);
  expect(persisted.reason).toBe("lunch");
  expect(persisted.note).toBe(lunchNote);
  const leakedDocs = await countOccurrenceDocs(lunchNote);
  expect(leakedDocs, "series must not explode into future calendarBlocks docs").toEqual([]);
  results.seriesPersistence = "PASS";

  await waitForSeriesOccurrence(page, series.seriesId, dateA);
  await reloadCalendarOn(page, dateA);
  const reloadedCard = await waitForSeriesOccurrence(page, series.seriesId, dateA);
  const afterReload = await readPaintedSeries(page, series.seriesId);
  const dayCard = afterReload.painted.find((row) => row.dateKey === dateA)
    || afterReload.cache.find((row) => row.dateKey === dateA);
  expect(dayCard, "weekday occurrence must regenerate after reload").toBeTruthy();
  expect(dayCard.blockId).toBe("series:" + series.seriesId + ":" + dateA);
  expect(dayCard.startMin).toBe(PREFERRED_START);
  expect(Number(await reloadedCard.getAttribute("data-ff-cal-end"))).toBe(PREFERRED_END);
  expect(afterReload.cache.filter((row) => row.blockId === dayCard.blockId)).toHaveLength(1);
  expect(afterReload.painted.filter((row) => row.blockId === dayCard.blockId).length).toBeGreaterThan(0);
  results.occurrenceGeneration = "PASS";

  const card = await ui.waitForBlockCard(page, dayCard.blockId);
  let lines = await ui.readCardLines(card);
  expect(lines.reason).toBe("Lunch Break");
  expect(lines.time).toMatch(/2:00 PM/);
  expect(lines.note).toBe(lunchNote);

  await openWeekView(page, ui.FIXTURE.providerOneId);
  await expect.poll(async () => {
    const weekPainted = await readPaintedSeries(page, series.seriesId);
    const weekCard = weekPainted.painted.find((row) => row.dateKey === dateA);
    return weekCard && weekCard.startMin === PREFERRED_START && weekCard.reason === "Lunch Break"
      ? weekCard
      : null;
  }, { timeout: 20000 }).toBeTruthy();
  await openDayView(page, dateA);

  await ui.openBlockEditor(page, dayCard.blockId);
  await page.locator('#ffBookingBlockEditor [name="ff-block-scope"][value="occurrence"]').check();
  await ui.setStartMin(page, MOVED_START);
  await ui.setDuration(page, 30);
  await ui.saveEditor(page);
  const movedEx = await waitForQaException(series.seriesId, dateA, 20000);
  expect(movedEx.kind).toBe("override");
  expect(movedEx.startMin).toBe(MOVED_START);
  expect(movedEx.endMin).toBe(MOVED_END);
  const seriesAfterMove = await getQaCalendarSeries(series.seriesId);
  expect(seriesAfterMove.preferredStartMin).toBe(PREFERRED_START);
  results.occurrenceOverride = "PASS";

  await reloadCalendarOn(page, dateA);
  const movedCard = await ui.waitForBlockCard(page, "series:" + series.seriesId + ":" + dateA);
  lines = await ui.readCardLines(movedCard);
  expect(lines.reason).toBe("Lunch Break");
  expect(lines.time).toMatch(/1:30 PM/);
  expect(lines.note).toBe(lunchNote);
  expect(lines.time).not.toMatch(/2:00 PM–2:30 PM/);

  await goToDateKey(page, dateB);
  const nextCard = await ui.waitForBlockCard(page, "series:" + series.seriesId + ":" + dateB);
  const nextLines = await ui.readCardLines(nextCard);
  expect(nextLines.time).toMatch(/2:00 PM/);
  expect(nextLines.reason).toBe("Lunch Break");

  await ui.openBlockEditor(page, "series:" + series.seriesId + ":" + dateB);
  await page.locator('#ffBookingBlockEditor [name="ff-block-scope"][value="occurrence"]').check();
  await page.locator('#ffBookingBlockEditor [data-ff-block-act="delete"]').click();
  await page.locator("#ffBookingBlockEditor").waitFor({ state: "hidden", timeout: 20000 });
  const skipEx = await waitForQaException(series.seriesId, dateB, 20000);
  expect(skipEx.kind).toBe("skip");
  const seriesAfterSkip = await getQaCalendarSeries(series.seriesId);
  expect(seriesAfterSkip, "series must still exist after skipping one occurrence").toBeTruthy();
  expect(seriesAfterSkip.preferredStartMin).toBe(PREFERRED_START);
  await goToDateKey(page, dateC);
  const laterCard = await ui.waitForBlockCard(page, "series:" + series.seriesId + ":" + dateC);
  const laterLines = await ui.readCardLines(laterCard);
  expect(laterLines.time).toMatch(/2:00 PM/);
  const skippedPaint = await readPaintedSeries(page, series.seriesId);
  expect(skippedPaint.painted.some((row) => row.dateKey === dateB)).toBe(false);
  results.singleOccurrenceDelete = "PASS";

  const booked = await tryBookQaAppointment(page, PREFERRED_START, "flex conflict");
  expect(booked.ok, "appointment at preferred lunch should succeed when a valid flex slot exists: " + (booked.error || "")).toBeTruthy();
  const flexEx = await waitForQaException(series.seriesId, dateC, 20000);
  expect(flexEx.kind).toBe("override");
  expect(flexEx.endMin - flexEx.startMin).toBe(30);
  expect(flexEx.startMin).not.toBe(PREFERRED_START);
  expect(flexEx.startMin).toBeGreaterThanOrEqual(WINDOW_START);
  expect(flexEx.endMin).toBeLessThanOrEqual(WINDOW_END);
  expect(flexEx.startMin).not.toBeLessThan(WINDOW_START);
  await goToDateKey(page, dateC);
  const relocated = await ui.waitForBlockCard(page, "series:" + series.seriesId + ":" + dateC);
  const relocatedLines = await ui.readCardLines(relocated);
  expect(relocatedLines.reason).toBe("Lunch Break");
  expect(relocatedLines.note).toBe(lunchNote);
  expect(Number(await relocated.getAttribute("data-ff-cal-duration"))).toBe(30);
  expect(Number(await relocated.getAttribute("data-ff-cal-start"))).toBe(flexEx.startMin);
  expect(Number(await relocated.getAttribute("data-ff-cal-end"))).toBe(flexEx.endMin);

  await goToDateKey(page, dateD);
  await waitForSeriesOccurrence(page, series.seriesId, dateD);
  await createOneOffBlock(page, {
    startMin: WINDOW_START,
    durationMinutes: 60,
    reason: "meeting",
    note: noteFor(RUN_ID, "fill before"),
  });
  await createOneOffBlock(page, {
    startMin: PREFERRED_END,
    durationMinutes: 60,
    reason: "meeting",
    note: noteFor(RUN_ID, "fill after"),
  });
  const blocked = await tryBookQaAppointment(page, PREFERRED_START, "no slot");
  expect(blocked.ok, "appointment must not displace the required 30-minute break when no valid slot exists").toBe(false);
  const dateDEx = (await listQaExceptionsForSeries(series.seriesId)).find((row) => row.occurrenceDateKey === dateD);
  expect(dateDEx, "failed booking must not write a lunch override on the packed day").toBeFalsy();
  const stillPreferred = await ui.waitForBlockCard(page, "series:" + series.seriesId + ":" + dateD);
  expect(Number(await stillPreferred.getAttribute("data-ff-cal-start"))).toBe(PREFERRED_START);
  expect(Number(await stillPreferred.getAttribute("data-ff-cal-end"))).toBe(PREFERRED_END);
  results.flexibleRelocation = "PASS";

  await goToDateKey(page, dateE);
  await ui.clickSlotForTimeBlock(page, ui.FIXTURE.providerOneId, FIXED_START);
  await page.locator('#ffBookingBlockEditor [name="ff-block-repeat"]').selectOption("weekdays");
  await page.locator('#ffBookingBlockEditor [data-ff-block-flex="fixed"]').click();
  await ui.setStartMin(page, FIXED_START);
  await ui.setDuration(page, 30);
  await ui.selectReason(page, "meeting");
  await ui.setNote(page, fixedNote);
  await ui.saveEditor(page);
  const fixedSeries = await waitForQaCalendarSeriesByNote(fixedNote, 20000);
  CREATED_SERIES.push(fixedSeries.seriesId);
  const fixedRow = await getQaCalendarSeries(fixedSeries.seriesId);
  expect(fixedRow.flexibilityMode).toBe("fixed");
  await goToDateKey(page, dateE);
  await ui.waitForBlockCard(page, "series:" + fixedSeries.seriesId + ":" + dateE);
  const overFixed = await tryBookQaAppointment(page, FIXED_START, "fixed conflict");
  expect(overFixed.ok, "Fixed recurring block must remain a hard conflict").toBe(false);
  results.fixedBlockConstraint = "PASS";

  const counts = [];
  for (let i = 0; i < 3; i += 1) {
    await reloadCalendarOn(page, dateA);
    await waitForSeriesOccurrence(page, series.seriesId, dateA);
    const snap = await readPaintedSeries(page, series.seriesId);
    const ids = snap.painted.map((row) => row.blockId).sort();
    const unique = Array.from(new Set(ids));
    expect(unique.length, "reload must not duplicate occurrence cards").toBe(ids.length);
    expect(snap.cache.filter((row) => row.blockId === "series:" + series.seriesId + ":" + dateA)).toHaveLength(1);
    counts.push(unique.length);
  }
  expect(counts[0]).toBe(counts[1]);
  expect(counts[1]).toBe(counts[2]);
  const leftoverOccDocs = await countOccurrenceDocs(lunchNote);
  expect(leftoverOccDocs.filter((row) => String(row.blockId).indexOf("series:") === 0)).toEqual([]);
  results.duplicatePrevention = "PASS";

  const finalMoved = await ui.waitForBlockCard(page, "series:" + series.seriesId + ":" + dateA);
  const finalMovedLines = await ui.readCardLines(finalMoved);
  expect(finalMovedLines.reason).toBe("Lunch Break");
  expect(finalMovedLines.time).toMatch(/1:30 PM/);
  expect(finalMovedLines.note).toBe(lunchNote);
  await goToDateKey(page, dateC);
  const finalFlex = await ui.waitForBlockCard(page, "series:" + series.seriesId + ":" + dateC);
  const finalFlexLines = await ui.readCardLines(finalFlex);
  expect(finalFlexLines.reason).toBe("Lunch Break");
  expect(finalFlexLines.note).toBe(lunchNote);
  expect(Number(await finalFlex.getAttribute("data-ff-cal-start"))).toBe(flexEx.startMin);
  results.cardDisplay = "PASS";

  printDiagnostics(diag, "recurring-flex-persistence");
  console.log("[QA] recurring-flex-persistence results", JSON.stringify(results));
});
