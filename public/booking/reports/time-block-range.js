/**
 * Range-complete Time Blocks for Intelligence and Forward Outlook.
 * One-off documents plus generated recurring occurrences (overrides / skips).
 * Does not write the Calendar block cache.
 */
(function () {
  var LOAD_ERROR_MESSAGE = "Time Blocks for this range could not load.";

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function uniqueLocationIds(locationIds) {
    var seen = {};
    var out = [];
    (Array.isArray(locationIds) ? locationIds : []).forEach(function (id) {
      var key = trim(id);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(key);
    });
    return out;
  }

  function failResult(error) {
    return { kind: "error", complete: false, error: error || LOAD_ERROR_MESSAGE, blocks: [] };
  }

  function userSafeError(error) {
    var msg = trim(error);
    if (!msg) return LOAD_ERROR_MESSAGE;
    if (msg === "Choose a location." || msg === "Choose a start and end date.") return msg;
    if (/firebase|firestore|failed-precondition|permission|index|quota|No salon/i.test(msg)) {
      return LOAD_ERROR_MESSAGE;
    }
    return LOAD_ERROR_MESSAGE;
  }

  function viewState(fetchResult) {
    var row = fetchResult || {};
    if (row.kind === "error" || row.error) {
      return { kind: "error", message: userSafeError(row.error || row.message), blocks: [] };
    }
    return { kind: "ok", message: "", blocks: Array.isArray(row.blocks) ? row.blocks : [] };
  }

  async function fetchForReport(repo, options) {
    var opts = options && typeof options === "object" ? options : {};
    var ids = uniqueLocationIds(opts.locationIds);
    var fromKey = trim(opts.fromKey);
    var toKey = trim(opts.toKey);
    if (!ids.length) return failResult("Choose a location.");
    if (!fromKey || !toKey) return failResult("Choose a start and end date.");
    if (!repo || typeof repo.listForLocationsRange !== "function") {
      return failResult("Time Block lookup is not available.");
    }
    try {
      var blocks = await repo.listForLocationsRange(ids, fromKey, toKey);
      return { kind: "ok", complete: true, blocks: Array.isArray(blocks) ? blocks : [] };
    } catch (err) {
      return failResult(err && err.message ? err.message : LOAD_ERROR_MESSAGE);
    }
  }

  window.ffBookingReportsTimeBlockRange = {
    LOAD_ERROR_MESSAGE: LOAD_ERROR_MESSAGE,
    uniqueLocationIds: uniqueLocationIds,
    failResult: failResult,
    userSafeError: userSafeError,
    viewState: viewState,
    fetchForReport: fetchForReport
  };
})();
