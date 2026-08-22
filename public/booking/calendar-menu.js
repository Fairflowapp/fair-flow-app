/**
 * One reusable Day Calendar provider menu.
 * Receives provider context; does not own schedule storage or Week View.
 * Permission checks for manager actions live in canManageHours() only.
 */
(function () {
  var MENU_ID = "ffBookingCalProviderMenu";
  var openCtx = null;
  var bound = false;

  function state() { return window.ffBookingCalState || null; }

  function canManageHours() {
    if (typeof window.scheduleUserCanManualEdit === "function") {
      try { return !!window.scheduleUserCanManualEdit(); } catch (_) {}
    }
    if (typeof window.ffHasAdminAccess === "function") {
      try { if (window.ffHasAdminAccess()) return true; } catch (_) {}
    }
    var role = String(window.__ff_user_role || "").toLowerCase();
    return role === "owner" || role === "admin" || role === "manager";
  }

  function hasProfile() {
    return typeof window.openStaffMembersModal === "function";
  }

  function hasScheduleTab() {
    return typeof window.openStaffMemberScheduleTab === "function";
  }

  function actionDefs(ctx) {
    var focused = !!(ctx && ctx.focusProviderId && ctx.focusProviderId === ctx.providerId);
    var manage = canManageHours();
    return [
      {
        id: "focus",
        label: focused ? "View all providers" : "View only this provider",
        enabled: true
      },
      {
        id: "week",
        label: "View provider week",
        enabled: false,
        hint: "Week view coming later"
      },
      {
        id: "hours",
        label: "Edit today's hours",
        enabled: manage && hasScheduleTab(),
        hint: manage ? "" : "Needs schedule permission"
      },
      {
        id: "block",
        label: "Block time",
        enabled: false,
        hint: "Coming later"
      },
      {
        id: "unavailable",
        label: "Mark unavailable today",
        enabled: false,
        hint: "Coming later"
      },
      {
        id: "profile",
        label: "View profile",
        enabled: hasProfile()
      },
      {
        id: "print",
        label: "Print day schedule",
        enabled: false,
        hint: "Coming later"
      }
    ];
  }

  function runAction(id, ctx) {
    var st = state();
    if (id === "focus" && st) {
      if (st.getFocusProviderId() === ctx.providerId) st.clearFocusProvider();
      else st.setFocusProviderId(ctx.providerId);
      if (typeof window.ffRefreshBookingCalendar === "function") window.ffRefreshBookingCalendar();
      return;
    }
    if (id === "hours" && canManageHours() && hasScheduleTab()) {
      window.openStaffMemberScheduleTab(ctx.providerId);
      return;
    }
    if (id === "profile" && hasProfile()) {
      window.openStaffMembersModal({ jumpToStaffId: ctx.providerId, jumpToTab: "details" });
    }
  }

  function ensureMenu() {
    var el = document.getElementById(MENU_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = MENU_ID;
    el.className = "ff-cal-menu";
    el.setAttribute("hidden", "");
    el.setAttribute("role", "menu");
    document.body.appendChild(el);
    return el;
  }

  function close() {
    openCtx = null;
    var el = document.getElementById(MENU_ID);
    if (el) {
      el.setAttribute("hidden", "");
      el.innerHTML = "";
    }
    document.querySelectorAll(".ff-cal-emp-btn[aria-expanded='true']").forEach(function (btn) {
      btn.setAttribute("aria-expanded", "false");
    });
  }

  function anchorNode(anchor) {
    if (!anchor || !anchor.querySelector) return anchor;
    return anchor.querySelector(".ff-cal-emp-ctrl") || anchor;
  }

  function place(el, anchor) {
    if (!el || !anchor) return;
    var rect = anchorNode(anchor).getBoundingClientRect();
    var menuW = el.offsetWidth || 220;
    var menuH = el.offsetHeight || 0;
    var gap = 6;
    var pad = 8;
    var left = rect.left;
    var top = rect.bottom + gap;
    if (left + menuW > window.innerWidth - pad) left = window.innerWidth - menuW - pad;
    if (left < pad) left = pad;
    if (top + menuH > window.innerHeight - pad) top = rect.top - menuH - gap;
    if (top < pad) top = pad;
    el.style.position = "fixed";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
  }

  function open(anchor, ctx) {
    if (!anchor || !ctx || !ctx.providerId) return;
    if (openCtx && openCtx.providerId === ctx.providerId) {
      close();
      return;
    }
    close();
    var el = ensureMenu();
    openCtx = ctx;
    openCtx.anchor = anchor;
    el.innerHTML = actionDefs(ctx).map(function (act) {
      var disabled = act.enabled === false;
      return '<button type="button" class="ff-cal-menu-item" role="menuitem" data-ff-cal-menu="' + act.id + '"' +
        (disabled ? " disabled" : "") +
        (act.hint ? ' title="' + String(act.hint).replace(/"/g, "&quot;") + '"' : "") +
        ">" + act.label + "</button>";
    }).join("");
    el.removeAttribute("hidden");
    anchor.setAttribute("aria-expanded", "true");
    place(el, anchor);
    requestAnimationFrame(function () {
      if (openCtx && openCtx.anchor === anchor) place(el, anchor);
    });
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var item = t.closest("[data-ff-cal-menu]");
      if (item && openCtx) {
        ev.preventDefault();
        var id = item.getAttribute("data-ff-cal-menu");
        var ctx = openCtx;
        close();
        runAction(id, ctx);
        return;
      }
      if (t.closest("#" + MENU_ID) || t.closest(".ff-cal-emp-btn")) return;
      close();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") close();
    });
    window.addEventListener("resize", close);
  }

  window.ffBookingCalMenu = {
    open: open,
    close: close,
    isOpen: function () { return !!openCtx; },
    canManageHours: canManageHours,
    actionDefs: actionDefs
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
