"use strict";

const { test: base, expect } = require("@playwright/test");
const { installLocalAppRoute } = require("./local-app-route");
const { loadAuthState, applyIndexedDBInitScript } = require("./auth-state");

const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    await installLocalAppRoute(context);
    if (testInfo.project.name !== "setup") {
      const authState = loadAuthState();
      await applyIndexedDBInitScript(context, authState.indexedDB);
    }
    await use(context);
  },
});

module.exports = { test, expect };
