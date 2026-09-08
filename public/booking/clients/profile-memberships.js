/**
 * Client Profile Memberships tab. Empty until plans exist.
 * Does not invent memberships or touch Firestore.
 */
(function () {
  var EMPTY_COPY = "Memberships and packages will show here. Selling them comes next.";

  function membershipsRepo() {
    return window.ffBookingClientMemberships || null;
  }

  function emptyHtml() {
    return (
      '<div class="ff-clip-mem-empty">' +
        "<p>" + EMPTY_COPY + "</p>" +
      "</div>"
    );
  }

  async function load(clientId) {
    var api = membershipsRepo();
    var id = String(clientId || "").trim();
    if (api && id && typeof api.listForClient === "function") {
      return api.listForClient(id);
    }
    return { memberships: [], packages: [] };
  }

  function render(host) {
    if (!host) return emptyHtml();
    host.innerHTML = emptyHtml();
    return host.innerHTML;
  }

  window.ffBookingClientProfileMemberships = {
    EMPTY_COPY: EMPTY_COPY,
    emptyHtml: emptyHtml,
    load: load,
    render: render
  };
})();
