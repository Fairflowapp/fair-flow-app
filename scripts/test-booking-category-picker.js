/**
 * Service Category picker: existing categories first, create is explicit.
 * Usage: node scripts/test-booking-category-picker.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

function normalizeSharedCategoryName(category) {
  const s = String(category || "").trim();
  return s || "Other";
}
function sharedCategoryId(category) {
  return "shared:" + normalizeSharedCategoryName(category).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "other";
}
function catalogCategoryIdentityKey(name) {
  return normalizeSharedCategoryName(name).toLowerCase();
}
function dedupeCatalogCategories(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((cat) => {
    if (!cat) return;
    if (String(cat.id || "") === "__other__") return;
    const name = normalizeSharedCategoryName(cat.name);
    if (!name) return;
    const key = catalogCategoryIdentityKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ ...cat, id: cat.id || sharedCategoryId(name), name });
  });
  return out;
}
function findExistingCatalogCategory(nameOrId, list) {
  const raw = String(nameOrId || "").trim();
  if (!raw) return null;
  const key = catalogCategoryIdentityKey(raw);
  const slug = sharedCategoryId(raw);
  return (Array.isArray(list) ? list : []).find((cat) => {
    if (!cat) return false;
    if (String(cat.id || "") === raw) return true;
    if (sharedCategoryId(cat.name) === slug) return true;
    return catalogCategoryIdentityKey(cat.name) === key;
  }) || null;
}

const categories = dedupeCatalogCategories([
  { id: "shared:hands", name: "Hands" },
  { id: "shared:hands-dup", name: "hands" },
  { id: "shared:feet", name: "Feet" },
  { id: "shared:combo", name: "Combo" },
  { id: "shared:waxing", name: "Waxing" },
  { id: "shared:massage", name: "Massage" },
  { id: "__other__", name: "Other" }
]);

check("dedupe collapses Hands / hands", categories.filter((c) => catalogCategoryIdentityKey(c.name) === "hands").length === 1);
check("existing category list keeps Hands Feet Combo Waxing Massage", ["Hands", "Feet", "Combo", "Waxing", "Massage"].every((name) => {
  return categories.some((c) => c.name === name || catalogCategoryIdentityKey(c.name) === name.toLowerCase());
}));
check("find by id preselects Hands", findExistingCatalogCategory("shared:hands", categories).name === "Hands");
check("find by typed hands reuses Hands and does not invent a duplicate", findExistingCatalogCategory("hands", categories).id === "shared:hands"
  || catalogCategoryIdentityKey(findExistingCatalogCategory("HANDS", categories).name) === "hands");
check("unknown name is not treated as an existing category", findExistingCatalogCategory("Brand New Cat", categories) == null);

const dataSrc = fs.readFileSync(path.join(root, "public/tickets-catalog-data.js"), "utf8");
check("catalog data exports category picker helpers", dataSrc.includes("function dedupeCatalogCategories")
  && dataSrc.includes("function findExistingCatalogCategory")
  && dataSrc.includes("dedupeCatalogCategories,")
  && dataSrc.includes("findExistingCatalogCategory,"));

const editSrc = fs.readFileSync(path.join(root, "public/tickets-catalog-edit.js"), "utf8");
check("New/Edit Service uses an existing category select", editSrc.includes("fillEditorCategorySelect")
  && editSrc.includes("Select existing category"));
check("shared Service editor no longer hides the category select", !editSrc.includes("if (catSel) catSel.style.display = 'none';"));
check("creating a category is a separate explicit action", editSrc.includes("servicesCatalogEditorCreateCategory")
  && editSrc.includes("+ Create new category")
  && editSrc.includes("createEditorCategory"));
check("shared save persists the selected existing category name", editSrc.includes("requireEditorCategory")
  && editSrc.includes("normalizeSharedCategoryName(selectedCategory.name)"));
check("duplicate create reuses the existing category", editSrc.includes("findExistingCatalogCategory(raw, categories)"));

const renderSrc = fs.readFileSync(path.join(root, "public/tickets-catalog-render.js"), "utf8");
check("inline edit Category is a picker of existing categories", renderSrc.includes("servicesInlineEditCategory")
  && renderSrc.includes("Select existing category")
  && renderSrc.includes("dedupeCatalogCategories")
  && renderSrc.includes("findExistingCatalogCategory"));
check("inline edit can create a category as a separate action", renderSrc.includes("servicesInlineEditCreateCategory")
  && renderSrc.includes("+ Create new category"));
check("inline shared save writes category name not a free-text id", renderSrc.includes("category: categoryName")
  && renderSrc.includes("sharedCategoryId(categoryName)"));

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All category picker tests passed.");
