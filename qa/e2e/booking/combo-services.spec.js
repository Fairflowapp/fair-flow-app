"use strict";

/**
 * Phase 1 Combo Services UI verification.
 * Writes only FF-QA-COMBO-* catalog rows in fair-flow-staging / ffBookingQa.
 */
const { test, expect } = require("../../helpers/qa-test");
const { REQUIRED_PROJECT_ID } = require("../../helpers/env");
const { gotoStagingApp, waitForAppReady, assertStagingFirebase } = require("../../helpers/auth");
const { openBooking } = require("../../helpers/booking");
const { attachDiagnostics, printDiagnostics } = require("../../helpers/diagnostics");
const { makeRunId } = require("../../helpers/appointment-admin");
const { cleanupQaComboServices, listQaComboServices } = require("../../helpers/combo-service-admin");

let RUN_ID = "";
let NAMES = {};
let diag;

function namesFor(runId) {
  return {
    category: "FF-QA-COMBO-CAT " + runId,
    singleOne: "FF-QA-COMBO-S1 " + runId,
    singleTwo: "FF-QA-COMBO-S2 " + runId,
    combo: "FF-QA-COMBO " + runId,
  };
}

async function openServices(page) {
  await openBooking(page);
  await page.locator('[data-ff-booking-section="services"]').click();
  const screen = page.locator("#servicesScreen");
  await screen.waitFor({ state: "visible", timeout: 25000 });
  await page.waitForFunction(() => {
    const list = document.querySelector("#servicesScreen #servicesCatalogV2List");
    if (!list) return false;
    const text = String(list.textContent || "");
    return text.length > 0 && text.indexOf("Loading services") === -1;
  }, null, { timeout: 25000 });
}

async function waitToast(page, pattern) {
  const toast = page.locator("#ff-app-toast");
  await expect(toast).toBeVisible({ timeout: 25000 });
  await expect(toast).toContainText(pattern);
}

async function waitInlineSaved(page) {
  await expect(page.locator("#servicesDetailEditBtn")).toBeVisible({ timeout: 25000 });
}

async function waitModalClosed(page) {
  await expect(page.locator("#servicesCatalogEditorModal")).toBeHidden({ timeout: 15000 });
}

async function addCategory(page, name) {
  await page.locator("#servicesScreen #servicesCatalogAddCategoryBtn").click();
  const modal = page.locator("#servicesCatalogEditorModal");
  await expect(modal).toBeVisible();
  await page.locator("#servicesCatalogEditorName").fill(name);
  await page.locator("#servicesCatalogEditorSave").click();
  await waitToast(page, /Category added/i);
  await waitModalClosed(page);
}

async function openAddService(page, categoryName) {
  const section = page.locator("#servicesScreen .staff-sidebar-section").filter({ hasText: categoryName }).first();
  await expect(section).toBeVisible({ timeout: 10000 });
  const toggle = section.locator(".ff-services-cat-toggle");
  if (await toggle.getAttribute("aria-expanded") === "false") {
    await toggle.click();
  }
  await section.locator(".ffcat-addsvc-btn").click();
  await expect(page.locator("#servicesCatalogEditorModal")).toBeVisible();
}

async function fillSingleService(page, opts) {
  await page.locator("#servicesCatalogEditorName").fill(opts.name);
  const typeSingle = page.locator("#servicesCatalogEditorTypeSingle");
  await expect(typeSingle).toBeVisible();
  if (opts.expectDefaultSingle) {
    await expect(typeSingle).toBeChecked();
  }
  const catSel = page.locator("#servicesCatalogEditorCategory");
  const catText = page.locator("#servicesCatalogEditorCategoryText");
  if (await catSel.isVisible()) {
    const option = catSel.locator("option", { hasText: opts.category });
    if (await option.count()) {
      const value = await option.first().getAttribute("value");
      if (value) await catSel.selectOption(value);
    }
  } else if (await catText.isVisible()) {
    await catText.fill(opts.category);
  }
  await page.locator("#servicesCatalogEditorPrice").fill(String(opts.price));
  await page.locator("#servicesCatalogEditorDurationHours").selectOption(String(opts.hours || 0));
  await page.locator("#servicesCatalogEditorDurationMinutes").selectOption(String(opts.minutes));
}

async function saveEditor(page) {
  await page.locator("#servicesCatalogEditorSave").click();
}

async function selectService(page, name) {
  const row = page.locator("#servicesScreen .ff-services-sidebar-service").filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();
  await expect(page.locator("#servicesDetailContainer")).toBeVisible();
  await expect(page.locator("#servicesDetailHeader")).toContainText(name);
}

async function componentNames(page) {
  return page.locator(".ff-combo-component-row").evaluateAll((rows) =>
    rows.map((row) => {
      const name = row.querySelector("div div") ? String(row.querySelector("div div").textContent || "").trim() : "";
      const allocated = row.querySelector(".ff-combo-allocated");
      return {
        name,
        serviceId: String(row.getAttribute("data-service-id") || ""),
        allocated: allocated ? String(allocated.value || "") : "",
        duration: String(row.children[1] ? row.children[1].textContent || "" : "").trim(),
      };
    })
  );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  RUN_ID = makeRunId();
  NAMES = namesFor(RUN_ID);
  await cleanupQaComboServices(RUN_ID);
});

test.afterAll(async () => {
  const deleted = await cleanupQaComboServices(RUN_ID);
  console.log("[QA combo cleanup]", deleted.length, "docs", deleted.map((row) => row.name).join(" | "));
});

test("Phase 1 Combo Services UI", async ({ page }) => {
  diag = attachDiagnostics(page);
  const info = await gotoStagingApp(page);
  expect(info.projectId).toBe(REQUIRED_PROJECT_ID);
  await waitForAppReady(page);
  await assertStagingFirebase(page);
  await openServices(page);

  const pageErrorsAtStart = diag.pageErrors.length;

  await addCategory(page, NAMES.category);

  await openAddService(page, NAMES.category);
  await expect(page.locator("#servicesCatalogEditorTypeSingle")).toBeChecked();
  await expect(page.locator("#servicesCatalogEditorTypeCombo")).not.toBeChecked();
  await expect(page.locator("#servicesCatalogEditorDurationWrap")).toBeVisible();
  await expect(page.locator("#servicesCatalogEditorComboWrap")).toBeHidden();
  await expect(page.locator("#servicesCatalogEditorCategory")).toBeVisible();
  await expect(page.locator("#servicesCatalogEditorCategoryText")).toBeHidden();
  const existingCats = await page.locator("#servicesCatalogEditorCategory option").allTextContents();
  expect(existingCats.join("\n")).toMatch(/Select existing category|Hands|Feet|Combo|Waxing|Massage|FF-QA-COMBO-CAT/i);
  await expect(page.locator("#servicesCatalogEditorCreateCategory")).toBeVisible();
  await fillSingleService(page, {
    name: NAMES.singleOne,
    category: NAMES.category,
    price: 40,
    minutes: 35,
    expectDefaultSingle: true,
  });
  await saveEditor(page);
  await waitToast(page, /Service added/i);
  await waitModalClosed(page);

  await selectService(page, NAMES.singleOne);
  await expect(page.locator("#servicesDetailHeader")).toContainText(NAMES.singleOne);
  await page.locator("#servicesDetailEditBtn").click();
  const nameInput = page.locator("#servicesInlineEditName");
  await expect(nameInput).toHaveValue(NAMES.singleOne);
  await expect(page.locator("#servicesInlineEditTypeSingle")).toBeChecked();
  await page.locator("#servicesInlineEditPrice").fill("42");
  await page.locator("#servicesInlineEditSaveBtn").click();
  await waitInlineSaved(page);
  await expect(page.locator("#servicesDetailHeader")).toContainText("$42");

  await openAddService(page, NAMES.category);
  await fillSingleService(page, {
    name: NAMES.singleTwo,
    category: NAMES.category,
    price: 45,
    minutes: 45,
    expectDefaultSingle: true,
  });
  await saveEditor(page);
  await waitToast(page, /Service added/i);
  await waitModalClosed(page);

  await openAddService(page, NAMES.category);
  await page.locator("#servicesCatalogEditorName").fill(NAMES.combo);
  const comboCatSel = page.locator("#servicesCatalogEditorCategory");
  if (await comboCatSel.isVisible()) {
    const option = comboCatSel.locator("option", { hasText: NAMES.category });
    if (await option.count()) {
      const value = await option.first().getAttribute("value");
      if (value) await comboCatSel.selectOption(value);
    }
  } else {
    const catText = page.locator("#servicesCatalogEditorCategoryText");
    if (await catText.isVisible()) await catText.fill(NAMES.category);
  }
  await page.locator("#servicesCatalogEditorTypeCombo").check();
  await expect(page.locator("#servicesCatalogEditorComboWrap")).toBeVisible();
  await expect(page.locator("#servicesCatalogEditorDurationWrap")).toBeHidden();
  await page.locator("#servicesCatalogEditorPrice").fill("65");

  const addSelect = page.locator("#servicesCatalogEditorComboWrap .ff-combo-add-select");
  await addSelect.selectOption({ label: NAMES.singleOne });
  await page.locator("#servicesCatalogEditorComboWrap .ff-combo-add-btn").click();
  await expect(page.locator("#servicesCatalogEditorComboWrap .ff-combo-component-row")).toHaveCount(1);

  await saveEditor(page);
  await waitToast(page, /at least 2 existing Single Services/i);
  await expect(page.locator("#servicesCatalogEditorModal")).toBeVisible();

  const optionsAfterFirst = await addSelect.locator("option").allTextContents();
  expect(optionsAfterFirst.join("\n")).not.toContain(NAMES.singleOne);
  expect(optionsAfterFirst.join("\n")).toContain(NAMES.singleTwo);

  await addSelect.selectOption({ label: NAMES.singleTwo });
  await page.locator("#servicesCatalogEditorComboWrap .ff-combo-add-btn").click();
  await expect(page.locator("#servicesCatalogEditorComboWrap .ff-combo-component-row")).toHaveCount(2);

  let rows = await componentNames(page);
  expect(rows[0].name).toBe(NAMES.singleOne);
  expect(rows[0].duration).toMatch(/35 min/);
  expect(rows[1].name).toBe(NAMES.singleTwo);
  expect(rows[1].duration).toMatch(/45 min/);

  const allocated = page.locator("#servicesCatalogEditorComboWrap .ff-combo-allocated");
  await allocated.nth(0).fill("30");
  await allocated.nth(1).fill("30");
  await saveEditor(page);
  await waitToast(page, /must add up to the Combo selling price/i);

  await allocated.nth(0).fill("30");
  await allocated.nth(1).fill("35");

  await page.locator("#servicesCatalogEditorComboWrap .ff-combo-move-down").first().click();
  await expect.poll(async () => {
    const current = await componentNames(page);
    return current[0] && current[0].name;
  }).toBe(NAMES.singleTwo);
  rows = await componentNames(page);
  expect(rows[0].name).toBe(NAMES.singleTwo);
  expect(rows[1].name).toBe(NAMES.singleOne);

  await page.locator("#servicesCatalogEditorComboWrap .ff-combo-move-up").nth(1).click();
  await expect.poll(async () => {
    const current = await componentNames(page);
    return current[0] && current[0].name;
  }).toBe(NAMES.singleOne);
  rows = await componentNames(page);
  expect(rows[0].name).toBe(NAMES.singleOne);
  expect(rows[1].name).toBe(NAMES.singleTwo);

  await page.locator("#servicesCatalogEditorComboWrap .ff-combo-remove").nth(1).click();
  await expect(page.locator("#servicesCatalogEditorComboWrap .ff-combo-component-row")).toHaveCount(1);
  await addSelect.selectOption({ label: NAMES.singleTwo });
  await page.locator("#servicesCatalogEditorComboWrap .ff-combo-add-btn").click();
  await allocated.nth(0).fill("30");
  await allocated.nth(1).fill("35");

  await saveEditor(page);
  await waitToast(page, /Service added/i);
  await waitModalClosed(page);

  const comboRow = page.locator("#servicesScreen .ff-services-sidebar-service").filter({ hasText: NAMES.combo });
  await expect(comboRow).toBeVisible();
  await expect(comboRow.locator(".ff-combo-badge")).toHaveText(/Combo/i);

  await selectService(page, NAMES.combo);
  await expect(page.locator("#servicesDetailTabContent")).toContainText(/Combo/i);
  await expect(page.locator("#servicesDetailTabContent")).toContainText(NAMES.singleOne);
  await expect(page.locator("#servicesDetailTabContent")).toContainText(NAMES.singleTwo);
  await expect(page.locator("#servicesDetailTabContent")).toContainText(/35 min/);
  await expect(page.locator("#servicesDetailTabContent")).toContainText(/45 min/);
  await expect(page.locator("#servicesDetailTabContent")).toContainText("$30");
  await expect(page.locator("#servicesDetailTabContent")).toContainText("$35");
  await expect(page.locator("#servicesDetailHeader")).toContainText("$65");

  const saved = await listQaComboServices(RUN_ID);
  const comboDoc = (saved.shared.concat(saved.local)).find((row) => row.name === NAMES.combo);
  expect(comboDoc, "combo must persist in staging catalog").toBeTruthy();
  expect(comboDoc.serviceType).toBe("combo");
  expect(comboDoc.components.length).toBe(2);
  const allocatedSum = comboDoc.components.reduce((sum, row) => sum + Math.round(Number(row.allocatedPrice) * 100), 0);
  expect(allocatedSum).toBe(6500);

  await page.locator("#servicesDetailEditBtn").click();
  await expect(page.locator("#servicesInlineEditTypeCombo")).toBeChecked();
  await expect(page.locator("#servicesInlineEditDurationRow")).toBeHidden();
  await expect(page.locator("#servicesInlineEditComboWrap")).toBeVisible();
  await page.locator("#servicesInlineEditComboWrap .ff-combo-move-down").first().click();
  const inlineRows = await page.locator("#servicesInlineEditComboWrap .ff-combo-component-row").evaluateAll((els) =>
    els.map((el) => String(el.querySelector("div div").textContent || "").trim())
  );
  expect(inlineRows[0]).toBe(NAMES.singleTwo);
  expect(inlineRows[1]).toBe(NAMES.singleOne);
  await page.locator("#servicesInlineEditComboWrap .ff-combo-allocated").nth(0).fill("35");
  await page.locator("#servicesInlineEditComboWrap .ff-combo-allocated").nth(1).fill("30");
  await page.locator("#servicesInlineEditSaveBtn").click();
  await waitInlineSaved(page);

  await selectService(page, NAMES.combo);
  await expect(page.locator("#servicesDetailTabContent")).toContainText(NAMES.singleTwo);
  const afterEdit = await listQaComboServices(RUN_ID);
  const comboAfter = (afterEdit.shared.concat(afterEdit.local)).find((row) => row.name === NAMES.combo);
  expect(comboAfter.components[0].allocatedPrice).toBe(35);
  expect(comboAfter.components[1].allocatedPrice).toBe(30);

  await selectService(page, NAMES.singleOne);
  await page.locator("#servicesDetailActionsBtn").click();
  await page.locator(".ffcat-popover button", { hasText: /Delete service/i }).click();
  await waitToast(page, /used in/i);
  await expect(page.locator("#servicesScreen .ff-services-sidebar-service").filter({ hasText: NAMES.singleOne })).toBeVisible();

  const leftoverErrors = diag.pageErrors.slice(pageErrorsAtStart);
  expect(leftoverErrors, "no new uncaught page errors").toEqual([]);
  const seriousConsole = diag.consoleErrors.filter((msg) => {
    const text = String(msg || "");
    if (/favicon|Download the React DevTools|third-party cookie/i.test(text)) return false;
    if (/\[SharedServices\]/i.test(text)) return false;
    return true;
  });
  printDiagnostics(diag, "combo-services");
  expect(seriousConsole, "no new console errors").toEqual([]);
});
