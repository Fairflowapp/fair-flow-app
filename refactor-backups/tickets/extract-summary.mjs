import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'public/tickets.js';
const OUT_MOD = 'public/tickets-summary.js';
const BLOCK_START = 500;  // 1-based inclusive
const BLOCK_END   = 817;  // 1-based inclusive (functions only, excl. trailing blank 818)
const TRAILING_BLANK = 818; // removed from tickets.js too

const sha = s => createHash('sha1').update(s).digest('hex');
const orig = readFileSync(SRC, 'utf8');
const lines = orig.split('\n');

// ---- block (verbatim) ----
const block = lines.slice(BLOCK_START - 1, BLOCK_END).join('\n');

// sanity: trailing blank line is empty
if (lines[TRAILING_BLANK - 1].trim() !== '') {
  console.error('EXPECTED blank at line', TRAILING_BLANK, 'got:', JSON.stringify(lines[TRAILING_BLANK - 1]));
  process.exit(1);
}

const IMPORT_LINE = 'import { loadAndRenderTicketsSummary, populateTicketsEmployeeSelect, syncTicketsTimePeriodSelectOptions, ensureTicketsSummaryDefaultTimePeriod, setupTicketsDateFilters } from "./tickets-summary.js?v=20260630_tickets_summary_split";';

const MOD_HEADER = `/**
 * Tickets Summary Module
 * Extracted verbatim from tickets.js (Phase 9b).
 * Closed-ticket summary table + aggregation + date/employee filters.
 * Pure module: no injected tickets.js dependencies (zero-inject).
 */

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { getTicketsSelfEmployeeFilterId, isStaffRecordManagerOrAdmin, isTicketsTechnicianRestrictedRole } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import { getTicketTaxConfig } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";
import { fetchClosedTicketsForSummary, computeRangeForPreset, _ticketsFmtMonthDay, _ticketsRangeLabelMd, formatSummaryMoney, formatSummaryInt, getSummaryFilterDateRangeFromDom, buildSummaryRowsFromClosedTicketList, buildSummaryRowsFromLiveClosedTickets } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { renderTicketsList, escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { loadServices, subscribeProductsCatalog } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";

`;

const MOD_FOOTER = `

export {
  paintTicketsSummaryTable,
  loadAndRenderTicketsSummary,
  populateTicketsEmployeeSelect,
  syncTicketsTimePeriodSelectOptions,
  ensureTicketsSummaryDefaultTimePeriod,
  applyTicketsTimePeriodFromSelect,
  setupTicketsDateFilters,
  _alignGearToAvatar,
};
`;

const modContent = MOD_HEADER + block + MOD_FOOTER;

// ---- new tickets.js ----
// keep lines 1..35, insert import, keep 36..499, drop 500..818, keep 819..end
const head    = lines.slice(0, 35);           // lines 1..35
const midKeep = lines.slice(35, BLOCK_START - 1); // lines 36..499 (indices 35..498)
const tail    = lines.slice(TRAILING_BLANK);  // lines 819..end (index 818..)
const newLines = [...head, IMPORT_LINE, ...midKeep, ...tail];
const newContent = newLines.join('\n');

writeFileSync(OUT_MOD, modContent);
writeFileSync(SRC, newContent);

console.log('block lines:', BLOCK_END - BLOCK_START + 1);
console.log('block sha  :', sha(block));
console.log('module lines:', modContent.split('\n').length);
console.log('tickets.js  :', orig.split('\n').length, '->', newContent.split('\n').length);
