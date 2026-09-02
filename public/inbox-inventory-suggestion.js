/**
 * Inbox — Smart Inventory Suggestion feature (extracted from inbox.js, Phase 1a).
 * Renders the suggestion card + detail modal and archives ("dismiss") suggestions.
 * UI utilities (escapeHtml/showToast) and list refreshers are injected from inbox.js.
 */
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { ffSuggestionFmtDays, ffSuggestionFmtRate } from "./inbox-helpers.js?v=20260901_sched_req";
import { inboxState } from "./inbox-state.js?v=20260810_owner_inbox_load_v5";

// Injected from inbox.js (orchestrator owns these shared utilities).
let escapeHtml = (s) => String(s == null ? '' : s);
let showToast = () => {};
let renderInboxList = null;
let updateInboxBadges = null;
export function initInboxInventorySuggestion(deps) {
  if (deps && typeof deps.escapeHtml === 'function') escapeHtml = deps.escapeHtml;
  if (deps && typeof deps.showToast === 'function') showToast = deps.showToast;
  if (deps && typeof deps.renderInboxList === 'function') renderInboxList = deps.renderInboxList;
  if (deps && typeof deps.updateInboxBadges === 'function') updateInboxBadges = deps.updateInboxBadges;
}

/** Open a compact modal presenting a Smart Inventory Suggestion — no raw data dump. */
function ffShowInventorySuggestionModal(request) {
  const rd = (request && request.data && typeof request.data === 'object') ? request.data : {};
  const itemName = rd.itemName ? String(rd.itemName) : 'Inventory item';
  const categoryName = rd.categoryName ? String(rd.categoryName) : '';
  const subcategoryName = rd.subcategoryName ? String(rd.subcategoryName) : '';
  const groupName = rd.groupName ? String(rd.groupName) : '';
  const pathLine = [categoryName, subcategoryName, groupName].filter((p) => p && p.trim()).join(' · ');
  const daysLeftStr = ffSuggestionFmtDays(rd.daysLeft);
  const rateStr = ffSuggestionFmtRate(rd.dailyUsage);
  const current = rd.current != null ? String(rd.current) : '—';
  const suggestedQty = rd.suggestedQty != null ? String(rd.suggestedQty) : '—';
  const isReorder = rd.kind === 'reorder_point';
  const reorderPointStr = rd.reorderPoint != null ? String(rd.reorderPoint) : '—';
  const statusStr = String(request.status || 'open');
  const isOpen = statusStr === 'open';

  const modal = document.createElement('div');
  modal.id = 'requestDetailsModal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    z-index: 999999; padding: 20px;
  `;
  const content = document.createElement('div');
  content.style.cssText = `
    background: #fff; border-radius: 14px;
    width: 100%; max-width: 440px;
    max-height: 90vh; overflow-y: auto;
    box-shadow: 0 16px 48px rgba(0,0,0,0.24);
    border-left: 4px solid #ef4444;
    font-family: inherit;
  `;
  content.innerHTML = `
    <div style="padding:20px 22px 16px 22px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <span style="font-size:24px;line-height:1;">📉</span>
          <div style="min-width:0;">
            <div style="font-size:16px;font-weight:700;color:#111827;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(itemName)}</div>
            ${pathLine ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px;">${escapeHtml(pathLine)}</div>` : ''}
          </div>
        </div>
        ${isOpen ? `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:600;background:#f1f5f9;color:#475569;flex-shrink:0;">Open</span>` : ''}
      </div>
      <div style="padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;font-size:14px;font-weight:600;color:#b91c1c;margin:12px 0 16px;">
        ${isReorder
          ? `Low stock — at or below reorder point (${escapeHtml(reorderPointStr)})`
          : `Running low — may run out in ${escapeHtml(daysLeftStr)} day${daysLeftStr === '1' ? '' : 's'}`}
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 14px;font-size:13px;color:#374151;align-items:center;">
        <span style="color:#9ca3af;">Current:</span><span style="font-weight:600;">${escapeHtml(current)}</span>
        ${isReorder
          ? `<span style="color:#9ca3af;">Reorder point:</span><span style="font-weight:600;">${escapeHtml(reorderPointStr)}</span>`
          : `<span style="color:#9ca3af;">Avg use:</span><span style="font-weight:600;">${escapeHtml(rateStr)}</span>`}
        <span style="color:#9ca3af;">${isReorder ? 'Suggested order:' : 'Order qty:'}</span>
        ${isReorder
          ? `<span style="font-weight:700;color:#7c3aed;">${escapeHtml(suggestedQty)}</span>`
          : `<div style="display:flex;align-items:center;gap:6px;">
          <input type="number" min="1" step="1"
            data-ff-suggestion-qty-input
            value="${escapeHtml(suggestedQty)}"
            style="width:90px;padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;font-weight:700;color:#0f172a;text-align:center;font-variant-numeric:tabular-nums;"
          />
          <span style="font-size:11px;color:#9ca3af;">Suggested: <strong style="color:#7c3aed;">${escapeHtml(suggestedQty)}</strong></span>
        </div>`}
      </div>
    </div>
    <div style="display:flex;gap:8px;padding:14px 22px 20px;border-top:1px solid #f1f5f9;">
      ${statusStr === 'archived'
        ? `<button type="button" data-ff-suggestion-delete="${escapeHtml(request.id)}"
            style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid #ef4444;background:#fef2f2;color:#dc2626;font-weight:700;font-size:13px;cursor:pointer;">
            🗑 Delete permanently
          </button>`
        : `<button type="button" data-ff-suggestion-dismiss="${escapeHtml(request.id)}"
            style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-weight:600;font-size:13px;cursor:pointer;">
            Dismiss
          </button>
          ${isReorder ? '' : `<button type="button" data-ff-suggestion-add-to-order="${escapeHtml(request.id)}"
            style="flex:1;padding:10px 14px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:700;font-size:13px;cursor:pointer;">
            Add to Order
          </button>`}`}
    </div>
  `;
  modal.appendChild(content);

  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) modal.remove();
  });
  const deleteBtn = content.querySelector('[data-ff-suggestion-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (typeof window.deleteArchivedRequest === 'function') {
        window.deleteArchivedRequest(request.id);
      }
    });
  }
  const dismissBtn = content.querySelector('[data-ff-suggestion-dismiss]');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', async () => {
      dismissBtn.disabled = true;
      try {
        await ffDismissInventorySuggestion(request);
        showToast('Suggestion dismissed', 'success');
      } catch (e) {
        console.error('[Inbox] Dismiss suggestion failed', e);
        showToast('Could not dismiss. Try again.', 'error');
        dismissBtn.disabled = false;
        return;
      }
      modal.remove();
    });
  }
  const addBtn = content.querySelector('[data-ff-suggestion-add-to-order]');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      // Read the user-edited qty (defaults to suggestedQty). Validate > 0.
      const qtyInput = content.querySelector('[data-ff-suggestion-qty-input]');
      const overrideQtyRaw = qtyInput instanceof HTMLInputElement ? qtyInput.value : '';
      const overrideQty = Number(overrideQtyRaw);
      if (!Number.isFinite(overrideQty) || overrideQty <= 0) {
        showToast('Order qty must be greater than 0', 'error');
        if (qtyInput instanceof HTMLInputElement) {
          qtyInput.focus();
          qtyInput.select();
        }
        return;
      }
      addBtn.disabled = true;
      if (typeof window.ffAddInventorySuggestionToOrder !== 'function') {
        showToast('Create Order is not available right now', 'error');
        addBtn.disabled = false;
        return;
      }
      let added = false;
      try {
        added = await window.ffAddInventorySuggestionToOrder(request, { qtyOverride: overrideQty });
      } catch (e) {
        console.error('[Inbox] Add to Order failed', e);
      }
      if (!added) {
        showToast('Could not add this item. Try again.', 'error');
        addBtn.disabled = false;
        return;
      }
      // Archive the suggestion so it disappears from the Open tab and the scanner
      // won't re-create a duplicate for this cell. We don't delete, so a record remains
      // that this cell was already acted on.
      let archiveOk = false;
      let lastError = null;
      try {
        await ffDismissInventorySuggestion(request, { addedToOrder: true });
        archiveOk = true;
      } catch (e) {
        lastError = e;
        console.error('[Inbox] Archive suggestion failed:', e && (e.code || e.message) ? (e.code || e.message) : e);
      }
      // Optimistic local cleanup — remove from in-memory list so UI updates immediately
      // even if the Firestore listener is slow to reflect the change.
      try {
        if (Array.isArray(inboxState.currentRequests)) {
          inboxState.currentRequests = inboxState.currentRequests.filter((r) => r && r.id !== request.id);
        }
        if (typeof inboxState._techInboxOutgoing !== 'undefined' && Array.isArray(inboxState._techInboxOutgoing)) {
          inboxState._techInboxOutgoing = inboxState._techInboxOutgoing.filter((r) => r && r.id !== request.id);
        }
        if (typeof inboxState._techInboxIncoming !== 'undefined' && Array.isArray(inboxState._techInboxIncoming)) {
          inboxState._techInboxIncoming = inboxState._techInboxIncoming.filter((r) => r && r.id !== request.id);
        }
        if (typeof renderInboxList === 'function') renderInboxList();
        if (typeof updateInboxBadges === 'function') updateInboxBadges();
      } catch (e) {
        console.warn('[Inbox] Local cleanup after Add to Order failed', e);
      }
      modal.remove();
      const name = (request.data && request.data.itemName) || 'item';
      if (archiveOk) {
        showToast(`Added ${overrideQty} × ${name} to Create Order`, 'success');
      } else {
        const errMsg = lastError ? (lastError.code || lastError.message || String(lastError)) : 'unknown';
        showToast(`Added to Order, but archive failed: ${errMsg}`, 'error');
      }
    });
  }

  document.body.appendChild(modal);
}

/** Archive an inventory suggestion (Dismiss or Add-to-Order). Status update respects inbox rules. */
async function ffDismissInventorySuggestion(request, opts) {
  if (!request || !request.id) throw new Error('Missing request id');
  const salonId = inboxState.currentUserProfile && inboxState.currentUserProfile.salonId;
  if (!salonId) throw new Error('No salonId in profile');
  const patch = {
    status: 'archived',
    decidedBy: inboxState.currentUserProfile.uid || null,
    decidedAt: serverTimestamp(),
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    unreadForManagers: false,
  };
  // If called from Add to Order, we leave a trail via responseNote so later UI can show "Added to order".
  if (opts && opts.addedToOrder === true) {
    patch.responseNote = 'Added to Create Order';
  }
  await updateDoc(doc(db, `salons/${salonId}/inboxItems`, request.id), patch);
}

/** Render a Smart Inventory Suggestion as a compact smart card (card list view). */
function ffRenderInventorySuggestionCard(request, card, dateStr, statusStr) {
  const rd = (request && request.data && typeof request.data === 'object') ? request.data : {};
  const itemName = rd.itemName ? String(rd.itemName) : (request.title ? String(request.title) : 'Inventory item');
  const categoryName = rd.categoryName ? String(rd.categoryName) : '';
  const subcategoryName = rd.subcategoryName ? String(rd.subcategoryName) : '';
  const groupName = rd.groupName ? String(rd.groupName) : '';
  const pathParts = [categoryName, subcategoryName, groupName].filter((p) => p && p.trim());
  const pathLine = pathParts.join(' · ');
  const daysLeftStr = ffSuggestionFmtDays(rd.daysLeft);
  const rateStr = ffSuggestionFmtRate(rd.dailyUsage);
  const current = rd.current != null ? String(rd.current) : '—';
  const suggestedQty = rd.suggestedQty != null ? String(rd.suggestedQty) : '—';
  const isReorder = rd.kind === 'reorder_point';
  const reorderPointStr = rd.reorderPoint != null ? String(rd.reorderPoint) : '—';
  const isOpen = statusStr === 'open';
  const statusBadge = isOpen
    ? `<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:600;background:#f1f5f9;color:#475569;letter-spacing:0.02em;">Open</span>`
    : `<span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:600;background:#e5e7eb;color:#6b7280;letter-spacing:0.02em;text-transform:capitalize;">${escapeHtml(String(statusStr).replace(/_/g, ' '))}</span>`;

  card.style.cssText = `
    background:#fff;
    border:1px solid #fecaca;
    border-left:4px solid #ef4444;
    border-radius:10px;
    padding:12px 14px;
    cursor:pointer;
    transition: box-shadow 0.15s ease, transform 0.1s ease;
  `;
  card.onmouseenter = () => { card.style.boxShadow = '0 2px 8px rgba(239,68,68,0.12)'; };
  card.onmouseleave = () => { card.style.boxShadow = ''; };

  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <div style="font-size:22px;line-height:1;flex-shrink:0;">📉</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px;">
          <div style="font-size:14px;font-weight:700;color:#111827;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(itemName)}</div>
          ${statusBadge}
        </div>
        ${pathLine ? `<div style="font-size:11px;color:#9ca3af;margin-bottom:8px;">${escapeHtml(pathLine)}</div>` : ''}
        <div style="font-size:13px;font-weight:600;color:#b91c1c;margin-bottom:8px;">
          ${isReorder
            ? `Low stock — at or below reorder point (${escapeHtml(reorderPointStr)})`
            : `Running low — may run out in ${escapeHtml(daysLeftStr)} day${daysLeftStr === '1' ? '' : 's'}`}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:#374151;">
          <span><span style="color:#9ca3af;">Current:</span> <strong>${escapeHtml(current)}</strong></span>
          ${isReorder
            ? `<span><span style="color:#9ca3af;">Reorder point:</span> <strong>${escapeHtml(reorderPointStr)}</strong></span>`
            : `<span><span style="color:#9ca3af;">Avg use:</span> <strong>${escapeHtml(rateStr)}</strong></span>`}
          <span><span style="color:#9ca3af;">Suggested order:</span> <strong>${escapeHtml(suggestedQty)}</strong></span>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#9ca3af;">${escapeHtml(dateStr)}</div>
      </div>
    </div>
  `;
  return card;
}

export {
  ffShowInventorySuggestionModal,
  ffRenderInventorySuggestionCard,
};
