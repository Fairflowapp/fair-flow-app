// Elements

// Get elements - use getElementById for more reliable selection
const nameSelect = document.getElementById("nameSelect") || $("#nameSelect");
const pinInput = document.getElementById("pinInput") || $("#pinInput");
const togglePin = document.getElementById("togglePin") || $("#togglePin");
const joinBtn = document.getElementById("joinBtn") || $("#joinBtn");

const resetBtn=$("#resetBtn"), reorderBtn=$("#reorderBtn"), logBtn=$("#logBtn"), settingsBtn=$("#settingsBtn"), queueBtn=$("#queueBtn");

// Declare salonName early to ensure it's available before renderBrand() is called
const salonName=$("#salonName"), salonInput=$("#salonInput"), brandLogo=$("#brandLogo");

// Numeric-only PIN/code input enforcement using event delegation
(function() {
  // Matcher function to identify PIN/code inputs
  function isPinLikeInput(el) {
    if (!el || el.tagName !== 'INPUT' || el.type === 'email' || el.type === 'file') {
      return false;
    }
    
    const id = (el.id || '').toLowerCase();
    const name = (el.name || '').toLowerCase();
    const placeholder = (el.placeholder || '').toLowerCase();
    const className = (el.className || '').toLowerCase();
    
    return (
      id.includes('pin') || id.includes('code') ||
      name.includes('pin') || name.includes('code') ||
      placeholder.includes('pin') || placeholder.includes('code') ||
      className.includes('pin') || className.includes('mcode') || className.includes('wpin')
    );
  }
  
  // Configure a PIN input with numeric attributes
  // Keep type="password" by default for visual hiding, but allow eye toggle to change to text
  function configurePinInput(el) {
    if (!el || !isPinLikeInput(el)) return;
    
    // Set to password by default (hidden), unless already text (eye toggle revealed it)
    // Don't override if eye toggle has set it to text
    if (el.type !== 'text') {
      el.type = "password";
    }
    // If type is already 'text' (from eye toggle), leave it as text
    
    el.inputMode = "numeric";
    el.pattern = "[0-9]*";
    // Use one-time-code for autocomplete, but allow override
    if (!el.hasAttribute('autocomplete')) {
      el.autocomplete = "one-time-code";
    }
  }
  
  // Focusin handler: configure input when focused
  document.addEventListener('focusin', function(e) {
    if (isPinLikeInput(e.target)) {
      configurePinInput(e.target);
    }
  }, true);
  
  // Input handler: strip non-digits
  document.addEventListener('input', function(e) {
    if (isPinLikeInput(e.target)) {
      e.target.value = e.target.value.replace(/\D/g, "");
    }
  }, true);
  
  // Paste handler: strip non-digits from pasted content
  document.addEventListener('paste', function(e) {
    if (isPinLikeInput(e.target)) {
      e.preventDefault();
      const pastedText = (e.clipboardData || window.clipboardData).getData('text');
      const numericOnly = pastedText.replace(/\D/g, "");
      if (numericOnly) {
        const start = e.target.selectionStart || 0;
        const end = e.target.selectionEnd || 0;
        const currentValue = e.target.value;
        e.target.value = currentValue.substring(0, start) + numericOnly + currentValue.substring(end);
        e.target.setSelectionRange(start + numericOnly.length, start + numericOnly.length);
        e.target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }, true);
  
  // Initialize existing inputs on DOM ready
  function initPinInputs() {
    document.querySelectorAll('input').forEach(function(input) {
      if (isPinLikeInput(input)) {
        configurePinInput(input);
      }
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPinInputs);
  } else {
    initPinInputs();
  }
})();

// Global delegated handler for yearly month/day controls
if (!window.__ffYearlyDraftHandlersAttached) {
  window.__ffYearlyDraftHandlersAttached = true;

  function handleYearlyDateChange(e) {
    const el = e.target.closest('[data-ff="yearly-month"], [data-ff="yearly-day"]');
    if (!el) return;

    const taskId = el.getAttribute('data-task-id');
    if (!taskId) return;

    const task = (tasksModalDraft.yearly || []).find(t =>
      String(t.taskId || t.id) === String(taskId)
    );
    if (!task) return;

    if (el.getAttribute('data-ff') === 'yearly-month') {
      const n = parseInt(el.value, 10);
      task.scheduleMonth = Number.isFinite(n) ? n : null;
      // Recompute scheduleYear when month changes
      if (task.scheduleMonth !== null && task.scheduleDay !== null) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const todayMonth = now.getMonth() + 1; // 1-12
        const todayDay = now.getDate();
        // If month/day is earlier than today's month/day, scheduleYear = currentYear + 1, else currentYear
        if (task.scheduleMonth < todayMonth || (task.scheduleMonth === todayMonth && task.scheduleDay < todayDay)) {
          task.scheduleYear = currentYear + 1;
        } else {
          task.scheduleYear = currentYear;
        }
      }
    }

    if (el.getAttribute('data-ff') === 'yearly-day') {
      const n = parseInt(el.value, 10);
      task.scheduleDay = (Number.isFinite(n) && n >= 1 && n <= 31) ? n : null;
      // Recompute scheduleYear when day changes
      if (task.scheduleMonth !== null && task.scheduleDay !== null) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const todayMonth = now.getMonth() + 1; // 1-12
        const todayDay = now.getDate();
        // If month/day is earlier than today's month/day, scheduleYear = currentYear + 1, else currentYear
        if (task.scheduleMonth < todayMonth || (task.scheduleMonth === todayMonth && task.scheduleDay < todayDay)) {
          task.scheduleYear = currentYear + 1;
        } else {
          task.scheduleYear = currentYear;
        }
      }
    }

    // update the visible button label immediately
    const wrapper = document.querySelector(
      `.tasks-yearly-date-selector-wrapper[data-task-id="${taskId}"]`
    );
    const label = wrapper?.querySelector('.tasks-yearly-date-summary span:first-child');
    if (label) label.textContent = `Date: ${getYearlyDateSummary(task.scheduleMonth, task.scheduleDay)}`;
    
    const summaryBtn = wrapper?.querySelector('.tasks-yearly-date-summary');
    if (summaryBtn) {
      summaryBtn.style.color = (task.scheduleMonth === null || task.scheduleDay === null) ? '#dc2626' : '#666';
    }
  }

  // Handle both 'input' (for number input) and 'change' (for select)
  document.addEventListener('input', handleYearlyDateChange, true);
  document.addEventListener('change', handleYearlyDateChange, true);
}

const queueList=$("#queueList"), serviceList=$("#serviceList");

const settingsDlg=$("#settingsDlg");

const logoPreview=$("#logoPreview"), logoFile=$("#logoFile");

const logDlg=$("#logDlg"), logBox=$("#logBox");


