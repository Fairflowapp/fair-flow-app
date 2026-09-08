/**
 * Readable day board: lanes, gaps, and overlaps.
 * Calendar paint and a future agent consume the same output.
 */
(function () {
  var PAD = 4;
  var GUTTER = 2;

  function overlaps(a, b) {
    return Number(a.startMin) < Number(b.endMin) && Number(a.endMin) > Number(b.startMin);
  }

  function overlapMinutes(a, b) {
    return Math.max(0, Math.min(a.endMin, b.endMin) - Math.max(a.startMin, b.startMin));
  }

  function endOf(row) {
    var start = Number(row && row.startMin);
    var end = Number(row && row.endMin);
    if (Number.isFinite(end) && Number.isFinite(start) && end > start) return end;
    var duration = Number(row && row.durationMinutes);
    if (Number.isFinite(start) && duration > 0) return start + duration;
    return start;
  }

  function toItem(row, kind, index) {
    var start = Number(row && row.startMin);
    var end = endOf(row);
    return {
      kind: kind,
      key: String(row && (row.key || row.lineId || row.lineKey || row.appointmentId) || (kind + "-" + index)),
      appointmentId: row && row.appointmentId ? String(row.appointmentId) : "",
      lineId: String((row && (row.lineId || row.lineKey)) || ""),
      providerId: String((row && row.providerId) || ""),
      startMin: start,
      endMin: end,
      source: row
    };
  }

  function groupByProvider(items) {
    var map = {};
    (items || []).forEach(function (item) {
      if (!item.providerId || !Number.isFinite(item.startMin) || !(item.endMin > item.startMin)) return;
      if (!map[item.providerId]) map[item.providerId] = [];
      map[item.providerId].push(item);
    });
    return map;
  }

  function assignLanes(list) {
    var sorted = list.slice().sort(function (a, b) {
      return a.startMin - b.startMin || a.endMin - b.endMin || String(a.key).localeCompare(String(b.key));
    });
    var ends = [];
    sorted.forEach(function (item) {
      var lane = 0;
      while (lane < ends.length && item.startMin < ends[lane]) lane += 1;
      ends[lane] = item.endMin;
      item.lane = lane;
    });
    return sorted;
  }

  function clusterLaneCounts(list) {
    var parent = list.map(function (_, i) { return i; });
    function find(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    var i;
    var j;
    for (i = 0; i < list.length; i += 1) {
      for (j = i + 1; j < list.length; j += 1) {
        if (!overlaps(list[i], list[j])) continue;
        var ra = find(i);
        var rb = find(j);
        if (ra !== rb) parent[rb] = ra;
      }
    }
    var clusters = {};
    list.forEach(function (item, idx) {
      var root = find(idx);
      if (!clusters[root]) clusters[root] = [];
      clusters[root].push(item);
    });
    Object.keys(clusters).forEach(function (id) {
      var count = 1;
      clusters[id].forEach(function (item) {
        count = Math.max(count, (item.lane || 0) + 1);
      });
      clusters[id].forEach(function (item) {
        item.laneCount = count;
      });
    });
  }

  function geometry(item) {
    var count = Math.max(1, Number(item && item.laneCount) || 1);
    var lane = Number(item && item.lane) || 0;
    var leftPct = (lane / count) * 100;
    var widthPct = 100 / count;
    return {
      left: "calc(" + leftPct + "% + " + PAD + "px)",
      width: "calc(" + widthPct + "% - " + (PAD * 2 + GUTTER) + "px)",
      leftPct: leftPct,
      widthPct: widthPct,
      lane: lane,
      laneCount: count
    };
  }

  function applyGeometry(list) {
    list.forEach(function (item) {
      var g = geometry(item);
      item.left = g.left;
      item.width = g.width;
      item.leftPct = g.leftPct;
      item.widthPct = g.widthPct;
    });
  }

  function findGaps(list) {
    if (!list.length) return [];
    var sorted = list.slice().sort(function (a, b) {
      return a.startMin - b.startMin || a.endMin - b.endMin;
    });
    var gaps = [];
    var coverEnd = sorted[0].endMin;
    var beforeKey = sorted[0].key;
    var i;
    for (i = 1; i < sorted.length; i += 1) {
      if (sorted[i].startMin > coverEnd) {
        gaps.push({
          providerId: sorted[i].providerId,
          startMin: coverEnd,
          endMin: sorted[i].startMin,
          gapMin: sorted[i].startMin - coverEnd,
          beforeKey: beforeKey,
          afterKey: sorted[i].key
        });
      }
      if (sorted[i].endMin > coverEnd) {
        coverEnd = sorted[i].endMin;
        beforeKey = sorted[i].key;
      }
    }
    return gaps;
  }

  function findOverlaps(list) {
    var hits = [];
    var i;
    var j;
    for (i = 0; i < list.length; i += 1) {
      for (j = i + 1; j < list.length; j += 1) {
        var mins = overlapMinutes(list[i], list[j]);
        if (!(mins > 0)) continue;
        hits.push({
          providerId: list[i].providerId,
          aKey: list[i].key,
          bKey: list[j].key,
          overlapMin: mins
        });
      }
    }
    return hits;
  }

  function build(input) {
    var cards = ((input && input.cards) || []).map(function (row, index) {
      return toItem(row, "card", index);
    });
    var holds = ((input && input.holds) || []).map(function (row, index) {
      return toItem(row, "hold", index);
    });
    var items = cards.concat(holds);
    var grouped = groupByProvider(items);
    var gaps = [];
    var overlapsOut = [];
    Object.keys(grouped).forEach(function (id) {
      var list = assignLanes(grouped[id]);
      clusterLaneCounts(list);
      applyGeometry(list);
      gaps = gaps.concat(findGaps(list));
      overlapsOut = overlapsOut.concat(findOverlaps(list));
    });
    return { items: items, gaps: gaps, overlaps: overlapsOut };
  }

  function applyLanes(cards) {
    var board = build({ cards: cards || [], holds: [] });
    (cards || []).forEach(function (card) {
      var hit = board.items.find(function (item) {
        return item.kind === "card"
          && item.providerId === String(card.providerId || "")
          && item.startMin === Number(card.startMin)
          && item.endMin === Number(card.endMin)
          && (!card.appointmentId || item.appointmentId === String(card.appointmentId))
          && (!card.lineId || item.lineId === String(card.lineId));
      });
      if (!hit) return;
      card.lane = hit.lane;
      card.laneCount = hit.laneCount;
      card.left = hit.left;
      card.width = hit.width;
    });
    return cards;
  }

  window.ffBookingScheduleBoard = {
    build: build,
    applyLanes: applyLanes,
    overlaps: overlaps,
    geometry: geometry
  };
})();
