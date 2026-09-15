/**
 * Resolve generated Functions runtime assets. Never walks to repo root / public/.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = path.resolve(__dirname, "runtime");

function assertInsideRuntime(abs) {
  const root = RUNTIME_DIR.endsWith(path.sep) ? RUNTIME_DIR : RUNTIME_DIR + path.sep;
  if (abs !== RUNTIME_DIR && !abs.startsWith(root)) {
    throw new Error("runtime path escaped: " + abs);
  }
}

function readRuntimeSource(rel) {
  const cleaned = String(rel == null ? "" : rel).replace(/^\/+/, "");
  if (!cleaned || cleaned.indexOf("..") !== -1 || path.isAbsolute(cleaned)) {
    throw new Error("illegal runtime relative path: " + rel);
  }
  const abs = path.resolve(RUNTIME_DIR, cleaned);
  assertInsideRuntime(abs);
  if (!fs.existsSync(abs)) {
    throw new Error(
      "Functions runtime asset missing: " + cleaned
      + ". Run node functions/booking-smart-scheduling/build-runtime.js"
    );
  }
  return fs.readFileSync(abs, "utf8");
}

module.exports = {
  RUNTIME_DIR: RUNTIME_DIR,
  readRuntimeSource: readRuntimeSource
};
