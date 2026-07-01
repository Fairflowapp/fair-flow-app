import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'public/tickets-modal.js';
const sha = s => createHash('sha1').update(s).digest('hex');
const orig = readFileSync(SRC, 'utf8');
const lines = orig.split('\n');

// contiguous blocks (1-based inclusive)
const A_START = 47, A_END = 582;   // view
const SEP = 583;                   // blank between
const B_START = 584, B_END = 1138; // edit
const TAIL_BLANK = 1139;           // blank before export

for (const [ln, lbl] of [[SEP,'SEP'],[TAIL_BLANK,'TAIL_BLANK']])
  if (lines[ln-1].trim() !== '') { console.error('EXPECTED blank at', lbl, ln, JSON.stringify(lines[ln-1])); process.exit(1); }

const blockA = lines.slice(A_START-1, A_END).join('\n');
const blockB = lines.slice(B_START-1, B_END).join('\n');

const TOKEN = '20260701_tickets_modal_split';

// ---- shared import specifiers ----
const FS = 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

function letBlock(names) { return `let ${names.join(', ')};`; }
function initBody(fnName, tjs, cross) {
  const lines = [`export function ${fnName}(deps) {`];
  for (const n of tjs) lines.push(`  ${n} = deps.${n};`);
  for (const n of cross) lines.push(`  ${n} = deps.${n};`);
  lines.push('}');
  return lines.join('\n');
}
function exportBlock(names) { return 'export {\n' + names.map(n=>'  '+n+',').join('\n') + '\n};\n'; }

// ================= VIEW =================
const VIEW_TJS = ['showToast','ticketConfirm','computeDiff','ffRenderFrontDeskChangesHtml','ffTicketServiceSearchClear','ffTicketServiceSearchSetVisible','setupTicketsUI'];
const VIEW_CROSS = ['populateTicketForm','setupTicketServiceUpgradeControl','doCloseTicket','doSendNewTicket','paintTicketServiceUpgradeButton','updateTicketDiff','setupTicketFormToggles'];
const VIEW_EXPORTS = ['openTicketModal','ffFormatReviewedAt','toggleTicketReviewed','openAdminTicketView','closeTicketModal','openTicketDetailsModal','closeTicketDetailsModal','ffTicketRequiresCustomerName','ffApplyTicketCustomerRequiredUI','resetTicketForm'];

const viewHeader = `/**
 * Tickets — modal VIEW half (Phase 10 split of tickets-modal.js, part 1/2).
 * Open dispatcher, admin & closed-ticket detail views, reviewed toggle,
 * close handlers, customer-name-required UI, and the create/edit form reset.
 *
 * tickets.js helpers + sibling (edit-half) functions are injected via
 * initModalView (fanned out from the tickets-modal.js barrel) to keep the
 * two halves free of a circular import.
 */
import { serverTimestamp } from "${FS}";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { updateTicketsNavBadge, markTicketSeenByFrontDesk, updateTicket, reopenTicket, archiveTicket, deleteTicketPermanently } from "./tickets-crud.js?v=20260630_tickets_crud_split";
import { renderTicketsList, escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { ffTicketMoney, formatTicketDisplayDateTime } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { canSeeTicket, canCurrentUserCloseTickets, getTicketVisibility } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";

${letBlock([...VIEW_TJS, ...VIEW_CROSS])}
${initBody('initModalView', VIEW_TJS, VIEW_CROSS)}

`;
const viewContent = viewHeader + blockA + '\n\n' + exportBlock(VIEW_EXPORTS);

// ================= EDIT =================
const EDIT_TJS = ['showToast','ticketConfirm','ffTicketLinesChanged','ffTicketServiceSearchClear','ffTicketServiceSearchSetVisible','setupTicketsUI','getTicketPriceForServiceAndCurrentStaff','getTicketPriceForProductAndActiveLocation'];
const EDIT_CROSS = ['closeTicketModal','openTicketDetailsModal','ffTicketRequiresCustomerName','ffApplyTicketCustomerRequiredUI'];
const EDIT_EXPORTS = ['populateTicketForm','syncTicketFormLinesFromDom','renderPerformedLines','renderDiff','addServiceToTicket','addProductToTicket','setupTicketFormToggles','updateTicketDiff','updateTicketTotal','paintTicketServiceUpgradeButton','setupTicketServiceUpgradeControl','saveTicket','doSendNewTicket','doFinalizeTicket','doCloseTicket'];

const editHeader = `/**
 * Tickets — modal EDIT half (Phase 10 split of tickets-modal.js, part 2/2).
 * Form population, performed-line editing (add service/product, price/note,
 * totals/diff), service-upgrade control, and the save/send/finalize/close
 * action handlers.
 *
 * tickets.js helpers + sibling (view-half) functions are injected via
 * initModalEdit (fanned out from the tickets-modal.js barrel) to keep the
 * two halves free of a circular import.
 */
import { serverTimestamp } from "${FS}";
import { ticketsState } from "./tickets-state.js?v=20260630_tickets_state_split";
import { updateTicketsNavBadge, markTicketSeenByFrontDesk, updateTicket, archiveTicket, deleteTicketPermanently, setTicketServiceUpgrade, awardTicketUpgradePoints, createTicket, finalizeTicket, getTicketCustomerPriceApprovedFromForm, closeTicket } from "./tickets-crud.js?v=20260630_tickets_crud_split";
import { renderTicketsList, escapeHtml } from "./tickets-list.js?v=20260630_tickets_list_split";
import { ffTicketMoney, ffTicketCurSym } from "./tickets-helpers.js?v=20260630_tickets_helpers_split";
import { computeTicketTotalsFromLines } from "./tickets-pricing.js?v=20260630_tickets_pricing_split";
import { canSeeTicket, canCurrentUserCloseTickets, getTicketVisibility, getAutoFrontDeskRecipients } from "./tickets-permissions.js?v=20260630_tickets_permissions_split";
import { loadServiceCategories, loadServices } from "./tickets-catalog-data.js?v=20260630_tickets_catalog_data_split";

${letBlock([...EDIT_TJS, ...EDIT_CROSS])}
${initBody('initModalEdit', EDIT_TJS, EDIT_CROSS)}

`;
const editContent = editHeader + blockB + '\n\n' + exportBlock(EDIT_EXPORTS);

// ================= BARREL =================
const ALL = [...VIEW_EXPORTS, ...EDIT_EXPORTS];
const barrel = `/**
 * Tickets — ticket modal (thin barrel; Phase 10 split).
 *
 * The former single tickets-modal.js was split into two cohesive halves:
 *   tickets-modal-view.js  — open/close, admin & detail views, form reset
 *   tickets-modal-edit.js  — populate, line editing, totals, save actions
 *
 * This barrel keeps the public API identical (re-exports all 25 functions) so
 * tickets.js is unchanged. initTicketsModal fans the 10 injected tickets.js
 * helpers out to initModalView / initModalEdit, and wires the cross-half
 * function references between the two modules (breaking the import cycle).
 */
import { initModalView, ${VIEW_EXPORTS.join(', ')} } from "./tickets-modal-view.js?v=${TOKEN}";
import { initModalEdit, ${EDIT_EXPORTS.join(', ')} } from "./tickets-modal-edit.js?v=${TOKEN}";

export function initTicketsModal(deps) {
  initModalView({
    showToast: deps.showToast,
    ticketConfirm: deps.ticketConfirm,
    computeDiff: deps.computeDiff,
    ffRenderFrontDeskChangesHtml: deps.ffRenderFrontDeskChangesHtml,
    ffTicketServiceSearchClear: deps.ffTicketServiceSearchClear,
    ffTicketServiceSearchSetVisible: deps.ffTicketServiceSearchSetVisible,
    setupTicketsUI: deps.setupTicketsUI,
    populateTicketForm, setupTicketServiceUpgradeControl, doCloseTicket, doSendNewTicket,
    paintTicketServiceUpgradeButton, updateTicketDiff, setupTicketFormToggles,
  });
  initModalEdit({
    showToast: deps.showToast,
    ticketConfirm: deps.ticketConfirm,
    ffTicketLinesChanged: deps.ffTicketLinesChanged,
    ffTicketServiceSearchClear: deps.ffTicketServiceSearchClear,
    ffTicketServiceSearchSetVisible: deps.ffTicketServiceSearchSetVisible,
    setupTicketsUI: deps.setupTicketsUI,
    getTicketPriceForServiceAndCurrentStaff: deps.getTicketPriceForServiceAndCurrentStaff,
    getTicketPriceForProductAndActiveLocation: deps.getTicketPriceForProductAndActiveLocation,
    closeTicketModal, openTicketDetailsModal, ffTicketRequiresCustomerName, ffApplyTicketCustomerRequiredUI,
  });
}

${exportBlock(ALL)}`;

writeFileSync('public/tickets-modal-view.js', viewContent);
writeFileSync('public/tickets-modal-edit.js', editContent);
writeFileSync(SRC, barrel);

console.log('blockA lines:', A_END-A_START+1, 'sha', sha(blockA));
console.log('blockB lines:', B_END-B_START+1, 'sha', sha(blockB));
console.log('view.js  lines:', viewContent.split('\n').length);
console.log('edit.js  lines:', editContent.split('\n').length);
console.log('barrel   lines:', barrel.split('\n').length);
