"use strict";

/**
 * Phase 2 Combo appointment scheduling against ffBookingQa.
 * Temporary FF-QA-COMBO-APPT catalog + FF-QA appointment notes only.
 */
const { test, expect } = require("../../helpers/qa-test");
const { gotoStagingApp, waitForAppReady, assertStagingFirebase } = require("../../helpers/auth");
const { attachDiagnostics } = require("../../helpers/diagnostics");
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
const DAYS_AHEAD = 4;
const START_MIN = 11 * 60 + 30;
const SAME_PROVIDER_MIN = 13 * 60;
const SINGLE_MIN = 15 * 60;
const MULTI_MIN = 16 * 60;
const PROVIDER_A = ui.FIXTURE.providerOneId;
const PROVIDER_B = ui.FIXTURE.providerTwoId;

async function readyPage(page) {
  await gotoStagingApp(page);
  await waitForAppReady(page);
  await assertStagingFirebase(page);
  await ui.openReadyCalendar(page);
  const dateKey = await ui.goToFutureDay(page, DAYS_AHEAD);
  await ui.waitForProviders(page);
  return dateKey;
}

async function pickCatalogService(page, lineLocator, serviceId, searchName) {
  const searchInLine = lineLocator.locator("[data-ff-service-q]");
  if (!(await searchInLine.count())) {
    await lineLocator.locator('[data-ff-appt-act="open-service-picker"]').click();
  }
  const search = page.locator("[data-ff-service-q]");
  await search.waitFor({ state: "visible", timeout: 10000 });
  await search.fill(searchName);
  const pick = page.locator('[data-ff-appt-act="pick-service"][data-ff-service="' + serviceId + '"]');
  await pick.waitFor({ state: "visible", timeout: 15000 });
  await pick.click();
}

async function openProviderPicker(page, lineLocator) {
  const chip = lineLocator.locator('[data-ff-appt-act="open-provider-picker"]');
  await chip.scrollIntoViewIfNeeded();
  const box = await chip.boundingBox();
  if (!box) throw new Error("provider chip has no box");
  await page.mouse.click(box.x + Math.min(20, box.width / 2), box.y + box.height - 4);
  const picker = page.locator('[data-ff-picker="provider"]');
  await picker.waitFor({ state: "visible", timeout: 10000 });
  await expect(picker.locator('[data-ff-appt-act="pick-provider"]').first()).toBeAttached();
}

async function closeProviderPicker(page) {
  const picker = page.locator('[data-ff-picker="provider"]');
  if (!(await picker.count())) return;
  await page.locator("#ffApptTitle, #ffApdTitle").first().click();
  await expect(picker).toHaveCount(0);
}

async function providerPickerIds(page, lineLocator) {
  await openProviderPicker(page, lineLocator);
  const ids = await page.locator('[data-ff-appt-act="pick-provider"]').evaluateAll((els) => {
    return els.map((el) => String(el.getAttribute("data-ff-provider") || "")).filter(Boolean);
  });
  await expect(lineLocator.locator('[data-ff-appt-act="open-provider-picker"]')).toBeAttached();
  await closeProviderPicker(page);
  await expect(lineLocator.locator('[data-ff-appt-act="open-provider-picker"]')).toBeVisible();
  return ids;
}

function comboLines(page, rootSel) {
  return page.locator(rootSel + " .ff-appt-svc.is-combo-component");
}

async function readLineClock(lineLocator) {
  const start = String(await lineLocator.locator(".ff-appt-strip-value").textContent() || "").trim();
  const end = String(await lineLocator.locator(".ff-appt-strip-end").textContent() || "").trim();
  const startValue = await lineLocator.locator('[data-ff-line-field="start"]').inputValue();
  return { start: start, end: end, startMin: Number(startValue) };
}

function allocatedSum(lines) {
  return (lines || []).reduce((sum, line) => sum + Number(line.priceSnapshot || 0), 0);
}

test.beforeAll(async () => {
  RUN_ID = makeRunId();
  WRITE_LOCK = await maybeAcquireWriteLock({
    runId: RUN_ID,
    targetLabel: process.env.FF_QA_TARGET_LABEL || "combo-appointments",
  });
  COMBO = await seedQaComboAppointmentCatalog(RUN_ID, {
    locationId: ui.FIXTURE.locationId,
    blockedProviderId: PROVIDER_B,
  });
});

test.afterAll(async () => {
  const cleanup = { appointments: [], services: [] };
  try {
    if (RUN_ID) cleanup.appointments = await cleanupQaAppointments(RUN_ID);
  } catch (err) {
    console.log("[QA] appointment cleanup error", err && err.message);
  }
  try {
    if (RUN_ID) cleanup.services = await cleanupQaComboServices(RUN_ID);
  } catch (err) {
    console.log("[QA] combo catalog cleanup error", err && err.message);
  }
  await maybeReleaseWriteLock(WRITE_LOCK);
  console.log("[QA] combo-appointments cleanup", JSON.stringify({
    runId: RUN_ID,
    appointments: (cleanup.appointments || []).length,
    services: (cleanup.services || []).length,
  }));
});

test("Combo expands, splits providers, and stays one visit", async ({ page }) => {
  test.setTimeout(180000);
  const diag = attachDiagnostics(page);
  await readyPage(page);
  const note = noteFor(RUN_ID, "combo-split");
  await ui.clickCalendarSlot(page, PROVIDER_A, START_MIN);
  await ui.chooseQaClient(page);

  const first = ui.serviceLine(page, "#ffApptLines", 0);
  await pickCatalogService(page, first, COMBO.comboId, COMBO.name);

  await expect(page.locator("#ffApptLines .ff-appt-combo")).toHaveCount(1);
  await expect(page.locator("#ffApptLines .ff-appt-combo")).toContainText(COMBO.name);
  await expect(page.locator("#ffApptLines .ff-appt-combo")).toContainText(/Combo/i);
  await expect(page.locator("#ffApptLines .ff-appt-combo-price")).toContainText("84");
  await expect(comboLines(page, "#ffApptLines")).toHaveCount(2);

  const gelLine = comboLines(page, "#ffApptLines").nth(0);
  const pediLine = comboLines(page, "#ffApptLines").nth(1);
  await expect(gelLine).toContainText(COMBO.gelName);
  await expect(pediLine).toContainText(COMBO.pediName);
  await expect(gelLine).not.toContainText(/^Service$/);
  await expect(pediLine).not.toContainText(/^Service$/);
  await expect(gelLine.locator(".ff-appt-card-price")).toContainText("44");
  await expect(pediLine.locator(".ff-appt-card-price")).toContainText("40");

  const ssContract = await page.evaluate(() => {
    const comboApi = window.ffBookingAppointmentCombo;
    const drawer = window.ffBookingAppointmentDrawer;
    const state = drawer && typeof drawer.getState === "function" ? drawer.getState() : null;
    const providers = window.ffBookingCalState && typeof window.ffBookingCalState.getEmployees === "function"
      ? window.ffBookingCalState.getEmployees()
      : [];
    if (!comboApi || !state) return [];
    return comboApi.smartSchedulingRequestLines(state.lines, { providers: providers });
  });
  expect(ssContract.length).toBe(2);
  expect(ssContract.map((row) => row.serviceId).sort()).toEqual([COMBO.gelId, COMBO.pediId].sort());
  expect(ssContract.every((row) => row.serviceId !== COMBO.comboId)).toBeTruthy();
  expect(ssContract.map((row) => row.serviceName).sort()).toEqual([COMBO.gelName, COMBO.pediName].sort());
  expect(ssContract.every((row) => row.serviceName && row.serviceName !== "Service")).toBeTruthy();
  expect(ssContract.map((row) => Number(row.durationMinutes)).sort((a, b) => a - b)).toEqual([30, 45]);
  expect(ssContract.every((row) => Array.isArray(row.eligibleProviderIds) && row.eligibleProviderIds.length > 0)).toBeTruthy();
  const ssGel = ssContract.find((row) => row.serviceId === COMBO.gelId);
  const ssPedi = ssContract.find((row) => row.serviceId === COMBO.pediId);
  expect(ssGel.eligibleProviderIds).toContain(PROVIDER_A);
  expect(ssGel.eligibleProviderIds).not.toContain(PROVIDER_B);
  expect(ssPedi.eligibleProviderIds).toContain(PROVIDER_A);
  expect(ssPedi.eligibleProviderIds).toContain(PROVIDER_B);

  const gelClock = await readLineClock(gelLine);
  const pediClock = await readLineClock(pediLine);
  expect(gelClock.startMin).toBe(START_MIN);
  expect(gelClock.start).toMatch(/11:30/);
  expect(gelClock.end).toMatch(/12:15/);
  expect(pediClock.startMin).toBe(START_MIN + 45);
  expect(pediClock.start).toMatch(/12:15/);
  expect(pediClock.end).toMatch(/12:45/);

  const gelProviders = await providerPickerIds(page, gelLine);
  const pediProviders = await providerPickerIds(page, pediLine);
  expect(gelProviders).toContain(PROVIDER_A);
  expect(gelProviders).not.toContain(PROVIDER_B);
  expect(pediProviders).toContain(PROVIDER_A);
  expect(pediProviders).toContain(PROVIDER_B);

  await ui.setLineStart(page, pediLine, START_MIN);
  await expect(page.locator("#ffApptLines .ff-appt-error").first()).toBeVisible();
  await expect(page.locator("#ffApptLines .ff-appt-error").first()).toContainText(/cannot serve two guests/i);
  await expect(page.locator("#ffApptCreate")).toBeDisabled();

  await ui.setLineStart(page, pediLine, START_MIN + 45);
  await ui.pickProviderOnLine(page, pediLine, PROVIDER_B);
  await expect(pediLine.locator('[data-ff-appt-act="open-provider-picker"]')).toBeVisible();
  await expect(gelLine.locator('[data-ff-appt-act="open-provider-picker"]')).toBeVisible();
  await expect(page.locator('#ffApptLines [data-ff-picker="provider"]')).toHaveCount(0);
  const splitState = await page.evaluate(() => {
    const drawer = window.ffBookingAppointmentDrawer;
    const state = drawer && typeof drawer.getState === "function" ? drawer.getState() : null;
    return ((state && state.lines) || []).filter((line) => line && line.comboInstanceId).map((line) => ({
      serviceId: String(line.serviceId || ""),
      serviceName: String((line.service && line.service.name) || line.originalServiceName || ""),
      providerId: String(line.providerId || ""),
      price: Number(line.price),
      durationMinutes: Number(line.durationMinutes),
      startMin: Number(line.startMin)
    }));
  });
  expect(splitState.length).toBe(2);
  expect(splitState[0].providerId).toBe(PROVIDER_A);
  expect(splitState[1].providerId).toBe(PROVIDER_B);
  expect(splitState[0].serviceId).toBe(COMBO.gelId);
  expect(splitState[1].serviceId).toBe(COMBO.pediId);
  expect(splitState[0].serviceName).toBe(COMBO.gelName);
  expect(splitState[1].serviceName).toBe(COMBO.pediName);
  expect(splitState[0].price).toBe(44);
  expect(splitState[1].price).toBe(40);
  expect(splitState[0].durationMinutes).toBe(45);
  expect(splitState[1].durationMinutes).toBe(30);
  await expect(gelLine).toContainText(COMBO.gelName);
  await expect(pediLine).toContainText(COMBO.pediName);
  await expect(gelLine.locator(".ff-appt-card-price")).toContainText("44");
  await expect(pediLine.locator(".ff-appt-card-price")).toContainText("40");
  await ui.setLineStart(page, pediLine, START_MIN);
  await expect(page.locator("#ffApptCreate")).toBeEnabled();

  await ui.setQaNote(page, note);
  await ui.bookAppointment(page);

  const created = await waitForQaAppointmentByNote(note, 25000);
  expect(created.appointmentId).toBeTruthy();
  const stored = await getQaAppointment(created.appointmentId);
  const lines = stored.serviceLines || [];
  expect(lines.length).toBe(2);
  expect(new Set(lines.map((line) => line.comboInstanceId)).size).toBe(1);
  expect(lines.every((line) => line.comboServiceId === COMBO.comboId)).toBeTruthy();
  expect(lines.every((line) => line.serviceId !== COMBO.comboId)).toBeTruthy();
  expect(lines.map((line) => line.serviceId).sort()).toEqual([COMBO.gelId, COMBO.pediId].sort());
  const storedGel = lines.find((line) => line.serviceId === COMBO.gelId);
  const storedPedi = lines.find((line) => line.serviceId === COMBO.pediId);
  expect(storedGel.serviceName || storedGel.serviceNameSnapshot).toBe(COMBO.gelName);
  expect(storedPedi.serviceName || storedPedi.serviceNameSnapshot).toBe(COMBO.pediName);
  expect(Number(storedGel.durationMinutes)).toBe(45);
  expect(Number(storedPedi.durationMinutes)).toBe(30);
  expect(storedGel.providerId).toBe(PROVIDER_A);
  expect(storedPedi.providerId).toBe(PROVIDER_B);
  expect(Number(storedGel.priceSnapshot)).toBe(44);
  expect(Number(storedPedi.priceSnapshot)).toBe(40);
  expect(new Set(lines.map((line) => line.providerId))).toEqual(new Set([PROVIDER_A, PROVIDER_B]));
  expect(Math.round(allocatedSum(lines) * 100)).toBe(8400);
  expect(lines.every((line) => Number(line.comboSellingPriceSnapshot) === 84)).toBeTruthy();
  expect(lines.every((line) => Number(line.priceSnapshot) !== 84 || lines.length === 1)).toBeTruthy();
  expect(lines.some((line) => Number(line.priceSnapshot) === 44)).toBeTruthy();
  expect(lines.some((line) => Number(line.priceSnapshot) === 40)).toBeTruthy();

  const cards = page.locator('#ffBookingCalendarRoot [data-ff-cal-card="' + created.appointmentId + '"]');
  await expect(cards).toHaveCount(2, { timeout: 20000 });
  const painted = await ui.currentCalendarCards(page);
  const ours = painted.filter((card) => card.appointmentId === created.appointmentId);
  expect(ours.length).toBe(2);
  expect(ours.some((card) => card.providerId === PROVIDER_A && card.text.indexOf(COMBO.gelName) !== -1)).toBeTruthy();
  expect(ours.some((card) => card.providerId === PROVIDER_B && card.text.indexOf(COMBO.pediName) !== -1)).toBeTruthy();
  expect(ours.every((card) => /Combo/i.test(card.text) && card.text.indexOf(COMBO.name) !== -1)).toBeTruthy();

  await cards.nth(0).click();
  await page.locator("#ffBookingApptDetails").waitFor({ state: "visible", timeout: 15000 });
  const firstId = await page.evaluate(() => window.ffBookingAppointmentDetails.getCurrentId());
  const detailsOne = await ui.readDetails(page);
  expect(detailsOne.services).toMatch(/COMBO/i);
  expect(detailsOne.services).toContain(COMBO.name);
  expect(detailsOne.services).toContain(COMBO.gelName);
  expect(detailsOne.services).toContain(COMBO.pediName);
  expect(detailsOne.services).toMatch(/Allocated:\s*\$44/);
  expect(detailsOne.services).toMatch(/Allocated:\s*\$40/);
  expect(detailsOne.services).toMatch(/11:30/);
  expect(detailsOne.services).toMatch(/QA/);
  await expect(page.locator("#ffApdServices .ff-apd-combo")).toContainText("$84");
  await expect(page.locator("#ffApdServices .ff-apd-svc.is-combo-component")).toHaveCount(2);
  await expect(page.locator("#ffApdTotal")).toContainText("84");
  await expect(page.locator("#ffApdTotal")).not.toContainText("168");

  await page.locator('#ffBookingApptDetails [data-ff-apd-act="close"]').first().click();
  await page.locator("#ffBookingApptDetails").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await cards.nth(1).click();
  await page.locator("#ffBookingApptDetails").waitFor({ state: "visible", timeout: 15000 });
  const secondId = await page.evaluate(() => window.ffBookingAppointmentDetails.getCurrentId());
  expect(firstId).toBe(created.appointmentId);
  expect(secondId).toBe(created.appointmentId);

  await ui.enterEdit(page);
  await expect(page.locator("#ffApdLines .ff-appt-combo")).toBeVisible();
  await expect(comboLines(page, "#ffApdLines")).toHaveCount(2);
  const editGel = comboLines(page, "#ffApdLines").nth(0);
  const editPedi = comboLines(page, "#ffApdLines").nth(1);
  await expect(editGel).toContainText(COMBO.gelName);
  await expect(editPedi).toContainText(COMBO.pediName);
  await expect(editGel.locator(".ff-appt-card-price")).toContainText("44");
  await expect(editPedi.locator(".ff-appt-card-price")).toContainText("40");
  const editProviders = await page.evaluate(() => {
    const details = window.ffBookingAppointmentDetails;
    const state = details && typeof details.getEditState === "function" ? details.getEditState() : null;
    return ((state && state.lines) || []).filter((line) => line && line.comboInstanceId).map((line) => ({
      providerId: String(line.providerId || ""),
    }));
  });
  expect(editProviders.length).toBe(2);
  expect(editProviders.map((row) => row.providerId).sort()).toEqual([PROVIDER_A, PROVIDER_B].sort());
  const editGelClock = await readLineClock(editGel);
  const editPediClock = await readLineClock(editPedi);
  expect(editGelClock.start).toMatch(/11:30/);
  expect(editPediClock.start).toMatch(/11:30|12:15/);
  if (editPediClock.startMin === START_MIN) {
    await ui.setLineStart(page, editPedi, START_MIN + 45);
  } else {
    await ui.setLineStart(page, editPedi, START_MIN);
  }
  await ui.saveEdit(page);

  const afterEdit = await getQaAppointment(created.appointmentId);
  expect(afterEdit.serviceLines.length).toBe(2);
  expect(new Set(afterEdit.serviceLines.map((line) => line.providerId))).toEqual(new Set([PROVIDER_A, PROVIDER_B]));
  expect(afterEdit.serviceLines.find((line) => line.serviceId === COMBO.gelId).providerId).toBe(PROVIDER_A);
  expect(afterEdit.serviceLines.find((line) => line.serviceId === COMBO.pediId).providerId).toBe(PROVIDER_B);
  expect(Math.round(allocatedSum(afterEdit.serviceLines) * 100)).toBe(8400);
  expect(afterEdit.serviceLines.every((line) => line.comboInstanceId)).toBeTruthy();

  await page.locator('#ffBookingApptDetails [data-ff-apd-act="close"]').first().click().catch(() => {});
  const afterCards = page.locator('#ffBookingCalendarRoot [data-ff-cal-card="' + created.appointmentId + '"]');
  await expect(afterCards).toHaveCount(2, { timeout: 20000 });
  await afterCards.first().click();
  await page.locator("#ffBookingApptDetails").waitFor({ state: "visible", timeout: 15000 });
  const reopened = await getQaAppointment(created.appointmentId);
  expect(new Set(reopened.serviceLines.map((line) => line.providerId))).toEqual(new Set([PROVIDER_A, PROVIDER_B]));
  expect(reopened.serviceLines.find((line) => line.serviceId === COMBO.gelId).providerId).toBe(PROVIDER_A);
  expect(reopened.serviceLines.find((line) => line.serviceId === COMBO.pediId).providerId).toBe(PROVIDER_B);
  expect(reopened.serviceLines.length).toBe(2);
  const detailsAgain = await ui.readDetails(page);
  expect(detailsAgain.services).toContain(COMBO.name);
  expect(detailsAgain.services).toContain(COMBO.gelName);
  expect(detailsAgain.services).toContain(COMBO.pediName);
  await expect(page.locator("#ffApdTotal")).toContainText("84");
  const ignoreNoise = (msg) => {
    const text = String(msg || "");
    if (/favicon|Download the React DevTools|third-party cookie/i.test(text)) return false;
    if (/\[SharedServices\]/i.test(text)) return false;
    if (/node to be removed is no longer a child/i.test(text)) return false;
    return true;
  };
  expect(diag.pageErrors.filter(ignoreNoise), "no new uncaught page errors").toEqual([]);
  expect(diag.consoleErrors.filter(ignoreNoise), "no new console errors").toEqual([]);
});

test("Same-provider Combo, Single, and multi-service stay compatible", async ({ page }) => {
  test.setTimeout(180000);
  await readyPage(page);

  const sameNote = noteFor(RUN_ID, "combo-same");
  await ui.clickCalendarSlot(page, PROVIDER_A, SAME_PROVIDER_MIN);
  await ui.chooseQaClient(page);
  await pickCatalogService(page, ui.serviceLine(page, "#ffApptLines", 0), COMBO.comboId, COMBO.name);
  await expect(comboLines(page, "#ffApptLines")).toHaveCount(2);
  const sameGel = comboLines(page, "#ffApptLines").nth(0);
  const samePedi = comboLines(page, "#ffApptLines").nth(1);
  expect((await readLineClock(sameGel)).startMin).toBe(SAME_PROVIDER_MIN);
  expect((await readLineClock(samePedi)).startMin).toBe(SAME_PROVIDER_MIN + 45);
  await ui.setQaNote(page, sameNote);
  await ui.bookAppointment(page);
  const sameAppt = await waitForQaAppointmentByNote(sameNote, 25000);
  expect(sameAppt.serviceLines.length).toBe(2);
  expect(sameAppt.serviceLines.every((line) => line.providerId === PROVIDER_A)).toBeTruthy();
  expect(Math.round(allocatedSum(sameAppt.serviceLines) * 100)).toBe(8400);
  const sameCards = page.locator('#ffBookingCalendarRoot [data-ff-cal-card="' + sameAppt.appointmentId + '"]');
  await expect(sameCards).toHaveCount(1, { timeout: 20000 });

  const singleNote = noteFor(RUN_ID, "single-compat");
  await ui.clickCalendarSlot(page, PROVIDER_A, SINGLE_MIN);
  await ui.chooseQaClient(page);
  await ui.pickServiceOnLine(page, ui.serviceLine(page, "#ffApptLines", 0), ui.FIXTURE.serviceManiId);
  await expect(page.locator("#ffApptLines .ff-appt-combo")).toHaveCount(0);
  await expect(page.locator("#ffApptLines .ff-appt-svc")).toHaveCount(1);
  await ui.setQaNote(page, singleNote);
  await ui.bookAppointment(page);
  const singleAppt = await waitForQaAppointmentByNote(singleNote, 25000);
  expect(singleAppt.serviceLines.length).toBe(1);
  expect(singleAppt.serviceLines[0].serviceId).toBe(ui.FIXTURE.serviceManiId);
  expect(singleAppt.serviceLines[0].comboInstanceId).toBe("");

  const multiNote = noteFor(RUN_ID, "multi-compat");
  await ui.clickCalendarSlot(page, PROVIDER_A, MULTI_MIN);
  await ui.chooseQaClient(page);
  await ui.pickServiceOnLine(page, ui.serviceLine(page, "#ffApptLines", 0), ui.FIXTURE.serviceManiId);
  await page.locator("#ffApptAddLine").click();
  const second = ui.serviceLine(page, "#ffApptLines", 1);
  await second.waitFor({ state: "visible", timeout: 10000 });
  await ui.pickServiceOnLine(page, second, ui.FIXTURE.servicePediId);
  await ui.pickProviderOnLine(page, second, PROVIDER_B);
  await ui.setQaNote(page, multiNote);
  await ui.bookAppointment(page);
  const multiAppt = await waitForQaAppointmentByNote(multiNote, 25000);
  expect(multiAppt.serviceLines.length).toBe(2);
  expect(multiAppt.serviceLines.every((line) => !line.comboInstanceId)).toBeTruthy();
  expect(multiAppt.serviceLines.map((line) => line.serviceId).sort()).toEqual(
    [ui.FIXTURE.serviceManiId, ui.FIXTURE.servicePediId].sort()
  );
});
