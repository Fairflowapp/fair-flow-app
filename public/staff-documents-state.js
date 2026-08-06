/**
 * staff-documents-state.js — shared mutable controller state for the Staff Documents view.
 * Split out of staff-documents.js so the controller can be broken into concern modules
 * (ui / expiry-chat / render / main) that all read & write one source of truth. Also holds
 * the filter-id set and the memoized media-download callable.
 */
import { getApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

export const sdState = {
  _unsub: null,
  _mountedKey: "",
  _mountCtx: { salonId: "", staffId: "" },
  /** After a successful send, ignore duplicate sends for the same doc briefly (double-click / dual handlers). */
  _ffExpiryNotifyDedupe: { key: "", at: 0 },
  _ffExpiryNotifyInFlight: false,
  _ffBoundContainer: null,
  _onDocActionClick: null,
  /** @type {Array<Record<string, unknown>> | null} */
  _lastDocList: null,
  /** Staff Member > Documents filter chip (Phase 9). Default "active" (less confusing than "all"). */
  _staffDocumentsFilter: "active",
  /** Phase 10: search query (raw); empty = no search filter. */
  _staffDocumentsSearchQuery: "",
  /** True when signed-in user may edit document type / expiration (managers etc.). */
  _staffDocsViewerCanEditMeta: false,
  _onStaffDocSearchInput: null,
};

export const STAFF_DOC_FILTER_IDS = new Set([
  "all",
  "expired",
  "expiring_soon",
  "active",
  "archived",
]);

const _functions = getFunctions(getApp(), "us-central1");
let _getMediaDownloadUrlCallable = null;
export function getMediaDownloadUrlCallable() {
  if (!_getMediaDownloadUrlCallable) {
    _getMediaDownloadUrlCallable = httpsCallable(_functions, "getMediaDownloadUrl");
  }
  return _getMediaDownloadUrlCallable;
}
