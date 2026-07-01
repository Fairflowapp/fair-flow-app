/**
 * Staff Documents (Phase 1) — read-only list from
 * salons/{salonId}/staff/{staffId}/documents/{documentId}
 *
 * Phase 2 — inbox approval sync helpers (used by inbox.js).
 */
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import { sdState } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";
import { trimStr } from "./staff-documents-format.js?v=20260701_staffdoc_format_split";
import {
  ffResyncStaffDocumentFromInbox,
} from "./staff-documents-inbox-sync.js?v=20260701_staffdoc_inbox_sync_split";
export {
  ffResolveLinkedStaffDocumentId,
  ffResolveStaffDocumentOwnerStaffId,
  ffResolveStaffDocumentOwnerStaffIdWithFallback,
  ffResyncStaffDocumentFromInbox,
  ffSyncStaffDocumentOnInboxApprove,
  ffSyncStaffDocumentOnInboxReject,
} from "./staff-documents-inbox-sync.js?v=20260701_staffdoc_inbox_sync_split";
export {
  ffStaffDocumentTypeSelectOptionsHtml,
  ffExpirationTimestampToYmdInput,
  ffComputeLifecycleFromExpiration,
} from "./staff-documents-format.js?v=20260701_staffdoc_format_split";

// --- Phase 2: Inbox → staff /documents sync (approve / reject) ---



import {
  ffToast,
  ffHandleStaffDocumentActionClick,
  initStaffDocumentsUi,
} from "./staff-documents-ui.js?v=20260701_staffdoc_ui_split";
export { ffUpdateStaffDocumentMetadata } from "./staff-documents-ui.js?v=20260701_staffdoc_ui_split";
import { ffRunExpiryChatNotify, ffSendExpiryChatReminderForStaffDocContext } from "./staff-documents-expiry-chat.js?v=20260701_staffdoc_expiry_split";
export { ffSendExpiryChatReminderForStaffDocContext };
import { ensureStaffDocSearchListeners, renderListIntoContainer, ensureSubscription } from "./staff-documents-render.js?v=20260701_staffdoc_render_split";

initStaffDocumentsUi({ renderListIntoContainer, ffRunExpiryChatNotify });






/**
 * Unsubscribe from Firestore and clear listener state.
 */
export function ffStaffDocumentsUnmount() {
  if (typeof sdState._unsub === "function") {
    try {
      sdState._unsub();
    } catch (_) {}
  }
  sdState._unsub = null;
  sdState._mountedKey = "";
  sdState._mountCtx = { salonId: "", staffId: "" };
  sdState._lastDocList = null;
  sdState._staffDocumentsFilter = "active";
  sdState._staffDocumentsSearchQuery = "";
  sdState._staffDocsViewerCanEditMeta = false;
  if (sdState._ffBoundContainer && sdState._onDocActionClick) {
    try {
      sdState._ffBoundContainer.removeEventListener("click", sdState._onDocActionClick);
    } catch (_) {}
  }
  if (sdState._ffBoundContainer && sdState._onStaffDocSearchInput) {
    try {
      sdState._ffBoundContainer.removeEventListener("input", sdState._onStaffDocSearchInput);
    } catch (_) {}
  }
  if (sdState._ffBoundContainer) {
    try {
      delete sdState._ffBoundContainer.__ffStaffSearchBound;
    } catch (_) {}
  }
  sdState._ffBoundContainer = null;
  sdState._onDocActionClick = null;
}

/** Kept for compatibility; document counts/filters live only in the Documents tab. */
export function ffMountStaffDocumentsSummaryStrip(stripEl, salonId, staffId) {
  void stripEl;
  void salonId;
  void staffId;
}

/**
 * Subscribe to documents subcollection and render into container.
 */
export function ffMountStaffDocuments(container, salonId, staffId) {
  if (!container) return;
  const sid = String(salonId || "").trim();
  const stid = String(staffId || "").trim();
  if (!sid || !stid) {
    container.innerHTML = `<p style="margin:0;font-size:13px;color:#b91c1c;">Missing salon or staff.</p>`;
    return;
  }
  sdState._mountCtx = { salonId: sid, staffId: stid };

  if (sdState._ffBoundContainer && sdState._ffBoundContainer !== container && sdState._onDocActionClick) {
    try {
      sdState._ffBoundContainer.removeEventListener("click", sdState._onDocActionClick);
    } catch (_) {}
    if (sdState._onStaffDocSearchInput) {
      try {
        sdState._ffBoundContainer.removeEventListener("input", sdState._onStaffDocSearchInput);
      } catch (_) {}
    }
    try {
      delete sdState._ffBoundContainer.__ffStaffSearchBound;
    } catch (_) {}
    sdState._ffBoundContainer = null;
  }
  if (!sdState._onDocActionClick) {
    sdState._onDocActionClick = (e) => ffHandleStaffDocumentActionClick(e);
  }
  if (sdState._ffBoundContainer !== container) {
    container.addEventListener("click", sdState._onDocActionClick);
    sdState._ffBoundContainer = container;
  }
  ensureStaffDocSearchListeners(container);

  const key = `${sid}::${stid}`;
  if (sdState._mountedKey !== key) {
    container.innerHTML = `<p style="margin:0;font-size:13px;color:#6b7280;">Loading documents…</p>`;
    ensureSubscription(sid, stid);
    return;
  }

  sdState._mountCtx = { salonId: sid, staffId: stid };
  if (sdState._lastDocList !== null) {
    renderListIntoContainer(container, sdState._lastDocList);
  } else {
    container.innerHTML = `<p style="margin:0;font-size:13px;color:#6b7280;">Loading documents…</p>`;
  }
}

if (typeof window !== "undefined") {
  window.ffStaffDocumentsUnmount = ffStaffDocumentsUnmount;
  window.ffMountStaffDocuments = ffMountStaffDocuments;
  window.ffMountStaffDocumentsSummaryStrip = ffMountStaffDocumentsSummaryStrip;
  window.ffStaffDocToast = ffToast;
  window.ffResyncStaffDocumentFromInbox = (salonId, inboxItemId) =>
    ffResyncStaffDocumentFromInbox(db, salonId, inboxItemId);
  /** For console debugging: run `ffStaffDocDebugContext()` while Staff → Documents is open. */
  window.ffStaffDocDebugContext = function () {
    return {
      mountCtx: { salonId: sdState._mountCtx.salonId, staffId: sdState._mountCtx.staffId },
      mountedKey: sdState._mountedKey,
      signedIn: !!auth.currentUser,
      uid: auth.currentUser?.uid || null,
    };
  };
  window.ffStaffDocSendExpiryChatReminderFromEl = function (el) {
    const id = el && el.getAttribute && trimStr(el.getAttribute("data-doc-id"));
    return ffRunExpiryChatNotify(id);
  };
  /** Returns a Promise so the console can `await` or `.then/.catch` and see failures. */
  window.ffStaffDocSendExpiryChatReminder = function (docId) {
    return ffRunExpiryChatNotify(docId);
  };
  window.ffStaffDocSendExpiryChatReminderWithContext = ffSendExpiryChatReminderForStaffDocContext;
}
