/**
 * Staging-only Client foundation harness.
 * Opens only when ?ffClientTest=1 on staging/localhost.
 * Not the product Clients UI.
 */
(function () {
  var ROOT_ID = "ffBookingClientHarness";
  var STORAGE_KEY = "ff_client_foundation_harness_v1";

  function isAllowedHost() {
    if (typeof window.FF_ENV === "string" && window.FF_ENV === "staging") return true;
    var host = (window.location && window.location.hostname) || "";
    return host === "localhost" || host === "127.0.0.1" || host.indexOf("fair-flow-staging") !== -1;
  }

  function flagFromLocation() {
    try {
      var search = new URLSearchParams(window.location.search || "");
      var v = String(search.get("ffClientTest") || "").trim();
      if (v === "1") return "1";
      if (v === "0") return "0";
    } catch (_) {}
    try {
      var hash = String(window.location.hash || "");
      if (/(?:^|[?#&])ffClientTest=1(?:&|$)/.test(hash)) return "1";
      if (/(?:^|[?#&])ffClientTest=0(?:&|$)/.test(hash)) return "0";
    } catch (_) {}
    return "";
  }

  function persistFlag(value) {
    try {
      if (value === "1") sessionStorage.setItem(STORAGE_KEY, "1");
      else if (value === "0") sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function isRequested() {
    var fromUrl = flagFromLocation();
    if (fromUrl) {
      persistFlag(fromUrl);
      return fromUrl === "1";
    }
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function repo() {
    return window.ffBookingClients || null;
  }

  function field(id) {
    var el = document.getElementById(id);
    return el ? el.value : "";
  }

  function log(message, data) {
    var out = document.getElementById("ffClientHarnessLog");
    if (!out) return;
    var line = message;
    if (data !== undefined) {
      try { line += " " + JSON.stringify(data, null, 2); } catch (_) {}
    }
    out.textContent = line;
  }

  function selectedId() {
    return field("ffClientHarnessId");
  }

  async function onCreate() {
    var api = repo();
    if (!api) return log("Client repository is not loaded.");
    var result = await api.createClient({
      firstName: field("ffClientHarnessFirst"),
      lastName: field("ffClientHarnessLast"),
      phone: field("ffClientHarnessPhone"),
      email: field("ffClientHarnessEmail"),
      notes: field("ffClientHarnessNotes")
    });
    if (result.client && result.client.clientId) {
      var idEl = document.getElementById("ffClientHarnessId");
      if (idEl) idEl.value = result.client.clientId;
    }
    log(result.duplicate ? "Existing client found" : (result.created ? "Created" : "Create failed"), result);
  }

  async function onSearch() {
    var api = repo();
    if (!api) return log("Client repository is not loaded.");
    var rows = await api.searchClients(field("ffClientHarnessQuery"));
    log("Search results (" + rows.length + ")", rows.map(function (row) {
      return {
        clientId: row.clientId,
        displayName: row.displayName,
        phone: row.phone,
        email: row.email,
        createdAtLocationId: row.createdAtLocationId
      };
    }));
  }

  async function onUpdate() {
    var api = repo();
    if (!api) return log("Client repository is not loaded.");
    var result = await api.updateClient(selectedId(), {
      firstName: field("ffClientHarnessFirst"),
      lastName: field("ffClientHarnessLast"),
      phone: field("ffClientHarnessPhone"),
      email: field("ffClientHarnessEmail"),
      notes: field("ffClientHarnessNotes")
    });
    log(result.ok ? "Updated" : "Update failed", result);
  }

  async function runFoundationTests() {
    var api = repo();
    var model = window.ffBookingClientModel;
    if (!api || !model) return log("Client APIs are not loaded.");
    var report = {};

    var created = await api.createClient({
      firstName: "Jessica",
      lastName: "Miller",
      phone: "(305) 555-1212",
      email: "Jessica@Example.com",
      notes: "foundation-test"
    });
    report.A_create = !!(created.ok && created.client && created.client.clientId && created.client.firstName === "Jessica");

    var byPhone = await api.searchClients("3055551212");
    report.B_phone = !!(byPhone[0] && byPhone[0].clientId === created.client.clientId);

    var byEmail = await api.searchClients("jessica@example.com");
    report.C_email = !!(byEmail[0] && byEmail[0].clientId === created.client.clientId);

    var dupPhone = await api.createClient({
      firstName: "Jessica",
      lastName: "Miller",
      phone: "305-555-1212",
      email: "other-jessica@example.net"
    });
    report.D_dup_phone = !!(dupPhone.duplicate && dupPhone.matchBy === "phone" && dupPhone.client.clientId === created.client.clientId);

    var dupEmail = await api.createClient({
      firstName: "Jess",
      lastName: "M",
      phone: "7865550000",
      email: "JESSICA@EXAMPLE.COM"
    });
    report.E_dup_email = !!(dupEmail.duplicate && dupEmail.matchBy === "email" && dupEmail.client.clientId === created.client.clientId);

    var other = await api.createClient({
      firstName: "Jessica",
      lastName: "Miller",
      phone: "(786) 555-3434",
      email: "jessica.miller.two@example.com"
    });
    report.F_same_name_different_person = !!(other.created && other.client && other.client.clientId !== created.client.clientId);

    var before = created.client.updatedAt;
    var updated = await api.updateClient(created.client.clientId, { notes: "foundation-test-updated" });
    var after = updated.client && updated.client.updatedAt;
    report.G_update = !!(updated.ok && updated.client.notes === "foundation-test-updated" && after && String(after) !== String(before));

    report.H_location = created.client.createdAtLocationId === api.currentLocationId();
    report.I_salon_path = api.currentSalonId() === window.currentSalonId;
    var byName = await api.searchClients("Jess");
    report.J_name_search = byName.some(function (row) { return row.clientId === created.client.clientId; });

    log("Foundation tests", report);
    return report;
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    var root = document.createElement("aside");
    root.id = ROOT_ID;
    root.innerHTML =
      '<div style="position:fixed;right:16px;bottom:16px;z-index:200050;width:320px;max-height:80vh;overflow:auto;background:#fff;border:1px solid #d8d2e4;border-radius:12px;box-shadow:0 10px 30px rgba(40,20,70,.16);padding:12px;font:13px/1.4 system-ui;">' +
        "<strong>Client foundation harness</strong>" +
        '<p style="margin:6px 0 10px;color:#6d657c;">Staging test only. Not the Clients product UI.</p>' +
        '<input id="ffClientHarnessId" placeholder="clientId" style="width:100%;margin:0 0 6px;padding:6px;">' +
        '<input id="ffClientHarnessFirst" placeholder="First name" style="width:100%;margin:0 0 6px;padding:6px;">' +
        '<input id="ffClientHarnessLast" placeholder="Last name" style="width:100%;margin:0 0 6px;padding:6px;">' +
        '<input id="ffClientHarnessPhone" placeholder="Phone" style="width:100%;margin:0 0 6px;padding:6px;">' +
        '<input id="ffClientHarnessEmail" placeholder="Email" style="width:100%;margin:0 0 6px;padding:6px;">' +
        '<input id="ffClientHarnessNotes" placeholder="Notes" style="width:100%;margin:0 0 6px;padding:6px;">' +
        '<input id="ffClientHarnessQuery" placeholder="Search name / phone / email" style="width:100%;margin:0 0 8px;padding:6px;">' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
          '<button type="button" data-act="create">Create</button>' +
          '<button type="button" data-act="search">Search</button>' +
          '<button type="button" data-act="update">Update</button>' +
          '<button type="button" data-act="tests">Run A–J</button>' +
        "</div>" +
        '<pre id="ffClientHarnessLog" style="white-space:pre-wrap;margin:10px 0 0;font-size:11px;max-height:220px;overflow:auto;"></pre>' +
      "</div>";
    root.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (!btn) return;
      var act = btn.getAttribute("data-act");
      Promise.resolve(
        act === "create" ? onCreate()
          : act === "search" ? onSearch()
            : act === "update" ? onUpdate()
              : act === "tests" ? runFoundationTests()
                : null
      ).catch(function (err) {
        log("Error", String(err && err.message ? err.message : err));
      });
    });
    document.body.appendChild(root);
  }

  function tryMount() {
    if (!isAllowedHost() || !isRequested()) return;
    if (!document.body) return;
    mount();
  }

  function start() {
    tryMount();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", tryMount);
    }
    window.addEventListener("popstate", tryMount);
    setTimeout(tryMount, 0);
    setTimeout(tryMount, 800);
    setTimeout(tryMount, 2500);
  }

  window.ffBookingClientHarness = {
    runFoundationTests: runFoundationTests
  };
  start();
})();
