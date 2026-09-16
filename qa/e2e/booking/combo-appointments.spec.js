"use strict";

/**
 * Phase 2 Combo appointment scheduling against ffBookingQa.
 * Temporary FF-QA-COMBO-APPT catalog + FF-QA appointment notes only.
 */
const { test, expect } = require("../../helpers/qa-test");
const { gotoStagingApp, waitForAppReady, assertStagingFirebase } = require("../../helpers/auth");
const {
  cleanupQaAppointments,
  getQaAppointment,
  waitForQaAppointmentByNote,
  makeRunId,
  noteFor,
} = require("../../helpers/appointment-admin");
const ui = require("../../helpers/appointment-ui");
const {
  seedQaComboAppointmentCatalog,
  cleanupQaComboServices,
} = require("../../helpers/combo-service-admin");
const { maybeAcquireWriteLock, maybeReleaseWriteLock } = require("../../helpers/write-lock");

let RUN_ID = "";
let WRITE_LOCK = null;
let COMBO = null;
const DAYS_AHEAD = 3;
const START_MIN = 11 * 60 + 30;

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
    targetLabel: process.env.FF_QA_TARGET_LABEL || "combo-appointments",
  });
  COMBO = await seedQaComboAppointmentCatalog(RUN_ID, {
    locationId: ui.FIXTURE.locationId,
    gelServiceId: ui.FIXTURE.serviceManiId,
    pediServiceId: ui.FIXTURE.servicePediId,
  });
});

test.afterAll(async () => {
  try {
    if (RUN_ID) await cleanupQaAppointments(RUN_ID);
  } catch (_) {}
  try {
    if (RUN_ID) await cleanupQaComboServices(RUN_ID);
  } catch (_) {}
  await maybeReleaseWriteLock(WRITE_LOCK);
});

test("Combo appointment expands, splits providers, and opens one visit", async ({ page }) => {
  test.setTimeout(180000);
  await readyPage(page);
  const note = noteFor(RUN_ID, "combo-split");
  await ui.clickCalendarSlot(page, ui.FIXTURE.providerOneId, START_MIN);
  await ui.chooseQaClient(page);

  const first = ui.serviceLine(page, "#ffApptLines", 0);
  await first.locator('[data-ff-appt-act="open-service-picker"]').click();
  const search = page.locator("[data-ff-service-q]");
  await search.waitFor({ state: "visible", timeout: 10000 });
  await search.fill(COMBO.name);
  const pick = page.locator('[data-ff-appt-act="pick-service"][data-ff-service="' + COMBO.comboId + '"]');
  await pick.waitFor({ state: "visible", timeout: 15000 });
  await pick.click();

  await expect(page.locator("#ffApptLines .ff-appt-combo")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#ffApptLines .ff-appt-svc.is-combo-component")).toHaveCount(2);

  const gelLine = page.locator("#ffApptLines .ff-appt-svc.is-combo-component").nth(0);
  const pediLine = page.locator("#ffApptLines .ff-appt-svc.is-combo-component").nth(1);
  await ui.pickProviderOnLine(page, pediLine, ui.FIXTURE.providerTwoId);
  await ui.setLineStart(page, pediLine, START_MIN);
  await ui.setQaNote(page, note);
  await ui.bookAppointment(page);

  const created = await waitForQaAppointmentByNote(note, 25000);
  expect(created.serviceLines.length).toBe(2);
  expect(created.serviceLines.every((line) => line.serviceId !== COMBO.comboId)).toBeTruthy();
  const stored = await getQaAppointment(created.appointmentId);
  const lines = stored.serviceLines || created.serviceLines;
  expect(lines.length).toBe(2);
  expect(new Set(lines.map((line) => line.providerId)).size).toBe(2);
  const allocated = lines.reduce((sum, line) => sum + Number(line.priceSnapshot || 0), 0);
  expect(Math.round(allocated * 100)).toBe(8400);

  const cards = page.locator('#ffBookingCalendarRoot [data-ff-cal-card="' + created.appointmentId + '"]');
  await expect(cards).toHaveCount(2, { timeout: 20000 });

  await cards.nth(0).click();
  await page.locator("#ffBookingApptDetails").waitFor({ state: "visible", timeout: 15000 });
  const firstId = await page.evaluate(() => window.ffBookingAppointmentDetails.getCurrentId());
  await expect(page.locator("#ffApdServices")).toContainText(/COMBO/i);
  await expect(page.locator("#ffApdTotal")).toContainText("84");

  await page.locator('#ffBookingApptDetails [data-ff-apd-act="close"]').first().click();
  await cards.nth(1).click();
  await page.locator("#ffBookingApptDetails").waitFor({ state: "visible", timeout: 15000 });
  const secondId = await page.evaluate(() => window.ffBookingAppointmentDetails.getCurrentId());
  expect(firstId).toBe(created.appointmentId);
  expect(secondId).toBe(created.appointmentId);

  await ui.enterEdit(page);
  const editPedi = page.locator("#ffApdLines .ff-appt-svc.is-combo-component").nth(1);
  await ui.pickProviderOnLine(page, editPedi, ui.FIXTURE.providerOneId);
  await page.locator("#ffApdSave").click();
  await page.locator("#ffApdEdit").waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  const afterEdit = await getQaAppointment(created.appointmentId);
  expect((afterEdit.serviceLines || []).length).toBe(2);
  expect((afterEdit.serviceLines || []).every((line) => line.comboInstanceId || line.comboServiceId)).toBeTruthy();
});
