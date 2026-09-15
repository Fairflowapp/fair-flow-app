"use strict";

/**
 * Booking client lifecycle against isolated salon ffBookingQa.
 * Search of qaAppointmentClient is read-only. Create/edit tests each
 * mint a fresh FF-QA-CLIENT-* document through the UI.
 */
const { test, expect } = require("../../helpers/qa-test");
const { REQUIRED_PROJECT_ID } = require("../../helpers/env");
const { gotoStagingApp, waitForAppReady, assertStagingFirebase } = require("../../helpers/auth");
const {
  FIXTURE_CLIENT_ID,
  cleanupQaClients,
  getClientById,
  waitForQaClientByNote,
  listQaLifecycleClients,
  makeRunId,
  noteFor,
} = require("../../helpers/client-admin");
const ui = require("../../helpers/client-ui");
const { attachDiagnostics, printDiagnostics } = require("../../helpers/diagnostics");
const { maybeAcquireWriteLock, maybeReleaseWriteLock } = require("../../helpers/write-lock");

let RUN_ID = "";
let WRITE_LOCK = null;

function fieldsFor(scenario, phone) {
  return {
    firstName: "QAClient",
    lastName: RUN_ID,
    phone: phone,
    email: ("qaclient." + RUN_ID + "." + scenario + "@fair-flow-staging.test").toLowerCase(),
    notes: noteFor(RUN_ID, scenario),
  };
}

async function readyClientsPage(page) {
  await gotoStagingApp(page);
  await waitForAppReady(page);
  await assertStagingFirebase(page);
  await ui.openClients(page);
}

async function createQaClient(page, scenario, phone) {
  const fields = fieldsFor(scenario, phone);
  await ui.addClientThroughUi(page, fields);
  const created = await waitForQaClientByNote(fields.notes, 20000);
  expect(created.salonId).toBe(ui.FIXTURE.salonId);
  expect(created.clientId).not.toBe(FIXTURE_CLIENT_ID);
  return { fields, created };
}

test.beforeAll(async () => {
  RUN_ID = makeRunId();
  WRITE_LOCK = await maybeAcquireWriteLock({
    runId: "FF-QA-CLIENT-" + RUN_ID,
    targetLabel: process.env.FF_QA_TARGET_LABEL || "clients",
    targetSha: process.env.FF_QA_TARGET_SHA || "",
  });
  await cleanupQaClients(RUN_ID);
});

test.beforeEach(async () => {
  await cleanupQaClients(RUN_ID);
});

test.afterAll(async () => {
  try {
    if (RUN_ID) await cleanupQaClients(RUN_ID);
  } finally {
    await maybeReleaseWriteLock(WRITE_LOCK);
  }
});

test.describe("Booking client lifecycle", () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    console.log("[QA client fail]", testInfo.title);
    console.log("  URL:", page.url());
    console.log("  runId:", RUN_ID);
  });

  test("1. search existing fixture client", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyClientsPage(page);
    await ui.searchClients(page, ui.FIXTURE.searchName);
    await ui.waitForClientRow(page, ui.FIXTURE.clientId);
    await expect.poll(async () => {
      const rows = await ui.currentClientRows(page);
      return rows.some((row) => row.clientId === ui.FIXTURE.clientId);
    }).toBe(true);
    await ui.openClientRow(page, ui.FIXTURE.clientId);
    const header = await ui.readProfileHeader(page);
    expect(header.name).toMatch(/QA Appointment Client/i);
    expect(header.email).toMatch(/qa-appointment-client@fair-flow-staging\.test/i);
    const backend = await getClientById(ui.FIXTURE.clientId, { allowFixture: true });
    expect(backend.clientId).toBe(ui.FIXTURE.clientId);
    expect(backend.firstName).toBe(ui.FIXTURE.firstName);
    expect(backend.lastName).toBe(ui.FIXTURE.lastName);
    printDiagnostics(diag, "clients-search-fixture");
  });

  test("2. create client", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyClientsPage(page);
    const { fields, created } = await createQaClient(page, "create", "5550101001");
    expect(created.firstName).toBe(fields.firstName);
    expect(created.lastName).toBe(fields.lastName);
    expect(created.phone).toBe(fields.phone);
    expect(created.email).toBe(fields.email);
    expect(created.notes).toBe(fields.notes);
    expect(created.phoneDigits).toBe("5550101001");
    expect(created.emailNormalized).toBe(fields.email);
    const header = await ui.readProfileHeader(page);
    expect(header.name).toMatch(/QAClient/i);
    expect(header.email).toBe(fields.email);
    await ui.closeProfile(page);
    await ui.searchClients(page, fields.email);
    await ui.waitForClientRow(page, created.clientId);
    printDiagnostics(diag, "clients-create");
  });

  test("3. open client profile", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyClientsPage(page);
    const { fields, created } = await createQaClient(page, "profile", "5550101002");
    await ui.closeProfile(page);
    await ui.searchClients(page, fields.firstName + " " + fields.lastName);
    await ui.waitForClientRow(page, created.clientId);
    await ui.openClientRow(page, created.clientId);
    const header = await ui.readProfileHeader(page);
    expect(header.name).toMatch(/QAClient/i);
    expect(header.name).toMatch(new RegExp(RUN_ID, "i"));
    expect(header.phone).toMatch(/5550101002/);
    expect(header.email).toBe(fields.email);
    const tabs = page.locator("#ffBookingClientProfile [data-ff-clip-tab]");
    await expect(tabs.filter({ hasText: /Sales/i })).toBeVisible();
    await expect(tabs.filter({ hasText: /Notes/i })).toBeVisible();
    const backend = await getClientById(created.clientId);
    expect(backend.firstName).toBe(fields.firstName);
    expect(backend.phone).toBe(fields.phone);
    expect(backend.email).toBe(fields.email);
    printDiagnostics(diag, "clients-profile");
  });

  test("4. edit client profile", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyClientsPage(page);
    const { created } = await createQaClient(page, "edit", "5550101003");
    await ui.enterProfileEdit(page);
    const nextPhone = "5550101888";
    const nextEmail = ("qaclient." + RUN_ID + ".edited@fair-flow-staging.test").toLowerCase();
    const nextNotes = noteFor(RUN_ID, "edit") + " edited";
    await page.locator("#ffClipPhoneIn").fill(nextPhone);
    await page.locator("#ffClipEmailIn").fill(nextEmail);
    await page.locator("#ffClipNotesIn").fill(nextNotes);
    await ui.saveProfileEdit(page);
    const header = await ui.readProfileHeader(page);
    expect(header.phone).toMatch(/5550101888/);
    expect(header.email).toBe(nextEmail);
    const updated = await getClientById(created.clientId);
    expect(updated.clientId).toBe(created.clientId);
    expect(updated.phone).toBe(nextPhone);
    expect(updated.email).toBe(nextEmail);
    expect(updated.notes).toBe(nextNotes);
    expect(updated.phoneDigits).toBe("5550101888");
    expect(updated.firstName).toBe("QAClient");
    printDiagnostics(diag, "clients-edit");
  });

  test("5. search after edit", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await readyClientsPage(page);
    const { created } = await createQaClient(page, "search-after", "5550101004");
    await ui.enterProfileEdit(page);
    const nextPhone = "5550101777";
    await page.locator("#ffClipPhoneIn").fill(nextPhone);
    await page.locator("#ffClipNotesIn").fill(noteFor(RUN_ID, "search-after") + " edited");
    await ui.saveProfileEdit(page);
    await ui.closeProfile(page);
    await ui.searchClients(page, nextPhone);
    await ui.waitForClientRow(page, created.clientId);
    await expect.poll(async () => {
      const rows = await ui.currentClientRows(page);
      return rows.some((row) => row.clientId === created.clientId);
    }).toBe(true);
    const rows = await ui.currentClientRows(page);
    const matches = rows.filter((row) => row.clientId === created.clientId);
    expect(matches.length).toBe(1);
    expect(rows.filter((row) => /QAClient/i.test(row.text)).length).toBe(1);
    await ui.openClientRow(page, created.clientId);
    const header = await ui.readProfileHeader(page);
    expect(header.phone).toMatch(/5550101777/);
    const backend = await getClientById(created.clientId);
    expect(backend.clientId).toBe(created.clientId);
    expect(backend.phoneDigits).toBe("5550101777");
    printDiagnostics(diag, "clients-search-after-edit");
  });

  test("safety: clients stayed on fair-flow-staging / ffBookingQa and fixture remains", async ({ page }) => {
    await readyClientsPage(page);
    const info = await page.evaluate(() => ({
      projectId: window.firebaseConfig && window.firebaseConfig.projectId,
      salonId: window.currentSalonId,
    }));
    expect(info.projectId).toBe(REQUIRED_PROJECT_ID);
    expect(info.salonId).toBe(ui.FIXTURE.salonId);
    const fixture = await getClientById(FIXTURE_CLIENT_ID, { allowFixture: true });
    expect(fixture).toBeTruthy();
    expect(fixture.clientId).toBe(FIXTURE_CLIENT_ID);
    expect(fixture.firstName).toBe(ui.FIXTURE.firstName);
    const leftover = await listQaLifecycleClients();
    leftover.forEach((row) => {
      expect(row.clientId).not.toBe(FIXTURE_CLIENT_ID);
      expect(row.notes).toMatch(/^FF-QA-CLIENT-/);
    });
  });
});
