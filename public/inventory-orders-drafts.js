// inventory-orders-drafts.js
// Orders sub-app — drafts. Extracted verbatim from inventory-orders.js.
// Shared state in inventory-state.js; orchestrator/back-edge deps injected via initOrdersDrafts().

import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  addDoc,
  setDoc,
  serverTimestamp,
  query,
  where,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import {
  escapeHtml,
  parseNum,
  sanitizeManualItemForDraft,
  renderDraftsPickerRowHtml,
} from "./inventory-helpers.js?v=20260627_inventory_split";
import { getCategoryTree } from "./inventory-catalog.js?v=20260627_inventory_catalog";
import { inventoryOrderDraftToast } from "./inventory-orders-core.js?v=20260627_inventory_orders_split";
import { INVENTORY_LEGACY_DRAFT_DOC_ID } from "./inventory-spine.js?v=20260701_inventory_spine_split";

// ── injected by initOrdersDrafts() (orchestrator spine + builder back-edges) ──
let getSalonId, mountOrRefreshMockUi, _ffInvActiveLocId, _ffInvDocInActiveLoc, findCategoryAndSubForSubId, refreshOrderBuilderPreviewAsync;
export function initOrdersDrafts(deps) {
  ({ getSalonId, mountOrRefreshMockUi, _ffInvActiveLocId, _ffInvDocInActiveLoc, findCategoryAndSubForSubId, refreshOrderBuilderPreviewAsync } = deps);
}


/** Fill category/subcategory on a preview line from the category tree when missing. */
export function enrichOrderLineWithCategoryContext(L) {
  if (
    L.categoryId != null &&
    L.categoryName != null &&
    L.subcategoryId != null &&
    L.subcategoryName != null
  ) {
    return L;
  }
  const m = findCategoryAndSubForSubId(L.subcategoryId);
  if (!m) return L;
  return {
    ...L,
    categoryId: L.categoryId != null ? L.categoryId : m.category.id,
    categoryName:
      L.categoryName != null ? L.categoryName : m.category.name != null ? String(m.category.name) : null,
    subcategoryId: L.subcategoryId != null ? L.subcategoryId : m.sub.id,
    subcategoryName:
      L.subcategoryName != null ? L.subcategoryName : m.sub.name != null ? String(m.sub.name) : null,
  };
}

/**
 * Draft document source fields from current Order Builder mode (not sidebar alone).
 * @returns {{ sourceType: string, sourceSelection: object, categoryId: string | null, categoryName: string | null, subcategoryId: string | null, subcategoryName: string | null } | null}
 */
export function buildInventoryOrderDraftSourcePayload() {
  const ids = Array.from(invState._invOrderBuilderCustomSubIds).sort();
  const categoryIdsSet = new Set();
  const subcategoryIds = [];
  const subcategoryNames = [];
  for (const sid of ids) {
    const m = findCategoryAndSubForSubId(sid);
    if (!m) continue;
    categoryIdsSet.add(m.category.id);
    subcategoryIds.push(m.sub.id);
    subcategoryNames.push(m.sub.name != null ? String(m.sub.name) : "");
  }
  const categoryIds = Array.from(categoryIdsSet).sort();
  const sourceSelection = {
    categoryIds,
    subcategoryIds,
    subcategoryNames,
  };
  let categoryId = null;
  let categoryName = null;
  if (categoryIds.length === 1) {
    const cat = getCategoryTree().find((c) => c.id === categoryIds[0]);
    categoryId = categoryIds[0];
    categoryName = cat && cat.name != null ? String(cat.name) : null;
  }
  return {
    sourceType: "custom",
    sourceSelection,
    categoryId,
    categoryName,
    subcategoryId: null,
    subcategoryName: null,
  };
}

export async function saveInventoryOrderDraft() {
  if (invState._invSaveOrderDraftBusy) return;
  const autoLines = Array.isArray(invState._invOrderBuilderPreviewLines) ? invState._invOrderBuilderPreviewLines : [];
  const manualLines = Array.isArray(invState._invOrderBuilderManualLines) ? invState._invOrderBuilderManualLines : [];
  const linesRaw = [...autoLines, ...manualLines].filter((L) => {
    if (!L) return false;
    const q = typeof L.orderQty === "number" ? L.orderQty : parseNum(L.orderQty);
    return q > 0;
  });
  if (linesRaw.length === 0) return;
  const salonId = await getSalonId();
  if (!salonId) {
    inventoryOrderDraftToast("Could not resolve salon. Try again.", "error");
    return;
  }
  const src = buildInventoryOrderDraftSourcePayload();
  if (!src) {
    inventoryOrderDraftToast("Could not resolve order source. Try again.", "error");
    return;
  }
  const uid = auth.currentUser?.uid ? String(auth.currentUser.uid) : "";

  invState._invSaveOrderDraftBusy = true;
  mountOrRefreshMockUi();
  try {
    const lines = linesRaw.map((L) => (L && L.isManual ? L : enrichOrderLineWithCategoryContext(L)));
    const orderNameRaw = String(invState._invOrderSaveNameDraft ?? "").trim();
    const items = lines.map((L) => {
      if (L && L.isManual) {
        /** @type {Record<string, unknown>} */
        const out = {
          itemId: L.linkedInventoryItemId != null ? String(L.linkedInventoryItemId) : null,
          rowNo: null,
          code: L.code != null ? String(L.code) : null,
          itemName: L.itemName != null ? String(L.itemName) : "",
          supplier: null,
          url: null,
          groupId: L.groupId != null ? String(L.groupId) : null,
          groupName: L.groupName != null ? String(L.groupName) : null,
          orderQty: typeof L.orderQty === "number" ? L.orderQty : parseNum(L.orderQty),
          price: null,
          categoryId: L.categoryId != null ? String(L.categoryId) : null,
          categoryName: L.categoryName != null ? String(L.categoryName) : null,
          subcategoryId: L.subcategoryId != null ? String(L.subcategoryId) : null,
          subcategoryName: L.subcategoryName != null ? String(L.subcategoryName) : null,
          isManual: true,
        };
        if (L.linkedInventoryItemId != null) {
          out.linkedInventoryItemId = String(L.linkedInventoryItemId);
        }
        return out;
      }
      return {
        itemId: L.itemId,
        rowNo: L.rowNo,
        code: L.code,
        itemName: L.itemName,
        supplier: L.supplier,
        url: L.url,
        groupId: L.groupId,
        groupName: L.groupName,
        orderQty: L.orderQty,
        price: L.price,
        categoryId: L.categoryId != null ? String(L.categoryId) : null,
        categoryName: L.categoryName != null ? String(L.categoryName) : null,
        subcategoryId: L.subcategoryId != null ? String(L.subcategoryId) : null,
        subcategoryName: L.subcategoryName != null ? String(L.subcategoryName) : null,
      };
    });
    await addDoc(collection(db, `salons/${salonId}/inventoryOrders`), {
      status: "draft",
      ...(orderNameRaw !== "" ? { orderName: orderNameRaw } : {}),
      sourceType: src.sourceType,
      sourceSelection: src.sourceSelection,
      categoryId: src.categoryId,
      categoryName: src.categoryName,
      subcategoryId: src.subcategoryId,
      subcategoryName: src.subcategoryName,
      locationId: _ffInvActiveLocId() || null,
      createdAt: serverTimestamp(),
      createdBy: uid,
      itemCount: items.length,
      items,
    });
    // Clear the persistent active-draft doc so the next Create Order starts fresh.
    await clearInventoryOrderDraft();
    invState._invObPickPanelOpen = false;
    inventoryOrderDraftToast("Order saved", "success");
  } catch (e) {
    console.error("[Inventory] save order draft failed", e);
    inventoryOrderDraftToast("Could not save draft order. Try again.", "error");
  } finally {
    invState._invSaveOrderDraftBusy = false;
    mountOrRefreshMockUi();
  }
}

/**
 * Apply a draft doc snapshot into local state.
 * @param {string} docId Firestore doc id
 * @param {Record<string, unknown>} d Doc data
 */
export function ffApplyDraftSnapshotToLocalState(docId, d) {
  invState._invActiveDraftId = docId;
  const rawManual = Array.isArray(d.manualItems) ? d.manualItems : [];
  invState._invOrderBuilderManualLines = rawManual
    .map(sanitizeManualItemForDraft)
    .filter((x) => x && x.itemName);
  invState._invOrderBuilderCustomSubIds = Array.isArray(d.selectedSubcategoryIds)
    ? new Set(d.selectedSubcategoryIds.map(String))
    : new Set();
  invState._invOrderBuilderAutoQtyOverrides = {};
  const rawOv = d.autoQtyOverrides;
  if (rawOv && typeof rawOv === "object" && !Array.isArray(rawOv)) {
    for (const [k, v] of Object.entries(rawOv)) {
      if (!k) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) invState._invOrderBuilderAutoQtyOverrides[k] = n;
    }
  }
  invState._invObPickPanelOpen = false;
  invState._invOrderSaveNameDraft = typeof d.orderName === "string" ? d.orderName : "";
  if (d.updatedAt && typeof d.updatedAt.toMillis === "function") {
    invState._invOrderDraftLastSavedAt = d.updatedAt.toMillis();
    invState._invOrderDraftSaveStatus = "saved";
  } else {
    invState._invOrderDraftLastSavedAt = 0;
    invState._invOrderDraftSaveStatus = "idle";
  }
}

/** Load the active Create Order draft from Firestore into local state. Called on tab entry. */
export async function loadInventoryOrderDraft(forceReload) {
  if (invState._invOrderDraftLoading) return;
  if (invState._invOrderDraftLoaded && !forceReload) return;
  invState._invOrderDraftLoading = true;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;

    // Find the active draft (any doc id) by the isActive flag.
    // Multi-branch salons may have one active draft per location, so we also
    // filter by the current locationId client-side after the query returns.
    let activeId = null;
    /** @type {Record<string, unknown> | null} */
    let activeData = null;
    try {
      const qActive = query(
        collection(db, `salons/${salonId}/inventoryDrafts`),
        where("isActive", "==", true)
      );
      const snap = await getDocs(qActive);
      if (!snap.empty) {
        const rows = snap.docs
          .map((d) => ({ id: d.id, data: d.data() }))
          .filter((r) => _ffInvDocInActiveLoc(r.data));
        if (rows.length > 0) {
          const first = rows[0];
          activeId = first.id;
          activeData = first.data;
        }
      }
    } catch (e) {
      console.warn("[Inventory] query active drafts failed", e);
    }

    // Legacy fallback: a doc pinned at id='active' from before multi-draft support.
    if (!activeId) {
      try {
        const legacyRef = doc(db, `salons/${salonId}/inventoryDrafts`, INVENTORY_LEGACY_DRAFT_DOC_ID);
        const legacySnap = await getDoc(legacyRef);
        if (legacySnap.exists()) {
          activeId = legacySnap.id;
          activeData = legacySnap.data();
          // Promote to isActive for future queries.
          try {
            await setDoc(legacyRef, { isActive: true, status: "draft" }, { merge: true });
          } catch (mErr) {
            console.warn("[Inventory] migrate legacy draft failed", mErr);
          }
        }
      } catch (e) {
        console.warn("[Inventory] legacy draft check failed", e);
      }
    }

    let loadedItemCount = 0;
    if (activeId && activeData) {
      ffApplyDraftSnapshotToLocalState(activeId, activeData);
      loadedItemCount = invState._invOrderBuilderManualLines.length;
    } else {
      // No draft found — keep local empty state. A new draft is created lazily on first write.
      invState._invActiveDraftId = null;
      invState._invOrderBuilderManualLines = [];
      invState._invOrderBuilderCustomSubIds = new Set();
      invState._invOrderBuilderAutoQtyOverrides = {};
      invState._invOrderSaveNameDraft = "";
      invState._invOrderDraftLastSavedAt = 0;
      invState._invOrderDraftSaveStatus = "idle";
    }

    invState._invOrderDraftLoaded = true;
    if (!invState._invOrderDraftResumeToastShown && loadedItemCount > 0) {
      invState._invOrderDraftResumeToastShown = true;
      inventoryOrderDraftToast(`Resumed unfinished draft · ${loadedItemCount} item${loadedItemCount === 1 ? "" : "s"}`, "info");
    }
    mountOrRefreshMockUi();
    void refreshOrderBuilderPreviewAsync();
  } catch (e) {
    console.error("[Inventory] load active draft failed", e && (e.code || e.message) ? (e.code || e.message) : e);
  } finally {
    invState._invOrderDraftLoading = false;
  }
}

/** Debounced save of the active draft. Called after every local mutation. */
export function scheduleInventoryOrderDraftSave() {
  if (invState._invOrderDraftSaveTimer) {
    clearTimeout(invState._invOrderDraftSaveTimer);
    invState._invOrderDraftSaveTimer = null;
  }
  // Indicate pending save in the UI without re-rendering (we only re-render when the status actually flips).
  if (invState._invOrderDraftSaveStatus !== "saving") {
    invState._invOrderDraftSaveStatus = "saving";
    updateInventoryOrderDraftStatusIndicator();
  }
  invState._invOrderDraftSaveTimer = setTimeout(() => {
    invState._invOrderDraftSaveTimer = null;
    void flushInventoryOrderDraftSave();
  }, 600);
}

/** Update the Draft status chip in-place without re-rendering the whole Create Order tab. */
export function updateInventoryOrderDraftStatusIndicator() {
  const el = document.querySelector("[data-inv-draft-status]");
  if (!(el instanceof HTMLElement)) return;
  const st = invState._invOrderDraftSaveStatus;
  el.setAttribute("data-state", st);
  if (st === "saving") el.textContent = "Saving…";
  else if (st === "saved") {
    const secs = invState._invOrderDraftLastSavedAt > 0
      ? Math.max(0, Math.round((Date.now() - invState._invOrderDraftLastSavedAt) / 1000))
      : null;
    el.textContent = secs != null && secs < 10 ? "Saved just now" : "Auto-saved";
  } else {
    el.textContent = "Auto-save enabled";
  }
}

/** Immediate write of current state to the active draft doc. Creates a new draft on first write. */
export async function flushInventoryOrderDraftSave() {
  if (invState._invOrderDraftSaveTimer) {
    clearTimeout(invState._invOrderDraftSaveTimer);
    invState._invOrderDraftSaveTimer = null;
  }
  if (invState._invOrderDraftSaveInFlight) return;
  invState._invOrderDraftSaveInFlight = true;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
    const manualItems = invState._invOrderBuilderManualLines
      .map(sanitizeManualItemForDraft)
      .filter((x) => x && x.itemName);
    /** @type {Record<string, number>} */
    const autoQtyOverrides = {};
    if (invState._invOrderBuilderAutoQtyOverrides && typeof invState._invOrderBuilderAutoQtyOverrides === "object") {
      for (const [k, v] of Object.entries(invState._invOrderBuilderAutoQtyOverrides)) {
        if (!k) continue;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) autoQtyOverrides[k] = n;
      }
    }
    const payload = {
      status: "draft",
      isActive: true,
      manualItems,
      selectedSubcategoryIds: Array.from(invState._invOrderBuilderCustomSubIds),
      orderName: String(invState._invOrderSaveNameDraft ?? ""),
      autoQtyOverrides,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };
    if (invState._invActiveDraftId) {
      const ref = doc(db, `salons/${salonId}/inventoryDrafts`, invState._invActiveDraftId);
      await setDoc(ref, payload, { merge: true });
    } else {
      // First write — create the draft doc. Auto-id avoids collisions.
      const newRef = await addDoc(collection(db, `salons/${salonId}/inventoryDrafts`), {
        ...payload,
        locationId: _ffInvActiveLocId() || null,
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
      invState._invActiveDraftId = newRef.id;
    }
    invState._invOrderDraftLastSavedAt = Date.now();
    invState._invOrderDraftSaveStatus = "saved";
    updateInventoryOrderDraftStatusIndicator();
  } catch (e) {
    console.warn("[Inventory] save active draft failed", e);
    invState._invOrderDraftSaveStatus = "idle";
    updateInventoryOrderDraftStatusIndicator();
  } finally {
    invState._invOrderDraftSaveInFlight = false;
  }
}

/** Modal listing all drafts — clicking the Draft chip opens this. */
export function renderInventoryDraftsPickerModal() {
  if (!invState._invDraftsPicker.open) return "";
  let body;
  if (invState._invDraftsPicker.loading) {
    body = `<p class="ff-inv2-drafts-picker-empty">Loading…</p>`;
  } else if (invState._invDraftsPicker.error) {
    body = `<p class="ff-inv2-drafts-picker-empty">${escapeHtml(invState._invDraftsPicker.error)}</p>`;
  } else if (!invState._invDraftsPicker.drafts.length) {
    body = `<p class="ff-inv2-drafts-picker-empty">No drafts yet. Add an item to create one.</p>`;
  } else {
    body = `<ul class="ff-inv2-drafts-picker-list">${invState._invDraftsPicker.drafts.map(renderDraftsPickerRowHtml).join("")}</ul>`;
  }
  return `<div class="ff-inv2-modal-backdrop ff-inv2-drafts-picker-backdrop" data-inv-drafts-picker-close-backdrop="1" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-drafts-picker-title">
  <div class="ff-inv2-modal-card ff-inv2-drafts-picker-card" data-inv-drafts-picker-card="1">
    <div class="ff-inv2-drafts-picker-head">
      <h3 id="ff-inv2-drafts-picker-title" class="ff-inv2-modal-title">Your drafts</h3>
      <button type="button" class="ff-inv2-drafts-picker-close" data-inv-drafts-picker-close="1" aria-label="Close">×</button>
    </div>
    <p class="ff-inv2-modal-hint">Switch between unfinished drafts or delete ones you don't need.</p>
    ${body}
    <div class="ff-inv2-modal-actions ff-inv2-drafts-picker-actions-row">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-drafts-picker-close="1">Close</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-primary" data-inv-drafts-picker-new="1">+ New draft</button>
    </div>
  </div>
</div>`;
}

/** Open the drafts picker and fetch the list. */
export async function openInventoryDraftsPicker() {
  invState._invDraftsPicker = { open: true, loading: true, error: null, drafts: [] };
  mountOrRefreshMockUi();
  try {
    const salonId = await getSalonId();
    if (!salonId) {
      invState._invDraftsPicker.error = "No salon context";
      invState._invDraftsPicker.loading = false;
      mountOrRefreshMockUi();
      return;
    }
    const snap = await getDocs(collection(db, `salons/${salonId}/inventoryDrafts`));
    const drafts = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      if (data.status === "cleared") return;
      if (!_ffInvDocInActiveLoc(data)) return;
      const manualItems = Array.isArray(data.manualItems) ? data.manualItems : [];
      drafts.push({
        id: d.id,
        isActive: data.isActive === true || d.id === invState._invActiveDraftId,
        manualItems,
        orderName: typeof data.orderName === "string" ? data.orderName : "",
        createdAt: data.createdAt && typeof data.createdAt.toMillis === "function" ? data.createdAt.toMillis() : 0,
        updatedAt: data.updatedAt && typeof data.updatedAt.toMillis === "function" ? data.updatedAt.toMillis() : 0,
      });
    });
    drafts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    invState._invDraftsPicker = { open: true, loading: false, error: null, drafts };
    mountOrRefreshMockUi();
  } catch (e) {
    console.warn("[Inventory] drafts picker load failed", e);
    invState._invDraftsPicker = { open: true, loading: false, error: "Could not load drafts", drafts: [] };
    mountOrRefreshMockUi();
  }
}

export function closeInventoryDraftsPicker() {
  invState._invDraftsPicker = { open: false, loading: false, error: null, drafts: [] };
  mountOrRefreshMockUi();
}

/** Switch the active draft to the given doc id. */
export async function switchActiveInventoryDraft(draftId) {
  if (!draftId || draftId === invState._invActiveDraftId) {
    closeInventoryDraftsPicker();
    return;
  }
  if (invState._invOrderDraftSaveTimer) {
    await flushInventoryOrderDraftSave();
  }
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
    // Deactivate current
    if (invState._invActiveDraftId && invState._invActiveDraftId !== draftId) {
      try {
        const oldRef = doc(db, `salons/${salonId}/inventoryDrafts`, invState._invActiveDraftId);
        await setDoc(
          oldRef,
          { isActive: false, updatedAt: serverTimestamp(), updatedBy: uid },
          { merge: true }
        );
      } catch (e) {
        console.warn("[Inventory] deactivate previous draft (switch) failed", e);
      }
    }
    // Activate the chosen one
    const newRef = doc(db, `salons/${salonId}/inventoryDrafts`, draftId);
    const snap = await getDoc(newRef);
    if (!snap.exists()) {
      inventoryOrderDraftToast("That draft is gone", "error");
      closeInventoryDraftsPicker();
      return;
    }
    await setDoc(
      newRef,
      { isActive: true, updatedAt: serverTimestamp(), updatedBy: uid },
      { merge: true }
    );
    ffApplyDraftSnapshotToLocalState(draftId, snap.data() || {});
    invState._invOrderDraftLoaded = true;
    invState._invOrderDraftResumeToastShown = true;
    inventoryOrderDraftToast("Switched draft", "info");
    closeInventoryDraftsPicker();
    void refreshOrderBuilderPreviewAsync();
  } catch (e) {
    console.error("[Inventory] switchActiveInventoryDraft failed", e);
    inventoryOrderDraftToast("Could not switch draft", "error");
  }
}

/** Delete a draft from Firestore. If it was the active one, reset local state. */
export async function deleteInventoryDraftFromPicker(draftId) {
  if (!draftId) return;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const ref = doc(db, `salons/${salonId}/inventoryDrafts`, draftId);
    await deleteDoc(ref);
    if (draftId === invState._invActiveDraftId) {
      invState._invActiveDraftId = null;
      invState._invOrderBuilderManualLines = [];
      invState._invOrderBuilderCustomSubIds = new Set();
      invState._invOrderBuilderAutoQtyOverrides = {};
      invState._invOrderSaveNameDraft = "";
      invState._invOrderDraftLastSavedAt = 0;
      invState._invOrderDraftSaveStatus = "idle";
    }
    inventoryOrderDraftToast("Draft deleted", "success");
    // Refresh list in place
    void openInventoryDraftsPicker();
    void refreshOrderBuilderPreviewAsync();
  } catch (e) {
    console.error("[Inventory] delete draft failed", e);
    inventoryOrderDraftToast("Could not delete draft", "error");
  }
}

/**
 * Start a fresh draft: deactivate the current one (if any) so it remains in Firestore
 * as a non-active draft, and clear local state. A new Firestore doc is created lazily
 * on the first mutation via flushInventoryOrderDraftSave().
 */
export async function createNewInventoryOrderDraft() {
  // Flush any pending save so we don't clobber the soon-to-be-deactivated draft.
  if (invState._invOrderDraftSaveTimer) {
    await flushInventoryOrderDraftSave();
  }
  try {
    const salonId = await getSalonId();
    if (salonId && invState._invActiveDraftId) {
      const uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : null;
      const oldRef = doc(db, `salons/${salonId}/inventoryDrafts`, invState._invActiveDraftId);
      await setDoc(
        oldRef,
        { isActive: false, updatedAt: serverTimestamp(), updatedBy: uid },
        { merge: true }
      );
    }
  } catch (e) {
    console.warn("[Inventory] deactivate previous draft failed", e);
  }
  // Reset local state. New draft doc will be created on first mutation.
  invState._invActiveDraftId = null;
  invState._invOrderBuilderManualLines = [];
  invState._invOrderBuilderCustomSubIds = new Set();
  invState._invOrderBuilderAutoQtyOverrides = {};
  invState._invOrderSaveNameDraft = "";
  invState._invOrderDraftLastSavedAt = 0;
  invState._invOrderDraftSaveStatus = "idle";
  invState._invOrderDraftResumeToastShown = true;
  invState._invOrderDraftLoaded = true;
  invState._invOrderBuilderExpandedCatIds = new Set();
  invState._invObPickPanelOpen = true;
  inventoryOrderDraftToast("Started a new draft", "info");
  mountOrRefreshMockUi();
  void refreshOrderBuilderPreviewAsync();
  try {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => {
        const root = document.getElementById("inventoryScreen");
        const el = root && root.querySelector("#ff-inv2-ob-source");
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
  } catch (_) {
    /* ignore */
  }
}

/** Remove the active draft entirely (after Save as Order). Other drafts are untouched. */
export async function clearInventoryOrderDraft() {
  const draftIdToDelete = invState._invActiveDraftId;
  invState._invOrderBuilderManualLines = [];
  invState._invOrderBuilderCustomSubIds = new Set();
  invState._invOrderBuilderAutoQtyOverrides = {};
  invState._invOrderSaveNameDraft = "";
  invState._invActiveDraftId = null;
  invState._invOrderDraftLastSavedAt = 0;
  invState._invOrderDraftSaveStatus = "idle";
  invState._invOrderDraftLoaded = true;
  if (invState._invOrderDraftSaveTimer) {
    clearTimeout(invState._invOrderDraftSaveTimer);
    invState._invOrderDraftSaveTimer = null;
  }
  if (!draftIdToDelete) return;
  try {
    const salonId = await getSalonId();
    if (!salonId) return;
    const ref = doc(db, `salons/${salonId}/inventoryDrafts`, draftIdToDelete);
    await deleteDoc(ref).catch((e) => {
      console.warn("[Inventory] clear draft delete failed; falling back to empty overwrite", e);
      return setDoc(
        ref,
        {
          status: "cleared",
          isActive: false,
          manualItems: [],
          selectedSubcategoryIds: [],
          orderName: "",
          autoQtyOverrides: {},
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );
    });
  } catch (e) {
    console.warn("[Inventory] clear active draft failed", e);
  }
}
