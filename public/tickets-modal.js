/**
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
import { initModalView, openTicketModal, ffFormatReviewedAt, toggleTicketReviewed, openAdminTicketView, closeTicketModal, openTicketDetailsModal, closeTicketDetailsModal, ffTicketRequiresCustomerName, ffApplyTicketCustomerRequiredUI, resetTicketForm } from "./tickets-modal-view.js?v=20260708_ticket_list_fix";
import { initModalEdit, populateTicketForm, syncTicketFormLinesFromDom, renderPerformedLines, renderDiff, addServiceToTicket, addProductToTicket, setupTicketFormToggles, updateTicketDiff, updateTicketTotal, paintTicketServiceUpgradeButton, setupTicketServiceUpgradeControl, saveTicket, doSendNewTicket, doFinalizeTicket, doCloseTicket } from "./tickets-modal-edit.js?v=20260708_ticket_list_fix";

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

export {
  openTicketModal,
  ffFormatReviewedAt,
  toggleTicketReviewed,
  openAdminTicketView,
  closeTicketModal,
  openTicketDetailsModal,
  closeTicketDetailsModal,
  ffTicketRequiresCustomerName,
  ffApplyTicketCustomerRequiredUI,
  resetTicketForm,
  populateTicketForm,
  syncTicketFormLinesFromDom,
  renderPerformedLines,
  renderDiff,
  addServiceToTicket,
  addProductToTicket,
  setupTicketFormToggles,
  updateTicketDiff,
  updateTicketTotal,
  paintTicketServiceUpgradeButton,
  setupTicketServiceUpgradeControl,
  saveTicket,
  doSendNewTicket,
  doFinalizeTicket,
  doCloseTicket,
};
