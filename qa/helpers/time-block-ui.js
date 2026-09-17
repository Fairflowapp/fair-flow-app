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

async function waitForNextPaint(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function assertNoBlockTimeCopy(page, rootSel, opts) {
  const root = page.locator(rootSel);
  const labeled = root.locator("h2, [data-ff-cal-menu='block'], [data-ff-block-act='save'], [data-ff-cal-slot='block']").first();
  if (opts && opts.reopenProviderId) {
    await waitForNextPaint(page);
    await openProviderMenu(page, opts.reopenProviderId);
  }
  await expect(async () => {
    if (opts && opts.reopenProviderId) {
      const hidden = await root.evaluate((el) => !el || el.hasAttribute("hidden") || !el.offsetParent).catch(() => true);
      if (hidden) await openProviderMenu(page, opts.reopenProviderId);
    }
    await expect(root).toBeVisible();
    await expect(labeled).toBeVisible();
    await expect(labeled).toHaveText(/Time Block/);
    await expect(root).toContainText(/Time Block/);
    await expect(root, "UI must say Time Block, not Block Time").not.toContainText(/Block Time/);
  }).toPass({ timeout: 20000 });
}

async function saveEditor(page) {
  await page.locator('#ffBookingBlockEditor [data-ff-block-act="save"]').click();
  await page.locator("#ffBookingBlockEditor").waitFor({ state: "hidden", timeout: 20000 });
}

async function waitForCardBox(card) {
  await expect.poll(async () => {
    const attached = await card.evaluate((el) => {
      if (!el || !el.isConnected) return null;
      const box = el.getBoundingClientRect();
      return { w: box.width, h: box.height };
    }).catch(() => null);
    return attached && attached.h >= 2 && attached.w >= 2 ? attached.h : 0;
  }, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
}

async function waitForBlockCard(page, blockId) {
  const card = page.locator('#ffBookingCalendarRoot [data-ff-cal-block="' + blockId + '"]');
  await card.waitFor({ state: "visible", timeout: 20000 });
  await waitForNextPaint(page);
  await waitForCardBox(card);
  return card;
}

async function waitForBlockCardAt(page, providerId, startMin) {
  const card = page.locator(
    '#ffBookingCalendarRoot [data-ff-cal-emp="' + providerId + '"] [data-ff-cal-block][data-ff-cal-start="' + startMin + '"]'
  ).first();
  await card.waitFor({ state: "visible", timeout: 20000 });
  await waitForNextPaint(page);
  await waitForCardBox(card);
  return card;
}

async function readCardLines(card) {
  const reason = (await card.locator(".ff-cal-block-reason").innerText()).trim();
  const time = (await card.locator(".ff-cal-block-time").innerText()).trim();
  const noteCount = await card.locator(".ff-cal-block-note").count();
  const note = noteCount ? (await card.locator(".ff-cal-block-note").innerText()).trim() : "";
  return { reason, time, note, hasNoteLine: noteCount > 0 };
}

async function measureCardLine(card, selector) {
  return card.evaluate((el, sel) => {
    if (!el || !el.isConnected) return { ok: false, reason: "detached" };
    const line = el.querySelector(sel);
    if (!line) {
      const box = el.getBoundingClientRect();
      return { ok: false, reason: "missing", card: { w: box.width, h: box.height } };
    }
    const cardBox = el.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    const style = getComputedStyle(line);
    const snap = {
      card: { x: cardBox.x, y: cardBox.y, w: cardBox.width, h: cardBox.height },
      line: { x: lineBox.x, y: lineBox.y, w: lineBox.width, h: lineBox.height, text: String(line.textContent || "").trim() },
      display: style.display,
      visibility: style.visibility,
    };
    if (style.display === "none" || style.visibility === "hidden") return { ok: false, reason: "hidden", ...snap };
    if (lineBox.height < 2) return { ok: false, reason: "collapsed", ...snap };
    if (lineBox.bottom > cardBox.bottom + 1.5 || lineBox.top < cardBox.top - 1.5) {
      return { ok: false, reason: "clipped", ...snap };
    }
    return { ok: true, text: snap.line.text, ...snap };
  }, selector);
}

async function assertCardLineVisible(card, selector) {
  let previous = null;
  await expect(async () => {
    const result = await measureCardLine(card, selector);
    const prior = previous;
    previous = result;
    expect(result.ok, selector + " must stay visible on the Time Block card " + JSON.stringify(result)).toBeTruthy();
    const sameHeight = !!(prior && prior.ok && result.card && prior.card
      && Math.abs(prior.card.h - result.card.h) <= 0.5
      && Math.abs(prior.line.h - result.line.h) <= 0.5);
    expect(sameHeight, "Time Block card layout is still settling " + JSON.stringify({ prior, result })).toBeTruthy();
  }).toPass({ timeout: 15000 });
  return previous;
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
  const trigger = page.locator('#ffBookingCalendarRoot [data-ff-cal-provider="' + providerId + '"]');
  await trigger.waitFor({ state: "visible", timeout: 20000 });
  await waitForNextPaint(page);
  await expect(async () => {
    const ready = await page.evaluate((id) => {
      const btn = document.querySelector('#ffBookingCalendarRoot [data-ff-cal-provider="' + id + '"]');
      const st = window.ffBookingCalState;
      const api = window.ffBookingCalMenu;
      const root = document.getElementById("ffBookingCalProviderMenu");
      if (!btn || !api || typeof api.open !== "function") {
        return { ok: false, why: "provider menu is not ready" };
      }
      const alreadyOpen = !!(
        api.isOpen && api.isOpen()
        && root
        && !root.hasAttribute("hidden")
        && root.querySelector('[data-ff-cal-menu="block"]')
      );
      if (!alreadyOpen) {
        if (api.isOpen && api.isOpen() && typeof api.close === "function") api.close();
        api.open(btn, {
          providerId: id,
          dateKey: st && st.getSelectedDateKey ? st.getSelectedDateKey() : "",
          locationId: st && st.getLocationId ? st.getLocationId() : "",
          focusProviderId: st && st.getFocusProviderId ? st.getFocusProviderId() : "",
        });
      }
      const el = document.getElementById("ffBookingCalProviderMenu");
      const item = el && el.querySelector('[data-ff-cal-menu="block"]');
      return {
        ok: !!(el && !el.hasAttribute("hidden") && item),
        hidden: !!(el && el.hasAttribute("hidden")),
        hasItem: !!item,
        text: item ? String(item.textContent || "").trim() : "",
      };
    }, providerId);
    expect(ready.ok, "provider menu did not stay open " + JSON.stringify(ready)).toBeTruthy();
    await expect(menu).toBeVisible();
    await expect(block).toBeVisible();
    await expect(block).toHaveText("Time Block");
  }).toPass({ timeout: 8000 });
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
  assertCardLineVisible,
  openBlockEditor,
  readEditorFacts,
  dragBlockByMinutes,
  expectNoProviderMoveConfirm,
  openProviderMenu,
  dragBlockToProvider,
  confirmMove,
};
