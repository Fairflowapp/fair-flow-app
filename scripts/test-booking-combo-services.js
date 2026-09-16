/**
 * Phase 1 Combo Services — catalog model, validation, and save compatibility.
 * Usage: node scripts/test-booking-combo-services.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "public/tickets-catalog-combo.js"), "utf8")
  .replace(/^export /gm, "");
const windowObj = {};
new Function("window", src)(windowObj);
const api = windowObj.ffCatalogCombo;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

check("combo helper loaded", !!api);

const manicure = { id: "svc-manicure", name: "Manicure", durationMinutes: 35, defaultPrice: 40 };
const pedicure = { id: "svc-pedicure", name: "Pedicure", durationMinutes: 45, defaultPrice: 45 };
const gel = { id: "svc-gel", name: "Gel Full Set", durationMinutes: 90, defaultPrice: 70 };
const catalog = [manicure, pedicure, gel];

check(
  "existing service without serviceType defaults to Single",
  api.normalizeServiceType({ name: "Manicure", defaultPrice: 30 }) === "single"
    && api.isSingleService({ name: "Manicure" }) === true
    && api.isComboService({ name: "Manicure" }) === false
);

check(
  "unknown serviceType is treated as Single",
  api.normalizeServiceType({ serviceType: "package" }) === "single"
);

const implicit = api.copyComboCatalogFields({}, { id: "legacy", name: "Manicure", defaultPrice: 30 });
check("legacy copy has serviceType single", implicit.serviceType === "single");
check("legacy copy has empty components", Array.isArray(implicit.components) && implicit.components.length === 0);

const singleCreate = api.comboSaveFields({
  serviceType: "single",
  defaultPrice: 40,
  catalogServices: catalog
});
check("creating a Single Service is valid", singleCreate.ok === true && singleCreate.serviceType === "single");
check("single create does not invent components", singleCreate.components.length === 0);

const singleEditPayload = {};
const singleEditPatch = api.applyComboFieldsToServicePayload(singleEditPayload, {
  id: "svc-manicure",
  serviceType: "single",
  name: "Manicure"
}, false);
check("editing a Single writes serviceType single", singleEditPayload.serviceType === "single" && singleEditPatch.clearComponents === true);
check("editing a Single does not write a components array", singleEditPayload.components == null);

const comboComponents = [
  { serviceId: "svc-manicure", allocatedPrice: 30, sortOrder: 0 },
  { serviceId: "svc-pedicure", allocatedPrice: 35, sortOrder: 1 }
];
const comboCreate = api.comboSaveFields({
  serviceType: "combo",
  defaultPrice: 65,
  components: comboComponents,
  catalogServices: catalog
});
check("creating a Combo Service is valid", comboCreate.ok === true && comboCreate.serviceType === "combo");
check("combo save keeps two components", comboCreate.components.length === 2);
check(
  "combo duration is the sum of component durations",
  comboCreate.durationMinutes === 80
);

const tooFew = api.validateComboService({
  defaultPrice: 65,
  components: [{ serviceId: "svc-manicure", allocatedPrice: 65, sortOrder: 0 }],
  catalogServices: catalog
});
check("Combo requires at least 2 components", tooFew.ok === false && tooFew.code === "MIN_COMPONENTS");

const nestedParent = {
  id: "svc-combo",
  name: "Manicure + Pedicure Combo",
  serviceType: "combo",
  defaultPrice: 65,
  components: comboComponents
};
const nested = api.validateComboService({
  id: "svc-other-combo",
  defaultPrice: 65,
  components: [
    { serviceId: "svc-combo", allocatedPrice: 30, sortOrder: 0 },
    { serviceId: "svc-gel", allocatedPrice: 35, sortOrder: 1 }
  ],
  catalogServices: catalog.concat([nestedParent])
});
check("only existing Single Services can be components", nested.ok === false && nested.code === "NESTED_COMBO");

const missing = api.validateComboService({
  defaultPrice: 65,
  components: [
    { serviceId: "svc-missing", allocatedPrice: 30, sortOrder: 0 },
    { serviceId: "svc-pedicure", allocatedPrice: 35, sortOrder: 1 }
  ],
  catalogServices: catalog
});
check("invalid referenced service IDs are rejected", missing.ok === false && missing.code === "MISSING_SERVICE");

const selfRef = api.validateComboService({
  id: "svc-manicure",
  defaultPrice: 65,
  components: [
    { serviceId: "svc-manicure", allocatedPrice: 30, sortOrder: 0 },
    { serviceId: "svc-pedicure", allocatedPrice: 35, sortOrder: 1 }
  ],
  catalogServices: catalog
});
check("combo cannot reference itself", selfRef.ok === false && selfRef.code === "SELF_REFERENCE");

const dupes = api.validateComboService({
  defaultPrice: 65,
  components: [
    { serviceId: "svc-manicure", allocatedPrice: 30, sortOrder: 0 },
    { serviceId: "svc-manicure", allocatedPrice: 35, sortOrder: 1 }
  ],
  catalogServices: catalog
});
check("duplicate component services are rejected", dupes.ok === false && dupes.code === "DUPLICATE_COMPONENT");

const moved = api.moveComboComponent(comboComponents, 0, 1);
check("move down swaps component order", moved[0].serviceId === "svc-pedicure" && moved[1].serviceId === "svc-manicure");
check("moved components get sequential sortOrder", moved[0].sortOrder === 0 && moved[1].sortOrder === 1);
const movedBack = api.moveComboComponent(moved, 1, -1);
check("move up restores original order", movedBack[0].serviceId === "svc-manicure" && movedBack[1].serviceId === "svc-pedicure");

check(
  "allocated prices reconcile to Combo selling price",
  api.allocatedPricesReconcile(comboComponents, 65) === true
);
check(
  "allocated prices that do not match combo price fail",
  api.validateComboService({
    defaultPrice: 65,
    components: [
      { serviceId: "svc-manicure", allocatedPrice: 30, sortOrder: 0 },
      { serviceId: "svc-pedicure", allocatedPrice: 30, sortOrder: 1 }
    ],
    catalogServices: catalog
  }).code === "PRICE_MISMATCH"
);
check(
  "float-safe cents: 19.99 + 20.01 = 40.00",
  api.allocatedPricesReconcile([
    { serviceId: "svc-manicure", allocatedPrice: 19.99, sortOrder: 0 },
    { serviceId: "svc-pedicure", allocatedPrice: 20.01, sortOrder: 1 }
  ], 40) === true
);

const persisted = {
  id: "svc-combo",
  name: "Manicure + Pedicure Combo",
  serviceType: "combo",
  defaultPrice: 65,
  durationMinutes: 80,
  components: comboComponents
};
const reloaded = api.copyComboCatalogFields({}, persisted);
check("Combo persists serviceType through reload mapping", reloaded.serviceType === "combo");
check(
  "Combo reloads component serviceIds",
  reloaded.components.map(function (row) { return row.serviceId; }).join(",") === "svc-manicure,svc-pedicure"
);
check(
  "Combo reloads allocated prices",
  reloaded.components[0].allocatedPrice === 30 && reloaded.components[1].allocatedPrice === 35
);

const edited = api.comboSaveFields({
  id: "svc-combo",
  serviceType: "combo",
  defaultPrice: 70,
  components: [
    { serviceId: "svc-pedicure", allocatedPrice: 25, sortOrder: 0 },
    { serviceId: "svc-gel", allocatedPrice: 45, sortOrder: 1 }
  ],
  catalogServices: catalog.concat([persisted])
});
check("editing Combo components is valid", edited.ok === true);
check("edited Combo keeps the new first component", edited.components[0].serviceId === "svc-pedicure");
check("edited Combo allocated prices follow the new selling price", edited.components[1].allocatedPrice === 45);
check("edited Combo duration updates from new components", edited.durationMinutes === 135);

const eligible = api.listEligibleComboComponentServices(catalog.concat([persisted]), "svc-combo", ["svc-manicure"]);
check("eligible components exclude the combo itself", eligible.every(function (row) { return row.id !== "svc-combo"; }));
check("eligible components exclude already selected singles", eligible.every(function (row) { return row.id !== "svc-manicure"; }));
check("eligible components exclude other combos", eligible.every(function (row) { return api.isSingleService(row); }));

const used = api.combosUsingService("svc-manicure", catalog.concat([persisted]));
check("a Single used by a Combo can be found", used.length === 1 && used[0].id === "svc-combo");

const reorderPayload = { name: "Manicure", category: "Nails", defaultPrice: 40, active: true, sortOrder: 1 };
const reorderPatch = api.applyComboFieldsToServicePayload(reorderPayload, {
  id: "svc-manicure",
  name: "Manicure",
  category: "Nails",
  defaultPrice: 40,
  active: true,
  sortOrder: 1
}, false);
check("existing Services remain compatible: reorder omits combo fields", reorderPatch.written === false);
check("reorder payload has no serviceType", reorderPayload.serviceType == null);
check("reorder payload has no components", reorderPayload.components == null);

const createSinglePayload = {};
api.applyComboFieldsToServicePayload(createSinglePayload, {
  name: "Manicure",
  serviceType: "single",
  defaultPrice: 40
}, true);
check("new Single payload writes serviceType", createSinglePayload.serviceType === "single");
check("new Single payload does not write empty components", createSinglePayload.components == null);

const createComboPayload = {};
api.applyComboFieldsToServicePayload(createComboPayload, {
  name: "Manicure + Pedicure Combo",
  serviceType: "combo",
  defaultPrice: 65,
  components: comboComponents
}, true);
check("new Combo payload writes serviceType combo", createComboPayload.serviceType === "combo");
check("new Combo payload writes components", Array.isArray(createComboPayload.components) && createComboPayload.components.length === 2);

const typeHtml = api.catalogServiceTypeControlsHtml("single");
check("Service Type UI includes Single", typeHtml.indexOf("Single") !== -1);
check("Service Type UI includes Combo", typeHtml.indexOf("Combo") !== -1);
check("default Service Type is Single", /value="single"[^>]*checked/.test(typeHtml) === true);

const comboUi = api.comboComponentsSectionHtml({
  components: comboComponents,
  catalogServices: catalog,
  comboPrice: 65,
  comboId: "svc-combo"
});
check("Combo UI shows component names", comboUi.indexOf("Manicure") !== -1 && comboUi.indexOf("Pedicure") !== -1);
check("Combo UI shows component durations", comboUi.indexOf("35 min") !== -1 && comboUi.indexOf("45 min") !== -1);
check("Combo UI shows allocated prices", comboUi.indexOf("30.00") !== -1 && comboUi.indexOf("35.00") !== -1);

const data = fs.readFileSync(path.join(root, "public/tickets-catalog-data.js"), "utf8");
check("catalog save still uses durationMinutes", data.includes("payload.durationMinutes") || data.includes("applyDurationMinutesToServicePayload"));
check("catalog save applies combo fields", data.includes("applyComboPayloadAndClearFlag"));
check("shared mapping copies combo fields", data.includes("copyComboCatalogFields"));

const editSrc = fs.readFileSync(path.join(root, "public/tickets-catalog-edit.js"), "utf8");
check("New/Edit Service editor includes Service Type", editSrc.includes("catalogServiceTypeControlsHtml"));
check("New/Edit Service editor wires Combo components", editSrc.includes("wireComboEditor"));

const renderSrc = fs.readFileSync(path.join(root, "public/tickets-catalog-render.js"), "utf8");
check("inline Details edit includes Service Type", renderSrc.includes("servicesInlineEditServiceType"));
check("inline Details edit includes Combo wrap", renderSrc.includes("servicesInlineEditComboWrap"));

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All combo service tests passed.");
