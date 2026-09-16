"use strict";

const { expect } = require("@playwright/test");
const { openReadyCalendar, goToFutureDay, waitForProviders, FIXTURE } = require("./appointment-ui");

async function clickSlotForTimeBlock(page, providerId, startMin) {
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
  const chooser = page.locator('#ffBookingCalSlotChooser [data-ff-cal-slot="block"]');
  await chooser.waitFor({ state: "visible", timeout: 15000 });
  await expect(chooser).toHaveText(/Time Block/);
  await chooser.click();
  await page.locator("#ffBookingBlockEditor").waitFor({ state: "visible", timeout: 15000 });
  await expect(page.locator("#ffBookingBlockEditor h2")).toHaveText("Time Block");
}

async function selectReason(page, reason) {
  await page.locator('#ffBookingBlockEditor [data-ff-block-reason="' + reason + '"]').click();
  await expect(page.locator('#ffBookingBlockEditor [data-ff-block-reason="' + reason + '"]')).toHaveAttribute("aria-checked", "true");
}

async function setNote(page, note) {
  const input = page.locator('#ffBookingBlockEditor [name="ff-block-note"]');
  await input.fill(note);
}

async function setStartMin(page, startMin) {
  await page.locator('#ffBookingBlockEditor [name="ff-block-start"]').selectOption(String(startMin));
}

async function setDuration(page, minutes) {
  await page.locator('#ffBookingBlockEditor [name="ff-block-duration"]').selectOption(String(minutes));
}

async function assertNoBlockTimeCopy(page, rootSel) {
  const root = page.locator(rootSel);
  const labeled = root.locator("h2, [data-ff-cal-menu='block'], [data-ff-block-act='save'], [data-ff-cal-slot='block']").first();
  await expect(root).toBeVisible();
  await expect(labeled).toBeVisible();
  await expect(labeled).toHaveText(/Time Block/);
  await expect(root).toContainText(/Time Block/);
  await expect(root, "UI must say Time Block, not Block Time").not.toContainText(/Block Time/);
}

async function saveEditor(page) {
  await page.locator('#ffBookingBlockEditor [data-ff-block-act="save"]').click();
  await page.locator("#ffBookingBlockEditor").waitFor({ state: "hidden", timeout: 20000 });
}

async function waitForBlockCard(page, blockId) {
  const card = page.locator('#ffBookingCalendarRoot [data-ff-cal-block="' + blockId + '"]');
  await card.waitFor({ state: "visible", timeout: 20000 });
  return card;
}

async function waitForBlockCardAt(page, providerId, startMin) {
  const card = page.locator(
    '#ffBookingCalendarRoot [data-ff-cal-emp="' + providerId + '"] [data-ff-cal-block][data-ff-cal-start="' + startMin + '"]'
  ).first();
  await card.waitFor({ state: "visible", timeout: 20000 });
  return card;
}

async function readCardLines(card) {
  const reason = (await card.locator(".ff-cal-block-reason").innerText()).trim();
  const time = (await card.locator(".ff-cal-block-time").innerText()).trim();
  const noteCount = await card.locator(".ff-cal-block-note").count();
  const note = noteCount ? (await card.locator(".ff-cal-block-note").innerText()).trim() : "";
  return { reason, time, note, hasNoteLine: noteCount > 0 };
}

async function openBlockEditor(page, blockId) {
  const card = await waitForBlockCard(page, blockId);
  await card.click();
  await page.locator("#ffBookingBlockEditor").waitFor({ state: "visible", timeout: 15000 });
}

async function readEditorFacts(page) {
  return page.evaluate(() => {
    const root = document.getElementById("ffBookingBlockEditor");
    if (!root) return null;
    const reason = root.querySelector("[data-ff-block-reason][aria-checked='true']");
    const note = root.querySelector("[name='ff-block-note']");
    const start = root.querySelector("[name='ff-block-start']");
    const duration = root.querySelector("[name='ff-block-duration']");
    return {
      title: root.querySelector("h2") ? root.querySelector("h2").textContent : "",
      facts: root.querySelector(".ff-cal-block-editor-facts")
        ? root.querySelector(".ff-cal-block-editor-facts").textContent
        : "",
      reason: reason ? reason.getAttribute("data-ff-block-reason") : "",
      note: note ? note.value : "",
      startMin: start ? Number(start.value) : NaN,
      duration: duration && duration.value !== "custom" ? Number(duration.value) : NaN,
    };
  });
}

async function dragBlockByMinutes(page, blockId, deltaMin) {
  const card = await waitForBlockCard(page, blockId);
  const box = await card.boundingBox();
  if (!box) throw new Error("Time Block card has no box");
  const startX = box.x + Math.min(20, box.width / 2);
  const startY = box.y + Math.min(10, box.height / 2);
  const dy = (Number(deltaMin) / 60) * 72;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + dy, { steps: 16 });
  await page.mouse.up();
}

async function expectNoProviderMoveConfirm(page) {
  const dialog = page.locator("#ffCalMoveConfirm");
  if (await dialog.count()) {
    await expect(dialog).toBeHidden();
  }
}

async function openProviderMenu(page, providerId) {
  const menu = page.locator("#ffBookingCalProviderMenu");
  const block = menu.locator('[data-ff-cal-menu="block"]');
  await expect(async () => {
    const ready = await page.evaluate((id) => {
      const btn = document.querySelector('#ffBookingCalendarRoot [data-ff-cal-provider="' + id + '"]');
      const st = window.ffBookingCalState;
      const api = window.ffBookingCalMenu;
      const root = document.getElementById("ffBookingCalProviderMenu");
      if (!btn || !api || typeof api.open !== "function") throw new Error("provider menu is not ready");
      const alreadyOpen = !!(
        api.isOpen && api.isOpen()
        && root
        && !root.hasAttribute("hidden")
        && root.querySelector('[data-ff-cal-menu="block"]')
      );
      if (!alreadyOpen) {
        api.open(btn, {
          providerId: id,
          dateKey: st && st.getSelectedDateKey ? st.getSelectedDateKey() : "",
          locationId: st && st.getLocationId ? st.getLocationId() : "",
          focusProviderId: st && st.getFocusProviderId ? st.getFocusProviderId() : "",
        });
      }
      return !!(document.getElementById("ffBookingCalProviderMenu")
        && !document.getElementById("ffBookingCalProviderMenu").hasAttribute("hidden")
        && document.querySelector('#ffBookingCalProviderMenu [data-ff-cal-menu="block"]'));
    }, providerId);
    expect(ready, "provider menu did not stay open").toBeTruthy();
    await expect(menu).toBeVisible();
    await expect(block).toBeVisible();
    await expect(block).toHaveText("Time Block");
  }).toPass({ timeout: 15000 });
}

async function dragBlockToProvider(page, blockId, toProviderId, startMin) {
  const card = await waitForBlockCard(page, blockId);
  const box = await card.boundingBox();
  if (!box) throw new Error("Time Block card has no box");
  const dest = await page.evaluate(({ providerId, startMin }) => {
    const root = document.getElementById("ffBookingCalendarRoot");
    const col = root.querySelector('[data-ff-cal-emp="' + providerId + '"]');
    const surface = root.querySelector("[data-ff-cal-surface]");
    const lay = window.ffBookingCalLayout;
    const axis = window.ffBookingCalState.getAxis();
    if (!col || !surface) throw new Error("missing destination column");
    const y = lay.timeToY(Number(startMin) + 6, axis.startMin);
    const surfaceRect = surface.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();
    return {
      x: colRect.left + colRect.width / 2,
      y: surfaceRect.top + y,
    };
  }, { providerId: toProviderId, startMin });
  await page.mouse.move(box.x + Math.min(20, box.width / 2), box.y + Math.min(10, box.height / 2));
  await page.mouse.down();
  await page.mouse.move(dest.x, dest.y, { steps: 16 });
  await page.mouse.up();
}

async function confirmMove(page, accept) {
  const dialog = page.locator("#ffCalMoveConfirm");
  await dialog.waitFor({ state: "visible", timeout: 15000 });
  await expect(page.locator("#ffCalMoveTitle")).toHaveText("Move Time Block?");
  if (accept) {
    await page.locator('#ffCalMoveConfirm [data-ff-cal-move="yes"]').click();
  } else {
    await page.locator('#ffCalMoveConfirm [data-ff-cal-move="no"]').click();
  }
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
}

module.exports = {
  FIXTURE,
  openReadyCalendar,
  goToFutureDay,
  waitForProviders,
  clickSlotForTimeBlock,
  selectReason,
  setNote,
  setStartMin,
  setDuration,
  assertNoBlockTimeCopy,
  saveEditor,
  waitForBlockCard,
  waitForBlockCardAt,
  readCardLines,
  openBlockEditor,
  readEditorFacts,
  dragBlockByMinutes,
  expectNoProviderMoveConfirm,
  openProviderMenu,
  dragBlockToProvider,
  confirmMove,
};
