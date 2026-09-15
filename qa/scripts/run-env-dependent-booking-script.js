"use strict";

/**
 * Runs one Smart Scheduling emulator/staging suite from a product worktree.
 * These scripts are excluded from test:booking:static.
 *
 * Requires FF_QA_APP_ROOT (or a product tree that contains the script).
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { STATIC_EXCLUDED } = require("../../scripts/run-booking-static-qa");

const rel = String(process.argv[2] || "").replace(/\\/g, "/");
const extra = process.argv.slice(3);
if (!rel || STATIC_EXCLUDED.indexOf(rel) === -1) {
  console.error(
    "QA SETUP: expected one of:\n  " + STATIC_EXCLUDED.join("\n  ")
  );
  process.exit(2);
}

const root = String(process.env.FF_QA_APP_ROOT || "").trim()
  ? path.resolve(process.env.FF_QA_APP_ROOT)
  : path.resolve(__dirname, "../..");
const abs = path.join(root, rel);
if (!fs.existsSync(abs)) {
  console.error(
    "QA SETUP: " + rel + " is not in " + root +
      ". Set FF_QA_APP_ROOT to a product worktree that contains this script."
  );
  process.exit(2);
}

const result = spawnSync(process.execPath, [abs].concat(extra), {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status == null ? 1 : result.status);
