/**
 * Phase 18F runtime project fail-closed guard.
 * Project ID must come from Admin/runtime config, never from the caller.
 */
"use strict";

const EMULATOR_PROJECT = "fair-flow-smart-scheduling-emulator";
const STAGING_PROJECT = "fair-flow-staging";
const PRODUCTION_PROJECT = "fairflowapp-db841";

function trimText(value) {
  return String(value == null ? "" : value).trim();
}

function resolveRuntimeProjectId(adminApp, env) {
  const options = adminApp && adminApp.options ? adminApp.options : {};
  const fromEnv = env || process.env;
  return trimText(
    options.projectId
    || (fromEnv && fromEnv.GCLOUD_PROJECT)
    || (fromEnv && fromEnv.GOOGLE_CLOUD_PROJECT)
  );
}

function assertCallableRuntimeProject(projectId) {
  const project = trimText(projectId);
  if (project === PRODUCTION_PROJECT) {
    const err = new Error("production_project_forbidden");
    err.code = "production_project_forbidden";
    throw err;
  }
  if (project !== EMULATOR_PROJECT && project !== STAGING_PROJECT) {
    const err = new Error("unexpected_project");
    err.code = "unexpected_project";
    throw err;
  }
  return project;
}

module.exports = {
  EMULATOR_PROJECT: EMULATOR_PROJECT,
  STAGING_PROJECT: STAGING_PROJECT,
  PRODUCTION_PROJECT: PRODUCTION_PROJECT,
  resolveRuntimeProjectId: resolveRuntimeProjectId,
  assertCallableRuntimeProject: assertCallableRuntimeProject
};
