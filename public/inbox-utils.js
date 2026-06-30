/**
 * Inbox — shared UI utilities (extracted from inbox.js).
 * escapeHtml + confirm/prompt modals + toast wrapper. Self-contained: depends only
 * on the DOM and the global window.ffToast API. No Firestore or module state.
 */

function escapeHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Returns Promise<boolean> - true if confirmed, false if cancelled */
function showConfirmModal(options) {
  const { title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = options;
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.id = 'inboxConfirmModal';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;
      z-index:999999;padding:20px;backdrop-filter:blur(3px);
    `;
    modal.innerHTML = `
      <div style="
        background:#fff;border-radius:16px;padding:28px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.2);
        text-align:center;
      ">
        <div style="font-size:40px;margin-bottom:16px;">${danger ? '🗑️' : '❓'}</div>
        <h3 style="margin:0 0 12px;font-size:18px;font-weight:600;color:#111;">${escapeHtml(title)}</h3>
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">${escapeHtml(message)}</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          <button class="inbox-confirm-cancel" style="
            padding:12px 24px;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:10px;
            cursor:pointer;font-size:14px;font-weight:500;
          ">${escapeHtml(cancelLabel)}</button>
          <button class="inbox-confirm-ok" style="
            padding:12px 24px;border:none;background:${danger ? '#dc2626' : '#111'};color:#fff;border-radius:10px;
            cursor:pointer;font-size:14px;font-weight:600;
          ">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    const remove = () => { modal.remove(); };
    modal.querySelector('.inbox-confirm-ok').onclick = () => { remove(); resolve(true); };
    modal.querySelector('.inbox-confirm-cancel').onclick = () => { remove(); resolve(false); };
    modal.onclick = (e) => { if (e.target === modal) { remove(); resolve(false); } };
    document.body.appendChild(modal);
  });
}

/** Returns Promise<string | null> - the input value if confirmed, null if cancelled */
function showPromptModal(options) {
  const {
    title,
    message,
    placeholder = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    required = false
  } = options;
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.id = 'inboxPromptModal';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;
      z-index:999999;padding:20px;backdrop-filter:blur(3px);
    `;
    modal.innerHTML = `
      <div style="
        background:#fff;border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.2);
      ">
        <div style="font-size:40px;margin-bottom:16px;text-align:center;">❓</div>
        <h3 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111;text-align:center;">${escapeHtml(title)}</h3>
        <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.5;text-align:center;">${escapeHtml(message)}</p>
        <textarea id="inboxPromptInput" rows="3" placeholder="${escapeHtml(placeholder)}" style="
          width:100%;padding:12px 14px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;resize:vertical;min-height:80px;box-sizing:border-box;
        "></textarea>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:20px;">
          <button class="inbox-prompt-cancel" style="
            padding:12px 24px;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:10px;
            cursor:pointer;font-size:14px;font-weight:500;
          ">${escapeHtml(cancelLabel)}</button>
          <button class="inbox-prompt-ok" style="
            padding:12px 24px;border:none;background:#7c3aed;color:#fff;border-radius:10px;
            cursor:pointer;font-size:14px;font-weight:600;
          ">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    const input = modal.querySelector('#inboxPromptInput');
    const remove = () => { modal.remove(); };
    modal.querySelector('.inbox-prompt-ok').onclick = () => {
      const val = (input.value || '').trim();
      if (required && !val) {
        input.style.borderColor = '#ef4444';
        return;
      }
      remove();
      resolve(required ? (val || null) : val);
    };
    input.oninput = () => { input.style.borderColor = ''; };
    modal.querySelector('.inbox-prompt-cancel').onclick = () => { remove(); resolve(null); };
    modal.onclick = (e) => { if (e.target === modal) { remove(); resolve(null); } };
    document.body.appendChild(modal);
    input.focus();
  });
}

function showToast(message, type = 'success') {
  if (typeof window !== 'undefined' && window.ffToast && typeof window.ffToast.show === 'function') {
    const v =
      type === 'success' ? 'success' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
    const ms = type === 'error' ? 6500 : 4500;
    window.ffToast.show(String(message), { variant: v, durationMs: ms });
    return;
  }
  console.warn('[Inbox]', message, type);
}

export {
  escapeHtml,
  showConfirmModal,
  showPromptModal,
  showToast,
};
