/**
 * Smart Scheduling Phase 1 — public ranking API.
 *
 * Load order: normalize.js → gaps.js → candidates.js → score.js → engine.js → moves.js → day-analysis.js → priorities.js → assign.js → cancellation-recovery.js → waitlist.js
 *
 * Sits on top of Booking availability/conflict results. Does not replace them.
 * Recommendation-only: never writes, moves, messages, or hides valid slots.
 */
(function () {
  function ns() {
    return window.ffBookingSmartScheduling || (window.ffBookingSmartScheduling = {});
  }

  function compareScored(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    var ai = Number(a.workingIntervalIndex) || 0;
    var bi = Number(b.workingIntervalIndex) || 0;
    if (ai !== bi) return ai - bi;
    if (a.endMin !== b.endMin) return a.endMin - b.endMin;
    var aCodes = (a.reasons || []).map(function (row) { return row.code; }).join("|");
    var bCodes = (b.reasons || []).map(function (row) { return row.code; }).join("|");
    if (aCodes !== bCodes) return aCodes < bCodes ? -1 : 1;
    return 0;
  }

  function rankSlots(day, request) {
    var api = ns();
    var slots = typeof api.enumerateValidSlots === "function"
      ? api.enumerateValidSlots(day, request)
      : [];
    return slots.map(function (slot) {
      return api.scoreSlot(day, slot, request);
    }).sort(compareScored);
  }

  var api = ns();
  api.rankSlots = rankSlots;
  api.compareScoredSlots = compareScored;
})();
