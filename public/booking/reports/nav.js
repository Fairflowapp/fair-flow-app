/**
 * Reports catalog. Booking Intelligence is the default landing. Sales stay available.
 */
(function () {
  var KEY = "ff-booking-report";
  var DEFAULT_ID = "booking-intelligence";
  var GROUPS = [
    {
      id: "intelligence",
      label: "Intelligence",
      items: [
        {
          id: "booking-intelligence",
          label: "Booking Intelligence",
          blurb: "Appointments, utilization, calendar gaps, and unused capacity from live booking data."
        }
      ]
    },
    {
      id: "sales",
      label: "Sales",
      items: [
        {
          id: "sales-summary",
          label: "Sales Summary",
          blurb: "Shows quantities and sales totals of services for each day."
        },
        {
          id: "service-sales",
          label: "Service Sales",
          blurb: "Totals by service from checkout."
        },
        {
          id: "product-sales",
          label: "Product Sales",
          blurb: "Retail product sales. This report waits until checkout includes products."
        },
        {
          id: "sales-by-period",
          label: "Sales by Time Period",
          blurb: "Compare sales across days, weeks, or months."
        }
      ]
    }
  ];

  function items() {
    var out = [];
    GROUPS.forEach(function (group) {
      (group.items || []).forEach(function (item) {
        out.push(item);
      });
    });
    return out;
  }

  function find(id) {
    var key = String(id || "").trim();
    return items().find(function (row) { return row.id === key; }) || null;
  }

  function stored() {
    try {
      var value = window.sessionStorage.getItem(KEY);
      if (find(value)) return value;
    } catch (_) {}
    return DEFAULT_ID;
  }

  function getSelectedId() {
    return stored();
  }

  function setSelectedId(id) {
    var next = find(id) ? String(id) : DEFAULT_ID;
    try { window.sessionStorage.setItem(KEY, next); } catch (_) {}
    return next;
  }

  function getSelected() {
    return find(getSelectedId()) || find(DEFAULT_ID);
  }

  window.ffBookingReportsNav = {
    GROUPS: GROUPS,
    DEFAULT_ID: DEFAULT_ID,
    items: items,
    find: find,
    getSelectedId: getSelectedId,
    setSelectedId: setSelectedId,
    getSelected: getSelected
  };
})();
