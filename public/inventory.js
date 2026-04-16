/**
 * Inventory — mock UI + local state (no Firestore, no persistence).
 * Table is interactive; Order is computed: max(Stock - Current, 0).
 */

/** @type {Set<string>} */
let _expandedCategoryIds = new Set(["c1", "c2", "c3"]);
/** @type {string | null} */
let _selectedSubcategoryId = "s-opi";

const MOCK_GROUPS = [
  { id: "g-dip", label: "Dipping" },
  { id: "g-gel", label: "Gel" },
  { id: "g-reg", label: "Regular" },
];

const MOCK_TREE = [
  {
    id: "c1",
    name: "Colors",
    subcategories: [
      { id: "s-opi", name: "OPI" },
      { id: "s-dnd", name: "DND" },
    ],
  },
  {
    id: "c2",
    name: "Cleaning",
    subcategories: [
      { id: "s-gen", name: "General" },
      { id: "s-bath", name: "Bathroom" },
    ],
  },
  {
    id: "c3",
    name: "Wax",
    subcategories: [
      { id: "s-hard", name: "Hard Wax" },
      { id: "s-soft", name: "Soft Wax" },
    ],
  },
];

const MOCK_TABLE_ROWS = [
  {
    code: "H22",
    name: "Funny Bunny",
    dipping: { stock: 24, current: 18, price: "$14.00" },
    gel: { stock: 10, current: 10, price: "$14.00" },
    regular: { stock: 8, current: 5, price: "$14.00" },
    url: "example.com/h22",
    supplier: "OPI",
  },
  {
    code: "L00",
    name: "Alpine Snow",
    dipping: { stock: 12, current: 4, price: "$14.00" },
    gel: { stock: 6, current: 6, price: "$14.00" },
    regular: { stock: 20, current: 15, price: "$14.00" },
    url: "example.com/l00",
    supplier: "OPI",
  },
  {
    code: "A15",
    name: "Bubble Bath",
    dipping: { stock: 8, current: 8, price: "$13.50" },
    gel: { stock: 14, current: 9, price: "$13.50" },
    regular: { stock: 5, current: 2, price: "$13.50" },
    url: "example.com/a15",
    supplier: "OPI",
  },
];

/** @type {{ id: string, label: string }[] | null} */
let _groups = null;

/**
 * @typedef {{ id: string, code: string, name: string, url: string, supplier: string, byGroup: Record<string, { stock: number, current: number, price: string }> }} InvRow
 * @type {InvRow[] | null}
 */
let _rows = null;

/** When set, that group id shows remove confirmation (not one-click delete). */
let _groupRemoveConfirmId = null;

/** Second step: centered modal before actual delete (local only). */
let _groupRemoveModalGroupId = null;

const STYLE_ID = "ff-inv2-mock-styles-v4";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function newRowId() {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function newGroupId() {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseNum(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Order = max(Stock - Current, 0) */
function computeOrder(stock, current) {
  const s = typeof stock === "number" ? stock : parseNum(stock);
  const c = typeof current === "number" ? current : parseNum(current);
  return Math.max(0, s - c);
}

function formatOrderDisplay(n) {
  if (Number.isInteger(n)) return String(n);
  const r = Math.round(n * 100) / 100;
  return String(r);
}

function seedInventoryTableState() {
  if (_groups && _rows) return;
  _groups = MOCK_GROUPS.map((g) => ({ ...g }));
  _rows = MOCK_TABLE_ROWS.map((row, i) => {
    const id = `r-seed-${i}-${Math.random().toString(36).slice(2, 9)}`;
    return {
      id,
      code: row.code,
      name: row.name,
      url: row.url,
      supplier: row.supplier,
      byGroup: {
        "g-dip": {
          stock: row.dipping.stock,
          current: row.dipping.current,
          price: String(row.dipping.price),
        },
        "g-gel": {
          stock: row.gel.stock,
          current: row.gel.current,
          price: String(row.gel.price),
        },
        "g-reg": {
          stock: row.regular.stock,
          current: row.regular.current,
          price: String(row.regular.price),
        },
      },
    };
  });
}

function ensureGroupCellsForRows() {
  if (!_groups || !_rows) return;
  for (const row of _rows) {
    for (const g of _groups) {
      if (!row.byGroup[g.id]) {
        row.byGroup[g.id] = { stock: 0, current: 0, price: "" };
      }
    }
  }
}

function addInventoryRow() {
  seedInventoryTableState();
  if (!_groups || !_rows) return;
  _groupRemoveConfirmId = null;
  _groupRemoveModalGroupId = null;
  const row = {
    id: newRowId(),
    code: "",
    name: "",
    url: "",
    supplier: "",
    byGroup: {},
  };
  for (const g of _groups) {
    row.byGroup[g.id] = { stock: 0, current: 0, price: "" };
  }
  _rows.push(row);
}

function addInventoryGroup() {
  seedInventoryTableState();
  if (!_groups || !_rows) return;
  _groupRemoveConfirmId = null;
  _groupRemoveModalGroupId = null;
  const gid = newGroupId();
  _groups.push({ id: gid, label: "New group" });
  for (const row of _rows) {
    row.byGroup[gid] = { stock: 0, current: 0, price: "" };
  }
}

function removeInventoryGroup(groupId) {
  seedInventoryTableState();
  if (!_groups || !_rows || !groupId) return;
  _groups = _groups.filter((g) => g.id !== groupId);
  for (const row of _rows) {
    try {
      delete row.byGroup[groupId];
    } catch (e) {}
  }
  if (_groupRemoveConfirmId === groupId) _groupRemoveConfirmId = null;
  if (_groupRemoveModalGroupId === groupId) _groupRemoveModalGroupId = null;
}

/** True if any row has non-zero stock/current or non-empty price in this group. */
function groupHasAnyValues(groupId) {
  if (!_rows) return false;
  for (const row of _rows) {
    const c = row.byGroup[groupId];
    if (!c) continue;
    if (parseNum(c.stock) !== 0 || parseNum(c.current) !== 0) return true;
    if (String(c.price ?? "").trim() !== "") return true;
  }
  return false;
}

function updateOrderCellEl(rowId, groupId) {
  const row = _rows?.find((r) => r.id === rowId);
  if (!row) return;
  const gcell = row.byGroup[groupId];
  if (!gcell) return;
  const root = document.getElementById("inventoryScreen");
  if (!root) return;
  const cells = root.querySelectorAll("td[data-order-for-row]");
  for (let i = 0; i < cells.length; i++) {
    const el = cells[i];
    if (el.getAttribute("data-order-for-row") === rowId && el.getAttribute("data-order-for-group") === groupId) {
      el.textContent = formatOrderDisplay(computeOrder(gcell.stock, gcell.current));
      return;
    }
  }
}

function handleInventoryInput(ev) {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement)) return;
  const inv = t.getAttribute("data-inv");
  if (!inv) return;
  seedInventoryTableState();
  if (!_groups || !_rows) return;

  if (inv === "group-label") {
    const gid = t.getAttribute("data-group-id");
    const g = _groups.find((x) => x.id === gid);
    if (g) g.label = t.value;
    return;
  }

  const rowId = t.getAttribute("data-row-id");
  const row = _rows.find((r) => r.id === rowId);
  if (!row) return;

  if (inv === "code") {
    row.code = t.value;
    return;
  }
  if (inv === "name") {
    row.name = t.value;
    return;
  }
  if (inv === "url") {
    row.url = t.value;
    return;
  }
  if (inv === "supplier") {
    row.supplier = t.value;
    return;
  }

  const gid = t.getAttribute("data-group-id");
  if (!gid) return;
  const gcell = row.byGroup[gid];
  if (!gcell) return;

  if (inv === "stock") {
    gcell.stock = parseNum(t.value);
    updateOrderCellEl(rowId, gid);
    return;
  }
  if (inv === "current") {
    gcell.current = parseNum(t.value);
    updateOrderCellEl(rowId, gid);
    return;
  }
  if (inv === "price") {
    gcell.price = t.value;
  }
}

function injectMockStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
#inventoryScreen.ff-inv2-screen {
  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #0f172a;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
}
#inventoryScreen .ff-inv2-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-aside {
  width: 280px;
  min-width: 280px;
  max-width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 2px 0 12px rgba(15, 23, 42, 0.04);
}
#inventoryScreen .ff-inv2-aside-head {
  padding: 18px 16px 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
  border-bottom: 1px solid #f1f5f9;
}
#inventoryScreen .ff-inv2-aside-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 16px;
}
#inventoryScreen .ff-inv2-cat {
  margin-top: 4px;
}
#inventoryScreen .ff-inv2-cat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}
#inventoryScreen .ff-inv2-cat-row:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-chevron {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  transition: transform 0.18s ease;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-cat.is-open .ff-inv2-chevron {
  transform: rotate(90deg);
}
#inventoryScreen .ff-inv2-sub-list {
  padding: 2px 0 6px 8px;
}
#inventoryScreen .ff-inv2-sub {
  padding: 7px 10px 7px 22px;
  margin: 2px 0;
  border-radius: 8px;
  font-size: 13px;
  color: #475569;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}
#inventoryScreen .ff-inv2-sub:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-sub.is-active {
  background: #f5f3ff;
  color: #5b21b6;
  font-weight: 600;
  border-left-color: #7c3aed;
}
#inventoryScreen .ff-inv2-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 24px 24px;
  gap: 14px;
  overflow: hidden;
}
#inventoryScreen .ff-inv2-crumb {
  font-size: 13px;
  color: #64748b;
}
#inventoryScreen .ff-inv2-crumb strong {
  color: #0f172a;
  font-weight: 600;
}
#inventoryScreen .ff-inv2-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fafafa;
  flex-shrink: 0;
}
#inventoryScreen .ff-inv2-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: #5b21b6;
  background: #fff;
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}
#inventoryScreen .ff-inv2-btn:hover {
  background: #faf5ff;
  border-color: #c4b5fd;
}
#inventoryScreen .ff-inv2-table-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  overflow: hidden;
}
#inventoryScreen .ff-inv2-table-scroll {
  flex: 1;
  overflow: auto;
}
#inventoryScreen .ff-inv2-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}
#inventoryScreen .ff-inv2-th-num,
#inventoryScreen .ff-inv2-td-num {
  width: 2.25rem;
  max-width: 2.75rem;
  padding-left: 4px !important;
  padding-right: 4px !important;
  text-align: center !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-th-num {
  font-size: 10px;
  letter-spacing: 0.02em;
}
#inventoryScreen .ff-inv2-th-code,
#inventoryScreen .ff-inv2-td-code {
  width: 4.75rem;
  max-width: 5.5rem;
  padding-left: 4px !important;
  padding-right: 6px !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-th-name,
#inventoryScreen .ff-inv2-td-name {
  width: 32%;
  min-width: 12rem;
  padding-left: 6px !important;
  padding-right: 8px !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-cell-input.ff-inv2-code-input {
  min-width: 0;
  max-width: 100%;
  padding-left: 6px;
  padding-right: 6px;
}
#inventoryScreen .ff-inv2-cell-input.ff-inv2-name-input {
  min-width: 0;
  width: 100%;
  max-width: 100%;
  padding: 7px 10px;
  font-size: 13px;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th:nth-last-child(1),
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th:nth-last-child(2) {
  min-width: 5rem;
}
#inventoryScreen .ff-inv2-table tbody td:nth-last-child(2),
#inventoryScreen .ff-inv2-table tbody td:last-child {
  min-width: 4.5rem;
}
#inventoryScreen .ff-inv2-table thead th {
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
  text-align: left;
  padding: 8px 8px;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(1) th {
  position: sticky;
  top: 0;
  z-index: 3;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
#inventoryScreen .ff-inv2-table thead tr:nth-child(2) th {
  position: sticky;
  top: 40px;
  z-index: 2;
}
#inventoryScreen .ff-inv2-gh {
  text-align: center !important;
  background: linear-gradient(180deg, #faf5ff 0%, #f5f3ff 100%);
  color: #6d28d9 !important;
  border-left: 1px solid #ede9fe;
  padding: 4px 6px !important;
  vertical-align: middle !important;
}
#inventoryScreen .ff-inv2-gh-inner {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
}
#inventoryScreen .ff-inv2-gh-inner .ff-inv2-gh-input {
  flex: 1 1 auto;
  min-width: 0;
}
#inventoryScreen .ff-inv2-gh-remove {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  background: rgba(255,255,255,0.65);
  color: #94a3b8;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
}
#inventoryScreen .ff-inv2-gh-remove:hover {
  background: #fee2e2;
  border-color: #fecaca;
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-gh-remove:focus-visible {
  outline: 2px solid #a78bfa;
  outline-offset: 1px;
}
#inventoryScreen .ff-inv2-gh--confirming {
  white-space: normal !important;
}
#inventoryScreen .ff-inv2-gh-inner--confirm {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
#inventoryScreen .ff-inv2-gh-confirm-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
}
#inventoryScreen .ff-inv2-gh-warn {
  font-size: 10px;
  font-weight: 500;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 6px 8px;
  line-height: 1.35;
  text-align: left;
}
#inventoryScreen .ff-inv2-gh-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}
#inventoryScreen .ff-inv2-gh-btn {
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}
#inventoryScreen .ff-inv2-gh-btn-cancel {
  background: #fff;
  border-color: #e2e8f0;
  color: #475569;
}
#inventoryScreen .ff-inv2-gh-btn-cancel:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-gh-btn-danger {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-gh-btn-danger:hover {
  background: #fee2e2;
}
#inventoryScreen .ff-inv2-gh-input {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 8px;
  font: inherit;
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: center;
  color: #5b21b6;
  background: rgba(255,255,255,0.5);
  border: 1px solid #e9d5ff;
  border-radius: 8px;
}
#inventoryScreen .ff-inv2-gh-input:focus {
  outline: none;
  border-color: #a78bfa;
  background: #fff;
}
#inventoryScreen .ff-inv2-subh {
  text-align: center !important;
  font-size: 10px !important;
  color: #64748b !important;
  background: #fafafa !important;
  font-weight: 600 !important;
}
#inventoryScreen .ff-inv2-table tbody td {
  padding: 6px 8px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
  vertical-align: middle;
}
#inventoryScreen .ff-inv2-table tbody tr:hover td {
  background: #fafbfc;
}
#inventoryScreen .ff-inv2-num { font-variant-numeric: tabular-nums; font-weight: 600; color: #0f172a; }
#inventoryScreen .ff-inv2-cell-input {
  width: 100%;
  max-width: 100%;
  min-width: 48px;
  box-sizing: border-box;
  margin: 0;
  padding: 6px 8px;
  font: inherit;
  font-size: 12px;
  color: #0f172a;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
#inventoryScreen .ff-inv2-cell-input:focus {
  outline: none;
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.12);
}
#inventoryScreen .ff-inv2-cell-input.ff-inv2-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
#inventoryScreen .ff-inv2-order-cell {
  text-align: center;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #7c3aed;
  background: #faf5ff;
}
#inventoryScreen .ff-inv2-mock-pill {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #7c3aed;
  background: #f3e8ff;
  padding: 3px 8px;
  border-radius: 999px;
  margin-left: 8px;
}
#inventoryScreen .ff-inv2-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(2px);
}
#inventoryScreen .ff-inv2-modal-card {
  width: 100%;
  max-width: 360px;
  padding: 20px 22px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
}
#inventoryScreen .ff-inv2-modal-title {
  margin: 0 0 8px 0;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
}
#inventoryScreen .ff-inv2-modal-hint {
  margin: 0 0 18px 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}
#inventoryScreen .ff-inv2-modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
#inventoryScreen .ff-inv2-modal-btn {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
}
#inventoryScreen .ff-inv2-modal-btn-cancel {
  background: #fff;
  border-color: #e2e8f0;
  color: #475569;
}
#inventoryScreen .ff-inv2-modal-btn-cancel:hover {
  background: #f8fafc;
}
#inventoryScreen .ff-inv2-modal-btn-danger {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
#inventoryScreen .ff-inv2-modal-btn-danger:hover {
  background: #fee2e2;
}
`;
  document.head.appendChild(el);
}

function findSubMeta(subId) {
  for (const c of MOCK_TREE) {
    for (const s of c.subcategories) {
      if (s.id === subId) return { category: c, sub: s };
    }
  }
  return null;
}

function getSelectedSubMeta() {
  const m = findSubMeta(_selectedSubcategoryId);
  if (m) return m;
  const first = MOCK_TREE[0]?.subcategories[0];
  if (first) {
    _selectedSubcategoryId = first.id;
    return { category: MOCK_TREE[0], sub: first };
  }
  return null;
}

function renderSidebarHtml() {
  return MOCK_TREE.map((cat) => {
    const open = _expandedCategoryIds.has(cat.id);
    const subs = cat.subcategories
      .map((sub) => {
        const active = sub.id === _selectedSubcategoryId;
        return `<div class="ff-inv2-sub${active ? " is-active" : ""}" data-sub-id="${escapeHtml(sub.id)}" role="button" tabindex="0">${escapeHtml(sub.name)}</div>`;
      })
      .join("");
    return `
<div class="ff-inv2-cat${open ? " is-open" : ""}" data-cat-id="${escapeHtml(cat.id)}">
  <div class="ff-inv2-cat-row" data-cat-toggle="${escapeHtml(cat.id)}">
    <span class="ff-inv2-chevron" aria-hidden="true">&#8250;</span>
    <span>${escapeHtml(cat.name)}</span>
  </div>
  <div class="ff-inv2-sub-list" style="display:${open ? "block" : "none"}">${subs}</div>
</div>`;
  }).join("");
}

function renderGroupHeaderTh(g) {
  const gid = g.id;
  const confirming = _groupRemoveConfirmId === gid;
  if (confirming) {
    const hasData = groupHasAnyValues(gid);
    const warn = hasData
      ? `<span class="ff-inv2-gh-warn">This will remove all values in this group</span>`
      : "";
    return `<th colspan="4" class="ff-inv2-gh ff-inv2-gh--confirming"><div class="ff-inv2-gh-inner ff-inv2-gh-inner--confirm">
  <input class="ff-inv2-gh-input" type="text" data-inv="group-label" data-group-id="${escapeHtml(gid)}" value="${escapeHtml(g.label)}" aria-label="Group name" />
  <div class="ff-inv2-gh-confirm-bar">
    ${warn}
    <div class="ff-inv2-gh-confirm-actions">
      <button type="button" class="ff-inv2-gh-btn ff-inv2-gh-btn-cancel" data-inv-remove-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-gh-btn ff-inv2-gh-btn-danger" data-inv-remove-modal="${escapeHtml(gid)}">Remove group</button>
    </div>
  </div>
</div></th>`;
  }
  return `<th colspan="4" class="ff-inv2-gh"><div class="ff-inv2-gh-inner"><input class="ff-inv2-gh-input" type="text" data-inv="group-label" data-group-id="${escapeHtml(gid)}" value="${escapeHtml(g.label)}" aria-label="Group name" /><button type="button" class="ff-inv2-gh-remove" data-inv-remove-start="${escapeHtml(gid)}" title="Remove group" aria-label="Start removing group">×</button></div></th>`;
}

function renderRemoveGroupModal() {
  const gid = _groupRemoveModalGroupId;
  if (!gid) return "";
  return `<div class="ff-inv2-modal-backdrop" id="ff-inv2-group-remove-modal" role="dialog" aria-modal="true" aria-labelledby="ff-inv2-group-remove-title">
  <div class="ff-inv2-modal-card">
    <h3 id="ff-inv2-group-remove-title" class="ff-inv2-modal-title">Are you sure you want to remove this group?</h3>
    <p class="ff-inv2-modal-hint">This action cannot be undone.</p>
    <div class="ff-inv2-modal-actions">
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-cancel" data-inv-modal-cancel="1">Cancel</button>
      <button type="button" class="ff-inv2-modal-btn ff-inv2-modal-btn-danger" data-inv-modal-commit="${escapeHtml(gid)}">Yes, remove group</button>
    </div>
  </div>
</div>`;
}

function renderTableHeaderHtml() {
  if (!_groups) return "";
  const groupCells = _groups.map((g) => renderGroupHeaderTh(g)).join("");
  const subHeaders = _groups
    .map(
      () =>
        `<th class="ff-inv2-subh">Stock</th><th class="ff-inv2-subh">Current</th><th class="ff-inv2-subh">Order</th><th class="ff-inv2-subh">Price</th>`
    )
    .join("");
  return `
<thead>
  <tr>
    <th rowspan="2" class="ff-inv2-th-num" title="Number">No.</th>
    <th rowspan="2" class="ff-inv2-th-code">Code</th>
    <th rowspan="2" class="ff-inv2-th-name">Name</th>
    ${groupCells}
    <th rowspan="2">URL</th>
    <th rowspan="2">Supplier</th>
  </tr>
  <tr>${subHeaders}</tr>
</thead>`;
}

function rowGroupCells(row) {
  if (!_groups) return "";
  return _groups
    .map((g) => {
      const v = row.byGroup[g.id] || { stock: 0, current: 0, price: "" };
      const order = computeOrder(v.stock, v.current);
      const rid = row.id;
      const gid = g.id;
      return `<td><input class="ff-inv2-cell-input" type="text" inputmode="decimal" autocomplete="off" data-inv="stock" data-row-id="${escapeHtml(rid)}" data-group-id="${escapeHtml(gid)}" value="${escapeHtml(String(v.stock))}" /></td>
<td><input class="ff-inv2-cell-input" type="text" inputmode="decimal" autocomplete="off" data-inv="current" data-row-id="${escapeHtml(rid)}" data-group-id="${escapeHtml(gid)}" value="${escapeHtml(String(v.current))}" /></td>
<td class="ff-inv2-order-cell" data-order-for-row="${escapeHtml(rid)}" data-order-for-group="${escapeHtml(gid)}">${escapeHtml(formatOrderDisplay(order))}</td>
<td><input class="ff-inv2-cell-input" type="text" data-inv="price" data-row-id="${escapeHtml(rid)}" data-group-id="${escapeHtml(gid)}" value="${escapeHtml(v.price)}" /></td>`;
    })
    .join("");
}

function renderTableBodyHtml() {
  if (!_rows) return "";
  return _rows
    .map((row, idx) => {
      const rid = row.id;
      return `<tr>
  <td class="ff-inv2-num ff-inv2-td-num">${escapeHtml(String(idx + 1))}</td>
  <td class="ff-inv2-td-code"><input class="ff-inv2-cell-input ff-inv2-mono ff-inv2-code-input" type="text" data-inv="code" data-row-id="${escapeHtml(rid)}" value="${escapeHtml(row.code)}" /></td>
  <td class="ff-inv2-td-name"><input class="ff-inv2-cell-input ff-inv2-name-input" type="text" data-inv="name" data-row-id="${escapeHtml(rid)}" value="${escapeHtml(row.name)}" /></td>
  ${rowGroupCells(row)}
  <td><input class="ff-inv2-cell-input" type="text" data-inv="url" data-row-id="${escapeHtml(rid)}" value="${escapeHtml(row.url)}" /></td>
  <td><input class="ff-inv2-cell-input" type="text" data-inv="supplier" data-row-id="${escapeHtml(rid)}" value="${escapeHtml(row.supplier)}" /></td>
</tr>`;
    })
    .join("");
}

function ensureInventoryScreenDelegates(root) {
  if (root.dataset.ffInvDelegates === "1") return;
  root.dataset.ffInvDelegates = "1";
  root.addEventListener("input", handleInventoryInput);
  root.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!_groupRemoveModalGroupId) return;
    ev.preventDefault();
    _groupRemoveModalGroupId = null;
    mountOrRefreshMockUi();
  });
  root.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const start = t.closest("[data-inv-remove-start]");
    if (start) {
      ev.preventDefault();
      const gid = start.getAttribute("data-inv-remove-start");
      if (gid) {
        _groupRemoveConfirmId = gid;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-inv-remove-cancel]")) {
      ev.preventDefault();
      _groupRemoveConfirmId = null;
      mountOrRefreshMockUi();
      return;
    }
    const openRmModal = t.closest("[data-inv-remove-modal]");
    if (openRmModal) {
      ev.preventDefault();
      const gid = openRmModal.getAttribute("data-inv-remove-modal");
      if (gid) {
        _groupRemoveModalGroupId = gid;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.closest("[data-inv-modal-cancel]")) {
      ev.preventDefault();
      _groupRemoveModalGroupId = null;
      mountOrRefreshMockUi();
      return;
    }
    if (t.classList.contains("ff-inv2-modal-backdrop")) {
      ev.preventDefault();
      _groupRemoveModalGroupId = null;
      mountOrRefreshMockUi();
      return;
    }
    const modalCommit = t.closest("[data-inv-modal-commit]");
    if (modalCommit) {
      ev.preventDefault();
      const gid = modalCommit.getAttribute("data-inv-modal-commit");
      if (gid) {
        removeInventoryGroup(gid);
        _groupRemoveModalGroupId = null;
        _groupRemoveConfirmId = null;
        mountOrRefreshMockUi();
      }
      return;
    }
    if (t.id === "ff-inv2-add-row") {
      ev.preventDefault();
      addInventoryRow();
      mountOrRefreshMockUi();
    } else if (t.id === "ff-inv2-add-group") {
      ev.preventDefault();
      addInventoryGroup();
      mountOrRefreshMockUi();
    }
  });
}

function mountOrRefreshMockUi() {
  const root = document.getElementById("inventoryScreen");
  if (!root) return;

  seedInventoryTableState();
  ensureGroupCellsForRows();
  if (_groupRemoveModalGroupId && _groups && !_groups.some((g) => g.id === _groupRemoveModalGroupId)) {
    _groupRemoveModalGroupId = null;
  }

  injectMockStylesOnce();
  root.classList.add("ff-inv2-screen");

  const meta = getSelectedSubMeta();
  const crumb = meta
    ? `<span class="ff-inv2-crumb"><strong>${escapeHtml(meta.category.name)}</strong> · ${escapeHtml(meta.sub.name)}</span>`
    : `<span class="ff-inv2-crumb">Select a subcategory</span>`;

  root.innerHTML = `
<div class="ff-inv2-layout">
  <aside class="ff-inv2-aside" aria-label="Categories">
    <div class="ff-inv2-aside-head">Categories</div>
    <div class="ff-inv2-aside-body" id="ff-inv2-aside-body">${renderSidebarHtml()}</div>
  </aside>
  <main class="ff-inv2-main" id="ff-inv2-main">
    <div>${crumb}<span class="ff-inv2-mock-pill">Local only · no save</span></div>
    <div class="ff-inv2-table-card">
      <div class="ff-inv2-toolbar">
        <button type="button" class="ff-inv2-btn" id="ff-inv2-add-row">+ Add Row</button>
        <button type="button" class="ff-inv2-btn" id="ff-inv2-add-group">+ Add Group</button>
      </div>
      <div class="ff-inv2-table-scroll">
        <table class="ff-inv2-table">
          ${renderTableHeaderHtml()}
          <tbody>${renderTableBodyHtml()}</tbody>
        </table>
      </div>
    </div>
  </main>
</div>
${renderRemoveGroupModal()}`;

  ensureInventoryScreenDelegates(root);

  const asideBody = root.querySelector("#ff-inv2-aside-body");
  if (!asideBody) return;

  asideBody.querySelectorAll("[data-cat-toggle]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = el.getAttribute("data-cat-toggle");
      if (!id) return;
      if (_expandedCategoryIds.has(id)) _expandedCategoryIds.delete(id);
      else _expandedCategoryIds.add(id);
      mountOrRefreshMockUi();
    });
  });

  asideBody.querySelectorAll(".ff-inv2-sub[data-sub-id]").forEach((el) => {
    const go = () => {
      const id = el.getAttribute("data-sub-id");
      if (!id) return;
      _groupRemoveConfirmId = null;
      _groupRemoveModalGroupId = null;
      _selectedSubcategoryId = id;
      mountOrRefreshMockUi();
    };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });
}

function hideFullscreenPeersForInventory() {
  const ids = [
    "tasksScreen",
    "inboxScreen",
    "chatScreen",
    "mediaScreen",
    "ticketsScreen",
    "trainingScreen",
    "scheduleScreen",
    "userProfileScreen",
    "myProfileScreen",
    "manageQueueScreen",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  const ownerView = document.getElementById("owner-view");
  const joinBar = document.getElementById("joinBar");
  const wrap = document.querySelector(".wrap");
  const queueControls = document.getElementById("queueControls");
  if (ownerView) ownerView.style.display = "none";
  if (joinBar) joinBar.style.display = "none";
  if (wrap) wrap.style.display = "none";
  if (queueControls) queueControls.style.display = "none";
}

export function goToInventory() {
  if (typeof window.ffCloseGlobalBlockingOverlays === "function") {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === "function") {
    window.closeStaffMembersModal();
  }

  hideFullscreenPeersForInventory();

  const screen = document.getElementById("inventoryScreen");
  if (!screen) return;

  mountOrRefreshMockUi();

  screen.style.display = "flex";
  screen.style.flexDirection = "column";

  document.querySelectorAll(".btn-pill").forEach((b) => b.classList.remove("active"));
  const invBtn = document.getElementById("inventoryNavBtn");
  if (invBtn) invBtn.classList.add("active");

  try {
    const bd = document.getElementById("appsOverlayBackdrop");
    const pn = document.getElementById("appsPanel");
    if (bd) bd.style.display = "none";
    if (pn) pn.style.display = "none";
  } catch (e) {}

  if (typeof window.ffUpdateMainNavTabVisibility === "function") {
    try {
      window.ffUpdateMainNavTabVisibility();
    } catch (e) {}
  }
  if (typeof window.ffApplyQueueViewGate === "function") {
    try {
      window.ffApplyQueueViewGate();
    } catch (e) {}
  }
}

if (typeof window !== "undefined") {
  window.goToInventory = goToInventory;
}
