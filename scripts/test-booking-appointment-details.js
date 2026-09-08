/**
 * Appointment Details view helpers. No Firestore writes.
 * Usage: node scripts/test-booking-appointment-details.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  new Function("window", "document", src)(windowObj, windowObj.document);
}

function utc(h, m) {
  return new Date(Date.UTC(2026, 7, 24, h, m, 0));
}

const appointment = {
  appointmentId: "appt_1",
  status: "scheduled",
  locationId: "locA",
  dateKey: "2026-08-24",
  notes: "Prefers quiet room",
  clientSnapshot: {
    displayName: "Shiri A",
    phone: "9546306513",
    email: "shiri@example.com"
  },
  serviceLines: [{
    lineId: "line_1",
    providerId: "koko",
    providerNameSnapshot: "koko",
    serviceNameSnapshot: "Manicure",
    startAt: utc(15, 15),
    endAt: utc(16, 15),
    durationMinutes: 60,
    priceSnapshot: 55
  }]
};

const windowObj = {
  document: {
    getElementById: function () { return null; },
    addEventListener: function () {},
    dispatchEvent: function () {}
  },
  addEventListener: function () {},
  ffGetLocations: function () {
    return [{ id: "locA", name: "Soso spa" }];
  },
  ffBookingCalState: {
    getEmployees: function () {
      return [{ id: "koko", firstName: "koko", photoURL: "" }];
    }
  },
  ffBookingTime: {
    zonedMinutes: function (date) {
      return date.getUTCHours() * 60 + date.getUTCMinutes();
    },
    zonedDateKey: function () { return "2026-08-24"; },
    formatDisplayDate: function (dateKey) {
      return dateKey === "2026-08-24" ? "Monday, Aug 24, 2026" : dateKey;
    }
  },
  ffBookingAppointments: {
    getAppointmentsForDate: async function () {
      return [appointment];
    },
    getAppointmentById: async function () {
      throw new Error("should not fetch when cache has the appointment");
    }
  }
};

load("public/booking/appointments/status.js", windowObj);
load("public/booking/appointments/calendar-data.js", windowObj);
load("public/booking/appointments/details.js", windowObj);

const details = windowObj.ffBookingAppointmentDetails;
const cal = windowObj.ffBookingCalAppointments;
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const view = details.viewFrom(appointment, "line_1");
check("uses appointmentId", view.appointmentId === "appt_1");
check("client snapshot name", view.clientName === "Shiri A");
check("phone preferred over email", view.clientSecondary === "9546306513");
check("service snapshot", view.serviceName === "Manicure");
check("stored price", view.priceLabel === "$55");
check("duration", view.durationLabel === "60 min");
check("start time", view.startLabel === "3:15 PM");
check("end time", view.endLabel === "4:15 PM");
check("provider snapshot", view.providerName === "koko");
check("date label", view.dateLabel === "Monday, Aug 24, 2026");
check("location label", view.locationLabel === "Soso spa");
check("notes", view.notes === "Prefers quiet room" && view.notesEmpty === false);
check("status label", view.statusLabel === "Waiting for confirmation");
check("regular details are not a first visit", view.isNewClient === false);
const firstVisitView = details.viewFrom(Object.assign({}, appointment, { firstVisit: true }), "line_1");
check("first-visit details mark New Client", firstVisitView.isNewClient === true);
check("scheduled appointment can check in", view.canCheckIn === true);
check("scheduled offers confirm first", view.statusActions[0] && view.statusActions[0].id === "confirm");
check("single-service total matches line", view.total === 55 && view.totalLabel === "$55");
check("single-service list has one row", view.services.length === 1);
check("details do not treat a named provider as a request", view.services[0].requested === false);
const requestedView = details.viewFrom({
  appointmentId: "appt_r",
  status: "confirmed",
  locationId: "locA",
  dateKey: "2026-08-24",
  clientSnapshot: { displayName: "Jenny" },
  serviceLines: [Object.assign({}, appointment.serviceLines[0], { requested: true })]
}, "line_1");
check("details keep a requested provider mark", requestedView.services[0].requested === true);

const multi = details.viewFrom({
  appointmentId: "appt_m",
  status: "scheduled",
  locationId: "locA",
  dateKey: "2026-08-24",
  notes: "",
  clientSnapshot: { displayName: "Shiri A", phone: "9546306513" },
  serviceLines: [
    appointment.serviceLines[0],
    {
      lineId: "line_2",
      providerId: "bobo",
      providerNameSnapshot: "bobo",
      serviceNameSnapshot: "Pedicure",
      startAt: utc(16, 45),
      endAt: utc(17, 45),
      durationMinutes: 60,
      priceSnapshot: 65
    }
  ]
}, "line_2");
check("W details lists all services", multi.services.length === 2 && multi.services[1].serviceName === "Pedicure");
check("X details total is the sum", multi.total === 120 && multi.totalLabel === "$120");
check("clicked line still identifies itself", multi.serviceName === "Pedicure");

const emailOnly = details.viewFrom({
  appointmentId: "appt_2",
  status: "confirmed",
  locationId: "locA",
  dateKey: "2026-08-24",
  notes: "",
  clientSnapshot: { displayName: "Shiri A", phone: "", email: "shiri@example.com" },
  serviceLines: appointment.serviceLines
}, "line_1");
check("email fallback", emailOnly.clientSecondary === "shiri@example.com");
check("confirmed appointment can check in", emailOnly.canCheckIn === true);
check("empty notes", emailOnly.notesEmpty === true);

const cancelled = details.viewFrom({
  appointmentId: "appt_3",
  status: "cancelled",
  locationId: "locA",
  dateKey: "2026-08-24",
  notes: "",
  cancellationReason: "  Client asked  ",
  clientSnapshot: { displayName: "Shiri A", phone: "9546306513" },
  serviceLines: appointment.serviceLines
}, "line_1");
check("cancelled status label", cancelled.statusLabel === "Cancelled" && cancelled.isCancelled === true);
check("cancelled appointment cannot check in", cancelled.canCheckIn === false);
check("cancellation reason shown", cancelled.cancellationReason === "Client asked");

const repoSrc = fs.readFileSync(path.join(root, "public/booking/appointments/data.js"), "utf8");
check("cancel does not delete the appointment", repoSrc.indexOf("deleteDoc") === -1);
check("cancel writes status cancelled", /status:\s*"cancelled"/.test(repoSrc));
check("cancel is idempotent for already-cancelled", repoSrc.indexOf("alreadyCancelled") !== -1);

const holdSrc = fs.readFileSync(path.join(root, "public/booking/calendar-draft.js"), "utf8");
check("hold is not a calendar card", holdSrc.indexOf("data-ff-cal-card") === -1);
check("hold keeps its own marker", holdSrc.indexOf("data-ff-cal-hold") !== -1);

const detailsSrc = fs.readFileSync(path.join(root, "public/booking/appointments/details.js"), "utf8");
check("edit reuses new-appointment cards", detailsSrc.indexOf("createLinesHtml") !== -1);
check("edit can add a guest", detailsSrc.indexOf('data-ff-apd-act="add-guest"') !== -1);
check("edit opens the in-drawer service picker", detailsSrc.indexOf("open-service-picker") !== -1);
check("edit opens the in-drawer provider picker", detailsSrc.indexOf("open-provider-picker") !== -1);
check("details show a New Client badge", detailsSrc.indexOf("ff-apd-new-client") !== -1);

const detailsCss = fs.readFileSync(path.join(root, "public/booking/appointments/details.css"), "utf8");
const drawerCss = fs.readFileSync(path.join(root, "public/booking/appointments/drawer.css"), "utf8");
check("hidden edit footer does not stay visible", detailsCss.indexOf(".ff-apd-foot[hidden]") !== -1);
check("edit add-service buttons match new appointment", /\.ff-apd\s+\.ff-appt-add-line:not\(\[hidden\]\)/.test(drawerCss));

(async function () {
  await cal.loadForView("2026-08-24", "locA");
  const cached = cal.getCachedById("appt_1");
  check("cache lookup by appointmentId", cached && cached.appointmentId === "appt_1");
  check("unknown id is null", cal.getCachedById("missing") === null);
  if (failed) process.exit(1);
  console.log("All Appointment Details helper tests passed.");
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
