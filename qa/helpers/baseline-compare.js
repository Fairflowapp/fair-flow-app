"use strict";

function normalizeStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "pass" || raw === "passed") return "PASS";
  if (raw === "fail" || raw === "failed") return "FAIL";
  if (raw === "skip" || raw === "skipped") return "SKIP";
  return String(value || "").toUpperCase() || "UNKNOWN";
}

function lastTitleSegment(name) {
  return String(name || "")
    .split(/\s*[>›—]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .pop() || "";
}

function scenarioKey(name) {
  return lastTitleSegment(name)
    .replace(/^setup[^\n]*/i, "setup")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function baselineRows(suiteJson, nameField) {
  const tests = (suiteJson && suiteJson.tests) || [];
  return tests.map((row) => {
    const rawName = row[nameField] || row.testName || row.test || row.scenario || "";
    return {
      name: rawName,
      key: scenarioKey(rawName),
      status: normalizeStatus(row.status),
      classification: row.classification || "",
    };
  });
}

function targetRows(tests) {
  return (tests || []).map((row) => {
    const rawName = row.testName || row.test || row.scenario || row.name || "";
    return {
      name: rawName,
      key: scenarioKey(rawName),
      status: normalizeStatus(row.status),
      classification: row.classification || "",
      error: row.error || "",
    };
  });
}

function compareScenario(baselineStatus, targetStatus, options) {
  const infra = !!(options && options.infra);
  const flaky = !!(options && options.flaky);
  if (infra) {
    return {
      comparison: "QA_INFRA_FAILURE",
      classification: "D",
    };
  }
  if (flaky) {
    return {
      comparison: "FLAKY",
      classification: "C",
    };
  }
  const base = normalizeStatus(baselineStatus);
  const target = normalizeStatus(targetStatus);
  if (target === "SKIP" && base !== "SKIP") {
    return { comparison: "QA_INFRA_FAILURE", classification: "D" };
  }
  if (base === "PASS" && target === "PASS") {
    return { comparison: "UNCHANGED_PASS", classification: "" };
  }
  if (base === "FAIL" && target === "FAIL") {
    return { comparison: "PRE_EXISTING", classification: "A" };
  }
  if (base === "FAIL" && target === "PASS") {
    return { comparison: "FIXED_VS_BASELINE", classification: "" };
  }
  if (base === "PASS" && target === "FAIL") {
    return { comparison: "NEW_REGRESSION", classification: "B" };
  }
  if (!base && target === "FAIL") {
    return { comparison: "NEW_REGRESSION", classification: "B" };
  }
  if (!base && target === "PASS") {
    return { comparison: "UNCHANGED_PASS", classification: "" };
  }
  return { comparison: "UNCHANGED_PASS", classification: "" };
}

function compareStatic(baselineKeys, targetResult) {
  const expected = (baselineKeys || []).slice();
  const ran = (targetResult && targetResult.ranScripts) || [];
  const failKeys = ((targetResult && targetResult.assessment && targetResult.assessment.failKeys) || [])
    .slice();
  const rows = [];

  expected.forEach((key) => {
    const script = key.split(" :: ")[0];
    const ranScript = !ran.length || ran.indexOf(script) !== -1;
    if (!ranScript) {
      rows.push({
        scenario: key,
        baseline: "FAIL",
        target: "SKIP",
        comparison: "QA_INFRA_FAILURE",
        classification: "D",
        reason: "Target did not run " + script,
      });
      return;
    }
    const stillFail = failKeys.indexOf(key) !== -1;
    const compared = compareScenario("FAIL", stillFail ? "FAIL" : "PASS");
    rows.push({
      scenario: key,
      baseline: "FAIL",
      target: stillFail ? "FAIL" : "PASS",
      comparison: compared.comparison,
      classification: compared.classification,
    });
  });

  failKeys.forEach((key) => {
    if (expected.indexOf(key) !== -1) return;
    rows.push({
      scenario: key,
      baseline: "PASS",
      target: "FAIL",
      comparison: "NEW_REGRESSION",
      classification: "B",
    });
  });

  ((targetResult && targetResult.tests) || []).forEach((row) => {
    if (row.status !== "pass") return;
    if (String(row.testName || "").indexOf(" :: ") !== -1) return;
    rows.push({
      scenario: row.testName,
      baseline: "PASS",
      target: "PASS",
      comparison: "UNCHANGED_PASS",
      classification: "",
    });
  });

  return rows;
}

function compareBrowserSuite(baselineJson, targetTests, nameField, options) {
  const base = baselineRows(baselineJson, nameField);
  const target = targetRows(targetTests);
  const flakyKeys = (options && options.flakyKeys) || [];
  const infraKeys = (options && options.infraKeys) || [];
  const rows = [];
  const seen = {};

  base.forEach((item) => {
    const hit = target.find((row) => row.key === item.key) ||
      target.find((row) => row.key.indexOf(item.key) !== -1 || item.key.indexOf(row.key) !== -1);
    const targetStatus = hit ? hit.status : "SKIP";
    const compared = compareScenario(item.status, targetStatus, {
      flaky: flakyKeys.indexOf(item.key) !== -1,
      infra: infraKeys.indexOf(item.key) !== -1 || (!hit && target.length === 0),
    });
    rows.push({
      scenario: item.name,
      baseline: item.status,
      target: hit ? hit.status : "SKIP",
      comparison: compared.comparison,
      classification: compared.classification,
      error: hit ? hit.error : "target did not report this scenario",
    });
    if (hit) seen[hit.key] = true;
  });

  target.forEach((item) => {
    if (seen[item.key]) return;
    const compared = compareScenario("PASS", item.status, {
      flaky: flakyKeys.indexOf(item.key) !== -1,
      infra: infraKeys.indexOf(item.key) !== -1,
    });
    rows.push({
      scenario: item.name,
      baseline: "PASS",
      target: item.status,
      comparison: compared.comparison,
      classification: compared.classification,
      error: item.error,
    });
  });

  return rows;
}

function summarizeComparisons(rows) {
  const buckets = {
    NEW_REGRESSION: [],
    PRE_EXISTING: [],
    FIXED_VS_BASELINE: [],
    UNCHANGED_PASS: [],
    FLAKY: [],
    QA_INFRA_FAILURE: [],
  };
  (rows || []).forEach((row) => {
    const key = row.comparison;
    if (buckets[key]) buckets[key].push(row);
  });
  let result = "PASS";
  if (buckets.NEW_REGRESSION.length) result = "REGRESSIONS FOUND";
  if (buckets.QA_INFRA_FAILURE.length) {
    result = result === "REGRESSIONS FOUND"
      ? "REGRESSIONS FOUND / QA INFRA FAILURE"
      : "QA INFRA FAILURE";
  }
  return { result, buckets };
}

function detectKnownIssues(text) {
  const blob = String(text || "");
  return {
    A1: /INVALID_LINE|Please complete every service/i.test(blob),
    A2: /NotFoundError|innerHTML/i.test(blob) && /blur/i.test(blob),
  };
}

function compareKnownIssues(baselineNotes, observed, stdout) {
  const detected = Object.assign({ A1: false, A2: false }, observed || {}, detectKnownIssues(stdout));
  return (baselineNotes || []).map((note) => {
    const present = !!detected[note.id];
    if (note.id === "A1" && !present) {
      return {
        id: note.id,
        scenario: note.id + " — " + note.title,
        title: note.title,
        baseline: "known issue",
        target: "NOT PROBED",
        comparison: "PRE_EXISTING",
        classification: "A",
        reason: "Suite edits service, not start time. Absence of INVALID_LINE is not proof of a fix.",
      };
    }
    return {
      id: note.id,
      scenario: note.id + " — " + note.title,
      title: note.title,
      baseline: "known issue",
      target: present ? "STILL PRESENT" : "NOT OBSERVED",
      comparison: present ? "PRE_EXISTING" : "FIXED_VS_BASELINE",
      classification: present ? "A" : "",
    };
  });
}

module.exports = {
  normalizeStatus,
  scenarioKey,
  compareScenario,
  compareStatic,
  compareBrowserSuite,
  summarizeComparisons,
  detectKnownIssues,
  compareKnownIssues,
  baselineRows,
};
