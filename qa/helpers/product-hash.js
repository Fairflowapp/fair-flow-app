"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HASH_FILES = [
  "public/index.html",
  "public/booking/shell.js",
  "public/booking/calendar.js",
  "public/booking/appointments/drawer.js",
  "public/booking/appointments/model.js",
  "public/booking/clients/ui.js",
  "public/booking/clients/data.js",
  "public/booking/reports/ui.js",
  "public/booking/sales/ui.js",
];

function sha256File(abs) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

function hashProductFiles(appRoot) {
  const root = path.resolve(appRoot);
  const files = [];
  HASH_FILES.forEach((rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      files.push({ path: rel, present: false, sha256: "" });
      return;
    }
    files.push({ path: rel, present: true, sha256: sha256File(abs) });
  });
  return files;
}

module.exports = {
  HASH_FILES,
  hashProductFiles,
  sha256File,
};
