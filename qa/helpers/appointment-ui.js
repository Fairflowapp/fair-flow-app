"use strict";

const { expect } = require("@playwright/test");
const { openBooking, waitForCalendarReady } = require("./booking");

const FIXTURE = {
  salonId: "ffBookingQa",
  locationId: "qaLoc1",
  providerOneId: "qaProv1",
  providerTwoId: "qaProv2",
  serviceManiId: "qaServiceManicure",
  servicePediId: "qaServicePedicure",
  serviceManiName: "QA Manicure",
  servicePediName: "QA Pedicure",
  clientId: "qaAppointmentClient",
  clientQuery: "QA Appointment",
  clientName: "QA Appointment Client",
  categoryName: "QA Hands",
};

function minutesToOptionValue(startMin) {
  const h = Math.floor(Number(startMin) / 60);
  const m = Number(startMin) % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

async function openReadyCalendar(page) {
  await openBooking(page);
  await waitForCalendarReady(page);
}

async function goToFutureDay(page, daysAhead) {
  await page.locator('#ffBookingCalendarRoot [data-ff-cal-act="today"]').click();
  await waitForCalendarReady(page);
  const n = Number(daysAhead) > 0 ? Number(daysAhead) : 2;
  for (let i = 0; i < n; i += 1) {
    await page.locator('#ffBookingCalendarRoot [data-ff-cal-act="next"]').click();
    await waitForCalendarReady(page);
  }
  return page.evaluate(() => window.ffBookingCalState && window.ffBookingCalState.getSelectedDateKey
    ? window.ffBookingCalState.getSelectedDateKey()
    : "");
}

async function waitForProviders(page) {
  await page.locator('#ffBookingCalendarRoot [data-ff-cal-emp="' + FIXTURE.providerOneId + '"]').waitFor({
    state: "visible",
    timeout: 20000,
  });
  await page.locator('#ffBookingCalendarRoot [data-ff-cal-emp="' + FIXTURE.providerTwoId + '"]').waitFor({
    state: "visible",
    timeout: 20000,
  });
}

async function clickCalendarSlot(page, providerId, startMin) {
  await page.evaluate(({ providerId, startMin }) => {
    const root = document.getElementById("ffBookingCalendarRoot");
    const vp = root && root.querySelector("[data-ff-cal-viewport]");
    const lay = window.ffBookingCalLayout;
    const st = window.ffBookingCalState;
    if (!vp || !lay || !st) throw new Error("calendar layout is not ready");
    const axis = st.getAxis();
    const y = lay.timeToY(Number(startMin) + 6, axis.startMin);
    vp.scrollTop = Math.max(0, y - 120);
  }, { providerId, startMin });

  const point = await page.evaluate(({ providerId, startMin }) => {
    const root = document.getElementById("ffBookingCalendarRoot");
    const col = root.querySelector('[data-ff-cal-emp="' + providerId + '"]');
    const surface = root.querySelector("[data-ff-cal-surface]");
    const lay = window.ffBookingCalLayout;
    const axis = window.ffBookingCalState.getAxis();
    if (!col || !surface) throw new Error("missing calendar column/surface");
    const y = lay.timeToY(Number(startMin) + 6, axis.startMin);
    const surfaceRect = surface.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();
    return {
      x: colRect.left + colRect.width / 2,
      y: surfaceRect.top + y,
    };
  }, { providerId, startMin });

  await page.mouse.click(point.x, point.y);
  await continueFromSlotClickToDrawer(page);
}

/**
 * Baseline (c2ba63e): slot click opens #ffBookingApptDrawer.
 * Calendar Block Time: slot click opens #ffBookingCalSlotChooser; QA must
 * click the product "New Appointment" action, then wait for the drawer.
 * Never invokes product create APIs.
 */
async function continueFromSlotClickToDrawer(page) {
  const drawer = page.locator("#ffBookingApptDrawer");
  const newAppointment = page.locator('#ffBookingCalSlotChooser [data-ff-cal-slot="appointment"]');
  await Promise.race([
    drawer.waitFor({ state: "visible", timeout: 15000 }),
    newAppointment.waitFor({ state: "visible", timeout: 15000 }),
  ]).catch(() => {
    throw new Error("Neither #ffBookingApptDrawer nor the Block Time slot chooser appeared after the calendar slot click.");
  });
  if (await newAppointment.isVisible() && !(await drawer.isVisible())) {
    await newAppointment.click();
  }
  await drawer.waitFor({ state: "visible", timeout: 15000 });
  await expect(page.locator("#ffApptTitle")).toContainText(/New Appointment/i);
}

async function chooseQaClient(page) {
  const input = page.locator("#ffApptClientQ");
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.fill(FIXTURE.clientQuery);
  await page.locator('#ffApptClientResults [data-ff-appt-client="' + FIXTURE.clientId + '"]').waitFor({
    state: "visible",
    timeout: 15000,
  });
  await page.locator('#ffApptClientResults [data-ff-appt-client="' + FIXTURE.clientId + '"]').click();
  await expect(page.locator("#ffApptClientChosen")).toBeVisible();
}

function serviceLine(page, rootSel, index) {
  return page.locator(rootSel + " .ff-appt-svc[data-ff-line]").nth(index || 0);
}

async function pickServiceOnLine(page, lineLocator, serviceId) {
  const searchInLine = lineLocator.locator("[data-ff-service-q]");
  if (!(await searchInLine.count())) {
    await lineLocator.locator('[data-ff-appt-act="open-service-picker"]').click();
  }
  const name = serviceId === FIXTURE.servicePediId ? FIXTURE.servicePediName : FIXTURE.serviceManiName;
  const search = page.locator("[data-ff-service-q]");
  await search.waitFor({ state: "visible", timeout: 10000 });
  await search.fill(name);
  const pick = page.locator('[data-ff-appt-act="pick-service"][data-ff-service="' + serviceId + '"]');
  await pick.waitFor({ state: "visible", timeout: 10000 });
  await pick.click();
}

async function pickProviderOnLine(page, lineLocator, providerId) {
  const chip = lineLocator.locator('[data-ff-appt-act="open-provider-picker"]');
  await chip.scrollIntoViewIfNeeded();
  const box = await chip.boundingBox();
  if (!box) throw new Error("provider chip has no box");
  // QA workaround, not a product pass: the invisible start-time <select> can
  // steal a center-click on this chip. Lower-edge click is the stable hit.
  await page.mouse.click(box.x + Math.min(20, box.width / 2), box.y + box.height - 4);
  const picker = page.locator('[data-ff-picker="provider"]');
  const pick = picker.locator('[data-ff-appt-act="pick-provider"][data-ff-provider="' + providerId + '"]');
  await pick.waitFor({ state: "visible", timeout: 10000 });
  await expect(pick).toBeAttached();
  await pick.click();
  await expect(picker).toHaveCount(0);
  await expect(chip).toBeVisible();
}

async function setLineStart(page, lineLocator, startMin) {
  // Product option values are minutes-from-midnight, e.g. 660 for 11:00.
  await lineLocator.locator('[data-ff-line-field="start"]').selectOption(String(startMin));
}

async function setQaNote(page, note) {
  const notes = page.locator("#ffApptNotes");
  if (await notes.isHidden()) {
    await page.locator("#ffApptNoteToggle").click();
  }
  await notes.fill(note);
}

async function bookAppointment(page) {
  await page.locator("#ffApptCreate").click();
  await page.locator("#ffBookingApptDrawer").waitFor({ state: "hidden", timeout: 20000 }).catch(async () => {
    const err = await page.locator("#ffApptError").textContent().catch(() => "");
    throw new Error("Create drawer did not close. " + String(err || "").trim());
  });
}

async function waitForCard(page, appointmentId) {
  const card = page.locator('#ffBookingCalendarRoot [data-ff-cal-card="' + appointmentId + '"]').first();
  await card.waitFor({ state: "visible", timeout: 20000 });
  return card;
}

async function openCardDetails(page, appointmentId) {
  await page.locator('#ffBookingCalendarRoot [data-ff-cal-card="' + appointmentId + '"]').first().click();
  await page.locator("#ffBookingApptDetails").waitFor({ state: "visible", timeout: 15000 });
  await expect(page.locator("#ffApdTitle")).toBeVisible();
}

async function readDetails(page) {
  return page.evaluate(() => {
    const text = (id) => {
      const el = document.getElementById(id);
      return el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : "";
    };
    return {
      client: text("ffApdClient"),
      services: text("ffApdServices"),
      date: text("ffApdDate"),
      location: text("ffApdLocation"),
      notes: text("ffApdNotes"),
      status: text("ffApdStatus"),
    };
  });
}

async function currentCalendarCards(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("#ffBookingCalendarRoot [data-ff-cal-card]")).map((el) => ({
      appointmentId: el.getAttribute("data-ff-cal-card") || "",
      providerId: el.closest("[data-ff-cal-emp]") ? el.closest("[data-ff-cal-emp]").getAttribute("data-ff-cal-emp") : "",
      requested: el.getAttribute("data-ff-cal-requested") === "1" || el.classList.contains("is-requested"),
      status: el.getAttribute("data-ff-cal-status") || "",
      text: String(el.textContent || "").replace(/\s+/g, " ").trim(),
    }));
  });
}

async function findCreatedAppointmentId(page, note) {
  return page.evaluate((qaNote) => {
    const store = window.ffBookingCalAppointments;
    if (store && typeof store.getCached === "function") {
      const rows = store.getCached() || [];
      const hit = rows.find((row) => row && String(row.notes || "").indexOf(qaNote) !== -1);
      if (hit && hit.appointmentId) return hit.appointmentId;
    }
    const cards = Array.from(document.querySelectorAll("#ffBookingCalendarRoot [data-ff-cal-card]"));
    return cards.length ? cards[cards.length - 1].getAttribute("data-ff-cal-card") : "";
  }, note);
}

async function enterEdit(page) {
  await page.locator("#ffApdEditBtn").click();
  await expect(page.locator("#ffApdEdit")).toBeVisible();
}

async function saveEdit(page) {
  const save = page.locator("#ffApdSave");
  await expect(save).toBeEnabled();
  await save.click();
  await page.locator("#ffApdEdit").waitFor({ state: "hidden", timeout: 20000 }).catch(async () => {
    const err = await page.evaluate(() => {
      const panel = document.getElementById("ffApdError");
      const line = document.querySelector("#ffApdLines .ff-appt-error");
      return [panel && panel.textContent, line && line.textContent].filter(Boolean).join(" | ");
    });
    throw new Error("Edit did not leave the editor. " + String(err || "").trim());
  });
}

async function cancelThroughUi(page) {
  await page.locator("#ffApdCancelBtn").click();
  await expect(page.locator("#ffApdCancel")).toBeVisible();
  await page.locator("#ffApdCancelReason").fill("FF-QA cancel");
  await page.locator("#ffApdConfirmCancel").click();
  // Successful cancel closes the details panel; it does not stay open on a Cancelled status.
  await page.locator("#ffBookingApptDetails").waitFor({ state: "hidden", timeout: 20000 }).catch(async () => {
    const err = await page.locator("#ffApdCancelError").textContent().catch(() => "");
    throw new Error("Cancel confirmation did not close details. " + String(err || "").trim());
  });
}

async function dragCardByMinutes(page, appointmentId, deltaMin) {
  const card = page.locator('#ffBookingCalendarRoot [data-ff-cal-card="' + appointmentId + '"]').first();
  await card.waitFor({ state: "attached", timeout: 20000 });
  await page.evaluate((id) => {
    const root = document.getElementById("ffBookingCalendarRoot");
    const el = root && root.querySelector('[data-ff-cal-card="' + id + '"]');
    const vp = root && root.querySelector("[data-ff-cal-viewport]");
    const lay = window.ffBookingCalLayout;
    const st = window.ffBookingCalState;
    if (!el || !vp) return;
    const start = Number(el.getAttribute("data-ff-cal-start"));
    if (lay && st && typeof lay.timeToY === "function" && Number.isFinite(start)) {
      const axis = st.getAxis();
      vp.scrollTop = Math.max(0, lay.timeToY(start + 6, axis.startMin) - 120);
      return;
    }
    el.scrollIntoView({ block: "center", inline: "nearest" });
  }, appointmentId);
  let box = null;
  await expect(async () => {
    await expect(card).toBeVisible();
    box = await card.boundingBox();
    if (!box || box.width < 8 || box.height < 8) throw new Error("appointment card has no box");
  }).toPass({ timeout: 10000 });
  const startX = box.x + Math.min(24, box.width / 2);
  const startY = box.y + Math.min(12, box.height / 2);
  const dy = (Number(deltaMin) / 60) * 72;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + dy, { steps: 12 });
  await page.mouse.up();
}

module.exports = {
  FIXTURE,
  serviceLine,
  minutesToOptionValue,
  openReadyCalendar,
  goToFutureDay,
  waitForProviders,
  clickCalendarSlot,
  continueFromSlotClickToDrawer,
  chooseQaClient,
  pickServiceOnLine,
  pickProviderOnLine,
  setLineStart,
  setQaNote,
  bookAppointment,
  waitForCard,
  openCardDetails,
  readDetails,
  currentCalendarCards,
  findCreatedAppointmentId,
  enterEdit,
  saveEdit,
  cancelThroughUi,
  dragCardByMinutes,
};
