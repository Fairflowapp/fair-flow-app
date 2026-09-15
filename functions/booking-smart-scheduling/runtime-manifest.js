/**
 * Committed dependency list for the Functions Booking runtime copy.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.join(__dirname, "runtime-manifest.json");

function readRuntimeManifest() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (!raw || !raw.groups || typeof raw.groups !== "object") {
    throw new Error("Invalid booking-smart-scheduling runtime-manifest.json");
  }
  return raw;
}

function filesForGroup(groupName) {
  const groups = readRuntimeManifest().groups;
  const list = groups[groupName];
  if (!Array.isArray(list) || !list.length) {
    throw new Error("Missing runtime manifest group: " + groupName);
  }
  return list.map(function (rel) { return String(rel); });
}

function allRuntimeFiles() {
  const seen = Object.create(null);
  const out = [];
  const groups = readRuntimeManifest().groups;
  Object.keys(groups).forEach(function (groupName) {
    filesForGroup(groupName).forEach(function (rel) {
      if (!seen[rel]) {
        seen[rel] = true;
        out.push(rel);
      }
    });
  });
  return out;
}

module.exports = {
  MANIFEST_PATH: MANIFEST_PATH,
  readRuntimeManifest: readRuntimeManifest,
  filesForGroup: filesForGroup,
  allRuntimeFiles: allRuntimeFiles
};
