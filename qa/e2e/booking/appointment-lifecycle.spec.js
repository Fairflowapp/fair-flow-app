"use strict";

/**
 * Booking appointment lifecycle against the isolated ffBookingQa salon.
 * Workers are 1 and these tests write to the same staging salon, so they
 * use distinct start times rather than a shared appointment. They do not
 * depend on each other passing.
 */
const { test, expect } = require("../../helpers/qa-test");
const { REQUIRED_PROJECT_ID } = require("../../helpers/env");
const { gotoStagingApp, waitForAppReady, assertStagingFirebase } = require("../../helpers/auth");
const {
  cleanupQaAppointments,
  getQaAppointment,
  waitForQaAppointmentByNote,
  makeRunId,
  noteFor,
} = require("../../helpers/appointment-admin");
const ui = require("../../helpers/appointment-ui");
const { attachDiagnostics, printDiagnostics } = require("../../helpers/diagnostics");
const { maybeAcquireWriteLock, maybeReleaseWriteLock } = require("../../helpers/write-lock");

let RUN_ID = "";
let WRITE_LOCK = null;
const DAYS_AHEAD = 2;
const SLOT = {
  create: 10 * 60,
  edit: 10 * 60 + 30,
  editTo: 11 * 60,
  drag: 11 * 60 + 30,
  dragTo: 12 * 60,
  multiService: 13 * 60,
  multiProvider: 15 * 60,
  requested: 16 * 60,
  cancel: 16 * 60 + 30,
};

async function readyLifecyclePage(page) {
  await gotoStagingApp(page);
  await waitForAppReady(page);
  await assertStagingFirebase(page);
  await ui.openReadyCalendar(page);
  const dateKey = await ui.goToFutureDay(page, DAYS_AHEAD);
  await ui.waitForProviders(page);
  return dateKey;
}

async function createBasicQaAppointment(page, startMin, scenario, extras) {
  const note = noteFor(RUN_ID, scenario);
  await ui.clickCalendarSlot(page, ui.FIXTURE.providerOneId, startMin);
  await ui.chooseQaClient(page);
  const firstLine = ui.serviceLine(page, "#ffApptLines", 0);
  await ui.pickServiceOnLine(page, firstLine, ui.FIXTURE.serviceManiId);
  if (extras && extras.addSecondService) {
    await page.locator("#ffApptAddLine").click();
    const second = ui.serviceLine(page, "#ffApptLines", 1);
    await second.waitFor({ state: "visible", timeout: 10000 });
    await ui.pickServiceOnLine(page, second, ui.FIXTURE.servicePediId);
    if (extras.secondProviderId) {
      await ui.pickProviderOnLine(page, second, extras.secondProviderId);
    }
  }
  if (extras && extras.requested) {
    await firstLine.locator('[data-ff-appt-act="toggle-request"]').click();
    await expect(firstLine.locator('[data-ff-appt-act="toggle-request"]')).toHaveAttribute("aria-pressed", "true");
  }
  await ui.setQaNote(page, note);
  await ui.bookAppointment(page);
  const created = await waitForQaAppointmentByNote(note, 20000);
  expect(created.salonId).toBe(ui.FIXTURE.salonId);
  expect(created.locationId).toBe(ui.FIXTURE.locationId);
  await ui.waitForCard(page, created.appointmentId);
  return { note, created };
}

test.beforeAll(async () => {
  RUN_ID = makeRunId();
  WRITE_LOCK = await maybeAcquireWriteLock({
    runId: RUN_ID,
    targetLabel: process.env.FF_QA_TARGET_LABEL || "lifecycle",
    targetSha: process.env.FF_QA_TARGET_SHA || "",
  });
  await cleanupQaAppointments(RUN_ID);
});

test.beforeEach(async () => {
  await cleanupQaAppointments(RUN_ID);
});

test.afterAll(async () => {
  try {
    if (RUN_ID) await cleanupQaAppointments(RUN_ID);
  } finally {
    await maybeReleaseWriteLock(WRITE_LOCK);
  }
});

test.describe("Booking appointment lifecycle", () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    console.log("[QA lifecycle fail]", testInfo.title);
    console.log("  URL:", page.url());
    console.log("  runId:", RUN_ID);
  });

  test("1. create appointment", async ({ page }) => {
    const diag = attachDiagnostics(page);
    const dateKey = await readyLifecyclePage(page);
    const { created } = await createBasicQaAppointment(page, SLOT.create, "create");
    expect(created.clientId).toBe(ui.FIXTURE.clientId);
    expect(created.dateKey).toBe(dateKey);
    expect(created.status).toBe("scheduled");
    expect(created.serviceLines[0].serviceId).toBe(ui.FIXTURE.serviceManiId);
    expect(created.serviceLines[0].providerId).toBe(ui.FIXTURE.providerOneId);
    await ui.openCardDetails(page, created.appointmentId);
    const details = await ui.readDetails(page);
    expect(details.client).toMatch(/QA Appointment/i);
    expect(details.services).toMatch(/QA Manicure/i);
    printDiagnostics(diag, "lifecycle-create");
  });

  test("2. edit appointment service", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyLifecyclePage(page);
    const { created } = await createBasicQaAppointment(page, SLOT.edit, "edit");
    await ui.openCardDetails(page, created.appointmentId);
    await ui.enterEdit(page);
    const editLine = ui.serviceLine(page, "#ffApdLines", 0);
    await ui.pickServiceOnLine(page, editLine, ui.FIXTURE.servicePediId);
    await ui.saveEdit(page);
    const updated = await getQaAppointment(created.appointmentId);
    expect(updated.appointmentId).toBe(created.appointmentId);
    expect(updated.clientId).toBe(ui.FIXTURE.clientId);
    expect(updated.serviceLines[0].serviceId).toBe(ui.FIXTURE.servicePediId);
    const details = await ui.readDetails(page);
    expect(details.services).toMatch(/QA Pedicure/i);
    printDiagnostics(diag, "lifecycle-edit");
  });

  test("3. multi-service appointment", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyLifecyclePage(page);
    const { created } = await createBasicQaAppointment(page, SLOT.multiService, "multi-service", {
      addSecondService: true,
    });
    expect(created.appointmentId).toBeTruthy();
    expect(created.serviceLines.length).toBe(2);
    expect(created.serviceLines.map((line) => line.serviceId).sort()).toEqual(
      [ui.FIXTURE.serviceManiId, ui.FIXTURE.servicePediId].sort()
    );
    expect(created.serviceLines.every((line) => line.providerId === ui.FIXTURE.providerOneId)).toBe(true);
    await ui.openCardDetails(page, created.appointmentId);
    const details = await ui.readDetails(page);
    expect(details.services).toMatch(/QA Manicure/i);
    expect(details.services).toMatch(/QA Pedicure/i);
    printDiagnostics(diag, "lifecycle-multi-service");
  });

  test("4. multi-provider appointment", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyLifecyclePage(page);
    const { created } = await createBasicQaAppointment(page, SLOT.multiProvider, "multi-provider", {
      addSecondService: true,
      secondProviderId: ui.FIXTURE.providerTwoId,
    });
    expect(created.serviceLines.length).toBe(2);
    const providers = created.serviceLines.map((line) => line.providerId).sort();
    expect(providers).toEqual([ui.FIXTURE.providerOneId, ui.FIXTURE.providerTwoId].sort());
    const cards = await ui.currentCalendarCards(page);
    const mine = cards.filter((row) => row.appointmentId === created.appointmentId);
    expect(mine.some((row) => row.providerId === ui.FIXTURE.providerOneId)).toBe(true);
    expect(mine.some((row) => row.providerId === ui.FIXTURE.providerTwoId)).toBe(true);
    await ui.openCardDetails(page, created.appointmentId);
    const details = await ui.readDetails(page);
    expect(details.services).toMatch(/QA Manicure/i);
    expect(details.services).toMatch(/QA Pedicure/i);
    printDiagnostics(diag, "lifecycle-multi-provider");
  });

  test("5. requested provider", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyLifecyclePage(page);
    const { created } = await createBasicQaAppointment(page, SLOT.requested, "requested", {
      requested: true,
    });
    expect(created.requested).toBe(true);
    expect(created.serviceLines[0].requested).toBe(true);
    const cards = await ui.currentCalendarCards(page);
    const mine = cards.find((row) => row.appointmentId === created.appointmentId);
    expect(mine && mine.requested).toBe(true);
    printDiagnostics(diag, "lifecycle-requested");
  });

  test("6. drag appointment to a later time", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyLifecyclePage(page);
    const { created } = await createBasicQaAppointment(page, SLOT.drag, "drag");
    const before = created.startAt;
    await ui.dragCardByMinutes(page, created.appointmentId, 30);
    await expect.poll(async () => {
      const row = await getQaAppointment(created.appointmentId);
      return row.startAt;
    }, { timeout: 20000 }).not.toBe(before);
    const updated = await getQaAppointment(created.appointmentId);
    expect(updated.appointmentId).toBe(created.appointmentId);
    expect(updated.clientId).toBe(ui.FIXTURE.clientId);
    expect(updated.serviceLines[0].serviceId).toBe(ui.FIXTURE.serviceManiId);
    expect(updated.startAt).not.toBe(before);
    const cards = await ui.currentCalendarCards(page);
    expect(cards.some((row) => row.appointmentId === created.appointmentId)).toBe(true);
    printDiagnostics(diag, "lifecycle-drag");
  });

  test("7. cancel appointment", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyLifecyclePage(page);
    const { created } = await createBasicQaAppointment(page, SLOT.cancel, "cancel");
    await ui.openCardDetails(page, created.appointmentId);
    await ui.cancelThroughUi(page);
    const updated = await getQaAppointment(created.appointmentId);
    expect(updated.status).toBe("cancelled");
    const cards = await ui.currentCalendarCards(page);
    expect(cards.some((row) => row.appointmentId === created.appointmentId)).toBe(false);
    printDiagnostics(diag, "lifecycle-cancel");
  });

  test("safety: lifecycle stayed on fair-flow-staging / ffBookingQa", async ({ page }) => {
    await readyLifecyclePage(page);
    const info = await page.evaluate(() => ({
      projectId: window.firebaseConfig && window.firebaseConfig.projectId,
      salonId: window.currentSalonId,
    }));
    expect(info.projectId).toBe(REQUIRED_PROJECT_ID);
    expect(info.salonId).toBe(ui.FIXTURE.salonId);
  });
});
