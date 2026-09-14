/**
 * Reports catalog. Booking Intelligence is the default landing.
 * Visible items are built reports only. Product Sales stays out of nav
 * until Booking checkout writes product items.
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
        },
        {
          id: "forward-outlook",
          label: "Forward Outlook",
          blurb: "What is already booked ahead and how much future working time is still open."
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
          blurb: "Overall closed checkout sales."
        },
        {
          id: "service-sales",
          label: "Service Sales",
          blurb: "Service-item sales from closed checkout tickets. Tips and ticket-level refunds are not allocated to services."
        },
        {
          id: "sales-by-period",
          label: "Sales by Time Period",
          blurb: "Closed checkout sales grouped by sale date."
        }
      ]
    },
    {
      id: "clients",
      label: "Clients",
      items: [
        {
          id: "cancellations",
          label: "Cancellations",
          blurb: "Appointments scheduled in the selected period that were cancelled."
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
