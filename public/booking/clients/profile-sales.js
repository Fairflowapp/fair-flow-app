/**
 * Client Profile Sales tab. Lists checkout tickets for this client.
 */
(function () {
  var TABS = ["sales", "appointments", "memberships", "payments", "notes"];
  var EMPTY_COPY = "No sales yet for this client. Sales appear here after checkout.";
  var cache = { clientId: "", rows: [] };

  function salesRepo() {
    return window.ffBookingClientSales || window.ffBookingSales || null;
  }

  function model() {
    return window.ffBookingSalesModel || null;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function emptyHtml() {
    return (
      '<div class="ff-clip-sales-empty">' +
        "<p>" + EMPTY_COPY + "</p>" +
      "</div>"
    );
  }

  function listHtml(rows) {
    var api = model();
    var list = rows || [];
    if (!list.length) return emptyHtml();
    return (
      '<ul class="ff-clip-sales">' +
        list.map(function (row) {
          var label = api && api.saleLabel ? api.saleLabel(row) : ("Sale #" + (row.saleNumber || "—"));
          var when = api && api.formatDate ? api.formatDate(row.closedAt || row.createdAt) : "";
          var total = api && api.money ? api.money(row.total) : (row.total != null ? "$" + Number(row.total).toFixed(2) : "");
          return '<li class="ff-clip-sale">' +
            "<div><strong>" + escapeHtml(label) + "</strong><span>" + escapeHtml(when) + "</span></div>" +
            "<em>" + escapeHtml(total) + "</em>" +
          "</li>";
        }).join("") +
      "</ul>"
    );
  }

  async function load(clientId) {
    var api = salesRepo();
    var id = String(clientId || "").trim();
    if (api && id && typeof api.listForClient === "function") {
      var result = await api.listForClient(id);
      var rows = result && Array.isArray(result.orders) ? result.orders : [];
      cache = { clientId: id, rows: rows };
      return result;
    }
    cache = { clientId: id, rows: [] };
    return { orders: [] };
  }

  function render(host, clientId) {
    if (!host) return emptyHtml();
    var id = String(clientId || "").trim();
    if (id && cache.clientId === id) {
      host.innerHTML = listHtml(cache.rows);
      return host.innerHTML;
    }
    host.innerHTML = emptyHtml();
    if (id) {
      load(id).then(function () {
        if (cache.clientId === id) host.innerHTML = listHtml(cache.rows);
      }).catch(function () {});
    }
    return host.innerHTML;
  }

  window.ffBookingClientProfileSales = {
    TABS: TABS,
    DEFAULT_TAB: TABS[0],
    EMPTY_COPY: EMPTY_COPY,
    emptyHtml: emptyHtml,
    listHtml: listHtml,
    load: load,
    render: render
  };
})();
