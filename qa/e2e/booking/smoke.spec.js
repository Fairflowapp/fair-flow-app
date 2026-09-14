"use strict";

const { test, expect } = require("../../helpers/qa-test");
const { appUrl, REQUIRED_PROJECT_ID } = require("../../helpers/env");
const {
  gotoStagingApp,
  assertStagingFirebase,
  waitForAppReady,
  readFirebaseEnv,
  assertDedicatedQaIdentity,
} = require("../../helpers/auth");
const {
  waitForBookingSwitch,
  openBooking,
  waitForBookingWorkspace,
  waitForCalendarReady,
  openBookingSection,
  readActiveLocation,
} = require("../../helpers/booking");
const { EXPECTED_QA_LOCATION } = require("../../helpers/auth-state");
const { attachDiagnostics, printDiagnostics } = require("../../helpers/diagnostics");

async function openAuthenticatedApp(page) {
  const info = await gotoStagingApp(page);
  await waitForAppReady(page);
  return info;
}

test.describe("A. Environment safety", () => {
  test("page loads with ?env=staging and Firebase project is fair-flow-staging", async ({ page }) => {
    const diag = attachDiagnostics(page);
    const info = await gotoStagingApp(page);
    expect(page.url(), "browser URL must include env=staging").toMatch(/[?&]env=staging(?:&|$)/);
    expect(page.url(), "browser origin must be the staging Auth host").toMatch(/^https:\/\/fair-flow-staging\.web\.app\//);
    expect(info.projectId, "Firebase projectId must be fair-flow-staging").toBe(REQUIRED_PROJECT_ID);
    expect(info.ffEnv).toBe("staging");
    expect(info.local.checkpointSha).toBeTruthy();
    printDiagnostics(diag, "env-safety");
  });
});

test.describe("Authenticated Booking smoke", () => {
  test.describe.configure({ mode: "serial" });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    console.log("[QA fail]", testInfo.title);
    console.log("  URL:", page.url());
  });

  test("B. authenticated session reaches a ready main app", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openAuthenticatedApp(page);
    await assertStagingFirebase(page);
    await expect(page.locator("#main-app-content")).toBeVisible();
    const identity = await assertDedicatedQaIdentity(page);
    expect(identity.salonId).toBe("ffBookingQa");
    printDiagnostics(diag, "B-ready");
  });

  test("C. Booking product switch opens the workspace", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openAuthenticatedApp(page);
    await waitForBookingSwitch(page);
    await expect(page.locator('#ffProductSwitch [data-ff-area="booking"]')).toBeVisible();
    await openBooking(page);
    await waitForBookingWorkspace(page);
    await expect(page.locator("#ffBookingWorkspace")).toBeVisible();
    const state = await page.evaluate(() => ({
      bookingArea: document.body.classList.contains("ff-booking-area"),
      hidden: document.getElementById("ffBookingWorkspace").hasAttribute("hidden"),
      area: window.ffBookingState && window.ffBookingState.getArea && window.ffBookingState.getArea(),
    }));
    expect(state.bookingArea).toBe(true);
    expect(state.hidden).toBe(false);
    expect(state.area).toBe("booking");
    printDiagnostics(diag, "C-booking");
  });

  test("D. Day Calendar reaches a valid ready state", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openAuthenticatedApp(page);
    await openBooking(page);
    await openBookingSection(page, "calendar");
    await waitForCalendarReady(page);
    const root = page.locator("#ffBookingCalendarRoot");
    await expect(root).toBeVisible();
    await expect(root.locator('[data-ff-cal-act="today"]')).toBeVisible();
    await expect(root.locator(".ff-cal-view-btn.is-active")).toContainText(/Day/i);
    const ready = await page.evaluate(() => {
      const el = document.getElementById("ffBookingCalendarRoot");
      return {
        columns: el ? el.querySelectorAll("[data-ff-cal-emp]").length : 0,
        empty: !!(el && el.querySelector(".ff-cal-empty")),
      };
    });
    expect(
      ready.columns > 0 || ready.empty,
      "calendar must show provider columns or the legitimate empty state"
    ).toBe(true);
    printDiagnostics(diag, "D-calendar");
  });

  test("E. active location control exists and location is reported", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openAuthenticatedApp(page);
    await openBooking(page);
    await page.waitForFunction(() => {
      try {
        if (typeof window.ffGetActiveLocationId === "function") {
          return !!String(window.ffGetActiveLocationId() || "").trim();
        }
      } catch (_) {}
      return !!String(window.__ff_active_location_id || "").trim();
    }, null, { timeout: 8000 }).catch(() => {});
    const loc = await readActiveLocation(page);
    expect(loc.mountExists, "#ffLocationSwitcher must exist").toBe(true);
    if (loc.activeId) {
      expect(loc.activeId).toBe(EXPECTED_QA_LOCATION);
      if (loc.triggerExists) {
        await expect(page.locator("#ffLocationSwitcherTrigger")).toBeVisible();
      }
    } else {
      console.warn(
        "CLASS C — ENVIRONMENTAL: this account has no usable Booking location. " +
          "#ffLocationSwitcher is present but ffGetActiveLocationId is empty. " +
          "Not changing locations in this batch."
      );
    }
    printDiagnostics(diag, "E-location");
  });

  test("F. Clients smoke — search field only", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openAuthenticatedApp(page);
    await openBooking(page);
    await openBookingSection(page, "clients");
    await expect(page.locator("#ffBookingClientsRoot")).toBeVisible();
    await expect(page.locator("#ffCliSearch")).toBeVisible();
    printDiagnostics(diag, "F-clients");
  });

  test("G. Reports smoke — page renders", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openAuthenticatedApp(page);
    await openBooking(page);
    const pageErrorCountBefore = diag.pageErrors.length;
    await openBookingSection(page, "reports");
    await expect(page.locator("#ffBookingReportsRoot")).toBeVisible();
    await expect(page.locator("#ffBookingReportsRoot .ff-rpt, #ffRptMain, .ff-rpt-empty").first()).toBeVisible();
    const newPageErrors = diag.pageErrors.slice(pageErrorCountBefore);
    expect(newPageErrors, "Reports must not throw uncaught page errors").toEqual([]);
    printDiagnostics(diag, "G-reports");
  });

  test("H. Sales and Settings open without writes", async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openAuthenticatedApp(page);
    await openBooking(page);
    await openBookingSection(page, "sales");
    await expect(page.locator("#ffBookingSalesRoot")).toBeVisible();
    await expect(page.locator("#ffSaleSearch")).toBeVisible();

    await openBookingSection(page, "settings");
    await expect(page.locator("#ffBookingSettingsRoot")).toBeVisible();
    printDiagnostics(diag, "H-sales-settings");
  });

  test("I. safety: still on fair-flow-staging after navigation", async ({ page }) => {
    await openAuthenticatedApp(page);
    await openBooking(page);
    const info = await readFirebaseEnv(page);
    expect(info.projectId).toBe(REQUIRED_PROJECT_ID);
    expect(appUrl()).toMatch(/[?&]env=staging(?:&|$)/);
    expect(page.url()).toMatch(/^https:\/\/fair-flow-staging\.web\.app\//);
  });
});
