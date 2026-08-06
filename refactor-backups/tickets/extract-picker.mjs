import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'public/tickets.js';
const OUT_MOD = 'public/tickets-picker.js';
const BLOCK_START = 657;   // 1-based inclusive
const BLOCK_END   = 843;   // 1-based inclusive (setupTicketsUI end)
const TRAILING_BLANK = 844;
const HEAD_LINES = 36;     // keep lines 1..36 (through summary import), then insert

const sha = s => createHash('sha1').update(s).digest('hex');
const orig = readFileSync(SRC, 'utf8');
const lines = orig.split('\n');

const block = lines.slice(BLOCK_START - 1, BLOCK_END).join('\n');

if (lines[TRAILING_BLANK - 1].trim() !== '') {
  console.error('EXPECTED blank at line', TRAILING_BLANK, 'got:', JSON.stringify(lines[TRAILING_BLANK - 1]));
  process.exit(1);
}

const IMPORT_LINE = 'import { initTicketsPicker, setupTicketsUI, ffTicketServiceSearchClear, ffTicketServiceSearchSetVisible, updateNewTicketButtonVisibility, ensureTicketsBackgroundSubscription } from "./tickets-picker.js?v=20260701_tickets_picker_split";';
const INIT_LINE = 'initTicketsPicker({ doServiceSelect, getActiveTicketsSalonId, getProductsGroupedByCategory, getServicesGroupedByCategory, getTicketPriceForProductAndActiveLocation, isTicketPickerServiceAvailableForActiveLocation });';

const MOD_HEADER = `/**
 * Tickets Picker / Setup Module
 * Extracted verbatim from tickets.js (Phase 9c).
 * Ticket service-search (UI filter over the loaded catalog) + main setupTicketsUI,
 * new-ticket button visibility, and the background-subscription bootstrap.
 *
 * tickets.js-resident helpers are injected via initTicketsPicker to avoid cycles.
 */

import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { ffTicketMoney } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { _ticketsCurrentStaffRow, updateTicketsTabsVisibility } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import { escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { subscribeTickets } from "./tickets-crud.js?v=20260630_tickets_crud_split";
import { addProductToTicket } from "./tickets-modal.js?v=20260630_tickets_modal_split";
import { canStaffSendNewTicket } from "./tickets-catalog-ui.js?v=20260630_tickets_catalog_ui_split3";
import { subscribeProductsCatalog } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";

let doServiceSelect, getActiveTicketsSalonId, getProductsGroupedByCategory, getServicesGroupedByCategory, getTicketPriceForProductAndActiveLocation, isTicketPickerServiceAvailableForActiveLocation;

export function initTicketsPicker(deps) {
  doServiceSelect = deps.doServiceSelect;
  getActiveTicketsSalonId = deps.getActiveTicketsSalonId;
  getProductsGroupedByCategory = deps.getProductsGroupedByCategory;
  getServicesGroupedByCategory = deps.getServicesGroupedByCategory;
  getTicketPriceForProductAndActiveLocation = deps.getTicketPriceForProductAndActiveLocation;
  isTicketPickerServiceAvailableForActiveLocation = deps.isTicketPickerServiceAvailableForActiveLocation;
}

`;

const MOD_FOOTER = `

export {
  ffTicketServiceSearchClear,
  ffTicketServiceSearchSetVisible,
  ffRenderTicketServiceSearch,
  ffTicketServiceSearchWire,
  updateNewTicketButtonVisibility,
  ensureTicketsBackgroundSubscription,
  setupTicketsUI,
};
`;

const modContent = MOD_HEADER + block + MOD_FOOTER;

const head    = lines.slice(0, HEAD_LINES);              // lines 1..36
const midKeep = lines.slice(HEAD_LINES, BLOCK_START - 1); // lines 37..656
const tail    = lines.slice(TRAILING_BLANK);             // lines 845..end
const newLines = [...head, IMPORT_LINE, INIT_LINE, ...midKeep, ...tail];
const newContent = newLines.join('\n');

writeFileSync(OUT_MOD, modContent);
writeFileSync(SRC, newContent);

console.log('block lines:', BLOCK_END - BLOCK_START + 1);
console.log('block sha  :', sha(block));
console.log('module lines:', modContent.split('\n').length);
console.log('tickets.js  :', orig.split('\n').length, '->', newContent.split('\n').length);
