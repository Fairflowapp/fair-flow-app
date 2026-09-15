/**
 * Thin Firebase onCall wrapper around handleExecuteBookingMutation.
 * Loads Smart Scheduling from generated runtime/ copies, not repository public/.
 * Phase 18F.1: staging-only deploy of this callable is approved.
 * Production remains forbidden. Do not deploy this module to production.
 */
"use strict";

const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { handleExecuteBookingMutation } = require("./execute-booking-mutation");
const { loadSmartSchedulingApi } = require("./load-smart-scheduling-api");
const { resolveRuntimeProjectId } = require("./project-guard");

const REGION = "us-central1";

let cachedApi = null;
function smartSchedulingApi() {
  if (!cachedApi) cachedApi = loadSmartSchedulingApi();
  return cachedApi;
}

async function executeBookingMutationHandler(req) {
  const projectId = resolveRuntimeProjectId(admin.app());
  const result = await handleExecuteBookingMutation({
    auth: req.auth || null,
    data: req.data || {},
    db: admin.firestore(),
    projectId: projectId,
    admin: admin,
    api: smartSchedulingApi(),
    bookingModel: smartSchedulingApi().bookingAppointmentModel,
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST || ""
  });
  if (result.status === "unauthenticated") {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  if (result.status === "permission_denied") {
    throw new HttpsError("permission-denied", "Not authorized for this salon.");
  }
  if (result.status === "production_project_forbidden" || result.status === "unexpected_project") {
    throw new HttpsError("failed-precondition", result.status);
  }
  return result;
}

exports.executeBookingMutation = onCall({ region: REGION }, executeBookingMutationHandler);
exports.executeBookingMutationHandler = executeBookingMutationHandler;
exports.handleExecuteBookingMutation = handleExecuteBookingMutation;
