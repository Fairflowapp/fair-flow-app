"use strict";

const path = require("path");
const { defineConfig } = require("@playwright/test");
const { loadQaEnv, appOrigin, QA_ROOT } = require("./helpers/env");
const { STORAGE_STATE_PATH } = require("./helpers/auth-state");

loadQaEnv();

const origin = appOrigin();

module.exports = defineConfig({
  testDir: path.join(QA_ROOT, "e2e"),
  outputDir: path.join(QA_ROOT, "test-results"),
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: Number(process.env.FF_E2E_RETRIES || 0),
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    [path.join(QA_ROOT, "helpers", "baseline-reporter.js")],
  ],
  use: {
    browserName: "chromium",
    headless: true,
    timezoneId: "America/New_York",
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 45000,
    baseURL: origin.origin,
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.js/,
      use: {
        screenshot: "off",
        video: "off",
        trace: "off",
      },
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.js/,
      use: {
        storageState: STORAGE_STATE_PATH,
      },
    },
  ],
});
