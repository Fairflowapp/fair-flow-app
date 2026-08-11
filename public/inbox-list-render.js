/**
 * Inbox — list rendering (extracted from inbox.js).
 * Badges, staff-filter options, grouped list render, request cards,
 * summaries, and active-location scoping.
 *
 * Injected (cycles with code still in inbox.js):
 *   - showRequestDetails        (card onclick → details modal; M6 not yet extracted)
 *   - inboxTechnicianNoiseFilter (technician list filter; M1 listeners not yet extracted)
 */

import {
  inboxState,
  MANAGER_ONLY_INBOX_TYPES,
} from "./inbox-state.js?v=20260810_owner_inbox_load_v5";
import {
  inboxEffectiveTypeForGrouping,
  ffInboxIsStaffCallOtherNoise,
  inboxDocAlertIsExpiredForUi,
  inboxSupplyStatusDisplayLabel,
  formatRelativeDate,
} from "./inbox-helpers.js?v=20260810_owner_inbox_load_v5";
import { escapeHtml } from "./inbox-utils.js?v=20260630_inbox_utils_split";
import { inboxUserRoleLc, inboxCanManageInbox } from "./inbox-data.js?v=20260810_owner_inbox_load_v5";
import { getRequestTypeInfo } from "./inbox-types.js?v=20260810_owner_inbox_load_v5";
import { ffRenderInventorySuggestionCard } from "./inbox-inventory-suggestion.js?v=20260629_inbox_invsugg_split";
import {
  ffDocAlertIsHebrewUI,
  ffDocAlertHumanSummary,
  ffDocAlertStaffName,
  ffDocAlertDocTitle,
  ffDocAlertExpFormattedLong,
} from "./inbox-documents.js?v=20260629_inbox_documents_split";

// ── Injected from inbox.js orchestrator (see initInboxListRender).
let showRequestDetails = () => {};
let inboxTechnicianNoiseFilter = (rows) => rows;

export function initInboxListRender(deps = {}) {
  if (typeof deps.showRequestDetails === "function") showRequestDetails = deps.showRequestDetails;
  if (typeof deps.inboxTechnicianNoiseFilter === "function") inboxTechnicianNoiseFilter = deps.inboxTechnicianNoiseFilter;
}

/** Update red badges: Open tab + INBOX nav button */
/** Update unread badges on tabs and nav INBOX button. */
function updateInboxBadges() {
  if (!inboxCanManageInbox()) return;

  const uid = inboxState.currentUserProfile.uid;

  // Scope the counts to the currently active branch so the badges match
  // what the user actually sees in the list for that location.
  let activeLocId = null;
  try {
    if (typeof window.ffGetActiveLocationId === 'function') {
      const v = window.ffGetActiveLocationId();
      if (typeof v === 'string' && v.trim()) activeLocId = v.trim();
    }
    if (!activeLocId && typeof window.__ff_active_location_id === 'string'
        && window.__ff_active_location_id.trim()) {
      activeLocId = window.__ff_active_location_id.trim();
    }
  } catch (_) {}
  const staffLocMap = activeLocId ? inboxGetStaffLocationMap() : null;
  const inActiveLoc = (r) => !activeLocId || inboxItemMatchesActiveLocation(r, activeLocId, staffLocMap);

  // Open: new requests not yet seen by recipient
  const openCount = inboxState.currentRequests.filter(
    (r) =>
      r.forUid === uid &&
      (r.status === "open" || r.status === "pending") &&
      r.unreadForManagers === true &&
      inActiveLoc(r)
  ).length;

  // Needs Info: requests where staff replied but recipient hasn't seen it yet
  const needsInfoCount = inboxState.currentRequests.filter(
    r => r.forUid === uid && r.status === 'needs_info' && r.unreadForManagers === true && inActiveLoc(r)
  ).length;

  const totalCount = openCount + needsInfoCount;

  // Badge on Open tab
  const openBadge = document.getElementById('inboxOpenBadge');
  if (openBadge) openBadge.textContent = openCount > 0 ? openCount : '';

  // Badge on Needs Info tab
  const needsInfoBadge = document.getElementById('inboxNeedsInfoBadge');
  if (needsInfoBadge) needsInfoBadge.textContent = needsInfoCount > 0 ? needsInfoCount : '';

  const statusSel = document.getElementById('inboxStatusFilterSelect');
  if (statusSel) {
    const setOpt = (val, base, n) => {
      const o = statusSel.querySelector(`option[value="${val}"]`);
      if (o) o.textContent = n > 0 ? `${base} (${n})` : base;
    };
    setOpt('open', 'Open', openCount);
    setOpt('needs_info', 'Needs Info', needsInfoCount);
    setOpt('approved', 'Approved', 0);
    setOpt('denied', 'Denied', 0);
    setOpt('archived', 'Archived', 0);
  }

  // Nav INBOX badge = total unread (Open + Needs Info)
  const navBadge = document.querySelector('#inboxBtn .ff-inbox-badge');
  if (navBadge) navBadge.textContent = totalCount > 0 ? totalCount : '';
}

function updateInboxStaffFilterOptions() {
  const sel = document.getElementById('inboxStaffFilterSelect');
  if (!sel) return;
  const role = inboxUserRoleLc();
  if (role === "technician") return;

  const seen = new Map();
  inboxState.currentRequests.forEach(req => {
    const uid = req.forUid || req.createdByUid || '';
    const name = (req.forStaffName || req.createdByName || '').trim() || uid || 'Unknown';
    if (uid && !seen.has(uid)) seen.set(uid, name);
  });
  const options = [['', 'ALL STAFF']];
  seen.forEach((name, uid) => options.push([uid, name]));
  const current = inboxState.inboxStaffFilterUid;
  if (!options.some(([v]) => v === current)) inboxState.inboxStaffFilterUid = '';

  sel.innerHTML = '';
  for (const [val, lab] of options) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = lab;
    sel.appendChild(o);
  }
  sel.value = inboxState.inboxStaffFilterUid;
}

function renderInboxList() {
  try {
    _renderInboxListInner();
  } catch (e) {
    console.error('[Inbox] renderInboxList failed', e);
    const loadingEl = document.getElementById('inboxLoading');
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// Re-render the Inbox list when the active location switches, so the
// location filter in _renderInboxListInner reflects the new scope. Without
// this, a birthday reminder for a Brickell-only staff would remain visible
// when the user switches to Key Biscayne.
if (typeof document !== 'undefined' && !window.__ffInboxLocationListenerBound) {
  window.__ffInboxLocationListenerBound = true;
  document.addEventListener('ff-active-location-changed', function () {
    try { renderInboxList(); } catch (_) {}
  });
  // Staff locations may change (e.g. owner just toggled a location on/off in
  // Staff Member → Locations). Re-render so we pick up the new
  // allowedLocationIds for the subject staff.
  document.addEventListener('ff-staff-cloud-updated', function () {
    try { renderInboxList(); } catch (_) {}
  });
}

/** Build a quick map { staffId -> allowedLocationIds[] } from the local staff cache. */
function inboxGetStaffLocationMap() {
  try {
    if (typeof window.ffGetStaffStore === 'function') {
      const store = window.ffGetStaffStore();
      const map = Object.create(null);
      (store.staff || []).forEach(function (s) {
        if (s && s.id != null) {
          map[String(s.id)] = Array.isArray(s.allowedLocationIds) ? s.allowedLocationIds.slice() : [];
        }
      });
      return map;
    }
  } catch (_) {}
  try {
    const raw = localStorage.getItem('ff_staff_v1');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed && parsed.staff) ? parsed.staff : [];
    const map = Object.create(null);
    list.forEach(function (s) {
      if (s && s.id != null) {
        map[String(s.id)] = Array.isArray(s.allowedLocationIds) ? s.allowedLocationIds.slice() : [];
      }
    });
    return map;
  } catch (_) {
    return {};
  }
}

/** The staff member an inbox item is "about". Different types use different fields. */
function inboxItemSubjectStaffId(req) {
  if (!req) return '';
  const d = req.data || {};
  const candidates = [
    d.subjectStaffId,
    d.staffId,
    d.targetStaffId,
    req.forStaffId,
    req.createdByStaffId,
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const v = candidates[i];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * Whether an inbox item should be visible under the currently active
 * location. Rule:
 *   - If no active location (single-branch salon), show everything.
 *   - If the item has an explicit locationId stamped on it, match against
 *     that directly.
 *   - Otherwise, resolve the "subject" staff member and check their
 *     allowedLocationIds. Missing / empty allowedLocationIds is treated as
 *     "visible in all locations" (legacy staff, or admins who work across
 *     every branch).
 *   - If we cannot resolve any staff at all (e.g. an operational reminder
 *     with no staff tied to it), fall through and show it — we should not
 *     silently hide inbox rows.
 */
function inboxItemMatchesActiveLocation(req, activeLocationId, staffLocMap) {
  if (!activeLocationId) return true;
  const explicit = req && typeof req.locationId === 'string' ? req.locationId.trim() : '';
  if (explicit) {
    return explicit === activeLocationId;
  }
  const staffId = inboxItemSubjectStaffId(req);
  if (!staffId) return true;
  const allowed = staffLocMap && staffLocMap[staffId];
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return allowed.indexOf(activeLocationId) !== -1;
}

function _renderInboxListInner() {
  const listEl = document.getElementById('inboxList');
  if (!listEl) return;

  const role = inboxUserRoleLc();

  // Remove only dynamically-added group elements (preserve loading/empty state divs)
  listEl.querySelectorAll('.inbox-group-header, .inbox-group-body').forEach(el => el.remove());

  const emptyEl = document.getElementById('inboxEmpty');
  const loadingEl = document.getElementById('inboxLoading');

  let requestsToShow = inboxState.currentRequests;

  // Technician merged list is already noise-filtered in applyTechInboxMerge; keep filter here if data came from elsewhere.
  if (role === "technician") {
    requestsToShow = inboxTechnicianNoiseFilter(requestsToShow);
  }

  // Admin/manager "My Requests": createdByUid query can still return automated rows (scanner uid) + staff-call noise
  if (role !== "technician" && inboxState.inboxViewMode === "mine" && inboxCanManageInbox()) {
    requestsToShow = requestsToShow.filter((r) => !MANAGER_ONLY_INBOX_TYPES.has(String(r.type || "").trim()));
    requestsToShow = requestsToShow.filter((r) => !ffInboxIsStaffCallOtherNoise(r));
  }

  // Client-side status filter to prevent flicker when Firestore sends intermediate snapshots
  if (inboxState.inboxViewMode === 'to_handle' || role === 'technician') {
    if (inboxState.currentInboxTab === 'open') {
      requestsToShow = requestsToShow.filter((r) => r.status === "open" || r.status === "pending");
    } else if (inboxState.currentInboxTab === 'needs_info') {
      requestsToShow = requestsToShow.filter(r => r.status === 'needs_info');
    } else if (inboxState.currentInboxTab === 'approved') {
      requestsToShow = requestsToShow.filter(r => r.status === 'approved' || r.status === 'done');
    } else if (inboxState.currentInboxTab === 'denied') {
      requestsToShow = requestsToShow.filter(r => r.status === 'denied');
    } else if (inboxState.currentInboxTab === 'archived') {
      requestsToShow = requestsToShow.filter(r => r.status === 'archived');
    }
  }

  if (role !== 'technician' && inboxState.inboxViewMode !== 'mine' && inboxState.inboxStaffFilterUid) {
    requestsToShow = requestsToShow.filter(r => (r.forUid || r.createdByUid) === inboxState.inboxStaffFilterUid);
  }

  // Scope the Inbox to the active location. An item for a staff member who
  // only works at Brickell must not show up when the user is viewing Key
  // Biscayne in the header switcher. See inboxItemMatchesActiveLocation for
  // the exact rule set (explicit locationId → staff allowedLocationIds →
  // fall-through for legacy / unattributed rows).
  try {
    const activeLocId =
      (typeof window.ffGetActiveLocationId === 'function' ? window.ffGetActiveLocationId() : null) ||
      (typeof window.__ff_active_location_id === 'string' && window.__ff_active_location_id
        ? window.__ff_active_location_id
        : null);
    if (activeLocId) {
      const staffLocMap = inboxGetStaffLocationMap();
      requestsToShow = requestsToShow.filter(function (r) {
        return inboxItemMatchesActiveLocation(r, activeLocId, staffLocMap);
      });
    }
  } catch (e) {
    console.warn('[Inbox] location filter failed, showing all', e);
  }

  if (requestsToShow.length === 0) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      const msgEl = emptyEl.querySelector('#emptyStateMessage');
      if (msgEl) {
        msgEl.textContent = inboxState.inboxStaffFilterUid ? 'No requests from this staff in this tab' : 'No requests in this category';
      }
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (loadingEl) loadingEl.style.display = 'none';

  const showMgrUnread = inboxCanManageInbox();

  // Group requests by type (use filtered list)
  const groups = {};
  requestsToShow.forEach(req => {
    const key = inboxEffectiveTypeForGrouping(req) || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(req);
  });

  // Order: by category (schedule → payments → operations), then custom type ids, then other last
  const typeOrder = [
    'vacation','day_off','time_off','late_start','early_leave','schedule_change','extra_shift','swap_shift','break_change',
    'commission_review','tip_adjustment','payment_issue',
    'supplies','maintenance','client_issue','staff_birthday_reminder','onboarding_incomplete',
    'document_request','document_renewal_request','document_upload','document_expiring_soon','document_expired',
    'other'
  ];
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const ai = typeOrder.indexOf(a);
    const bi = typeOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  sortedKeys.forEach(type => {
    const requests = groups[type];
    const typeInfo = getRequestTypeInfo(type);
    const unreadCount = showMgrUnread ? requests.filter(r => r.unreadForManagers === true).length : 0;
    const hasUnread = unreadCount > 0;

    // Left: icon + label. Right: (total) grey, unread count red when > 0, then arrow
    const header = document.createElement('div');
    header.className = 'inbox-group-header';
    header.style.cssText = `
      display:flex; align-items:center; justify-content:space-between;
      padding:12px 16px; background:#fff; border:1px solid #e5e7eb;
      border-radius:8px; cursor:pointer; margin-bottom:4px; user-select:none;
    `;
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px;">${typeInfo.icon}</span>
        <span style="font-weight:600;font-size:14px;color:#111;">${typeInfo.label}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="color:#6b7280;font-size:13px;font-weight:500;">(${requests.length})</span>
        ${hasUnread ? `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;background:#ef4444;color:#fff;font-size:11px;font-weight:600;border-radius:50%;" title="Not yet opened">${unreadCount}</span>` : ''}
        <span class="inbox-group-arrow" style="color:#9ca3af;font-size:11px;transition:transform 0.2s;">▼</span>
      </div>
    `;

    // Group body — collapsed by default
    const body = document.createElement('div');
    body.className = 'inbox-group-body';
    body.style.cssText = 'flex-direction:column;gap:8px;margin-bottom:8px;';
    body.style.display = 'none';

    requests.forEach(req => {
      const card = createRequestCard(req);
      body.appendChild(card);
    });

    // Toggle on click
    header.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'flex';
      const arrow = header.querySelector('.inbox-group-arrow');
      if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
    });

    listEl.appendChild(header);
    listEl.appendChild(body);
  });
}

function createRequestCard(request) {
  const card = document.createElement('div');
  card.className = 'inbox-item-card';
  card.onclick = () => showRequestDetails(request.id);

  const typeInfo = getRequestTypeInfo(request.type);
  const statusStr = String(request.status != null ? request.status : "open");
  const statusDisplay = inboxSupplyStatusDisplayLabel(request) || statusStr.replace(/_/g, " ");
  const statusClass = `inbox-status-${statusStr.replace(/_/g, "-")}`;
  const createdDate = request.createdAt?.toDate ? request.createdAt.toDate() : new Date();
  const dateStr = formatRelativeDate(createdDate);

  // Smart Inventory Suggestion — compact card, no raw data dump.
  if (request.type === 'inventory_suggestion') {
    return ffRenderInventorySuggestionCard(request, card, dateStr, statusStr);
  }

  if (request.type === 'document_expiring_soon' || request.type === 'document_expired') {
    const isSoon = !inboxDocAlertIsExpiredForUi(request);
    const he = ffDocAlertIsHebrewUI();
    const badgeLabel = isSoon ? (he ? 'יפוג בקרוב' : 'Expiring soon') : (he ? 'פג תוקף' : 'Expired');
    const boxStyle = isSoon
      ? 'border-left:4px solid #d97706;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;'
      : 'border-left:4px solid #b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 14px;';
    const badgeBg = isSoon ? '#fef3c7' : '#fee2e2';
    const badgeColor = isSoon ? '#92400e' : '#991b1b';
    const msg = (request.message || request.data?.message || '').trim();
    card.innerHTML = `
      <div style="${boxStyle}">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="font-size:26px;line-height:1;">${typeInfo.icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;background:${badgeBg};color:${badgeColor};">${escapeHtml(badgeLabel)}</span>
              <span class="inbox-status-badge ${statusClass}">${statusStr.replace(/_/g, ' ')}</span>
            </div>
            <div style="font-size:14px;font-weight:600;color:#111827;line-height:1.45;margin-bottom:6px;">
              ${escapeHtml(ffDocAlertHumanSummary(request))}
            </div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px;color:#4b5563;">
              <span style="color:#9ca3af;">${he ? 'עובד' : 'Employee'}</span><span style="font-weight:500;">${escapeHtml(ffDocAlertStaffName(request))}</span>
              <span style="color:#9ca3af;">${he ? 'מסמך' : 'Document'}</span><span style="font-weight:500;word-break:break-word;">${escapeHtml(ffDocAlertDocTitle(request))}</span>
              <span style="color:#9ca3af;">${he ? 'תפוגה' : 'Expires'}</span><span>${escapeHtml(ffDocAlertExpFormattedLong(request) || '—')}</span>
            </div>
            ${msg ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.06);font-size:12px;color:#374151;line-height:1.4;">${escapeHtml(msg)}</div>` : ''}
            <div style="margin-top:8px;font-size:11px;color:#9ca3af;">${he ? 'נוצר' : 'Logged'} · ${escapeHtml(dateStr)}</div>
          </div>
        </div>
      </div>
    `;
    return card;
  }

  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;">
      <div style="font-size:24px;">${typeInfo.icon}</div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-weight:600;font-size:14px;color:#111;">${typeInfo.label}</span>
          <span class="inbox-status-badge ${statusClass}">${statusDisplay}</span>
          ${request.priority === 'urgent' ? '<span style="color:#ef4444;font-size:12px;">🔥 Urgent</span>' : ''}
        </div>
        <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">
          ${(request.type === 'staff_birthday_reminder' || request.type === 'onboarding_incomplete') && request.data?.subjectStaffName
            ? escapeHtml(request.data.subjectStaffName) + ' • ' + dateStr
            : `${request.forStaffName} • ${dateStr}`}
        </div>
        <div style="font-size:13px;color:#374151;">
          ${getRequestSummary(request)}
        </div>
      </div>
    </div>
  `;

  return card;
}



function getRequestSummary(request) {
  const data = request.data || {};
  
  switch (request.type) {
    case 'vacation':
      return `${data.startDate || ''} to ${data.endDate || ''} (${data.daysCount || 0} days)`;
    case 'late_start':
    case 'early_leave':
      return `${data.date || ''} - ${data.requestedTime || ''}`;
    case 'day_off':
      return data.date ? `Day off · ${data.date}` : 'Day off';
    case 'time_off':
      return data.startDate && data.endDate
        ? `Time off · ${data.startDate} → ${data.endDate}`
        : (data.startDate || 'Time off');
    case 'schedule_change':
      if (data.startDate && data.endDate) {
        return `Schedule change · ${data.startDate}→${data.endDate}${data.requestedSchedule ? ` · ${String(data.requestedSchedule).slice(0, 40)}` : ''}`;
      }
      return data.reason || 'Schedule change request';
    case 'extra_shift':
    case 'swap_shift':
    case 'break_change':
      return data.date ? `${data.date} – ${(data.details || '').substring(0, 50)}` : (data.details || 'View details').substring(0, 80);
    case 'commission_review':
    case 'tip_adjustment':
    case 'payment_issue':
    case 'client_issue':
      return data.subject || (data.details || 'View details').substring(0, 60);
    case 'supplies': {
      const arr = data.items || [];
      const itemCount = arr.length;
      const first = arr[0];
      let label = "";
      if (first && (first.itemName || first.name)) {
        const base = String(first.itemName || first.name).slice(0, 32);
        const group = first.groupName && String(first.groupName).trim()
          ? String(first.groupName).trim()
          : first.variantLabel && String(first.variantLabel).trim()
            ? String(first.variantLabel).trim()
            : "";
        label = group ? `${base} — ${group.slice(0, 14)}` : base.slice(0, 36);
      }
      return itemCount
        ? `${itemCount} item${itemCount !== 1 ? "s" : ""}${label ? `: ${label}` : ""} · ${data.urgency || "routine"}`
        : `${data.urgency || "routine"}`;
    }
    case 'maintenance':
      return `${data.area || 'Unknown area'} - ${data.severity || 'minor'} issue`;
    case 'staff_birthday_reminder': {
      const birthdayName = String(data.subjectStaffName || 'Staff').trim();
      const daysUntil = Number(data.daysUntil);
      const daysPart = !Number.isFinite(daysUntil)
        ? ''
        : daysUntil === 0
          ? ' (today)'
          : ` in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
      const displayRaw = String(data.birthdayDisplay || '').trim();
      const displayIsEnglishSafe = displayRaw && !/[\u0590-\u05FF\u0600-\u06FF]/.test(displayRaw);
      const datePart = displayIsEnglishSafe ? ` ${displayRaw}` : '';
      return `${birthdayName}'s birthday is${datePart}${daysPart}.`;
    }
    case 'onboarding_incomplete': {
      const who = String(data.subjectStaffName || 'Staff').trim();
      const pkg = String(data.packageName || 'onboarding').trim();
      const reqDone = Number(data.progressRequiredCompleted);
      const reqTotal = Number(data.progressRequiredTotal);
      const prog =
        Number.isFinite(reqTotal) && reqTotal > 0
          ? ` · ${reqDone}/${reqTotal} required`
          : '';
      return `${who} has not finished ${pkg}${prog}`;
    }
    case 'document_request':
      return `${data.documentType || 'Document'} – ${(data.reason || '').substring(0, 40)}`;
    case 'document_renewal_request':
      return `${data.documentType || 'Document'} – ${(data.message || '').substring(0, 40)}`;
    case 'document_upload':
      return `${data.documentType || 'Document'}${data.expirationDate ? ` · Expires ${data.expirationDate}` : ''}`;
    case 'document_expiring_soon':
    case 'document_expired':
      return ffDocAlertHumanSummary(request);
    case 'other':
      return data.subject || data.details?.substring(0, 60) || 'Request details';
    default:
      if (data.details) return data.details.substring(0, 80);
      const keys = Object.keys(data || {}).filter(k => data[k]);
      if (keys.length) return keys.map(k => String(data[k])).join(' · ').substring(0, 80);
      return 'View details';
  }
}

export {
  updateInboxBadges,
  updateInboxStaffFilterOptions,
  renderInboxList,
  inboxGetStaffLocationMap,
  inboxItemMatchesActiveLocation,
};
