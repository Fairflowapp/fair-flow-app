"use strict";

const { test, expect } = require("../helpers/qa-test");
const { requireStagingCredentials, REQUIRED_PROJECT_ID } = require("../helpers/env");
const {
  gotoStagingApp,
  loginWithEmail,
  waitForAppReady,
  assertDedicatedQaIdentity,
} = require("../helpers/auth");
const {
  EXPECTED_QA_EMAIL,
  EXPECTED_QA_LOCATION,
  exportIndexedDB,
  wipeCredentialFields,
  saveAuthState,
} = require("../helpers/auth-state");

test.use({
  screenshot: "off",
  video: "off",
  trace: "off",
});

test.describe("setup", () => {
  test("authenticate dedicated staging QA user without recording credentials", async ({ page, context }) => {
    requireStagingCredentials();

    const info = await gotoStagingApp(page);
    expect(info.projectId).toBe(REQUIRED_PROJECT_ID);
    expect(info.local.checkpointSha).toBeTruthy();

    await loginWithEmail(page);
    await wipeCredentialFields(page);
    await waitForAppReady(page);

    const identity = await assertDedicatedQaIdentity(page);
    expect(identity.email).toBe(EXPECTED_QA_EMAIL);
    if (identity.locationId) {
      expect(identity.locationId).toBe(EXPECTED_QA_LOCATION);
    }

    const indexedDB = await exportIndexedDB(page);
    const playwrightStorageState = await context.storageState();
    saveAuthState({
      email: identity.email,
      uid: identity.uid,
      salonId: identity.salonId,
      locationId: identity.locationId,
      playwrightStorageState,
      indexedDB,
    });

    await wipeCredentialFields(page);
    console.log(
      "[QA] Saved gitignored auth state for",
      identity.email,
      "salon",
      identity.salonId,
      identity.locationId ? ("location " + identity.locationId) : "location unresolved"
    );
  });
});
