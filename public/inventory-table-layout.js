// inventory-table-layout.js
// Mobile column hide, colgroup, width sync, and column resize for the inventory grid.
// Extracted verbatim from inventory-table.js (Phase T2).

import { invState } from "./inventory-state.js?v=20260902_inv_iso";

import { persistColumnWidthsToFirestore } from "./inventory-table-persist.js?v=20260902_inv_iso";

// Used by the mobile column-width pass (getInvMobileGroupSubColWidthsPx).
// These were never imported when this file was extracted from
// inventory-table.js, so on phones every table render with rows crashed with
// "getCellApprovedInfo is not defined" — the mobile-only Inventory freeze.
import {
  computeOrder,
  formatOrderDisplay,
  getCellApprovedInfo,
  parseNum,
} from "./inventory-helpers.js?v=20260902_inv_iso";

const INV_MOBILE_COL_HIDE_SS_KEY = "ff_inv_mobile_col_hide_v1";

function getInvColWidths() {
  if (!invState._invColWidths) {
    invState._invColWidths = {
      rowDnd: 28,
      hash: 52,
      code: 76,
      name: 192,
      groupSubById: {},
      url: 96,
      supplier: 96,
    };
  }
  if (invState._groups) {
    for (const g of invState._groups) {
      if (invState._invColWidths.groupSubById[g.id] == null) {
        invState._invColWidths.groupSubById[g.id] = 72;
      }
    }
    const ids = new Set(invState._groups.map((x) => x.id));
    for (const k of Object.keys(invState._invColWidths.groupSubById)) {
      if (!ids.has(k)) delete invState._invColWidths.groupSubById[k];
    }
  }
  if (invState._invColWidths.rowDnd == null) invState._invColWidths.rowDnd = 28;
  return invState._invColWidths;
}

function isInvMobileNarrow() {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(max-width: 767.98px)").matches;
  } catch (_) {
    return false;
  }
}

function loadInvMobileColHideFromStorage() {
  try {
    const s = sessionStorage.getItem(INV_MOBILE_COL_HIDE_SS_KEY);
    if (!s) return;
    const o = JSON.parse(s);
    if (o && typeof o === "object") {
      invState._invMobileColHide = {
        ...invState._invMobileColHide,
        dnd: !!o.dnd,
        num: !!o.num,
        code: !!o.code,
        supplier: !!o.supplier,
        url: !!o.url,
        nameExpanded: !!o.nameExpanded,
      };
    }
  } catch (_) {}
}

function persistInvMobileColHide() {
  try {
    sessionStorage.setItem(INV_MOBILE_COL_HIDE_SS_KEY, JSON.stringify(invState._invMobileColHide));
  } catch (_) {}
}

function applyInvMobileColumnClasses() {
  const root = document.getElementById("inventoryScreen");
  if (!root) return;
  loadInvMobileColHideFromStorage();
  if (!isInvMobileNarrow()) {
    root.classList.remove(
      "ff-inv-mobile-hide-dnd",
      "ff-inv-mobile-hide-num",
      "ff-inv-mobile-hide-code",
      "ff-inv-mobile-hide-supplier",
      "ff-inv-mobile-hide-url",
      "ff-inv-mobile-name-expanded"
    );
  } else {
    root.classList.toggle("ff-inv-mobile-hide-dnd", !!invState._invMobileColHide.dnd);
    root.classList.toggle("ff-inv-mobile-hide-num", !!invState._invMobileColHide.num);
    root.classList.toggle("ff-inv-mobile-hide-code", !!invState._invMobileColHide.code);
    root.classList.toggle("ff-inv-mobile-hide-supplier", !!invState._invMobileColHide.supplier);
    root.classList.toggle("ff-inv-mobile-hide-url", !!invState._invMobileColHide.url);
    root.classList.toggle("ff-inv-mobile-name-expanded", !!invState._invMobileColHide.nameExpanded);
  }
  syncInvColWidthsToDom();
}

function toggleInvMobileOptionalCol(key) {
  if (key === "dnd") invState._invMobileColHide.dnd = !invState._invMobileColHide.dnd;
  else if (key === "num") invState._invMobileColHide.num = !invState._invMobileColHide.num;
  else if (key === "code") invState._invMobileColHide.code = !invState._invMobileColHide.code;
  else if (key === "supplier") invState._invMobileColHide.supplier = !invState._invMobileColHide.supplier;
  else if (key === "url") invState._invMobileColHide.url = !invState._invMobileColHide.url;
  else return;
  persistInvMobileColHide();
  applyInvMobileColumnClasses();
}

/** Mobile: restore #, Code, drag, Supplier, URL after hiding via double-tap header. */
function resetInvMobileOptionalColumns() {
  invState._invMobileColHide.dnd = false;
  invState._invMobileColHide.num = false;
  invState._invMobileColHide.code = false;
  invState._invMobileColHide.supplier = false;
  invState._invMobileColHide.url = false;
  persistInvMobileColHide();
  applyInvMobileColumnClasses();
}

function invMobileAnyOptionalColumnHidden() {
  const h = invState._invMobileColHide;
  return !!(h.dnd || h.num || h.code || h.supplier || h.url);
}

function ensureInvMobileColHeaderBindOnce() {
  if (document.documentElement.dataset.ffInvMobileColBind === "1") return;
  document.documentElement.dataset.ffInvMobileColBind = "1";
  let resizeT = null;
  window.addEventListener(
    "resize",
    () => {
      if (resizeT) clearTimeout(resizeT);
      resizeT = setTimeout(() => applyInvMobileColumnClasses(), 150);
    },
    { passive: true }
  );

  document.addEventListener(
    "touchend",
    (ev) => {
      if (!isInvMobileNarrow()) return;
      const th = ev.target && ev.target.closest && ev.target.closest("#inventoryScreen th[data-inv-mobile-col]");
      if (!th) return;
      if (ev.target.closest && ev.target.closest(".col-resize-handle")) return;
      const key = th.getAttribute("data-inv-mobile-col");
      if (!key) return;

      if (key === "name") {
        if (invState._invNameHeaderTapTimer) {
          clearTimeout(invState._invNameHeaderTapTimer);
          invState._invNameHeaderTapTimer = null;
          invState._invMobileColHide.nameExpanded = false;
          persistInvMobileColHide();
          applyInvMobileColumnClasses();
        } else {
          invState._invNameHeaderTapTimer = setTimeout(() => {
            invState._invNameHeaderTapTimer = null;
            invState._invMobileColHide.nameExpanded = true;
            persistInvMobileColHide();
            applyInvMobileColumnClasses();
          }, 320);
        }
        return;
      }

      const now = ev.timeStamp || Date.now();
      const touch = ev.changedTouches && ev.changedTouches[0];
      const x = touch ? touch.clientX : 0;
      const y = touch ? touch.clientY : 0;
      const dt = now - invState._invMobColLastTouch.t;
      const same =
        invState._invMobColLastTouch.key === key &&
        dt < 420 &&
        dt > 30 &&
        Math.abs(x - invState._invMobColLastTouch.x) < 48 &&
        Math.abs(y - invState._invMobColLastTouch.y) < 48;
      if (same) {
        toggleInvMobileOptionalCol(key);
        invState._invMobColLastTouch = { t: 0, key: "", x: 0, y: 0 };
      } else {
        invState._invMobColLastTouch = { t: now, key, x, y };
      }
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    "dblclick",
    (ev) => {
      if (!isInvMobileNarrow()) return;
      const th = ev.target && ev.target.closest && ev.target.closest("#inventoryScreen th[data-inv-mobile-col]");
      if (!th) return;
      if (ev.target.closest && ev.target.closest(".col-resize-handle")) return;
      const key = th.getAttribute("data-inv-mobile-col");
      if (!key) return;
      ev.preventDefault();
      if (key === "name") {
        if (invState._invNameHeaderTapTimer) {
          clearTimeout(invState._invNameHeaderTapTimer);
          invState._invNameHeaderTapTimer = null;
        }
        invState._invMobileColHide.nameExpanded = false;
        persistInvMobileColHide();
        applyInvMobileColumnClasses();
        return;
      }
      toggleInvMobileOptionalCol(key);
    },
    true
  );
}

/**
 * Mobile only: tight widths per Stock / Current / Order / Price from longest cell in each
 * logical column (so a wide Price does not widen Current). Desktop: one width for all four.
 * @returns {[number, number, number, number]}
 */
function getInvMobileGroupSubColWidthsPx(w, groupId) {
  const base = w.groupSubById[groupId] ?? 72;
  const one = () => {
    const b = base;
    return /** @type {[number, number, number, number]} */ ([b, b, b, b]);
  };
  if (!isInvMobileNarrow()) return one();

  const capNum = Math.min(72, base);
  const capPrice = Math.min(112, base + 32);
  const tightLen = (maxLen, minPx, capPx) => {
    const t = Math.ceil(12 + maxLen * 8);
    return Math.max(minPx, Math.min(capPx, t));
  };

  if (!Array.isArray(invState._rows) || invState._rows.length === 0) {
    return /** @type {[number, number, number, number]} */ ([
      Math.min(capNum, 46),
      Math.min(capNum, 46),
      Math.min(capNum, 46),
      Math.min(capPrice, 56),
    ]);
  }

  let maxStock = 1;
  let maxCur = 1;
  let maxOrd = 1;
  let maxPrice = 1;
  for (const row of invState._rows) {
    const v = row.byGroup && row.byGroup[groupId];
    if (!v) continue;
    const { approved } = getCellApprovedInfo(v);
    const order = computeOrder(v.stock, v.current, approved);
    const stockN = typeof v.stock === "number" ? v.stock : parseNum(v.stock);
    const curN = typeof v.current === "number" ? v.current : parseNum(v.current);
    const stockS = String(formatOrderDisplay(stockN) || "").replace(/\s/g, "");
    const curS = String(formatOrderDisplay(curN) || "").replace(/\s/g, "");
    const ordS = String(formatOrderDisplay(order) || "").replace(/\s/g, "");
    const priceS = String(v.price != null ? v.price : "")
      .trim()
      .replace(/\s/g, "");
    if (stockS.length > maxStock) maxStock = stockS.length;
    if (curS.length > maxCur) maxCur = curS.length;
    if (ordS.length > maxOrd) maxOrd = ordS.length;
    if (priceS.length > maxPrice) maxPrice = priceS.length;
  }

  return /** @type {[number, number, number, number]} */ ([
    tightLen(maxStock, 32, capNum),
    tightLen(maxCur, 32, capNum),
    tightLen(maxOrd, 32, capNum),
    tightLen(maxPrice, 38, capPrice),
  ]);
}

function computeInvTableScrollClientWidth(root) {
  const sc = root && root.querySelector && root.querySelector(".ff-inv2-table-scroll");
  let cw = sc && sc.clientWidth ? sc.clientWidth : 0;
  if (!cw) {
    try {
      cw = Math.max(280, Math.floor(window.innerWidth));
    } catch (_) {
      cw = 360;
    }
  }
  return cw;
}

/** After mount, horizontal layout may be 0 until flex finishes — sync col widths again. */
function scheduleSyncInvColWidthsAfterLayout() {
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        syncInvColWidthsToDom();
      });
    });
  } else {
    setTimeout(() => syncInvColWidthsToDom(), 0);
  }
}

function renderColgroup() {
  if (invState._groups === null) return "";
  const w = getInvColWidths();
  const rd = w.rowDnd ?? 28;
  let nameColW = w.name;
  if (isInvMobileNarrow()) {
    try {
      nameColW = Math.min(w.name, Math.max(92, Math.floor(window.innerWidth * 0.34)));
    } catch (_) {
      nameColW = Math.min(w.name, 140);
    }
  }
  const parts = [];
  parts.push(`<col style="width:${rd}px;min-width:${rd}px" />`);
  parts.push(`<col style="width:${w.hash}px;min-width:${w.hash}px" />`);
  parts.push(`<col style="width:${w.code}px;min-width:${w.code}px" />`);
  parts.push(`<col style="width:${nameColW}px;min-width:${nameColW}px" />`);
  for (const g of invState._groups) {
    const w4 = getInvMobileGroupSubColWidthsPx(w, g.id);
    for (let c = 0; c < 4; c++) {
      const cw = w4[c];
      parts.push(`<col style="width:${cw}px;min-width:${cw}px" />`);
    }
  }
  parts.push(`<col style="width:${w.supplier}px;min-width:${w.supplier}px" />`);
  parts.push(`<col style="width:${w.url}px;min-width:${w.url}px" />`);
  return `<colgroup>${parts.join("")}</colgroup>`;
}

function syncInvColWidthsToDom() {
  const root = document.getElementById("inventoryScreen");
  if (!root) return;
  const table = root.querySelector(".ff-inv2-table");
  if (!table || invState._groups === null) return;
  const w = getInvColWidths();
  const cols = table.querySelectorAll("colgroup col");
  if (!cols.length) return;
  const mobile = isInvMobileNarrow();
  const mh = invState._invMobileColHide;
  const rdFull = w.rowDnd ?? 28;
  const rd = mobile && mh.dnd ? 0 : rdFull;
  const hashW = mobile && mh.num ? 0 : w.hash;
  const codeW = mobile && mh.code ? 0 : w.code;
  const supW = mobile && mh.supplier ? 0 : w.supplier;
  const urlW = mobile && mh.url ? 0 : w.url;

  let sumFixedAfterName = rd + hashW + codeW;
  for (const g of invState._groups) {
    const w4 = getInvMobileGroupSubColWidthsPx(w, g.id);
    for (const cw of w4) sumFixedAfterName += cw;
  }
  sumFixedAfterName += supW + urlW;

  const pad = 20;
  let namePx = w.name;
  if (mobile) {
    const cw = computeInvTableScrollClientWidth(root);
    const rem = Math.max(92, cw - sumFixedAfterName - pad);
    const capped = Math.max(92, Math.min(w.name, rem));
    namePx = w.name >= rem - 2 ? rem : capped;
  }

  table.style.setProperty("--inv-sticky-hash-left", `${rd}px`);
  table.style.setProperty("--inv-sticky-code-left", `${rd + hashW}px`);
  table.style.setProperty("--inv-sticky-name-left", `${rd + hashW + codeW}px`);
  let i = 0;
  cols[i].style.width = `${rd}px`;
  cols[i].style.minWidth = `${rd}px`;
  i++;
  cols[i].style.width = `${hashW}px`;
  cols[i].style.minWidth = `${hashW}px`;
  i++;
  cols[i].style.width = `${codeW}px`;
  cols[i].style.minWidth = `${codeW}px`;
  i++;
  cols[i].style.width = `${namePx}px`;
  cols[i].style.minWidth = mobile ? "92px" : `${Math.max(120, w.name)}px`;
  i++;
  for (const g of invState._groups) {
    const w4 = getInvMobileGroupSubColWidthsPx(w, g.id);
    for (let c = 0; c < 4; c++) {
      const cw = w4[c];
      cols[i].style.width = `${cw}px`;
      cols[i].style.minWidth = `${cw}px`;
      i++;
    }
  }
  if (cols[i]) {
    cols[i].style.width = `${supW}px`;
    cols[i].style.minWidth = `${supW}px`;
    i++;
  }
  if (cols[i]) {
    cols[i].style.width = `${urlW}px`;
    cols[i].style.minWidth = `${urlW}px`;
  }
}

function bindInvColumnResizeOnce() {
  if (document.documentElement.dataset.ffInvColResizeBound === "1") return;
  document.documentElement.dataset.ffInvColResizeBound = "1";
  let drag = null;

  function onMove(e) {
    if (!drag) return;
    if (e.pointerId != null && drag.pointerId != null && e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - drag.startX;
    const st = getInvColWidths();
    if (drag.kind === "hash") st.hash = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "code") st.code = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "name")
      st.name = Math.max(isInvMobileNarrow() ? 92 : 120, Math.round(drag.startWidth + dx));
    else if (drag.kind === "url") st.url = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "supplier") st.supplier = Math.max(60, Math.round(drag.startWidth + dx));
    else if (drag.kind === "group" && drag.groupId) {
      st.groupSubById[drag.groupId] = Math.max(60, Math.round(drag.startWidth + dx));
    }
    syncInvColWidthsToDom();
  }

  function onUp(e) {
    if (e && e.pointerId != null && drag && drag.pointerId != null && e.pointerId !== drag.pointerId) return;
    const hadDrag = !!drag;
    const el = drag && drag.handleEl;
    const pid = drag && drag.pointerId;
    if (el && pid != null) {
      try {
        el.releasePointerCapture(pid);
      } catch (_) {}
    }
    if (drag) {
      drag = null;
      document.body.style.userSelect = "";
    }
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("pointercancel", onUp, true);
    if (hadDrag) {
      void persistColumnWidthsToFirestore().catch((err) => console.error("[Inventory] column widths save failed", err));
      scheduleSyncInvColWidthsAfterLayout();
    }
  }

  function startDrag(h, clientX, pointerId) {
    const kind = h.getAttribute("data-inv-resize");
    const st = getInvColWidths();
    let startWidth = 0;
    if (kind === "hash") startWidth = st.hash;
    else if (kind === "code") startWidth = st.code;
    else if (kind === "name") startWidth = st.name;
    else if (kind === "url") startWidth = st.url;
    else if (kind === "supplier") startWidth = st.supplier;
    else if (kind === "group") {
      const gid = h.getAttribute("data-group-id");
      startWidth = st.groupSubById[gid] ?? 72;
    } else return;
    drag = {
      kind,
      startX: clientX,
      startWidth,
      groupId: h.getAttribute("data-group-id"),
      pointerId: pointerId != null ? pointerId : undefined,
      handleEl: h,
    };
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
  }

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.isPrimary === false) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const h = e.target.closest("#inventoryScreen .ff-inv2-table .col-resize-handle");
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        h.setPointerCapture(e.pointerId);
      } catch (_) {}
      startDrag(h, e.clientX, e.pointerId);
    },
    true
  );
}

export {
  applyInvMobileColumnClasses,
  bindInvColumnResizeOnce,
  ensureInvMobileColHeaderBindOnce,
  getInvColWidths,
  getInvMobileGroupSubColWidthsPx,
  invMobileAnyOptionalColumnHidden,
  isInvMobileNarrow,
  renderColgroup,
  resetInvMobileOptionalColumns,
  scheduleSyncInvColWidthsAfterLayout,
  syncInvColWidthsToDom,
};
