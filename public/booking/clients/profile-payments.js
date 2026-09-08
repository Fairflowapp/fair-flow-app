/**
 * Client Profile Payments tab. Empty until cards and credit exist.
 * Named Payments, not Wallet. Does not invent cards or touch Firestore.
 */
(function () {
  var EMPTY_COPY = "Saved cards and account credit will show here after checkout.";

  function paymentsRepo() {
    return window.ffBookingClientPayments || null;
  }

  function emptyHtml() {
    return (
      '<div class="ff-clip-pay-empty">' +
        "<p>" + EMPTY_COPY + "</p>" +
      "</div>"
    );
  }

  async function load(clientId) {
    var api = paymentsRepo();
    var id = String(clientId || "").trim();
    if (api && id && typeof api.listForClient === "function") {
      return api.listForClient(id);
    }
    return { cards: [], creditCents: 0 };
  }

  function render(host) {
    if (!host) return emptyHtml();
    host.innerHTML = emptyHtml();
    return host.innerHTML;
  }

  window.ffBookingClientProfilePayments = {
    EMPTY_COPY: EMPTY_COPY,
    emptyHtml: emptyHtml,
    load: load,
    render: render
  };
})();
