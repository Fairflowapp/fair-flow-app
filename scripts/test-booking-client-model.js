/**
 * Unit tests for the Booking Client model (identity helpers only).
 * Usage: node scripts/test-booking-client-model.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "public/booking/clients/model.js"), "utf8");
const windowObj = {};
new Function("window", src)(windowObj);
const model = windowObj.ffBookingClientModel;
if (!model) {
  console.error("Client model did not load.");
  process.exit(1);
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

const validEmails = [
  "jessica.miller@example.com",
  "jessica_miller@example.com",
  "jessica-miller@example.com",
  "jessica+vip@example.com",
  "jessica123@example.com",
];
validEmails.forEach((email) => {
  check("isEmailLike accepts " + email, model.isEmailLike(email) === true);
  check(
    "validateCreate accepts " + email,
    model.validateCreate({ firstName: "Jessica", email: email }).ok === true
  );
});

const invalidEmails = [
  "jessica",
  "jessica@",
  "@example.com",
  "jessica@example",
  "jessica @example.com",
];
invalidEmails.forEach((email) => {
  check("isEmailLike rejects " + JSON.stringify(email), model.isEmailLike(email) === false);
  const result = model.validateCreate({ firstName: "Jessica", email: email });
  check(
    "validateCreate rejects " + JSON.stringify(email),
    result.ok === false && result.error === "Email looks invalid."
  );
});

check(
  "normalizeEmail trims and lowercases",
  model.normalizeEmail("  Jessica.Miller@Example.com  ") === "jessica.miller@example.com"
);
check(
  "emailNormalized uses trim + lowercase",
  model.buildSearchFields({ firstName: "Jessica", email: "  Jessica.Miller@Example.com  " })
    .emailNormalized === "jessica.miller@example.com"
);
check("empty email is allowed on create", model.validateCreate({ firstName: "Jessica" }).ok === true);
check(
  "create still requires a name",
  model.validateCreate({ email: "jessica.miller@example.com" }).ok === false
);

check(
  "phoneDigits strips formatting",
  model.phoneDigits("(305) 555-1212") === "3055551212"
);
const keys = model.phoneKeys("305-555-1212");
check(
  "phoneKeys shares US 10-digit and +1 forms",
  keys.length === 2 && keys.indexOf("3055551212") !== -1 && keys.indexOf("13055551212") !== -1
);
check(
  "normalizeNamePart collapses and lowercases",
  model.normalizeNamePart("  Jessica   MILLER ") === "jessica miller"
);
check(
  "classifyQuery treats dotted email as email",
  model.classifyQuery("Jessica.Miller@Example.com").kind === "email"
  && model.classifyQuery("Jessica.Miller@Example.com").value === "jessica.miller@example.com"
);
check(
  "classifyQuery still treats phone digits as phone",
  model.classifyQuery("3055551212").kind === "phone"
);
[
  "9546000292",
  "954-600-0292",
  "(954) 600-0292",
  "+1 954 600 0292",
  "19546000292",
].forEach((q) => {
  const classified = model.classifyQuery(q);
  const keys = model.phoneKeys(q);
  check("classifyQuery treats " + JSON.stringify(q) + " as phone", classified.kind === "phone");
  check(
    "phoneKeys for " + JSON.stringify(q) + " share 10-digit and +1 forms",
    keys.indexOf("9546000292") !== -1 && keys.indexOf("19546000292") !== -1
  );
});
check(
  "partial digits classify as phone for prefix search",
  model.classifyQuery("954").kind === "phone"
  && model.classifyQuery("9546").kind === "phone"
  && model.classifyQuery("954600").kind === "phone"
  && model.classifyQuery("(954) 600").kind === "phone"
);
check(
  "partial digits are not an exact phoneKeys match",
  model.phoneKeys("954600").indexOf("9546000292") === -1
);
const prefixes = model.phoneKeyPrefixes("(954) 600-0292");
check(
  "phoneKeyPrefixes start at 3 digits and include both US forms",
  prefixes.indexOf("95") === -1
  && prefixes.indexOf("954") !== -1
  && prefixes.indexOf("954600") !== -1
  && prefixes.indexOf("9546000292") !== -1
  && prefixes.indexOf("195") !== -1
  && prefixes.indexOf("19546000292") !== -1
);
check(
  "classifyQuery still treats a name prefix as name",
  model.classifyQuery("Jess").kind === "name" && model.classifyQuery("Jess").value === "jess"
);

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("All Client model tests passed.");
