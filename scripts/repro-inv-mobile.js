/**
 * Reproduce the mobile Inventory freeze reported on production:
 * iPhone-sized viewport with touch, log in as the test account,
 * open Inventory, then try to switch categories/subcategories.
 * Saves screenshots to /tmp/inv-repro-*.png and dumps console errors.
 *
 * Usage: node scripts/repro-inv-mobile.js
 */
const { chromium, devices } = require("playwright");

const URL = process.env.FF_URL || "https://fairflowapp-db841.web.app";
const EMAIL = "admin_test@fairflowapp.com";
const PW = "FfInvDebug!2026";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "en-US",
  });
  const page = await ctx.newPage();

  // Seed the per-device active location (this is the variable we're testing:
  // her phone may hold a different stored location than her desktop).
  const locId = process.env.FF_LOC_ID || "";
  if (locId) {
    await page.addInitScript((id) => {
      try { localStorage.setItem("ff_active_location_id", id); } catch (_) {}
    }, locId);
    console.log("seeded ff_active_location_id =", locId);
  }

  const logs = [];
  page.on("console", (m) => {
    const t = `[${m.type()}] ${m.text()}`;
    logs.push(t);
    if (m.type() === "error" || m.type() === "warning") console.log("PAGE", t.slice(0, 300));
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 500)));

  console.log("goto", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-email", { timeout: 30000 });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-password", PW);
  await page.tap("#login-button");
  console.log("logged in, waiting for app...");

  // Wait for the main app to boot (goToInventory exposed by inventory-nav-stub).
  await page.waitForFunction(() => typeof window.goToInventory === "function", null, { timeout: 60000 });
  await page.waitForTimeout(6000); // let safe-loader finish module loads
  await page.screenshot({ path: "/tmp/inv-repro-0-app.png" });

  console.log("opening Inventory...");
  await page.evaluate(() => window.goToInventory());
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "/tmp/inv-repro-1-inventory.png" });

  const state1 = await page.evaluate(() => {
    const scr = document.getElementById("inventoryScreen");
    const layout = scr && scr.querySelector(".ff-inv2-layout");
    const strip = scr && scr.querySelector(".ff-inv2-mobile-cat-strip");
    const panel = scr && scr.querySelector(".ff-inv2-aside-panel");
    const subs = scr ? Array.from(scr.querySelectorAll(".ff-inv2-sub")).map((s) => ({
      id: s.getAttribute("data-sub-id"), name: s.textContent.trim(), active: s.classList.contains("is-active"),
    })) : [];
    const cats = scr ? Array.from(scr.querySelectorAll("[data-cat-toggle]")).map((c) => c.getAttribute("data-cat-toggle")) : [];
    const cs = scr && getComputedStyle(scr);
    return {
      display: scr && scr.style.display,
      pointerEvents: cs && cs.pointerEvents,
      zIndex: cs && cs.zIndex,
      layoutClass: layout && layout.className,
      stripVisible: !!(strip && strip.offsetParent !== null),
      stripText: strip && strip.textContent.trim(),
      panelVisible: !!(panel && panel.offsetParent !== null),
      cats, subs,
      crumb: scr && (scr.querySelector(".ff-inv2-crumb") || {}).textContent,
      bodyText: scr ? scr.innerText.slice(0, 400) : "(no screen)",
    };
  });
  console.log("STATE after open:", JSON.stringify(state1, null, 1));

  // If mobile collapsed strip is visible — tap it to expand the category panel.
  if (state1.stripVisible) {
    console.log("tapping category strip...");
    await page.tap(".ff-inv2-mobile-cat-strip");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "/tmp/inv-repro-2-strip-tapped.png" });
    const afterStrip = await page.evaluate(() => {
      const scr = document.getElementById("inventoryScreen");
      const panel = scr && scr.querySelector(".ff-inv2-aside-panel");
      return { panelVisible: !!(panel && panel.offsetParent !== null) };
    });
    console.log("after strip tap:", JSON.stringify(afterStrip));
  }

  // Expand first collapsed category, if any.
  const catToggles = await page.$$("#inventoryScreen [data-cat-toggle]");
  console.log("category toggles:", catToggles.length);
  for (const t of catToggles) {
    const visible = await t.isVisible();
    if (visible) {
      console.log("tapping category toggle...");
      await t.tap();
      await page.waitForTimeout(1200);
      break;
    }
  }
  await page.screenshot({ path: "/tmp/inv-repro-3-cat-tapped.png" });

  // Tap a NON-active subcategory and see whether selection changes.
  const before = await page.evaluate(() => {
    const el = document.querySelector("#inventoryScreen .ff-inv2-sub.is-active");
    return el ? el.textContent.trim() : null;
  });
  const subEls = await page.$$("#inventoryScreen .ff-inv2-sub:not(.is-active)");
  console.log("inactive subs:", subEls.length, "active before:", before);
  for (const s of subEls) {
    if (await s.isVisible()) {
      const nm = (await s.textContent()).trim();
      console.log("tapping sub:", nm);
      await s.tap();
      await page.waitForTimeout(2500);
      break;
    }
  }
  await page.screenshot({ path: "/tmp/inv-repro-4-sub-tapped.png" });
  const after = await page.evaluate(() => {
    const scr = document.getElementById("inventoryScreen");
    const el = scr && scr.querySelector(".ff-inv2-sub.is-active");
    const crumb = scr && scr.querySelector(".ff-inv2-crumb");
    return {
      active: el ? el.textContent.trim() : null,
      crumb: crumb ? crumb.textContent.trim() : null,
      loading: scr ? /Loading/i.test(scr.innerText) : null,
    };
  });
  console.log("after sub tap:", JSON.stringify(after));

  // Simulate leaving to Tickets and coming back (the "blank screen" report).
  console.log("simulating Tickets -> back to Inventory...");
  await page.evaluate(() => { if (typeof window.goToTickets === "function") window.goToTickets(); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "/tmp/inv-repro-5-tickets.png" });
  await page.evaluate(() => window.goToInventory());
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "/tmp/inv-repro-6-back-to-inventory.png" });
  const back = await page.evaluate(() => {
    const scr = document.getElementById("inventoryScreen");
    return { display: scr && scr.style.display, text: scr ? scr.innerText.slice(0, 300) : null };
  });
  console.log("back to inventory:", JSON.stringify(back));

  console.log("---- last console errors ----");
  logs.filter((l) => l.startsWith("[error]")).slice(-15).forEach((l) => console.log(l.slice(0, 300)));

  await browser.close();
  console.log("DONE — screenshots in /tmp/inv-repro-*.png");
})().catch((e) => { console.error("REPRO FAILED:", e); process.exit(1); });
