/**
 * Inbox — Supplies request feature (extracted from inbox.js, Phase 1b).
 * Handles supply-request approve/deny, contributing approved quantities to the
 * inventory Order column, and the supplies request form (category/subcategory/item
 * pickers). showToast is injected from inbox.js.
 */
import {
  collection,
  query,
  orderBy,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  serverTimestamp,
  Timestamp,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { inboxState } from "./inbox-state.js?v=20260810_owner_inbox_load_v5";

// Injected from inbox.js.
let showToast = () => {};
export function initInboxSupplies(deps) {
  if (deps && typeof deps.showToast === 'function') showToast = deps.showToast;
}

/**
 * Apply approved Supply Request to inventory (Order Quantity contribution only).
 *
 * Adds the requested qty to the target row × group cell's `approvedRequests[]` array inside the
 * subcategory doc. Computes `cell.approved = sum(qty)` as a denormalized field. Idempotent via
 * inbox doc's `appliedToInventory === true`. Does NOT touch stock or current.
 */
async function applyApprovedSupplyRequestToInventory(requestId, requestData) {
  const salonId = inboxState.currentUserProfile?.salonId;
  if (!salonId) return;
  const rid = String(requestId || "").trim();
  if (!rid) return;

  // Idempotency guard — skip if request already applied.
  try {
    const inboxSnap = await getDoc(doc(db, `salons/${salonId}/inboxItems`, rid));
    if (inboxSnap.exists() && inboxSnap.data()?.appliedToInventory === true) return;
  } catch (e) {
    console.warn("[Inbox] apply supply: idempotency check failed, proceeding", e);
  }

  const items = Array.isArray(requestData?.items) ? requestData.items : [];
  if (items.length === 0) {
    console.warn("[Inbox] apply supply: request has no items", rid);
    return;
  }

  // Group items by subcategory doc so we touch each doc once.
  /** @type {Map<string, { catId: string, subId: string, lines: Array<{rowId: string, groupId: string | null, qty: number, unit: string | null, itemName: string, note: string | null}> }>} */
  const bySub = new Map();
  let skippedForMissingKeys = 0;
  for (const line of items) {
    const catId = String(line?.categoryId || "").trim();
    const subId = String(line?.subcategoryId || "").trim();
    const rowId = String(line?.rowId || "").trim() || (typeof line?.itemId === "string" && line.itemId.includes(":")
      ? line.itemId.split(":")[0]
      : String(line?.itemId || "").trim());
    const groupId = line?.groupId != null && String(line.groupId).trim() !== "" ? String(line.groupId).trim() : null;
    const qty = Number(line?.qty);
    if (!catId || !subId || !rowId || !Number.isFinite(qty) || qty <= 0) {
      console.warn("[Inbox] apply supply: skipping line (missing key fields)", {
        rid,
        itemId: line?.itemId,
        hasCat: !!catId,
        hasSub: !!subId,
        hasRow: !!rowId,
        qty,
      });
      skippedForMissingKeys += 1;
      continue;
    }
    const unit = line?.unit != null && String(line.unit).trim() !== "" ? String(line.unit).trim() : null;
    const itemName = line?.itemName != null ? String(line.itemName) : "";
    const noteSrc =
      (requestData?.note != null ? String(requestData.note).trim() : "") ||
      (line?.note != null ? String(line.note).trim() : "");
    const note = noteSrc !== "" ? noteSrc : null;
    const key = `${catId}:${subId}`;
    if (!bySub.has(key)) bySub.set(key, { catId, subId, lines: [] });
    bySub.get(key).lines.push({ rowId, groupId, qty, unit, itemName, note });
  }
  if (bySub.size === 0) {
    const msg = skippedForMissingKeys > 0
      ? `Supply request has no inventory-linked items (skipped ${skippedForMissingKeys}). The request lacks rowId/groupId — it was likely created before the inventory-link feature.`
      : "Supply request has no inventory items to contribute.";
    console.warn("[Inbox] apply supply:", msg, rid);
    throw new Error(msg);
  }

  const byName =
    inboxState.currentUserProfile && inboxState.currentUserProfile.name ? String(inboxState.currentUserProfile.name) : "";
  const byUid =
    inboxState.currentUserProfile && inboxState.currentUserProfile.uid ? String(inboxState.currentUserProfile.uid) : "";
  /** @type {Array<{catId: string, subId: string, rowId: string, groupId: string | null}>} */
  const appliedInventoryRefs = [];
  /** @type {string[]} */
  const subcategoryErrors = [];
  let totalContributions = 0;
  let totalSkippedUnmatched = 0;

  for (const { catId, subId, lines } of bySub.values()) {
    const subRef = doc(db, `salons/${salonId}/inventoryCategories/${catId}/inventorySubcategories/${subId}`);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(subRef);
        if (!snap.exists()) {
          subcategoryErrors.push(`Subcategory ${catId}/${subId} not found.`);
          return;
        }
        const data = snap.data() || {};
        const rows = Array.isArray(data.rows) ? data.rows.map((r) => (r && typeof r === "object" ? { ...r, byGroup: { ...(r.byGroup || {}) } } : r)) : [];
        const groupsRaw = Array.isArray(data.groups) ? data.groups : [];
        const singleGroupId = groupsRaw.length === 1 && groupsRaw[0]?.id ? String(groupsRaw[0].id) : null;
        let touched = false;
        for (const ln of lines) {
          const row = rows.find((r) => r && r.id === ln.rowId);
          if (!row) {
            console.warn("[Inbox] apply supply: row not found in subcategory", {
              catId,
              subId,
              wantedRowId: ln.rowId,
              availableRowIds: rows.map((r) => r && r.id),
            });
            totalSkippedUnmatched += 1;
            continue;
          }
          const byGroup = row.byGroup || {};
          let gid = ln.groupId;
          if (!gid) {
            if (singleGroupId) gid = singleGroupId;
            else {
              console.warn("[Inbox] apply supply: groupId missing and multiple groups exist", {
                catId,
                subId,
                rowId: ln.rowId,
                availableGroups: groupsRaw.map((g) => g?.id),
              });
              totalSkippedUnmatched += 1;
              continue;
            }
          }
          const cell = byGroup[gid] && typeof byGroup[gid] === "object" ? { ...byGroup[gid] } : { stock: 0, current: 0, price: "" };
          const list = Array.isArray(cell.approvedRequests) ? cell.approvedRequests.slice() : [];
          // Skip if a contribution with the same requestId already exists (idempotency).
          if (list.some((e) => String(e?.requestId) === rid)) {
            continue;
          }
          /** @type {Record<string, unknown>} */
          const entry = {
            requestId: rid,
            qty: ln.qty,
            at: Timestamp.now(),
          };
          if (byUid) entry.by = byUid;
          if (byName) entry.byName = byName;
          if (ln.itemName) entry.itemName = ln.itemName;
          if (ln.unit) entry.unit = ln.unit;
          if (ln.note) entry.note = ln.note;
          list.push(entry);
          const approvedSum = list.reduce((acc, e) => acc + (typeof e?.qty === "number" ? e.qty : Number(e?.qty) || 0), 0);
          byGroup[gid] = { ...cell, approvedRequests: list, approved: approvedSum };
          row.byGroup = byGroup;
          touched = true;
          totalContributions += 1;
          appliedInventoryRefs.push({ catId, subId, rowId: ln.rowId, groupId: gid });
        }
        if (!touched) return;
        transaction.update(subRef, { rows, updatedAt: serverTimestamp() });
      });
    } catch (e) {
      console.error("[Inbox] apply supply: subcategory update failed", catId, subId, e);
      const code = e && typeof e.code === "string" ? e.code : "";
      subcategoryErrors.push(`Subcategory ${catId}/${subId} update failed${code ? ` (${code})` : ""}.`);
    }
  }

  if (totalContributions > 0) {
    // Mark the inbox request as applied so subsequent re-approves don't double up.
    try {
      const inboxRef = doc(db, `salons/${salonId}/inboxItems`, rid);
      await updateDoc(inboxRef, {
        appliedToInventory: true,
        appliedToInventoryAt: serverTimestamp(),
        appliedInventoryRefs,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("[Inbox] apply supply: mark applied flag failed", e);
    }
    // Tell the Inventory screen to refresh each affected subcategory so the Order cell updates live
    // without requiring a full page reload.
    try {
      const seen = new Set();
      for (const r of appliedInventoryRefs) {
        const key = `${r.catId}:${r.subId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (typeof window !== "undefined" && typeof window.ffInventoryReloadSub === "function") {
          window.ffInventoryReloadSub(r.catId, r.subId);
        }
      }
    } catch (e) {
      console.warn("[Inbox] apply supply: inventory refresh hook failed", e);
    }
  }

  if (totalContributions === 0) {
    const parts = [];
    if (totalSkippedUnmatched > 0) {
      parts.push(`${totalSkippedUnmatched} line(s) could not be matched to a row/group in inventory`);
    }
    if (subcategoryErrors.length > 0) parts.push(subcategoryErrors.join(" "));
    const msg = parts.length > 0 ? parts.join("; ") : "No inventory rows were updated.";
    throw new Error(msg);
  }

  return { totalContributions, appliedInventoryRefs, errors: subcategoryErrors };
}

async function approveSupplyRequest(requestId, requestData) {
  const salonId = inboxState.currentUserProfile.salonId;
  const inboxRef = doc(db, `salons/${salonId}/inboxItems`, requestId);
  // 1) Update inbox status first (safe, uses only allowed keys).
  await updateDoc(inboxRef, {
    status: "approved",
    decidedAt: serverTimestamp(),
    decidedBy: inboxState.currentUserProfile.uid,
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    unreadForManagers: false,
  });
  // 2) Then contribute the approved quantity to the Order column in Inventory.
  try {
    const result = await applyApprovedSupplyRequestToInventory(requestId, requestData);
    if (result && typeof showToast === "function") {
      const n = result.totalContributions || 0;
      showToast(
        n === 1 ? "Approved · added 1 item to inventory Order." : `Approved · added ${n} items to inventory Order.`,
        "success"
      );
    }
  } catch (e) {
    console.error("[Inbox] Supply approve: apply to inventory failed", e);
    const msg = e && typeof e.message === "string" ? e.message : "";
    if (typeof showToast === "function") {
      showToast(`Approved, but inventory Order not updated: ${msg || "unknown error"}`, "error");
    }
  }
}

async function denySupplyRequest(requestId, responseNote) {
  const salonId = inboxState.currentUserProfile.salonId;
  const inboxRef = doc(db, `salons/${salonId}/inboxItems`, requestId);
  await updateDoc(inboxRef, {
    status: "denied",
    deniedAt: serverTimestamp(),
    deniedBy: inboxState.currentUserProfile.uid,
    decidedAt: serverTimestamp(),
    decidedBy: inboxState.currentUserProfile.uid,
    responseNote: responseNote != null && String(responseNote).trim() !== "" ? String(responseNote).trim() : null,
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    unreadForManagers: false,
  });
}

// --- Supplies request form: inventory master (categories → subcategories → items) ---


function syncSuppliesRowVariantUi(row) {
  const varWrap = row.querySelector(".supplies-variant-wrap");
  const varSel = row.querySelector(".supplies-variant-select");
  if (!varWrap || !varSel) return;
  varWrap.style.display = "none";
  varSel.disabled = true;
  varSel.value = "";
}

const SUPPLIES_ITEM_ROW_INNER_HTML = `
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">
    <div style="flex:1;min-width:140px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Category</span>
      <select class="supplies-cat-select" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
        <option value="">Select…</option>
      </select>
    </div>
    <div style="flex:1;min-width:140px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Subcategory</span>
      <select class="supplies-sub-select" disabled style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;opacity:0.88;">
        <option value="">Select…</option>
      </select>
    </div>
    <div style="flex:1.2;min-width:180px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Item</span>
      <select class="supplies-item-select" disabled style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;opacity:0.88;">
        <option value="">Select…</option>
      </select>
    </div>
    <div class="supplies-variant-wrap" style="display:none;min-width:108px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Variant</span>
      <select class="supplies-variant-select" disabled style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;opacity:0.88;">
        <option value="">Select…</option>
        <option value="dip">Dip</option>
        <option value="gel">Gel</option>
        <option value="regular">Regular</option>
      </select>
    </div>
    <div style="width:76px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Qty</span>
      <input type="number" class="supplies-item-quantity" min="0" step="1" placeholder="—" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;" />
    </div>
    <div style="min-width:104px;">
      <span style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px;">Unit</span>
      <select class="supplies-item-unit" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
        <option value="pcs">pcs</option>
        <option value="box">box</option>
        <option value="bottle">bottle</option>
        <option value="case">case</option>
        <option value="roll">roll</option>
        <option value="pack">pack</option>
        <option value="lb">lb</option>
        <option value="oz">oz</option>
        <option value="ml">ml</option>
        <option value="gal">gal</option>
      </select>
    </div>
    <button type="button" class="supplies-item-remove" title="Remove line" style="padding:8px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;align-self:flex-end;">🗑️</button>
  </div>
`.trim();

async function ffFetchInventoryCategoriesForSupplies() {
  const salonId = inboxState.currentUserProfile?.salonId;
  if (!salonId) return [];
  const q = query(
    collection(db, `salons/${salonId}/inventoryCategories`),
    orderBy("order", "asc"),
    orderBy("name", "asc")
  );
  const snap = await getDocs(q);
  const arr = [];
  snap.forEach((d) => {
    const data = d.data();
    arr.push({
      id: d.id,
      name: String(data.name || "").trim() || "Untitled",
    });
  });
  return arr;
}

async function ffFetchInventorySubcategoriesForSupplies(categoryId) {
  const cid = String(categoryId || "").trim();
  const salonId = inboxState.currentUserProfile?.salonId;
  if (!cid || !salonId) return [];
  const q = query(
    collection(db, `salons/${salonId}/inventoryCategories/${cid}/inventorySubcategories`),
    orderBy("order", "asc"),
    orderBy("name", "asc")
  );
  const snap = await getDocs(q);
  const arr = [];
  snap.forEach((d) => {
    const data = d.data();
    arr.push({
      id: d.id,
      name: String(data.name || "").trim() || "Untitled",
    });
  });
  return arr;
}

/**
 * Inventory items live inside the subcategory doc as `rows` (items) × `groups` (variants like Gel/Dipping/Regular).
 * We flatten to row×group options so the requester picks a precise (row, group) line; id = "rowId:groupId" keeps
 * disambiguation between same-named items across groups.
 */
async function ffFetchInventoryItemsForSupplies(categoryId, subcategoryId) {
  const cid = String(categoryId || "").trim();
  const sid = String(subcategoryId || "").trim();
  const salonId = inboxState.currentUserProfile?.salonId;
  if (!cid || !sid || !salonId) return [];
  const ref = doc(db, `salons/${salonId}/inventoryCategories/${cid}/inventorySubcategories/${sid}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  const data = snap.data() || {};
  const groupsRaw = Array.isArray(data.groups) ? data.groups.slice() : [];
  groupsRaw.sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
  const groups = groupsRaw.map((g) => ({
    id: String(g?.id ?? "").trim(),
    name: g?.name != null ? String(g.name).trim() : "",
  })).filter((g) => g.id !== "");
  const rowsRaw = Array.isArray(data.rows) ? data.rows.slice() : [];
  rowsRaw.sort((a, b) => {
    const an = a?.rowNo != null ? Number(a.rowNo) : NaN;
    const bn = b?.rowNo != null ? Number(b.rowNo) : NaN;
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    const as = String(a?.name ?? "").toLowerCase();
    const bs = String(b?.name ?? "").toLowerCase();
    return as.localeCompare(bs);
  });
  /** @type {Array<{id: string, rowId: string, groupId: string | null, groupName: string | null, name: string, label: string, code: string | null, internalNumber: number | null, hasVariants: false}>} */
  const arr = [];
  for (const row of rowsRaw) {
    const rowId = row?.id != null ? String(row.id).trim() : "";
    const rowName = String(row?.name ?? "").trim();
    if (!rowId || !rowName) continue;
    const code = row?.code != null && String(row.code).trim() !== "" ? String(row.code).trim() : null;
    const rowNoRaw = row?.rowNo;
    let internalNumber = null;
    if (rowNoRaw != null && rowNoRaw !== "") {
      const n = typeof rowNoRaw === "number" ? rowNoRaw : Number(rowNoRaw);
      internalNumber = Number.isFinite(n) ? n : null;
    }
    if (groups.length === 0) {
      arr.push({
        id: rowId,
        rowId,
        groupId: null,
        groupName: null,
        name: rowName,
        label: internalNumber != null ? `#${internalNumber} ${rowName}` : rowName,
        code,
        internalNumber,
        hasVariants: false,
      });
      continue;
    }
    for (const g of groups) {
      const label = `${rowName}${g.name ? ` (${g.name})` : ""}`;
      arr.push({
        id: `${rowId}:${g.id}`,
        rowId,
        groupId: g.id,
        groupName: g.name || null,
        name: rowName,
        label: internalNumber != null ? `#${internalNumber} ${label}` : label,
        code,
        internalNumber,
        hasVariants: false,
      });
    }
  }
  return arr;
}

function wireSuppliesItemRow(row, categories) {
  const catSel = row.querySelector(".supplies-cat-select");
  const subSel = row.querySelector(".supplies-sub-select");
  const itemSel = row.querySelector(".supplies-item-select");
  if (!catSel || !subSel || !itemSel) return;

  catSel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Select…";
  catSel.appendChild(ph);
  for (const c of categories) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    o.setAttribute("data-category-name", c.name);
    catSel.appendChild(o);
  }

  const onCatChange = async () => {
    const cid = catSel.value.trim();
    subSel.innerHTML = "";
    const sph = document.createElement("option");
    sph.value = "";
    sph.textContent = "Select…";
    subSel.appendChild(sph);
    itemSel.innerHTML = "";
    const iph = document.createElement("option");
    iph.value = "";
    iph.textContent = "Select…";
    itemSel.appendChild(iph);
    itemSel.disabled = true;
    if (!cid) {
      subSel.disabled = true;
      syncSuppliesRowVariantUi(row);
      return;
    }
    subSel.disabled = false;
    let subs = [];
    try {
      subs = await ffFetchInventorySubcategoriesForSupplies(cid);
    } catch (e) {
      console.error("[Inbox] supplies subcategories", e);
    }
    for (const s of subs) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name;
      o.setAttribute("data-subcategory-name", s.name);
      subSel.appendChild(o);
    }
    syncSuppliesRowVariantUi(row);
  };

  const onSubChange = async () => {
    const cid = catSel.value.trim();
    const sid = subSel.value.trim();
    itemSel.innerHTML = "";
    const iph = document.createElement("option");
    iph.value = "";
    iph.textContent = "Select…";
    itemSel.appendChild(iph);
    if (!cid || !sid) {
      itemSel.disabled = true;
      syncSuppliesRowVariantUi(row);
      return;
    }
    itemSel.disabled = false;
    let items = [];
    try {
      items = await ffFetchInventoryItemsForSupplies(cid, sid);
    } catch (e) {
      console.error("[Inbox] supplies items", e);
    }
    for (const it of items) {
      const o = document.createElement("option");
      o.value = it.id;
      o.textContent = it.label;
      o.setAttribute("data-item-name", it.name);
      o.setAttribute("data-row-id", it.rowId);
      if (it.groupId) o.setAttribute("data-group-id", it.groupId);
      if (it.groupName) o.setAttribute("data-group-name", it.groupName);
      o.setAttribute("data-has-variants", "0");
      if (it.internalNumber != null && it.internalNumber !== "") {
        o.setAttribute("data-internal-number", String(it.internalNumber));
      }
      if (it.code) o.setAttribute("data-code", it.code);
      itemSel.appendChild(o);
    }
    syncSuppliesRowVariantUi(row);
  };

  catSel.addEventListener("change", () => {
    void onCatChange();
  });
  subSel.addEventListener("change", () => {
    void onSubChange();
  });
  itemSel.addEventListener("change", () => {
    syncSuppliesRowVariantUi(row);
  });

  const rm = row.querySelector(".supplies-item-remove");
  rm?.addEventListener("click", () => {
    row.remove();
  });

  syncSuppliesRowVariantUi(row);
}

function classifySuppliesRow(row) {
  const cat = (row.querySelector(".supplies-cat-select")?.value || "").trim();
  const sub = (row.querySelector(".supplies-sub-select")?.value || "").trim();
  const item = (row.querySelector(".supplies-item-select")?.value || "").trim();
  if (!cat && !sub && !item) return "empty";
  if (cat && sub && item) return "ok";
  return "incomplete";
}

function readSuppliesRowSnapshot(row) {
  const cat = row.querySelector(".supplies-cat-select");
  const sub = row.querySelector(".supplies-sub-select");
  const item = row.querySelector(".supplies-item-select");
  const qtyIn = row.querySelector(".supplies-item-quantity");
  const unitIn = row.querySelector(".supplies-item-unit");
  const catOpt = cat?.selectedOptions?.[0];
  const subOpt = sub?.selectedOptions?.[0];
  const itemOpt = item?.selectedOptions?.[0];
  const categoryId = (cat?.value || "").trim();
  const subcategoryId = (sub?.value || "").trim();
  const itemId = (item?.value || "").trim();
  if (!categoryId || !subcategoryId || !itemId) return null;

  const categoryName = catOpt?.getAttribute("data-category-name") || "";
  const subcategoryName = subOpt?.getAttribute("data-subcategory-name") || "";
  const itemName = itemOpt?.getAttribute("data-item-name") || "";
  const rowId = itemOpt?.getAttribute("data-row-id") || (itemId.includes(":") ? itemId.split(":")[0] : itemId);
  const groupIdRaw = itemOpt?.getAttribute("data-group-id");
  const groupId = groupIdRaw && String(groupIdRaw).trim() !== "" ? String(groupIdRaw).trim() : null;
  const groupNameRaw = itemOpt?.getAttribute("data-group-name");
  const groupName = groupNameRaw && String(groupNameRaw).trim() !== "" ? String(groupNameRaw).trim() : null;
  const codeRaw = itemOpt?.getAttribute("data-code");
  const code = codeRaw && String(codeRaw).trim() !== "" ? String(codeRaw).trim() : null;
  let internalNumber = null;
  const ins = itemOpt?.getAttribute("data-internal-number");
  if (ins != null && ins !== "") {
    const n = Number(ins);
    internalNumber = Number.isFinite(n) ? n : null;
  }

  const qtyRaw = qtyIn?.value;
  let qty = null;
  if (qtyRaw != null && String(qtyRaw).trim() !== "") {
    const q = parseInt(String(qtyRaw).trim(), 10);
    qty = Number.isFinite(q) ? q : null;
  }
  const unit = (unitIn?.value ?? "").trim() || "pcs";

  /** @type {Record<string, unknown>} */
  const out = {
    categoryId,
    categoryName,
    subcategoryId,
    subcategoryName,
    itemId,
    rowId,
    itemName,
    internalNumber,
    qty,
    unit,
  };
  if (groupId) out.groupId = groupId;
  if (groupName) out.groupName = groupName;
  if (code) out.code = code;
  return out;
}

async function initSuppliesRequestForm(fieldsContainer) {
  const list = fieldsContainer.querySelector("#suppliesItemsList");
  const hint = fieldsContainer.querySelector("#suppliesInventoryEmptyHint");
  if (!list) return;
  let categories = [];
  try {
    categories = await ffFetchInventoryCategoriesForSupplies();
  } catch (e) {
    console.error("[Inbox] supplies categories", e);
    if (typeof showToast === "function") showToast("Could not load inventory categories.", "error");
  }
  if (typeof window !== "undefined") {
    window._suppliesFormCategoriesCache = categories;
  }
  if (hint) hint.style.display = categories.length === 0 ? "block" : "none";
  list.querySelectorAll(".supplies-item-row").forEach((row) => wireSuppliesItemRow(row, categories));
}

export {
  applyApprovedSupplyRequestToInventory,
  approveSupplyRequest,
  denySupplyRequest,
  SUPPLIES_ITEM_ROW_INNER_HTML,
  wireSuppliesItemRow,
  classifySuppliesRow,
  readSuppliesRowSnapshot,
  initSuppliesRequestForm,
};
