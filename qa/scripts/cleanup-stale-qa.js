"use strict";

/**
 * Explicit stale cleanup for interrupted FF-QA-* records.
 * Never runs as part of ordinary concurrent tests.
 */
const { cleanupStaleQaAppointments } = require("../helpers/appointment-admin");
const { cleanupStaleQaClients } = require("../helpers/client-admin");
const {
  cleanupStaleQaCalendarBlocks,
  cleanupStaleQaCalendarSeries,
} = require("../helpers/calendar-block-admin");

const MAX_AGE_MS = Number(process.env.FF_QA_STALE_MS || 6 * 60 * 60 * 1000);

async function main() {
  console.log("Stale QA cleanup on fair-flow-staging / ffBookingQa only.");
  console.log("Deleting FF-QA markers older than " + MAX_AGE_MS + "ms.");
  const appointments = await cleanupStaleQaAppointments(MAX_AGE_MS);
  const clients = await cleanupStaleQaClients(MAX_AGE_MS);
  const calendarBlocks = await cleanupStaleQaCalendarBlocks(MAX_AGE_MS);
  const calendarSeries = await cleanupStaleQaCalendarSeries(MAX_AGE_MS);
  console.log("Deleted stale appointments:", appointments.length);
  console.log("Deleted stale clients:", clients.length);
  console.log("Deleted stale calendarBlocks:", calendarBlocks.length);
  console.log("Deleted stale calendarBlockSeries:", calendarSeries.length);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
