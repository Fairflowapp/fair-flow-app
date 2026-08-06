/**
 * Inbox — Staff document alert presentation helpers (extracted from inbox.js, Phase 1c).
 * Pure formatting/localization for document_expiring_soon / document_expired alerts.
 * No Firestore or module state; escapeHtml is injected from inbox.js.
 */

// Injected from inbox.js.
let escapeHtml = (s) => String(s == null ? '' : s);
export function initInboxDocuments(deps) {
  if (deps && typeof deps.escapeHtml === 'function') escapeHtml = deps.escapeHtml;
}

// --- Staff document Inbox alerts (document_expiring_soon / document_expired) — Phase 4 UI ---

function ffDocAlertIsHebrewUI() {
  if (typeof document === 'undefined') return false;
  const lang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
  return lang.startsWith('he');
}

function ffDocAlertStaffName(request) {
  const rd = request.data || {};
  const s = (rd.subjectStaffName || '').trim();
  if (s) return s;
  return ffDocAlertIsHebrewUI() ? 'עובד לא ידוע' : 'Unknown employee';
}

function ffDocAlertDocTitle(request) {
  const rd = request.data || {};
  const s = (request.documentTitle || rd.documentTitle || '').trim();
  if (s) return s;
  return ffDocAlertIsHebrewUI() ? 'מסמך ללא שם' : 'Untitled document';
}

function ffDocAlertDocType(request) {
  const rd = request.data || {};
  const s = (request.documentType || rd.documentType || '').trim();
  if (s) return s;
  return '—';
}

function ffDocAlertExpirationDate(request) {
  const rd = request.data || {};
  const ex = request.expirationDate || rd.expirationDate;
  try {
    if (ex && typeof ex.toDate === 'function') return ex.toDate();
  } catch (_) {}
  return null;
}

function ffDocAlertExpFormattedLong(request) {
  const d = ffDocAlertExpirationDate(request);
  if (!d) return '';
  const locale = ffDocAlertIsHebrewUI() ? 'he-IL' : undefined;
  try {
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (_) {
    return d.toLocaleDateString();
  }
}

function ffDocAlertHumanSummary(request) {
  const kind = request.type === 'document_expired' ? 'expired' : 'soon';
  const staff = ffDocAlertStaffName(request);
  const docName = ffDocAlertDocTitle(request);
  const expStr = ffDocAlertExpFormattedLong(request);
  const he = ffDocAlertIsHebrewUI();
  if (kind === 'expired') {
    return he
      ? `מסמך "${docName}" של ${staff} פג תוקף${expStr ? ` בתאריך ${expStr}` : ''}.`
      : `Document "${docName}" for ${staff} expired${expStr ? ` on ${expStr}` : ''}.`;
  }
  return he
    ? `המסמך "${docName}" של ${staff} יפוג${expStr ? ` בתאריך ${expStr}` : ''}.`
    : `Document "${docName}" for ${staff} expires${expStr ? ` on ${expStr}` : ''}.`;
}

function ffDocAlertStaffId(request) {
  const rd = request.data || {};
  return String(request.staffId || rd.staffId || '').trim();
}

function ffDocAlertWhatToDoLine() {
  return ffDocAlertIsHebrewUI()
    ? 'בדקו את המסמך בפרופיל העובד, ועדכנו או חדשו לפי הצורך.'
    : 'Review the document on the staff profile, then renew or update as needed.';
}

function ffDocAlertModalFooterIds(request) {
  const rd = request.data || {};
  const did = String(request.documentId || rd.documentId || '').trim();
  const sid = ffDocAlertStaffId(request);
  if (!did && !sid) return '';
  const he = ffDocAlertIsHebrewUI();
  const parts = [];
  if (sid) parts.push(`${he ? 'עובד' : 'Staff'} ID: ${escapeHtml(sid)}`);
  if (did) parts.push(`${he ? 'מסמך' : 'Document'} ID: ${escapeHtml(did)}`);
  return `<div style="font-size:11px;color:#9ca3af;line-height:1.45;">${parts.join(' · ')}</div>`;
}

export {
  ffDocAlertIsHebrewUI,
  ffDocAlertStaffName,
  ffDocAlertDocTitle,
  ffDocAlertDocType,
  ffDocAlertExpFormattedLong,
  ffDocAlertHumanSummary,
  ffDocAlertStaffId,
  ffDocAlertWhatToDoLine,
  ffDocAlertModalFooterIds,
};
