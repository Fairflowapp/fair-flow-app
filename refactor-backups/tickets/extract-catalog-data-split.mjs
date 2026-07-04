#!/usr/bin/env node
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const backupPath = path.join(ROOT, "refactor-backups/tickets/tickets-catalog-data.pre-split.js");
const pub = path.join(ROOT, "public");
const TOKEN = "20260704_tickets_catalog_data_local_fix";

const backup = fs.readFileSync(backupPath, "utf8");
const lines = backup.split("\n");

const slice = (start, end) => lines.slice(start - 1, end).join("\n");

const sharedHeader = `/**
 * tickets-catalog-data-shared.js
 * Shared/account service catalog — helpers, merge, shared Firestore CRUD, tryLoad.
 * Extracted verbatim from tickets-catalog-data.js (catalog-data split T1).
 */
import { collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, deleteField, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getActiveLocationIdForTickets } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
`;

const sharedBody = [
  slice(23, 116),
  slice(650, 655),
  slice(118, 348),
  slice(362, 502),
  slice(586, 611),
].join("\n\n");

const sharedExports = `export {
  ffCanViewServices,
  ffCanManageServices,
  getTicketsAccountId,
  normalizeSharedCategoryName,
  sharedCategoryId,
  serviceCatalogStableKey,
  serviceCategoryDisplayId,
  sharedServiceCatalogDocRef,
  sharedServiceCatalogItemsRef,
  sharedServiceCategoriesDocRef,
  sharedServiceCategoryItemsRef,
  ensureSharedServiceCatalogDoc,
  ensureSharedServiceCategoriesDoc,
  loadSharedServiceOverrides,
  applySharedServiceCatalog,
  getSharedServicesForCatalogManager,
  getLocationServicesForCatalogManager,
  loadSharedCatalogForManager,
  saveSharedService,
  saveSharedServiceCategory,
  deleteSharedServiceCategory,
  deleteSharedService,
  saveSharedServiceOverride,
  removeSharedServiceOverride,
  loadSharedServiceLocationOverridesForService,
  saveSharedServiceLocationOverride,
  tryLoadSharedServiceCatalog,
  _ffServiceMatchesActiveLocation,
};
`;

const localHeader = `/**
 * tickets-catalog-data-local.js
 * Per-location catalog runtime — init wiring, subscriptions, local CRUD, seed.
 * Extracted verbatim from tickets-catalog-data.js (catalog-data split T2).
 */
import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getActiveLocationIdForTickets } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import {
  applySharedServiceCatalog,
  ffCanManageServices,
  getLocationServicesForCatalogManager,
  getTicketsAccountId,
  loadSharedCatalogForManager,
  normalizeSharedCategoryName,
  saveSharedService,
  saveSharedServiceCategory,
  saveSharedServiceLocationOverride,
  serviceCatalogStableKey,
  tryLoadSharedServiceCatalog,
} from "./tickets-catalog-data-shared.js?v=${TOKEN}";
`;

const localBody = [
  slice(17, 21),
  slice(349, 360),
  slice(504, 584),
  slice(613, 649),
  slice(656, 887),
].join("\n\n");

const localExports = `export {
  initTicketsCatalogData,
  loadLocationCatalogForManager,
  seedSharedServiceCatalogFromLocationCatalogIfEmpty,
  _ffWipeLegacyCatalogOnce,
  _applyCatalogFilter,
  _onCatalogSnapshot,
  subscribeServiceCatalog,
  subscribeProductsCatalog,
  loadServices,
  saveService,
  deleteService,
  loadServiceCategories,
  saveServiceCategory,
  deleteServiceCategory,
};
`;

const entryContent = `/**
 * tickets-catalog-data.js
 * Service catalog data entry — re-exports shared + local modules from the split.
 */
import "./tickets-catalog-data-shared.js?v=${TOKEN}";
import "./tickets-catalog-data-local.js?v=${TOKEN}";

export { initTicketsCatalogData } from "./tickets-catalog-data-local.js?v=${TOKEN}";
export {
  ffCanViewServices,
  ffCanManageServices,
  getTicketsAccountId,
  normalizeSharedCategoryName,
  sharedCategoryId,
  serviceCatalogStableKey,
  serviceCategoryDisplayId,
  sharedServiceCatalogDocRef,
  sharedServiceCatalogItemsRef,
  sharedServiceCategoriesDocRef,
  sharedServiceCategoryItemsRef,
  ensureSharedServiceCatalogDoc,
  ensureSharedServiceCategoriesDoc,
  loadSharedServiceOverrides,
  applySharedServiceCatalog,
  getSharedServicesForCatalogManager,
  getLocationServicesForCatalogManager,
  loadSharedCatalogForManager,
  saveSharedService,
  saveSharedServiceCategory,
  deleteSharedServiceCategory,
  deleteSharedService,
  saveSharedServiceOverride,
  removeSharedServiceOverride,
  loadSharedServiceLocationOverridesForService,
  saveSharedServiceLocationOverride,
  tryLoadSharedServiceCatalog,
  _ffServiceMatchesActiveLocation,
} from "./tickets-catalog-data-shared.js?v=${TOKEN}";
export {
  loadLocationCatalogForManager,
  seedSharedServiceCatalogFromLocationCatalogIfEmpty,
  _ffWipeLegacyCatalogOnce,
  _applyCatalogFilter,
  _onCatalogSnapshot,
  subscribeServiceCatalog,
  subscribeProductsCatalog,
  loadServices,
  saveService,
  deleteService,
  loadServiceCategories,
  saveServiceCategory,
  deleteServiceCategory,
} from "./tickets-catalog-data-local.js?v=${TOKEN}";
`;

fs.writeFileSync(path.join(pub, "tickets-catalog-data-shared.js"), `${sharedHeader}\n${sharedBody}\n\n${sharedExports}\n`);
fs.writeFileSync(path.join(pub, "tickets-catalog-data-local.js"), `${localHeader}\n${localBody}\n\n${localExports}\n`);
fs.writeFileSync(path.join(pub, "tickets-catalog-data.js"), entryContent);

console.log("Wrote shared:", (sharedHeader + sharedBody + sharedExports).split("\n").length, "lines");
console.log("Wrote local:", (localHeader + localBody + localExports).split("\n").length, "lines");
console.log("Wrote entry:", entryContent.split("\n").length, "lines");
