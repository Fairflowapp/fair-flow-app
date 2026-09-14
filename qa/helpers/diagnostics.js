"use strict";

function isFirebaseOrAppUrl(url) {
  return /firebase|googleapis|gstatic|identitytoolkit|firestore|fair-flow-staging/i.test(String(url || ""));
}

function attachDiagnostics(page) {
  const bag = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
  };

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    bag.consoleErrors.push(msg.text());
  });

  page.on("pageerror", (err) => {
    bag.pageErrors.push(String(err && err.message ? err.message : err));
  });

  page.on("requestfailed", (req) => {
    const failure = req.failure();
    bag.failedRequests.push({
      url: req.url(),
      method: req.method(),
      error: failure && failure.errorText ? failure.errorText : "requestfailed",
    });
  });

  page.on("response", (res) => {
    if (res.status() < 400) return;
    const url = res.url();
    if (!isFirebaseOrAppUrl(url)) return;
    bag.httpErrors.push({
      url,
      status: res.status(),
      method: res.request().method(),
    });
  });

  return bag;
}

function summarizeDiagnostics(bag) {
  const firebaseFails = (bag.failedRequests || []).filter((row) => isFirebaseOrAppUrl(row.url));
  const otherFails = (bag.failedRequests || []).filter((row) => !isFirebaseOrAppUrl(row.url));
  return {
    pageErrors: bag.pageErrors || [],
    consoleErrors: bag.consoleErrors || [],
    firebaseOrAppFailedRequests: firebaseFails,
    otherFailedRequests: otherFails,
    firebaseOrAppHttpErrors: bag.httpErrors || [],
  };
}

function printDiagnostics(bag, label) {
  const summary = summarizeDiagnostics(bag);
  const lines = [];
  if (summary.pageErrors.length) {
    lines.push("Uncaught page errors:");
    summary.pageErrors.forEach((msg) => lines.push("  - " + msg));
  }
  if (summary.consoleErrors.length) {
    lines.push("Browser console errors (not auto-failing warnings):");
    summary.consoleErrors.slice(0, 20).forEach((msg) => lines.push("  - " + String(msg).slice(0, 300)));
  }
  if (summary.firebaseOrAppFailedRequests.length || summary.firebaseOrAppHttpErrors.length) {
    lines.push("Failed Firebase/app requests:");
    summary.firebaseOrAppFailedRequests.forEach((row) => {
      lines.push("  - " + row.method + " " + row.status + " " + row.url + " " + (row.error || ""));
    });
    summary.firebaseOrAppHttpErrors.forEach((row) => {
      lines.push("  - HTTP " + row.status + " " + row.method + " " + row.url);
    });
  }
  if (!lines.length) return;
  console.log("[QA diagnostics" + (label ? " " + label : "") + "]");
  lines.forEach((line) => console.log(line));
}

module.exports = {
  attachDiagnostics,
  summarizeDiagnostics,
  printDiagnostics,
};
