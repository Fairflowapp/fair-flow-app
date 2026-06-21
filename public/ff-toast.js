/**
 * Fair Flow — global toast API (classic script, no imports).
 *
 *   window.ffToast.show(message, { variant, durationMs })
 *   window.ffToast.success(message, durationMs?)
 *   window.ffToast.error / .warning / .info / .neutral(message, durationMs?)
 *
 * Legacy (schedule, birthday reminders, inline HTML):
 *   window.showToast(message, durationMs)           → infers variant from message text
 *   window.showToast(message, 'success'|'error'|…, durationMs?)
 */
(function (global) {
  'use strict';

  var TOAST_ID = 'ff-app-toast';
  var DEFAULT_MS = 5000;

  var COLORS = {
    success: '#7c3aed',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#4b5563',
    neutral: '#111827'
  };

  function normalizeVariant(v) {
    if (v === 'danger') return 'error';
    if (v === 'warn') return 'warning';
    if (COLORS[v]) return v;
    return 'info';
  }

  function show(message, opts) {
    opts = opts || {};
    var variant = normalizeVariant(opts.variant);
    var durationMs =
      typeof opts.durationMs === 'number' && opts.durationMs > 0 ? opts.durationMs : DEFAULT_MS;
    var bg = COLORS[variant] || COLORS.info;

    var existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.id = TOAST_ID;
    el.textContent = message == null ? '' : String(message);
    el.setAttribute('role', variant === 'error' ? 'alert' : 'status');
    el.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'right:24px',
      'z-index:999999',
      'padding:13px 20px',
      'border-radius:10px',
      'background:' + bg,
      'color:#fff',
      'font-size:14px',
      'font-weight:600',
      'box-shadow:0 6px 24px rgba(0,0,0,0.18)',
      'max-width:min(360px,92vw)',
      'line-height:1.4',
      'pointer-events:none',
      'word-break:break-word'
    ].join(';');
    document.body.appendChild(el);
    setTimeout(function () {
      var t = document.getElementById(TOAST_ID);
      if (t) t.remove();
    }, durationMs);
    return el;
  }

  /** Infer variant when only (message, duration) is passed (legacy callers). */
  function inferVariantFromMessage(msg) {
    var s = String(msg || '');
    if (/fail|error|could not|unable|denied|wrong|invalid|not authorized|permission|check connection|must log/i.test(s)) {
      return 'error';
    }
    if (/saved|success|submitted|updated|archived|deleted|added|sent|approved|uploaded|linked|reset|synced|loaded|queued/i.test(s)) {
      return 'success';
    }
    return 'info';
  }

  function legacyShowToast(message, second, third) {
    var msg = message == null ? '' : String(message);

    if (typeof second === 'number') {
      return show(msg, {
        variant: inferVariantFromMessage(msg),
        durationMs: second
      });
    }

    if (typeof second === 'string' && ['success', 'error', 'warning', 'info', 'neutral'].indexOf(second) !== -1) {
      var dur =
        typeof third === 'number' && third > 0
          ? third
          : second === 'error'
            ? 6500
            : 4500;
      return show(msg, { variant: second, durationMs: dur });
    }

    return show(msg, { variant: 'info', durationMs: DEFAULT_MS });
  }

  var api = {
    show: show,
    success: function (m, d) {
      return show(m, { variant: 'success', durationMs: d });
    },
    error: function (m, d) {
      return show(m, { variant: 'error', durationMs: d });
    },
    warning: function (m, d) {
      return show(m, { variant: 'warning', durationMs: d });
    },
    info: function (m, d) {
      return show(m, { variant: 'info', durationMs: d });
    },
    neutral: function (m, d) {
      return show(m, { variant: 'neutral', durationMs: d });
    }
  };

  global.ffToast = api;
  global.showToast = legacyShowToast;
})(typeof window !== 'undefined' ? window : globalThis);
