/**
 * Sale detail actions. Arrow menu — Change Date, notes, reopen, print, send.
 * Refund waits for card payments. Does not invent a payment.
 */
(function () {
  var MENU_ID = "ffSaleMenu";
  var DIALOG_ID = "ffSaleDialog";
  var open = false;

  function model() { return window.ffBookingSalesModel || null; }
  function repo() { return window.ffBookingSales || null; }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(message, variant) {
    if (window.ffToast && typeof window.ffToast.show === "function") {
      window.ffToast.show(message, { variant: variant || "info", durationMs: 3200 });
      return;
    }
    window.alert(message);
  }

  function selectedSale() {
    var ui = window.ffBookingSalesUi;
    return ui && typeof ui.getSelected === "function" ? ui.getSelected() : null;
  }

  function chevron() {
    return (
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<polyline points="6 9 12 15 18 9"></polyline>' +
      "</svg>"
    );
  }

  function html() {
    var sale = selectedSale();
    var closed = !sale || sale.status === "closed";
    return (
      '<div class="ff-sale-more' + (open ? " is-open" : "") + '" id="' + MENU_ID + '">' +
        '<button type="button" class="ff-sale-more-btn" data-ff-sale-menu="toggle" aria-expanded="' + (open ? "true" : "false") + '" aria-haspopup="menu" aria-label="Sale actions">' +
          chevron() +
        "</button>" +
        '<div class="ff-sale-menu" role="menu"' + (open ? "" : " hidden") + ">" +
          '<button type="button" role="menuitem" data-ff-sale-menu="date">Change Date</button>' +
          '<button type="button" role="menuitem" data-ff-sale-menu="notes">Add Notes</button>' +
          (closed
            ? '<button type="button" role="menuitem" data-ff-sale-menu="reopen">Reopen</button>'
            : '<button type="button" role="menuitem" data-ff-sale-menu="close">Close sale</button>') +
          '<button type="button" role="menuitem" data-ff-sale-menu="refund">Refund</button>' +
          '<button type="button" role="menuitem" data-ff-sale-menu="print">Print Receipt</button>' +
          '<button type="button" role="menuitem" data-ff-sale-menu="send">Send Receipt</button>' +
        "</div>" +
      "</div>"
    );
  }

  function closeMenu() {
    open = false;
    var wrap = document.getElementById(MENU_ID);
    if (!wrap) return;
    wrap.classList.remove("is-open");
    var btn = wrap.querySelector("[data-ff-sale-menu='toggle']");
    var menu = wrap.querySelector(".ff-sale-menu");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
  }

  function toggleMenu() {
    open = !open;
    var wrap = document.getElementById(MENU_ID);
    if (!wrap) return;
    wrap.classList.toggle("is-open", open);
    var btn = wrap.querySelector("[data-ff-sale-menu='toggle']");
    var menu = wrap.querySelector(".ff-sale-menu");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (menu) menu.hidden = !open;
  }

  function closeDialog() {
    var el = document.getElementById(DIALOG_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function showDialog(title, body, onSave) {
    closeDialog();
    var aside = document.createElement("div");
    aside.id = DIALOG_ID;
    aside.className = "ff-sale-dialog";
    aside.innerHTML =
      '<div class="ff-sale-dialog-card">' +
        "<h3>" + escapeHtml(title) + "</h3>" +
        '<div class="ff-sale-dialog-body">' + body + "</div>" +
        '<div class="ff-sale-dialog-acts">' +
          '<button type="button" class="ff-sale-dialog-ghost" data-ff-sale-dialog="cancel">Cancel</button>' +
          '<button type="button" class="ff-sale-dialog-go" data-ff-sale-dialog="save">Save</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(aside);
    aside.addEventListener("click", function (ev) {
      var act = ev.target && ev.target.closest ? ev.target.closest("[data-ff-sale-dialog]") : null;
      if (!act) return;
      if (act.getAttribute("data-ff-sale-dialog") === "cancel") {
        closeDialog();
        return;
      }
      if (act.getAttribute("data-ff-sale-dialog") === "save") Promise.resolve(onSave(aside)).then(function (ok) {
        if (ok !== false) closeDialog();
      });
    });
    var first = aside.querySelector("input, textarea");
    if (first) first.focus();
  }

  async function patch(saleId, next) {
    var api = repo();
    if (!api || typeof api.updateSale !== "function") {
      toast("Sales are not ready.", "error");
      return { ok: false };
    }
    try {
      return await api.updateSale(saleId, next);
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : "Could not update this sale." };
    }
  }

  function changeDate(sale) {
    var api = model();
    var current = api && api.dateKeyOf ? api.dateKeyOf(sale.closedAt || sale.createdAt, sale.locationId) : "";
    showDialog("Change Date",
      '<label class="ff-sale-dialog-field"><span>Sale date</span>' +
        '<input id="ffSaleDateIn" type="date" value="' + escapeHtml(current) + '">' +
      "</label>",
      async function () {
        var value = (document.getElementById("ffSaleDateIn") || {}).value || "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          toast("Pick a date.", "error");
          return false;
        }
        var result = await patch(sale.saleId, { closedAt: value + "T12:00:00" });
        if (!result || !result.ok) {
          toast((result && result.error) || "This date could not be saved.", "error");
          return false;
        }
        return true;
      }
    );
  }

  function addNotes(sale) {
    var api = model();
    var max = api && api.NOTES_MAX ? api.NOTES_MAX : 2000;
    showDialog("Add Notes",
      '<label class="ff-sale-dialog-field"><span>Notes</span>' +
        '<textarea id="ffSaleNotesIn" rows="5" maxlength="' + max + '">' + escapeHtml(sale.notes || "") + "</textarea>" +
      "</label>",
      async function () {
        var value = (document.getElementById("ffSaleNotesIn") || {}).value || "";
        var result = await patch(sale.saleId, { notes: value });
        if (!result || !result.ok) {
          toast((result && result.error) || "Notes could not be saved.", "error");
          return false;
        }
        return true;
      }
    );
  }

  async function setStatus(sale, status) {
    var result = await patch(sale.saleId, { status: status });
    if (!result || !result.ok) {
      toast((result && result.error) || "This sale could not be updated.", "error");
    }
  }

  function receiptText(sale) {
    var api = model();
    var lines = (sale.items || []).map(function (item) {
      return (item.name || "Item") + "  " + (api ? api.money(item.amount) : item.amount);
    });
    return (api ? api.saleLabel(sale) : "Sale") + "\n" +
      (api ? api.clientName(sale) : "") + "\n" +
      lines.join("\n") +
      (Number(sale.tip) > 0 ? "\nTip  " + api.money(sale.tip) : "") +
      "\nTotal  " + (api ? api.money(sale.total) : "");
  }

  function printReceipt(sale) {
    var api = model();
    var w = window.open("", "_blank", "noopener,noreferrer,width=480,height=720");
    if (!w) {
      toast("Allow pop-ups to print the receipt.", "error");
      return;
    }
    var items = (sale.items || []).map(function (item) {
      return "<li><span>" + escapeHtml(item.name) + "</span><span>" +
        escapeHtml(api ? api.money(item.amount) : "") + "</span></li>";
    }).join("");
    w.document.write(
      "<html><head><title>" + escapeHtml(api ? api.saleLabel(sale) : "Sale") + "</title>" +
      "<style>body{font:14px/1.4 sans-serif;padding:24px}h1{font-size:18px}li{display:flex;justify-content:space-between;padding:6px 0}strong{display:flex;justify-content:space-between;margin-top:12px}</style></head><body>" +
      "<h1>" + escapeHtml(api.saleLabel(sale)) + "</h1>" +
      "<p>" + escapeHtml(api.clientName(sale)) + "</p>" +
      "<ul>" + items + "</ul>" +
      (Number(sale.tip) > 0 ? "<p>Tip " + escapeHtml(api.money(sale.tip)) + "</p>" : "") +
      "<strong><span>Total</span><span>" + escapeHtml(api.money(sale.total)) + "</span></strong>" +
      "</body></html>"
    );
    w.document.close();
    w.focus();
    w.print();
  }

  function sendReceipt(sale) {
    var email = String(sale.clientSnapshot && sale.clientSnapshot.email || "").trim();
    var ui = window.ffBookingSalesUi;
    if (!email && ui && typeof ui.getSelectedClient === "function") {
      var client = ui.getSelectedClient();
      email = String(client && client.email || "").trim();
    }
    if (!email) {
      toast("This client has no email on file.", "error");
      return;
    }
    var subject = encodeURIComponent((model() ? model().saleLabel(sale) : "Sale") + " receipt");
    var body = encodeURIComponent(receiptText(sale));
    window.location.href = "mailto:" + encodeURIComponent(email) + "?subject=" + subject + "&body=" + body;
  }

  function onAct(name) {
    var sale = selectedSale();
    closeMenu();
    if (!sale) return;
    if (name === "date") changeDate(sale);
    else if (name === "notes") addNotes(sale);
    else if (name === "reopen") setStatus(sale, "open");
    else if (name === "close") setStatus(sale, "closed");
    else if (name === "refund") toast("Refund will be available when card payments are on.");
    else if (name === "print") printReceipt(sale);
    else if (name === "send") sendReceipt(sale);
  }

  function bind() {
    if (document.documentElement.getAttribute("data-ff-sale-menu")) return;
    document.documentElement.setAttribute("data-ff-sale-menu", "1");
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== "function") return;
      var act = t.closest("[data-ff-sale-menu]");
      if (act) {
        ev.preventDefault();
        ev.stopPropagation();
        var name = act.getAttribute("data-ff-sale-menu");
        if (name === "toggle") toggleMenu();
        else onAct(name);
        return;
      }
      if (!t.closest("#" + MENU_ID) && !t.closest("#" + DIALOG_ID)) closeMenu();
    });
  }

  bind();

  window.ffBookingSalesMenu = {
    html: html,
    close: closeMenu
  };
})();
