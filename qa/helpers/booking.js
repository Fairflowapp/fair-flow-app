"use strict";

async function waitForBookingSwitch(page) {
  const switcher = page.locator("#ffProductSwitch.is-ready");
  await switcher.waitFor({ state: "visible", timeout: 45000 });
  await page.locator('#ffProductSwitch [data-ff-area="booking"]').waitFor({
    state: "visible",
    timeout: 15000,
  });
}

async function openBooking(page) {
  await waitForBookingSwitch(page);
  await page.locator('#ffProductSwitch [data-ff-area="booking"]').click();
  await waitForBookingWorkspace(page);
}

async function waitForBookingWorkspace(page) {
  const workspace = page.locator("#ffBookingWorkspace");
  await workspace.waitFor({ state: "attached", timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById("ffBookingWorkspace");
    if (!el) return false;
    if (el.hasAttribute("hidden")) return false;
    return !!(document.body && document.body.classList.contains("ff-booking-area"));
  }, null, { timeout: 20000 });
}

async function waitForCalendarReady(page) {
  const root = page.locator("#ffBookingCalendarRoot");
  await root.waitFor({ state: "visible", timeout: 20000 });
  await root.locator(".ff-cal").waitFor({ state: "visible", timeout: 20000 });
  await root.locator('[data-ff-cal-act="today"]').waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const rootEl = document.getElementById("ffBookingCalendarRoot");
    if (!rootEl) return false;
    const columns = rootEl.querySelectorAll("[data-ff-cal-emp]").length;
    const empty = !!rootEl.querySelector(".ff-cal-empty");
    return columns > 0 || empty;
  }, null, { timeout: 20000 });
}

async function openBookingSection(page, section) {
  await page.locator('[data-ff-booking-section="' + section + '"]').click();
  const pageEl = page.locator('[data-ff-booking-page="' + section + '"]');
  await pageEl.waitFor({ state: "visible", timeout: 15000 });
}

async function readActiveLocation(page) {
  return page.evaluate(() => {
    const mount = document.getElementById("ffLocationSwitcher");
    const trigger = document.getElementById("ffLocationSwitcherTrigger");
    let activeId = "";
    try {
      if (typeof window.ffGetActiveLocationId === "function") {
        activeId = String(window.ffGetActiveLocationId() || "").trim();
      }
    } catch (_) {}
    if (!activeId) {
      try {
        activeId = String(window.__ff_active_location_id || "").trim();
      } catch (_) {}
    }
    return {
      mountExists: !!mount,
      triggerExists: !!trigger,
      mountVisible: !!(mount && mount.style.display !== "none" && mount.offsetParent !== null),
      activeId,
    };
  });
}

module.exports = {
  waitForBookingSwitch,
  openBooking,
  waitForBookingWorkspace,
  waitForCalendarReady,
  openBookingSection,
  readActiveLocation,
};
