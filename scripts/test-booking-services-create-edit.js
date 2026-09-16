/**
 * Services catalog create vs edit toasts.
 * Usage: node scripts/test-booking-services-create-edit.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "public/tickets-catalog-toast.js"), "utf8")
  .replace(/^export /gm, "");
const windowObj = {};
new Function("window", src)(windowObj);
const api = windowObj.ffCatalogServiceToast;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("toast helper loaded", !!api && typeof api.catalogServiceSavedToast === "function");
check("location create toast is Service added", api.catalogServiceSavedToast("service-add") === "Service added");
check("shared create toast is Service added", api.catalogServiceSavedToast("shared-service-add") === "Service added");
check("location edit toast stays Updated", api.catalogServiceSavedToast("service-edit") === "Updated");
check("shared edit toast stays Service updated", api.catalogServiceSavedToast("shared-service-edit") === "Service updated");
check("inline edit without create mode stays Updated", api.catalogServiceSavedToast("service-edit") === "Updated");
check("create mode helper accepts service-add", api.isCatalogServiceCreateMode("service-add") === true);
check("create mode helper accepts shared-service-add", api.isCatalogServiceCreateMode("shared-service-add") === true);
check("edit is not a create mode", api.isCatalogServiceCreateMode("service-edit") === false);
check("shared edit is not a create mode", api.isCatalogServiceCreateMode("shared-service-edit") === false);

const editSrc = fs.readFileSync(path.join(root, "public/tickets-catalog-edit.js"), "utf8");
check("editor uses catalogServiceSavedToast", editSrc.includes("catalogServiceSavedToast(ctx.mode)"));
check("editor does not toast Service added before rerender", (() => {
  const addIdx = editSrc.indexOf("} else if (ctx.mode === 'service-add') {");
  const sharedIdx = editSrc.indexOf("} else if (ctx.mode === 'shared-service-add' || ctx.mode === 'shared-service-edit') {");
  const renderIdx = editSrc.indexOf("renderServicesCatalogV2();");
  const toastIdx = editSrc.lastIndexOf("if (serviceSaveToast) showToast(serviceSaveToast, 'success');");
  return addIdx !== -1 && sharedIdx !== -1 && renderIdx !== -1 && toastIdx !== -1 && toastIdx > renderIdx;
})());
check("create clears leftover inline edit before rerender", editSrc.includes("if (isCatalogServiceCreateMode(ctx.mode)) ticketsState._ffServicesInlineEditServiceId = null;"));
check("location create still calls saveService without an id", (() => {
  const block = editSrc.slice(editSrc.indexOf("} else if (ctx.mode === 'service-add') {"), editSrc.indexOf("} else if (ctx.mode === 'service-edit') {"));
  return block.includes("await saveService({") && !/id:\s*s\.id/.test(block);
})());
check("location edit still calls saveService with the existing id", (() => {
  const block = editSrc.slice(editSrc.indexOf("} else if (ctx.mode === 'service-edit') {"), editSrc.indexOf("} else if (ctx.mode === 'shared-service-add' || ctx.mode === 'shared-service-edit') {"));
  return block.includes("id: s.id");
})());

const renderSrc = fs.readFileSync(path.join(root, "public/tickets-catalog-render.js"), "utf8");
check("inline Details save uses catalogServiceSavedToast", renderSrc.includes("catalogServiceSavedToast(selected.id ? 'service-edit' : 'service-add')"));
check("inline Details save still persists with selected.id", renderSrc.includes("id: selected.id"));

const comboSrc = fs.readFileSync(path.join(root, "public/tickets-catalog-combo.js"), "utf8");
check("Combo helper module has no toast strings", comboSrc.indexOf("showToast") === -1 && comboSrc.indexOf("Service added") === -1);

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All Services create/edit toast tests passed.");
